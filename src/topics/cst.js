import { C, W, PAD } from '../ui/kit.js';
import { CST, cstJudge, cstBand } from './clinical.js';

const SRC = 'CDC STEADI · 30-Second Chair Stand · Rikli & Jones 1999';

const NOTES = {
  chair: { head: 'The chair', body: 'A chair with a straight back and no arm rests, seat about 43 centimetres high, placed against a wall so it cannot slide.', src: SRC },
  posture: { head: 'Starting position', body: 'The patient sits in the middle of the seat, feet flat on the floor, arms crossed at the wrists and held against the chest, back straight.', src: SRC },
  practice: { head: 'Demonstrate first', body: 'Show the movement, then let the patient try one to three stands before the timed trial.', src: 'Senior Fitness Test protocol (Rikli & Jones)' },
  arms: { head: 'If the arms are used', body: 'If the patient must use the arms to stand, stop the test and record a score of zero.', src: SRC },
  count: { head: 'What counts', body: 'Count each time the patient comes to a full standing position. If they are more than halfway up when the 30 seconds end, count it as a stand.', src: SRC },
  instruct: { head: 'What to tell the patient', body: '“On go, rise to a full standing position, then sit back down again. Repeat this for 30 seconds.”', src: SRC },
  sources: {
    head: 'Sources',
    body: 'Procedure and below-average scores: CDC STEADI, Assessment: 30-Second Chair Stand (2017). Norms: Rikli & Jones, J Aging Phys Act 1999;7:162–181. Validation: Jones, Rikli & Beam, Res Q Exerc Sport 1999;70:113–119. Check your centre’s protocol before formal use.',
  },
};

const DEMO_EVERY = 2.75;      // the simulated patient stands every 2.75 s: 10 full stands, the 11th past halfway

export class ChairStand {
  constructor(app) {
    this.app = app;
    this.id = 'cst';
    this.label = '30-Second Chair Stand';
    this.reset();
  }

  reset() {
    this.phase = 'ready';     // ready | running | final | result
    this.t = 0; this.reps = 0; this.usedArms = false; this.demo = false;
    this.note = null; this._shown = -1; this._auto = 0;
  }

  get busy() { return this.phase === 'running' || this.phase === 'final'; }

  enter() {
    if (this.phase === 'ready') this.app.say('Thirty-second chair stand. Point at an age band to hear its cut-off. Say start when the patient is ready.');
  }

  start(demo) {
    this.reset(); this.phase = 'running'; this.demo = demo;
    this.app.morph();
    this.app.say(demo ? 'Demo with a simulated patient. Go!' : 'Go!');
  }

  rep(n = 1) {
    if (!this.busy) return;
    this.reps = Math.max(0, this.reps + n);
    this.app.refresh();
  }

  arms() {
    if (this.phase === 'result') return;
    this.usedArms = true; this.reps = 0; this.phase = 'final';
    this.finish();
  }

  finish() {
    if (this.phase !== 'final') return;
    this.phase = 'result';
    const s = this.summary();
    this.note = { head: 'What this means', body: s.long, src: SRC };
    this.app.session.cst = { reps: this.reps, usedArms: this.usedArms, below: s.below };
    this.app.morph();
    this.app.say(s.short);
  }

  summary() {
    const p = this.app.patient, n = this.reps, who = p.sex === 'm' ? 'man' : 'woman';
    if (this.usedArms) {
      const t = 'Score zero: the patient needed the arms to stand, so the test was stopped.';
      return { short: t, long: `${t} Record 0 for both the number and the score (CDC STEADI).`, below: true };
    }
    const j = cstJudge(n, p);
    if (!j) {
      const outside = p.age && cstBand(p.age) < 0;
      const t = outside
        ? `${n} stands. The STEADI cut-offs cover ages 60 to 94 only, so I have no reference for age ${p.age}.`
        : `${n} stands. Give me the patient's age and sex and I will compare it with the STEADI cut-offs.`;
      return { short: t, long: t, below: null };
    }
    const b = CST.bands[j.band], band = `${b.from} to ${b.to}`;
    if (j.below) {
      return {
        below: true,
        short: `${n} stands: below average for a ${who} aged ${band}. That indicates a risk for falls.`,
        long: `${n} stands is below average for a ${who} aged ${b.from}–${b.to} (cut-off: fewer than ${j.cutoff}). In STEADI a below-average score indicates a risk for falls: a screening signal to act on, not a diagnosis.`,
      };
    }
    return {
      below: false,
      short: `${n} stands: not below average for a ${who} aged ${band}.`,
      long: `${n} stands is not below average for a ${who} aged ${b.from}–${b.to} (cut-off: fewer than ${j.cutoff}). On its own that does not rule out a risk for falls.`,
    };
  }

