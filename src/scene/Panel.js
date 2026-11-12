import * as THREE from 'three';
import { Kit, W } from '../ui/kit.js';

export const PANEL_W = 0.8;                 // metres
const PX = PANEL_W / W;                     // metres per canvas pixel
const MAX_H = 1500;
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

function makeLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = MAX_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  return { canvas, ctx, tex, mat, mesh };
}

// The hologram layer: fine scanlines that crawl upwards and a band of light that sweeps down now and
// then, both masked by the card's own shape. It only adds light, so text underneath stays as it is.
const HOLO_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLO_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform float uTime;
uniform float uOpacity;
uniform float uRows;
void main() {
  float mask = texture2D(map, vUv * uRepeat + uOffset).a;
  float scan = pow(0.5 + 0.5 * sin((vUv.y * uRows + uTime * 0.9) * 6.28318), 4.0);
  float pos = 1.25 - fract(uTime * 0.085) * 1.5;                     // a band that travels top to bottom
  float sweep = smoothstep(0.10, 0.0, abs(vUv.y - pos));
  float a = mask * uOpacity * (0.045 + scan * 0.085 + sweep * 0.16);
  gl_FragColor = vec4(vec3(0.38, 0.80, 1.0), a);
}`;

// A world-anchored card. The view draws on two canvases (chrome + data); the panel shows the
// top `height` pixels of each, anchored at its top-left corner so drawers grow downwards.
export class Panel {
  constructor() {
    this.group = new THREE.Group();          // origin = top-left corner of the card
    this.kit = new Kit();
    this.chrome = makeLayer();
    this.data = makeLayer();
    this.chrome.mesh.renderOrder = 10;
    this.data.mesh.renderOrder = 11;
    this.data.mesh.position.z = 0.002;
    this.holoUniforms = {
      map: { value: this.chrome.tex }, uRepeat: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uOpacity: { value: 0 }, uRows: { value: 60 },
    };
    this.holo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, uniforms: this.holoUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.holo.position.z = 0.001; this.holo.renderOrder = 10.5;
    this.group.add(this.chrome.mesh, this.holo, this.data.mesh);
    this.group.visible = false;

    this.height = 800;
    this.view = null;                        // { height(kit), draw(kit) }
    this.hover = null;
    this.dirty = false;
    this.open = 0; this.openTarget = 0;      // 0..1 card visibility
    this.reveal = 0; this.revealTarget = 0;  // 0..1 data layer visibility
    this.holdOpen = false;                   // the card itself waits for the swarm (when it is summoned)
    this.holdData = false;                   // true while the swarm is still flying
    this._lastDraw = 0;
    this._applyHeight(800);

    this._scratch = document.createElement('canvas');
    this._scratch.width = 320;
    this._sctx = this._scratch.getContext('2d', { willReadFrequently: true });
  }

  _applyHeight(h) {
    this.height = h;
    const ph = h * PX, v0 = 1 - h / MAX_H;
    for (const layer of [this.chrome, this.data]) {
      layer.mesh.scale.set(PANEL_W, ph, 1);
      layer.mesh.position.x = PANEL_W / 2;
      layer.mesh.position.y = -ph / 2;
      layer.tex.repeat.set(1, h / MAX_H);
      layer.tex.offset.set(0, v0);
    }
    this.holo.scale.set(PANEL_W, ph, 1);
    this.holo.position.x = PANEL_W / 2; this.holo.position.y = -ph / 2;
    this.holoUniforms.uRepeat.value.set(1, h / MAX_H);
    this.holoUniforms.uOffset.value.set(0, v0);
    this.holoUniforms.uRows.value = h / 13;                           // one scanline every 13 canvas px (8 mm)
  }

  get physicalHeight() { return this.height * PX; }

  setView(view) {
    this.view = view; this.hover = null;
    this.redraw();
  }

  show() { this.group.visible = true; this.openTarget = 1; }
  get isOpen() { return this.group.visible && this.openTarget === 1; }
  hide() { this.openTarget = 0; this.revealTarget = 0; }

  invalidate() { this.dirty = true; }

  redraw() {
    if (!this.view) return;
    const h = Math.min(MAX_H, Math.round(this.view.height(this.kit)));
    if (h !== this.height) this._applyHeight(h);
    this.kit.begin(this.chrome.ctx, this.data.ctx, h, this.hover);
    this.view.draw(this.kit);
    this.chrome.tex.needsUpdate = true;
    this.data.tex.needsUpdate = true;
    this.dirty = false;
  }

  setHover(target) {
    const a = this.hover ? this.hover.id : null, b = target ? target.id : null;
    this.hover = target;
    if (a !== b) this.dirty = true;
  }

  // Ray → canvas pixel. Returns { x, y, point, distance } or null.
  raycast(raycaster) {
    if (!this.isOpen || this.open < 0.5) return null;
    const hit = raycaster.intersectObject(this.chrome.mesh, false)[0];
    if (!hit) return null;
    return { x: hit.uv.x * W, y: (1 - hit.uv.y) * this.height, point: hit.point, distance: hit.distance };
  }

  // Canvas pixel → position in the space of `ancestor` (an Object3D above this.group).
  toLocal(x, y, ancestor, out = new THREE.Vector3()) {
    out.set(x * PX, -y * PX, 0.004);
    this.group.updateWorldMatrix(true, false);
    this.group.localToWorld(out);
    return ancestor.worldToLocal(out);
  }

  // True when the ray passes through the card or within `margin` metres of it.
  near(ray, margin = 0.06) {
    if (!this.isOpen) return false;
    this.group.updateWorldMatrix(true, false);
    const inv = _m.copy(this.group.matrixWorld).invert();
    const o = _o.copy(ray.origin).applyMatrix4(inv), d = _d.copy(ray.direction).transformDirection(inv);
    if (Math.abs(d.z) < 1e-5) return false;
    const t = -o.z / d.z; if (t < 0) return false;
    const x = o.x + d.x * t, y = o.y + d.y * t;
    return x > -margin && x < PANEL_W + margin && y < margin && y > -this.physicalHeight - margin;
  }

  // Where the swarm should land, in `ancestor` space.
  //   whole = false: the lit pixels of the data layer (a chart re-forming).
  //   whole = true:  the card itself, as outlines, text and chart (the display being summoned).
  sampleInk(ancestor, max = 900, whole = false) {
    const sw = 320, sh = Math.max(1, Math.round(this.height * sw / W)), g = this._sctx;
    this._scratch.height = sh;
    g.clearRect(0, 0, sw, sh);
    if (whole) g.drawImage(this.chrome.canvas, 0, 0, W, this.height, 0, 0, sw, sh);
    g.drawImage(this.data.canvas, 0, 0, W, this.height, 0, 0, sw, sh);
    const px = g.getImageData(0, 0, sw, sh).data;
    const alpha = (n) => px[n * 4 + 3];
    const bright = [], edge = [], fill = [];
    for (let n = 0, total = sw * sh; n < total; n++) {
      const a = alpha(n); if (a < 90) continue;
      if (!whole) { bright.push(n); continue; }
      const i = n * 4, x = n % sw;
      if (Math.max(px[i], px[i + 1], px[i + 2]) > 150) bright.push(n);
      else if ((x > 0 && alpha(n - 1) < a * 0.7) || (x < sw - 1 && alpha(n + 1) < a * 0.7) || (n >= sw && alpha(n - sw) < a * 0.7) || (n < total - sw && alpha(n + sw) < a * 0.7)) edge.push(n);
      else fill.push(n);
    }
    const out = [];
    const take = (list, count) => {
      if (!list.length || count <= 0) return;
      const step = Math.max(1, list.length / count);
      for (let f = 0; f < list.length; f += step) {
        const n = list[f | 0];
        out.push(this.toLocal(((n % sw) + Math.random()) * W / sw, (Math.floor(n / sw) + Math.random()) * W / sw, ancestor));
      }
    };
    if (whole) { take(bright, max * 0.55); take(edge, max * 0.3); take(fill, max * 0.15); } else take(bright, max);
    return out;
  }

  update(dt, now) {
    const ease = (cur, target, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
    this.open = ease(this.open, this.holdOpen ? 0 : this.openTarget, this.openTarget ? 6 : 12);
    if (this.openTarget === 0 && this.open < 0.01) { this.open = 0; this.group.visible = false; }
    const want = this.holdData ? 0 : this.revealTarget;
    this.reveal = ease(this.reveal, want, want > this.reveal ? 7 : 16);
    const flicker = 0.972 + 0.028 * Math.sin(now * 19.0) * Math.sin(now * 6.1);   // a projection, not a sheet of glass
    this.chrome.mat.opacity = this.open * flicker;
    this.data.mat.opacity = this.open * this.reveal;
    this.holoUniforms.uTime.value = now;
    this.holoUniforms.uOpacity.value = this.open;
    this.group.scale.setScalar(0.94 + 0.06 * this.open);
    if (this.dirty && now - this._lastDraw > 0.05) { this._lastDraw = now; this.redraw(); }
  }
}
