import * as THREE from 'three';

// The orb is the assistant's face. Its palette tells the state at a glance:
//   idle      – dim teal, slow
//   listening – teal / green
//   thinking  – magenta / violet, fast
//   speaking  – orange over blue-violet, pulsing with the voice
const PALETTE = {
  idle:      { a: '#0b6f7a', b: '#1c3f9a', c: '#59e6d0', speed: 0.35, glow: 0.85 },
  listening: { a: '#12d6a0', b: '#1480ff', c: '#9dffe0', speed: 0.75, glow: 1.0 },
  thinking:  { a: '#ff2bd0', b: '#6a2cff', c: '#ff9df2', speed: 1.7, glow: 1.15 },
  speaking:  { a: '#ff7a2c', b: '#4a52ff', c: '#ffd0a0', speed: 1.0, glow: 1.1 },
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

const FRAG = /* glsl */`
precision highp float;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vView;
uniform float uTime;
uniform float uLevel;
uniform float uGlow;
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
  vec3 n = normalize(vNormal);
  float ndv = clamp(dot(n, vView), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);

  // Swirl: twist the lookup around the vertical axis, then fold it with a vector warp so the
  // field moves like smoke in a glass ball. Its contour lines are the bright ribbons.
  vec3 p = normalize(vObj);
  float t = uTime;
  p.xz = rot(t * 0.30 + p.y * 0.9) * p.xz;
  p.xy = rot(sin(t * 0.21) * 0.5) * p.xy;
  vec3 q = p * 1.15;
  vec3 wv = vec3(fbm(q + vec3(0.0, t * 0.20, 0.0)),
                 fbm(q + vec3(5.2, 1.3, t * 0.17)),
                 fbm(q + vec3(t * 0.13, 9.1, 3.3))) - 0.5;
  vec3 r = q + wv * 1.9;
  float f = fbm(r * 1.25 + vec3(0.0, 0.0, t * 0.10));
  float g = fbm(r * 0.85 - 3.1);

  float lines = pow(0.5 + 0.5 * cos(f * 24.0), 18.0);       // thin ribbons along the contours
  float veil = pow(0.5 + 0.5 * cos(f * 24.0 + 1.4), 3.0);   // soft glow beside them
  float sheet = smoothstep(0.38, 0.62, f);
  float depth = smoothstep(0.25, 0.75, g);

  vec3 body = mix(uB, uA, sheet);
  vec3 col = body * (0.07 + 0.55 * veil * depth);           // dark, glassy core
  col += mix(body, uC, 0.6) * lines * (0.35 + 0.9 * depth);
  col *= 0.6 + 0.6 * ndv;                                   // the centre reads deeper
  col *= 1.0 + uLevel * 0.9;

  // Glass shell: coloured rim and one soft highlight, upper left.
  vec3 rim = mix(uA, uB, 0.5 + 0.5 * sin(atan(n.y, n.x) * 2.0 + t * 0.6));
  col += rim * fres * (1.35 + uLevel * 0.8);
  vec3 h = normalize(vec3(-0.45, 0.62, 0.65));
  col += vec3(1.0) * pow(max(dot(n, h), 0.0), 60.0) * 0.55;

  col *= uGlow;
  float alpha = clamp(0.80 + fres * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
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
    this._t = 0;
    this._speed = PALETTE.idle.speed;
    this._glow = PALETTE.idle.glow;
    this._target = PALETTE.idle;

    this.uniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uGlow: { value: this._glow },
      uA: { value: new THREE.Color(PALETTE.idle.a) },
      uB: { value: new THREE.Color(PALETTE.idle.b) },
      uC: { value: new THREE.Color(PALETTE.idle.c) },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 64, 48),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true }),
    );
    this.mesh.renderOrder = 15;     // after the display: the orb is nearer and may pass in front of it

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: PALETTE.idle.a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.halo.scale.setScalar(radius * 3.4);
    this.halo.renderOrder = 14;

    this.group.add(this.halo, this.mesh);
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
    u.uTime.value = this._t;
    u.uGlow.value = this._glow;
    u.uLevel.value += (this.level - u.uLevel.value) * (1 - Math.exp(-dt * 14));

    const breathe = 1 + Math.sin(this._t * 1.6) * 0.012 + u.uLevel.value * 0.05;
    this.mesh.scale.setScalar(breathe);
    this.halo.material.color.copy(u.uA.value).lerp(u.uB.value, 0.35);
    this.halo.material.opacity = 0.32 * this._glow + u.uLevel.value * 0.25;
    this.halo.scale.setScalar(this.radius * (3.3 + u.uLevel.value * 0.6));
  }
}
