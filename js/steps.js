// Mise en forme du texte des étapes : grandes parties (« For the sauce: »), notes,
// ingrédients illustrés dans le texte, durées cliquables (minuteur) et températures.
// Fonctionne sur le texte anglais d'origine comme sur les traductions françaises.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------ grandes parties
const NOTE_RE = /^(?:cook'?s? ?)?(?:notes?|hints?|tips?|astuces?|remarques?|variations?|variantes?|options?|caution|attention|important|this is important|historical note|serving suggestions?|suggestions?|to serve|to freeze|freezing(?: tips)?|pour congeler|pour geler|pour réchauffer|congélation|nota|optionnel|conseils?|please note|yet another note|do not|don'?t|ne pas|optional|facultatif|make ahead|ahead|oamc|nutrition\w*|side dish ideas|my favou?rite)\b/i;
const LEAD_RE = /^(?:pour faire (?:de la |du |des |la |le |les |l['’])?|for (?:the )?|to make (?:the )?|to prepare (?:the )?|make (?:the )?|pour (?:la |le |les |l['’])|préparation (?:de la |du |des |de l['’])|preparation of (?:the )?)/i;
const words = s => s.trim().split(/\s+/).length;
const isCaps = s => /[A-Z]/.test(s) && s === s.toUpperCase();

function cleanTitle(t) {
  t = t.replace(/^[•\-*\s]+/, '').replace(/[\s:.\-–]+$/, '').trim();
  if (isCaps(t)) t = t.toLowerCase();
  t = t.replace(LEAD_RE, '').trim();
  return cap(t);
}
function asHeader(s) {
  const t = s.trim().replace(/^[•\-*]\s*/, '');
  if (t.length > 48 || words(t) > 6 || /^(enjoy|bon appétit|serve)/i.test(t)) return null;
  if (/:$/.test(t) || (isCaps(t) && /[A-Z]{3}/.test(t) && /[.!]?$/.test(t) && !/!$/.test(t))) return t;
  return null;
}
// « ICING: Melt butter… », « For the crust: Cream butter… », « Pour la sauce : mélanger… »
const PREFIX_RE = /^\s*([A-Z][A-Z0-9 '&/\-]{2,40}|(?:For|To make|To prepare|Pour|Préparation)\b[^:.!?]{2,34})\s*:\s+(\S.*)$/s;
// « For the roux, in a heavy saucepan… » (seulement si la recette a déjà d'autres parties)
const COMMA_RE = /^\s*(?:For|To make|Pour) (?:the |la |le |les |l['’])([^,:.]{2,24}),\s+(\S.*)$/s;

/**
 * Découpe la liste d'étapes en éléments :
 *   { kind: 'section', title, note }  séparateur de grande partie (note = partie « Notes »)
 *   { kind: 'step', text, n, note }   étape numérotée (note = texte d'astuce, non numéroté)
 */
export function structureSteps(steps) {
  const out = [];
  let n = 0, inNotes = false, sections = 0;
  const raw = (steps || []).map(s => String(s || '').trim()).filter(Boolean);
  // 1er passage : la recette a-t-elle des parties explicites ?
  const explicit = raw.filter(s => asHeader(s) || (PREFIX_RE.test(s) && !NOTE_RE.test(s.match(PREFIX_RE)[1]) && words(s.match(PREFIX_RE)[1]) <= 5)).length;
  const section = (title, note) => {
    if (!title) return;
    inNotes = note; sections++;
    out.push({ kind: 'section', title, note });
  };
  const step = (text, note) => {
    if (note || inNotes) out.push({ kind: 'step', text, note: true });
    else out.push({ kind: 'step', text, n: ++n });
  };
  for (const s of raw) {
    const h = asHeader(s);
    if (h) {
      const title = cleanTitle(h);
      if (NOTE_RE.test(h.replace(/^[•\-*\s]+/, ''))) section(title, true); else section(title, false);
      continue;
    }
    const m = s.match(PREFIX_RE);
    if (m && words(m[1]) <= 5) {
      const label = m[1].trim();
      if (NOTE_RE.test(label)) { out.push({ kind: 'step', text: m[2], note: true, label: cleanTitle(label) }); continue; }
      section(cleanTitle(label), false); step(m[2]); continue;
    }
    const cm = s.match(COMMA_RE);
    if (cm && (explicit >= 1 || raw.filter(x => COMMA_RE.test(x)).length >= 2) && words(cm[1]) <= 3) {
      section(cap(cm[1].trim()), false); step(s); continue;
    }
    step(s);
  }
  // une seule « partie » tout en haut n'apporte rien : on la retire
  const secs = out.filter(x => x.kind === 'section' && !x.note);
  if (secs.length === 1 && out[0] === secs[0]) out.shift();
  return out;
}

// ------------------------------------------------------------ durées
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40 };
const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:[\s-]+\d\/\d|\s*[½¼¾])?|\d\/\d|[½¼¾]|forty-five|${Object.keys(NUMW).filter(k => k !== 'forty-five').join('|')})`;
const UNIT = String.raw`(hours?|hrs?|heures?|h(?![a-zà-ÿ])|minutes?|mins?|mn|seconds?|secs?|secondes?)`;
const DUR_RE = new RegExp(String.raw`(^|[^\p{L}\p{N}/])(?:(half an hour|une demi-heure|une demi heure)|(${NUM})(?:\s*(?:-|–|to|à|or|ou)\s*(${NUM}))?\s*${UNIT})(?![\p{L}])`, 'giu');
const EXTRA_RE = /\s*(?:and|et|,)?\s*(\d{1,2})\s*(minutes?|mins?|mn|min)?(?![\p{L}\p{N}])/uy;

function num(s) {
  s = s.trim().toLowerCase();
  if (s in NUMW) return NUMW[s];
  const frac = { '½': .5, '¼': .25, '¾': .75 };
  let m;
  if ((m = s.match(/^(\d+)[\s-]+(\d)\/(\d)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\s*([½¼¾])$/))) return +m[1] + frac[m[2]];
  if ((m = s.match(/^(\d)\/(\d)$/))) return m[1] / m[2];
  if (frac[s]) return frac[s];
  return parseFloat(s.replace(',', '.'));
}
const unitSec = u => /^(h|hours?|hrs?|heures?)$/i.test(u) ? 3600 : /^s|^sec/i.test(u) ? 1 : 60;

/** Trouve les durées d'un texte : [{ start, end, sec, text }] (sec = borne basse d'une fourchette). */
export function findDurations(text) {
  const res = [];
  DUR_RE.lastIndex = 0;
  let m;
  while ((m = DUR_RE.exec(text))) {
    const [all, pre, half, a, , unit] = m;
    const start = m.index + pre.length;
    let end = m.index + all.length, sec;
    if (half) sec = 1800;
    else {
      sec = num(a) * unitSec(unit);
      // « 1 hour and 30 minutes », « 1 h 30 »
      if (unitSec(unit) === 3600) {
        EXTRA_RE.lastIndex = end;
        const x = EXTRA_RE.exec(text);
        if (x && (x[2] || /^h$/i.test(unit))) { sec += +x[1] * 60; end = EXTRA_RE.lastIndex; }
      }
    }
    DUR_RE.lastIndex = end;
    if (!(sec >= 5 && sec <= 24 * 3600)) continue;
    res.push({ start, end, sec: Math.round(sec), text: text.slice(start, end) });
  }
  return res;
}

export function fmtDur(sec) {
  sec = Math.round(sec);
  if (sec < 60) return sec + ' s';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (!h) return m + ' min';
  return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
}

// ------------------------------------------------------------ ingrédients dans le texte
const GENERIC = new Set(['sauce', 'oil', 'powder', 'juice', 'extract', 'paste', 'leaves', 'leaf', 'seeds', 'seed', 'flakes', 'mix', 'water', 'fresh', 'dried', 'ground', 'large', 'small', 'whole', 'sliced', 'chopped',
  'cream', 'stock', 'broth', 'de', 'du', 'la', 'le', 'en', 'frais', 'moulu', 'séché', 'poudre', 'jus', 'huile']);
function variants(s) {
  s = (s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 3) return [];
  const v = new Set([s]);
  if (/ies$/.test(s)) v.add(s.replace(/ies$/, 'y'));
  else if (/oes$/.test(s)) v.add(s.replace(/es$/, ''));
  else if (/s$/.test(s)) v.add(s.slice(0, -1));
  else { v.add(s + 's'); if (/(o|ch|sh)$/.test(s)) v.add(s + 'es'); if (/y$/.test(s)) v.add(s.slice(0, -1) + 'ies'); }
  return [...v].filter(x => x.length >= 3);
}
/** Prépare la recherche des ingrédients d'une recette dans le texte des étapes. */
export function ingMatcher(ings) {
  const map = new Map();
  const add = (term, i) => { for (const t of variants(term)) if (!map.has(t)) map.set(t, i); };
  // d'abord les noms complets (prioritaires), puis le mot principal (« beef » pour « ground beef »)
  ings.forEach((e, i) => { add(e.fr, i); add(e.n, i); add(e.k, i); });
  ings.forEach((e, i) => {
    for (const name of [e.n, e.k]) {
      const w = (name || '').toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/);
      const head = w[w.length - 1];
      if (w.length > 1 && head && head.length >= 4 && !GENERIC.has(head)) add(head, i);
    }
    const fw = (e.fr || '').toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
    if (fw && fw.length >= 4 && !GENERIC.has(fw)) add(fw, i);
  });
  const terms = [...map.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return () => [];
  const re = new RegExp(String.raw`(^|[^\p{L}\p{N}])(` + terms.map(reEsc).join('|') + String.raw`)(?![\p{L}\p{N}])`, 'giu');
  return text => {
    const res = [], seen = new Set();
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const i = map.get(m[2].toLowerCase());
      const start = m.index + m[1].length;
      if (i != null && !seen.has(i)) { seen.add(i); res.push({ start, end: start + m[2].length, i }); }
      if (!m[0].length) re.lastIndex++;
      else re.lastIndex = start + m[2].length;
    }
    return res;
  };
}

// ------------------------------------------------------------ rendu
const TEMP_RE = /\d{2,3}\s*°\s*[CF]?(?:\s*\/\s*\d{2,3}\s*°\s*[CF]?)?|\d{2,3}\s*(?:degrees?|degrés)\s*[CF]?/gi;

/**
 * Rend une étape en HTML.
 * opts.ing(text) -> [{start,end,i}]   opts.ingHtml(i, txt) -> html   opts.timerHtml(d, txt) -> html   opts.tempHtml(txt) -> html
 */
export function renderStepText(text, opts) {
  const toks = [];
  for (const d of findDurations(text)) toks.push({ ...d, type: 't' });
  TEMP_RE.lastIndex = 0; let m;
  while ((m = TEMP_RE.exec(text))) toks.push({ start: m.index, end: m.index + m[0].length, type: 'c' });
  for (const g of opts.ing ? opts.ing(text) : []) toks.push({ ...g, type: 'i' });
  toks.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  let html = '', pos = 0;
  for (const t of toks) {
    if (t.start < pos) continue; // chevauchement : le premier gagne
    html += esc(text.slice(pos, t.start));
    const s = text.slice(t.start, t.end);
    html += t.type === 't' ? opts.timerHtml(t, s) : t.type === 'c' ? opts.tempHtml(s) : opts.ingHtml(t.i, s);
    pos = t.end;
  }
  return html + esc(text.slice(pos));
}
