// Text helpers shared by the brain and the panels. The app is English-only for now.
export const SPEECH_LOCALE = 'en-US';

// Lower-case, strip accents and punctuation: the form every intent pattern is written against.
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9.,+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtElapsed(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Spoken numbers the recogniser may return as words ("twelve metres").
const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

// "seventy two" -> "72", "a hundred and seventy" -> "170"; digits pass through untouched.
export function wordsToDigits(norm) {
  const out = [];
  let acc = null;
  const flush = () => { if (acc !== null) { out.push(String(acc)); acc = null; } };
  const tokens = norm.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok in WORDS) {
      const v = WORDS[tok];
      if (acc === null) acc = v;
      else if (v < 10 && acc % 10 === 0 && acc % 100 !== 0) acc += v; // twenty + two, 100 stays open below
      else if (acc % 100 === 0 && acc > 0) acc += v;                   // one hundred + seventy
      else { flush(); acc = v; }
    } else if (tok === 'hundred') {
      acc = (acc === null ? 1 : acc) * 100;
    } else if (tok === 'and' && acc !== null && acc % 100 === 0 && tokens[i + 1] in WORDS) {
      // "one hundred and seventy": keep accumulating
    } else if (tok === 'half' && tokens[i - 1] === 'a') {
      out.pop(); flush(); out.push('0.5');
    } else {
      flush(); out.push(tok);
    }
  }
  flush();
  return out.join(' ');
}
