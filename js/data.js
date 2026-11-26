// Chargement de la base de recettes + libellés et formatage
export const DB = { meta: null, list: [], byId: new Map(), details: new Map(), ready: false, error: null };
const bucketCache = new Map();

export async function loadDB() {
  let meta;
  try {
    const r = await fetch('data/version.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('absent');
    meta = await r.json();
  } catch {
    DB.error = 'nodata'; return DB;
  }
  const res = await fetch('data/index.json?v=' + meta.v);
  const idx = await res.json();
  DB.meta = idx; DB.list = idx.recipes; DB.byId = new Map(idx.recipes.map(r => [r.id, r])); DB.ready = true;
  return DB;
}

export async function details(id) {
  if (DB.details.has(id)) return DB.details.get(id);
  const b = id % (DB.meta.buckets || 200);
  if (!bucketCache.has(b)) bucketCache.set(b, fetch(`data/r/${b}.json?v=${DB.meta.v}`).then(r => r.json()));
  const content = await bucketCache.get(b);
  const d = content[String(id)];
  DB.details.set(id, d);
  return d;
}

// ------------------------------------------------------------ libellés façon Marmiton
export const DIFF = ['', 'Très facile', 'Facile', 'Niveau moyen', 'Difficile'];
export const COST = ['', 'Bon marché', 'Coût moyen', 'Assez cher'];
export const TYPES = { plat: 'Plat', entree: 'Entrée / soupe', dessert: 'Dessert', 'petit-dej': 'Petit-déj', boulangerie: 'Boulangerie', sauce: 'Sauce / tartinade', boisson: 'Boisson' };
export const EQUIP = [
  ['four', 'oven', 'Four'], ['micro-ondes', 'microwave', 'Micro-ondes'], ['mixeur', 'blender', 'Mixeur / robot'],
  ['batteur', 'whisk', 'Batteur'], ['mijoteuse', 'pot', 'Mijoteuse'], ['autocuiseur', 'pressure', 'Autocuiseur / Cookeo'],
  ['barbecue', 'grill', 'Barbecue'], ['friteuse', 'fries', 'Friteuse'], ['air-fryer', 'wind', 'Air Fryer'],
];
const KW = {
  'Easy': 'Facile', '< 15 Mins': 'Moins de 15 min', '< 30 Mins': 'Moins de 30 min', '< 60 Mins': 'Moins d\'1 h',
  '< 4 Hours': 'Moins de 4 h', 'Healthy': 'Healthy', 'Low Cholesterol': 'Pauvre en cholestérol', 'High Protein': 'Riche en protéines',
  'Kid Friendly': 'Les enfants adorent', 'Vegan': 'Vegan', 'Vegetable': 'Légumes', 'Meat': 'Viande', 'Poultry': 'Volaille',
  'Beginner Cook': 'Débutant', 'Inexpensive': 'Pas cher', 'Weeknight': 'Soir de semaine', 'One Dish Meal': 'Plat unique',
  'For Large Groups': 'Grandes tablées', 'Spicy': 'Épicé', 'Low Protein': 'Pauvre en protéines', 'Very Low Carbs': 'Très peu de glucides',
  'Lactose Free': 'Sans lactose', 'Egg Free': 'Sans œuf', 'Free Of...': 'Sans allergène', 'Summer': 'Été', 'Winter': 'Hiver',
  'Christmas': 'Noël', 'Thanksgiving': 'Thanksgiving', 'Brunch': 'Brunch', 'Potluck': 'Auberge espagnole', 'Oven': 'Au four',
  'Stove Top': 'Sur le feu', 'Microwave': 'Micro-ondes', 'Freezer': 'Se congèle', 'Asian': 'Asie', 'European': 'Europe',
  'Mexican': 'Mexique', 'Low Cholesterol ': 'Pauvre en cholestérol', 'Chicken': 'Poulet', 'Beans': 'Légumineuses',
  'Fruit': 'Fruits', 'Savory': 'Salé', 'Sweet': 'Sucré', 'Grains': 'Céréales', 'Cheese': 'Fromage', 'Pasta': 'Pâtes',
};
export const kwFr = k => KW[k] || null;

export const name = r => r.fr || r.n;

export function minutes(m) {
  if (!m) return '?';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), mm = m % 60;
  return h + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
}

// ------------------------------------------------------------ quantités
const FR = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
export function niceNum(q) {
  if (q == null) return '';
  const w = Math.floor(q), f = q - w;
  if (f < 0.07) return String(w || (q > 0 ? '¼' : '0'));
  if (f > 0.93) return String(w + 1);
  let best = FR[0]; for (const c of FR) if (Math.abs(c[0] - f) < Math.abs(best[0] - f)) best = c;
  return (w ? w + ' ' : '') + best[1];
}
export function fmtQty(q, u) {
  if (q == null) return '';
  if (u === 'g') return q >= 1000 ? (Math.round(q / 100) / 10).toString().replace('.', ',') + ' kg' : roundTo(q, q < 20 ? 1 : 5) + ' g';
  if (u === 'ml') return q >= 1000 ? (Math.round(q / 100) / 10).toString().replace('.', ',') + ' L' : (q < 10 ? niceNum(q / 5) + ' c. à c.' : roundTo(q, 5) + ' ml');
  if (u === 'cs') return niceNum(q) + ' c. à s.';
  if (u === 'cc') return niceNum(q) + ' c. à c.';
  if (q >= 4 && (!u || COUNTED.has(u))) q = Math.round(q);      // « 3 oignons », pas « 2 ¾ »
  else if (q >= 1 && (!u || COUNTED.has(u))) q = Math.round(q * 2) / 2;
  if (u) return niceNum(q) + ' ' + u + (q > 1 && !/s$/.test(u) && !/[éè]e?$/.test(u) ? 's' : '');
  return niceNum(q);
}
const COUNTED = new Set(['gousse', 'branche', 'pièce', 'tranche']);
// nom et note (« émincés ») au singulier quand il n'y a qu'une pièce
// quantité pour f personnes ; un œuf ne se coupe pas (au moins 1, nombre entier)
export const qtyFor = (e, f) => e.q == null ? null : e.w ? Math.max(1, Math.round(e.q * f)) : e.q * f;
export const ingLabel = (e, q) => (q != null && q <= 1 && !e.u && e.fs) ? e.fs : (e.fr || e.n);
export const ingNote = (e, q) => (q != null && q <= 1 && e.ns) ? e.ns : (e.nt || '');
function roundTo(q, s) { return Math.max(s, Math.round(q / s) * s); }

// regroupe des quantités d'unités compatibles
export function unitFamily(u) { return u === 'g' ? 'mass' : (u === 'ml' || u === 'cs' || u === 'cc') ? 'vol' : (u || 'count'); }
export function toBase(q, u) { return u === 'cs' ? q * 15 : u === 'cc' ? q * 5 : q; }
export function fromBase(q, fam, units) {
  if (fam === 'vol') {
    if (units.size === 1) { const u = [...units][0]; return [u === 'cs' ? q / 15 : u === 'cc' ? q / 5 : q, u]; }
    return q < 45 ? [q / 15, 'cs'] : [q, 'ml'];
  }
  return [q, fam === 'mass' ? 'g' : fam === 'count' ? null : fam];
}

export function foodUrl(r) {
  const slug = r.n.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://www.food.com/recipe/${slug}-${r.id}`;
}
