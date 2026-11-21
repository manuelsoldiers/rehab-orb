import * as THREE from 'three';
import { Orb } from './Orb.js';
import { Panel, PANEL_W } from './Panel.js';
import { Particles } from './Particles.js';
import { Caption } from './Caption.js';
import { Pointer } from '../input/Pointer.js';
import { Ground } from './Ground.js';

const ORB_R = 0.1;
const TAP_Y = 0.27;          // metres from the top of the canvas to the centre of a base card: the tap lands there
const XR_REACH = 1.25;       // metres from the eyes to a summoned display, in AR
const rad = THREE.MathUtils.degToRad;

// The stage owns the three.js scene. Two things live in it:
//   the display stays in the room where it was summoned, floating a few millimetres up and down;
//   the orb     follows the camera, a little late and never quite still, until a display is placed:
//               then it settles beside the display and stays there too, so both are anchored in the
//               room and you can walk round them. When the display is closed it follows you again.
// Both cast shadows on the floor (see Ground.js).
export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));     // the quality level sets it again
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.02, 40);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.orb = new Orb(ORB_R);
    this.panel = new Panel();
    this.panel.setRenderer(this.renderer);
    this.swarm = new Particles();
    this.caption = new Caption();
    this.anchor = new THREE.Group();              // where the display was summoned, and how it faces the user
    this.anchor.rotation.order = 'YXZ';
    this.anchor.add(this.panel.group);
    this.scene.add(this.anchor, this.orb.group, this.swarm.points, this.caption.mesh);

    this.cursor = new THREE.Mesh(
      new THREE.PlaneGeometry(0.014, 0.014),
      new THREE.MeshBasicMaterial({ color: 0x74e6f2, depthTest: false, transparent: true }),
    );
    this.cursor.rotation.z = Math.PI / 4; this.cursor.renderOrder = 28; this.cursor.visible = false;
    this.panel.group.add(this.cursor);

    this.pointer = new Pointer(this.renderer, this.camera, this.scene, canvas);
    this.raycaster = new THREE.Raycaster();
    this.onPress = () => {}; this.onHover = () => {}; this.onEmptyTap = () => {};
    this.pointer.onSelect = (ray) => this._select(ray);
    this.pointer.onDrag = (dx, dy) => this._look(dx, dy);
    this.pointer.onPinch = (factor) => this.zoomBy(factor);

    this.mode = 'preview';            // preview | camera | xr
    this.placed = false;              // the display has a place in the room
    this.voiceState = 'idle';
    this.time = 0;
    this.look = { yaw: 0, pitch: 0 }; // preview only: where the "phone" points
    this.walk = new THREE.Vector3();  // preview only: where the "phone" is (WASD / arrow keys)
    this.walkInput = { x: 0, z: 0 };
    this.ground = new Ground(this.scene);
    this.ground.setPanelTexture(this.panel.chrome.tex, this.panel.dataUniforms.uRepeat.value, this.panel.dataUniforms.uOffset.value);
    this.EYE = 1.35;                  // without tracking, the phone is assumed to be this high above the floor
    this.hitSource = null;            // AR: a hit-test source that finds the real floor
    this._floorKnown = false;
    this.zoom = 1;
    this.gyro = null;                 // set by enableGyro()
    this._xrFrames = 0; this._orbReady = false; this._replace = false;
    this._orbVel = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.resize();
  }

  // ---- view -------------------------------------------------------------------
  resize() {
    const w = innerWidth, h = innerHeight, portrait = w < h;
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Close to a phone camera when its feed is the backdrop; a slightly longer lens for the preview.
    const fov = this.mode === 'camera' ? (portrait ? 62 : 42) : (portrait ? 54 : 38);
    this.camera.fov = THREE.MathUtils.clamp(fov / this.zoom, 16, 75);
    this.camera.updateProjectionMatrix();
  }

  zoomBy(factor) { this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.7, 2.6); this.resize(); }

  _look(dx, dy) {
    if (this.mode !== 'preview') return;          // with a gyroscope or a headset, the device does the looking
    const k = rad(this.camera.fov) / innerHeight;
    this.look.yaw += dx * k; this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dy * k, -1.1, 1.1);
  }

  // Half-angles of the view as tangents, whatever produced the projection (our lens or the headset's).
  _tan() {
    const e = this.camera.projectionMatrix.elements;
    return { x: 1 / e[0], y: 1 / e[5] };
  }

  // How far away a summoned display stands. In AR it is a real distance; on a plain screen it is
  // chosen so the card is comfortably readable through the lens.
  get reach() {
    if (this.renderer.xr.isPresenting) return XR_REACH;
    const t = this._tan(), base = this.camera.fov * this.zoom;       // independent of the zoom
    const k = Math.tan(rad(base / 2)) / t.y;
    return Math.max(PANEL_W / (2 * t.x * k * 0.84), 0.6 / (2 * t.y * k * 0.6));
  }

  // A point given in view fractions (−1..1 across the screen) at `depth` metres, in world space.
  _viewPoint(fx, fy, depth, maxX, maxY, out) {
    const t = this._tan();
    out.set(Math.sign(fx) * Math.min(Math.abs(fx) * t.x, maxX) * depth, Math.sign(fy) * Math.min(Math.abs(fy) * t.y, maxY) * depth, -depth);
    return this.camera.localToWorld(out);
  }

  // ---- the orb follows the camera -------------------------------------------------
  // Beside the display, on its left, a little in front of it: where the orb rests once it is anchored.
  get anchored() { return this.placed && this.panel.isOpen && !this.orbGone; }

  _followOrb(dt) {
    const depth = this.reach * 0.76, t = this.time, tan = this._tan(), anchored = this.anchored;
    let target;
    if (anchored) {
      target = this.anchor.localToWorld(this._v.set(-PANEL_W / 2 - 0.15, TAP_Y - 0.07, 0.10));
      this._f.set(Math.sin(t * 0.83) * 0.012, Math.sin(t * 1.1 + 1.3) * 0.02, Math.sin(t * 0.57 + 0.4) * 0.008);   // it floats
    } else {
      target = this._viewPoint(-0.48, 0.26, depth, Math.tan(rad(13)), Math.tan(rad(7)), this._v);
      // It never hangs dead still: a slow drift of a few centimetres around its spot.
      this._f.set(Math.sin(t * 0.83) * 0.022, Math.sin(t * 1.21 + 1.3) * 0.026, Math.sin(t * 0.57 + 0.4) * 0.012).applyQuaternion(this.camera.getWorldQuaternion(this._q));
    }
    target.add(this._f);
    const p = this.orb.group.position;
    if (!this._orbReady || p.distanceTo(target) > 4) { p.copy(target); this._orbVel.set(0, 0, 0); this._orbReady = true; return; }
    // A soft, slightly under-damped spring. When the camera moves the orb is left behind in the room,
    // then glides after it and settles with a small overshoot: you see it follow. The leash keeps
    // it from being lost off-screen on a fast turn: the further it falls behind, the harder it is pulled.
    const omega = 2.6, zeta = 0.62;
    const leash = depth * Math.min(tan.x, 0.6) * 0.75;
    for (let left = Math.min(dt, 0.1); left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this._f.copy(target).sub(p);
      const pull = anchored ? 1 : 1 + (this._f.length() / leash) ** 2;
      this._f.multiplyScalar(omega * omega * pull).addScaledVector(this._orbVel, -2 * zeta * omega * Math.sqrt(pull));
      this._orbVel.addScaledVector(this._f, h);
      p.addScaledVector(this._orbVel, h);
    }
    // However fast the turn, most of the orb stays in view: the edge of the screen carries it along.
    // (Only while it is in front of the camera: after an about-turn the spring alone brings it round.)
    const local = this.camera.worldToLocal(this._f.copy(p)), z = -local.z;
    const lx = z * tan.x * 0.88, ly = z * tan.y * 0.84;
    if (!anchored && z > 0.1 && (Math.abs(local.x) > lx || Math.abs(local.y) > ly)) {
      local.x = THREE.MathUtils.clamp(local.x, -lx, lx); local.y = THREE.MathUtils.clamp(local.y, -ly, ly);
      p.copy(this.camera.localToWorld(local));
    }
  }

  _followCaption(dt) {
    const m = this.caption.mesh, depth = this.reach * 0.8, t = this._tan();
    const target = this._viewPoint(0, 0.74, depth, 1, Math.tan(rad(15)), this._v);
    const width = Math.min(2 * t.x * depth * 0.86, depth * 0.62);       // most of a phone screen; a modest band in a headset
    m.scale.setScalar(width / 0.62);
    const k = this._orbReady && m.position.distanceTo(target) < 3 ? 1 - Math.exp(-dt * 9) : 1;
    m.position.lerp(target, k);
    m.quaternion.slerp(this.camera.getWorldQuaternion(this._q), k);
  }

  // ---- the display stays where it was summoned ------------------------------------
  // The tapped point becomes the centre of the card, `reach` metres along the ray.
  place(ray) {
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const p = this.anchor.position.copy(ray.origin).addScaledVector(ray.direction, this.reach);
    const toCam = cam.sub(p);
    const flat = Math.hypot(toCam.x, toCam.z) || 1;
    // Turned towards the user, then a little further: the far edge swings in, like a monitor angled
    // at the person in front of it. Head-on it would look like a sticker on the lens.
    this.camera.getWorldDirection(this._f);
    const side = this._f.z * toCam.x - this._f.x * toCam.z;            // > 0: the card is on the right of the view
    const yaw = Math.atan2(toCam.x, toCam.z) + rad(side >= -0.02 ? -11 : 11);
    const pitch = -Math.atan2(toCam.y, flat) * 0.6;                    // above the eyes it leans down, below it leans back
    this.anchor.rotation.set(pitch, yaw, 0);
    this.placed = true;
  }

  // No tap to go by (a voice command): just right of where the user is looking.
  _defaultRay() {
    const t = this._tan();
    const dir = new THREE.Vector3(0.1 * Math.min(t.x, 0.6), -0.02 * t.y, -1).normalize().transformDirection(this.camera.matrixWorld);
    return new THREE.Ray(this.camera.getWorldPosition(new THREE.Vector3()), dir);
  }

  // Move an open display to another spot: it dissolves and re-forms there.
  relocate(ray = this._defaultRay()) {
    if (!this.panel.isOpen) { this.place(ray); return; }
    const old = this.panel.sampleInk(this.scene, 1400, true);
    this.place(ray);
    const now = this.panel.sampleInk(this.scene, 1400, true);
    this.panel.open = 0; this.panel.reveal = 0; this.panel.holdOpen = this.panel.holdData = true;
    this.swarm.fly(old, now, { duration: 0.95 });
  }

  recenter() { this.relocate(); }

  // ---- what the brain asks for ----------------------------------------------------
  show(view) {
    if (this.panel.isOpen) {                       // already there: only the content changes
      const old = this.panel.sampleInk(this.scene);
      this.panel.setView(view);
      this._inkTo(old);
      return;
    }
    if (!this.placed) this.place(this._defaultRay());
    this.panel.setView(view);
    this.panel.show();
    // Summoned: the whole card pours out of the orb, nearest parts first, then turns solid.
    const ends = this.panel.sampleInk(this.scene, 1600, true);
    this.panel.open = 0; this.panel.reveal = 0; this.panel.revealTarget = 1;
    this.panel.holdOpen = this.panel.holdData = true;
    this.swarm.fly(null, ends, { duration: 1.7, from: this.orb.group.position, ordered: true, spread: ORB_R * 0.85 });
  }

  // Same view, new content: the old ink dissolves into the new one.
  morph() {
    const old = this.panel.sampleInk(this.scene);
    this.panel.redraw();
    this._inkTo(old);
  }

  _inkTo(old) {
    const ends = this.panel.sampleInk(this.scene);
    this.panel.reveal = 0; this.panel.revealTarget = 1;
    if (!ends.length) { this.panel.holdData = false; return; }
    this.panel.holdData = true;
    if (old.length) this.swarm.fly(old, ends, { duration: 0.95 });
    else this.swarm.fly(null, ends, { duration: 1.2, from: this.orb.group.position, ordered: true, spread: ORB_R });
  }

  refresh() { this.panel.invalidate(); }

  // Dismissed: the card breaks up and flows back into the orb.
  hide() {
    const ink = this.panel.isOpen ? this.panel.sampleInk(this.scene, 1400, true) : [];
    this.panel.hide();
    this.placed = false;
    if (ink.length) this.swarm.fly(ink, null, { duration: 1.0, to: this.orb.group.position, ordered: true, spread: ORB_R * 0.7 });
  }

  get busy() { return this.swarm.active; }

  // Entering or leaving AR changes the coordinate frame: an open display is put back in front.
  frameChanged() {
    this._xrFrames = 0; this._orbReady = false; this._replace = true;
    this._floorKnown = false; this._floorMeasured = false;
    if (!this.renderer.xr.isPresenting) this.hitSource = null;
    this.resize();
  }

  // ---- quality ------------------------------------------------------------------
  // Three levels, so a mid-range phone stays fluid. Nothing about how the app works changes, only how
  // much it draws: screen resolution, particles, shadow detail and the orb's inner layers.
  //   high   – desktop and recent phones
  //   medium – phones start here
  //   low    – if frames still take too long
  setQuality(level) {
    const Q = {
      high:   { ratio: 2, xrScale: 1.0, particles: 4200, shadows: 'full', orb: 2 },
      medium: { ratio: 1.5, xrScale: 0.85, particles: 2600, shadows: 'light', orb: 1 },
      low:    { ratio: 1, xrScale: 0.7, particles: 1500, shadows: 'none', orb: 1 },
    }[level];
    if (!Q) return;
    this.quality = level; this.Q = Q;
    if (!this.renderer.xr.isPresenting) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.ratio));
    this.swarm.setCount(Q.particles);
    this.ground.setShadows(Q.shadows, this.renderer);
    this.orb.setDetail(Q.orb);
    this._slow = 0; this._watch = 0;
    this.onQuality?.(level);
  }

  // Fed with the real time between frames. A frame is slow if it takes clearly longer than the
  // device's own pace (AR on many phones runs at 30 frames a second by design, so that pace is
  // measured, not assumed) or longer than 1/24 s. If most of two seconds is slow frames, step down one
  // level (never back up on its own: no flicker between levels). Single long frames (shaders
  // compiling, the tab coming back) and the first seconds are not counted.
  watchFrame(real) {
    if (this.quality === 'low' || this.qualityPinned || this.time < 3 || real > 0.25) return;
    this._pace = Math.min((this._pace || real) * 1.01, Math.max(real, 1 / 120));   // the fastest recent frames
    const slow = real > Math.max(1 / 40, this._pace * 1.4) || real > 1 / 24;
    this._watch = (this._watch || 0) + real;
    this._slow = (this._slow || 0) + (slow ? real : 0);
    if (this._watch < 2) return;
    const slowShare = this._slow / this._watch;
    this._watch = 0; this._slow = 0;
    if (slowShare > 0.6) this.setQuality(this.quality === 'high' ? 'medium' : 'low');
  }

  // ---- the floor ----------------------------------------------------------------
  // Without tracking the floor is assumed EYE metres below the phone. In AR it starts from the
  // session's floor (or the same guess) and is then measured: whenever the device looks at a level
  // surface well below it, that surface is the floor.
  _updateFloor(xr) {
    if (!xr) { this.ground.y = this.walk.y - this.EYE; return; }
    const camY = this.camera.getWorldPosition(this._v).y;
    if (!this._floorKnown) { this.ground.y = this.xrFloor ? 0 : camY - this.EYE; this._floorKnown = true; }
    const frame = this.renderer.xr.getFrame(), ref = this.renderer.xr.getReferenceSpace();
    if (!frame || !this.hitSource || !ref) return;
    for (const hit of frame.getHitTestResults(this.hitSource)) {
      const pose = hit.getPose(ref); if (!pose) continue;
      const { position: pos, orientation: o } = pose.transform;
      const up = this._f.set(0, 1, 0).applyQuaternion(this._q.set(o.x, o.y, o.z, o.w));
      if (up.y > 0.92 && pos.y < camY - 0.5) {
        this.ground.y += (pos.y - this.ground.y) * (this._floorMeasured ? 0.15 : 1);
        this._floorMeasured = true;
        break;
      }
    }
  }

  _updateGround() {
    const orb = this.orb.group, panelOn = this.panel.group.visible && this.panel.open > 0.3 && !this.panel.locked;
    const focus = this._shadowFocus || (this._shadowFocus = new THREE.Vector3());
    focus.copy(orb.position);
    let bottom = null, corners = null;
    if (panelOn) {
      const h = this.panel.height;
      corners = [[0, 0], [1280, 0], [1280, h], [0, h]].map(([x, y]) => this.panel.toLocal(x, y, this.scene, new THREE.Vector3(), 0));
      const c = this.panel.toLocal(640, this.panel.height / 2, this.scene, this._v.clone());
      focus.lerp(c, 0.6);
      const b = this.panel.toLocal(640, this.panel.height, this.scene, this._v.clone());
      bottom = { x: b.x, y: b.y, z: b.z, yaw: this.anchor.rotation.y };
    }
    // The scene faces the user the way the display did when it was summoned; with no display, the camera.
    let yaw = this.anchor.rotation.y;
    if (!this.placed) { this.camera.getWorldDirection(this._f); yaw = Math.atan2(-this._f.x, -this._f.z); }
    this.ground.grid.visible = this.mode === 'preview';
    this.ground.update(focus, orb, this.orb.uniforms.uA.value, bottom, yaw, corners, this.panel.open);
  }

  // ---- pointing ---------------------------------------------------------------
  // The display wins over the orb: the orb may drift in front of a button, and must not swallow the tap.
  _probe(ray) {
    this.raycaster.ray.copy(ray);
    const p = this.panel.raycast(this.raycaster);
    if (p) return { ...p, target: this.panel.kit.hit(p.x, p.y), onPanel: true };
    const sphere = new THREE.Sphere(this.orb.group.position, ORB_R * 1.25);
    if (ray.intersectSphere(sphere, this._f)) return { distance: ray.origin.distanceTo(this._f), target: { id: 'orb' }, onPanel: false };
    return null;
  }

  _select(ray) {
    const hit = this._probe(ray);
    if (hit && hit.target) return this.onPress(hit.target);
    if (hit || this.panel.near(ray, 0.07)) return;       // on the card between two buttons, or just off its edge
    this.onEmptyTap(ray);
  }

  _hover() {
    let target = null, shown = false;
    for (const { ray, entry } of this.pointer.rays()) {
      const hit = this._probe(ray);
      this.pointer.setRayLength(entry, hit ? hit.distance : 2.5);
      if (!hit) continue;
      if (hit.onPanel) {
        target = hit.target || target;
        this.panel.group.worldToLocal(this._v.copy(hit.point));
        this.cursor.position.set(this._v.x, this._v.y, 0.006);
        shown = true;
      } else target = target || hit.target;
    }
    this.cursor.visible = shown && this.mode !== 'preview';
    document.body.style.cursor = target ? 'pointer' : '';
    this.panel.setHover(target && target.id !== 'orb' ? target : null);
    this.onHover(target);
  }

  // ---- frame ------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const xr = this.renderer.xr.isPresenting;
    if (!xr) {
      if (this.walkInput.x || this.walkInput.z) {                     // preview: walk, in the direction you look
        const s = 1.1 * dt, c = Math.cos(this.look.yaw), n = Math.sin(this.look.yaw);
        this.walk.x += (this.walkInput.x * c + this.walkInput.z * n) * s;
        this.walk.z += (-this.walkInput.x * n + this.walkInput.z * c) * s;
      }
      this.camera.position.copy(this.walk);
      if (this.gyro) this.gyro(this.camera); else this.camera.rotation.set(this.look.pitch, this.look.yaw, 0);
    }
    this.camera.updateMatrixWorld();
    const tracked = !xr || ++this._xrFrames > 4;         // the first AR frames carry no head pose yet
    if (tracked) this._updateFloor(xr);
    if (tracked) {
      this._followOrb(dt);
      this._followCaption(dt);
      if (this._replace) { this._replace = false; if (this.panel.isOpen) this.place(this._defaultRay()); else this.placed = false; }
    }
    // The display floats: a few millimetres up and down, nothing else.
    this.panel.group.position.set(-PANEL_W / 2, TAP_Y + Math.sin(this.time * 1.25) * 0.006, 0);

    this.swarm.update(dt);
    const f = this.swarm.flight;
    if (this.panel.holdOpen && f > 0.62) this.panel.holdOpen = false;
    if (this.panel.holdData && f > 0.84) this.panel.holdData = false;
    this.orb.setState(this.swarm.active ? 'thinking' : this.voiceState);
    const speaking = this.voiceState === 'speaking';
    let level = speaking ? 0.35 + 0.65 * Math.abs(Math.sin(this.time * 9.1) * Math.sin(this.time * 3.7 + 1)) : this.voiceState === 'listening' ? 0.25 + 0.2 * Math.sin(this.time * 3) : 0;
    if (this.swarm.active && this.swarm.liveA) level = Math.max(level, 1 - f);      // it swells while it pours the display out
    this.orb.level = level;
    this.orb.update(dt);
    this.caption.update(dt);
    this.panel.update(dt, this.time);
    this._hover();
    this._updateGround();
    this._frames = (this._frames || 0) + 1;
    if (this._frames % (this.ground.shadowEvery || 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
