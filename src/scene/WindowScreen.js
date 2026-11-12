import * as THREE from 'three';

// What a window becomes when it is used as the display: a dark sheet of glass that covers it edge to
// edge, a border lit in the colour of the assistant's state (the orb is gone, so the frame speaks for
// it), and a soft spill of light on the wall around it. It lives in unit coordinates: x = 0..1 across,
// y = 0..−1 down; the stage gives it the matrix that lands those on the four corners of the window.
const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PLATE = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uOpacity;
uniform float uTime;
uniform float uAspect;
uniform vec3 uState;
void main() {
  vec3 col = mix(vec3(0.010, 0.030, 0.062), vec3(0.020, 0.058, 0.108), vUv.y);
  vec2 g = vUv * vec2(uAspect, 1.0) * 12.0;
  float grid = max(smoothstep(0.965, 1.0, fract(g.x)), smoothstep(0.965, 1.0, fract(g.y)));
  col += vec3(0.10, 0.32, 0.55) * grid * 0.16;
  vec2 d = min(vUv, 1.0 - vUv) * vec2(uAspect, 1.0);
  float edge = min(d.x, d.y);
  float rim = smoothstep(0.030, 0.0, edge), line = smoothstep(0.008, 0.0, edge);
  col += uState * (rim * 0.55 + line * 0.9) * (0.82 + 0.18 * sin(uTime * 2.2));
  gl_FragColor = vec4(col, uOpacity * 0.95);
  #include <colorspace_fragment>
}`;

const GLOW = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uOpacity;
uniform vec3 uState;
void main() {
  vec2 p = (vUv - 0.5) * 1.6;                       // the plane is 1.6× the window; ±0.5 is its edge
  float d = length(max(abs(p) - 0.5, 0.0));
  float a = exp(-d * 11.0) * 0.30 * uOpacity * step(0.0001, d);
  gl_FragColor = vec4(mix(vec3(0.20, 0.55, 1.0), uState, 0.5), a);
}`;

export class WindowScreen {
  constructor() {
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.uniforms = { uOpacity: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1.6 }, uState: { value: new THREE.Color('#59e6d0') } };
    const plane = (size, frag, order, blending) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending,
      }));
      m.position.set(0.5, -0.5, 0); m.renderOrder = order; m.frustumCulled = false;
      return m;
    };
    this.glow = plane(1.6, GLOW, 8, THREE.AdditiveBlending);
    this.plate = plane(1, PLATE, 9, THREE.NormalBlending);
    this.group.add(this.glow, this.plate);
    this.opacity = 0; this.target = 0;
  }

  update(dt, time, stateColor) {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt * 4));
    this.uniforms.uOpacity.value = this.opacity;
    this.uniforms.uTime.value = time;
    if (stateColor) this.uniforms.uState.value.lerp(stateColor, 1 - Math.exp(-dt * 5));
    this.group.visible = this.opacity > 0.01;
  }
}
