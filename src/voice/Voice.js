import { SPEECH_LOCALE } from '../core/text.js';

// Speech in and out through the Web Speech API, with graceful absence of either half:
//  - no speech synthesis → captions still play, timed by text length;
//  - no speech recognition → the panel's buttons and the text box do everything.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export class Voice {
  constructor() {
    this.onState = () => {};         // 'speaking' | 'listening' | 'idle'
    this.onCaption = () => {};       // (text | null, seconds)
    this.onWord = () => {};          // (charIndex) from the synthesiser, when it reports boundaries
    this.onHeard = () => {};         // (transcript, isFinal)
    this.onError = () => {};
    this.muted = false;
    this.handsFree = false;          // keep listening between utterances
    this.speaking = false;
    this.listening = false;
    this._queue = [];
    this._token = 0;
    this.ttsSupported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.sttSupported = !!SR;
    this._voice = null;
    if (this.ttsSupported) {
      const choose = () => {
        const all = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
        this._voice = all.find((v) => v.lang === SPEECH_LOCALE && /natural|neural|google|samantha|premium|enhanced/i.test(v.name))
          || all.find((v) => v.lang === SPEECH_LOCALE) || all[0] || null;
      };
      choose();
      speechSynthesis.addEventListener?.('voiceschanged', choose);
    }
  }

  // Must run inside a user gesture on iOS so later utterances are allowed.
  unlock() {
    if (!this.ttsSupported) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
  }

  estimate(text) { return Math.max(1.4, text.length * 0.062); }

  // Speak (or caption) a line. Resolves when it has finished or was interrupted.
  say(text, { interrupt = true } = {}) {
    if (interrupt) this.stopSpeaking();
    return new Promise((resolve) => {
      this._queue.push({ text, resolve });
      if (!this.speaking) this._next();
    });
  }

  stopSpeaking() {
    this._token++;
    for (const q of this._queue) q.resolve(false);
    this._queue = [];
    if (this.ttsSupported) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
    clearTimeout(this._timer);
    if (this.speaking) { this.speaking = false; this.onCaption(null, 0); this._settle(); }
  }

  _next() {
    const item = this._queue.shift();
    if (!item) { this.speaking = false; this.onCaption(null, 0); this._settle(); return; }
    const token = ++this._token;
    const seconds = this.estimate(item.text);
    this.speaking = true;
    this._pauseListening();
    this.onState('speaking');
    this.onCaption(item.text, seconds);
    const done = (ok) => {
      if (token !== this._token) return;       // superseded
      this._token++;
      clearTimeout(this._timer);
      item.resolve(ok);
      this._next();
    };
    if (this.ttsSupported && !this.muted) {
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = SPEECH_LOCALE; if (this._voice) u.voice = this._voice;
      u.rate = 1.02; u.pitch = 1.0;
      u.onboundary = (e) => { if (token === this._token && e.name !== 'sentence') this.onWord(e.charIndex); };
      u.onend = () => done(true);
      u.onerror = () => done(false);
      try { speechSynthesis.speak(u); } catch { /* fall through to the timer */ }
      // Safety net: some engines never fire onend (or no voice is installed).
      this._timer = setTimeout(() => done(true), (seconds * 1.6 + 2) * 1000);
    } else {
      this._timer = setTimeout(() => done(true), seconds * 1000);
    }
  }

  _settle() {
    if (this.handsFree) this._startRecognition();
    else this.onState(this.listening ? 'listening' : 'idle');
  }

  // ---- recognition --------------------------------------------------------
  toggleListening() {
    if (!this.sttSupported) { this.onError('Speech recognition is not available in this browser. Use the buttons or type.'); return false; }
    this.handsFree = !this.handsFree;
    if (this.handsFree) { if (!this.speaking) this._startRecognition(); } else this._stopRecognition();
    return this.handsFree;
  }

  _startRecognition() {
    if (!this.sttSupported || this.listening || this.speaking) return;
    const rec = new SR();
    rec.lang = SPEECH_LOCALE; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onstart = () => { this.listening = true; this.onState('listening'); };
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      this.onHeard(r[0].transcript.trim(), r.isFinal);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.handsFree = false; this.onError('Microphone permission was denied.');
      }
    };
    rec.onend = () => {
      this.listening = false; this._rec = null;
      if (this.speaking) return;
      if (this.handsFree) setTimeout(() => this._startRecognition(), 250);
      else this.onState('idle');
    };
    this._rec = rec;
    try { rec.start(); } catch { this._rec = null; }
  }

  _pauseListening() { if (this._rec) { try { this._rec.abort(); } catch { /* ignore */ } } }

  _stopRecognition() {
    this._pauseListening();
    this.listening = false;
    if (!this.speaking) this.onState('idle');
  }
}
