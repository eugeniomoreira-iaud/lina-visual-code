/*
  LINA geometry: the one rule every LINA tool draws with.

  Units: 1 unit = half a cell, so a cell is 2×2 units.
  A shape is a bitmap on the unit grid. Its outline is traced with diagonal
  contacts treated as connected, then every corner gets an arc of radius r
  (¼ cell = 0.5 unit in the logo). Convex corners round, concave corners fillet.
*/
(function (root) {
  'use strict';

  // The wordmark letters as blocks [x, y, size] in units.
  const LETTERS = {
    L: { w: 4, blocks: [[0, 0, 2], [0, 2, 2], [2, 4, 2]] },
    I: { w: 2, blocks: [[0, 0, 2], [0, 2, 2], [0, 4, 2]] },
    n: { w: 5, blocks: [[0, 3, 2], [0, 4, 2], [2, 1, 2], [3, 1, 2], [3, 3, 2], [3, 4, 2]] },
    // The crossbar between the counter and the notch is a half cell.
    A: { w: 5, blocks: [[0, 0, 2], [0, 2, 2], [0, 4, 2], [1, 0, 2], [3, 2, 2], [3, 4, 2], [2, 4, 1]] },
  };
  // The logo spaces its letters ¼ cell apart, which is off the unit grid.
  const LETTER_GAP = 0.5;

  const fmt = (v) => Math.round(v * 1000) / 1000;

  function traceBitmap(bits, w, h, r, opts) {
    const scale = (opts && opts.scale) || 1;
    const ox = (opts && opts.ox) || 0;
    const oy = (opts && opts.oy) || 0;
    const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && bits[j * w + i] === 1;

    // Directed unit edges with the solid on the right-hand side (y points down).
    // A vertex has two outgoing edges only at a diagonal contact.
    const VW = w + 1;
    const out = new Int32Array(VW * (h + 1) * 2).fill(-1);
    const ex = [], ey = [], edx = [], edy = [];
    const add = (x0, y0, dx, dy) => {
      const id = ex.length;
      ex.push(x0); ey.push(y0); edx.push(dx); edy.push(dy);
      const v = (y0 * VW + x0) * 2;
      if (out[v] < 0) out[v] = id; else out[v + 1] = id;
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (bits[j * w + i] !== 1) continue;
        if (!on(i, j - 1)) add(i, j, 1, 0);
        if (!on(i + 1, j)) add(i + 1, j, 0, 1);
        if (!on(i, j + 1)) add(i + 1, j + 1, -1, 0);
        if (!on(i - 1, j)) add(i, j + 1, 0, -1);
      }
    }

    // At a diagonal contact, turning left keeps the two solids joined,
    // which produces the neck with a fillet on each side.
    const next = (e) => {
      const v = ((ey[e] + edy[e]) * VW + ex[e] + edx[e]) * 2;
      const a = out[v], b = out[v + 1];
      if (b < 0) return a;
      return edx[a] === edy[e] && edy[a] === -edx[e] ? a : b;
    };

    const P = (x, y) => fmt(x * scale + ox) + ' ' + fmt(y * scale + oy);
    const rs = fmt(r * scale);
    const used = new Uint8Array(ex.length);
    const parts = [];
    for (let s = 0; s < ex.length; s++) {
      if (used[s]) continue;
      const loop = [];
      let e = s;
      do { used[e] = 1; loop.push(e); e = next(e); } while (e !== s);

      let d = '';
      for (let k = 0; k < loop.length; k++) {
        const c = loop[k], p = loop[(k + loop.length - 1) % loop.length];
        if (edx[p] === edx[c] && edy[p] === edy[c]) continue;
        const cx = ex[c], cy = ey[c];
        const sweep = edx[p] * edy[c] - edy[p] * edx[c] > 0 ? 1 : 0;
        d += (d ? 'L' : 'M') + P(cx - edx[p] * r, cy - edy[p] * r);
        if (r > 0) d += 'A' + rs + ' ' + rs + ' 0 0 ' + sweep + ' ' + P(cx + edx[c] * r, cy + edy[c] * r);
      }
      parts.push(d + 'Z');
    }
    return parts.join('');
  }

  // blocks: [{x, y, s}] or [[x, y, s]] in units.
  function blocksToBitmap(blocks) {
    const list = blocks.map((b) => (Array.isArray(b) ? { x: b[0], y: b[1], s: b[2] } : b));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of list) {
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.s); maxY = Math.max(maxY, b.y + b.s);
    }
    const w = maxX - minX, h = maxY - minY;
    const bits = new Uint8Array(Math.max(0, w * h));
    for (const b of list)
      for (let j = 0; j < b.s; j++)
        for (let i = 0; i < b.s; i++) bits[(b.y - minY + j) * w + (b.x - minX + i)] = 1;
    return { bits, w, h, minX, minY };
  }

  // Output coordinates are (x * scale + ox, y * scale + oy) for unit coordinates x, y.
  function outlinePath(blocks, r, scale = 1, ox = 0, oy = 0) {
    if (!blocks.length) return '';
    const { bits, w, h, minX, minY } = blocksToBitmap(blocks);
    return traceBitmap(bits, w, h, r, { scale, ox: minX * scale + ox, oy: minY * scale + oy });
  }

  // The wordmark with its true ¼-cell letter spacing. Width 17.5 units, height 6.
  function wordmark(r = 0.5, scale = 1) {
    let x = 0;
    return ['L', 'I', 'n', 'A'].map((k) => {
      const d = outlinePath(LETTERS[k].blocks, r, scale, x * scale, 0);
      x += LETTERS[k].w + LETTER_GAP;
      return { letter: k, d };
    });
  }

  root.LinaGeometry = { LETTERS, LETTER_GAP, traceBitmap, blocksToBitmap, outlinePath, wordmark };
})(typeof window !== 'undefined' ? window : globalThis);
