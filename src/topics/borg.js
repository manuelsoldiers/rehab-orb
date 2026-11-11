import { C, W, PAD } from '../ui/kit.js';
import { BORG, BORG_MCID, borgWords, borgSnap } from './clinical.js';

const SRC = 'Modified Borg scale · Burdon 1982 · as used in ATS 2002';

const NOTES = {
  instruct: {
    dyspnoea: { head: 'What to tell the patient', body: '“Point to the number or words that match your breathing right now.” Hold the scale in sight, give no hints, and rate breathlessness only: not the throat, not the nose.', src: 'Paraphrase of the standardised instruction · Int J COPD 2012;7:345–355' },
    fatigue: { head: 'What to tell the patient', body: '“Point to the number or words that match how tired your legs feel right now.” Leg fatigue gets its own score, separate from breathlessness.', src: 'ATS 2002 records dyspnoea and fatigue separately · wording is a paraphrase' },
  },
  mcid: { head: 'How much change matters', body: 'A change of about 1 point can be clinically meaningful in COPD. Compare ratings only after the same effort, for example the end of the same walk.', src: 'Ries, COPD 2005;2:105–110' },
  rpe: { head: 'Not the 6–20 scale', body: 'Do not mix this up with the 6 to 20 Borg scale of perceived exertion. This 0 to 10 scale rates the intensity of a symptom: here, breathlessness.', src: 'Borg, Med Sci Sports Exerc 1982;14:377–381' },
  sources: {
    head: 'Sources',
    body: 'Scale: Burdon et al., Am Rev Respir Dis 1982;126:825–828, as reproduced in the ATS 2002 walk test statement. Instruction: Int J COPD 2012;7:345–355. Meaningful change: Ries, COPD 2005;2:105–110. The Borg scales are © G. Borg: this is a simplified redrawing for teaching. With patients, use your centre’s licensed, validated version.',
  },
};

const NAMES = { dyspnoea: 'Dyspnoea', fatigue: 'Leg fatigue' };

