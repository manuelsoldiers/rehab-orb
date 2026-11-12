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

// ---- wiring ---------------------------------------------------------------
stage.onPress = (target) => brain.press(target);
stage.onHover = (target) => brain.hover(target);
// A tap on empty space summons the display there; later taps move it, unless it is pinned.
stage.onEmptyTap = (ray) => {
  if (!started) return;
  if (!brain.active) { stage.place(ray); brain.open('home'); $('heard').textContent = ''; } else if (!brain.pinned) stage.relocate(ray);
};
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
  $('mode').textContent = mode === 'xr' ? 'AR' : mode;
  $('btn-ar').textContent = mode === 'xr' ? 'Exit AR' : 'Enter AR';
  stage.resize();
}

// Only the orb at first. The display is summoned by a tap (or by asking for a test).
let started = false;
function begin() {
  $('intro').hidden = true;
  voice.unlock();
  if (started) return;
  started = true;
  $('heard').textContent = 'Tap anywhere to place the display.';
  voice.say('Tap anywhere and I will open the display there. Or just ask me for a test.');
}

async function enterAR() {
  const session = await navigator.xr.requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: $('hud') },
  });
  const floor = session.enabledFeatures ? session.enabledFeatures.includes('local-floor') : false;
  stage.renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
  await stage.renderer.xr.setSession(session);
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
  stage.frameChanged();
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission();
  } catch { /* stays a fixed view */ }
  enableGyro();
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
  for (const id of ['go-ar', 'btn-ar']) $(id).hidden = !ar;
  for (const id of ['go-camera', 'btn-camera']) $(id).hidden = !cam || ar;
  const lines = [];
  lines.push(ar ? 'This device supports WebXR AR.' : 'WebXR AR is not available here (it needs a Meta Quest browser or Chrome on Android, over HTTPS).');
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
  brain.tick(real);                    // test clocks follow the wall clock, however slow the frames are
  stage.update(Math.min(real, 0.1));   // animation is clamped so a hiccup does not make things jump
});

// Handy in the console and for automated checks.
window.rehabOrb = { stage, brain, voice };
