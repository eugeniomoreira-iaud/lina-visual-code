/*
  LINA textures: seeded patterns that obey the LINA geometry.

  Units: 1 unit = ¼ cell. A cell is 4×4 units, a half cell 2×2.
  Blocks are always cell-sized. Anything that connects (touches or overlaps)
  keeps a whole number of half cells between origins, so a shape's inside
  geometry stays on the half-cell grid. Separate shapes may sit ¼ cell apart,
  the way the wordmark spaces its letters. Ink pixels store their shape's
  alignment class (1..4) so placement can enforce this.
*/
(function (root) {
  'use strict';
  const Geo = root.LinaGeometry;

  const PALETTES = [
    { name: 'Carmim sobre branco', bg: '#FFFFFF', fg: '#9B0A0E', accent: '#520000' },
    { name: 'Branco sobre carmim', bg: '#9B0A0E', fg: '#FFFFFF', accent: '#520000' },
    { name: 'Vinho sobre carmim', bg: '#9B0A0E', fg: '#520000', accent: '#FFFFFF' },
    { name: 'Carmim sobre vinho', bg: '#520000', fg: '#9B0A0E', accent: '#FFFFFF' },
    { name: 'Preto sobre branco', bg: '#FFFFFF', fg: '#000000', accent: '#9B0A0E' },
    { name: 'Branco sobre preto', bg: '#000000', fg: '#FFFFFF', accent: '#9B0A0E' },
  ];

  const DEFAULTS = {
    mode: 'field', seed: 1, cols: 48, rows: 48, edges: 'bleed',
    blank: 0.5, steps: 0.5, quarter: 0.3, radius: 0.25, pinholes: true, accent: 0.15,
    clump: 0.6, grain: 5, stretch: 0, direction: 'vertical', gutter: 0.4, gutterWidth: 1,
    rotate: true, glyphSize: 1, gap: 1, weights: { L: 1, I: 1, n: 1, A: 1 },
    scale: 1, tiles: 1,
  };

  const CELL = 4, HALF = 2;

  /* ---------- randomness ---------- */

  function mix32(h) {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function rngFor(seed, stream) {
    let a = mix32(Math.imul(seed | 0, 0x9e3779b1) ^ mix32(stream + 0x6d2b79f5));
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hash2 = (x, y, seed) =>
    mix32(Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ mix32(seed | 0)) / 4294967296;

  const mod = (a, n) => ((a % n) + n) % n;

  /* ---------- field: the bitmap generators draw into ---------- */

  // Bleed mode generates two cells past the frame so shapes run off the edge naturally.
  // Seamless mode wraps every coordinate so the frame tiles.
  function makeField(W, H, edges) {
    const wrap = edges === 'seamless';
    const M = edges === 'bleed' ? 2 * CELL : 0;
    const GW = W + 2 * M, GH = H + 2 * M;
    const bits = new Uint8Array(GW * GH);
    const F = { W, H, M, GW, GH, wrap, bits };
    F.at = (x, y) => {
      if (wrap) return bits[mod(y, GH) * GW + mod(x, GW)];
      return x >= 0 && y >= 0 && x < GW && y < GH ? bits[y * GW + x] : 0;
    };
    return F;
  }

  // Alignment class of a shape whose origin is (x, y): which quarter of the half-cell grid it sits on.
  const cls = (x, y) => 1 + ((x & 1) << 1) + (y & 1);

  const inFrame = (F, x, y) => x >= F.M && y >= F.M && x < F.M + F.W && y < F.M + F.H;

  function frameFilled(F) {
    let n = 0;
    for (let y = F.M; y < F.M + F.H; y++)
      for (let x = F.M; x < F.M + F.W; x++) if (F.bits[y * F.GW + x]) n++;
    return n;
  }

  // Fill a rectangle. Legal only if every ink pixel it touches (including corners)
  // has the same alignment class, so connected pieces keep half-cell offsets.
  // Returns newly filled frame pixels, or -1 if it does not fit.
  function fillRect(F, x, y, w, h) {
    if (!F.wrap && (x < 0 || y < 0 || x + w > F.GW || y + h > F.GH)) return -1;
    const c = cls(x, y);
    for (let j = -1; j <= h; j++)
      for (let i = -1; i <= w; i++) {
        const v = F.at(x + i, y + j);
        if (v && v !== c) return -1;
      }
    let added = 0;
    for (let j = 0; j < h; j++) {
      const yy = F.wrap ? mod(y + j, F.GH) : y + j;
      for (let i = 0; i < w; i++) {
        const xx = F.wrap ? mod(x + i, F.GW) : x + i;
        const k = yy * F.GW + xx;
        if (F.bits[k]) continue;
        F.bits[k] = c;
        if (inFrame(F, xx, yy)) added++;
      }
    }
    return added;
  }

  // Binary search a control value so the frame ends up with the requested blank share.
  function fitBlank(F, blank, lo, hi, build) {
    const target = F.W * F.H * (1 - blank);
    let best = lo, bestErr = Infinity;
    for (let it = 0; it < 16; it++) {
      const v = (lo + hi) / 2;
      build(v);
      const n = frameFilled(F);
      const err = Math.abs(n - target);
      if (err < bestErr) { bestErr = err; best = v; }
      if (n > target) lo = v; else hi = v;
    }
    build(best);
  }

  /* ---------- generators ---------- */

  // Random cells. Clumping keeps walking from the last cell, which draws trails.
  // `steps` puts a cell half a cell off the grid; `quarter` puts it a quarter off,
  // where it can only sit if it touches nothing.
  function scatter(F, p, seed) {
    const rng = rngFor(seed, 1);
    const target = F.W * F.H * (1 - p.blank);
    const DIRS = [[CELL, 0], [0, CELL], [-CELL, 0], [0, -CELL]];
    let filled = 0, x = 0, y = 0, dir = 0, walking = false;
    const tries = (F.GW * F.GH) / 2;
    for (let t = 0; t < tries && filled < target; t++) {
      if (walking && rng() < p.clump) {
        if (rng() < 0.4) dir = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
        x += DIRS[dir][0];
        y += DIRS[dir][1];
      } else {
        x = CELL * Math.floor(rng() * (F.GW / CELL));
        y = CELL * Math.floor(rng() * (F.GH / CELL));
        dir = Math.floor(rng() * 4);
        if (rng() < p.steps) { if (rng() < 0.5) x += HALF; else y += HALF; }
        if (rng() < p.quarter) { if (rng() < 0.5) x += 1; else y += 1; }
      }
      const n = fillRect(F, x, y, CELL, CELL);
      walking = n >= 0;
      if (n > 0) filled += n;
    }
  }

  // Two octaves of smooth value noise on a grid of the given size, periodic when wrapping.
  function noise(GW, GH, wrap, p, seed) {
    const rng = rngFor(seed, 2);
    const base = Math.max(1, p.grain) * 2;
    const k = Math.pow(2, p.stretch * 1.5);
    const sx = base / k, sy = base * k;
    const out = new Float32Array(GW * GH);
    const smooth = (t) => t * t * (3 - 2 * t);
    const Lx0 = Math.max(1, Math.round(GW / sx));
    const Ly0 = Math.max(1, Math.round(GH / sy));
    for (const [m, weight] of [[1, 0.68], [2, 0.32]]) {
      let Lx, Ly, cx, cy;
      if (wrap) { Lx = Lx0 * m; Ly = Ly0 * m; cx = GW / Lx; cy = GH / Ly; }
      else { cx = sx / m; cy = sy / m; Lx = Math.ceil(GW / cx) + 2; Ly = Math.ceil(GH / cy) + 2; }
      const v = new Float32Array(Lx * Ly);
      for (let i = 0; i < v.length; i++) v[i] = rng();
      const at = (i, j) => v[mod(j, Ly) * Lx + mod(i, Lx)];
      for (let y = 0; y < GH; y++) {
        const fy = (y + 0.5) / cy, j0 = Math.floor(fy), ty = smooth(fy - j0);
        for (let x = 0; x < GW; x++) {
          const fx = (x + 0.5) / cx, i0 = Math.floor(fx), tx = smooth(fx - i0);
          const a = at(i0, j0), b = at(i0 + 1, j0), c = at(i0, j0 + 1), d = at(i0 + 1, j0 + 1);
          out[y * GW + x] += weight * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
        }
      }
    }
    return out;
  }

  // Field is one connected mass, so it works on the half-cell grid: the noise is cut
  // into whole cells at half-cell resolution, then drawn at quarter resolution.
  // Cells on the cell grid are always allowed; half-offset cells only as often as `steps`.
  function fieldMode(F, p, seed) {
    const gw = F.GW / 2, gh = F.GH / 2;
    const n = noise(gw, gh, F.wrap, p, seed);
    const half = new Uint8Array(gw * gh);
    const build = (t) => {
      half.fill(0);
      const xs = F.wrap ? gw : gw - 1, ys = F.wrap ? gh : gh - 1;
      for (let y = 0; y < ys; y++) {
        const y1 = F.wrap ? (y + 1) % gh : y + 1;
        for (let x = 0; x < xs; x++) {
          if ((x | y) & 1 && hash2(x, y, seed) >= p.steps) continue;
          const x1 = F.wrap ? (x + 1) % gw : x + 1;
          const a = y * gw + x, b = y * gw + x1, c = y1 * gw + x, d = y1 * gw + x1;
          if (n[a] > t && n[b] > t && n[c] > t && n[d] > t) half[a] = half[b] = half[c] = half[d] = 1;
        }
      }
      F.bits.fill(0);
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          if (!half[y * gw + x]) continue;
          const k = 2 * y * F.GW + 2 * x;
          F.bits[k] = F.bits[k + 1] = F.bits[k + F.GW] = F.bits[k + F.GW + 1] = 1;
        }
    };
    fitBlank(F, p.blank, 0, 1, build);
  }

  // Bars one cell wide, laid in columns, with random lengths and gaps.
  // Gutters between columns are ¼ or ½ cell wide. A column with a gutter on both
  // sides is its own shape, so its runs may also be ¼ cell apart.
  function stems(F, p, seed) {
    const rng = rngFor(seed, 3);
    const vertical = p.direction !== 'horizontal';
    const A = vertical ? F.GW : F.GH;
    const B = vertical ? F.GH : F.GW;
    const gw = p.gutterWidth >= 2 ? HALF : 1;
    const put = (a, b, len) => (vertical ? fillRect(F, a, b, CELL, len) : fillRect(F, b, a, len, CELL));

    const cols = [];
    let a = 0, leftGutter = true;
    while (F.wrap ? a < A : a + CELL <= A) {
      const u = new Float32Array(B * 2 + 16);
      for (let i = 0; i < u.length; i++) u[i] = rng();
      const rightGutter = rng() < p.gutter;
      cols.push({ a, u, free: leftGutter && rightGutter });
      a += CELL + (rightGutter ? gw : 0);
      leftGutter = rightGutter;
    }

    // q < 0 merges runs (less blank), q > 0 lengthens gaps (more blank).
    const build = (q) => {
      F.bits.fill(0);
      const qp = Math.max(0, q), merge = Math.max(0, -q);
      const solidSpan = 1 + Math.round(4 * (1 - qp));
      const gapSpan = 1 + 20 * qp * qp;
      for (const { a, u, free } of cols) {
        let k = 0;
        let b = -CELL * Math.floor(u[k++] * 4) - (u[k++] < p.steps ? HALF : 0);
        const end = F.wrap ? b + B : B;
        while (b < end && k < u.length - 8) {
          const len = CELL * (1 + Math.floor(u[k++] * solidSpan)) + (u[k++] < p.steps ? HALF : 0);
          if (F.wrap) put(a, b, len);
          else {
            const s = Math.max(0, b), e = Math.min(B, b + len);
            if (e - s >= CELL) put(a, s, e - s);
          }
          b += len;
          let gap = Math.max(HALF, CELL * (1 + Math.floor(u[k++] * gapSpan)) - (u[k++] < p.steps ? HALF : 0));
          if (free && u[k++] < p.quarter) gap = Math.max(1, gap - 1);
          if (u[k++] >= merge) b += gap;
        }
      }
    };
    fitBlank(F, p.blank, -1, 1, build);
  }

  // The wordmark letters in all eight orientations, in quarter units
  // (a half-cell block becomes 2k × 2k units), each with a halo `gap` units wide.
  const glyphCache = new Map();
  function glyphSet(k, gap) {
    const key = k + ':' + gap;
    if (glyphCache.has(key)) return glyphCache.get(key);
    const set = {};
    for (const letter of Object.keys(Geo.LETTERS)) {
      const { bits, w, h } = Geo.blocksToBitmap(Geo.LETTERS[letter].blocks);
      const px = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) px.push([x, y]);
      const variants = [];
      for (let t = 0; t < 8; t++) {
        let pts = px.map(([x, y]) => (t & 4 ? [w - 1 - x, y] : [x, y]));
        let vw = w, vh = h;
        for (let r = 0; r < (t & 3); r++) {
          const ph = vh;
          pts = pts.map(([x, y]) => [ph - 1 - y, x]);
          [vw, vh] = [vh, vw];
        }
        const B = 2 * k;
        const fine = [];
        for (const [x, y] of pts)
          for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) fine.push([x * B + dx, y * B + dy]);
        const seen = new Set(), halo = [];
        for (const [x, y] of fine)
          for (let dy = -gap; dy <= gap; dy++)
            for (let dx = -gap; dx <= gap; dx++) {
              const id = (x + dx) + ',' + (y + dy);
              if (!seen.has(id)) { seen.add(id); halo.push([x + dx, y + dy]); }
            }
        variants.push({ pts: fine, halo, w: vw * B, h: vh * B });
      }
      set[letter] = variants;
    }
    glyphCache.set(key, set);
    return set;
  }

  // Letters set like type. A skyline packer lays them from the top, each new letter
  // going to the lowest free spot, exactly `gap` quarter cells from its neighbours.
  // The frame is packed full, then letters are removed at random until the blank
  // share is met, so the density stays even. Merging (gap 0) snaps to the half-cell
  // grid so any gap inside the merged shape is still at least half a cell.
  function glyphs(F, p, seed) {
    const rng = rngFor(seed, 4);
    const k = Math.min(3, Math.max(1, Math.round(p.glyphSize)));
    const gap = Math.max(0, Math.round(p.gap));
    const set = glyphSet(k, gap);
    const snap = gap === 0 ? HALF : 1;
    const { GW, GH, wrap, bits } = F;

    const letters = Object.keys(set);
    const weights = letters.map((l) => Math.max(0, Number((p.weights || {})[l] ?? 1)));
    const totalW = weights.reduce((a, b) => a + b, 0) || letters.length;
    const pick = () => {
      let u = rng() * totalW;
      let i = 0;
      while (i < letters.length - 1 && (u -= weights[i] || (totalW === letters.length ? 1 : 0)) >= 0) i++;
      const variants = set[letters[i]];
      return p.rotate ? variants[Math.floor(rng() * 8)] : variants[0];
    };

    // Ink is counted per pixel so merged letters can be removed cleanly.
    const count = new Uint16Array(GW * GH);
    const fits = (v, x, y) => {
      if (!wrap && (x < 0 || y < 0 || x + v.w > GW || y + v.h > GH)) return false;
      const list = gap > 0 ? v.halo : v.pts;
      for (const [dx, dy] of list) if (F.at(x + dx, y + dy)) return false;
      return true;
    };
    const idx = (x, y) => (wrap ? mod(y, GH) * GW + mod(x, GW) : y * GW + x);
    const paint = (g, on) => {
      for (const [dx, dy] of g.v.pts) {
        const i = idx(g.x + dx, g.y + dy);
        count[i] += on ? 1 : -1;
        bits[i] = count[i] ? 1 : 0;
      }
    };

    // Skyline: first free row per column, with the gap already reserved.
    const sky = new Int32Array(GW);
    const placed = [];
    const rise = (x, w) => { let m = 0; for (let i = 0; i < w; i++) m = Math.max(m, sky[wrap ? mod(x + i, GW) : x + i]); return m; };
    let stuck = 0;
    for (let t = 0; t < 20000 && stuck < 40; t++) {
      const v = pick();
      const xs = [];
      const maxX = wrap ? GW : GW - v.w;
      for (let x = 0; x < maxX; x += snap) xs.push([rise(x, v.w), x]);
      if (!xs.length) break;
      xs.sort((a, b) => a[0] - b[0] || rng() - 0.5);
      let done = false;
      for (let c = 0; c < Math.min(6, xs.length) && !done; c++) {
        const [top, x] = xs[c];
        let y = top % snap ? top + (snap - (top % snap)) : top;
        if (!wrap && y + v.h > GH) continue;
        if (fits(v, x, y)) {
          const g = { v, x, y };
          paint(g, true);
          placed.push(g);
          for (let i = -gap; i < v.w + gap; i++) {
            const xi = wrap ? mod(x + i, GW) : x + i;
            if (xi >= 0 && xi < GW) sky[xi] = Math.max(sky[xi], y + v.h + gap);
          }
          done = true;
        } else {
          // Skyline is box-shaped, ink under it may still block: step this column down.
          for (let i = 0; i < v.w; i++) { const xi = wrap ? mod(x + i, GW) : x + i; sky[xi] = Math.max(sky[xi], y + snap); }
        }
      }
      if (!done) stuck++; else stuck = 0;
      if (!wrap && xs.every(([top]) => top + CELL * 2 * k > GH)) break;
    }

    // Thin out to the requested blank share.
    const target = F.W * F.H * (1 - p.blank);
    let filled = frameFilled(F);
    for (let i = placed.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [placed[i], placed[j]] = [placed[j], placed[i]];
    }
    while (filled > target && placed.length) {
      paint(placed.pop(), false);
      filled = frameFilled(F);
    }
  }

  const GENERATORS = { scatter, field: fieldMode, stems, glyphs };

  /* ---------- finishing ---------- */

  // A hole no bigger than half a cell, closed on every side by one shape,
  // would render as a dot-sized circle. Fill it.
  function fillPinholes(F) {
    const { GW, GH, wrap, bits } = F;
    const seen = new Uint8Array(GW * GH);
    const fills = [];
    for (let s = 0; s < bits.length; s++) {
      if (bits[s] || seen[s]) continue;
      // Flood the whole empty region so no pixel is mistaken for a hole later.
      const stack = [s], hole = [];
      seen[s] = 1;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, open = false;
      while (stack.length) {
        const k = stack.pop();
        const x = k % GW, y = (k - x) / GW;
        hole.push(k);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nx = x + dx, ny = y + dy;
          if (wrap) { nx = mod(nx, GW); ny = mod(ny, GH); }
          else if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) { open = true; continue; }
          const n = ny * GW + nx;
          if (!bits[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      if (open || hole.length > HALF * HALF) continue;
      if (x1 - x0 >= HALF || y1 - y0 >= HALF) continue;
      // Only one shape may surround it, or filling would fuse shapes with different alignments.
      let c = 0, mixed = false;
      for (const k of hole) {
        const x = k % GW, y = (k - x) / GW;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const v = F.at(x + dx, y + dy);
          if (!v) continue;
          if (!c) c = v; else if (v !== c) mixed = true;
        }
      }
      if (!mixed && c) for (const k of hole) fills.push([k, c]);
    }
    for (const [k, c] of fills) bits[k] = c;
  }

  // 8-connected components, matching the outline rule where diagonal contact joins shapes.
  function components(F) {
    const { GW, GH, wrap, bits } = F;
    const labels = new Int32Array(GW * GH);
    const sizes = [0];
    const stack = [];
    let count = 0;
    for (let s = 0; s < bits.length; s++) {
      if (!bits[s] || labels[s]) continue;
      labels[s] = ++count;
      sizes.push(0);
      stack.push(s);
      while (stack.length) {
        const k = stack.pop();
        sizes[count]++;
        const x = k % GW, y = (k - x) / GW;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            let nx = x + dx, ny = y + dy;
            if (wrap) { nx = mod(nx, GW); ny = mod(ny, GH); }
            else if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const n = ny * GW + nx;
            if (bits[n] && !labels[n]) { labels[n] = count; stack.push(n); }
          }
        }
      }
    }
    return { labels, count, sizes };
  }

  function generate(options) {
    const p = Object.assign({}, DEFAULTS, options);
    const W = p.cols * CELL, H = p.rows * CELL;
    const F = makeField(W, H, p.edges);
    (GENERATORS[p.mode] || fieldMode)(F, p, p.seed);
    if (p.pinholes) fillPinholes(F);

    // Small whole shapes switch to the accent colour, the way the A does in the logo.
    // Big shapes never do, or the whole texture would seem to change colour.
    const { labels, count, sizes } = components(F);
    const k = p.mode === 'glyphs' ? Math.min(3, Math.max(1, Math.round(p.glyphSize))) : 1;
    const cap = 8 * CELL * CELL * k * k;
    const rng = rngFor(p.seed, 9);
    const isAccent = new Uint8Array(count + 1);
    for (let c = 1; c <= count; c++) isAccent[c] = sizes[c] <= cap && rng() < p.accent ? 1 : 0;

    // Seamless tiles are traced with a wrapped cell of padding, then clipped to the frame.
    // `tiles` > 1 traces several repeats as one piece, so a repeat preview has no seams.
    const reps = F.wrap ? Math.max(1, Math.round(p.tiles)) : 1;
    const pad = F.wrap ? CELL : 0;
    const TW = F.GW * reps + 2 * pad, TH = F.GH * reps + 2 * pad;
    const base = new Uint8Array(TW * TH), accent = new Uint8Array(TW * TH);
    for (let j = 0; j < TH; j++) {
      for (let i = 0; i < TW; i++) {
        const gx = F.wrap ? mod(i - pad, F.GW) : i;
        const gy = F.wrap ? mod(j - pad, F.GH) : j;
        const l = labels[gy * F.GW + gx];
        if (l) (isAccent[l] ? accent : base)[j * TW + i] = 1;
      }
    }
    const seen = new Set();
    let filled = 0;
    for (let y = F.M; y < F.M + F.H; y++) {
      for (let x = F.M; x < F.M + F.W; x++) {
        const l = labels[y * F.GW + x];
        if (l) { filled++; seen.add(l); }
      }
    }

    // Output coordinates are in half cells, with `scale` applied.
    const S = p.scale / 2, r = p.radius * CELL, off = -(F.M + pad) * S;
    return {
      W: p.cols * 2, H: p.rows * 2, scale: p.scale,
      base: Geo.traceBitmap(base, TW, TH, r, { scale: S, ox: off, oy: off }),
      accent: Geo.traceBitmap(accent, TW, TH, r, { scale: S, ox: off, oy: off }),
      blank: 1 - filled / (W * H),
      shapes: seen.size,
      field: p.debug ? F : undefined,
    };
  }

  let uid = 0;
  function toSVG(res, colors, opts) {
    const transparent = opts && opts.transparent;
    const w = res.W * res.scale, h = res.H * res.scale;
    const id = 'lina-frame-' + (++uid);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
      `  <defs><clipPath id="${id}"><rect width="${w}" height="${h}"/></clipPath></defs>\n` +
      (transparent ? '' : `  <rect width="${w}" height="${h}" fill="${colors.bg}"/>\n`) +
      `  <g clip-path="url(#${id})">\n` +
      `    <path fill="${colors.fg}" fill-rule="evenodd" d="${res.base}"/>\n` +
      (res.accent ? `    <path fill="${colors.accent}" fill-rule="evenodd" d="${res.accent}"/>\n` : '') +
      `  </g>\n</svg>\n`;
  }

  root.LinaTexture = { generate, toSVG, PALETTES, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
