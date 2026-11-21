import * as THREE from 'three';
import { Stage } from './scene/Stage.js';
import { Voice } from './voice/Voice.js';
import { Brain } from './brain/Brain.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const stage = new Stage($('stage'));
const voice = new Voice();
const brain = new Brain({ voice, stage, speed: Math.max(1, Number(params.get('speed')) || 1) });
if (params.has('mute')) voice.muted = true;

// Quality: ?quality=high|medium|low pins it; otherwise phones start at medium, other devices at high,
// and the app steps down by itself if frames run slow.
const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const pinnedQuality = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : null;
stage.setQuality(pinnedQuality || (phone ? 'medium' : 'high'));
stage.qualityPinned = !!pinnedQuality;

// ---- wiring ---------------------------------------------------------------
stage.onPress = (target, ray, pt) => {
  // The orb drifts in front of things. If it happens to cover a window the user is tapping, the
  // window wins: the orb can be reached anywhere, the window only there.
  if (target.id === 'orb' && started && !adjusting && !brain.active && pt && stage.vision.ready && stage.findWindowAt(pt.x, pt.y)) { lastTap = ray; return showAdjust(true); }
  brain.press(target);
};
stage.onHover = (target) => brain.hover(target);
// A tap on empty space summons the display there; later taps move it, unless it is pinned.
stage.onEmptyTap = (ray, pt) => {
  if (!started || adjusting || stage.window?.locked) return;
  // Experimental: a tap on a window proposes to turn the window itself into the display.
  if (pt && stage.vision.ready && stage.findWindowAt(pt.x, pt.y)) { lastTap = ray; return showAdjust(true); }
  float(ray);
};
function float(ray) {
  if (!brain.active) { stage.place(ray); brain.open('home'); $('heard').textContent = ''; } else if (!brain.pinned) stage.relocate(ray);
}

// ---- a window as the display (experimental) -----------------------------------
let adjusting = false, lastTap = null;
function showAdjust(on) {
  adjusting = on; $('adjust').hidden = !on;
  if (on) $('heard').textContent = 'Window found. Adjust the corners, then use it.';
}
function drawAdjust() {
  const pts = stage.windowPoints();
  if (!pts) return;
  $('adjust-poly').setAttribute('points', pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
  document.querySelectorAll('#adjust .handle').forEach((el, i) => { el.style.left = `${pts[i][0]}px`; el.style.top = `${pts[i][1]}px`; });
  // The bar sits in the middle of the window, the one place no corner can be.
  const bar = $('adjust-bar');
  bar.style.left = `${Math.min(innerWidth - 12 - bar.offsetWidth / 2, Math.max(12 + bar.offsetWidth / 2, (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4))}px`;
  bar.style.top = `${(pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4}px`;
}
document.querySelectorAll('#adjust .handle').forEach((el) => {
  const i = Number(el.dataset.i);
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) stage.moveWindowCorner(i, e.clientX, e.clientY); });
});
$('adjust-ok').addEventListener('click', () => {
  showAdjust(false);
  if (!stage.lockWindow()) return;
  $('heard').textContent = '';
  if (!brain.active) brain.open('home');
  voice.say('The window is now the display.', { interrupt: false });
});
$('adjust-cancel').addEventListener('click', () => { showAdjust(false); stage.clearWindow(); $('heard').textContent = ''; });
$('adjust-float').addEventListener('click', () => { showAdjust(false); stage.clearWindow(); if (lastTap) float(lastTap); });
voice.onState = (s) => { stage.voiceState = s; $('btn-mic').classList.toggle('on', voice.handsFree); };
voice.onCaption = (text, seconds) => (text ? stage.caption.play(text, seconds) : stage.caption.stop());
voice.onWord = (i) => stage.caption.sync(i);
voice.onHeard = (text, final) => { $('heard').textContent = `Heard: ${text}`; if (final) brain.hear(text, 'voice'); };
voice.onError = (msg) => { $('heard').textContent = msg; };

$('ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('say').value.trim();
  if (!text) return;
  $('say').value = ''; $('heard').textContent = `You: ${text}`;
  brain.hear(text, 'typed');
});
$('btn-mic').disabled = !voice.sttSupported;
$('btn-mic').addEventListener('click', () => { brain.toggleVoice(); $('btn-mic').classList.toggle('on', voice.handsFree); });

// Preview: walk round the scene with WASD or the arrow keys, to see its depth and shadows.
const WALK = { KeyW: ['z', -1], ArrowUp: ['z', -1], KeyS: ['z', 1], ArrowDown: ['z', 1], KeyA: ['x', -1], ArrowLeft: ['x', -1], KeyD: ['x', 1], ArrowRight: ['x', 1] };
const held = new Set();
const walkKeys = () => {
  stage.walkInput.x = 0; stage.walkInput.z = 0;
  for (const code of held) { const [axis, v] = WALK[code]; stage.walkInput[axis] += v; }
};
addEventListener('keydown', (e) => {
  if (!WALK[e.code] || document.activeElement === $('say') || stage.mode !== 'preview') return;
  e.preventDefault(); held.add(e.code); walkKeys();
});
addEventListener('keyup', (e) => { if (held.delete(e.code)) walkKeys(); });
addEventListener('blur', () => { held.clear(); walkKeys(); });

