/*
  LINA image filter: turns a photo into LINA geometry.

  Units: 1 unit = ¼ cell. The photo becomes a darkness map. Dither is the landing
  banner's pattern toned by the photo, the one filter outside the rule: its dots vary
  in size. Bitmap keeps to the rule.
*/
(function (root) {
  'use strict';

  const Geo = root.LinaGeometry;

  const PALETTES = [
    { name: 'Carmim sobre branco', bg: '#FFFFFF', fg: '#9B0A0E' },
    { name: 'Vinho sobre papel', bg: '#F1EDE6', fg: '#520000' },
    { name: 'Branco sobre carmim', bg: '#9B0A0E', fg: '#FFFFFF' },
    { name: 'Carmim sobre vinho', bg: '#520000', fg: '#9B0A0E' },
    { name: 'Preto sobre branco', bg: '#FFFFFF', fg: '#000000' },
    { name: 'Branco sobre preto', bg: '#000000', fg: '#FFFFFF' },
  ];

  const DEFAULTS = {
    mode: 'dither', detail: 84,
    dither: 'diffusion',
    brightness: 0, contrast: 0, midtones: 0.35, cutoff: 0.08, smooth: 0.3, invert: false, radius: 0.25,
  };

  const CELL = 4;
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

  /* ---------- filters ---------- */

  // The landing banner's pattern, toned by the photo, one tile per cell. Dark tiles become solid
  // cells whose union is traced by the rule; below that the rim is Bayer-dithered into cells
  // meeting at corners, and a band of mid-dark tones draws one-cell lines along the image's
  // contours. Other tiles hold a dot sized by the tone, the banner's declared exception; next to
  // a solid a dot stays at half a cell, so the gap to the solid stays ¼ cell.
  function dither(src, p) {
    const SOLID = 0.9, BRIDGE = 0.72, LINE = 0.62;
    const nx = Math.max(4, Math.round(p.detail));
    const ny = Math.max(1, Math.round((nx * src.h) / src.w));
    const U = nx * CELL, V = ny * CELL, N = nx * ny;
    const sample = sampler(src, U, V, p);
    const tone = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) tone[j * nx + i] = sample(i * CELL, j * CELL, CELL, CELL);
    const at = (i, j) => tone[clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)];
    const mod = (a, n) => ((a % n) + n) % n;
    const solid = new Uint8Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, t = tone[k];
      let s = t >= SOLID || (t - BRIDGE) / (SOLID - BRIDGE) > BAYER[(j & 3) * 4 + (i & 3)];
      if (!s && t >= LINE) {
        // Lines run along the contour, across the tone gradient.
        const gx = at(i + 1, j) - at(i - 1, j), gy = at(i, j + 1) - at(i, j - 1);
        const [a, b] = Math.abs(gx) > 2 * Math.abs(gy) ? [j, i] : Math.abs(gy) > 2 * Math.abs(gx) ? [i, j] : gx * gy > 0 ? [i, i + j] : [i, i - j];
        s = mod(b, 3) === 0 && mod(a + 2 * Math.floor(b / 3), 4) < 2 + Math.floor((t - LINE) / 0.06);
      }
      solid[k] = s ? 1 : 0;
    }
    const size = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, t = tone[k];
      if (solid[k] || t <= BAYER[(j & 3) * 4 + (i & 3)]) continue;
      let s = 0.26 + t * 0.65;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && solid[jj * nx + ii]) s = Math.min(s, 0.5);
      }
      size[k] = s;
    }
    const f = (v) => Math.round(v * 1000) / 1000;
    const draw = (radius, scale) => {
      const C = CELL * scale;
      let d = Geo.traceBitmap(solid, nx, ny, radius, { scale: C });
      for (let k = 0; k < N; k++) {
        if (!size[k]) continue;
        const i = k % nx, j = (k - i) / nx, s = size[k] * C, r = f(Math.min(s / 2, radius * C));
        const x = i * C + (C - s) / 2, y = j * C + (C - s) / 2;
        d += `M${f(x + r)} ${f(y)}H${f(x + s - r)}A${r} ${r} 0 0 1 ${f(x + s)} ${f(y + r)}` +
          `V${f(y + s - r)}A${r} ${r} 0 0 1 ${f(x + s - r)} ${f(y + s)}H${f(x + r)}` +
          `A${r} ${r} 0 0 1 ${f(x)} ${f(y + s - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
      }
      return d;
    };
    return { U, V, draw, label: `${nx} × ${ny} células` };
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
    return { bits, U, V, label: `${cw} × ${ch} células` };
  }

  const FILTERS = { dither, bitmap };

  function process(src, options) {
    const p = Object.assign({}, DEFAULTS, options);
    return (FILTERS[p.mode] || dither)(src, p);
  }

  // A result's outline in output units times `scale`, corners rounded by `radius` cells.
  function outline(res, radius, scale = 1) {
    return res.draw ? res.draw(radius, scale) : Geo.traceBitmap(res.bits, res.U, res.V, radius * CELL, { scale });
  }

  root.LinaImage = { PALETTES, DEFAULTS, prepare, process, outline, CELL };
})(typeof window !== 'undefined' ? window : globalThis);
