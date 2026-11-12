import * as THREE from 'three';

// One pointing model for every device:
//   headset   – controller or hand ray (WebXR 'tracked-pointer'), trigger / pinch = select
//   phone AR  – a tap casts a ray from the touch point (WebXR 'screen' input)
//   no WebXR  – mouse or touch on the canvas
// The app asks for `rays()` each frame (hover) and receives `onSelect(ray)` for clicks.
export class Pointer {
  constructor(renderer, camera, scene, dom) {
    this.renderer = renderer; this.camera = camera; this.dom = dom;
    this.onSelect = () => {};
    this.onDrag = () => {};          // (dx, dy) in pixels: looking around when there is no head tracking
    this.onPinch = () => {};         // (factor): two fingers, zoom
    this.touches = new Map();        // active pointers, to tell a pinch from a tap
    this.raycaster = new THREE.Raycaster();
    this.mouse = { ndc: new THREE.Vector2(), inside: false, downAt: null, last: null, dragging: false };
    this.controllers = [];
    this._m = new THREE.Matrix4();

    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffc552, transparent: true, opacity: 0.85 }),
      );
      line.visible = false; line.renderOrder = 30;
      c.add(line);
      const entry = { object: c, line, mode: null, connected: false };
      c.addEventListener('connected', (e) => { entry.mode = e.data.targetRayMode; entry.connected = true; });
      c.addEventListener('disconnected', () => { entry.connected = false; entry.line.visible = false; });
      c.addEventListener('select', () => this.onSelect(this._controllerRay(entry), entry));
      scene.add(c);
      this.controllers.push(entry);
    }

    dom.addEventListener('pointermove', (e) => {
      this._setMouse(e);
      const m = this.mouse;
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.touches.size === 2 && !renderer.xr.isPresenting) {          // pinch
        const [a, b] = [...this.touches.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (m.gap) this.onPinch(gap / m.gap);
        m.gap = gap; m.dragging = true;                                    // and it will not count as a tap
        return;
      }
      if (!m.downAt || renderer.xr.isPresenting) return;
      if (!m.dragging && Math.hypot(e.clientX - m.downAt[0], e.clientY - m.downAt[1]) > 10) m.dragging = true;
      if (m.dragging) this.onDrag(e.clientX - m.last[0], e.clientY - m.last[1]);
      m.last = [e.clientX, e.clientY];
    });
    dom.addEventListener('pointerdown', (e) => {
      this._setMouse(e);
      this.touches.set(e.pointerId, [e.clientX, e.clientY]);
      this.mouse.gap = 0;
      this.mouse.downAt = [e.clientX, e.clientY]; this.mouse.last = [e.clientX, e.clientY]; this.mouse.dragging = this.touches.size > 1;
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    dom.addEventListener('pointercancel', (e) => { this.touches.delete(e.pointerId); this.mouse.downAt = null; this.mouse.dragging = false; });
    dom.addEventListener('pointerup', (e) => {
      this.touches.delete(e.pointerId);
      const d = this.mouse.downAt, dragged = this.mouse.dragging;
      if (this.touches.size) { this.mouse.last = [...this.touches.values()][0]; return; }   // one finger of a pinch is still down
      this.mouse.downAt = null; this.mouse.dragging = false;
      if (!d || renderer.xr.isPresenting || dragged) return;              // a drag is a look, not a tap
      this._setMouse(e);
      this.onSelect(this._mouseRay(), null);
      if (e.pointerType !== 'mouse') this.mouse.inside = false;          // no hover after a touch
    });
  }

  _setMouse(e) {
    const r = this.dom.getBoundingClientRect();
    this.mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.mouse.inside = true;
  }

  _mouseRay() {
    this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  _controllerRay(entry) {
    entry.object.updateMatrixWorld();
    this._m.identity().extractRotation(entry.object.matrixWorld);
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(entry.object.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(this._m).normalize();
    return ray;
  }

  // Rays that can hover right now. Each item: { ray, entry } (entry is null for the mouse).
  rays() {
    const out = [];
    if (this.renderer.xr.isPresenting) {
      for (const entry of this.controllers) {
        const tracked = entry.connected && entry.mode === 'tracked-pointer' && entry.object.visible;
        entry.line.visible = tracked;
        if (tracked) out.push({ ray: this._controllerRay(entry), entry });
      }
    } else if (this.mouse.inside) {
      out.push({ ray: this._mouseRay(), entry: null });
    }
    return out;
  }

  // Shorten or lengthen the visible ray of a controller to where it lands.
  setRayLength(entry, length) {
    if (entry) entry.line.scale.z = length;
  }
}