// Space bar = the big button of a running test (+1 lap / +1 stand).
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || document.activeElement === $('say')) return;
  const t = brain.active;
  if (t?.busy) { e.preventDefault(); brain.press({ id: t.id === 'sixmwt' ? 'lap' : 'rep' }); }
});
$('stage').addEventListener('wheel', (e) => { e.preventDefault(); stage.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
addEventListener('resize', () => stage.resize());
// Taps on the HUD must not also fire a WebXR select through the page behind it.
$('hud').addEventListener('beforexrselect', (e) => e.preventDefault());

// ---- modes ------------------------------------------------------------------
function setMode(mode) {
  stage.mode = mode;
  document.body.classList.toggle('preview', mode === 'preview');
  document.body.classList.toggle('camera', mode === 'camera');
  document.body.classList.toggle('photo', mode === 'photo');
  $('mode').textContent = mode === 'xr' ? 'AR' : mode;
  $('btn-ar').textContent = mode === 'xr' ? 'Exit AR' : (iosHandoff ? 'AR' : 'Enter AR');
  stage.resize();
}

// Only the orb at first. The display is summoned by a tap (or by asking for a test).
let started = false;
function begin() {
  $('intro').hidden = true;
  voice.unlock();
  if (started) return;
  started = true;
  const seeing = stage.mode === 'camera' || stage.mode === 'photo';
  $('heard').textContent = seeing ? 'Tap a window to make it the display, or anywhere else to float it.' : 'Tap anywhere to place the display.';
  voice.say(seeing
    ? 'Tap a window and I will turn it into the display. Or tap anywhere else, or just ask me for a test.'
    : 'Tap anywhere and I will open the display there. Or just ask me for a test.');
}

// ---- AR on iPhone ---------------------------------------------------------------
// Safari on iPhone has no WebXR AR. Needle Go, a free App Clip by Needle Tools (a third party), opens
// a web page in its own browser with WebXR on top of Apple's ARKit. On iPhone the AR button sends the
// page there; inside the App Clip AR starts by itself. The launch URL, the meta tag and the
// 'sessiongranted' hand-over follow Needle's own engine (@needle-tools/engine, NeedleXRSession).
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppClip = /NeedleAppClip\//i.test(navigator.userAgent);
const appClipLaunchUrl = () => {
  const url = new URL('https://appclip.apple.com/id?p=tools.needle.launch-app.Clip');
  url.searchParams.set('url', location.href);
  return url.toString();
};
if (isIOS && !inAppClip) {
  // Lets iOS fetch the App Clip card ahead of the first tap.
  const meta = document.createElement('meta');
  meta.name = 'apple-itunes-app';
  meta.content = 'app-id=6757205152, app-clip-bundle-id=tools.needle.launch-app.Clip, app-clip-display=card';
  document.head.appendChild(meta);
}
// Inside the App Clip the AR session is already granted: take it as soon as it is offered. The
// listener goes on now, at start-up; waiting for anything first can miss the event.
if (inAppClip && navigator.xr) navigator.xr.addEventListener('sessiongranted', () => enterAR().catch(fail('AR')), { once: true });
// The App Clip draws the canvas at its own pixel size; give it the size the quality level asks for.
// Checked every frame (cheap): during an AR session the page's own animation frames may not run.
function fitAppClipCanvas() {
  if (!inAppClip || !stage.renderer.xr.isPresenting) return;
  const canvas = stage.renderer.domElement, r = Math.min(2, devicePixelRatio || 1) * stage.Q.xrScale;
  const w = Math.floor(innerWidth * r), h = Math.floor(innerHeight * r);
  if (Math.abs(canvas.width - w) > 2 || Math.abs(canvas.height - h) > 2) { canvas.width = w; canvas.height = h; }
}
let iosHandoff = false;                       // true when the AR buttons lead to the App Clip

async function enterAR() {
  if (iosHandoff) { location.href = appClipLaunchUrl(); return; }   // inside the tap: iOS shows the card only then
  stage.renderer.xr.setFramebufferScaleFactor(stage.Q.xrScale);    // fewer pixels per frame on slower devices
  const session = await navigator.xr.requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay', 'hit-test'],
    domOverlay: { root: $('hud') },
  });
  const floor = session.enabledFeatures ? session.enabledFeatures.includes('local-floor') : false;
  stage.renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
  await stage.renderer.xr.setSession(session);
  stage.xrFloor = floor;
  // The real floor, found by looking at it (see Stage._updateFloor).
  try {
    if (!session.enabledFeatures || session.enabledFeatures.includes('hit-test')) {
      const viewer = await session.requestReferenceSpace('viewer');
      stage.hitSource = await session.requestHitTestSource({ space: viewer });
    }
  } catch { stage.hitSource = null; }
  setMode('xr');
  stage.frameChanged();
  session.addEventListener('end', () => { setMode('preview'); stage.frameChanged(); });
  begin();
}

