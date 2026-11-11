import { C, W, PAD, TOP } from '../ui/kit.js';
import { fmtClock, fmtElapsed } from '../core/text.js';
import { SIXMWT, predicted6mwd, lapSplits, describePatient, ENRIGHT_AGE_RANGE } from './clinical.js';

const SRC = 'ATS 2002 · Am J Respir Crit Care Med 166:111–117';

const NOTES = {
  course: {
    head: 'The course',
    body: 'A flat, straight, hard-surfaced corridor, 30 metres long, with a cone at each turnaround point. One lap, out and back, is 60 metres.',
    src: SRC,
  },
  cones: { head: 'Turnaround cones', body: 'Mark each end of the 30 metre course with a cone. The patient walks around the cone and comes back.', src: SRC },
  marks: { head: 'Marks every 3 m', body: 'Mark the corridor every 3 metres, so you can read the last partial lap at the end of the test.', src: SRC },
  rest: { head: 'Before the test', body: 'The patient rests in a chair near the start for at least 10 minutes before walking. No warm-up.', src: SRC },
  baseline: { head: 'Baseline measures', body: 'Before the walk record pulse, oxygen saturation and blood pressure, and ask the patient to rate dyspnoea and fatigue on the Borg scale. Repeat the Borg ratings at the end.', src: SRC },
  alone: { head: 'Do not walk alongside', body: 'Stand near the start and count the laps. Do not walk with the patient: your pace would change theirs.', src: SRC },
  script: { head: 'Only the standard phrases', body: 'Each minute say the standard phrase in an even tone and nothing else. No other encouragement, and no body language to speed the patient up.', src: SRC },
  stop: {
    head: 'Stop at once if',
    body: 'Chest pain, intolerable dyspnoea, leg cramps, staggering, diaphoresis, or a pale or ashen appearance. Sit the patient down and reassess.',
    src: SRC,
  },
  instruct: {
    head: 'What to tell the patient',
    body: '“Walk as far as you can in six minutes. You may slow down, stop and rest if you need to, then resume as soon as you can. Do not run.” This is a short paraphrase: read the full script from your protocol.',
    src: SRC,
  },
  contra: {
    head: 'Contraindications',
    body: 'Absolute: unstable angina or myocardial infarction in the previous month. Relative: resting heart rate above 120, systolic pressure above 180 mmHg, diastolic above 100 mmHg.',
    src: SRC,
  },
  sources: {
    head: 'Sources',
    body: 'Protocol, phrases and stop rules: ATS Statement, Am J Respir Crit Care Med 2002;166:111–117. Reference equations: Enright & Sherrill, AJRCCM 1998;158:1384–7. Learning effect and two tests: ERS/ATS technical standard and review, Eur Respir J 2014;44:1428–46 and 1447–78. Check your centre’s protocol before formal use.',
  },
};

// The simulated patient of the demo: lap times in seconds, then a final stretch.
const DEMO_LAPS = [50, 51, 53, 62, 58, 56];
const DEMO_PARTIAL = 32;

const laps = (n) => `${n} ${n === 1 ? 'lap' : 'laps'}`;

function niceMax(v, step = 60) { return Math.max(step, Math.ceil(v / step) * step); }

export class SixMWT {
  constructor(app) {
    this.app = app;
    this.id = 'sixmwt';
    this.label = '6-Minute Walk Test';
    this.reset();
  }

  reset() {
    this.phase = 'ready';      // ready | running | final | result
    this.t = 0; this.demo = false; this.laps = []; this.partial = 0;
    this.stoppedAt = null; this.said = new Set(); this.focus = null; this.note = null;
    this._shown = -1; this._auto = 0;
  }

  get busy() { return this.phase === 'running' || this.phase === 'final'; }
  get distance() { return this.laps.length * SIXMWT.lapMetres + this.partial; }
  get total() { return this.stoppedAt ?? SIXMWT.duration; }

  enter() {
    if (this.phase === 'ready') {
      this.app.say('Six-minute walk test. Point at the course, or at a minute to hear its phrase. Say start when the patient is ready.');
    }
  }

