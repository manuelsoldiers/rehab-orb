import test from 'node:test';
import assert from 'node:assert/strict';
import { predicted6mwd, lapSplits, cstJudge, cstBand, borgSnap, borgWords, parsePatient, CST, SIXMWT } from '../src/topics/clinical.js';
import { normalize, wordsToDigits, fmtClock } from '../src/core/text.js';

test('Enright & Sherrill reference equations', () => {
  // men: 7.57*170 - 5.02*72 - 1.76*78 - 309 = 479.18
  assert.equal(predicted6mwd({ sex: 'm', age: 72, height: 170, weight: 78 }), 479);
  // women: 2.11*160 - 2.29*65 - 5.78*70 + 667 = 451.15
  assert.equal(predicted6mwd({ sex: 'f', age: 70, height: 160, weight: 65 }), 451);
  assert.equal(predicted6mwd({ sex: 'm', age: 72, height: null, weight: 78 }), null);
});

test('standard phrases are one per minute, then the warning and Stop', () => {
  assert.deepEqual(SIXMWT.cues.map((c) => c.t), [60, 120, 180, 240, 300, 345, 360]);
  assert.equal(SIXMWT.cues.at(-1).text, 'Stop!');
});

test('lap splits: seconds, speed and change against the lap before', () => {
  const s = lapSplits([50, 101, 154, 216]);
  assert.deepEqual(s.map((x) => x.seconds), [50, 51, 53, 62]);
  assert.equal(s[0].change, null);
  assert.equal(s[3].change, 17);
  assert.equal(s[0].speed, 1.2);
});

test('STEADI cut-offs: below average means fewer than the cut-off', () => {
  assert.equal(CST.bands.length, 7);
  assert.deepEqual(cstJudge(11, { sex: 'm', age: 72 }), { band: 2, cutoff: 12, below: true });
  assert.equal(cstJudge(12, { sex: 'm', age: 72 }).below, false);
  assert.equal(cstJudge(9, { sex: 'f', age: 72 }).below, true);
  assert.equal(cstJudge(4, { sex: 'f', age: 94 }).below, false);
  assert.equal(cstJudge(11, { sex: 'm', age: 55 }), null);      // outside 60–94
  assert.equal(cstJudge(11, { sex: null, age: 72 }), null);
  assert.equal(cstBand(95), -1);
});

test('Borg scale: only values that exist on the scale', () => {
  assert.equal(borgSnap(0.5), 0.5);
  assert.equal(borgSnap(4), 4);
  assert.equal(borgSnap(4.5), null);
  assert.equal(borgSnap(11), null);
  assert.equal(borgWords(4), 'somewhat severe');
  assert.equal(borgWords(6), '');
});

test('patient parsing', () => {
  const n = (s) => wordsToDigits(normalize(s));
  assert.deepEqual(parsePatient(n('The patient is a man, 72 years, 170 cm, 78 kg')), { sex: 'm', age: 72, height: 170, weight: 78 });
  assert.deepEqual(parsePatient(n('woman aged seventy two')), { sex: 'f', age: 72 });
  assert.deepEqual(parsePatient(n('one hundred and sixty five centimetres')), { height: 165 });
  assert.deepEqual(parsePatient(n('twelve metres')), {});
});

test('text helpers', () => {
  assert.equal(wordsToDigits('six minute walk test'), '6 minute walk test');
  assert.equal(wordsToDigits('thirty second chair stand'), '30 second chair stand');
  assert.equal(wordsToDigits('a half'), '0.5');
  assert.equal(fmtClock(359.2), '6:00');
  assert.equal(fmtClock(0), '0:00');
});