  explain(key, speak = true) {
    const n = NOTES[key]; if (!n) return;
    this.note = n; this.app.refresh();
    if (speak) this.app.say(key === 'sources' ? 'Here are the sources.' : n.body.replace(/[“”]/g, ''));
  }

  sayBand(i) {
    const b = CST.bands[i];
    const body = `Ages ${b.from} to ${b.to}: below average is fewer than ${b.m} stands for men, fewer than ${b.f} for women.`;
    this.note = { head: `Cut-off, ages ${b.from}–${b.to}`, body, src: SRC };
    this.app.refresh(); this.app.say(body);
  }

  press(t) {
    const id = t.id;
    if (id === 'start') return this.start(false);
    if (id === 'demo') return this.start(true);
    if (id === 'rep') return this.rep(1);
    if (id === 'undo') return this.rep(-1);
    if (id === 'arms') return this.arms();
    if (id === 'done') return this.finish();
    if (id === 'again') { this.reset(); this.app.morph(); return this.app.say('Ready for a new test.'); }
    if (id.startsWith('note:') || id.startsWith('item:')) return this.explain(id.slice(5));
    if (id.startsWith('band:')) return this.sayBand(Number(id.slice(5)));
    return false;
  }

  hear(n) {
    if (/\b(source|reference|evidence)s?\b/.test(n)) return this.explain('sources');
    if (/instruct|tell the patient/.test(n)) return this.explain('instruct');
    if (/\bchair\b.*\b(which|what|kind|height|high)\b|\b(which|what|kind) .*chair\b/.test(n)) return this.explain('chair');
    if (/halfway|what counts|count as/.test(n)) return this.explain('count');
    if (/used? (the |his |her |their )?arms|hands to stand/.test(n)) return this.arms();
    const band = n.match(/\b(?:cut ?off|norm|average).*?\b(\d{2})\b/);
    if (band && cstBand(+band[1]) >= 0) return this.sayBand(cstBand(+band[1]));
    if (this.phase === 'ready') {
      if (/\bdemo\b|simulat/.test(n)) return this.start(true);
      if (/\b(start|begin)\b/.test(n) || /^(ok |and )?go$/.test(n)) return this.start(false);
    } else if (this.busy) {
      if (/\bundo\b/.test(n)) return this.rep(-1);
      if (/^(stand|rep|up|1|plus 1|another|next|count)$/.test(n)) return this.rep(1);   // one short word only: a gym is noisy
      if (this.phase === 'final') {
        const m = n.match(/^(\d{1,2})$/) || n.match(/\b(\d{1,2}) (?:stands?|reps?|repetitions?)\b/);
        if (m) { this.reps = +m[1]; return this.finish(); }
        if (/\b(done|finish|result)\b/.test(n)) return this.finish();
      }
    } else if (this.phase === 'result') {
      if (/\b(new|again|reset|restart|repeat)\b/.test(n)) return this.press({ id: 'again' });
      if (/\b(result|mean|interpret|normal|risk)\b/.test(n)) { const s = this.summary(); this.note = { head: 'What this means', body: s.long, src: SRC }; this.app.refresh(); return this.app.say(s.short); }
    }
    return false;
  }

  patientChanged() {
    if (this.phase === 'result') { const s = this.summary(); this.note = { head: 'What this means', body: s.long, src: SRC }; }
  }

  tick(dt) {
    if (this.phase === 'final' && this.demo) { this._auto += dt; if (this._auto > 2.6) this.finish(); return; }
    if (this.phase !== 'running') return;
    this.t += dt * this.app.speed;
    if (this.demo) { const due = Math.floor(this.t / DEMO_EVERY); if (due > this.reps && this.t < CST.duration) { this.reps = due; this.app.refresh(); } }
    if (this.t >= CST.duration) {
      this.t = CST.duration; this.phase = 'final'; this._auto = 0;
      if (this.demo) this.reps += 1;                  // the simulated patient was past halfway
      this.app.refresh();
      this.app.say(this.demo ? 'Stop. More than halfway up: that one counts.' : 'Stop. If the patient was more than halfway up, count that stand.');
      return;
    }
    const shown = Math.floor(this.t * 4);
    if (shown !== this._shown) { this._shown = shown; this.app.refresh(); }
  }