  // ---- actions ------------------------------------------------------------
  start(demo) {
    this.reset();
    this.phase = 'running'; this.demo = demo;
    this.app.morph();
    this.app.say(demo
      ? 'Demo: a simulated patient, twelve times faster than real time.'
      : 'Timer started. I will give the standard phrase at each minute. Tap lap each time the patient is back at the start.');
  }

  lap() {
    if (this.phase !== 'running') return;
    this.laps.push(this.t);
    this.app.refresh();
  }

  stop(early = true) {
    if (this.phase !== 'running') return;
    if (early) { this.stoppedAt = Math.round(this.t); }
    this.phase = 'final';
    this._auto = 0;
    this.app.refresh();
    this.app.say(early
      ? `Test stopped at ${fmtElapsed(this.t)}. Sit the patient down, note the reason, then enter the metres of the last partial lap.`
      : 'Stop! Mark the spot. How many metres in the last partial lap?');
  }

  finish() {
    if (this.phase !== 'final') return;
    this.phase = 'result';
    const text = this.summary();
    this.note = { head: 'What this means', body: text.long };
    this.app.session.sixmwt = { distance: this.distance, laps: this.laps.length, pct: text.pct, stoppedAt: this.stoppedAt };
    this.app.morph();
    this.app.say(text.short);
  }

  summary() {
    const p = this.app.patient, d = this.distance, pred = predicted6mwd(p);
    const early = this.stoppedAt ? ` The test was stopped at ${fmtElapsed(this.stoppedAt)}.` : '';
    const borg = this.app.session.borg?.dyspnoea;
    const borgLine = borg && borg.before != null && borg.after != null
      ? ` Borg dyspnoea went from ${borg.before} to ${borg.after}.` : '';
    const learn = ' On a first test expect a learning effect: a second walk averages about 26 metres more.';
    if (!pred) {
      return {
        pct: null,
        short: `${d} metres.${early} Give me the patient's sex, age, height and weight and I will compare it with the reference equations.`,
        long: `${d} m walked.${early}${borgLine} Give me sex, age, height and weight to compare it with the Enright & Sherrill reference equations.${learn}`,
      };
    }
    const pct = Math.round(d / pred * 100);
    const outside = p.age < ENRIGHT_AGE_RANGE[0] || p.age > ENRIGHT_AGE_RANGE[1]
      ? ` The patient's age is outside the 40 to 80 range those equations were built on, so treat the figure with extra caution.` : '';
    return {
      pct, pred,
      short: `${d} metres: ${pct} percent of the ${pred} predicted.${early} That is a reference value, not a diagnosis.`,
      long: `${d} m is ${pct}% of the ${pred} m predicted for a ${describePatient(p)} (Enright & Sherrill 1998).${early}${borgLine} The equations explain only about 40% of the variance in healthy adults, so read the result with symptoms, SpO₂ and the patient's own baseline: it is not a diagnosis.${outside}${learn}`,
    };
  }

  explain(key, speak = true) {
    const n = NOTES[key]; if (!n) return;
    this.note = n;
    this.app.refresh();
    if (speak) this.app.say(key === 'sources' ? 'Here are the sources.' : n.body.replace(/[“”]/g, ''));
  }

  sayCue(i) {
    const cue = SIXMWT.cues[i];
    this.note = { head: `Standard phrase at ${cue.label}`, body: `“${cue.text}”`, src: SRC };
    this.app.refresh();
    const when = cue.t === 345 ? 'Fifteen seconds before the end' : `At minute ${cue.t / 60}`;
    this.app.say(`${when}, say: ${cue.text}`);
  }

  focusLap(i) {
    const splits = lapSplits(this.laps);
    if (i > splits.length) {                       // the end point of the walk
      const last = this.laps.length ? this.laps[this.laps.length - 1] : 0;
      const secs = this.total - last;
      this.focus = i;
      const body = `Final stretch: ${this.partial} m in ${Math.round(secs)} s${secs > 0 && this.partial ? ` (${(this.partial / secs).toFixed(2)} m/s)` : ''}. The walk ended at ${fmtElapsed(this.total)} with ${this.distance} m.`;
      this.note = { head: 'End of the walk', body };
      this.app.morph(); this.app.say(body);
      return;
    }
    const s = splits[i - 1]; if (!s) return;
    this.focus = i;
    let body = `Lap ${s.index} took ${Math.round(s.seconds)} seconds, ${s.speed.toFixed(2)} metres per second`;
    if (s.change != null && Math.abs(s.change) >= 5) {
      body += `: ${Math.abs(s.change)}% ${s.change > 0 ? 'slower' : 'faster'} than lap ${s.index - 1}.`;
      if (s.change > 0) body += ' Timing alone cannot tell me why. Note any rest, symptom or desaturation you saw at that point.';
    } else if (s.change != null) body += ', about the same pace as the lap before.';
    else body += '.';
    this.note = { head: `What happened at lap ${s.index}`, body };
    this.app.morph(); this.app.say(body);
  }

