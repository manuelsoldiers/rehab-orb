import * as THREE from 'three';

// The orb is the assistant's face. Its palette tells the state at a glance:
//   idle      – teal, slow
//   listening – teal / green
//   thinking  – magenta / violet, fast
//   speaking  – orange over blue-violet, pulsing with the voice
const PALETTE = {
  idle:      { a: '#0b6f7a', b: '#1c3f9a', c: '#59e6d0', speed: 0.35, glow: 1.0 },
  listening: { a: '#12d6a0', b: '#1480ff', c: '#9dffe0', speed: 0.75, glow: 1.0 },
  thinking:  { a: '#ff2bd0', b: '#6a2cff', c: '#ff9df2', speed: 1.7, glow: 1.15 },
  speaking:  { a: '#ff7a2c', b: '#4a52ff', c: '#ffd0a0', speed: 1.0, glow: 1.1 },
};

// It is a hologram, so it cannot rely on being opaque to look round. Its volume comes from depth
// you can see into and from things that pass in front of and behind one another:
//   - an outer shell of ribbons, lit from the upper left, with a bright limb and two highlights;
//   - the far side of that shell, seen through the near side;
//   - a smaller shell inside, turning the other way (parallax as the orb or the camera moves);
//   - a glowing core at the centre;
//   - a thin ring with a bead that orbits the whole thing, in front and then behind.
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

