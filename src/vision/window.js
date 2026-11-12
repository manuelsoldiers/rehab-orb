// Finding and following a window in a camera frame. Pure functions on a small greyscale image
// (about 320 px wide), so they run on any phone and can be tested without a browser.
//
// A window seen from inside by day is the easy case this is built for: a large, bright quadrilateral
// in a darker room. Corners are always [topLeft, topRight, bottomRight, bottomLeft], in image pixels.

export function toLuma(rgba, out = new Uint8ClampedArray(rgba.length >> 2)) {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}

// Otsu's threshold, plus the mean of each side of it.
export function otsu(lum) {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  let total = 0; for (let v = 0; v < 256; v++) total += v * hist[v];
  let wB = 0, sumB = 0, best = -1, t = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = lum.length - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (total - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = v; }
  }
  let lo = 0, nLo = 0, hi = 0, nHi = 0;
  for (let v = 0; v < 256; v++) { if (v <= t) { lo += v * hist[v]; nLo += hist[v]; } else { hi += v * hist[v]; nHi += hist[v]; } }
  return { t, dark: nLo ? lo / nLo : 0, bright: nHi ? hi / nHi : 255 };
}

function quadArea(c) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

export function isConvex(c) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

// The bright region under (or next to) the tapped point, as a quadrilateral.
// Returns { corners, fill, area } or null when the tap is not on a window-like bright area.
export function findWindow(lum, w, h, tapX, tapY) {
  const o = otsu(lum);
  if (o.bright - o.dark < 40) return null;                  // flat lighting: nothing stands out
  const T = o.t + 0.3 * (o.bright - o.t);                    // lean towards the bright side: frames are not glass
  const n = w * h, bright = (i) => lum[i] > T;

  // Label the bright areas (4-connected), with their extent.
  const label = new Int32Array(n), comps = [null];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (label[s] || !bright(s)) continue;
    const id = comps.length, c = { id, area: 0, x0: w, x1: 0, y0: h, y1: 0 };
    let top = 0; stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top], x = i % w, y = (i / w) | 0;
      c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && !label[i - 1] && bright(i - 1)) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && !label[i + 1] && bright(i + 1)) { label[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && !label[i - w] && bright(i - w)) { label[i - w] = id; stack[top++] = i - w; }
      if (y < h - 1 && !label[i + w] && bright(i + w)) { label[i + w] = id; stack[top++] = i + w; }
    }
    comps.push(c);
  }

  // The tap may land on a tree or a building seen through the glass: take the nearest bright area.
  const tx = Math.round(tapX), ty = Math.round(tapY), R = Math.round(w * 0.08);
  let seed = 0, bestD = Infinity;
  for (let y = Math.max(0, ty - R); y <= Math.min(h - 1, ty + R); y++) {
    for (let x = Math.max(0, tx - R); x <= Math.min(w - 1, tx + R); x++) {
      const id = label[y * w + x]; if (!id || comps[id].area < n * 0.01) continue;
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bestD) { bestD = d; seed = id; }
    }
  }
  if (!seed) return null;

  // A window is often several panes: join bright areas that stand side by side at the same height.
  const set = new Set([seed]);
  const box = { ...comps[seed] };
  for (let grew = true; grew;) {
    grew = false;
    for (const c of comps) {
      if (!c || set.has(c.id) || c.area < comps[seed].area * 0.15) continue;
      const hS = box.y1 - box.y0, hC = c.y1 - c.y0;
      const overlap = Math.min(box.y1, c.y1) - Math.max(box.y0, c.y0);
      const gap = Math.max(c.x0 - box.x1, box.x0 - c.x1);
      if (overlap < 0.6 * Math.min(hS, hC) || gap > w * 0.06) continue;
      if (Math.abs(c.y0 - box.y0) > 0.3 * hS || Math.abs(c.y1 - box.y1) > 0.3 * hS) continue;
      set.add(c.id); grew = true;
      box.x0 = Math.min(box.x0, c.x0); box.x1 = Math.max(box.x1, c.x1); box.y0 = Math.min(box.y0, c.y0); box.y1 = Math.max(box.y1, c.y1);
    }
  }
  if (box.x1 - box.x0 < w * 0.1 || box.y1 - box.y0 < 6) return null;

  // That band is usually only the sky. The glass goes on above and below it (a balcony, roofs, a
  // garden), and what tells us how far is the frame: follow the left and the right edge of the glass
  // up and down, row by row, for as long as the inside stays clearly brighter than the frame.
  const left = traceSide(lum, w, h, box, -1), right = traceSide(lum, w, h, box, +1);
  if (!left || !right) return null;
  // Furniture or a curtain can hide part of one side, so the longer of the two decides how far to look.
  const at = (side, y) => side.line.a * y + side.line.b;       // x of the side at row y
  // The sides can run on past the glass (a window lights the floor in its own shape). Where the glass
  // really ends there is a long horizontal edge from side to side, bright within and darker beyond:
  // take the outermost such edge, and fall back on the sides if there is none.
  const span = (y) => [at(left, y), at(right, y)];
  const yT = crossEdge(lum, w, h, span, box.y0, Math.max(0, Math.min(left.top, right.top) - 4), -1) ?? Math.min(left.top, right.top);
  const yB = crossEdge(lum, w, h, span, box.y1, Math.min(h - 1, Math.max(left.bottom, right.bottom) + 4), +1) ?? Math.min(left.bottom, right.bottom);
  const corners = [[at(left, yT), yT], [at(right, yT), yT], [at(right, yB), yB], [at(left, yB), yB]];
  const qa = quadArea(corners);
  if (!isConvex(corners) || qa < n * 0.05 || qa > n * 0.94 || yB - yT < h * 0.08) return null;
  return { corners, area: qa / n };
}