  // ---- input --------------------------------------------------------------
  press(t) {
    const id = t.id;
    if (id === 'start') return this.start(false);
    if (id === 'demo') return this.start(true);
    if (id === 'lap') return this.lap();
    if (id === 'undo') { this.laps.pop(); return this.app.refresh(); }
    if (id === 'stop') return this.stop(true);
    if (id === 'done') return this.finish();
    if (id.startsWith('adj:')) { this.partial = Math.min(59, Math.max(0, this.partial + Number(id.slice(4)))); return this.app.refresh(); }
    if (id === 'again') { this.reset(); this.app.morph(); return this.app.say('Ready for a new test.'); }
    if (id === 'whole') { this.focus = null; this.note = { head: 'What this means', body: this.summary().long }; return this.app.morph(); }
    if (id === 'borg') return this.app.open('borg');
    if (id.startsWith('note:')) return this.explain(id.slice(5));
    if (id.startsWith('item:')) return this.explain(id.slice(5));
    if (id.startsWith('cue:')) return this.sayCue(Number(id.slice(4)));
    if (id.startsWith('lap:')) return this.focusLap(Number(id.slice(4)));
    return false;
  }

  hear(n) {
    if (/stop (rule|criteri)|when (to|do i|should i) stop|safety/.test(n)) return this.explain('stop');
    if (/contraindicat/.test(n)) return this.explain('contra');
    if (/\b(source|reference|evidence)s?\b/.test(n) && !/equation/.test(n)) return this.explain('sources');
    if (/instruct|tell the patient/.test(n)) return this.explain('instruct');
    if (/phrase|script|what (do|should) i say|encourag/.test(n)) return this.explain('script');
    if (/\b(course|corridor|track)\b/.test(n)) return this.explain('course');
    if (/baseline|before the (test|walk)/.test(n)) return this.explain('baseline');
    if (this.phase === 'ready') {
      if (/\bdemo\b|simulat/.test(n)) return this.start(true);
      if (/\b(start|begin)\b/.test(n) || /^(ok |and )?go$/.test(n)) return this.start(false);
    } else if (this.phase === 'running') {
      if (/\bundo\b/.test(n)) { this.laps.pop(); return this.app.refresh(); }
      if (/\blap\b/.test(n)) return this.lap();
      if (/\b(stop|finish)\b|\bend (the )?(test|walk)\b/.test(n)) return this.stop(true);
    } else if (this.phase === 'final') {
      const m = n.match(/^(\d{1,2})$/) || n.match(/\b(\d{1,2}) ?(?:m|met(?:er|re)s?)\b/);
      if (m && +m[1] < 60) { this.partial = +m[1]; return this.finish(); }
      if (/\b(done|finish|result|zero|none)\b/.test(n)) return this.finish();
    } else if (this.phase === 'result') {
      const m = n.match(/\blap (\d{1,2})\b/);
      if (m && +m[1] >= 1 && +m[1] <= this.laps.length) return this.focusLap(+m[1]);
      if (/\b(whole|overview|zoom out|all laps)\b/.test(n)) return this.press({ id: 'whole' });
      if (/\b(new|again|reset|restart|repeat)\b/.test(n)) return this.press({ id: 'again' });
      if (/\b(result|mean|interpret|predicted|normal)\b/.test(n)) { this.focus = null; const s = this.summary(); this.note = { head: 'What this means', body: s.long }; this.app.morph(); return this.app.say(s.short); }
    }
    return false;
  }

  patientChanged() {
    if (this.phase === 'result' && this.focus == null) this.note = { head: 'What this means', body: this.summary().long };
  }

