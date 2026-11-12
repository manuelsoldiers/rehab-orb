import test from 'node:test';
import assert from 'node:assert/strict';
import { findWindow, trackQuad, quadPolarity, squareToQuad, otsu } from '../src/vision/window.js';

// A room seen from inside, 320×180: grey walls, a two-leaf window with daylight behind it, a band of
// dark roofs across the view, the window's own reflection on the floor, and a white fridge beside it.
const W = 320, H = 180, GLASS = { x0: 60, x1: 260, y0: 12, y1: 150 };
function room({ dx = 0, dy = 0 } = {}) {
  const lum = new Uint8ClampedArray(W * H).fill(90);
  const rect = (x0, y0, x1, y1, v) => { for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) lum[y * W + x] = v; };
  const g = { x0: GLASS.x0 + dx, x1: GLASS.x1 + dx, y0: GLASS.y0 + dy, y1: GLASS.y1 + dy };
  rect(g.x0, g.y0, g.x1, g.y1, 232);                       // sky
  rect(g.x0, g.y0, g.x1, g.y0 + 22, 160);                  // an awning under the top of the frame
  rect(g.x0, g.y0 + 76, g.x1, g.y0 + 87, 118);             // roofs
  rect(g.x0, g.y0 + 88, g.x1, g.y1, 198);                  // a balcony
  rect(g.x0 + 116, g.y0, g.x0 + 123, g.y1, 82);            // the post between the two leaves
  rect(g.x0 - 4, g.y1 + 12, g.x1 + 6, H - 1, 150);         // the window lighting the floor
  rect(284, 60, 319, 170, 205);                            // a fridge
  return { lum, glass: g };
}
const near = (corners, g, tol) => {
  const want = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]];
  corners.forEach((c, i) => { assert.ok(Math.abs(c[0] - want[i][0]) <= tol && Math.abs(c[1] - want[i][1]) <= tol, `corner ${i}: ${c.map((v) => v.toFixed(1))} vs ${want[i]}`); });
};

test('the scene has two clear levels of light', () => {
  const o = otsu(room().lum);
  assert.ok(o.bright - o.dark > 60);
});

test('a tap on the glass finds the whole window, not just the patch of sky', () => {
  const { lum, glass } = room();
  for (const [x, y] of [[100, 50], [220, 60], [120, 95]]) {   // left leaf, right leaf, on the dark roofs
    const f = findWindow(lum, W, H, x, y);
    assert.ok(f, `nothing found at ${x},${y}`);
    near(f.corners, glass, 4);
  }
});

test('the wall and the fridge are not windows', () => {
  const { lum } = room();
  assert.equal(findWindow(lum, W, H, 20, 60), null);
  assert.equal(findWindow(lum, W, H, 300, 100), null);
});

test('a flat, evenly lit view has no window', () => {
  assert.equal(findWindow(new Uint8ClampedArray(W * H).fill(120), W, H, 160, 90), null);
});

test('by day the window is brighter than the wall on every side', () => {
  const { lum, glass: g } = room();
  assert.deepEqual(quadPolarity(lum, W, H, [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]]), [-1, -1, -1, -1]);
});

test('tracking holds still on a still picture', () => {
  const { lum, glass: g } = room();
  let q = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]];
  for (let i = 0; i < 30; i++) q = trackQuad(lum, W, H, q, { polarity: [-1, -1, -1, -1] }).corners;
  near(q, g, 2.5);
});

test('tracking follows the window when the camera moves', () => {
  const start = room().glass;
  let q = [[start.x0, start.y0], [start.x1, start.y0], [start.x1, start.y1], [start.x0, start.y1]];
  let last;
  for (let step = 1; step <= 6; step++) {                  // 3 px right and 2 px down per frame
    last = room({ dx: step * 3, dy: step * 2 });
    q = trackQuad(last.lum, W, H, q, { polarity: [-1, -1, -1, -1] }).corners;
  }
  near(q, last.glass, 3);
});

test('a side that leaves the picture moves with the one facing it', () => {
  const { lum, glass: g } = room({ dx: 70 });             // the right edge of the glass is now off-screen
  const guess = [[g.x0 - 3, g.y0], [W + 10, g.y0], [W + 10, g.y1], [g.x0 - 3, g.y1]];
  const t = trackQuad(lum, W, H, guess, { polarity: [-1, -1, -1, -1] });
  assert.equal(t.found[1], false);
  assert.ok(Math.abs(t.corners[0][0] - g.x0) <= 1.5, 'left side should snap onto the glass');
  assert.ok(Math.abs((t.corners[1][0] - (W + 10)) - (t.corners[0][0] - (g.x0 - 3))) <= 1.5, 'right side should move by the same amount');
});

test('four points are the picture of the unit square', () => {
  const pts = [[-0.6, 0.7], [0.5, 0.8], [0.7, -0.5], [-0.5, -0.6]];
  const [a, b, c, d, e, f, g, h] = squareToQuad(pts);
  const map = (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => { const p = map(u, v); assert.ok(Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) < 1e-9); });
});
