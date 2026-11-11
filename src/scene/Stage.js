import * as THREE from 'three';
import { Orb } from './Orb.js';
import { Panel, PANEL_W } from './Panel.js';
import { Particles } from './Particles.js';
import { Caption } from './Caption.js';
import { Pointer } from '../input/Pointer.js';

const ORB_R = 0.1;

// Where things sit inside the rig (metres, rig origin ≈ centre of the composition, top of the card at y = top).
const LAYOUTS = {
  side:  { orb: [-0.43, 0.02, 0.06], panel: [-0.27, 0.27, 0], caption: [0.13, 0.36, 0.02], left: -0.55, right: 0.55, top: 0.42 },
  stack: { orb: [-0.29, 0.26, 0.05], panel: [-0.40, 0.12, 0], caption: [0.11, 0.26, 0.02], left: -0.42, right: 0.42, top: 0.39 },
};

// The stage owns the three.js scene: orb, panel, swarm, caption, pointer, and where they stand in the room.
export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.02, 30);
    this.scene.add(this.camera);

    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.orb = new Orb(ORB_R);
    this.panel = new Panel();
    this.swarm = new Particles();
    this.caption = new Caption();
    this.rig.add(this.orb.group, this.panel.group, this.swarm.points, this.caption.mesh);

    this.cursor = new THREE.Mesh(
      new THREE.PlaneGeometry(0.014, 0.014),
      new THREE.MeshBasicMaterial({ color: 0xffc552, depthTest: false, transparent: true }),
    );
    this.cursor.rotation.z = Math.PI / 4; this.cursor.renderOrder = 28; this.cursor.visible = false;
    this.panel.group.add(this.cursor);

    this.pointer = new Pointer(this.renderer, this.camera, this.scene, canvas);
    this.raycaster = new THREE.Raycaster();
    this.onPress = () => {}; this.onHover = () => {};
    this.pointer.onSelect = (ray) => this._select(ray);

    this.mode = 'preview';            // preview | camera | xr
    this.layout = 'side';
    this.pinned = false;
    this.voiceState = 'idle';
    this.time = 0;
    this._placed = false; this._xrFrames = 0; this._away = 0;
    this._goalPos = new THREE.Vector3(0, 0, -1.4); this._goalYaw = 0;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3();
    this.gyro = null;                 // set by enableGyro()
    this.parallax = new THREE.Vector2();
    this._look = new THREE.Vector3(0, 0, -1.4);
    this._applyLayout();
    this.resize();
  }

  // ---- layout ---------------------------------------------------------------
  _applyLayout() {
    const L = LAYOUTS[this.layout];
    this.orb.group.position.set(...L.orb);
    this.panel.group.position.set(...L.panel);
    this.panel.group.rotation.y = this.layout === 'side' ? -0.10 : 0;
    this.caption.mesh.position.set(...L.caption);
    this.caption.mesh.scale.setScalar(this.layout === 'side' ? 1 : 0.86);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A long lens for the preview (flat, legible); close to a phone camera when the camera feed is the backdrop.
    const portrait = w < h;
    this.camera.fov = this.mode === 'camera' ? (portrait ? 62 : 42) : (portrait ? 40 : 30);
    this.camera.updateProjectionMatrix();
    const layout = w < h * 0.9 ? 'stack' : 'side';
    if (layout !== this.layout) { this.layout = layout; this._applyLayout(); }
  }

  // Bounds of what must stay in view, in rig space.
  _bounds() {
    const L = LAYOUTS[this.layout], o = this.orb.group.position;
    if (!(this.panel.group.visible && this.panel.openTarget)) {      // the orb alone: keep it centred
      return { left: o.x - 0.55, right: o.x + 0.55, top: o.y + 0.36, bottom: o.y - 0.3 };
    }
    return { left: L.left, right: L.right, top: L.top, bottom: this.panel.group.position.y - this.panel.physicalHeight - 0.03 };
  }

  // Without head tracking the app frames the composition itself, like a camera operator.
  _frameForScreen(dt) {
    const b = this._bounds(), t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const H = innerHeight, padTop = 54, padBottom = 96;            // room for the HUD bars
    const usable = Math.max(0.4, (H - padTop - padBottom) / H);
    const w = b.right - b.left, h = b.top - b.bottom;
    const dist = Math.max(h / 2 / (t * usable), w / 2 / (t * this.camera.aspect)) * 1.05 + 0.1;
    const lift = ((padBottom - padTop) / H) * t * dist;            // centre of the usable area, in metres
    this._goalPos.set(-(b.left + b.right) / 2, -(b.top + b.bottom) / 2 + lift, -dist);
    this._look.set(0, lift, -dist);
    const k = this._placed ? 1 - Math.exp(-dt * 5) : 1;
    this.rig.position.lerp(this._goalPos, k);
    this.rig.rotation.y = 0;
    this._placed = true;
  }

  // In a headset or phone AR the rig stands in the room, in front of where the user was looking.
  _placeInRoom() {
    const cam = this.camera;
    cam.getWorldPosition(this._v); cam.getWorldDirection(this._f);
    this._f.y = 0;
    if (this._f.lengthSq() < 1e-4) this._f.set(0, 0, -1);
    this._f.normalize();
    const dist = this.layout === 'side' ? 1.15 : 1.35;
    this._goalPos.copy(this._v).addScaledVector(this._f, dist);
    this._goalPos.y = this._v.y - 0.12;
    this._goalYaw = Math.atan2(-this._f.x, -this._f.z);
  }

  recenter() { this._placeInRoom(); }
  setPinned(on) { this.pinned = on; }

  _followInRoom(dt) {
    if (!this._placed) {
      if (++this._xrFrames < 4) return;           // wait for the first real head pose
      this._placeInRoom();
      this.rig.position.copy(this._goalPos); this.rig.rotation.y = this._goalYaw;
      this._placed = true;
      return;
    }
    if (!this.pinned) {                            // lazy follow: come back after the user has turned away for a while
      const cam = this.camera;
      cam.getWorldPosition(this._v); cam.getWorldDirection(this._f);
      const to = this.rig.position.clone().sub(this._v);
      const far = to.length() > 2.6;
      to.y = 0; this._f.y = 0;
      const angle = to.lengthSq() && this._f.lengthSq() ? to.angleTo(this._f) : 0;
      this._away = angle > 1.0 || far ? this._away + dt : 0;
      if (this._away > 1.4) { this._placeInRoom(); this._away = 0; }
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.rig.position.lerp(this._goalPos, k);
    let d = this._goalYaw - this.rig.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rig.rotation.y += d * k;
  }

  // ---- what the brain asks for ----------------------------------------------
  // Open a view. The swarm leaves the orb (or the old chart) and settles on the new one.
  show(view, fromOrb = true) {
    const old = !fromOrb && this.panel.group.visible ? this.panel.sampleInk(this.rig) : [];
    this.panel.setView(view);
    this.panel.show();
    this._swarmTo(old.length ? old : null);
  }

  // Same view, new content: the old ink dissolves into the new one.
  morph() {
    const old = this.panel.sampleInk(this.rig);
    this.panel.redraw();
    this._swarmTo(old.length ? old : null);
  }

  refresh() { this.panel.invalidate(); }

  hide() {
    const ink = this.panel.sampleInk(this.rig);
    this.panel.hide();
    if (ink.length) { this.swarm.fly(ink, [this.orb.group.position.clone()], 0.7); }
  }

  _swarmTo(starts) {
    const ends = this.panel.sampleInk(this.rig);
    this.panel.reveal = 0; this.panel.revealTarget = 1;
    if (!ends.length) { this.panel.holdData = false; return; }
    const o = this.orb.group.position, r = ORB_R * 0.8;
    const fromOrb = () => new THREE.Vector3(o.x + (Math.random() - 0.5) * r, o.y + (Math.random() - 0.5) * r, o.z + (Math.random() - 0.5) * r);
    this.panel.holdData = true;
    this.swarm.fly(starts || fromOrb, ends, starts ? 0.95 : 1.25);
  }

  get busy() { return this.swarm.active; }

  // ---- pointing ---------------------------------------------------------------
  _probe(ray) {
    this.raycaster.ray.copy(ray);
    this._v.copy(this.orb.group.position); this.rig.localToWorld(this._v);
    const sphere = new THREE.Sphere(this._v, ORB_R * 1.25);
    const orbHit = ray.intersectSphere(sphere, this._f) ? ray.origin.distanceTo(this._f) : Infinity;
    const p = this.panel.raycast(this.raycaster);
    if (p && p.distance < orbHit) return { ...p, target: this.panel.kit.hit(p.x, p.y), onPanel: true };
    if (orbHit < Infinity) return { distance: orbHit, target: { id: 'orb' }, onPanel: false };
    return null;
  }

  _select(ray) {
    const hit = this._probe(ray);
    if (hit && hit.target) this.onPress(hit.target);
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
    if (xr) this._followInRoom(dt);
    else {
      if (this.gyro) this.gyro(this.camera);
      this._frameForScreen(dt);
      if (!this.gyro) {                            // orbit a little around the composition: depth without losing the framing
        this.camera.position.set(this.parallax.x * 0.07, -this.parallax.y * 0.04, 0);
        this.camera.lookAt(this._look);
      }
    }

    const landed = this.swarm.update(dt);
    if (this.panel.holdData && (!this.swarm.active || landed > 0)) this.panel.holdData = false;
    this.orb.setState(this.swarm.active ? 'thinking' : this.voiceState);
    const speaking = this.voiceState === 'speaking';
    this.orb.level = speaking ? 0.35 + 0.65 * Math.abs(Math.sin(this.time * 9.1) * Math.sin(this.time * 3.7 + 1)) : this.voiceState === 'listening' ? 0.25 + 0.2 * Math.sin(this.time * 3) : 0;
    this.orb.update(dt);
    this.caption.update(dt);
    this.panel.update(dt, this.time);
    this._hover();
    this.renderer.render(this.scene, this.camera);
  }
}
