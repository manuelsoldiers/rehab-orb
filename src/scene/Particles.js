import * as THREE from 'three';

// The swarm that carries data from the orb onto the panel (and between two views of the panel).
// Each particle flies from aStart to aEnd; a swirl that peaks mid-flight makes the chart read as a
// noisy cloud just before it settles into a clean line.
const VERT = /* glsl */`
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aSeed;
uniform float uT;
uniform float uTime;
uniform float uFade;
uniform float uScale;
varying float vAlpha;
void main() {
  float delay = aSeed * 0.38;
  float k = clamp((uT - delay) / 0.62, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec3 p = mix(aStart, aEnd, k);
  float w = sin(k * 3.14159);
  vec3 n = vec3(sin(aSeed * 91.7 + uTime * 2.1), cos(aSeed * 47.3 + uTime * 1.7), sin(aSeed * 13.1 + uTime * 2.6));
  p += n * (w * 0.055 + (1.0 - k) * 0.012);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = 0.0034 * (0.55 + 0.9 * fract(aSeed * 7.31));
  gl_PointSize = max(1.5, size * projectionMatrix[1][1] * uScale / -mv.z);
  vAlpha = uFade * (0.35 + 0.65 * fract(aSeed * 3.17)) * smoothstep(0.0, 0.08, uT - delay * 0.5);
}`;

const FRAG = /* glsl */`
precision mediump float;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), a);
}`;

export class Particles {
  constructor(count = 2600) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.start = new Float32Array(count * 3);
    this.end = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(this.start, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(this.end, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uT: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 }, uScale: { value: 500 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.visible = false;
    const vp = new THREE.Vector4();
    this.points.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(vp);           // per-eye viewport in XR
      this.uniforms.uScale.value = vp.w * 0.5;
    };
    this.t = 1; this.duration = 1; this.fadeOut = 0.3; this.active = false;
  }

  // starts / ends: arrays of THREE.Vector3 (or a function returning one) in the parent's local space.
  fly(starts, ends, duration = 1.0) {
    const pick = (src, i) => (typeof src === 'function' ? src(i) : src[(Math.random() * src.length) | 0]);
    for (let i = 0; i < this.count; i++) {
      const a = pick(starts, i), b = pick(ends, i);
      this.start.set([a.x, a.y, a.z], i * 3);
      this.end.set([b.x, b.y, b.z], i * 3);
    }
    const g = this.points.geometry;
    g.attributes.aStart.needsUpdate = true; g.attributes.aEnd.needsUpdate = true;
    this.t = 0; this.duration = duration; this.active = true;
    this.points.visible = true;
    this.lastEnds = ends;
  }

  // Returns landing progress 0..1 so the panel can fade its data layer in as the swarm arrives.
  update(dt) {
    if (!this.active) return 1;
    this.t += dt;
    const u = this.uniforms;
    u.uTime.value += dt;
    const flight = Math.min(this.t / this.duration, 1);
    u.uT.value = flight;
    const tail = Math.max(0, (this.t - this.duration * 0.82) / this.fadeOut);
    u.uFade.value = Math.max(0, 1 - tail);
    if (tail >= 1) { this.active = false; this.points.visible = false; }
    return Math.min(1, tail);
  }
}
