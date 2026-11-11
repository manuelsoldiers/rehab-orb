// Clinical constants and pure functions. Every number here is listed, with its source, in FACTS.md.

// ---- 6-Minute Walk Test ---------------------------------------------------
export const SIXMWT = {
  duration: 360,           // s
  lapMetres: 60,           // one lap = out and back on a 30 m course
  // Standard phrases (ATS 2002). `t` in seconds from the start.
  cues: [
    { t: 60, label: '1:00', text: 'You are doing well. You have 5 minutes to go.' },
    { t: 120, label: '2:00', text: 'Keep up the good work. You have 4 minutes to go.' },
    { t: 180, label: '3:00', text: 'You are doing well. You are halfway done.' },
    { t: 240, label: '4:00', text: 'Keep up the good work. You have only 2 minutes left.' },
    { t: 300, label: '5:00', text: 'You are doing well. You have only 1 minute to go.' },
    { t: 345, label: '5:45', text: 'In a moment I am going to tell you to stop. When I do, just stop right where you are and I will come to you.' },
    { t: 360, label: '6:00', text: 'Stop!' },
  ],
};

// Enright & Sherrill 1998 reference equations (healthy adults aged 40–80). Returns metres or null.
export function predicted6mwd({ sex, age, height, weight }) {
  if (!sex || !age || !height || !weight) return null;
  const d = sex === 'm'
    ? 7.57 * height - 5.02 * age - 1.76 * weight - 309
    : 2.11 * height - 2.29 * weight - 5.78 * age + 667;
  return Math.round(d);
}
export const ENRIGHT_AGE_RANGE = [40, 80];

// Splits from lap timestamps: [{ index, at, seconds, speed, change }] (change vs previous lap, in %).
export function lapSplits(laps, lapMetres = SIXMWT.lapMetres) {
  return laps.map((at, i) => {
    const seconds = at - (i ? laps[i - 1] : 0);
    const prev = i ? laps[i - 1] - (i > 1 ? laps[i - 2] : 0) : null;
    return {
      index: i + 1, at, seconds,
      speed: seconds > 0 ? lapMetres / seconds : 0,
      change: prev ? Math.round((seconds - prev) / prev * 100) : null,
    };
  });
}

// ---- 30-Second Chair Stand (CDC STEADI) -----------------------------------
// Below-average cut-offs: a score lower than the number is below average for that age band.
export const CST = {
  duration: 30,
  bands: [
    { from: 60, to: 64, m: 14, f: 12 },
    { from: 65, to: 69, m: 12, f: 11 },
    { from: 70, to: 74, m: 12, f: 10 },
    { from: 75, to: 79, m: 11, f: 10 },
    { from: 80, to: 84, m: 10, f: 9 },
    { from: 85, to: 89, m: 8, f: 8 },
    { from: 90, to: 94, m: 7, f: 4 },
  ],
};

export function cstBand(age) {
  if (!age) return -1;
  return CST.bands.findIndex((b) => age >= b.from && age <= b.to);
}

// Returns { band, cutoff, below } or null when age/sex are missing or outside 60–94.
export function cstJudge(reps, { sex, age }) {
  const i = cstBand(age);
  if (i < 0 || !sex) return null;
  const cutoff = CST.bands[i][sex];
  return { band: i, cutoff, below: reps < cutoff };
}

// ---- Modified Borg scale (dyspnoea, 0–10) ---------------------------------
export const BORG = [
  { v: 0, words: 'nothing at all' },
  { v: 0.5, words: 'very, very slight' },
  { v: 1, words: 'very slight' },
  { v: 2, words: 'slight' },
  { v: 3, words: 'moderate' },
  { v: 4, words: 'somewhat severe' },
  { v: 5, words: 'severe' },
  { v: 6, words: '' },
  { v: 7, words: 'very severe' },
  { v: 8, words: '' },
  { v: 9, words: 'very, very severe' },
  { v: 10, words: 'maximal' },
];
export const BORG_MCID = 1;   // Ries 2005, COPD

export function borgWords(v) {
  const row = BORG.find((r) => r.v === v);
  return row ? row.words : '';
}

// A spoken number is accepted only if it exists on the scale (whole numbers and 0.5).
export function borgSnap(n) {
  return BORG.some((r) => r.v === n) ? n : null;
}

// ---- Patient --------------------------------------------------------------
export function describePatient(p) {
  const parts = [];
  if (p.sex) parts.push(p.sex === 'm' ? 'man' : 'woman');
  if (p.age) parts.push(`${p.age} years`);
  if (p.height) parts.push(`${p.height} cm`);
  if (p.weight) parts.push(`${p.weight} kg`);
  return parts.join(', ');
}

// Reads sex / age / height / weight out of a normalised utterance. Returns the fields it found.
export function parsePatient(norm) {
  const out = {};
  if (/\b(female|woman|lady)\b/.test(norm)) out.sex = 'f';
  else if (/\b(male|man|gentleman)\b/.test(norm)) out.sex = 'm';
  const age = norm.match(/\b(\d{2,3}) ?(?:years?|yrs?|year old|y o|yo)\b/) || norm.match(/\baged? (\d{2,3})\b/);
  if (age && +age[1] >= 18 && +age[1] <= 110) out.age = +age[1];
  const h = norm.match(/\b(\d{3}) ?(?:cm|centimet(?:er|re)s?)\b/);
  if (h && +h[1] >= 100 && +h[1] <= 230) out.height = +h[1];
  const w = norm.match(/\b(\d{2,3}) ?(?:kg|kilos?|kilograms?)\b/);
  if (w && +w[1] >= 25 && +w[1] <= 250) out.weight = +w[1];
  return out;
}