  // ---- drawing ------------------------------------------------------------
  height(kit) { return 800 + (this.note ? 16 + kit.drawerHeight(this.note) : 0) + 4; }

  draw(kit) {
    const bottom = 800, running = this.busy, p = this.app.patient;
    const j = this.phase === 'result' && !this.usedArms ? cstJudge(this.reps, p) : null;
    let value = '30 s', delta = 'ready', deltaColor = C.cyan;
    if (running) { value = `${Math.ceil(CST.duration - this.t)} s`; delta = `${this.reps} stands`; }
    if (this.phase === 'final') { value = `${this.reps} stands`; delta = 'time: over halfway counts'; }
    if (this.phase === 'result') {
      value = this.usedArms ? 'score 0' : `${this.reps} stands`;
      delta = this.usedArms ? 'used arms to stand' : j ? (j.below ? `below average (< ${j.cutoff})` : `not below average (≥ ${j.cutoff})`) : 'no reference yet';
      deltaColor = this.usedArms || (j && j.below) ? C.red : j ? C.green : C.dim;
    }
    kit.frame({
      title: '30-Second Chair Stand',
      sub: `${this.demo ? 'Demo · simulated patient · ' : ''}CDC STEADI · lower-body strength`,
      value, delta, deltaColor, cardBottom: bottom, pinned: this.app.pinned,
    });
    if (running) this.drawRun(kit); else this.drawNorms(kit, j);

    if (this.phase === 'ready') {
      const items = [
        ['item:chair', 'Chair 43 cm, straight back, no arm rests'],
        ['item:posture', 'Arms crossed on chest, feet flat'],
        ['item:practice', 'Demonstrate, then 1–3 practice stands'],
        ['item:arms', 'Uses arms to stand → stop, score 0'],
      ];
      items.forEach(([id, label], i) => {
        const x = PAD + (i % 2) * 600, y = 600 + Math.floor(i / 2) * 46, on = kit.isHover(id);
        kit.c.fillStyle = on ? C.cyan : C.dim; kit.c.beginPath(); kit.c.arc(x + 8, y - 9, 6, 0, 7); kit.c.fill();
        kit.text(kit.c, label, x + 28, y, { size: 25, color: on ? C.cyan : C.text });
        kit.region(id, x, y - 34, 580, 46, { kind: 'point' });
      });
    }
    kit.footer(692, SRC);
    const rows = {
      ready: [{ label: 'Start', id: 'start', flex: 1.4, active: true }, { label: 'Demo', id: 'demo' }, { label: 'What counts', id: 'note:count' }, { label: 'Sources', id: 'note:sources' }],
      running: [{ label: '+1 stand', id: 'rep', flex: 3, size: 30 }, { label: 'Undo', id: 'undo' }, { label: 'Used arms', id: 'arms', flex: 1.3 }],
      final: [{ label: '+1 · over halfway', id: 'rep', flex: 2 }, { label: 'Undo', id: 'undo' }, { label: 'Used arms', id: 'arms', flex: 1.2 }, { label: 'Done', id: 'done', flex: 1.4, active: true }],
      result: [{ label: 'New test', id: 'again' }, { label: 'What counts', id: 'note:count' }, { label: 'Sources', id: 'note:sources' }],
    };
    kit.chips(714, 66, rows[this.phase]);
    if (this.note) kit.drawer(bottom + 16, this.note);
  }

