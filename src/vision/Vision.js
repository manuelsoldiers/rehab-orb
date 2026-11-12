import { toLuma } from './window.js';

// The app's eye on the room: a small greyscale copy of whatever is shown behind the scene (the camera
// feed, or a photo), plus the mapping between its pixels and the screen. The picture fills the screen
// with object-fit: cover, so part of it may be cropped.
const WIDTH = 320;

export class Vision {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.source = null;
    this.w = 0; this.h = 0;
  }

  setSource(el) { this.source = el; }

  _natural() {
    const s = this.source; if (!s) return null;
    const w = s.videoWidth || s.naturalWidth || 0, h = s.videoHeight || s.naturalHeight || 0;
    return w && h ? { w, h } : null;
  }

  get ready() { return !!this._natural(); }

  // { lum, w, h } for the current frame, or null.
  grab() {
    const n = this._natural(); if (!n) return null;
    const w = WIDTH, h = Math.max(1, Math.round(n.h * WIDTH / n.w));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.lum = new Uint8ClampedArray(w * h); }
    this.w = w; this.h = h;
    try {
      this.ctx.drawImage(this.source, 0, 0, w, h);
      toLuma(this.ctx.getImageData(0, 0, w, h).data, this.lum);
    } catch { return null; }                       // a frame that is not ready yet
    return { lum: this.lum, w, h };
  }

  _cover() {
    const n = this._natural(); if (!n) return null;
    const scale = Math.max(innerWidth / n.w, innerHeight / n.h);
    return { k: (WIDTH / n.w) / scale, ox: (innerWidth - n.w * scale) / 2, oy: (innerHeight - n.h * scale) / 2 };
  }

  toAnalysis(sx, sy) { const c = this._cover(); return c ? [(sx - c.ox) * c.k, (sy - c.oy) * c.k] : null; }
  toScreen(ax, ay) { const c = this._cover(); return c ? [ax / c.k + c.ox, ay / c.k + c.oy] : null; }
}
