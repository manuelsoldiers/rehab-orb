import * as THREE from 'three';

// The floor under the orb and the display. Nothing of it is drawn but what lands on it:
//   - their shadows, from a light high above them and a little to the front-left, as the display faced
//     when it was summoned: the shadows fall under and just behind the objects, where the eye looks for
//     them (soft, and in their shape: the orb's threads and orbits, the display's outline and text, a
//     faint shade for the glass itself);
//   - two pools of light: the orb's colour under the orb, the cyan of the light bar under the display.
// Seeing where an object's shadow falls is what tells the eye how high and how far away it is.
const LIGHT_DIR = new THREE.Vector3(-0.28, 1, 0.52).normalize();    // towards the light, in the display's frame (+z = the user)
const SPAN = 1.6;                                                    // half-width of the shadow camera (m)

// The light shade of glass: the display's card (its own alpha, blurred) projected along the light.
const SHADE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHADE_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform float uOpacity;
void main() {
  float a = texture2D(map, vUv * uRepeat + uOffset, 2.5).a;
  gl_FragColor = vec4(0.02, 0.06, 0.07, smoothstep(0.08, 0.45, a) * uOpacity);
}`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Preview only (no camera picture behind the scene): a faint floor grid, so the eye has a floor to
// read distances on. On a phone or in AR the real floor does that.
const GRID_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
uniform vec3 uCentre;
uniform float uOpacity;
void main() {
  vec2 g = vWorld.xz / 0.5;
  vec2 fw = fwidth(g);
  vec2 l = 1.0 - smoothstep(vec2(0.0), fw * 1.5, abs(fract(g - 0.5) - 0.5));
  float line = max(l.x, l.y);
  float fade = 1.0 - smoothstep(1.5, 6.0, length(vWorld.xz - uCentre.xz));
  gl_FragColor = vec4(vec3(0.85, 0.80, 0.70), line * fade * uOpacity);
}`;
const GRID_VERT = /* glsl */`
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export class Ground {
  constructor(scene) {
    this.y = -1.35;                  // floor height; the stage sets it (estimated, or measured in AR)
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ color: 0x06121a, opacity: 0.66, transparent: true, depthWrite: false }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.renderOrder = 2;

    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(2048, 2048);
    s.radius = 4;                    // PCF softness, in shadow-map texels
    s.bias = -0.0004;
    s.camera.left = -SPAN; s.camera.right = SPAN; s.camera.top = SPAN; s.camera.bottom = -SPAN;
    s.camera.near = 0.05; s.camera.far = 8;
    scene.add(this.light, this.light.target);

    const tex = glowTexture();
    const pool = (w, h, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 3;
      return m;
    };
    this.orbPool = pool(0.7, 0.7, 0xff80d0);
    this.orbShade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.orbShade.rotation.x = -Math.PI / 2; this.orbShade.renderOrder = 2.5;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    g.setIndex([0, 3, 1, 1, 3, 2]);
    this.panelShade = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { map: { value: null }, uRepeat: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() }, uOpacity: { value: 0 } },
    }));
    this.panelShade.frustumCulled = false; this.panelShade.renderOrder = 2.5; this.panelShade.visible = false;
    this.panelPool = pool(1.0, 0.36, 0x74e6f2);
    this.gridUniforms = { uCentre: { value: new THREE.Vector3() }, uOpacity: { value: 0.16 } };
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({
      vertexShader: GRID_VERT, fragmentShader: GRID_FRAG, uniforms: this.gridUniforms, transparent: true, depthWrite: false,
    }));
    this.grid.rotation.x = -Math.PI / 2; this.grid.renderOrder = 1; this.grid.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.grid, this.floor, this.orbShade, this.panelShade, this.orbPool, this.panelPool);
    scene.add(this.group);
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.yaw = 0;
  }

  // The display's texture and its visible part (shared with Panel), for the glass shade.
  setPanelTexture(tex, repeat, offset) {
    const u = this.panelShade.material.uniforms;
    u.map.value = tex; u.uRepeat.value = repeat; u.uOffset.value = offset;
  }

  // Where a point lands on the floor, along the light.
  _project(p, out) {
    const d = this._dir, t = (p.y - this.y) / d.y;
    return out.set(p.x - d.x * t, this.y + 0.003, p.z - d.z * t);
  }

  // focus: where the shadow camera should look (between the orb and the display), in world space.
  // yaw: which way the scene faces (the display once placed, else the camera), eased.
  // corners: the display's four corners in world space (TL, TR, BR, BL), or null; open: 0..1.
  update(focus, orb, orbColor, panelBottom, yaw, corners = null, open = 0) {
    let dy = yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * 0.05;
    this.floor.position.set(focus.x, this.y, focus.z);
    this.grid.position.set(0, this.y - 0.001, 0);
    this.gridUniforms.uCentre.value.copy(focus);
    // Only the patch of floor the light covers moves with the objects.
    this._dir.copy(LIGHT_DIR).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.light.target.position.set(focus.x, this.y + 0.6, focus.z);
    this.light.position.copy(this.light.target.position).addScaledVector(this._dir, 4);
    this.light.target.updateMatrixWorld();

    // The glass's light shade: the card projected onto the floor.
    this.panelShade.visible = !!corners;
    if (corners) {
      const pos = this.panelShade.geometry.attributes.position;
      corners.forEach((c, i) => { this._project(c, this._v); pos.setXYZ(i, this._v.x, this._v.y, this._v.z); });
      pos.needsUpdate = true;
      this.panelShade.material.uniforms.uOpacity.value = 0.30 * open;
    }
    // The bubble's: a soft disc where its centre lands.
    if (orb.visible) {
      const c = orb.getWorldPosition(this._v), h = Math.max(0.1, c.y - this.y);
      this._project(c, this.orbShade.position);
      this.orbShade.scale.set(0.22 + h * 0.05, (0.22 + h * 0.05) / Math.max(0.5, this._dir.y), 1);
      this.orbShade.rotation.z = this.yaw;
      this.orbShade.material.opacity = 0.32 * orb.scale.x;
    } else this.orbShade.material.opacity = 0;

    // Pools of light: brighter and tighter the closer the source is to the floor.
    const glow = (mesh, src, strength, base) => {
      if (!src) { mesh.material.opacity += (0 - mesh.material.opacity) * 0.2; return; }
      const h = Math.max(0.15, src.y - this.y);
      mesh.position.set(src.x, this.y + 0.002, src.z);
      mesh.scale.setScalar(0.6 + h * 0.55);
      mesh.material.opacity += (Math.min(0.6, strength / (h * h + 0.3)) - mesh.material.opacity) * 0.15;
      if (base) mesh.material.color.copy(base);
    };
    glow(this.orbPool, orb.visible ? orb.getWorldPosition(this._v) : null, orb.visible ? 0.22 * orb.scale.x : 0, orbColor);
    glow(this.panelPool, panelBottom, 0.12, null);
    if (panelBottom) this.panelPool.rotation.z = panelBottom.yaw ?? 0;
  }
}
