import * as THREE from 'three';
import { Kit, W } from '../ui/kit.js';

export const PANEL_W = 0.8;                 // metres
const PX = PANEL_W / W;                     // metres per canvas pixel
const MAX_H = 1500;
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
// The display is a slab with depth: the back face of the glass, the glass, and the data floating in
// front of it. Moving round it, the three layers slide apart.
const Z_BACK = -0.016, Z_DATA = 0.011;

function makeLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = MAX_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  return { canvas, ctx, tex, mat, mesh };
}

// The glass layer: the fine square grid etched in the pane, and a soft band of light that passes over
// it now and then, both masked by the card's own shape. It only adds light, so text stays as it is.
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
uniform float uCols;
void main() {
  float mask = smoothstep(0.25, 0.42, texture2D(map, vUv * uRepeat + uOffset).a);   // the pane, not its glow
  vec2 cell = fract(vec2(vUv.x * uCols, vUv.y * uRows));
  vec2 fw = vec2(uCols, uRows) * fwidth(vUv);
  vec2 l = 1.0 - smoothstep(vec2(0.0), fw * 1.2, min(cell, 1.0 - cell));
  float grid = max(l.x, l.y);
  float pos = 1.3 - fract(uTime * 0.06) * 1.6;                        // a soft band of light, diagonal
  float sweep = smoothstep(0.16, 0.0, abs(vUv.y + vUv.x * 0.35 - pos));
  float a = mask * uOpacity * (0.02 + grid * 0.10 + sweep * 0.07);
  gl_FragColor = vec4(vec3(0.86, 1.0, 1.0), a);
}`;

// The data layer: like the chrome, plus a wipe from left to right, so a chart is drawn in as the
// concept's line is (axes first, then the line growing).
const DATA_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform float uOpacity;
uniform float uWipe;
void main() {
  vec4 c = texture2D(map, vUv * uRepeat + uOffset);
  float e = uWipe * 1.14 - 0.07;
  float glowEdge = smoothstep(0.035, 0.0, abs(vUv.x - e)) * step(uWipe, 0.999);
  c.a *= 1.0 - smoothstep(e - 0.03, e, vUv.x);
  c.rgb += glowEdge * c.a * 0.6;                                     // the leading edge is a little brighter
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  #include <colorspace_fragment>
}`;

// The back face of the glass: the card's shape only (the kit draws it on its own canvas), a faint teal.
const PLATE_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform float uOpacity;
void main() {
  vec4 c = texture2D(map, vUv * uRepeat + uOffset);
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  #include <colorspace_fragment>
}`;

// Shadow pass for the glass layers: only what is solid (outline, text, the chart, the light bars) casts
// a shadow here. The glass itself casts a light, even shade, drawn by Ground.js as a projection.
const SHADOW_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHADOW_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform float uOpacity;
uniform float uWipe;
void main() {
  float a = texture2D(map, vUv * uRepeat + uOffset).a * uOpacity;
  if (vUv.x > uWipe * 1.14 - 0.07) a = 0.0;
  if (a < 0.75) discard;
  gl_FragColor = vec4(1.0);                 // only depth matters; the pass still expects a colour
}`;

