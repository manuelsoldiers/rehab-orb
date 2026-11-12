import { C, W, PAD, roundRect } from '../ui/kit.js';
import { describePatient } from './clinical.js';

const TILES = [
  { id: 'sixmwt', name: '6-Minute Walk Test', line: 'Timer, standard phrases, laps, % of predicted' },
  { id: 'cst', name: '30-Second Chair Stand', line: 'Count stands, compare with STEADI cut-offs' },
  { id: 'borg', name: 'Modified Borg Scale', line: 'Dyspnoea and leg fatigue, before and after' },
];

const DEFAULTS = { age: 70, height: 170, weight: 75 };
const EXAMPLE = { sex: 'm', age: 72, height: 170, weight: 78 };

export class Home {
  constructor(app) { this.app = app; this.id = 'home'; this.label = 'Menu'; }
  get busy() { return false; }

  enter() {
    this.app.say('Pick a test, or just ask. You can also give me the patient’s sex, age, height and weight.');
  }

  press(t) {
    const id = t.id, p = this.app.patient;
    if (id.startsWith('open:')) return this.app.open(id.slice(5));
    if (id.startsWith('sex:')) { p.sex = id.slice(4); return this.app.patientChanged(); }
    if (id.startsWith('step:')) {
      const [, key, delta] = id.split(':');
      p[key] = p[key] == null ? DEFAULTS[key] : p[key] + Number(delta);
      return this.app.patientChanged();
    }
    if (id === 'example') { Object.assign(p, EXAMPLE); this.app.patientChanged(); return this.app.say(`Example patient loaded: ${describePatient(p)}. It is fictional.`); }
    if (id === 'clear') { Object.assign(p, { sex: null, age: null, height: null, weight: null }); return this.app.patientChanged(); }
    if (id === 'voice') return this.app.toggleVoice();
    if (id === 'sound') return this.app.toggleSound();
    return false;
  }

  hear() { return false; }

  height() { return 776; }

  draw(kit) {
    const { c, d } = kit, app = this.app, p = app.patient, bottom = 772;
    kit.frame({ title: 'Rehab Orb', sub: 'Clinical test assistant · point or speak', cardBottom: bottom, pinned: app.pinned, home: false });

    const gap = 20, tw = (W - 2 * PAD - 2 * gap) / 3, ty = 214, th = 236;
    TILES.forEach((t, i) => {
      const x = PAD + i * (tw + gap), id = `open:${t.id}`, on = kit.isHover(id);
      roundRect(c, x, ty, tw, th, 22);
      c.fillStyle = on ? C.pillHover : C.tile; c.fill();
      c.strokeStyle = on ? C.cyan : C.pillEdge; c.lineWidth = 2; c.stroke();
      this.glyph(d, t.id, x + 28, ty + 28, tw - 56, 92);
      kit.text(c, t.name, x + 26, ty + 164, { size: 28, weight: 700 });
      kit.wrap(c, t.line, x + 26, ty + 196, tw - 48, { size: 20, color: C.dim, lh: 26 });
      kit.region(id, x, ty, tw, th);
    });

    // Patient strip. Nothing here is stored: it lives in memory until the page closes.
    const py = 500;
    kit.text(c, 'Patient · not stored', PAD, py, { size: 21, color: C.dim, spacing: 2, upper: true });
    const filled = describePatient(p);
    kit.text(c, filled || 'optional: needed for % predicted and cut-offs', W - PAD, py, { size: 22, color: filled ? C.text : C.faint, align: 'right' });
    const ry = py + 22, rh = 58;
    kit.chip('Man', PAD, ry, 104, rh, 'sex:m', { active: p.sex === 'm', size: 23 });
    kit.chip('Woman', PAD + 116, ry, 124, rh, 'sex:f', { active: p.sex === 'f', size: 23 });
    const steppers = [['age', 'y'], ['height', 'cm'], ['weight', 'kg']];
    steppers.forEach(([key, unit], i) => {
      const x = PAD + 278 + i * 306;
      kit.chip('−', x, ry, 58, rh, `step:${key}:-1`, { size: 30 });
      kit.text(c, p[key] == null ? `${key}` : `${p[key]} ${unit}`, x + 58 + 82, ry + 38, { size: 25, weight: 600, align: 'center', color: p[key] == null ? C.faint : C.text });
      kit.chip('+', x + 58 + 164, ry, 58, rh, `step:${key}:1`, { size: 30 });
    });
    kit.chips(ry + rh + 22, 58, [
      { label: 'Example patient', id: 'example', flex: 1.4, size: 23 },
      { label: 'Clear', id: 'clear', flex: 0.8, size: 23 },
      { label: app.voiceLabel(), id: 'voice', flex: 1.3, size: 23, active: app.voiceOn() },
      { label: app.soundLabel(), id: 'sound', flex: 1.1, size: 23, active: app.soundOn(), accent: C.amber },
    ]);
    kit.text(c, 'Decision support for trained professionals. Not a medical device. Nothing is stored or sent.', PAD, bottom - 34, { size: 21, color: C.faint });
  }

  // Small line drawings on the data layer, so the swarm has something to assemble on the menu too.
  glyph(d, id, x, y, w, h) {
    d.save(); d.strokeStyle = C.ink; d.fillStyle = C.ink; d.lineWidth = 4; d.lineCap = 'round'; d.lineJoin = 'round';
    if (id === 'sixmwt') {
      d.beginPath(); d.moveTo(x + 30, y + h - 26); d.lineTo(x + w - 30, y + h - 26); d.stroke();
      for (let i = 0; i <= 10; i++) { const tx = x + 30 + (w - 60) * i / 10; d.beginPath(); d.moveTo(tx, y + h - 34); d.lineTo(tx, y + h - 18); d.stroke(); }
      d.fillStyle = C.amber;
      for (const cx of [x + 10, x + w - 10]) { d.beginPath(); d.moveTo(cx, y + h - 54); d.lineTo(cx + 13, y + h - 12); d.lineTo(cx - 13, y + h - 12); d.closePath(); d.fill(); }
      d.strokeStyle = C.cyan; d.setLineDash([2, 12]);
      d.beginPath(); d.moveTo(x + 44, y + 26); d.lineTo(x + w - 44, y + 26); d.stroke();
    } else if (id === 'cst') {
      const cx = x + w / 2 - 40;
      d.beginPath();
      d.moveTo(cx, y + 4); d.lineTo(cx, y + h - 4);                    // back and back leg
      d.moveTo(cx, y + 52); d.lineTo(cx + 70, y + 52); d.lineTo(cx + 70, y + h - 4);   // seat and front leg
      d.stroke();
      d.strokeStyle = C.cyan;
      d.beginPath(); d.moveTo(cx + 104, y + 62); d.lineTo(cx + 104, y + 12); d.moveTo(cx + 90, y + 28); d.lineTo(cx + 104, y + 12); d.lineTo(cx + 118, y + 28); d.stroke();
    } else {
      const n = 9, bw = (w - 16) / n - 8;
      for (let i = 0; i < n; i++) {
        const bh = 12 + (h - 16) * (i / (n - 1));
        d.fillStyle = i < 4 ? C.cyan : i < 7 ? C.amber : C.red;
        d.fillRect(x + 8 + i * (bw + 8), y + h - bh, bw, bh);
      }
    }
    d.restore();
  }
}