const SHELL_FRAG = /* glsl */`
precision highp float;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
uniform float uTime;      // runs faster or slower with the state
uniform float uSpin;      // real seconds: the ball always turns
uniform float uLevel;
uniform float uGlow;
uniform float uLayer;     // 0 outer shell, near side · 1 outer shell, far side · 2 inner shell
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;

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
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s / 0.875;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  bool far = uLayer > 0.5 && uLayer < 1.5;
  bool inner = uLayer > 1.5;
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float ndv = clamp(dot(n, vView), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 1.9);

  // The pattern lives on a globe that turns about a tilted axis: features travel across the near
  // side, round the limb, and come back along the far side. The inner shell turns the other way.
  vec3 p = normalize(vObj);
  float t = uTime, dir = inner ? -1.0 : 1.0;
  p.xy = rot(0.42) * p.xy;
  p.xz = rot(dir * (uSpin * 0.55 + t * 0.30) + p.y * 0.9) * p.xz;
  vec3 q = p * (inner ? 1.45 : 1.15) + uLayer * 7.3;
  // One octave is enough for the warp and the depth mask: three layers of this run on a phone.
  vec3 wv = vec3(noise(q * 1.3 + vec3(0.0, t * 0.20, 0.0)),
                 noise(q * 1.3 + vec3(5.2, 1.3, t * 0.17)),
                 noise(q * 1.3 + vec3(t * 0.13, 9.1, 3.3))) - 0.5;
  vec3 r = q + wv * 1.7;
  float f = fbm(r * 1.25 + vec3(0.0, 0.0, t * 0.10));
  float g = noise(r * 1.1 - 3.1);

  float lines = pow(0.5 + 0.5 * cos(f * 24.0), 18.0);       // thin ribbons along the contours
  float veil = pow(0.5 + 0.5 * cos(f * 24.0 + 1.4), 3.0);   // soft glow beside them
  float sheet = smoothstep(0.38, 0.62, f);
  float depth = smoothstep(0.25, 0.75, g);

  vec3 body = mix(uB, uA, sheet);
  vec3 col = body * (0.07 + 0.55 * veil * depth);
  col += mix(body, uC, 0.6) * lines * (0.35 + 0.9 * depth);
  col *= 1.0 + uLevel * 0.9;

  // Light from the upper left, in view space: one side of the ball is bright, the other falls away.
  vec3 key = normalize(vec3(-0.50, 0.62, 0.60));
  float lit = max(dot(n, key), 0.0);
  col *= 0.42 + 0.95 * lit;

  float spec = 0.0;
  if (!far && !inner) {
    // The glass skin: a coloured limb that thickens towards the edge, and reflections of the light.
    vec3 rim = mix(uA, uB, 0.5 + 0.5 * sin(atan(n.y, n.x) * 2.0 + t * 0.6));
    col += rim * fres * (1.5 + uLevel * 0.8);
    col += mix(rim, vec3(1.0), 0.5) * pow(1.0 - ndv, 6.0) * 0.9;        // a hard bright line at the very edge
    spec = pow(lit, 26.0) * 0.50 + pow(lit, 240.0) * 1.1;               // a soft sheen and a sharp glint
    spec += pow(max(dot(n, normalize(vec3(0.55, -0.60, 0.58))), 0.0), 34.0) * 0.14;   // a faint bounce, lower right
    col += vec3(1.0) * spec;
  }

  col *= 0.90 + 0.10 * sin(vObj.y * 900.0 + uSpin * 5.0);              // hologram bands
  col *= uGlow;
  float lum = max(col.r, max(col.g, col.b));
  float alpha;
  if (far) { col *= 0.50; alpha = clamp(0.04 + 0.9 * lum, 0.0, 0.6); }
  else if (inner) { col *= 0.85; alpha = clamp(lum * 1.1, 0.0, 0.8); }
  else alpha = clamp(0.10 + 0.55 * fres + 0.95 * lum + spec, 0.0, 0.95);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

// The core: a small ball of light, brightest where you look straight into it.
const CORE_FRAG = /* glsl */`
precision highp float;
varying vec3 vNormal;
varying vec3 vView;
uniform float uLevel;
uniform float uGlow;
uniform float uSpin;
uniform vec3 uA;
uniform vec3 uC;
void main() {
  float ndv = clamp(dot(normalize(vNormal), vView), 0.0, 1.0);
  float glow = pow(ndv, 2.4);
  float pulse = 0.85 + 0.15 * sin(uSpin * 2.1) + uLevel * 0.7;
  vec3 col = mix(uA, mix(uC, vec3(1.0), 0.55), glow) * glow * pulse * uGlow;
  gl_FragColor = vec4(col, glow * 0.85);
  #include <colorspace_fragment>
}`;

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
    const shell = (r, layer, side, order, extra = {}) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 64, 48),
        new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: SHELL_FRAG, uniforms: { ...shared, uLayer: { value: layer } },
          transparent: true, side, depthWrite: false, ...extra,
        }),
      );
      m.renderOrder = order;
      return m;
    };
    // Drawn back to front, after the display (order 10–11): the orb is nearer and may pass in front of it.
    this.far = shell(radius, 1, THREE.BackSide, 14.2);
    this.inner = shell(radius * 0.64, 2, THREE.FrontSide, 14.4, { blending: THREE.AdditiveBlending });
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.36, 32, 24),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CORE_FRAG, uniforms: shared, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.core.renderOrder = 14.5;
    this.near = shell(radius, 0, THREE.FrontSide, 15, { depthWrite: true });
    this.mesh = this.near;
    this.body = new THREE.Group();
    this.body.add(this.far, this.inner, this.core, this.near);

    // The ring: a tilted orbit with a bead on it. Where it passes behind the ball you see it through
    // the glass, dimmer; where it passes in front it cuts across the ribbons.
    this.ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.idle.c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.36, radius * 0.010, 8, 120), this.ringMat);
    this.beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    this.bead = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.05, 16, 12), this.beadMat);
    this.orbit = new THREE.Group();           // tilted plane of the ring
    this.orbit.rotation.set(1.22, 0, 0.32);
    this.orbit.add(this.ring, this.bead);
    for (const m of [this.ring, this.bead]) m.renderOrder = 14.3;

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: PALETTE.idle.a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.halo.scale.setScalar(radius * 3.4);
    this.halo.renderOrder = 14;

    this.group.add(this.halo, this.body, this.orbit);
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

    this.body.scale.setScalar(1 + Math.sin(this._spin * 1.3) * 0.012 + level * 0.05);
    // The ring's plane wobbles slowly; the bead runs round it, faster when the orb is busy.
    this.orbit.rotation.y = this._spin * 0.23;
    this.orbit.rotation.z = 0.32 + Math.sin(this._spin * 0.31) * 0.18;
    const a = this._spin * 1.15, r = this.radius * 1.36;
    this.bead.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    this.ringMat.color.copy(u.uC.value).lerp(u.uA.value, 0.35);
    this.ringMat.opacity = 0.42 + level * 0.3;
    this.beadMat.color.copy(u.uC.value).lerp(this._ca.set(0xffffff), 0.6);

    this.halo.material.color.copy(u.uA.value).lerp(u.uB.value, 0.35);
    this.halo.material.opacity = 0.32 * this._glow + level * 0.25;
    this.halo.scale.setScalar(this.radius * (3.5 + level * 0.6));
  }
}