  // ---- time ---------------------------------------------------------------
  tick(dt) {
    if (this.phase === 'final' && this.demo) {
      this._auto += dt;
      if (this._auto > 3.2) this.finish();
      return;
    }
    if (this.phase !== 'running') return;
    this.t += dt * (this.demo ? 12 : 1) * this.app.speed;
    if (this.demo) {
      let at = 0;
      DEMO_LAPS.forEach((secs, i) => { at += secs; if (this.t >= at && this.laps.length === i) this.laps.push(at); });
    }
    SIXMWT.cues.forEach((cue, i) => {
      if (this.t >= cue.t && !this.said.has(i) && cue.t < SIXMWT.duration) { this.said.add(i); this.app.say(cue.text); }
    });
    if (this.t >= SIXMWT.duration) {
      this.t = SIXMWT.duration;
      if (this.demo) this.partial = DEMO_PARTIAL;
      this.stop(false);
      return;
    }
    const shown = Math.floor(this.t * (this.demo ? 0.25 : 1));     // redraw once per displayed step
    if (shown !== this._shown) { this._shown = shown; this.app.refresh(); }
  }

  // ---- drawing ------------------------------------------------------------
  height(kit) {
    const card = this.phase === 'ready' ? 800 : 760;
    let h = card;
    if (this.phase === 'result' && this.focus != null && this.focus <= this.laps.length) h += 16 + 170;
    if (this.note) h += 16 + kit.drawerHeight(this.note);
    return h + 4;
  }

  draw(kit) {
    if (this.phase === 'ready') this.drawReady(kit);
    else if (this.phase === 'result') this.drawResult(kit);
    else this.drawRunning(kit);
  }

  drawReady(kit) {
    const { c, d } = kit, bottom = 800;
    kit.frame({ title: '6-Minute Walk Test', sub: 'ATS 2002 · 30 m course · 1 lap = 60 m', value: '6:00', delta: 'ready', cardBottom: bottom, pinned: this.app.pinned });

    // The course, seen from above.
    const x0 = 150, x1 = 1130, yA = 262, yB = 318, m = (x1 - x0) / 30;
    kit.text(c, '30 m', (x0 + x1) / 2, 236, { size: 24, weight: 700, align: 'center' });
    kit.text(c, '3 m', x0 + 4.5 * m, yB + 34, { size: 20, color: C.dim, align: 'center' });
    kit.text(c, 'START', x0, yB + 34, { size: 20, color: C.dim, align: 'center', spacing: 1.5 });
    d.strokeStyle = C.ink; d.lineWidth = 4; d.lineCap = 'round';
    d.beginPath(); d.moveTo(x0, yA); d.lineTo(x1, yA); d.moveTo(x0, yB); d.lineTo(x1, yB); d.stroke();
    d.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { const x = x0 + i * 3 * m; d.beginPath(); d.moveTo(x, yA + 12); d.lineTo(x, yB - 12); d.stroke(); }
    for (const x of [x0 - 34, x1 + 34]) {             // cones
      d.fillStyle = kit.isHover('item:cones') ? C.cyan : C.amber;
      d.beginPath(); d.moveTo(x, yA - 4); d.lineTo(x + 20, yB + 4); d.lineTo(x - 20, yB + 4); d.closePath(); d.fill();
    }
    kit.region('item:course', x0 - 60, 214, x1 - x0 + 120, 150);
    kit.region('item:marks', x0 + 2 * m, yA - 14, 26 * m, yB - yA + 28);
    kit.region('item:cones', x0 - 64, yA - 20, 64, yB - yA + 44);
    kit.region('item:cones', x1, yA - 20, 64, yB - yA + 44);

    // The six minutes and their phrases.
    const ty = 446, cues = SIXMWT.cues.filter((q) => q.t % 60 === 0);
    const tx = (sec) => x0 + (sec / 360) * (x1 - x0);
    kit.text(c, 'Standard phrases · point at a minute', x0, ty - 46, { size: 21, color: C.dim, spacing: 2, upper: true });
    d.strokeStyle = C.ink; d.lineWidth = 4;
    d.beginPath(); d.moveTo(x0, ty); d.lineTo(x1, ty); d.stroke();
    d.fillStyle = C.ink; d.beginPath(); d.arc(x0, ty, 6, 0, 7); d.fill();
    let hot = null;
    cues.forEach((q) => {
      const idx = SIXMWT.cues.indexOf(q), x = tx(q.t), on = kit.isHover(`cue:${idx}`);
      if (on) hot = q;
      d.fillStyle = on ? C.amber : C.ink;
      d.beginPath(); d.arc(x, ty, on ? 14 : 10, 0, 7); d.fill();
      kit.text(c, `${q.t / 60}′`, x, ty + 40, { size: 22, color: on ? C.amber : C.dim, align: 'center', weight: on ? 700 : 500 });
    });
    kit.region('cue', x0 + 60, ty - 34, x1 - x0, 84, {
      resolve: (px) => {
        const minute = Math.min(6, Math.max(1, Math.round(((px - x0) / (x1 - x0)) * 6)));
        const idx = SIXMWT.cues.findIndex((q) => q.t === minute * 60);
        return { id: `cue:${idx}`, kind: 'point' };
      },
    });
    kit.text(c, hot ? `“${hot.text}”` : 'One phrase per minute, in an even tone. Nothing else.', W / 2, ty + 88, {
      size: 26, align: 'center', color: hot ? C.text : C.faint, weight: hot ? 600 : 500,
    });

    // Checklist.
    const items = [
      ['item:rest', 'Rest 10 min, seated near the start'],
      ['item:baseline', 'Baseline: pulse · SpO₂ · BP · Borg'],
      ['item:alone', 'Do not walk alongside · count laps'],
      ['item:script', 'No encouragement beyond the script'],
    ];
    items.forEach(([id, label], i) => {
      const x = PAD + (i % 2) * 600, y = 584 + Math.floor(i / 2) * 46, on = kit.isHover(id);
      c.fillStyle = on ? C.cyan : C.dim; c.beginPath(); c.arc(x + 8, y - 9, 6, 0, 7); c.fill();
      kit.text(c, label, x + 28, y, { size: 25, color: on ? C.cyan : C.text });
      kit.region(id, x, y - 34, 580, 46, { kind: 'point' });
    });

    kit.footer(690, SRC);
    kit.chips(712, 64, [
      { label: 'Start', id: 'start', flex: 1.4, active: true },
      { label: 'Demo ×12', id: 'demo' },
      { label: 'Stop rules', id: 'note:stop' },
      { label: 'Sources', id: 'note:sources' },
    ]);
    if (this.note) kit.drawer(bottom + 16, this.note);
  }