  drawRun(kit) {
    const { c, d } = kit, x0 = PAD, x1 = W - PAD, y = 250;
    kit.text(c, 'Time', x0, y - 16, { size: 21, color: C.dim, spacing: 2, upper: true });
    c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x0, y, x1 - x0, 14);
    d.fillStyle = C.amber; d.fillRect(x0, y, (x1 - x0) * Math.min(1, this.t / CST.duration), 14);
    kit.text(c, 'Full stands', x0, 340, { size: 21, color: C.dim, spacing: 2, upper: true });
    const cols = 12, bw = 78, gap = 20;
    for (let i = 0; i < Math.max(this.reps, cols); i++) {
      const bx = x0 + (i % cols) * (bw + gap), by = 366 + Math.floor(i / cols) * 104;
      if (i < this.reps) {
        d.fillStyle = C.ink; d.fillRect(bx, by, bw, 84);
        kit.text(d, String(i + 1), bx + bw / 2, by + 56, { size: 34, weight: 700, color: '#0b1522', align: 'center' });
      } else if (i < cols) {
        c.strokeStyle = C.grid; c.lineWidth = 2; c.strokeRect(bx, by, bw, 84);
      }
    }
    if (this.phase === 'final') kit.text(c, 'Time. More than halfway up at the buzzer counts as a stand.', x0, 624, { size: 26, weight: 600 });
    else kit.text(c, 'Stand close by, for safety. Count each full stand.', x0, 624, { size: 25, color: C.faint });
  }

  // STEADI below-average cut-offs by age band, with the patient's score when there is one.
  drawNorms(kit, judged) {
    const { c, d } = kit, n = CST.bands.length;
    const top = this.phase === 'ready' ? 232 : 250, h = this.phase === 'ready' ? 270 : 330;
    const ymax = Math.max(16, Math.ceil((this.reps + 2) / 4) * 4);
    const ch = kit.chart({
      x: 110, y: top, w: 1110, h, xmin: 0, xmax: n, ymin: 0, ymax,
      xticks: [], yticks: [0, ymax / 4, ymax / 2, ymax * 0.75, ymax].map((v) => ({ v, label: String(v) })),
    });
    kit.text(c, 'Below-average cut-off (stands) by age', ch.x, top - 14, { size: 21, color: C.dim, spacing: 2, upper: true });
    kit.text(c, '— men', ch.x + ch.w - 150, top - 14, { size: 22, weight: 700, color: C.ink, align: 'right' });
    kit.text(c, '— women', ch.x + ch.w, top - 14, { size: 22, weight: 700, color: C.cyan, align: 'right' });
    const hov = kit.hover && kit.hover.id.startsWith('band:') ? Number(kit.hover.id.slice(5)) : -1;
    const mine = this.phase === 'result' ? cstBand(this.app.patient.age) : -1;
    CST.bands.forEach((b, i) => {
      const on = i === hov;
      kit.text(c, `${b.from}–${b.to}`, ch.sx(i + 0.5), ch.y + ch.h + 32, { size: 22, color: on ? C.amber : i === mine ? C.text : C.dim, align: 'center', weight: on || i === mine ? 700 : 500 });
    });
    const step = (key, color, off) => {
      d.strokeStyle = color; d.lineWidth = 5; d.lineJoin = 'round'; d.lineCap = 'round';
      d.beginPath();
      CST.bands.forEach((b, i) => {
        const y = ch.sy(b[key]) + off;
        if (i) d.lineTo(ch.sx(i), y); else d.moveTo(ch.sx(i), y);
        d.lineTo(ch.sx(i + 1), y);
      });
      d.stroke();
    };
    step('m', C.ink, -3); step('f', C.cyan, 3);
    kit.region('bands', ch.x, ch.y - 10, ch.w, ch.h + 50, {
      resolve: (px) => ({ id: `band:${Math.min(n - 1, Math.max(0, Math.floor((px - ch.x) / ch.w * n)))}`, kind: 'point' }),
    });
    if (hov >= 0) {
      const b = CST.bands[hov];
      kit.crosshair(ch.sx(hov + 0.5), ch.sy(b.m), ch.y, ch.y + ch.h, null);
      kit.text(d, `${b.from}–${b.to}   /   men < ${b.m}   /   women < ${b.f}`, ch.sx(hov + 0.5), ch.y - 46 > 200 ? ch.y + 30 : ch.y + 30, { size: 23, weight: 700, align: hov > 3 ? 'right' : 'left' });
    }
    if (this.phase === 'result' && !this.usedArms) {
      const y = ch.sy(this.reps), col = judged ? (judged.below ? C.red : C.green) : C.amber;
      d.save(); d.strokeStyle = col; d.lineWidth = 3; d.setLineDash([12, 10]);
      d.beginPath(); d.moveTo(ch.x, y); d.lineTo(ch.x + ch.w, y); d.stroke(); d.restore();
      if (mine >= 0) { d.fillStyle = col; d.beginPath(); d.arc(ch.sx(mine + 0.5), y, 13, 0, 7); d.fill(); }
      kit.text(c, `patient: ${this.reps}`, ch.x + ch.w - 8, y - 12, { size: 22, weight: 700, color: col, align: 'right' });
    }
  }
}
