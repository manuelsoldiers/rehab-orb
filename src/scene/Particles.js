import * as THREE from 'three';

// The swarm that carries the display out of the orb (and one view of the display into the next).
// Each particle flies from aStart to aEnd after its own delay; a swirl that peaks mid-flight makes
// the card read as a cloud just before it settles. Starts or ends can be tied to a moving point
// (the orb), so the stream keeps pouring out of it while it drifts.
const VERT = /* glsl */`
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aSeed;
attribute float aDelay;
uniform vec3 uA;
uniform vec3 uB;
uniform float uT;
uniform float uTime;
uniform float uFade;
uniform float uScale;
uniform float uSink;
varying float vAlpha;
void main() {
  float k = clamp((uT - aDelay) / 0.5, 0.0, 1.0);
  float e = k * k * (3.0 - 2.0 * k);
  vec3 a = aStart + uA, b = aEnd + uB;
  vec3 p = mix(a, b, e);
  float w = sin(e * 3.14159);
  float span = length(b - a);
  vec3 n = vec3(sin(aSeed * 91.7 + uTime * 2.1), cos(aSeed * 47.3 + uTime * 1.7), sin(aSeed * 13.1 + uTime * 2.6));
  p += n * (w * (0.018 + span * 0.075) + (1.0 - e) * 0.008);
  p.y += w * span * 0.10 * (fract(aSeed * 5.3) - 0.35);          // a loose arc, not a straight line
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = 0.0034 * (0.55 + 0.9 * fract(aSeed * 7.31)) * (1.0 + 0.6 * w);
  gl_PointSize = max(1.5, size * projectionMatrix[1][1] * uScale / -mv.z);
  vAlpha = uFade * (0.35 + 0.65 * fract(aSeed * 3.17)) * smoothstep(0.0, 0.05, uT - aDelay);
  vAlpha *= 1.0 - uSink * smoothstep(0.55, 1.0, e);          // flowing back into the orb, it is absorbed
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

const ZERO = new THREE.Vector3();

export class Particles {
  constructor(count = 4200) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.start = new Float32Array(count * 3);
    this.end = new Float32Array(count * 3);
    this.delay = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(this.start, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(this.end, 3));
    g.setAttribute('aDelay', new THREE.BufferAttribute(this.delay, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uT: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 }, uScale: { value: 500 },
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uSink: { value: 0 },
    };
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
    this.t = 1; this.duration = 1; this.fadeOut = 0.35; this.active = false;
    this.liveA = null; this.liveB = null;
  }

  // starts / ends: arrays of THREE.Vector3 in the parent's space.
  // from / to: a moving THREE.Vector3 (the orb). When given, that side is a small cloud around it.
  // ordered: the nearest targets are served first, so the card grows outwards from the source.
  fly(starts, ends, { duration = 1, from = null, to = null, ordered = false, spread = 0.07 } = {}) {
    const cloud = (out) => {                      // a point inside a ball of radius `spread`
      do out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); while (out.lengthSq() > 1);
      return out.multiplyScalar(spread);
    };
    const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    const pick = (list) => list[(Math.random() * list.length) | 0];
    const source = from || (ordered && starts.length ? starts[0] : null);
    let near = Infinity, far = 0;
    const dist = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      if (from) cloud(a); else a.copy(pick(starts));
      if (to) cloud(b); else b.copy(pick(ends));
      this.start.set([a.x, a.y, a.z], i * 3);
      this.end.set([b.x, b.y, b.z], i * 3);
      if (ordered && source) { dist[i] = v.copy(to ? a : b).distanceTo(to || source); near = Math.min(near, dist[i]); far = Math.max(far, dist[i]); }
    }
    for (let i = 0; i < this.count; i++) {
      const order = ordered && far > near ? (dist[i] - near) / (far - near) : Math.random();
      // Leaving the orb: near targets first. Returning to it: near particles first.
      this.delay[i] = ordered ? order * 0.40 + Math.random() * 0.10 : order * 0.36;
    }
    const g = this.points.geometry;
    g.attributes.aStart.needsUpdate = true; g.attributes.aEnd.needsUpdate = true; g.attributes.aDelay.needsUpdate = true;
    this.liveA = from; this.liveB = to;
    this.uniforms.uA.value.copy(from || ZERO); this.uniforms.uB.value.copy(to || ZERO);
    this.uniforms.uSink.value = to ? 1 : 0;
    this.t = 0; this.duration = duration; this.active = true;
    this.uniforms.uT.value = 0; this.uniforms.uFade.value = 1;
    this.points.visible = true;
  }

  // 0..1 while flying, 1 when idle.
  get flight() { return this.active ? Math.min(this.t / this.duration, 1) : 1; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const u = this.uniforms;
    u.uTime.value += dt;
    if (this.liveA) u.uA.value.copy(this.liveA);
    if (this.liveB) u.uB.value.copy(this.liveB);
    u.uT.value = Math.min(this.t / this.duration, 1);
    const tail = Math.max(0, (this.t - this.duration * 0.9) / this.fadeOut);
    u.uFade.value = Math.max(0, 1 - tail);
    if (tail >= 1) { this.active = false; this.points.visible = false; }
  }
}
