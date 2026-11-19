import * as THREE from 'three';

// What a window becomes when it is used as the display: a pane of the same frosted glass as the
// floating display (smoky grey-teal, a fine etched grid, a thin double outline, bars of light on its top
// and bottom edges), dense enough to hide the daylight behind it. The orb is gone, so the bars of light
// carry its state colour. A soft spill of light on the wall around it. It lives in unit coordinates:
// x = 0..1 across, y = 0..−1 down; the stage gives it the matrix that lands those on the window's corners.
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
// Distance to a rounded rectangle centred at 0 with half-size b and corner radius r (negative inside).
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);                       // in units of the window's height
  vec2 hs = vec2(uAspect, 1.0) * 0.5;
  vec3 col = mix(vec3(0.026, 0.060, 0.066), vec3(0.040, 0.088, 0.096), vUv.y);
  // The etched grid: square cells, about 1/40 of the height.
  vec2 g = vUv * vec2(uAspect, 1.0) * 40.0;
  vec2 fw = fwidth(g);
  vec2 cell = fract(g);
  vec2 l = 1.0 - smoothstep(vec2(0.0), fw * 1.2, min(cell, 1.0 - cell));
  col += vec3(0.55, 0.75, 0.76) * max(l.x, l.y) * 0.05;
  // The double outline.
  float px = fwidth(p.y);
  float outer = 1.0 - smoothstep(0.0, px * 2.0, abs(box(p, hs - 0.010, 0.05)));
  float inner = 1.0 - smoothstep(0.0, px * 1.5, abs(box(p, hs - 0.034, 0.035)));
  float halo = exp(-abs(box(p, hs - 0.010, 0.05)) * 120.0) * 0.35;
  vec3 teal = vec3(0.47, 0.87, 0.91);
  col += teal * (outer * 0.9 + inner * 0.32 + halo);
  // Bars of light centred on the top and bottom edges, in the colour of the assistant's state.
  float bx = abs(p.x);
  float top = (1.0 - smoothstep(hs.x * 0.36 - px * 2.0, hs.x * 0.36, bx)) * (1.0 - smoothstep(0.004, 0.004 + px * 2.0, abs(p.y - (hs.y - 0.010))));
  float bot = (1.0 - smoothstep(hs.x * 0.30 - px * 2.0, hs.x * 0.30, bx)) * (1.0 - smoothstep(0.004, 0.004 + px * 2.0, abs(p.y + (hs.y - 0.010))));
  vec3 bar = mix(uState, vec3(1.0), 0.35) * (0.88 + 0.12 * sin(uTime * 2.2));
  col = mix(col, bar, clamp(top + bot, 0.0, 1.0));
  float barGlow = exp(-abs(p.y - (hs.y - 0.010)) * 70.0) * (1.0 - smoothstep(hs.x * 0.30, hs.x * 0.46, bx))
                + exp(-abs(p.y + (hs.y - 0.010)) * 70.0) * (1.0 - smoothstep(hs.x * 0.24, hs.x * 0.40, bx));
  col += uState * barGlow * 0.35;
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
  gl_FragColor = vec4(mix(vec3(0.35, 0.85, 0.90), uState, 0.4), a);
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
