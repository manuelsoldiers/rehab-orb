import * as THREE from 'three';
import { FONT, C } from '../ui/kit.js';

// What the orb is saying, a few words at a time with the current word lit (karaoke captions).
// It lives in the scene, not in the DOM, so it is visible inside a headset too.
const CW = 1024, CH = 128, WIDTH = 0.62;

export class Caption {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW; this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, WIDTH * CH / CW),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }),
    );
    this.mesh.renderOrder = 25;
    this.words = []; this.starts = []; this.index = -1; this.t = 0; this.rate = 0; this.active = false;
    this._drawn = '';
  }

  // seconds: expected duration of the utterance (drives the highlight when no word events arrive).
  play(text, seconds) {
    this.words = text.split(/\s+/).filter(Boolean);
    this.starts = []; let pos = 0;
    for (const w of this.words) { const i = text.indexOf(w, pos); this.starts.push(i); pos = i + w.length; }
    this.t = 0; this.rate = this.words.length / Math.max(0.5, seconds); this.index = 0; this.active = true;
    this._draw();
  }

  // Word boundary reported by the synthesiser: resynchronise the highlight.
  sync(charIndex) {
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1] <= charIndex) i++;
    this.index = i; this.t = i / this.rate;
    this._draw();
  }

  stop() { this.active = false; }

  update(dt) {
    const m = this.mesh.material;
    m.opacity += ((this.active ? 1 : 0) - m.opacity) * (1 - Math.exp(-dt * 10));
    this.mesh.visible = m.opacity > 0.01;
    if (!this.active) return;
    this.t += dt;
    const i = Math.min(this.words.length - 1, Math.floor(this.t * this.rate));
    if (i > this.index) { this.index = i; this._draw(); }
  }

  _draw() {
    const CHUNK = 4, from = Math.floor(this.index / CHUNK) * CHUNK;
    const key = `${from}:${this.index}:${this.words.length}`;
    if (key === this._drawn) return;
    this._drawn = key;
    const g = this.ctx, words = this.words.slice(from, from + CHUNK).map((w) => w.toUpperCase());
    g.clearRect(0, 0, CW, CH);
    g.font = `800 54px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    const space = g.measureText(' ').width;
    const widths = words.map((w) => g.measureText(w).width);
    let total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
    const scale = Math.min(1, (CW - 40) / total);
    g.save(); g.translate(CW / 2, CH / 2); g.scale(scale, scale);
    let x = -total / 2;
    words.forEach((w, k) => {
      g.lineWidth = 10; g.strokeStyle = 'rgba(4,8,14,0.85)'; g.lineJoin = 'round';
      g.strokeText(w, x, 0);
      g.fillStyle = from + k === this.index ? C.cyan : C.text;
      g.fillText(w, x, 0);
      x += widths[k] + space;
    });
    g.restore();
    this.tex.needsUpdate = true;
  }
}
