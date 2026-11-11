import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain/Brain.js';

// The brain needs no browser: a recording voice and a stage that does nothing are enough.
function make(speed = 1) {
  const said = [];
  const voice = { say: (t) => { said.push(t); return Promise.resolve(true); }, stopSpeaking() {}, muted: false, handsFree: false, sttSupported: false, toggleListening: () => false };
  const calls = [];
  const stage = { show: (v) => calls.push(['show', v.id]), hide: () => calls.push(['hide']), refresh() {}, morph: () => calls.push(['morph']), setPinned() {}, recenter() {} };
  return { brain: new Brain({ voice, stage, speed }), said, calls };
}

test('naming a test opens it', () => {
  const { brain } = make();
  brain.hear('Open the six minute walk test');
  assert.equal(brain.active.id, 'sixmwt');
  brain.hear('thirty second chair stand');
  assert.equal(brain.active.id, 'cst');
  brain.hear('Borg scale please');
  assert.equal(brain.active.id, 'borg');
  brain.hear('menu');
  assert.equal(brain.active.id, 'home');
});

test('six-minute walk: real run with laps, phrases, partial lap and % predicted', () => {
  const { brain, said } = make();
  brain.hear('patient is a man 72 years 170 cm 78 kg');
  brain.hear('six minute walk test');
  const t = brain.topics.sixmwt;
  brain.hear('start');
  assert.equal(t.phase, 'running');
  for (const secs of [50, 51, 53, 62, 58, 56]) { brain.tick(secs); brain.hear('lap', 'voice'); }
  assert.equal(t.laps.length, 6);
  assert.ok(said.includes('You are doing well. You have 5 minutes to go.'));
  assert.ok(said.includes('You are doing well. You have only 1 minute to go.'));
  brain.tick(40);                                   // past 6:00
  assert.equal(t.phase, 'final');
  assert.ok(said.at(-1).startsWith('Stop!'));
  brain.hear('thirty two metres', 'voice');
  assert.equal(t.phase, 'result');
  assert.equal(t.distance, 392);
  assert.deepEqual(brain.session.sixmwt, { distance: 392, laps: 6, pct: 82, stoppedAt: null });
  assert.match(said.at(-1), /392 metres: 82 percent of the 479 predicted/);
});

test('a running test cannot be closed or left by accident', () => {
  const { brain, said } = make();
  brain.hear('six minute walk test'); brain.hear('start');
  brain.press({ id: 'close' });
  assert.equal(brain.active.id, 'sixmwt');
  brain.hear('chair stand');
  assert.equal(brain.active.id, 'sixmwt');
  assert.equal(said.at(-1), 'A test is running. Stop it first.');
  brain.hear('stop');                               // early stop keeps the time
  assert.equal(brain.topics.sixmwt.phase, 'final');
});

test('ambient speech does not start or count anything', () => {
  const { brain } = make();
  brain.hear('six minute walk test');
  brain.hear('let us go over there and talk', 'voice');
  assert.equal(brain.topics.sixmwt.phase, 'ready');
  brain.hear('chair stand'); brain.hear('start');
  brain.hear('please stand up straight', 'voice');
  assert.equal(brain.topics.cst.reps, 0);
  brain.hear('up', 'voice');
  assert.equal(brain.topics.cst.reps, 1);
});

test('pointing, then "right here", explains the pointed lap', () => {
  const { brain, said } = make();
  brain.hear('six minute walk test'); brain.hear('demo');
  brain.tick(31);                                   // demo runs 12× faster: the whole walk
  brain.tick(4);                                    // the demo closes the test by itself
  assert.equal(brain.topics.sixmwt.phase, 'result');
  brain.hover({ id: 'lap:4', kind: 'point' });
  brain.hear('right here', 'voice');
  assert.equal(brain.topics.sixmwt.focus, 4);
  assert.match(said.at(-1), /Lap 4 took 62 seconds.*17% slower than lap 3.*cannot tell me why/);
});

test('chair stand: count, halfway rule, STEADI verdict, arms', () => {
  const { brain, said } = make();
  brain.hear('woman 72 years');
  brain.hear('chair stand test'); brain.hear('start');
  const t = brain.topics.cst;
  for (let i = 0; i < 9; i++) brain.press({ id: 'rep' });
  brain.tick(31);
  assert.equal(t.phase, 'final');
  brain.press({ id: 'rep' });                       // over halfway at the buzzer
  brain.press({ id: 'done' });
  assert.equal(t.reps, 10);
  assert.match(said.at(-1), /10 stands: not below average for a woman aged 70 to 74/);
  brain.press({ id: 'again' }); brain.hear('start'); brain.press({ id: 'arms' });
  assert.equal(t.phase, 'result');
  assert.match(said.at(-1), /Score zero/);
});

test('Borg: ratings before and after, by pointing or by voice', () => {
  const { brain, said } = make();
  brain.hear('borg scale');
  brain.press({ id: 'rate:0.5', kind: 'point' });
  brain.hear('after the effort 4', 'voice');
  assert.deepEqual(brain.session.borg.dyspnoea, { before: 0.5, after: 4 });
  assert.match(said.at(-1), /4, somewhat severe.*3\.5 points higher/);
  brain.hear('leg fatigue before 2');
  assert.equal(brain.session.borg.fatigue.before, 2);
});
