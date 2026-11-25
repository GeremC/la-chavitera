// Moteur de recommandation : qualité de la recette + goûts appris + part de découverte
import { DB } from './data.js';
import * as S from './store.js';

export const DEFAULT_SETTINGS = {
  people: 2, meals: 5, exclusions: [], equipment: ['four', 'micro-ondes', 'mixeur', 'batteur'],
  discovery: 0.35, menuTypes: ['plat'], maxTime: 0,
};
export const settings = () => ({ ...DEFAULT_SETTINGS, ...S.get('settings', {}) });

const DAY = 86400000;

export function isExcluded(r, st = settings()) {
  if (st.exclusions.length && r.k.some(k => st.exclusions.some(x => k.includes(x)))) return true;
  if (r.eq && r.eq.some(e => !st.equipment.includes(e))) return true;
  return false;
}

// profil de goût construit à partir des notes et des recettes cuisinées
export function tasteProfile() {
  const w = new Map(), seenCuisine = new Set(), seenKey = new Set(), lastCooked = new Map();
  const add = (f, v) => w.set(f, (w.get(f) || 0) + v);
  const feats = r => [r.c && 'c:' + r.c, 't:' + r.t, 'd:' + r.d, ...r.k.slice(0, 6).map(k => 'k:' + k)].filter(Boolean);
  for (const [id, rt] of S.list('rate:')) {
    const r = DB.byId.get(+id); if (!r) continue;
    let v = 0;
    if (rt.thumb === 1) v += 1; else if (rt.thumb === -1) v -= 1.5;
    if (rt.stars) v += (rt.stars - 3) / 2;
    feats(r).forEach(f => add(f, v));
  }
  for (const [, h] of S.list('hist:')) {
    for (const it of h.items || []) {
      const r = DB.byId.get(it.id); if (!r) continue;
      feats(r).forEach(f => add(f, 0.25));
      if (r.c) seenCuisine.add(r.c); r.k.forEach(k => seenKey.add(k));
      lastCooked.set(r.id, Math.max(lastCooked.get(r.id) || 0, h.date || 0));
    }
  }
  return { w, seenCuisine, seenKey, lastCooked, size: w.size };
}

export function score(r, prof, st = settings()) {
  let s = (r.s - 4.3) * 2.2 + Math.log10(r.rc + 1) * 0.35;
  let aff = 0, n = 0;
  const f = [r.c && 'c:' + r.c, 't:' + r.t, 'd:' + r.d, ...r.k.slice(0, 6).map(k => 'k:' + k)].filter(Boolean);
  for (const x of f) { const v = prof.w.get(x); if (v) { aff += v; n++; } }
  aff = n ? aff / Math.sqrt(f.length) : 0;
  s += Math.max(-3, Math.min(3, aff)) * 0.9;
  // découverte : cuisines et ingrédients jamais cuisinés
  const novelC = r.c && !prof.seenCuisine.has(r.c) ? 1 : 0;
  const novelK = r.k.length ? r.k.filter(k => !prof.seenKey.has(k)).length / r.k.length : 0;
  s += st.discovery * (novelC * 1.6 + novelK * 0.8);
  // pas deux fois la même recette en peu de temps
  const lc = prof.lastCooked.get(r.id);
  if (lc) { const weeks = (Date.now() - lc) / (7 * DAY); s -= weeks < 3 ? 6 : weeks < 8 ? 2 : 0.5; }
  if (st.maxTime && r.tm && r.tm > st.maxTime) s -= 2;
  return s;
}

export function reason(r, prof, st = settings()) {
  if (r.c && prof.w.get('c:' + r.c) > 0.8) return { txt: 'Vous aimez : ' + r.c, cls: 'reason' };
  const likedK = r.k.find(k => prof.w.get('k:' + k) > 1);
  if (likedK && prof.size) return { txt: 'Vous aimez ce genre de plat', cls: 'reason' };
  if (st.discovery > 0.2 && r.c && !prof.seenCuisine.has(r.c)) return { txt: 'Découverte : ' + r.c, cls: 'disc' };
  if (r.rc >= 200 && r.r >= 4.7) return { txt: 'Coup de cœur', cls: 'reason' };
  return null;
}

// tirage pondéré pour varier, avec diversité de cuisines et d'ingrédient principal
export function suggest(count, { exclude = new Set(), types } = {}) {
  const st = settings(), prof = tasteProfile();
  types = types || st.menuTypes;
  const pool = DB.list.filter(r => types.includes(r.t) && !exclude.has(r.id) && !isExcluded(r, st))
    .map(r => ({ r, s: score(r, prof, st) })).sort((a, b) => b.s - a.s).slice(0, 250);
  const out = [], cuis = {}, mains = {};
  const temp = 0.6 + st.discovery * 0.8;
  while (out.length < count && pool.length) {
    const top = pool[0].s;
    const weights = pool.map(p => Math.exp((p.s - top) / temp));
    let x = Math.random() * weights.reduce((a, b) => a + b, 0), i = 0;
    while ((x -= weights[i]) > 0 && i < pool.length - 1) i++;
    const { r } = pool.splice(i, 1)[0];
    const c = r.c || '?', m = r.k[0] || '?';
    if ((c !== '?' && (cuis[c] || 0) >= 2) || (mains[m] || 0) >= 2) continue;
    cuis[c] = (cuis[c] || 0) + 1; mains[m] = (mains[m] || 0) + 1;
    out.push(r);
  }
  return out;
}

export function ranked(list) {
  const st = settings(), prof = tasteProfile();
  return list.map(r => ({ r, s: score(r, prof, st) })).sort((a, b) => b.s - a.s).map(x => x.r);
}