  drawRunning(kit) {
    const { c, d } = kit, bottom = 760, final = this.phase === 'final';
    const lapsM = this.laps.length * SIXMWT.lapMetres;
    kit.frame({
      title: '6-Minute Walk Test',
      sub: this.demo ? 'Demo ×12 · simulated patient' : 'ATS 2002 · 1 lap = 60 m',
      value: final ? `${lapsM} + ${this.partial} m` : fmtClock(SIXMWT.duration - this.t),
      delta: final ? `${laps(this.laps.length)} + last stretch` : `${laps(this.laps.length)} · ${lapsM} m`,
      cardBottom: bottom, pinned: this.app.pinned,
    });
    const ymax = niceMax(Math.max(300, lapsM + 90), 120);
    const ch = kit.chart({
      x: 130, y: 214, w: 1090, h: 300, xmin: 0, xmax: 360, ymin: 0, ymax,
      xticks: [1, 2, 3, 4, 5, 6].map((mn) => ({ v: mn * 60, label: `${mn}′` })),
      yticks: [0, ymax / 2, ymax].map((v) => ({ v, label: `${v} m` })),
    });
    this.plotWalk(kit, ch, this.t, false);
    d.strokeStyle = C.amber; d.lineWidth = 3;
    d.beginPath(); d.moveTo(ch.sx(this.t), ch.y); d.lineTo(ch.sx(this.t), ch.y + ch.h); d.stroke();

    if (final) {
      kit.text(c, 'Time. Mark the spot.', PAD, 600, { size: 30, weight: 700 });
      kit.text(c, 'Metres walked in the last partial lap:', PAD, 638, { size: 25, color: C.dim });
      kit.text(c, `${this.partial} m`, W - PAD, 624, { size: 54, weight: 700, color: C.amber, align: 'right' });
      kit.chips(668, 68, [
        { label: '−5', id: 'adj:-5' }, { label: '−1', id: 'adj:-1' }, { label: '+1', id: 'adj:1' },
        { label: '+5', id: 'adj:5' }, { label: '+10', id: 'adj:10' }, { label: 'Done', id: 'done', flex: 1.6, active: true },
      ]);
    } else {
      const next = SIXMWT.cues.find((q) => q.t > this.t);
      if (next) {
        kit.text(c, `Next · ${next.label}`, PAD, 594, { size: 21, color: C.dim, spacing: 2, upper: true });
        const txt = next.text.length > 70 ? `${next.text.slice(0, 68)}…` : next.text;
        kit.text(c, `“${txt}”`, PAD, 632, { size: 27, weight: 600 });
      }
      kit.chips(668, 68, [
        { label: '+1 lap  ·  60 m', id: 'lap', flex: 3, size: 30, accent: C.amber },
        { label: 'Undo', id: 'undo' },
        { label: 'Stop test', id: 'stop', flex: 1.3 },
      ]);
    }
    if (this.note) kit.drawer(bottom + 16, this.note);
  }

