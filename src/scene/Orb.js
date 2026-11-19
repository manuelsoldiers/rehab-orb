import * as THREE from 'three';

// The orb is the assistant's face, drawn after the owner's concept video: a clear glass bubble with an
// iridescent skin, a white-hot core, fine threads of light wound round it, two tilted orbits with a
// star on each, and a horizontal flare across the core.
// Its tint tells the state at a glance (a = threads, b = second threads and skin, c = core and orbits):
//   idle      – pink and mint, as in the concept
//   listening – mint and teal
//   thinking  – magenta and violet, faster
//   speaking  – peach and lavender, pulsing with the voice
const PALETTE = {
  idle:      { a: '#ff6fc8', b: '#6ff2cf', c: '#d6b6ff', speed: 0.45, glow: 1.0 },
  listening: { a: '#52f2c2', b: '#5fd2ff', c: '#d2fff1', speed: 0.8, glow: 1.05 },
  thinking:  { a: '#ff58d6', b: '#8d6bff', c: '#ffc8f3', speed: 1.7, glow: 1.15 },
  speaking:  { a: '#ffa673', b: '#b690ff', c: '#ffe2c8', speed: 1.0, glow: 1.1 },
};

const VERT = /* glsl */`
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const NOISE = /* glsl */`
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

// The glass skin. Near side: a thin-film sheen that shifts pink → mint → lavender with the angle,
// strongest at the rim, with the window's reflection as a soft highlight and a sharp glint.
// Far side (uFar = 1): the same sheen, seen through the bubble, fainter.
const SKIN_FRAG = /* glsl */`
precision highp float;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
uniform float uSpin;
uniform float uLevel;
uniform float uGlow;
uniform float uFar;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
${NOISE}
void main() {
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float ndv = clamp(dot(n, vView), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float film = ndv * 1.6 + noise(normalize(vObj) * 2.2 + uSpin * 0.12) * 0.7 + uSpin * 0.03;
  vec3 iri = 0.5 + 0.5 * cos(6.28318 * (film + vec3(0.0, 0.33, 0.67)));
  // Mostly the first tint and the core's lavender, with the second tint only in passing.
  vec3 tint = mix(mix(uA, uC, 0.45), uB, 0.25 + 0.25 * sin(film * 3.1));
  // Light only: the bubble never darkens what is behind it, it brightens it towards the rim.
  // (Values are display colours, added straight onto the picture: no colour-space conversion here.)
  vec3 col = mix(iri, tint, 0.68) * (0.025 + 0.85 * fres);
  float alpha = 1.0;
  if (uFar < 0.5) {
    vec3 key = normalize(vec3(-0.55, 0.55, 0.62));
    float lit = max(dot(n, key), 0.0);
    float spec = pow(lit, 30.0) * 0.16 + pow(lit, 400.0) * 1.2;
    spec += pow(max(dot(n, normalize(vec3(0.6, -0.5, 0.62))), 0.0), 60.0) * 0.10;
    col += vec3(1.0) * spec;
    col += mix(uA, uB, 0.5) * pow(1.0 - ndv, 7.0) * 0.5;        // a fine bright line at the very edge
  } else {
    col *= 0.45;
  }
  col *= uGlow * (1.0 + uLevel * 0.25);
  gl_FragColor = vec4(col, alpha);
}`;

