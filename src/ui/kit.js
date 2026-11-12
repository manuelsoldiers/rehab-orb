// Immediate-mode drawing kit for the panel. A view draws on two canvases:
//   chrome – card, labels, buttons (always visible)
//   data   – the "ink" of the chart (materialises from particles)
// and registers the regions the pointer can hit.
export const W = 1280;            // canvas width in px; the panel is PANEL_W metres wide
export const TOP = 64;            // strip above the card that holds the Menu / Pin / Close pills
export const PAD = 48;
export const INSET = 12;          // the card sits inside the canvas, so its glowing edge is not cut off

export const C = {
  // Hologram surfaces: you see the room through them. Text stays readable thanks to its own shadow.
  card: 'rgba(6, 20, 38, 0.56)',
  drawer: 'rgba(8, 26, 48, 0.56)',
  edge: 'rgba(120, 205, 255, 0.62)',
  glow: 'rgba(80, 185, 255, 0.60)',
  tile: 'rgba(24, 62, 104, 0.36)',
  pill: 'rgba(14, 42, 74, 0.52)',
  pillEdge: 'rgba(140, 205, 255, 0.42)',
  pillHover: 'rgba(40, 104, 168, 0.68)',
  shadow: 'rgba(1, 8, 18, 0.85)',
  text: '#f4f7fb',
  dim: '#b3c3d8',
  faint: '#8b9db6',
  grid: 'rgba(170, 205, 240, 0.34)',
  cyan: '#67c9ff',
  amber: '#ffc552',
  red: '#ff7062',
  green: '#55e0a8',
  ink: '#ffffff',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Kit {
  constructor() { this.regions = []; this.hover = null; }

  begin(chrome, data, height, hover) {
    this.c = chrome; this.d = data; this.H = height; this.hover = hover; this.regions = [];
    // Clear the whole canvas, not just the visible part: a shorter view must not leave the old one below it.
    chrome.clearRect(0, 0, W, chrome.canvas.height);
    data.clearRect(0, 0, W, data.canvas.height);
  }

  isHover(id) { return !!this.hover && this.hover.id === id; }

  // ---- text -------------------------------------------------------------
  font(ctx, size, weight = 500) { ctx.font = `${weight} ${size}px ${FONT}`; }

  text(ctx, s, x, y, o = {}) {
    const { size = 28, weight = 500, color = C.text, align = 'left', spacing = 0, upper = false } = o;
    this.font(ctx, size, weight);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    const str = upper ? String(s).toUpperCase() : String(s);
    if (!o.flat) { ctx.shadowColor = C.shadow; ctx.shadowBlur = Math.max(4, size * 0.22); }
    ctx.fillText(str, x, y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    const w = ctx.measureText(str).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return w;
  }

  lines(ctx, s, maxW, size, weight = 500) {
    this.font(ctx, size, weight);
    const out = [];
    for (const para of String(s).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const probe = line ? `${line} ${word}` : word;
        if (ctx.measureText(probe).width > maxW && line) { out.push(line); line = word; } else line = probe;
      }
      out.push(line);
    }
    return out;
  }

  // Draws wrapped text; returns the y of the baseline after the last line.
  wrap(ctx, s, x, y, maxW, o = {}) {
    const { size = 30, weight = 500, lh = Math.round(size * 1.34) } = o;
    for (const line of this.lines(ctx, s, maxW, size, weight)) { this.text(ctx, line, x, y, o); y += lh; }
    return y;
  }

  wrapHeight(s, maxW, size = 30, lh = Math.round(size * 1.34)) {
    return this.lines(this.c, s, maxW, size).length * lh;
  }

  // ---- surfaces ---------------------------------------------------------
  card(y0, y1, fill = C.card) {
    const c = this.c;
    rr(c, INSET, y0, W - 2 * INSET, y1 - y0, 30);
    c.fillStyle = fill; c.fill();
    c.shadowColor = C.glow; c.shadowBlur = 16;                 // the edge is light, and it spills a little
    c.strokeStyle = C.edge; c.lineWidth = 2.5; c.stroke();
    c.shadowColor = 'transparent'; c.shadowBlur = 0;
  }

  // ---- interactive ------------------------------------------------------
  region(id, x, y, w, h, extra = {}) {
    const r = { id, x, y, w, h, ...extra };
    this.regions.push(r);
    return r;
  }

  hit(x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      if (r.resolve) { const t = r.resolve(x, y); if (t) return t; continue; }
      return r;
    }
    return null;
  }

  chip(label, x, y, w, h, id, o = {}) {
    const { active = false, accent = C.cyan, size = 26, extra } = o;
    const c = this.c, hot = this.isHover(id);
    rr(c, x, y, w, h, Math.min(h / 2, 26));
    c.globalAlpha = active ? 0.86 : 1;
    c.fillStyle = active ? accent : (hot ? C.pillHover : C.pill);
    c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = active ? accent : (hot ? accent : C.pillEdge); c.lineWidth = 2; c.stroke();
    this.text(c, label, x + w / 2, y + h / 2 + size * 0.35, {
      size, weight: 600, align: 'center', color: active ? '#04101c' : C.text, flat: active,
    });
    this.region(id, x, y, w, h, { kind: 'chip', ...extra });
  }

  // A row of chips laid out left to right; widths are proportional to `flex`.
  chips(y, h, items, o = {}) {
    const gap = 16, x0 = o.x ?? PAD, total = (o.w ?? W - 2 * PAD) - gap * (items.length - 1);
    const sum = items.reduce((a, it) => a + (it.flex ?? 1), 0);
    let x = x0;
    for (const it of items) {
      const w = total * (it.flex ?? 1) / sum;
      this.chip(it.label, x, y, w, h, it.id, it);
      x += w + gap;
    }
  }

  // ---- shared frame -----------------------------------------------------
  // Pills above the card + card body + title block. Returns nothing; views draw below y = 200.
  frame({ title, sub, value, delta, deltaColor = C.cyan, cardBottom, pinned, home = true }) {
    const c = this.c;
    if (home) this.chip('‹ Menu', INSET, 6, 132, 46, 'menu', { size: 22 });
    this.chip(pinned ? 'Pinned' : 'Pin', W - INSET - 256, 6, 120, 46, 'pin', { size: 22, active: pinned });
    this.chip('Close', W - INSET - 124, 6, 124, 46, 'close', { size: 22 });
    this.card(TOP, cardBottom);
    this.text(c, title, PAD, TOP + 78, { size: 54, weight: 700, upper: true });
    if (sub) this.text(c, sub, PAD + 2, TOP + 112, { size: 21, color: C.dim, spacing: 2.5, upper: true });
    if (value) this.text(c, value, W - PAD, TOP + 76, { size: 52, weight: 600, align: 'right' });
    if (delta) this.text(c, delta, W - PAD, TOP + 112, { size: 25, weight: 600, color: deltaColor, align: 'right' });
  }

  // A drawer hangs under the card: heading in small caps, body wrapped. Returns its bottom y.
  drawer(y, { head, body, src }) {
    const c = this.c, maxW = W - 2 * PAD;
    const bodyH = this.wrapHeight(body, maxW, 30);
    const h = 30 + 30 + 14 + bodyH + (src ? 36 : 4) + 18;
    this.card(y, y + h, C.drawer);
    this.text(c, head, PAD, y + 48, { size: 22, weight: 700, color: C.dim, spacing: 2, upper: true });
    const end = this.wrap(c, body, PAD, y + 92, maxW, { size: 30 });
    if (src) this.text(c, src, PAD, end + 6, { size: 21, color: C.cyan });
    return y + h;
  }

  drawerHeight({ body, src }) {
    return 30 + 30 + 14 + this.wrapHeight(body, W - 2 * PAD, 30) + (src ? 36 : 4) + 18;
  }

  footer(y, s) { this.text(this.c, s, PAD, y, { size: 21, color: C.faint }); }

  // ---- chart ------------------------------------------------------------
  // Draws the dotted grid and tick labels on chrome and returns the scale functions.
  chart({ x, y, w, h, xmin, xmax, ymin, ymax, xticks = [], yticks = [] }) {
    const c = this.c;
    const sx = (v) => x + (v - xmin) / (xmax - xmin) * w;
    const sy = (v) => y + h - (v - ymin) / (ymax - ymin) * h;
    c.save();
    c.strokeStyle = C.grid; c.lineWidth = 2; c.setLineDash([3, 9]);
    for (const t of yticks) {
      c.beginPath(); c.moveTo(x, sy(t.v)); c.lineTo(x + w, sy(t.v)); c.stroke();
    }
    for (const t of xticks) {
      c.beginPath(); c.moveTo(sx(t.v), y); c.lineTo(sx(t.v), y + h); c.stroke();
    }
    c.restore();
    for (const t of yticks) this.text(c, t.label, x - 12, sy(t.v) + 7, { size: 20, color: C.dim, align: 'right' });
    for (const t of xticks) this.text(c, t.label, sx(t.v), y + h + 30, { size: 20, color: C.dim, align: 'center' });
    return { sx, sy, x, y, w, h };
  }

  // Pointer crosshair on the data layer: vertical hairline, diamond, read-out (as in the reference reel).
  crosshair(px, py, top, bottom, label) {
    const d = this.d;
    d.save();
    d.strokeStyle = C.amber; d.lineWidth = 2;
    d.beginPath(); d.moveTo(px, top); d.lineTo(px, bottom); d.stroke();
    d.translate(px, py); d.rotate(Math.PI / 4);
    d.fillStyle = C.amber; d.fillRect(-8, -8, 16, 16);
    d.restore();
    if (label) {
      this.font(d, 24, 700);
      const tw = d.measureText(label).width;
      const lx = Math.min(Math.max(px - tw / 2, PAD), W - PAD - tw);
      this.text(d, label, lx, bottom + 62, { size: 24, weight: 700 });
    }
  }
}

export { rr as roundRect };
