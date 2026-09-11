/*
  LINA image filter: turns a photo into LINA geometry.

  Units: 1 unit = ¼ cell. The photo becomes a darkness map. Each screen tile
  picks a square dot from a ladder of sizes in half-cell steps. This is the one
  tool where blocks vary in size. Dots never share an edge, but separate dots
  may sit ¼ cell apart, like the letters of the wordmark. Around half tone,
  full squares can alternate with empty tiles so their corners bridge, and the
  darkest tones can fuse into solids. Dots are at least a whole cell, with one opt-in exception:
  the half-cell dot, which the corner rule turns into a circle, the way the
  A's crossbar is half a cell.
*/
(function (root) {
  'use strict';

  const PALETTES = [
    { name: 'Crimson on white', bg: '#FFFFFF', fg: '#9B0A0E' },
    { name: 'Oxblood on paper', bg: '#F1EDE6', fg: '#520000' },
    { name: 'White on crimson', bg: '#9B0A0E', fg: '#FFFFFF' },
    { name: 'Crimson on oxblood', bg: '#520000', fg: '#9B0A0E' },
    { name: 'Black on white', bg: '#FFFFFF', fg: '#000000' },
    { name: 'White on black', bg: '#000000', fg: '#FFFFFF' },
  ];

  const DEFAULTS = {
    mode: 'halftone', detail: 84, screen: 3, halfDots: true, stagger: false, merge: false, bridges: 0.3,
    direction: 'vertical', stemGap: 1, dither: 'diffusion',
    brightness: 0, contrast: 0, midtones: 0.35, cutoff: 0.08, smooth: 0.3, invert: false, radius: 0.25,
  };

  const CELL = 4, HALF = 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- source ---------- */

  // Luminance as a summed-area table, so any box average costs four lookups.
  // Transparent pixels count as white paper.
  function prepare(imageData) {
    const { width: w, height: h, data } = imageData;
    const W = w + 1;
    const sat = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = data[i + 3] / 255;
        row += ((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) * a + (1 - a);
        sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
      }
    }
    return { w, h, sat };
  }

  function boxMean(src, x0, y0, x1, y1) {
    const ax = clamp(Math.floor(x0), 0, src.w - 1), ay = clamp(Math.floor(y0), 0, src.h - 1);
    const bx = clamp(Math.ceil(x1), ax + 1, src.w), by = clamp(Math.ceil(y1), ay + 1, src.h);
    const W = src.w + 1, s = src.sat;
    return (s[by * W + bx] - s[ay * W + bx] - s[by * W + ax] + s[ay * W + ax]) / ((bx - ax) * (by - ay));
  }

  // Darkness of a box in output units: 0 is paper, 1 is full ink.
  function sampler(src, U, V, p) {
    const sx = src.w / U, sy = src.h / V;
    const blur = p.smooth * CELL;
    const k = Math.exp(p.contrast * 1.6);
    // Lifting the midtones opens up faces and skin without greying the blacks.
    const gamma = Math.pow(2, p.midtones * 1.2);
    return (x, y, w, h) => {
      let L = boxMean(src, (x - blur) * sx, (y - blur) * sy, (x + w + blur) * sx, (y + h + blur) * sy);
      if (p.invert) L = 1 - L;
      const d = Math.pow(clamp((0.5 - L) * k + 0.5 - p.brightness * 0.5, 0, 1), gamma);
      return d <= p.cutoff ? 0 : (d - p.cutoff) / (1 - p.cutoff);
    };
  }

  /* ---------- tone to dot size ---------- */

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  // Pick a ladder step per tile. `cov` is the ink share of each step, increasing.
  function quantize(nx, ny, tone, cov, mode) {
    const out = new Uint8Array(nx * ny);
    const t = Float32Array.from(tone);
    const top = cov.length - 1;
    for (let j = 0; j < ny; j++) {
      const ltr = mode !== 'diffusion' || j % 2 === 0;
      for (let n = 0; n < nx; n++) {
        const i = ltr ? n : nx - 1 - n;
        const k = j * nx + i;
        // Cleared highlights stay empty and take no error, so the paper stays clean.
        if (tone[k] <= 0) continue;
        const v = t[k];
        let l = 0;
        if (mode === 'ordered') {
          while (l < top && v >= cov[l + 1]) l++;
          if (l < top && (v - cov[l]) / (cov[l + 1] - cov[l]) > BAYER[(j & 3) * 4 + (i & 3)]) l++;
        } else {
          while (l < top && Math.abs(cov[l + 1] - v) <= Math.abs(cov[l] - v)) l++;
        }
        out[k] = l;
        if (mode === 'diffusion') {
          const e = v - cov[l], s = ltr ? 1 : -1;
          const spread = (ii, jj, w) => { if (ii >= 0 && ii < nx && jj < ny) t[jj * nx + ii] += e * w; };
          spread(i + s, j, 7 / 16);
          spread(i - s, j + 1, 3 / 16);
          spread(i, j + 1, 5 / 16);
          spread(i + s, j + 1, 1 / 16);
        }
      }
    }
    return out;
  }

  // Only whole dots are drawn, so the frame edge never cuts a dot into a sliver.
  function fill(bits, U, V, x, y, w, h) {
    if (x < 0 || y < 0 || x + w > U || y + h > V) return;
    for (let j = y; j < y + h; j++) bits.fill(1, j * U + x, j * U + x + w);
  }

  // Square dots in half-cell steps, from one cell up to half a cell short of the tile,
  // so neighbours never touch. The half-cell dot is the opt-in exception.
  function dotLadder(T, half, r) {
    const sizes = [[0, 0]];
    if (half) sizes.push([HALF, HALF]);
    for (let s = CELL; s <= T - HALF; s += HALF) sizes.push([s, s]);
    const cov = sizes.map(([w, h]) => (!w ? 0 : Math.min(1, (w * h - (4 - Math.PI) * r * r) / (T * T))));
    return { sizes, cov };
  }

  /* ---------- filters ---------- */

  function halftone(src, p) {
    const T = Math.max(CELL + HALF, Math.round(p.screen * CELL));
    const nx = Math.max(4, Math.round(p.detail));
    const ny = Math.max(1, Math.round((nx * src.h) / src.w));
    const U = nx * T, V = ny * T;
    const tone = sampler(src, U, V, p);
    const shift = p.stagger ? T >> 1 : 0;
    const cols = nx + (shift ? 1 : 0);
    const xAt = (i, j) => i * T - (j & 1 ? shift : 0);

    const raw = new Float32Array(cols * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < cols; i++) raw[j * cols + i] = tone(xAt(i, j), j * T, T, T);

    const { sizes, cov } = dotLadder(T, p.halfDots, p.radius * CELL);
    // Full black maps to the biggest dot, so dark tones keep their differences.
    const top = cov[cov.length - 1];
    const t = raw.map((v) => v * top);
    const levels = quantize(cols, ny, t, cov, p.dither);

    // Bridges: around half tone, full tiles alternate with empty ones, so every full
    // square meets its four diagonal neighbours corner to corner and the rule joins them
    // with a neck. Ink stays at half, so tone is kept; `bridges` widens the band.
    // Staggered rows never line up corner to corner, so they get no bridges.
    const band = p.bridges > 0 && !shift ? 0.05 + 0.07 * p.bridges : -1;
    // Solid: the darkest tones fill their tile and fuse.
    const solidFrom = p.merge ? 0.93 : 2;
    let edgeRoom = shift ? Math.min(T - shift, shift) - 1 : 0;
    edgeRoom -= edgeRoom & 1;

    const dots = new Array(levels.length).fill(null);
    for (let k = 0; k < levels.length; k++) {
      const i = k % cols, j = (k - i) / cols;
      let s = sizes[levels[k]][0], kind = 0;
      if (raw[k] >= solidFrom) { s = T; kind = 2; }
      else if (Math.abs(t[k] - 0.5) <= band) { s = (i + j) & 1 ? 0 : T; kind = 1; }
      if (!s) continue;
      const tx = xAt(i, j), ty = j * T;
      let x = tx + ((T - s) >> 1), y = ty + ((T - s) >> 1);
      if (x < 0 || x + s > U) {
        // Staggered rows start and end with half a tile: fit the biggest square that leaves a gap.
        if (s > edgeRoom) { s = edgeRoom >= CELL ? edgeRoom : p.halfDots && edgeRoom >= HALF ? HALF : 0; kind = 0; }
        if (!s) continue;
        x = x < 0 ? 0 : U - s;
      }
      if (y < 0 || y + s > V) continue;
      dots[k] = { x, y, s, kind, tx, ty };
    }
    resolveContacts(dots, cols, ny, T, U);

    const bits = new Uint8Array(U * V);
    for (const d of dots) if (d) fill(bits, U, V, d.x, d.y, d.s, d.s);
    return { bits, U, V, label: `${nx} × ${ny} dots` };
  }

  // Dots may share an edge only when both are solid. Any other side contact shrinks
  // the plainer dot by half a cell, recentred in its tile, until a gap opens.
  function resolveContacts(dots, cols, rows, T, U) {
    const touching = (a, b) => {
      const ox = a.x < b.x + b.s && b.x < a.x + a.s, oy = a.y < b.y + b.s && b.y < a.y + a.s;
      if (ox && oy) return true;
      if (oy && (a.x + a.s === b.x || b.x + b.s === a.x)) return true;
      return ox && (a.y + a.s === b.y || b.y + b.s === a.y);
    };
    const shrink = (d) => {
      d.s = d.s > T - HALF ? T - HALF : d.s - HALF;
      if (d.s < CELL) { d.s = 0; return; }
      d.x = Math.min(Math.max(0, d.tx + ((T - d.s) >> 1)), U - d.s);
      d.y = d.ty + ((T - d.s) >> 1);
      d.kind = 0;
    };
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let k = 0; k < dots.length; k++) {
        const a = dots[k];
        if (!a || !a.s) continue;
        const i = k % cols, j = (k - i) / cols;
        for (let dj = 0; dj <= 1; dj++) {
          for (let di = dj ? -1 : 1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || ii >= cols || jj >= rows) continue;
            const b = dots[jj * cols + ii];
            if (!b || !b.s || (a.kind === 2 && b.kind === 2) || !touching(a, b)) continue;
            shrink(a.kind < b.kind ? a : b);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    for (let k = 0; k < dots.length; k++) if (dots[k] && !dots[k].s) dots[k] = null;
  }

  // Stems one cell wide, ¼ or ½ cell apart. Each window along a stem holds one run,
  // in half-cell lengths, so runs in one stem stay half a cell apart.
  function stems(src, p) {
    const W = Math.max(CELL + HALF, Math.round(p.screen * CELL));
    const g = p.stemGap >= 2 ? HALF : 1;
    const P = CELL + g;
    const vertical = p.direction !== 'horizontal';
    const n = Math.max(4, Math.round(p.detail));
    const A = n * P - g;
    const aspect = vertical ? src.h / src.w : src.w / src.h;
    const m = Math.max(1, Math.round((A * aspect) / W));
    const B = m * W;
    const U = vertical ? A : B, V = vertical ? B : A;
    const tone = sampler(src, U, V, p);
    const shift = p.stagger ? W >> 1 : 0;
    const wins = m + (shift ? 1 : 0);
    const at = (a, b) => b * W - (a & 1 ? shift : 0);

    const t = new Float32Array(n * wins);
    for (let b = 0; b < wins; b++) {
      for (let a = 0; a < n; a++) {
        const s = at(a, b);
        t[b * n + a] = vertical ? tone(a * P, s, CELL, W) : tone(s, a * P, W, CELL);
      }
    }

    const r = p.radius * CELL;
    const max = p.merge ? W : W - HALF;
    const lens = [0];
    if (p.halfDots) lens.push(HALF);
    for (let l = CELL; l <= max; l += HALF) lens.push(l);
    const cov = lens.map((l) => (!l ? 0 : l === W ? 1 : (CELL * l - (4 - Math.PI) * r * r) / (CELL * W)));
    const top = cov[cov.length - 1];
    for (let k = 0; k < t.length; k++) t[k] *= top;

    const levels = quantize(n, wins, t, cov, p.dither);
    const bits = new Uint8Array(U * V);
    for (let k = 0; k < levels.length; k++) {
      const len = lens[levels[k]];
      if (!len) continue;
      const a = k % n, b = (k - a) / n, s = at(a, b);
      if (vertical) fill(bits, U, V, a * P, s, CELL, len);
      else fill(bits, U, V, s, a * P, len, CELL);
    }
    return { bits, U, V, label: `${n} stems` };
  }

  // Two tones. Without dithering the edge follows the image at half-cell precision,
  // trimmed to what whole cells can cover; with dithering each cell is ink or paper.
  // Bitmap is one mass, so it works on the half-cell grid and is drawn at quarter resolution.
  function bitmap(src, p) {
    const cw = Math.max(4, Math.round(p.detail));
    const ch = Math.max(2, Math.round((cw * src.h) / src.w));
    const hw = cw * 2, hh = ch * 2;
    const tone = sampler(src, hw, hh, p);
    const half = new Uint8Array(hw * hh);
    if (p.dither === 'none') {
      const ink = new Uint8Array(hw * hh);
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) ink[y * hw + x] = tone(x, y, 1, 1) > 0.5 ? 1 : 0;
      for (let y = 0; y < hh - 1; y++) {
        for (let x = 0; x < hw - 1; x++) {
          const a = y * hw + x;
          if (ink[a] && ink[a + 1] && ink[a + hw] && ink[a + hw + 1]) half[a] = half[a + 1] = half[a + hw] = half[a + hw + 1] = 1;
        }
      }
    } else {
      const t = new Float32Array(cw * ch);
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) t[j * cw + i] = tone(i * 2, j * 2, 2, 2);
      const levels = quantize(cw, ch, t, [0, 1], p.dither);
      for (let k = 0; k < levels.length; k++) {
        if (!levels[k]) continue;
        const i = k % cw, j = (k - i) / cw;
        for (let y = 0; y < 2; y++) half.fill(1, (j * 2 + y) * hw + i * 2, (j * 2 + y) * hw + i * 2 + 2);
      }
    }
    const U = hw * 2, V = hh * 2;
    const bits = new Uint8Array(U * V);
    for (let y = 0; y < hh; y++)
      for (let x = 0; x < hw; x++) {
        if (!half[y * hw + x]) continue;
        const k = 2 * y * U + 2 * x;
        bits[k] = bits[k + 1] = bits[k + U] = bits[k + U + 1] = 1;
      }
    return { bits, U, V, label: `${cw} × ${ch} cells` };
  }

  const FILTERS = { halftone, stems, bitmap };

  function process(src, options) {
    const p = Object.assign({}, DEFAULTS, options);
    return (FILTERS[p.mode] || halftone)(src, p);
  }

  root.LinaImage = { PALETTES, DEFAULTS, prepare, process, CELL };
})(typeof window !== 'undefined' ? window : globalThis);