// Threads of light: thin rings round the core on tilted planes that slowly turn, warped a little so
// they read as strands, not wire. Drawn on two nested spheres, both faces, adding light.
const THREADS_FRAG = /* glsl */`
precision highp float;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
uniform float uTime;
uniform float uSpin;
uniform float uLevel;
uniform float uGlow;
uniform float uSeed;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
${NOISE}
vec3 axis(float k) {
  float a = k * 2.39996 + uSeed * 1.7 + uTime * (0.20 + 0.05 * k) * (mod(k, 2.0) < 1.0 ? 1.0 : -1.0);
  float b = k * 1.13 + uSeed + sin(uTime * 0.31 + k) * 0.6;
  return normalize(vec3(cos(a) * sin(b), cos(b), sin(a) * sin(b)));
}
void main() {
  vec3 p = normalize(vObj);
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float facing = 0.45 + 0.55 * clamp(dot(n, vView), 0.0, 1.0);   // the near half reads brighter
  float warp = (noise(p * 2.6 + vec3(uSpin * 0.25, uSeed, 0.0)) - 0.5) * 0.16;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float k = float(i);
    float d = abs(dot(p, axis(k)) + warp * (0.6 + 0.4 * sin(k * 2.1)));
    float w = 0.010 + 0.012 * fract(k * 0.37 + uSeed);
    float line = exp(-d * d / (w * w));
    float glow = exp(-d * d / (w * w * 18.0)) * 0.22;
    vec3 tint = mod(k, 3.0) < 1.0 ? uA : (mod(k, 3.0) < 2.0 ? uB : uC);
    if (k == 4.0) tint = uA;                                   // four of the seven threads carry the first tint
    col += mix(tint, vec3(1.0), 0.18) * (line + glow);
  }
  col *= facing * uGlow * (0.42 + uLevel * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

// Shadow pass. The threads cast the shadow of their own lines (drawn wider than they look, so they
// still read on the floor), the glass skin a faint shade. Fragments that cast nothing are discarded.
const DEPTH_VERT = /* glsl */`
varying vec3 vObj;
void main() { vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const THREADS_DEPTH_FRAG = /* glsl */`
precision highp float;
varying vec3 vObj;
uniform float uTime;
uniform float uSpin;
uniform float uSeed;
${NOISE}
vec3 axis(float k) {
  float a = k * 2.39996 + uSeed * 1.7 + uTime * (0.20 + 0.05 * k) * (mod(k, 2.0) < 1.0 ? 1.0 : -1.0);
  float b = k * 1.13 + uSeed + sin(uTime * 0.31 + k) * 0.6;
  return normalize(vec3(cos(a) * sin(b), cos(b), sin(a) * sin(b)));
}
void main() {
  vec3 p = normalize(vObj);
  float warp = (noise(p * 2.6 + vec3(uSpin * 0.25, uSeed, 0.0)) - 0.5) * 0.16;
  float best = 1.0;
  for (int i = 0; i < 7; i++) {
    float k = float(i);
    best = min(best, abs(dot(p, axis(k)) + warp * (0.6 + 0.4 * sin(k * 2.1))));
  }
  if (best > 0.045) discard;
  gl_FragColor = vec4(1.0);                 // only depth matters; the pass still expects a colour
}`;

// The core: brightest where you look straight into it.
const CORE_FRAG = /* glsl */`
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
uniform float uLevel;
uniform float uGlow;
uniform float uSpin;
uniform vec3 uC;
void main() {
  float ndv = clamp(dot(normalize(vNormal), vView), 0.0, 1.0);
  float glow = pow(ndv, 3.0);
  float pulse = 0.9 + 0.1 * sin(uSpin * 2.1) + uLevel * 0.6;
  vec3 col = mix(uC, vec3(1.0), glow) * glow * pulse * uGlow;
  gl_FragColor = vec4(col, glow);
}`;

function spriteTexture(draw, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const radial = (stops) => (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
};
// A horizontal flare: a thin streak, brightest in the middle, as a camera lens draws a bright point.
const flare = (g, s) => {
  const grad = g.createLinearGradient(0, 0, s, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  const v = g.createLinearGradient(0, 0, 0, s);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillRect(0, s * 0.42, s, s * 0.16);
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = v; g.fillRect(0, 0, s, s);
};
// A small star: a round glow with four fine spikes.
const star = (g, s) => {
  radial([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.85)'], [0.35, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']])(g, s);
  g.globalCompositeOperation = 'lighter';
  for (const vertical of [false, true]) {
    const grad = vertical ? g.createLinearGradient(0, 0, 0, s) : g.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    if (vertical) g.fillRect(s / 2 - 1.5, 0, 3, s); else g.fillRect(0, s / 2 - 1.5, s, 3);
  }
};

export class Orb {
  constructor(radius = 0.1) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.state = 'idle';
    this.level = 0;        // 0..1 voice envelope
    this._t = 0; this._spin = 0;
    this._speed = PALETTE.idle.speed;
    this._glow = PALETTE.idle.glow;
    this._target = PALETTE.idle;

    // One set of values, shared by every layer.
    const shared = {
      uTime: { value: 0 }, uSpin: { value: 0 }, uLevel: { value: 0 }, uGlow: { value: this._glow },
      uA: { value: new THREE.Color(PALETTE.idle.a) },
      uB: { value: new THREE.Color(PALETTE.idle.b) },
      uC: { value: new THREE.Color(PALETTE.idle.c) },
    };
    this.uniforms = shared;
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    const sphere = (r, frag, extra, order, own = {}) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48),
        new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { ...shared, ...own }, ...extra }));
      m.renderOrder = order;
      return m;
    };
    // Drawn back to front, after the display (order 10–11): the orb is nearer and may pass in front of it.
    this.far = sphere(radius, SKIN_FRAG, { ...add, side: THREE.BackSide }, 14.1, { uFar: { value: 1 } });
    this.threadsOuter = sphere(radius * 0.86, THREADS_FRAG, { ...add, side: THREE.DoubleSide }, 14.2, { uSeed: { value: 0.3 } });
    this.threadsInner = sphere(radius * 0.58, THREADS_FRAG, { ...add, side: THREE.DoubleSide }, 14.25, { uSeed: { value: 2.9 } });
    this.core = sphere(radius * 0.26, CORE_FRAG, add, 14.4);
    this.near = sphere(radius, SKIN_FRAG, { ...add, depthWrite: true, side: THREE.FrontSide }, 15, { uFar: { value: 0 } });
    this.mesh = this.near;

    // Shadows (see Ground.js).
    for (const t of [this.threadsOuter, this.threadsInner]) {
      t.castShadow = true;
      t.customDepthMaterial = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: THREADS_DEPTH_FRAG, uniforms: t.material.uniforms, side: THREE.DoubleSide });
    }
    // (The bubble's own light shade is drawn by Ground.js, as a soft projection.)

    const sprite = (tex, order, opacity) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.renderOrder = order;
      return s;
    };
    this.coreGlow = sprite(spriteTexture(radial([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']])), 14.45, 0.95);
    this.coreGlow.scale.setScalar(radius * 1.25);
    this.flare = sprite(spriteTexture(flare), 15.5, 0.5);
    this.flare.scale.set(radius * 7.5, radius * 0.5, 1);
    this.body = new THREE.Group();
    this.body.add(this.far, this.threadsOuter, this.threadsInner, this.core, this.coreGlow, this.near, this.flare);

    // Two orbits on different tilts, each with a star running round it. Where an orbit passes behind
    // the bubble it shows through the glass; where it passes in front it crosses the threads.
    const starTex = spriteTexture(star, 128);
    this.orbits = [
      { tilt: [1.20, 0, 0.42], r: 1.30, speed: 1.05, phase: 0.0, wobble: 0.31 },
      { tilt: [1.62, 0.55, -0.62], r: 1.17, speed: -0.78, phase: 2.4, wobble: 0.23 },
    ].map((o) => {
      const group = new THREE.Group();
      group.rotation.set(...o.tilt);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * o.r, radius * 0.007, 6, 160), ringMat);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glint = sprite(starTex, 15.6, 0.95);
      glint.scale.setScalar(radius * 0.55);
      bead.add(glint);
      ring.renderOrder = 14.3; bead.renderOrder = 14.3;
      // The ring is a hair's breadth: its shadow comes from an invisible, thicker twin.
      const shadowRing = new THREE.Mesh(new THREE.TorusGeometry(radius * o.r, radius * 0.03, 6, 120), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      shadowRing.castShadow = true; bead.castShadow = true;
      group.add(ring, bead, shadowRing);
      return { ...o, group, ring, ringMat, bead, glint };
    });

    this.halo = sprite(spriteTexture(radial([[0, 'rgba(255,255,255,0.40)'], [0.4, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])), 14, 0.5);
    this.halo.scale.setScalar(radius * 3.6);

    this.group.add(this.halo, this.body, ...this.orbits.map((o) => o.group));
    this._ca = new THREE.Color(); this._cb = new THREE.Color(); this._cc = new THREE.Color();
  }

  setState(state) {
    if (!PALETTE[state] || state === this.state) return;
    this.state = state; this._target = PALETTE[state];
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 5.5);           // ~0.4 s colour cross-fade
    const p = this._target, u = this.uniforms;
    u.uA.value.lerp(this._ca.set(p.a), k);
    u.uB.value.lerp(this._cb.set(p.b), k);
    u.uC.value.lerp(this._cc.set(p.c), k);
    this._speed += (p.speed - this._speed) * k;
    this._glow += (p.glow - this._glow) * k;
    this._t += dt * this._speed;
    this._spin += dt * (0.7 + this._speed * 0.5);
    u.uTime.value = this._t; u.uSpin.value = this._spin;
    u.uGlow.value = this._glow;
    u.uLevel.value += (this.level - u.uLevel.value) * (1 - Math.exp(-dt * 14));
    const level = u.uLevel.value;

    this.body.scale.setScalar(1 + Math.sin(this._spin * 1.3) * 0.010 + level * 0.045);
    this.coreGlow.scale.setScalar(this.radius * (1.2 + level * 0.5 + Math.sin(this._spin * 2.1) * 0.05));
    this.flare.material.opacity = 0.38 + level * 0.3;
    this.flare.material.color.copy(u.uC.value).lerp(this._ca.set(0xffffff), 0.6);
    for (const o of this.orbits) {
      o.group.rotation.y = o.tilt[1] + this._spin * 0.11 * Math.sign(o.speed);
      o.group.rotation.z = o.tilt[2] + Math.sin(this._spin * o.wobble) * 0.15;
      const a = o.phase + this._t * o.speed * 1.6, r = this.radius * o.r;
      o.bead.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      o.ringMat.color.copy(u.uC.value).lerp(this._cb.set(0xffffff), 0.55);
      o.ringMat.opacity = 0.34 + level * 0.25;
    }
    this.halo.material.color.copy(u.uA.value).lerp(u.uB.value, 0.5).lerp(this._ca.set(0xffffff), 0.3);
    this.halo.material.opacity = 0.30 * this._glow + level * 0.22;
    this.halo.scale.setScalar(this.radius * (3.5 + level * 0.6));
  }
}