// The outermost row between `from` and `to` (walking in direction `step`) where most of the width
// between the two sides steps from bright (towards the middle of the window) to darker (beyond).
function crossEdge(lum, w, h, span, from, to, step) {
  let found = null;
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) {
    const yi = y - step * 2, yo = y + step * 2;
    if (yi < 0 || yo < 0 || yi >= h || yo >= h) continue;
    const [xl, xr] = span(y), m = (xr - xl) * 0.08;
    let total = 0, hits = 0;
    for (let x = Math.ceil(xl + m); x <= xr - m; x++) {
      if (x < 0 || x >= w) continue;
      total++;
      if (lum[yi * w + x] - lum[yo * w + x] >= 30) hits++;
    }
    if (total > 10 && hits / total >= 0.55) found = y;
  }
  return found;
}

const mean = (lum, w, y, x0, x1) => { let s = 0; for (let x = x0; x <= x1; x++) s += lum[y * w + x]; return s / (x1 - x0 + 1); };

// Follow one side of the glass. dir = −1 for the left side (the frame is on its left), +1 for the right.
// Returns { top, bottom, line: x = a·y + b } or null.
function traceSide(lum, w, h, box, dir) {
  const x0 = dir < 0 ? box.x0 : box.x1;
  // Contrast between just inside and just outside the edge at column x, row y (positive: inside brighter).
  const contrast = (x, y) => {
    const xi = Math.round(x);
    const inA = xi - dir * 2, inB = xi - dir * 5, outA = xi + dir * 2, outB = xi + dir * 5;
    const lo = Math.min(inA, inB, outA, outB), hi = Math.max(inA, inB, outA, outB);
    if (lo < 0 || hi >= w) return -1;
    return mean(lum, w, y, Math.min(inA, inB), Math.max(inA, inB)) - mean(lum, w, y, Math.min(outA, outB), Math.max(outA, outB));
  };
  // The edge's own strength, measured where we are sure of it: inside the bright band.
  const ref = [];
  for (let y = box.y0; y <= box.y1; y++) { let best = 0; for (let d = -3; d <= 3; d++) best = Math.max(best, contrast(x0 + d, y)); ref.push(best); }
  ref.sort((p, q) => p - q);
  const typical = ref[ref.length >> 1];
  if (typical < 25) return null;
  // Well under half its usual strength still counts as the edge: an awning or a balcony ceiling behind the
  // top of the glass is much dimmer than sky. (The sides may then run on along the window's reflection
  // on the floor, which has the same sides, only fainter: the horizontal edge below settles where it ends.)
  const need = Math.max(22, typical * 0.42), maxGap = Math.round(h * 0.09);

  const pts = [];
  const walk = (from, step) => {
    let x = x0, gap = 0, last = from;
    for (let y = from; y >= 0 && y < h; y += step) {
      let best = -1, bx = x;
      for (let d = -2; d <= 2; d++) { const c = contrast(x + d, y); if (c > best) { best = c; bx = x + d; } }
      if (best >= need) { x = bx; gap = 0; last = y; pts.push([x, y]); } else if (++gap > maxGap) break;
    }
    return last;
  };
  const mid = (box.y0 + box.y1) >> 1;
  const top = walk(mid, -1), bottom = walk(mid + 1, +1);
  if (pts.length < 8) return null;
  // x = a·y + b by least squares, once more without the outliers.
  const fit = (list) => {
    let sy = 0, sx = 0, syy = 0, sxy = 0; const m = list.length;
    for (const [x, y] of list) { sy += y; sx += x; syy += y * y; sxy += x * y; }
    const den = m * syy - sy * sy, a = Math.abs(den) < 1e-9 ? 0 : (m * sxy - sy * sx) / den;
    return { a, b: (sx - a * sy) / m };
  };
  let line = fit(pts);
  const kept = pts.filter(([x, y]) => Math.abs(x - (line.a * y + line.b)) < 2.5);
  if (kept.length >= 8) line = fit(kept);
  return { top, bottom, line };
}

