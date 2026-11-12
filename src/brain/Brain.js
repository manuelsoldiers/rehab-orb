import { normalize, wordsToDigits } from '../core/text.js';
import { parsePatient, describePatient } from '../topics/clinical.js';
import { Home } from '../topics/home.js';
import { SixMWT } from '../topics/sixmwt.js';
import { ChairStand } from '../topics/cst.js';
import { Borg } from '../topics/borg.js';

// Which topic an utterance names. Patterns run on normalised text with number words turned into digits.
const TOPIC_PATTERNS = [
  ['sixmwt', /\b6 ?-?(min|minute)s?\b|\b6mwt\b|\bwalk(ing)? test\b/],
  ['cst', /\bchair\b|\bsit to stand\b|\b30 ?-?(s|sec|second)s?\b.*\b(stand|test)\b|\bsteadi\b/],
  ['borg', /\bborg\b|\bdyspn(o)?ea scale\b|\bbreathless(ness)? scale\b/],
];

// The brain turns words and pointing into actions on the topics. It is rule-based on purpose:
// every clinical sentence it can say is written down, with a source, and can be reviewed.
// `stage` is the scene; `voice` speaks. An LLM can later replace `hear()` without touching the topics.
export class Brain {
  constructor({ voice, stage, speed = 1 }) {
    this.voice = voice; this.stage = stage;
    this.speed = speed;                                   // test clocks run `speed` times faster (QA only)
    this.patient = { sex: null, age: null, height: null, weight: null };
    this.session = {};
    this.pinned = false;
    this.lastTarget = null;                               // what the pointer rested on last, for "right here"
    this.topics = { home: new Home(this), sixmwt: new SixMWT(this), cst: new ChairStand(this), borg: new Borg(this) };
    this.active = null;
    this.onHeard = () => {};
  }

  // ---- services for the topics --------------------------------------------
  say(text, opts) { return this.voice.say(text, opts); }
  refresh() { this.stage.refresh(); }
  morph() { this.stage.morph(); }

  open(id) {
    const next = this.topics[id]; if (!next) return;
    if (this.active && this.active !== next && this.active.busy) return this.say('A test is running. Stop it first.');
    this.active = next; this.lastTarget = null;
    this.stage.show(next);
    next.enter?.();
  }

  close() {
    if (this.active?.busy) return this.say('A test is running. Stop it first.');
    this.active = null; this.lastTarget = null;
    this.voice.stopSpeaking();
    this.stage.hide();
  }

  patientChanged() {
    for (const t of Object.values(this.topics)) t.patientChanged?.();
    this.refresh();
  }

  togglePin() {
    this.pinned = !this.pinned; this.refresh();
    this.say(this.pinned ? 'Pinned. Taps will not move the display.' : 'Unpinned. Tap an empty spot to move the display there.');
  }

  voiceOn() { return this.voice.handsFree; }
  voiceLabel() { return !this.voice.sttSupported ? 'Voice: n/a' : this.voice.handsFree ? 'Listening' : 'Voice: off'; }
  toggleVoice() {
    const on = this.voice.toggleListening(); this.refresh();
    if (!this.voice.sttSupported) this.say('Speech recognition is not available in this browser. Use the buttons, or type.');
    return on;
  }
  soundOn() { return !this.voice.muted; }
  soundLabel() { return this.voice.muted ? 'Sound: off' : 'Sound: on'; }
  toggleSound() { this.voice.muted = !this.voice.muted; if (this.voice.muted) this.voice.stopSpeaking(); this.refresh(); }

  // ---- pointing -------------------------------------------------------------
  hover(target) { if (target && target.kind === 'point') this.lastTarget = target; }

  press(target) {
    if (!target) return;
    if (target.id === 'orb') return this.open('home');
    if (target.id === 'close') return this.close();
    if (target.id === 'menu') return this.open('home');
    if (target.id === 'pin') return this.togglePin();
    if (target.kind === 'point') this.lastTarget = target;
    return this.active?.press(target);
  }

  // ---- words ----------------------------------------------------------------
  // source: 'voice' (ambient, stay quiet when unsure) or 'typed' (always answer).
  hear(text, source = 'typed') {
    const n = wordsToDigits(normalize(text));
    if (!n) return;
    this.onHeard(text);

    if (/^(close|hide|dismiss|go away)\b|\bclose (it|this|the panel)\b/.test(n)) return this.close();
    if (/\b(menu|home|topics|what can you do|help)\b/.test(n)) return this.open('home');
    if (/\bunpin\b/.test(n)) { if (this.pinned) this.togglePin(); return; }
    if (/\b(pin|stay (here|there))\b/.test(n)) { if (!this.pinned) this.togglePin(); return; }
    if (/\b(come here|recenter|recentre|follow me|over here|in front of me)\b/.test(n)) { if (this.active) this.stage.recenter(); return this.say(this.active ? 'Here it is.' : 'Tap anywhere and I will open the display there.'); }
    if (/\b(mute|be quiet|silence)\b/.test(n)) { if (!this.voice.muted) this.toggleSound(); return; }
    if (/\bunmute\b|\bsound on\b/.test(n)) { if (this.voice.muted) this.toggleSound(); return; }
    if (/\bexample patient\b/.test(n)) return this.topics.home.press({ id: 'example' });

    // Naming another topic switches to it (unless a test is running).
    for (const [id, re] of TOPIC_PATTERNS) {
      if (re.test(n) && this.active?.id !== id) return this.open(id);
    }

    // Patient data: two fields at once, or the word "patient", or a bare value ("72 years").
    const found = parsePatient(n), fields = Object.keys(found).length;
    const isPatient = fields > 0 && !this.active?.busy && (fields >= 2 || /\bpatient\b/.test(n) || n.split(' ').length <= 3);
    if (isPatient) {
      Object.assign(this.patient, found);
      this.patientChanged();
      return this.say(`Patient: ${describePatient(this.patient)}.`);
    }

    if (this.active && this.active.hear(n, text) !== false) return;

    // "Right here", "this one", "explain this": the thing the pointer rests on.
    if (this.active && this.lastTarget && /\b(right here|here|this( one)?|that( one)?|what happened|explain)\b/.test(n)) {
      return this.active.press(this.lastTarget);
    }

    if (source === 'typed' || !this.active) {
      return this.say('I can run the six-minute walk test, the thirty-second chair stand, or the Borg scale. Say menu to see them.');
    }
  }

  tick(dt) { for (const t of Object.values(this.topics)) t.tick?.(dt); }
}