// A world-anchored card. The view draws on two canvases (chrome + data); the panel shows the
// top `height` pixels of each, anchored at its top-left corner so drawers grow downwards.
export class Panel {
  constructor() {
    this.group = new THREE.Group();          // origin = top-left corner of the card
    this.kit = new Kit();
    this.chrome = makeLayer();
    this.data = makeLayer();
    this.plate = makeLayer();
    this.chrome.mesh.renderOrder = 10;
    this.data.mesh.renderOrder = 11;
    this.data.mesh.position.z = Z_DATA;
    this.plate.mesh.position.z = Z_BACK;
    this.plate.mesh.renderOrder = 9.5;
    this.holoUniforms = {
      map: { value: this.chrome.tex }, uRepeat: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uOpacity: { value: 0 }, uRows: { value: 60 }, uCols: { value: W / 13 },
    };
    this.holo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, uniforms: this.holoUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.dataUniforms = {
      map: { value: this.data.tex }, uRepeat: { value: this.holoUniforms.uRepeat.value }, uOffset: { value: this.holoUniforms.uOffset.value },
      uOpacity: { value: 0 }, uWipe: { value: 0 },
    };
    this.data.mat = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: DATA_FRAG, uniforms: this.dataUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.data.mesh.material = this.data.mat;
    this.plateUniforms = { map: { value: this.plate.tex }, uRepeat: this.dataUniforms.uRepeat, uOffset: this.dataUniforms.uOffset, uOpacity: { value: 0 } };
    this.plate.mat = new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: PLATE_FRAG, uniforms: this.plateUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.plate.mesh.material = this.plate.mat;
    this.holo.material.side = THREE.DoubleSide;
    this.holo.position.z = 0.001; this.holo.renderOrder = 10.5;

    // Shadows (see Ground.js): the glass and the data each cast theirs.
    const shadowOf = (tex, opacity, wipe) => new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, side: THREE.DoubleSide,
      uniforms: { map: { value: tex }, uRepeat: this.dataUniforms.uRepeat, uOffset: this.dataUniforms.uOffset, uOpacity: opacity, uWipe: wipe },
    });
    this.chromeShadowOpacity = { value: 0 };
    this.chrome.mesh.customDepthMaterial = shadowOf(this.chrome.tex, this.chromeShadowOpacity, { value: 1 });
    this.data.mesh.customDepthMaterial = shadowOf(this.data.tex, this.dataUniforms.uOpacity, this.dataUniforms.uWipe);
    for (const m of [this.chrome.mesh, this.data.mesh]) { m.castShadow = true; m.material.shadowSide = THREE.DoubleSide; }
    this.group.add(this.plate.mesh, this.chrome.mesh, this.holo, this.data.mesh);
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
    for (const layer of [this.chrome, this.data, this.plate]) {
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
    this.kit.begin(this.chrome.ctx, this.data.ctx, h, this.hover, this.plate.ctx);
    this.view.draw(this.kit);
    this.chrome.tex.needsUpdate = true;
    this.plate.tex.needsUpdate = true;
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
  toLocal(x, y, ancestor, out = new THREE.Vector3(), z = 0.004) {
    out.set(x * PX, -y * PX, z);
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
        out.push(this.toLocal(((n % sw) + Math.random()) * W / sw, (Math.floor(n / sw) + Math.random()) * W / sw, ancestor, undefined, whole ? 0.004 : Z_DATA));
      }
    };
    // Summoned, the card is outlined first: most of the swarm goes to its edges.
    if (whole) { take(bright, max * 0.35); take(edge, max * 0.5); take(fill, max * 0.15); } else take(bright, max);
    return out;
  }

  update(dt, now) {
    const ease = (cur, target, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
    this.open = ease(this.open, this.holdOpen ? 0 : this.openTarget, this.openTarget ? 6 : 12);
    if (this.openTarget === 0 && this.open < 0.01) { this.open = 0; this.group.visible = false; }
    const want = this.holdData ? 0 : this.revealTarget;
    // Drawn in at an even pace (about 0.9 s across), taken away quickly.
    this.reveal = want > this.reveal ? Math.min(want, this.reveal + dt / 0.9) : ease(this.reveal, want, 16);
    this.chrome.mat.opacity = this.open;
    this.chromeShadowOpacity.value = this.open;
    this.plateUniforms.uOpacity.value = this.open;
    this.dataUniforms.uOpacity.value = this.open * Math.min(1, this.reveal * 5);
    this.dataUniforms.uWipe.value = this.reveal;
    this.holoUniforms.uTime.value = now;
    this.holoUniforms.uOpacity.value = this.open;
    this.group.scale.setScalar(0.94 + 0.06 * this.open);
    if (this.dirty && now - this._lastDraw > 0.05) { this._lastDraw = now; this.redraw(); }
  }
}