  // Cumulative distance over time. Returns the plotted points.
  plotWalk(kit, ch, until, withEnd) {
    const { d } = kit, L = SIXMWT.lapMetres;
    const pts = [{ t: 0, m: 0 }, ...this.laps.map((at, i) => ({ t: at, m: (i + 1) * L }))];
    if (withEnd) pts.push({ t: this.total, m: this.distance });
    d.save();
    d.beginPath(); d.rect(ch.x - 14, ch.y - 14, ch.w + 28, ch.h + 28); d.clip();
    d.strokeStyle = C.ink; d.lineWidth = 4; d.lineJoin = 'round'; d.lineCap = 'round';
    d.beginPath();
    pts.forEach((p, i) => (i ? d.lineTo(ch.sx(p.t), ch.sy(p.m)) : d.moveTo(ch.sx(p.t), ch.sy(p.m))));
    d.stroke();
    if (!withEnd && until > pts[pts.length - 1].t) {          // distance since the last lap is unknown
      const last = pts[pts.length - 1];
      d.setLineDash([4, 10]); d.lineWidth = 3; d.globalAlpha = 0.6;
      d.beginPath(); d.moveTo(ch.sx(last.t), ch.sy(last.m)); d.lineTo(ch.sx(until), ch.sy(last.m)); d.stroke();
      d.setLineDash([]); d.globalAlpha = 1;
    }
    d.fillStyle = C.ink;
    pts.slice(1).forEach((p) => { d.beginPath(); d.arc(ch.sx(p.t), ch.sy(p.m), 7, 0, 7); d.fill(); });
    d.restore();
    return pts;
  }