function sample(lum, w, h, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : lum[yi * w + xi];
}

// Keep a quadrilateral on the window from one frame to the next. Each side looks for the edge it sat
// on, a few pixels either way along its normal, and moves by the median of what it finds. The left and
// right sides measure their two halves separately, so they can also tilt a little. A side that finds nothing (it
// is hidden, or out of the picture) stays where the prediction put it.
// `polarity[i]` is the sign of (outside − inside) brightness on side i; pass 0 to learn it.
export function trackQuad(lum, w, h, corners, { radius = 4, polarity = [0, 0, 0, 0], minStep = 14, samples = 24 } = {}) {
  const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
  const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
  const median = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const sides = [], pol = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let nx = dy / len, ny = -dx / len;                       // normal, made to point away from the centre
    if ((a[0] + dx / 2 - cx) * nx + (a[1] + dy / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const half = [[], []], steps = []; let signSum = 0;
    for (let k = 0; k < samples; k++) {
      const t = 0.08 + 0.84 * (k / (samples - 1)), px = a[0] + dx * t, py = a[1] + dy * t;
      let bestS = null, bestG = 0, bestSign = 0, bestDiff = 0;
      const diffs = [];
      for (let s = -radius; s <= radius; s++) {
        const out = sample(lum, w, h, px + (s + 1.5) * nx, py + (s + 1.5) * ny);
        const inn = sample(lum, w, h, px + (s - 1.5) * nx, py + (s - 1.5) * ny);
        const diff = out < 0 || inn < 0 ? 0 : out - inn, sign = Math.sign(diff);
        diffs.push(polarity[e] && sign !== polarity[e] ? 0 : diff);
        const mag = Math.abs(diffs[diffs.length - 1]);
        const g = mag * (1 - 0.5 * (s / radius) ** 2);               // prefer the edge nearest to where we expect it
        if (mag >= minStep && g > bestG) { bestG = g; bestS = s; bestSign = sign; bestDiff = mag; }
      }
      if (bestS !== null) {
        // A sharp edge reads the same over three samples; its place is the middle of that run.
        let lo = bestS, hi = bestS;
        const same = (s) => s >= -radius && s <= radius && Math.sign(diffs[s + radius]) === bestSign && Math.abs(diffs[s + radius]) >= 0.8 * bestDiff;
        while (same(lo - 1)) lo--;
        while (same(hi + 1)) hi++;
        half[t < 0.5 ? 0 : 1].push((lo + hi) / 2); steps.push(bestDiff); signSum += bestSign;
      }
    }
    // A side is believed only if most of it shows a clear step. A faint or patchy one would wander.
    const all = half[0].concat(half[1]).sort((p, q) => p - q);
    // For top and bottom there is one more condition: the samples must agree on one line. Two leaves
    // with frames of different heights, or an awning behind the glass, give two; then it is better to
    // let that side ride with the opposite one than to have it hop between them.
    const spread = all.length ? all[Math.floor(all.length * 0.8)] - all[Math.floor(all.length * 0.2)] : 0;
    const sure = all.length >= samples * 0.5 && median(steps) >= 24 && (e % 2 === 1 || spread <= 3);
    let oA = 0, oB = 0;
    if (sure && e % 2 === 0) {
      // Top and bottom only slide, they never tilt: a window's horizontal edges are rarely one clean
      // line (two leaves with different frames, a sill, a blind), and each half would follow its own.
      oA = oB = median(all);
    } else if (sure) {                                       // the sides may tilt, gently
      oA = half[0].length >= 4 ? median(half[0]) : median(all);
      oB = half[1].length >= 4 ? median(half[1]) : median(all);
      if (Math.abs(oA - oB) > 2) { const m = (oA + oB) / 2, d = Math.sign(oA - oB); oA = m + d; oB = m - d; }
    }
    sides.push({ a, b, nx, ny, oA, oB, sure });
    pol.push(sure ? (Math.sign(signSum) || polarity[e]) : polarity[e]);
  }
  // A side that could not be seen moves with the one facing it: the window is rigid, so if the
  // bottom went down two pixels the top did too. (Their normals point opposite ways.)
  for (let e = 0; e < 4; e++) {
    const me = sides[e], other = sides[(e + 2) % 4];
    if (!me.sure && other.sure) { const o = -(other.oA + other.oB) / 2; me.oA = o; me.oB = o; }
  }
  const lines = sides.map((s) => lineThrough([s.a[0] + s.oA * s.nx, s.a[1] + s.oA * s.ny], [s.b[0] + s.oB * s.nx, s.b[1] + s.oB * s.ny]));
  const out = [];
  for (let e = 0; e < 4; e++) out.push(intersect(lines[(e + 3) % 4], lines[e]) || corners[e].slice());   // corner e joins sides e−1 and e
  const found = sides.map((s) => s.sure);
  const ok = isConvex(out) && found.some(Boolean);
  return { corners: ok ? out : corners.map((c) => c.slice()), found, polarity: pol, ok };
}

// Is the window brighter than the wall around it (day: −1 on every side) or darker (night, lights on
// inside: +1)? The tracker uses it to tell the glass edge from the other edges of a frame.
export function quadPolarity(lum, w, h, corners) {
  const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
  const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
  let inside = 0, nIn = 0, outside = 0, nOut = 0;
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    for (let k = 1; k < 16; k++) {
      const x = a[0] + (b[0] - a[0]) * k / 16, y = a[1] + (b[1] - a[1]) * k / 16;
      const vi = sample(lum, w, h, x + (cx - x) * 0.12, y + (cy - y) * 0.12);
      const vo = sample(lum, w, h, x - (cx - x) * 0.07, y - (cy - y) * 0.07);
      if (vi >= 0) { inside += vi; nIn++; }
      if (vo >= 0) { outside += vo; nOut++; }
    }
  }
  if (!nIn || !nOut) return [-1, -1, -1, -1];
  const d = outside / nOut - inside / nIn, s = Math.abs(d) < 12 ? 0 : Math.sign(d);
  return [s, s, s, s];
}

function lineThrough(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
  return { x: p[0], y: p[1], nx: -dy / len, ny: dx / len };
}

function intersect(l1, l2) {
  const c1 = l1.nx * l1.x + l1.ny * l1.y, c2 = l2.nx * l2.x + l2.ny * l2.y;
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 1e-6) return null;
  return [(c1 * l2.ny - c2 * l1.ny) / det, (l1.nx * c2 - l2.nx * c1) / det];
}

// The homography that takes the unit square (u right, v down) onto four points, as [a,b,c,d,e,f,g,h]:
//   x = (a·u + b·v + c) / (g·u + h·v + 1),  y = (d·u + e·v + f) / (g·u + h·v + 1)
export function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dy1 * dx2;
  let g = 0, hh = 0;
  if (Math.abs(den) > 1e-12 && (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12)) {
    g = (sx * dy2 - sy * dx2) / den; hh = (dx1 * sy - dy1 * sx) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
}
