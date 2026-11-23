// Spin-dle answer matching, shared by the game and the curator.
// A guess counts if it is close to the object's name or any of its accepted alternatives.

// Lower-case, strip accents and punctuation, and drop a leading "the/a/an".
export function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

// Edit distance: how many single-letter changes turn one string into the other.
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// How many typos to forgive, by answer length: none for very short words, up to 3 for long names.
export function tolerance(len) {
  return len <= 4 ? 0 : len <= 8 ? 1 : len <= 14 ? 2 : 3;
}

// Returns the accepted name the guess matched, or null.
export function match(guess, names) {
  const g = norm(guess);
  if (!g) return null;
  const gs = g.replace(/ /g, '');
  for (const n of names) {
    const t = norm(n);
    if (!t) continue;
    const ts = t.replace(/ /g, '');
    if (g === t || gs === ts) return n;
    if (Math.min(lev(g, t), lev(gs, ts)) <= tolerance(ts.length)) return n;
  }
  return null;
}