  drawResult(kit) {
    const { c, d } = kit, bottom = 760;
    const pred = predicted6mwd(this.app.patient);
    const pct = pred ? Math.round(this.distance / pred * 100) : null;
    const splits = lapSplits(this.laps);
    const focusSplit = this.focus != null ? splits[this.focus - 1] : null;
    kit.frame({
      title: '6-Minute Walk Test',
      sub: `${this.demo ? 'Demo · simulated patient · ' : ''}${laps(this.laps.length)} × 60 m + ${this.partial} m${this.stoppedAt ? ` · stopped at ${fmtElapsed(this.stoppedAt)}` : ''}`,
      value: `${this.distance} m`,
      delta: pct ? `${pct}% of predicted` : 'no reference yet',
      deltaColor: pct ? C.cyan : C.dim,
      cardBottom: bottom, pinned: this.app.pinned,
    });

    // Zoom on the pointed lap, as the reference reel zooms on the pointed day.
    const T = this.total;
    let xmin = 0, xmax = Math.max(T, 60);
    if (this.focus != null) {
      const i = Math.min(this.focus, this.laps.length);
      xmin = this.laps[i - 3] ?? 0;
      xmax = this.laps[i] ?? T;
      if (this.focus > this.laps.length) xmax = T;
      const padT = (xmax - xmin) * 0.06; xmin = Math.max(0, xmin - padT); xmax = Math.min(T + padT, xmax + padT);
    }
    const ymax = niceMax(Math.max(this.distance, pred ?? 0) * 1.08, 120);
    const span = xmax - xmin, stepT = span > 200 ? 60 : span > 90 ? 30 : 15;
    const xticks = [];
    for (let v = Math.ceil(xmin / stepT) * stepT; v <= xmax + 0.01; v += stepT) if (v > xmin + 1) xticks.push({ v, label: fmtElapsed(v) });
    const ch = kit.chart({
      x: 130, y: 214, w: 1090, h: 300, xmin, xmax, ymin: 0, ymax, xticks,
      yticks: [0, ymax / 2, ymax].map((v) => ({ v, label: `${v} m` })),
    });
    if (pred) {
      d.save(); d.strokeStyle = C.amber; d.lineWidth = 3; d.setLineDash([14, 10]);
      d.beginPath(); d.moveTo(ch.x, ch.sy(pred)); d.lineTo(ch.x + ch.w, ch.sy(pred)); d.stroke(); d.restore();
      kit.text(c, `predicted ${pred} m`, ch.x + ch.w - 6, ch.sy(pred) - 10, { size: 21, color: C.amber, align: 'right', weight: 600 });
    }
    const pts = this.plotWalk(kit, ch, T, true).slice(1);
    kit.region('laps', ch.x - 20, ch.y - 10, ch.w + 40, ch.h + 20, {
      resolve: (px) => {
        let best = -1, bd = 1e9;
        pts.forEach((p, i) => { const dx = Math.abs(ch.sx(p.t) - px); if (p.t >= xmin - 1 && p.t <= xmax + 1 && dx < bd) { bd = dx; best = i; } });
        return best < 0 || bd > 90 ? null : { id: `lap:${best + 1}`, kind: 'point' };
      },
    });
    const shown = kit.hover && kit.hover.id.startsWith('lap:') ? Number(kit.hover.id.slice(4)) : this.focus;
    if (shown != null && pts[shown - 1]) {
      const p = pts[shown - 1];
      const name = shown > this.laps.length ? 'End' : `Lap ${shown}`;
      kit.crosshair(ch.sx(p.t), ch.sy(p.m), ch.y, ch.y + ch.h, `${name}  /  ${fmtElapsed(p.t)}  /  ${p.m} m`);
    } else {
      kit.text(c, 'Point at a lap to see what happened there.', PAD, 600, { size: 24, color: C.faint });
    }
    kit.footer(640, 'Reference: Enright & Sherrill 1998 · protocol: ATS 2002');
    kit.chips(668, 68, [
      { label: 'New test', id: 'again' },
      ...(this.focus != null ? [{ label: 'Whole walk', id: 'whole', active: true }] : []),
      { label: 'Borg scale', id: 'borg' },
      { label: 'Stop rules', id: 'note:stop' },
      { label: 'Sources', id: 'note:sources' },
    ]);

    let y = bottom + 16;
    if (focusSplit) {                                       // lap strip: the pointed lap among the others
      kit.card(y, y + 170, C.drawer);
      const s = focusSplit;
      const change = s.change == null ? '' : `   /   ${s.change > 0 ? '+' : ''}${s.change}% time vs lap ${s.index - 1}`;
      kit.text(c, `Lap ${s.index}`, PAD, y + 46, { size: 22, weight: 700, color: C.dim, spacing: 2, upper: true });
      kit.text(c, `${Math.round(s.seconds)} s   /   ${s.speed.toFixed(2)} m/s${change}`, PAD + 110, y + 46, { size: 24, weight: 600 });
      const all = splits.map((q) => q.seconds), maxS = Math.max(...all), lo = Math.min(...all) * 0.8;
      const bw = Math.min(120, (W - 2 * PAD) / splits.length - 14);
      splits.forEach((q, i) => {
        const bh = 14 + 68 * ((q.seconds - lo) / (maxS - lo || 1)), bx = PAD + i * (bw + 14), by = y + 134 - bh;
        d.fillStyle = q.index === s.index ? C.amber : 'rgba(255,255,255,0.55)';
        d.fillRect(bx, by, bw, bh);
        kit.text(c, `${Math.round(q.seconds)} s`, bx + bw / 2, y + 158, { size: 18, color: C.dim, align: 'center' });
      });
      y += 170 + 16;
    }
    if (this.note) kit.drawer(y, this.note);
  }
}