// No WebXR (iPhone, desktop with a webcam): the rear camera as backdrop, the gyroscope to look around.
async function enterCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  const video = $('camera');
  video.srcObject = stream; await video.play();
  setMode('camera');
  stage.vision.setSource(video);
  stage.frameChanged();
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission();
  } catch { /* stays a fixed view */ }
  enableGyro();
  begin();
}

// A photo of the room instead of the live camera: to try the app on a desk, and for automated checks.
async function enterPhoto(file) {
  const img = $('photo');
  img.src = URL.createObjectURL(file);
  await img.decode();
  setMode('photo');
  stage.vision.setSource(img);
  stage.frameChanged();
  begin();
}

function enableGyro() {
  const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // look out of the back of the device
  let last = null, yaw0 = null;
  addEventListener('deviceorientation', (e) => { if (e.alpha != null) last = e; });
  stage.gyro = (camera) => {
    if (!last) return;
    const rad = THREE.MathUtils.degToRad;
    const orient = rad(screen.orientation?.angle || 0);
    if (yaw0 == null) yaw0 = rad(last.alpha);
    euler.set(rad(last.beta), rad(last.alpha) - yaw0, -rad(last.gamma), 'YXZ');   // start facing the rig
    camera.quaternion.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
    camera.position.set(0, 0, 0);
  };
}

async function detect() {
  let ar = false;
  try { ar = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { ar = false; }
  const cam = !!navigator.mediaDevices?.getUserMedia && isSecureContext;
  iosHandoff = !ar && isIOS && !inAppClip;
  for (const id of ['go-ar', 'btn-ar']) $(id).hidden = !(ar || iosHandoff);
  if (iosHandoff) { $('go-ar').textContent = 'Enter AR (opens Needle Go)'; $('btn-ar').textContent = 'AR'; }
  for (const id of ['go-camera', 'btn-camera']) $(id).hidden = !cam;      // also next to AR: the window display needs it
  const lines = [];
  if (iosHandoff) lines.push('On iPhone, AR runs in Needle Go, a free App Clip by Needle Tools (a third party): nothing to install; iOS shows a card, tap Open. If the card does not appear, tap again.');
  else lines.push(ar ? 'This device supports WebXR AR.' : 'WebXR AR is not available here (it needs a Meta Quest browser or Chrome on Android, over HTTPS).');
  if (!voice.sttSupported) lines.push('Speech recognition is not available in this browser: use the buttons or type.');
  if (!voice.ttsSupported) lines.push('Speech synthesis is not available: the orb will answer with captions only.');
  $('support').textContent = lines.join(' ');
  return { ar, cam };
}

const fail = (what) => (err) => { console.error(err); $('heard').textContent = `${what} failed: ${err.message || err}`; $('support').textContent = `${what} could not start: ${err.message || err}`; };
$('go-ar').addEventListener('click', () => enterAR().catch(fail('AR')));
$('btn-ar').addEventListener('click', () => {
  const session = stage.renderer.xr.getSession();
  if (session) session.end(); else enterAR().catch(fail('AR'));
});
$('go-camera').addEventListener('click', () => enterCamera().catch(fail('Camera')));
$('btn-camera').addEventListener('click', () => enterCamera().catch(fail('Camera')));
$('go-preview').addEventListener('click', () => { setMode('preview'); begin(); });
$('go-photo').addEventListener('click', () => $('photo-file').click());
$('photo-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) enterPhoto(f).catch(fail('Photo')); });

setMode('preview');
detect();
if (params.has('autostart')) begin();

// Keep the screen awake while a test is running: a sleeping phone would miss the minute phrases.
let wakeLock = null, wakeWanted = false;
async function keepAwake(on) {
  if (on === wakeWanted || !('wakeLock' in navigator)) return;
  wakeWanted = on;
  try {
    if (on) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* not granted: the timer still follows the wall clock */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeWanted) { wakeWanted = false; keepAwake(true); }
});

// ---- loop -------------------------------------------------------------------
let prev = performance.now();
stage.renderer.setAnimationLoop(() => {
  const now = performance.now(), real = (now - prev) / 1000;
  prev = now;
  keepAwake(!!brain.active?.busy);
  if (adjusting) drawAdjust();
  fitAppClipCanvas();
  stage.watchFrame(real);
  brain.tick(real);                    // test clocks follow the wall clock, however slow the frames are
  stage.update(Math.min(real, 0.1));   // animation is clamped so a hiccup does not make things jump
});

// Handy in the console and for automated checks.
window.rehabOrb = { stage, brain, voice };