function rampColor(v) {              // cool → warm with intensity
  const stops = [[0, [103, 201, 255]], [4, [255, 197, 82]], [10, [255, 96, 84]]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (v >= stops[i][0] && v <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const k = (v - a[0]) / (b[0] - a[0] || 1);
  return `rgb(${a[1].map((ch, i) => Math.round(ch + (b[1][i] - ch) * k)).join(',')})`;
}

export class Borg {
  constructor(app) {
    this.app = app;
    this.id = 'borg';
    this.label = 'Modified Borg Scale';
    this.dim = 'dyspnoea'; this.when = 'before';
    this.ratings = { dyspnoea: { before: null, after: null }, fatigue: { before: null, after: null } };
    this.note = null;
    app.session.borg = this.ratings;
  }

  get busy() { return false; }

  enter() {
    this.app.say('Modified Borg scale. Hold it where the patient can see it and let them point. I will record the rating.');
  }

  rate(v) {
    this.ratings[this.dim][this.when] = v;
    const r = this.ratings[this.dim], words = borgWords(v);
    let line = `${v}${words ? `, ${words}` : ''}. Recorded as ${NAMES[this.dim].toLowerCase()} ${this.when} the effort.`;
    if (r.before != null && r.after != null) {
      const diff = r.after - r.before;
      line += diff === 0 ? ' No change from before.' : ` That is ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'point' : 'points'} ${diff > 0 ? 'higher' : 'lower'} than before.`;
      if (this.dim === 'dyspnoea' && Math.abs(diff) >= BORG_MCID) this.note = NOTES.mcid;
    }
    this.app.refresh();
    this.app.say(line);
  }

  explain(key) {
    const n = key === 'instruct' ? NOTES.instruct[this.dim] : NOTES[key]; if (!n) return;
    this.note = n; this.app.refresh();
    this.app.say(key === 'sources' ? 'Here are the sources.' : n.body.replace(/[“”]/g, ''));
  }

  set(dim, when) {
    if (dim) this.dim = dim;
    if (when) this.when = when;
    this.app.refresh();
  }

  press(t) {
    const id = t.id;
    if (id.startsWith('rate:')) return this.rate(Number(id.slice(5)));
    if (id.startsWith('dim:')) return this.set(id.slice(4), null);
    if (id.startsWith('when:')) return this.set(null, id.slice(5));
    if (id.startsWith('note:')) return this.explain(id.slice(5));
    if (id === 'clear') { for (const k of Object.keys(this.ratings)) this.ratings[k] = { before: null, after: null }; this.app.session.borg = this.ratings; this.note = null; return this.app.refresh(); }
    return false;
  }

  hear(n) {
    if (/\b(source|reference|evidence)s?\b/.test(n)) return this.explain('sources');
    if (/instruct|tell the patient|what (do|should) i say/.test(n)) return this.explain('instruct');
    if (/6 (to|-) ?20|rpe|exertion/.test(n)) return this.explain('rpe');
    if (/meaningful|mcid|how much change|important difference/.test(n)) return this.explain('mcid');
    let handled = false;
    if (/\b(leg|legs|fatigue|tired)\b/.test(n)) { this.dim = 'fatigue'; handled = true; }
    else if (/dyspn|breath/.test(n)) { this.dim = 'dyspnoea'; handled = true; }
    if (/\b(before|baseline|rest|pre)\b/.test(n)) { this.when = 'before'; handled = true; }
    else if (/\b(after|post|end)\b/.test(n)) { this.when = 'after'; handled = true; }
    const m = n.match(/\b(10|\d(?:\.5)?)\b/);
    if (m) { const v = borgSnap(Number(m[1])); if (v != null) return this.rate(v); }
    if (handled) { this.app.refresh(); return this.app.say(`${NAMES[this.dim]}, ${this.when} the effort.`); }
    return false;
  }

  height(kit) { return 880 + (this.note ? 16 + kit.drawerHeight(this.note) : 0) + 4; }

  draw(kit) {
    const { c, d } = kit, bottom = 880;
    const cur = this.ratings[this.dim][this.when];
    kit.frame({
      title: 'Modified Borg Scale',
      sub: `${NAMES[this.dim]} · ${this.when} the effort · 0–10`,
      value: cur != null ? String(cur) : '–',
      delta: cur != null ? (borgWords(cur) || 'between words') : 'point at the scale',
      deltaColor: cur != null ? rampColor(cur) : C.dim,
      cardBottom: bottom, pinned: this.app.pinned,
    });

    const y0 = 208, rowH = 43, bx = 150;
    BORG.forEach((row, i) => {
      const y = y0 + i * rowH, id = `rate:${row.v}`, on = kit.isHover(id), sel = cur === row.v;
      const len = 26 + row.v * 40;
      if (on || sel) { c.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)'; c.fillRect(PAD - 12, y, 760, rowH - 4); }
      kit.text(c, String(row.v), PAD + 62, y + 30, { size: 30, weight: 700, align: 'right', color: on || sel ? C.ink : C.text });
      d.fillStyle = rampColor(row.v); d.globalAlpha = sel || on ? 1 : 0.82;
      d.fillRect(bx, y + 7, len, rowH - 18); d.globalAlpha = 1;
      if (row.words) kit.text(c, row.words, bx + len + 16, y + 29, { size: 25, weight: sel ? 700 : 500, color: on || sel ? C.ink : C.text });
      if (sel) { d.save(); d.translate(PAD - 2, y + rowH / 2 - 2); d.rotate(Math.PI / 4); d.fillStyle = C.amber; d.fillRect(-7, -7, 14, 14); d.restore(); }
      kit.region(id, PAD - 12, y, 760, rowH, { kind: 'point' });
    });

    // Recorded ratings, before and after.
    const tx = 850, tw = W - PAD - tx, ty = 226;
    kit.text(c, 'Recorded', tx, ty, { size: 21, color: C.dim, spacing: 2, upper: true });
    kit.text(c, 'before', tx + tw - 190, ty + 44, { size: 20, color: C.dim, align: 'right' });
    kit.text(c, 'after', tx + tw - 96, ty + 44, { size: 20, color: C.dim, align: 'right' });
    kit.text(c, 'Δ', tx + tw, ty + 44, { size: 20, color: C.dim, align: 'right' });
    Object.keys(NAMES).forEach((k, i) => {
      const r = this.ratings[k], y = ty + 96 + i * 62, act = k === this.dim;
      const show = (v) => (v == null ? '–' : String(v));
      kit.text(c, NAMES[k], tx, y, { size: 24, weight: act ? 700 : 500, color: act ? C.ink : C.dim });
      kit.text(c, show(r.before), tx + tw - 190, y, { size: 30, weight: 700, align: 'right', color: act && this.when === 'before' ? C.amber : C.text });
      kit.text(c, show(r.after), tx + tw - 96, y, { size: 30, weight: 700, align: 'right', color: act && this.when === 'after' ? C.amber : C.text });
      if (r.before != null && r.after != null) {
        const diff = r.after - r.before;
        kit.text(c, `${diff > 0 ? '+' : ''}${diff}`, tx + tw, y, { size: 26, weight: 700, align: 'right', color: Math.abs(diff) >= BORG_MCID ? C.cyan : C.dim });
      }
    });
    kit.wrap(c, 'Numbers and words together. Whole or half numbers are fine. The patient points; you give no hints.', tx, ty + 250, tw, { size: 22, color: C.faint, lh: 31 });
    kit.chips(ty + 366, 54, [{ label: 'Meaningful change', id: 'note:mcid', size: 21 }, { label: 'Not 6–20', id: 'note:rpe', size: 21 }], { x: tx, w: tw });

    kit.footer(766, SRC);
    kit.chips(790, 64, [
      { label: 'Dyspnoea', id: 'dim:dyspnoea', active: this.dim === 'dyspnoea' },
      { label: 'Leg fatigue', id: 'dim:fatigue', active: this.dim === 'fatigue' },
      { label: 'Before', id: 'when:before', active: this.when === 'before', accent: C.amber },
      { label: 'After', id: 'when:after', active: this.when === 'after', accent: C.amber },
      { label: 'Instruction', id: 'note:instruct' },
      { label: 'Sources', id: 'note:sources' },
    ]);
    if (this.note) kit.drawer(bottom + 16, this.note);
  }
}
