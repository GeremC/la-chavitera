import * as S from './store.js';
import { DB, loadDB, details, DIFF, COST, TYPES, EQUIP, kwFr, name, minutes,
  fmtQty, unitFamily, toBase, fromBase, foodUrl, ingLabel, ingNote, qtyFor } from './data.js';
import * as R from './reco.js';
import { ic, ingIcon, typeIcon } from './icons.js';
import { APP_VERSION } from './version.js';
import { haptic, levelFor, hapticsOn, hapticsSupported, setHaptics } from './haptic.js';
import { structureSteps, ingMatcher, renderStepText, fmtDur } from './steps.js';
import * as T from './timers.js';

const $ = s => document.querySelector(s);
const view = $('#view'), sheet = $('#sheet');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let tab = 'menu', sheetState = null, ingLex = null;
const disc = { q: '', scope: 'all', type: 'plat', cuisine: '', quick: false, easy: false, cheap: false, shown: 30, focus: false };
const favIds = () => S.list('fav:').map(([k]) => +k).filter(id => DB.byId.has(id));
const discDefaultType = () => disc.scope === 'fav' ? '' : 'plat';
// la recherche et « Ajouter » ouvrent toujours sur Toutes les recettes ; seul le cœur ouvre les Favoris
function discScope(v) {
  if (disc.scope === v) return;
  const wasDefault = disc.type === discDefaultType();
  disc.scope = v; if (wasDefault) disc.type = discDefaultType();
  disc.shown = 30;
}
const histOpen = new Set();
let showDeleted = false;

// ------------------------------------------------------------ helpers UI
function toast(msg, action) {
  // action facultative : { label, act, id } affiche un bouton (ex. Annuler) et laisse le toast plus longtemps
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? `<button class="tact" data-act="${action.act}" data-id="${esc(action.id)}">${esc(action.label)}</button>` : '');
  t.classList.toggle('withact', !!action); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, action ? 3000 : 2200);
}
function modal(html) {
  $('#toast').hidden = true; // pas de bandeau par-dessus la fenêtre
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) closeModalEl(bg); });
  document.body.appendChild(bg);
  // une entrée d'historique : le bouton / geste retour ferme la fenêtre au lieu de quitter l'écran
  navPush({ ...navState(), modal: 1 });
  return bg;
}
function closeModalEl(bg) {
  if (navState().modal) history.back(); else dropModal(bg);
}
// la fenêtre glisse vers le bas avant de disparaître (même mouvement que la fiche recette)
function dropModal(bg) {
  if (!bg || bg.classList.contains('closing')) return;
  if (reduceMotion()) return bg.remove();
  bg.classList.add('closing'); setTimeout(() => bg.remove(), 180);
}
// confirmation dans le style de l'app, à la place des fenêtres grises du navigateur.
// onOk est appelé une fois la fenêtre refermée (après le retour d'historique), avec la saisie s'il y en a une.
let askOk = null, afterPop = null;
function ask({ title, text = '', ok, danger = false, input = null, onOk }) {
  const bg = modal(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
    ${input ? `<input class="field" id="askIn" value="${esc(input.value || '')}" placeholder="${esc(input.ph || '')}" maxlength="40" autocomplete="off" enterkeyhint="done">` : ''}
    <div class="mbtns"><button class="btn ghost" data-act="closeModal">Annuler</button><button class="btn${danger ? ' danger' : ''}" data-act="askOk">${esc(ok)}</button></div>`);
  bg.classList.add('ask'); askOk = onOk;
  const inp = bg.querySelector('#askIn');
  if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bg.querySelector('[data-act=askOk]').click(); } }); }
}

// ------------------------------------------------------------ historique (bouton / geste retour)
// Pile : Choisir est la racine (d = 0). Les autres onglets occupent un seul niveau au-dessus (remplacé
// d'onglet en onglet) ; la recherche, les listes, la fiche recette et les fenêtres empilent un niveau de plus.
// Retour : ferme d'abord fiche / fenêtre, puis recule d'un onglet vers la gauche ; depuis Choisir, quitte l'app.
const navState = () => history.state && typeof history.state.d === 'number' ? history.state : { tab: 'menu', d: 0 };
const navPush = st => history.pushState({ ...st, d: navState().d + 1 }, '');
const navReplace = st => history.replaceState(st, '');
let pendingTab = null;
// Courses / Cuisiner : on retient la ou les listes ouvertes pour que le retour y ramène
const tabState = t => (t === 'shop' || t === 'cook') && pick[t] ? { tab: t, list: pick[t] } : { tab: t };
function plate(r, cls = 'plate') {
  if (r && r.img) return `<img class="${cls}" loading="lazy" src="${esc(r.img)}" alt="" data-fb="${r.t || ''}">`;
  return `<div class="${cls} ph">${typeIcon(r?.t)}</div>`;
}
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName === 'IMG' && 'fb' in el.dataset) {
    const d = document.createElement('div'); d.className = el.className + ' ph'; d.innerHTML = typeIcon(el.dataset.fb); el.replaceWith(d);
  } else if (el.tagName === 'IMG' && 'fbi' in el.dataset) {
    const d = document.createElement('span'); d.innerHTML = ingIcon(el.dataset.fbi); el.replaceWith(d.firstChild);
  }
}, true);
// photos d'ingrédients (TheMealDB, associées par tools/ingredient_images.py), icône SVG sinon
let ingImg = {};
const ingPic = (k, n) => ingImg[k]
  ? `<img class="ingpic" loading="lazy" alt="" src="https://www.themealdb.com/images/ingredients/${encodeURIComponent(ingImg[k])}-Small.png" data-fbi="${esc(n)}">`
  : ingIcon(n);
const stepper = (act, id, val, suffix = '') =>
  `<span class="stepper"><button data-act="${act}" data-id="${id}" data-d="-1" aria-label="Moins">${ic('minus')}</button><span>${val}${suffix}</span><button data-act="${act}" data-id="${id}" data-d="1" aria-label="Plus">${ic('plus')}</button></span>`;
function setTitle(t, actions = '') { $('#title').innerHTML = t; $('#topActions').innerHTML = actions; }

// ------------------------------------------------------------ menus
// Plusieurs menus peuvent être en cours en même temps ; chacun a sa liste de courses
// (cases cochées, articles en plus, validation) et son suivi « Cuisiner », clés par id du menu.
// Stockage : une clé par menu (amenu:<id>) pour que la synchro fusionne menu par menu.
// Le menu « courant » (celui qu'on prépare) est un choix propre à chaque téléphone.
const LS_CUR = 'lc_cur_menu';
let draft = null;                       // menu vide pas encore enregistré
const newMenu = () => ({ id: S.uid(), created: Date.now(), items: [] });
function migrateMenu() {
  // ancien format : une seule clé « menu » (peut aussi venir d'un téléphone pas encore à jour)
  const old = S.get('menu');
  if (!old || !old.id) return;
  if (old.items?.length || S.get('amenu:' + old.id)) S.set('amenu:' + old.id, { ...(S.get('amenu:' + old.id) || {}), ...old });
  S.del('menu');
}
const menus = () => S.list('amenu:').map(([, m]) => m).filter(m => m && m.id && Array.isArray(m.items)).sort((a, b) => a.created - b.created);
const activeMenus = () => menus().filter(m => m.items.length);
const getMenu = id => { const m = S.get('amenu:' + id); return m && Array.isArray(m.items) ? m : null; };
function curId() { try { return localStorage.getItem(LS_CUR) || ''; } catch { return ''; } }
function setCur(id) { try { localStorage.setItem(LS_CUR, id); } catch {} }
function menu() {
  const m = getMenu(curId());
  if (m) return m;
  if (draft && draft.id === curId()) return draft;
  const all = menus();
  if (all.length) { const last = all[all.length - 1]; setCur(last.id); return last; }
  draft = newMenu(); setCur(draft.id); return draft;
}
const shortDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
function menuName(m) {
  if (m.name) return m.name;
  const base = 'Menu du ' + shortDate(m.created);
  const same = menus().filter(x => !x.name && x.id !== m.id && x.created < m.created && shortDate(x.created) === shortDate(m.created)).length;
  return same ? `${base} (${same + 1})` : base;
}
const inMenu = id => menu().items.some(i => i.id === id);
function saveMenu(m) { S.set('amenu:' + m.id, m); if (draft && draft.id === m.id) draft = null; }
function startNewMenu() {
  const cur = menu();
  if (!cur.items.length && !getMenu(cur.id)) return cur; // déjà sur un menu vide
  draft = newMenu(); setCur(draft.id); return draft;
}
let undoMenus = [], dishUndo = null, undoHist = null;
function deleteMenus(ids) {
  undoMenus = ids.map(getMenu).filter(Boolean);
  if (!undoMenus.length) return;
  undoMenus.forEach(m => S.del('amenu:' + m.id));
  toast(undoMenus.length > 1 ? `${undoMenus.length} menus supprimés` : 'Menu supprimé', { label: 'Annuler', act: 'undoMenus', id: '' });
}
function addToMenu(id, ppl) {
  const m = menu(); if (m.items.some(i => i.id === id)) return;
  m.items.unshift({ id, ppl: ppl || R.settings().people }); saveMenu(m); toast('Ajouté en haut du menu'); // le dernier ajouté en premier
}
function removeFromMenu(id, m = menu()) {
  const idx = m.items.findIndex(i => i.id === id); if (idx < 0) return;
  dishUndo = { mid: m.id, idx, it: m.items[idx] };
  m.items = m.items.filter(i => i.id !== id); saveMenu(m);
  toast('Recette retirée du menu', { label: 'Annuler', act: 'dishUndo', id: '' });
}
function replaceInMenu(id) {
  const m = menu(), old = DB.byId.get(id);
  const ex = new Set(m.items.map(i => i.id)); ex.add(id);
  (S.get('skipped') || []).forEach(x => ex.add(x));
  const [n] = R.suggest(1, { exclude: ex, types: [old?.t || 'plat'] });
  if (!n) return toast('Plus de suggestion disponible');
  m.items = m.items.map(i => i.id === id ? { id: n.id, ppl: i.ppl } : i); saveMenu(m);
  const sk = (S.get('skipped') || []).concat(id).slice(-60); S.set('skipped', sk);
}
function fillMenu(target) {
  const m = menu(), st = R.settings();
  target = target ?? st.meals;
  const cur = m.items;
  if (cur.length < target) {
    const ex = new Set(m.items.map(i => i.id)); (S.get('skipped') || []).forEach(x => ex.add(x));
    R.suggest(target - cur.length, { exclude: ex }).forEach(r => m.items.push({ id: r.id, ppl: st.people }));
  } else if (cur.length > target) m.items = m.items.slice(0, target);
  saveMenu(m);
}
function archiveWeek(mid) {
  const m = (mid && getMenu(mid)) || menu();
  if (!m.items.length) return toast('Le menu est vide');
  S.set('hist:' + m.id, { id: m.id, date: Date.now(), created: m.created, items: m.items, ...(m.name ? { name: m.name } : {}) });
  S.del('amenu:' + m.id);
  S.set('skipped', []);
  askRatings(m.items.map(i => i.id), 'Comment était ce menu ?');
  // s'il reste d'autres menus en cours on y bascule, sinon on en prépare un nouveau
  if (!menus().length) { draft = newMenu(); setCur(draft.id); fillMenu(); }
}

function askRatings(ids, title) {
  const rows = ids.map(id => DB.byId.get(id)).filter(Boolean).map(r => {
    const rt = S.get('rate:' + r.id, {});
    return `<div class="hist"><div class="row">${r.img ? `<img src="${esc(r.img)}" alt="" data-fb="${r.t}" style="width:56px;height:56px;border-radius:50%;object-fit:cover">` : `<span class="ph mini">${typeIcon(r.t)}</span>`}<div class="spacer">${esc(name(r))}</div></div>
      <div class="row" style="margin-top:10px;justify-content:center;gap:8px">
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="1" ${rt.thumb === 1 ? 'style="background:var(--green);color:#fff"' : ''}>${ic('thumbUp')} J'ai aimé</button>
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="-1" ${rt.thumb === -1 ? 'style="background:var(--ink);color:var(--on-ink)"' : ''}>${ic('thumbDown')} Bof</button>
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="0">Pas fait</button></div></div>`;
  }).join('');
  const m = modal(`<h2>${esc(title)}</h2><p class="muted">Vos avis affinent les prochaines suggestions.</p>${rows}<button class="btn big" data-act="closeModal">C'est noté</button>`);
  m.classList.add('ratings');
}

// ------------------------------------------------------------ réglages (résumé compact, ouvre le profil)
function settingsBar(st) {
  const bits = [`${st.people} pers.`];
  if (st.exclusions.length) bits.push(`${st.exclusions.length} exclu${st.exclusions.length > 1 ? 's' : ''}`);
  const missing = EQUIP.filter(([c]) => !st.equipment.includes(c)).length;
  if (missing) bits.push(`${missing} appareil${missing > 1 ? 's' : ''} en moins`);
  if (st.maxTime) bits.push(`${minutes(st.maxTime)} max`);
  bits.push(`découverte ${Math.round(st.discovery * 10)}/10`);
  return `<button class="setbar" data-act="go" data-tab="profile"><span class="si">${ic('sliders')}</span><span class="sl"><b>Réglages</b><span>${esc(bits.join(' · '))}</span></span>${ic('chevron', 'sm')}</button>`;
}

// ------------------------------------------------------------ vue Menu
function renderMenu() {
  const st = R.settings(), m = menu(), prof = R.tasteProfile();
  setTitle('Choisir', `<button class="ib" data-act="shareMenu" aria-label="Partager">${ic('share')}</button>`);
  const old = m.items.length && Date.now() - m.created > 6 * 86400000;
  const items = m.items.map(it => {
    const r = DB.byId.get(it.id); if (!r) return '';
    const rs = R.reason(r, prof, st);
    return `<div class="meal">
      <button data-act="open" data-id="${r.id}">${plate(r)}</button>
      <div class="info">
        <h3 data-act="open" data-id="${r.id}">${esc(name(r))}</h3>${r.fr ? `<div class="en">${esc(r.n)}</div>` : ''}
        <div class="chips">${rs ? `<span class="chip ${rs.cls}">${esc(rs.txt)}</span>` : ''}<span class="chip">${ic('starFill', 'sm gold')}${r.r.toFixed(1)}</span><span class="chip">${ic('clock')} ${minutes(r.tm)}</span></div>
        <div class="acts"><button class="pill" data-act="replace" data-id="${r.id}">Remplacer</button>
          ${stepper('ppl', r.id, it.ppl, ic('users', 'sm'))}
          <button class="round" data-act="remove" data-id="${r.id}" aria-label="Retirer">${ic('trash')}</button></div>
      </div></div>`;
  }).join('');
  const ex = new Set(m.items.map(i => i.id));
  const extras = R.suggest(3, { exclude: ex, types: ['dessert', 'entree'] });
  const nFav = favIds().length;
  view.innerHTML = `
    ${menuSwitch(m)}
    <div class="searchrow"><button class="search fake" data-act="openSearch">${ic('search')}<span>Rechercher une recette…</span></button>
      <button class="favbtn" data-act="openFavs" aria-label="Recettes favorites${nFav ? ` (${nFav})` : ''}">${ic('heartFill')}</button></div>
    ${settingsBar(st)}
    ${old ? `<div class="banner yellow"><span class="be">${ic('calendar')}</span><div class="spacer"><b style="background:none;color:inherit;padding:0">Nouvelle semaine ?</b><br><span class="small">Archivez ce menu pour le retrouver dans les Archives.</span></div><button class="btn small" data-act="archive" data-m="${m.id}">Archiver</button></div>` : ''}
    <div class="row mealsrow"><span class="spacer">Repas au menu</span>${stepper('meals', 0, m.items.length)}</div>
    ${m.items.length ? items : `<div class="empty"><div class="ee">${ic('utensils')}</div><h2>Menu vide</h2><p class="muted">On vous propose ${st.meals} recettes selon vos goûts ?</p><button class="btn" data-act="fill">Générer mon menu</button></div>`}
    <button class="addmeal" data-act="go" data-tab="discover"><div class="plate ph">${ic('pot')}</div><span class="spacer">Ajouter une recette</span><span class="round red">${ic('plus')}</span></button>
    ${m.items.length ? `<div class="pagecta"><button class="btn big" data-act="goShop" data-m="${m.id}">${ic('cart')} Voir la liste de courses</button></div>
      <div class="menuacts"><button class="pill" data-act="archive" data-m="${m.id}">${ic('archive')} Archiver ce menu</button><button class="pill" data-act="delCur">${ic('trash')} Supprimer</button></div>` : ''}
    ${extras.length ? `<div class="suggest"><h2>On vous suggère aussi…</h2>${extras.map(r => `
      <div class="meal"><button data-act="open" data-id="${r.id}">${plate(r)}</button><div class="info">
        <h3 data-act="open" data-id="${r.id}">${esc(name(r))}</h3>
        <div class="chips"><span class="chip" style="color:var(--ink)">${ic('starFill', 'sm gold')}${r.r.toFixed(1)}</span><span class="chip" style="color:var(--ink)">${ic('clock')} ${minutes(r.tm)}</span></div>
        <div><button class="pill" data-act="add" data-id="${r.id}">Ajouter</button></div></div></div>`).join('')}</div>` : ''}
    <div style="height:20px"></div>`;
}

// onglets des menus en cours : passer de l'un à l'autre, renommer, en créer un nouveau
// pastille numérotée d'un menu en cours (affichée seulement quand il y en a plusieurs)
function menuNo(m) { const act = activeMenus(); return act.length > 1 ? act.findIndex(x => x.id === m.id) + 1 : 0; }
const badgeN = n => n ? `<span class="mbadge c${(n - 1) % 6}" aria-label="Menu ${n}">${n}</span>` : '';
const badge = m => badgeN(menuNo(m));
function menuSwitch(cur) {
  const all = menus(), list = all.some(m => m.id === cur.id) ? all : [...all, cur];
  if (list.length < 2 && !cur.items.length) return '';
  return `<div class="fchips menus">${list.map(m => {
    const on = m.id === cur.id;
    return `<button class="fchip ${on ? 'on' : ''}" data-act="${on ? 'renameMenu' : 'pickMenu'}" data-m="${m.id}"${on ? ' aria-label="Renommer ce menu"' : ''}>${badge(m)}${esc(menuName(m))}<span class="n">${m.items.length}</span>${on ? ic('pencil', 'sm') : ''}</button>`;
  }).join('')}<button class="fchip add" data-act="newMenu">${ic('plus', 'sm')} Nouveau menu</button></div>`;
}

// ------------------------------------------------------------ vue Découvrir
function matchQuery(r, words) {
  const hay = norm([r.n, r.fr, r.c, TYPES[r.t], ...r.k].join(' ') + ' ' + (ingLex ? r.k.map(k => ingLex.fr.get(k) || '').join(' ') : ''));
  return words.every(w => hay.includes(w));
}
function renderDiscover(keepScroll) {
  setTitle(`<button class="back" data-act="go" data-tab="menu" aria-label="Retour au menu">${ic('back')}</button>Recettes${menus().length > 1 ? ` <span class="sub">pour ${esc(menuName(menu()))}</span>` : ''}`);
  const st = R.settings();
  const words = norm(disc.q).split(/\s+/).filter(Boolean);
  const favs = favIds(), isFav = disc.scope === 'fav';
  let hidden = 0;
  // en mode Favoris, on part des recettes aimées et le profil ne masque rien : c'est vous qui les avez choisies
  let list = (isFav ? favs.map(id => DB.byId.get(id)) : DB.list).filter(r => {
    if (!((!disc.type || r.t === disc.type) && (!disc.cuisine || r.c === disc.cuisine) &&
      (!disc.quick || (r.tm && r.tm <= 30)) && (!disc.easy || r.d <= 1) && (!disc.cheap || r.p <= 1) &&
      (!words.length || matchQuery(r, words)))) return false;
    if (!isFav && R.isExcluded(r, st)) { hidden++; return false; }
    return true;
  });
  list = R.ranked(list);
  const total = list.length; list = list.slice(0, disc.shown);
  const tchip = (v, l) => `<button class="fchip ${disc.type === v ? 'on' : ''}" data-act="dtype" data-v="${v}">${l}</button>`;
  const tog = (k, l) => `<button class="fchip ${disc[k] ? 'on' : ''}" data-act="dtog" data-k="${k}">${l}</button>`;
  const nActive = [disc.q.trim(), disc.type !== discDefaultType(), disc.cuisine, disc.quick, disc.easy, disc.cheap].filter(Boolean).length;
  const html = `
    <div class="search">${ic('search')}<input id="q" type="search" placeholder="${isFav ? 'Chercher dans mes favoris…' : 'Recette, ingrédient, pays…'}" value="${esc(disc.q)}" autocomplete="off"></div>
    <div class="seg"><button class="${isFav ? '' : 'on'}" data-act="dscope" data-v="all">Toutes les recettes</button><button class="${isFav ? 'on' : ''}" data-act="dscope" data-v="fav">${ic(isFav ? 'heartFill' : 'heart', 'sm')} Favoris${favs.length ? ` (${favs.length})` : ''}</button></div>
    <div class="fchips">${tchip('', 'Tout')}${tchip('plat', 'Plats')}${tchip('entree', 'Entrées & soupes')}${tchip('dessert', 'Desserts')}${tchip('petit-dej', 'Petit-déj')}${tchip('boulangerie', 'Boulangerie')}</div>
    <div class="fchips">${tog('quick', ic('clock', 'sm') + ' ≤ 30 min')}${tog('easy', ic('sparkle', 'sm') + ' Très facile')}${tog('cheap', ic('euro', 'sm') + ' Bon marché')}
      <button class="fchip ${disc.cuisine ? 'on' : ''}" data-act="dcuisine">${ic('globe', 'sm')} ${esc(disc.cuisine || 'Tous pays')}</button></div>
    ${isFav ? '' : settingsBar(st)}
    <div class="countrow"><p class="muted small">${total.toLocaleString('fr-FR')} ${isFav ? 'favori' : 'recette'}${total > 1 ? 's' : ''}${words.length || isFav ? '' : ', triées pour vous'}${hidden ? ` · ${hidden.toLocaleString('fr-FR')} masquée${hidden > 1 ? 's' : ''} par votre profil` : ''}</p>
      ${nActive ? `<button class="linkbtn small" data-act="dreset">${ic('x', 'sm')} Effacer les filtres (${nActive})</button>` : ''}</div>
    <div class="grid">${list.map(r => `
      <div class="card"><button data-act="open" data-id="${r.id}" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:8px">${plate(r)}
        <h3>${esc(name(r))}</h3></button>
        <div class="chips"><span class="chip">${ic('starFill', 'sm gold')}${r.r.toFixed(1)}</span><span class="chip">${ic('clock')} ${minutes(r.tm)}</span>${r.c ? `<span class="chip">${esc(r.c)}</span>` : ''}</div>
        <button class="favtog ${favs.includes(r.id) ? 'on' : ''}" data-act="fav" data-id="${r.id}" aria-label="${favs.includes(r.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ic(favs.includes(r.id) ? 'heartFill' : 'heart')}</button>
        <button class="round red add ${inMenu(r.id) ? 'in' : ''}" data-act="toggleMenu" data-id="${r.id}" aria-label="${inMenu(r.id) ? 'Retirer du menu' : 'Ajouter au menu'}">${ic(inMenu(r.id) ? 'check' : 'plus')}</button>
      </div>`).join('')}</div>
    ${total > disc.shown ? `<div class="center" style="margin:20px"><button class="btn ghost" data-act="more" id="more">Voir plus</button></div>` : ''}
    ${!total ? (isFav && !favs.length
      ? `<div class="empty"><div class="ee">${ic('heart')}</div><h2>Pas encore de favoris</h2><p class="muted">Touchez le cœur d'une recette pour la retrouver ici.</p><button class="btn" data-act="dscope" data-v="all">Parcourir les recettes</button></div>`
      : `<div class="empty"><div class="ee">${ic('search')}</div><h2>Rien trouvé</h2><p class="muted">Essayez d'autres mots ou retirez des filtres.</p>${nActive ? '<button class="btn ghost" data-act="dreset">Effacer les filtres</button>' : ''}</div>`) : ''}`;
  const y = window.scrollY;
  // garder le clavier ouvert si la liste se rafraîchit pendant la saisie (synchro, préférences, notes)
  const prev = document.activeElement?.id === 'q' ? document.activeElement : null;
  const sel = prev ? [prev.selectionStart, prev.selectionEnd] : null;
  view.innerHTML = html;
  if (keepScroll) window.scrollTo(0, y);
  const q = $('#q');
  if (prev) { q.focus({ preventScroll: true }); try { q.setSelectionRange(...sel); } catch {} }
  else if (disc.focus) { disc.focus = false; q.focus({ preventScroll: true }); }
  q.addEventListener('input', () => { disc.q = q.value; disc.shown = 30; clearTimeout(q.t); q.t = setTimeout(() => renderDiscover(), 250); });
  const more = $('#more');
  if (more && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); disc.shown += 30; renderDiscover(true); } }, { rootMargin: '400px' });
    io.observe(more);
  }
}

// ------------------------------------------------------------ plusieurs listes / menus : vue d'ensemble
// pick[t] : menus affichés dans l'onglet (null = vue d'ensemble) ; picked[t] : sélection en cours
const pick = { shop: null, cook: null }, picked = { shop: new Set(), cook: new Set() };
function shown(t) {
  const act = activeMenus();
  if (act.length <= 1) return act;  // une seule liste : affichée directement
  const l = pick[t] ? act.filter(m => pick[t].includes(m.id)) : [];
  return l.length ? l : null;
}
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const miniPlate = r => r.img ? `<img src="${esc(r.img)}" loading="lazy" alt="" data-fb="${r.t}">` : `<span class="ph">${typeIcon(r.t)}</span>`;
function lcard(m, st, t) {
  const on = picked[t].has(m.id), rs = m.items.map(i => DB.byId.get(i.id)).filter(Boolean);
  const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
  return `<div class="lcard ${on ? 'on' : ''} ${st.finished ? 'fin' : ''}">
    <button class="lsel" data-act="lsel" data-t="${t}" data-m="${m.id}" aria-label="Sélectionner" aria-pressed="${on}"><span class="box">${on ? ic('check') : ''}</span></button>
    <div class="lbody" data-act="lopen" data-t="${t}" data-m="${m.id}">
      <div class="lhead">${badge(m)}<h3>${esc(menuName(m))}</h3>${st.finished ? `<span class="lok">${ic('check', 'sm')} ${t === 'shop' ? 'Faites' : 'Terminé'}</span>` : `<span class="lpct">${pct} %</span>`}</div>
      <span class="muted small">${rs.length} recette${rs.length > 1 ? 's' : ''} · ${st.done}/${st.total} ${t === 'shop' ? 'articles' : 'repas cuisinés'}</span>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="thumbs">${rs.slice(0, 6).map(miniPlate).join('')}${rs.length > 6 ? `<span class="more">+${rs.length - 6}</span>` : ''}</div>
      <div class="lnames">${rs.map(r => esc(name(r))).join(' · ')}</div>
    </div>
    <button class="ledit" data-act="ledit" data-m="${m.id}" aria-label="Modifier le menu">${ic('pencil')}</button>
  </div>`;
}
function selBar(t) {
  const n = picked[t].size; if (!n) return '';
  return `<div class="sticky-cta selbar"><button class="pill" data-act="lclear" data-t="${t}" aria-label="Tout désélectionner">${ic('x', 'sm')} ${n}</button>
    <button class="btn" data-act="lview" data-t="${t}">${n > 1 ? `Voir les ${n} ensemble` : 'Ouvrir'}</button>
    <button class="round" data-act="ldel" data-t="${t}" aria-label="Supprimer la sélection">${ic('trash')}</button></div>`;
}
function openLists(t, ids) {
  pick[t] = ids; navPush({ tab: t, list: ids, lp: 1 }); window.scrollTo(0, 0); render();
}
function overview(t, act, stats, intro) {
  // on oublie les menus sélectionnés qui ont disparu (archivés, supprimés ailleurs)
  [...picked[t]].forEach(id => { if (!act.some(m => m.id === id)) picked[t].delete(id); });
  const allOn = act.every(m => picked[t].has(m.id));
  view.innerHTML = `
    <div class="row" style="margin:0 2px 12px;align-items:flex-start"><p class="muted small spacer" style="margin:0">${intro}</p>
      <button class="linkbtn small" data-act="lall" data-t="${t}">${allOn ? 'Tout décocher' : 'Tout cocher'}</button></div>
    ${act.map((m, i) => lcard(m, stats[i], t)).join('')}
    <div class="center" style="margin-top:6px"><button class="pill" data-act="newMenu">${ic('plus')} Nouveau menu</button></div>
    <div style="height:90px"></div>
    ${selBar(t)}`;
}
// barre de titre d'une liste ouverte : retour à la vue d'ensemble s'il y a plusieurs menus
function listTitle(t, ms, single, actions = '') {
  const multi = activeMenus().length > 1;
  const back = multi ? `<button class="back" data-act="lback" data-t="${t}" aria-label="Toutes les listes">${ic('back')}</button>` : '';
  setTitle(back + (ms.length > 1 ? `${ms.length} ${t === 'shop' ? 'listes' : 'menus'} <span class="sub">ensemble</span>` : multi ? esc(menuName(ms[0])) : `${single} <span class="sub">${esc(menuName(ms[0]))}</span>`), actions);
}

// ------------------------------------------------------------ vue Courses
async function shoppingList(ms) {
  const agg = new Map();
  for (const m of ms) for (const it of m.items) {
    const r = DB.byId.get(it.id); if (!r) continue;
    const d = await details(it.id); if (!d) continue;
    const f = it.ppl / (d.serv || 4);
    for (const e of d.ing) {
      if (e.h) continue; // titre de section
      const label = cap(e.fr || e.n);
      const fam = unitFamily(e.u);
      const key = norm(label).replace(/(\w)s\b/g, '$1') + '|' + fam;
      if (!agg.has(key)) agg.set(key, { key, label, aisle: e.a || 'Autres', pantry: !!e.p, fam, w: !!e.w, q: 0, hasQ: false, units: new Set(), from: new Set(), ms: new Set(), en: e.n, k: e.k });
      const a = agg.get(key);
      if (e.q != null) { a.q += toBase(e.q * f, e.u); a.hasQ = true; if (e.u) a.units.add(e.u); }
      a.from.add(m.id + '|' + name(r)); a.ms.add(m.id);
    }
  }
  return [...agg.values()].map(a => {
    let qty = '';
    if (a.hasQ) { const [q, u] = fromBase(a.q, a.fam, a.units); qty = fmtQty(a.w ? Math.max(1, Math.round(q)) : q, u); }
    return { ...a, ms: [...a.ms], qty };
  });
}
// un article fusionné de plusieurs listes est coché quand il l'est dans chacune
const isChecked = i => i.ms.every(mid => S.get(`check:${mid}:${i.key}`, false));
function shopStats(m, items) {
  const main = items.filter(i => !i.pantry), extras = S.list(`extra:${m.id}:`);
  return { done: main.filter(isChecked).length + extras.filter(([, e]) => e.done).length, total: main.length + extras.length, finished: S.get(`shopdone:${m.id}`, 0) };
}
const AISLE_ORDER = ['Fruits & légumes', 'Viandes & poissons', 'Crèmerie & œufs', 'Boulangerie', 'Épicerie salée', 'Épicerie sucrée', 'Épices & condiments', 'Surgelés', 'Boissons', 'Autres'];
async function renderShop() {
  const act = activeMenus();
  if (!act.length) {
    setTitle('Courses');
    view.innerHTML = `<div class="empty"><div class="ee">${ic('cart')}</div><h2>Pas encore de liste</h2><p class="muted">Choisissez des recettes : la liste de courses se remplit toute seule.</p><button class="btn" data-act="go" data-tab="menu">Choisir des recettes</button></div>`;
    return;
  }
  const ms = shown('shop');
  if (ms) return renderShopList(ms);
  setTitle(`Courses <span class="sub">${act.length} listes en cours</span>`);
  const stats = await Promise.all(act.map(async m => shopStats(m, await shoppingList([m]))));
  if (tab !== 'shop' || shown('shop')) return;
  overview('shop', act, stats, 'Touchez une liste pour l\'ouvrir, ou cochez-en plusieurs pour faire toutes les courses en une fois.');
}
// plats d'une liste : on en retire ou on en ajoute, les ingrédients suivent
function dishesBlock(ms) {
  return `<div class="aisle dishes"><h3>Recettes</h3>${ms.map(m => `
    ${ms.length > 1 ? `<div class="dishmenu">${badge(m)}${esc(menuName(m))}</div>` : ''}
    <div class="dishrow">${m.items.map(it => { const r = DB.byId.get(it.id); return r ? `<span class="dish"><span class="dhit" data-act="open" data-id="${r.id}" data-ppl="${it.ppl}">${miniPlate(r)}${ms.length > 1 ? badge(m) : ''}<span class="dn">${esc(name(r))}</span></span><button data-act="dishDel" data-m="${m.id}" data-id="${r.id}" aria-label="Retirer ${esc(name(r))}">${ic('x', 'sm')}</button></span>` : ''; }).join('')}
      <button class="dish add" data-act="dishAdd" data-m="${m.id}">${ic('plus', 'sm')} Ajouter une recette</button></div>`).join('')}</div>`;
}
// recettes d'où vient un article ; avec plusieurs listes ensemble, chacune porte la pastille de son menu
function fromHtml(i, withBadge) {
  return [...i.from].map(f => { const k = f.indexOf('|'), m = getMenu(f.slice(0, k)), n = f.slice(k + 1);
    return `<span class="fr">${withBadge && m ? badge(m) : ''}${esc(n)}</span>`; }).join('<span class="sep">·</span>');
}
// rayons repliables : un rayon fini se replie tout seul ; un choix à la main tient tant que le rayon
// ne change pas d'état (fini / pas fini)
const aisleFold = new Map(), PANTRY = 'Placard';
function aisleClosed(a, full) {
  const f = aisleFold.get(a);
  if (f && f.full === full) return f.closed;
  aisleFold.delete(a); return full;
}
async function renderShopList(ms) {
  const ids = ms.map(m => m.id), mids = ids.join(',');
  const nR = ms.reduce((s, m) => s + m.items.length, 0);
  listTitle('shop', ms, 'Courses', `<button class="ib" data-act="shareList" aria-label="Partager">${ic('share')}</button>`);
  const cacheKey = JSON.stringify(ms.map(m => [m.id, m.items]));
  if (!renderShop.cache || renderShop.cacheKey !== cacheKey) view.innerHTML = '<div class="loader"></div>';
  const items = await shoppingList(ms);
  renderShop.cache = items; renderShop.cacheKey = cacheKey; renderShop.ids = ids;
  const now = shown('shop');
  if (tab !== 'shop' || !now || !sameIds(now.map(m => m.id), ids)) return;
  const extras = ms.flatMap(m => S.list(`extra:${m.id}:`).map(([id, e]) => ({ id, e, mid: m.id })));
  const main = items.filter(i => !i.pantry), pantry = items.filter(i => i.pantry);
  const doneN = main.filter(isChecked).length + extras.filter(x => x.e.done).length;
  const totalN = main.length + extras.length;
  const row = i => { const c = isChecked(i); return `<div class="item ${c ? 'done' : ''}" data-act="check" data-k="${esc(i.key)}" data-m="${i.ms.join(',')}">
      <span class="box">${c ? ic('check') : ''}</span><span class="thumb">${ingPic(i.k, i.en)}</span><div class="it">${esc(i.label)}<div class="from">${fromHtml(i, ms.length > 1)}</div></div><span class="qty">${esc(i.qty)}</span></div>`; };
  const groups = AISLE_ORDER.map(a => [a, main.filter(i => i.aisle === a)]).filter(([, l]) => l.length);
  const dones = ms.map(m => S.get(`shopdone:${m.id}`, 0));
  const done = dones.every(Boolean) ? Math.max(...dones) : 0;
  const allChecked = totalN > 0 && doneN === totalN;
  // le bouton n'est animé qu'au moment où il apparaît, pas à chaque rafraîchissement
  const ctaEnter = allChecked && !done && !renderShop.ctaShown;
  renderShop.ctaShown = allChecked && !done;
  view.innerHTML = `
    ${done ? `<div class="banner green shopdone"><span class="bi">${ic('checks')}</span><div class="spacer"><b class="plain">Courses faites</b><br><span class="small">Validées le ${shortDate(done)}.</span><br><button class="linkbtn small" data-act="shopReopen" data-m="${mids}">${ic('undo', 'sm')} Rouvrir la liste</button></div>
      <button class="btn small" data-act="goCook" data-m="${mids}">Cuisiner</button></div>` : ''}
    <div class="shopsum"><span>${ms.length > 1 ? `${ms.length} listes · ` : ''}${nR} recette${nR > 1 ? 's' : ''}</span><b>${doneN}/${totalN} articles</b></div>
    <div class="progress"><i style="width:${totalN ? Math.round(doneN / totalN * 100) : 0}%"></i></div>
    ${dishesBlock(ms)}
    ${groups.map(([a, l]) => {
      const n = l.filter(isChecked).length, closed = aisleClosed(a, n === l.length);
      return `<div class="aisle fold ${closed ? 'closed' : ''} ${n === l.length ? 'full' : ''}"><button class="ahead" data-act="aisle" data-a="${esc(a)}" data-full="${n === l.length ? 1 : 0}" aria-expanded="${!closed}"><h3>${a}</h3><span class="acount">${n === l.length ? ic('check', 'sm') : ''}${n}/${l.length}</span><span class="chev">${ic(closed ? 'down' : 'up')}</span></button>
        ${closed ? '' : l.sort((x, y) => (isChecked(x) - isChecked(y)) || x.label.localeCompare(y.label, 'fr')).map(row).join('')}</div>`;
    }).join('')}
    <div class="aisle extras"><div class="ahead"><h3>Autres articles</h3>${extras.length ? `<span class="acount">${extras.filter(x => x.e.done).length}/${extras.length}</span>` : ''}</div>
      ${extras.sort((a, b) => a.e.done - b.e.done).map(({ id, e, mid }) => `<div class="item ${e.done ? 'done' : ''}"><span class="box" data-act="xcheck" data-m="${mid}" data-id="${id}">${e.done ? ic('check') : ''}</span><div class="it" data-act="xcheck" data-m="${mid}" data-id="${id}">${esc(e.txt)}</div><button class="del" data-act="xdel" data-m="${mid}" data-id="${id}" aria-label="Supprimer">${ic('x')}</button></div>`).join('')}
      <form id="addx" class="item"><input class="field" id="xtxt" placeholder="Ajouter : lessive, pain, café…" style="padding:9px 12px"><button class="round red sm2" aria-label="Ajouter l'article">${ic('plus')}</button></form></div>
    ${pantry.length ? (() => { const closed = aisleClosed(PANTRY, true);
      return `<div class="aisle fold pantry ${closed ? 'closed' : ''}"><button class="ahead" data-act="aisle" data-a="${PANTRY}" data-full="1" aria-expanded="${!closed}"><h3>Placard : à vérifier</h3><span class="acount">${pantry.length}</span><span class="chev">${ic(closed ? 'down' : 'up')}</span></button>
        ${closed ? '' : pantry.sort((x, y) => x.label.localeCompare(y.label, 'fr')).map(row).join('')}</div>`; })() : ''}
    ${!done && !allChecked ? `<div class="pagecta"><button class="btn big ghost" data-act="shopDone" data-m="${mids}">${ic('checks')} Valider les courses</button><p class="muted small center">Possible même s'il reste des articles non cochés.</p></div>` : ''}
    <p class="muted small center">Les quantités tiennent compte du nombre de personnes de chaque recette.</p>
    ${allChecked && !done ? `<div style="height:80px"></div><div class="sticky-cta ${ctaEnter ? 'enter' : ''}"><button class="btn big green" data-act="shopDone" data-m="${mids}">${ic('checks')} Tout valider</button></div>` : ''}`;
  $('#addx').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#xtxt').value.trim(); if (!v) return; haptic('medium');
    S.set(`extra:${ids[0]}:${S.uid()}`, { txt: v, done: false });
  });
}

// ------------------------------------------------------------ vue Cuisiner (menus de la semaine)
const isCooked = (m, id) => S.get(`cooked:${m.id}:${id}`, false);
function cookStats(m) {
  const rs = m.items.filter(i => DB.byId.has(i.id)), done = rs.filter(i => isCooked(m, i.id)).length;
  return { done, total: rs.length, finished: rs.length > 0 && done === rs.length };
}
function renderCook() {
  const act = activeMenus();
  if (!act.length) {
    setTitle('Cuisiner');
    view.innerHTML = `<div class="empty"><div class="ee">${ic('chef')}</div><h2>Rien à cuisiner</h2><p class="muted">Choisissez d'abord vos recettes : elles apparaîtront ici, prêtes à cuisiner.</p><button class="btn" data-act="go" data-tab="menu">Choisir des recettes</button></div>`;
    return;
  }
  const ms = shown('cook');
  if (ms) return renderCookList(ms);
  setTitle(`Cuisiner <span class="sub">${act.length} menus en cours</span>`);
  overview('cook', act, act.map(cookStats), 'Touchez un menu pour l\'ouvrir, ou cochez-en plusieurs pour les voir ensemble.');
}
function renderCookList(ms) {
  const all = ms.flatMap(m => m.items.map(it => ({ m, it, r: DB.byId.get(it.id) })).filter(x => x.r));
  const many = ms.length > 1;
  listTitle('cook', ms, 'Cuisiner', many ? '' : `<button class="ib" data-act="ledit" data-m="${ms[0].id}" aria-label="Modifier le menu">${ic('pencil')}</button>`);
  const cookedN = all.filter(x => isCooked(x.m, x.r.id)).length;
  const shopDone = ms.every(m => S.get(`shopdone:${m.id}`, 0));
  const mids = ms.map(m => m.id).join(',');
  const card = ({ m, it, r }, i) => {
    const c = isCooked(m, r.id), rt = S.get('rate:' + r.id, {});
    return `<div class="cookcard ${c ? 'done' : ''}">
      <button class="cdel" data-act="cdel" data-m="${m.id}" data-id="${r.id}" aria-label="Supprimer la recette">${ic('trash')}</button>
      <button class="cplate" data-act="open" data-id="${r.id}" data-ppl="${it.ppl}">${plate(r)}${c ? `<span class="cdone">${ic('check')}</span>` : ''}</button>
      <div class="info">
        ${c ? '' : `<span class="cnum">Repas ${i + 1}</span>`}
        <h3 data-act="open" data-id="${r.id}" data-ppl="${it.ppl}">${esc(name(r))}</h3>
        <div class="cmeta"><span>${ic('clock')} ${minutes(r.tm)}</span><span>${ic('users')} ${it.ppl} pers.</span>${c && rt.thumb ? `<span>${ic(rt.thumb === 1 ? 'thumbUp' : 'thumbDown')}</span>` : ''}</div>
        <div class="acts">${c
          ? `<button class="pill" data-act="cooked" data-m="${m.id}" data-id="${r.id}">${ic('undo')} Pas encore</button>`
          : `<button class="pill" data-act="open" data-id="${r.id}" data-ppl="${it.ppl}">${ic('book')} Recette</button><button class="pill strong" data-act="cooked" data-m="${m.id}" data-id="${r.id}">${ic('check')} C'est mangé</button>`}</div>
      </div></div>`;
  };
  const section = m => {
    const rs = all.filter(x => x.m === m);
    const todo = rs.filter(x => !isCooked(m, x.r.id)), cooked = rs.filter(x => isCooked(m, x.r.id));
    return `${many ? `<div class="menuhead">${badge(m)}<h2>${esc(menuName(m))}</h2><span class="muted small">${cooked.length}/${rs.length}</span><span class="spacer"></span><button class="round sm" data-act="ledit" data-m="${m.id}" aria-label="Modifier le menu">${ic('pencil')}</button></div>` : ''}
      ${!todo.length && rs.length ? `<div class="banner green"><span class="bi">${ic('checks')}</span><div class="spacer"><b class="plain">Menu terminé !</b><br><span class="small">Archivez-le pour le retrouver dans les Archives.</span></div><button class="btn small" data-act="archive" data-m="${m.id}">Archiver</button></div>` : ''}
      ${todo.length ? `${many ? '' : '<h2 class="section-title">À cuisiner</h2>'}${todo.map((x, i) => card(x, i)).join('')}` : ''}
      ${cooked.length ? `<h2 class="section-title${many ? ' small' : ''}">Déjà mangé</h2>${cooked.map(x => card(x)).join('')}` : ''}`;
  };
  view.innerHTML = `
    <p class="muted" style="margin:0">${cookedN}/${all.length} repas cuisinés</p>
    <div class="progress"><i style="width:${all.length ? Math.round(cookedN / all.length * 100) : 0}%"></i></div>
    ${!shopDone && cookedN < all.length ? `<div class="banner soft"><span class="bi">${ic('cart')}</span><div class="spacer small">Les courses ne sont pas encore validées.</div><button class="btn small ghost" data-act="goShop" data-m="${mids}">Voir</button></div>` : ''}
    ${ms.map(section).join('')}
    <div style="height:20px"></div>`;
}

// ------------------------------------------------------------ vue Archives
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
function deletedBlock() {
  const ds = S.list('del:').map(([k, d]) => ({ k, ...d, r: DB.byId.get(d.id) })).filter(d => d.r).sort((a, b) => b.at - a.at);
  if (!ds.length) return '';
  return `<div class="delbar"><button class="linkbtn small muted" data-act="toggleDeleted">${ic('trash')} ${showDeleted ? 'Masquer' : 'Afficher'} les recettes supprimées (${ds.length})</button></div>
    ${showDeleted ? `<div class="hist deleted"><h3>Recettes supprimées</h3><p class="muted small" style="margin:2px 0 6px">Retirées de Cuisiner, elles ne sont pas dans les archives.</p><div class="list">${ds.map(d =>
      `<div class="li"><span class="nmwrap" data-act="open" data-id="${d.r.id}" data-ppl="${d.ppl || ''}">${d.r.img ? `<img src="${esc(d.r.img)}" loading="lazy" alt="" data-fb="${d.r.t}">` : `<div class="ph">${typeIcon(d.r.t)}</div>`}<span class="nm">${esc(name(d.r))}<span class="muted small" style="display:block">Supprimée le ${fmtDate(d.at)}</span></span></span>
        <button class="pill" data-act="restoreDel" data-id="${d.k}">${ic('undo')} Remettre</button><button class="round sm" data-act="purgeDel" data-id="${d.k}" aria-label="Effacer définitivement">${ic('x')}</button></div>`).join('')}</div></div>` : ''}`;
}
function renderHistory() {
  setTitle('Archives');
  const hs = S.list('hist:').map(([, h]) => h).sort((a, b) => b.date - a.date);
  if (!hs.length) {
    view.innerHTML = `<div class="empty"><div class="ee">${ic('book')}</div><h2>Aucun menu archivé</h2><p class="muted">Quand un menu est fini, appuyez sur « Archiver ce menu » dans Choisir : il arrive ici.</p></div>${deletedBlock()}`;
    return;
  }
  view.innerHTML = hs.map(h => {
    const rs = h.items.map(i => DB.byId.get(i.id)).filter(Boolean);
    const open = histOpen.has(h.id);
    return `<div class="hist">
      <div class="row" data-act="hopen" data-id="${h.id}"><div class="spacer"><h3>${h.name ? esc(h.name) : `Menu du ${shortDate(h.created || h.date)}`}</h3><span class="muted small">${rs.length} recette${rs.length > 1 ? 's' : ''} · archivé le ${shortDate(h.date)}</span></div><span class="chev">${ic(open ? 'up' : 'down')}</span></div>
      <div class="thumbs" data-act="hopen" data-id="${h.id}">${rs.slice(0, 7).map(r => r.img ? `<img src="${esc(r.img)}" loading="lazy" alt="" data-fb="${r.t}">` : `<div class="ph">${typeIcon(r.t)}</div>`).join('')}</div>
      ${open ? `<div class="list">${rs.map(r => {
        const rt = S.get('rate:' + r.id, {});
        const it = h.items.find(i => i.id === r.id);
        return `<div class="li" data-act="open" data-id="${r.id}" data-ppl="${it?.ppl || ''}">${r.img ? `<img src="${esc(r.img)}" loading="lazy" alt="" data-fb="${r.t}">` : `<div class="ph">${typeIcon(r.t)}</div>`}<span class="nm">${esc(name(r))}</span><span class="rt">${rt.thumb === 1 ? ic('thumbUp', 'sm') : rt.thumb === -1 ? ic('thumbDown', 'sm') : ''}${rt.stars ? ' ' + ic('starFill', 'sm').repeat(rt.stars) : ''}</span></div>`;
      }).join('')}
        <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn small" data-act="redo" data-id="${h.id}">${ic('redo')} Refaire ce menu</button>
        <button class="pill" data-act="hrate" data-id="${h.id}">${ic('thumbUp')} Noter</button><span class="spacer"></span><button class="round sm" data-act="hdel" data-id="${h.id}" aria-label="Supprimer des archives">${ic('trash')}</button></div></div>` : ''}
    </div>`;
  }).join('') + deletedBlock();
}

// ------------------------------------------------------------ vue Profil
async function loadLex() {
  if (ingLex) return ingLex;
  try {
    const arr = await (await fetch('data/ingredients.json?v=' + DB.meta.v)).json();
    ingLex = { arr, fr: new Map(arr.filter(a => a[1]).map(a => [a[0], a[1]])) };
  } catch { ingLex = { arr: [], fr: new Map() }; }
  return ingLex;
}
function renderProfile() {
  const st = R.settings();
  setTitle('Profil <span class="sub">et réglages</span>');
  const code = S.householdCode();
  const sy = S.sync;
  const exLabel = k => ingLex?.fr.get(k) ? `${ingLex.fr.get(k)}` : k;
  view.innerHTML = `
    <div class="panel"><h3>${ic('users')} Foyer</h3><p class="muted small">Valeurs par défaut des nouveaux menus.</p>
      <div class="row"><span class="spacer">Personnes</span>${stepper('setPeople', 0, st.people)}</div>
      <div class="row" style="margin-top:10px"><span class="spacer">Repas par semaine</span>${stepper('setMeals', 0, st.meals)}</div>
      <div style="margin-top:14px"><span>Recettes proposées :</span><div class="fchips" style="margin-top:8px;flex-wrap:wrap">
        ${['plat', 'entree', 'petit-dej', 'dessert'].map(t => `<button class="fchip ${st.menuTypes.includes(t) ? 'on' : ''}" data-act="mtype" data-v="${t}">${TYPES[t]}</button>`).join('')}</div></div>
      <div style="margin-top:6px"><span>Temps max conseillé :</span><div class="fchips" style="margin-top:8px">
        ${[[0, 'Sans limite'], [30, '30 min'], [45, '45 min'], [60, '1 h']].map(([v, l]) => `<button class="fchip ${st.maxTime === v ? 'on' : ''}" data-act="maxt" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="panel"><h3>${ic('ban')} Ingrédients exclus</h3><p class="muted small">Allergies, ingrédients que vous détestez : ils ne seront jamais proposés.</p>
      <div class="chips">${st.exclusions.map(x => `<button class="xchip" data-act="unex" data-v="${esc(x)}">${esc(exLabel(x))} ${ic('x', 'sm')}</button>`).join('') || '<span class="muted small">Aucun pour l\'instant</span>'}</div>
      <input class="field" id="exq" placeholder="Ex : champignons, coriandre, crevettes…" style="margin-top:12px" autocomplete="off"><div class="sug" id="exsug"></div></div>
    <div class="panel"><h3>${ic('pan')} Équipement</h3><p class="muted small">Les recettes qui demandent un appareil que vous n'avez pas sont masquées.</p>
      <div class="eqgrid">${EQUIP.map(([c, e, l]) => `<button class="eq ${st.equipment.includes(c) ? 'on' : ''}" data-act="eq" data-v="${c}"><span class="e">${ic(e)}</span>${l}</button>`).join('')}</div></div>
    <div class="panel"><h3>${ic('compass')} Mode découverte</h3><p class="muted small">Plus vous montez, plus on vous pousse vers des pays et des ingrédients jamais cuisinés.</p>
      <input type="range" class="slider" id="discov" min="0" max="1" step="0.05" value="${st.discovery}">
      <div class="row small muted"><span>Valeurs sûres</span><span class="spacer"></span><span>Aventuriers</span></div></div>
    <div class="panel"><h3>${ic('sync')} Synchro du foyer</h3>
      ${!S.syncConfigured() ? `<p class="muted small">La synchro n'est pas encore configurée (Supabase dans <code>config.js</code>). En attendant, tout reste sur ce téléphone.</p>` :
        code ? `<p class="small"><span class="syncdot ${sy.status === 'ok' ? 'ok' : sy.status === 'err' ? 'err' : ''}"></span>${sy.status === 'ok' ? 'Synchronisé ' + (sy.last ? 'à ' + sy.last.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') : sy.status === 'offline' ? 'Hors ligne' : sy.status === 'err' ? 'Erreur : ' + esc(sy.error) : 'Connexion…'}</p>
          <p class="muted small">Code du foyer, à saisir sur l'autre téléphone (dans l'app installée) :</p><div class="code">${esc(code)}</div>
          <div class="row" style="margin-top:12px"><button class="btn small" data-act="copyCode">Copier le code</button><span class="spacer"></span><button class="pill" data-act="leave">Quitter</button></div>` :
        `<p class="muted small">Partagez menu, liste de courses, archives et notes entre vos deux téléphones.</p>
          <button class="btn small" data-act="createHH">Créer un foyer</button>
          <p class="muted small" style="margin-top:14px">Ou rejoindre un foyer existant :</p>
          <div class="row"><input class="field" id="joincode" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters"><button class="btn small" data-act="joinHH">OK</button></div>`}
    </div>
    <div class="panel"><h3>${ic('info')} L'app</h3>
      <p class="small">${DB.list.length.toLocaleString('fr-FR')} recettes notées au moins 4,5/5 par la communauté Food.com, sans doublons.<br>
      <span class="muted">Données ${esc(DB.meta?.v || '')} du ${esc(DB.meta?.built || '')} · App ${esc(APP_VERSION.slice(0, 7))}</span></p>
      <div class="row" style="flex-wrap:wrap"><button class="pill" data-act="checkUpdate">Chercher une mise à jour</button><button class="pill" data-act="reset">Réinitialiser ce téléphone</button></div>
      ${hapticsSupported() ? `<div class="row" style="margin-top:10px"><span class="spacer small">Vibrations des boutons</span><button class="fchip ${hapticsOn() ? 'on' : ''}" data-act="haptics">${hapticsOn() ? 'Activées' : 'Désactivées'}</button></div>` : ''}
      <p class="muted small" style="margin-top:12px">iPhone : ouvrez le site dans Safari, bouton Partager, puis « Sur l'écran d'accueil ».</p></div>`;
  const discov = $('#discov');
  discov.addEventListener('change', () => saveSettings({ discovery: +discov.value }));
  const exq = $('#exq'), exsug = $('#exsug');
  exq.addEventListener('input', async () => {
    const lex = await loadLex(); const q = norm(exq.value.trim());
    if (q.length < 2) { exsug.innerHTML = ''; return; }
    const res = lex.arr.filter(([k, fr]) => norm(k).includes(q) || norm(fr || '').includes(q)).slice(0, 12);
    exsug.innerHTML = res.map(([k, fr]) => `<button data-act="addex" data-v="${esc(k)}">${esc(fr || k)}${fr ? ` <span class="muted small">(${esc(k)})</span>` : ''}</button>`).join('')
      + `<button data-act="addex" data-v="${esc(exq.value.trim().toLowerCase())}">${ic('plus', 'sm')} « ${esc(exq.value.trim())} »</button>`;
  });
}
function saveSettings(patch) { S.set('settings', { ...R.settings(), ...patch }); }

// ------------------------------------------------------------ fiche recette
async function openRecipe(id, ppl, fromPop) {
  const r = DB.byId.get(id); if (!r) return;
  const m = menu(), it = m.items.find(i => i.id === id);
  sheetState = { id, ppl: ppl || it?.ppl || R.settings().people, showEn: false };
  sheet.classList.remove('closing'); sheet.hidden = false; document.body.style.overflow = 'hidden';
  sheet.innerHTML = '<div class="loader"></div>';
  if (!fromPop) navPush({ tab, sheet: id });
  await renderSheet(true);
}
function closeSheet(instant) {
  sheetState = null; T.setRecipe(null); document.body.style.overflow = '';
  if (instant || reduceMotion() || sheet.hidden) { sheet.hidden = true; sheet.innerHTML = ''; return; }
  sheet.classList.add('closing');
  setTimeout(() => { sheet.classList.remove('closing'); if (!sheetState) { sheet.hidden = true; sheet.innerHTML = ''; } }, 220);
}
let goingHome = false;
const TAB_LEFT = { discover: 'menu', shop: 'menu', cook: 'shop', history: 'cook', profile: 'history' };
window.addEventListener('popstate', e => {
  const st = navState();
  // le navigateur a déjà animé le retour (geste iOS, retour prédictif Android) : pas de seconde animation
  const uaAnim = !!e.hasUAVisualTransition;
  const closedOverlay = (!st.modal && !!document.querySelector('.modal-bg:not(.closing)')) || (!st.sheet && !sheet.hidden);
  if (!st.modal) document.querySelectorAll('.modal-bg').forEach(dropModal);
  if (afterPop) { const f = afterPop; afterPop = null; f(); }
  if (!st.sheet && !sheet.hidden) closeSheet(uaAnim);
  if (pendingTab) { const t = pendingTab; pendingTab = null; switchTab(t); return; }
  if (goingHome) { goingHome = false; switchTab('menu', { fromPop: true }); return; }
  // retour sur la racine depuis un onglet : on recule d'un onglet vers la gauche (Archives → Cuisiner → Courses → Choisir) ;
  // depuis Choisir, la racine n'a rien derrière elle : le retour suivant quitte l'app
  if (st.d === 0 && !st.sheet && !st.modal && !closedOverlay && tab !== 'menu') {
    const left = TAB_LEFT[tab] || 'menu';
    if (left !== 'menu') history.pushState({ ...tabState(left), d: 1 }, '');
    switchTab(left, { fromPop: true, noAnim: uaAnim });
    return;
  }
  if (st.tab && st.tab !== tab) switchTab(st.tab, { fromPop: true, noAnim: uaAnim });
  if (st.sheet && sheet.hidden) openRecipe(st.sheet, 0, true);
  // retour depuis une liste ouverte : on revient à la vue d'ensemble des listes / menus
  if (st.tab === tab && (tab === 'shop' || tab === 'cook') && !st.sheet && !st.modal) {
    const want = st.list || null;
    if (JSON.stringify(want) !== JSON.stringify(pick[tab])) { pick[tab] = want; window.scrollTo(0, 0); render(); }
  }
});

// texte des étapes : grandes parties, ingrédients illustrés, durées → minuteur, températures
function stepsHtml(steps, ings, f) {
  const find = ingMatcher(ings);
  sheetState.ings = ings.map(e => ({ label: cap(ingLabel(e, qtyFor(e, f))) + (e.nt ? ', ' + ingNote(e, qtyFor(e, f)) : ''), qty: e.q != null ? fmtQty(qtyFor(e, f), e.u) : '' }));
  return structureSteps(steps).map(x => {
    if (x.kind === 'section') return `<div class="stsec ${x.note ? 'note' : ''}"><span>${x.note ? ic('info', 'sm') + ' ' : ''}${esc(x.title)}</span></div>`;
    const body = renderStepText(x.text, {
      ing: find,
      ingHtml: (i, t) => `<button class="ingref" data-act="ingtip" data-i="${i}"><span class="ii">${ingPic(ings[i].k, ings[i].n)}</span>${esc(t)}</button>`,
      timerHtml: (d, t) => `<button class="tmchip" data-act="timerStart" data-s="${d.sec}" data-n="${x.n || ''}" data-key="${sheetState.id}:${x.n || 'n'}:${d.start}:${d.sec}" aria-label="Lancer un minuteur de ${fmtDur(d.sec)}">${ic('timer', 'sm')}${esc(t)}</button>`,
      tempHtml: t => `<span class="tempchip">${ic('thermo', 'sm')}${esc(t)}</span>`,
    });
    if (x.note) return `<div class="stnote">${x.label ? `<b>${esc(x.label)} : </b>` : ''}${body}</div>`;
    return `<div class="step"><span class="n">${x.n}</span><div class="tx"><div class="lbl">Étape ${x.n}</div>${body}</div></div>`;
  }).join('');
}

async function renderSheet(top) {
  if (!sheetState) return;
  const { id, ppl, showEn } = sheetState;
  const r = DB.byId.get(id), d = await details(id);
  if (!sheetState || sheetState.id !== id) return;
  const y = sheet.scrollTop;
  const f = ppl / (d.serv || 4);
  const rt = S.get('rate:' + id, {}), fav = S.get('fav:' + id, false), inM = inMenu(id), m = menu();
  const main = d.ing.filter(e => !e.p), pantry = d.ing.filter(e => e.p && !e.h);
  const full = Math.round(r.r * 2) / 2;
  const starsTxt = ic('starFill').repeat(Math.floor(full)) + (full % 1 ? ic('starHalf') : '') + ic('star').repeat(5 - Math.ceil(full));
  const kws = (d.kw || []).map(kwFr).filter(Boolean);
  const steps = showEn && d.stEn ? d.stEn : d.st;
  sheet.innerHTML = `<div class="inner">
    <div class="hero">${plate(r)}<button class="fab l" data-act="close" aria-label="Fermer">${ic('x')}</button>
      <button class="fab r fav" data-act="fav" data-id="${id}" aria-label="Favori">${ic(fav ? 'heartFill' : 'heart')}</button></div>
    <div class="rhead"><div class="stars">${starsTxt}</div><div class="muted">${r.rc.toLocaleString('fr-FR')} avis · ${r.r.toFixed(2).replace('.', ',')}/5</div>
      <h2>${esc(name(r))}</h2>${r.fr ? `<div class="en">${esc(r.n)}</div>` : ''}<div class="bar"></div>
      ${d.desc ? `<p style="margin:0">${esc(d.desc)}</p>` : ''}</div>
    <div class="tagrow">
      <div><span class="euro">${'€'.repeat(r.p)}<i>${'€'.repeat(3 - r.p)}</i></span>${COST[r.p]}</div>
      <div><span class="diffbars">${[1, 2, 3, 4].map(i => `<i class="${i <= r.d ? 'on' : ''}" style="height:${6 + i * 4}px"></i>`).join('')}</span>${DIFF[r.d]}</div>
      <div><span class="tv">${typeIcon(r.t)}</span>${TYPES[r.t] || ''}</div>
      <div><span class="tv">${ic('globe')}</span>${esc(r.c || 'Monde')}</div>
    </div>
    <div class="timesband">
      <div><div class="ic">${ic('knife')}</div><b>${minutes(d.prep)}</b><span>Préparation</span></div>
      <div><div class="ic">${ic('pot')}</div><b>${minutes(d.cook)}</b><span>Cuisson</span></div>
      <div><div class="ic">${ic('flame')}</div><b>${r.kc ? r.kc + ' kcal' : '?'}</b><span>Par portion</span></div>
    </div>
    ${kws.length || r.eq?.length ? `<div class="kw chips" style="margin-top:16px">${r.eq.map(e => { const q = EQUIP.find(x => x[0] === e); return q ? `<span class="chip">${ic(q[1], 'sm')} ${q[2]}</span>` : ''; }).join('')}${kws.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}
    <div class="block"><h3>Ingrédients</h3>
      <div class="forppl">Pour ${stepper('sppl', id, ppl, ic('users', 'sm'))}</div>
      ${!d.units ? `<p class="muted small center">La source ne précise pas toujours les unités : quantités indicatives (adaptées à ${ppl} pers.).</p>` : ''}
      <div class="ings">${main.map(e => { if (e.h) return `<div class="ingsec">${esc(cap(e.fr || e.n))}</div>`; const q = qtyFor(e, f), nt = ingNote(e, q); return `<div class="ing"><div class="bub">${ingPic(e.k, e.n)}</div><b>${q != null ? esc(fmtQty(q, e.u)) : ''}</b>${esc(cap(ingLabel(e, q)))}${nt ? `<div class="orig">${esc(nt)}</div>` : ''}${e.raw && !e.fr ? `<div class="orig">${esc(e.raw)}</div>` : ''}</div>`; }).join('')}</div>
      ${pantry.length ? `<div class="pantry"><b>Vérifiez que vous avez…</b><br><span class="muted">${pantry.map(e => esc(cap(e.fr || e.n)) + (e.q != null && e.u ? ' (' + esc(fmtQty(e.q * f, e.u)) + ')' : '')).join(' · ')}</span></div>` : ''}
    </div>
    <div class="block steps"><h3>Recette</h3>
      ${d.stEn ? `<div class="center" style="margin-bottom:8px"><button class="pill" data-act="toggleEn">${showEn ? 'Voir en français' : 'Voir la version originale (anglais)'}</button></div>` : ''}
      ${stepsHtml(steps, d.ing.filter(e => !e.h), f)}
    </div>
    <div class="rate"><h3>Vous l'avez cuisinée ?</h3>
      <div class="thumbs"><button class="${rt.thumb === 1 ? 'sel' : ''}" data-act="thumb" data-id="${id}" data-v="1" aria-label="J'ai aimé">${ic('thumbUp')}</button><button class="${rt.thumb === -1 ? 'sel' : ''}" data-act="thumb" data-id="${id}" data-v="-1" aria-label="Bof">${ic('thumbDown')}</button></div>
      <div class="st">${[1, 2, 3, 4, 5].map(i => `<button class="${(rt.stars || 0) >= i ? 'on' : ''}" data-act="stars" data-id="${id}" data-v="${i}" aria-label="${i} étoile${i > 1 ? 's' : ''}">${ic((rt.stars || 0) >= i ? 'starFill' : 'star')}</button>`).join('')}</div></div>
    <div class="srcline">Recette de la communauté Food.com${d.by ? ' · par ' + esc(d.by) : ''} · <a href="${foodUrl(r)}" target="_blank" rel="noopener">voir l'original</a></div>
    <div class="sticky-cta${inM ? ' inpage' : ''}"><button class="btn big" data-act="${inM ? 'sremove' : 'sadd'}" data-id="${id}">${inM ? 'Retirer du menu' : `${ic('plus')} Ajouter au menu`}</button>${menus().length > 1 ? `<div class="ctasub">${badge(m)}${esc(menuName(m))}</div>` : ''}</div>
  </div>`;
  sheet.scrollTop = top ? 0 : y;
  T.setRecipe(id);
}

// ------------------------------------------------------------ actions
const A = {
  go: el => { if (el.dataset.tab === 'discover') discScope('all'); switchTab(el.dataset.tab); },
  open: el => openRecipe(+el.dataset.id, +el.dataset.ppl || 0),
  close: () => { if (navState().sheet) history.back(); else closeSheet(); },
  closeModal: el => closeModalEl(el.closest('.modal-bg')),
  add: el => addToMenu(+el.dataset.id),
  remove: el => removeFromMenu(+el.dataset.id),
  replace: el => replaceInMenu(+el.dataset.id),
  toggleMenu: el => { const id = +el.dataset.id; if (inMenu(id)) { const m = menu(); m.items = m.items.filter(i => i.id !== id); saveMenu(m); toast('Retirée du menu'); } else addToMenu(id); },
  ppl: el => { const m = menu(); const it = m.items.find(i => i.id === +el.dataset.id); if (!it) return; it.ppl = Math.max(1, Math.min(20, it.ppl + +el.dataset.d)); saveMenu(m); },
  meals: el => { const n = Math.max(0, Math.min(14, menu().items.length + +el.dataset.d)); fillMenu(n); },
  fill: () => fillMenu(),
  archive: el => { const mid = el.dataset.m; ask({ title: 'Archiver ce menu ?', text: 'Il rejoint les Archives, où vous pourrez le refaire. On vous demandera ensuite votre avis sur les recettes.', ok: 'Archiver', onOk: () => archiveWeek(mid) }); },
  sadd: el => addToMenu(+el.dataset.id, sheetState?.ppl),
  sremove: el => removeFromMenu(+el.dataset.id),
  sppl: el => { sheetState.ppl = Math.max(1, Math.min(20, sheetState.ppl + +el.dataset.d)); const m = menu(); const it = m.items.find(i => i.id === sheetState.id); if (it) { it.ppl = sheetState.ppl; saveMenu(m); } else renderSheet(); },
  toggleEn: () => { sheetState.showEn = !sheetState.showEn; renderSheet(); },
  ingtip: el => { const e = sheetState?.ings?.[+el.dataset.i]; if (e) toast(e.qty ? `${e.label} : ${e.qty}` : e.label); },
  timerStart: el => {
    const sec = +el.dataset.s, n = el.dataset.n, key = el.dataset.key, r = sheetState && DB.byId.get(sheetState.id);
    const cur = T.byKey(key);
    if (cur) { if (cur.done) T.remove(cur.id); else T.openPanel(); return; } // déjà lancé : on gère depuis le panneau
    T.start({ sec, label: (n ? `Étape ${n} · ` : '') + fmtDur(sec), sub: r ? name(r) : '', rid: r?.id ?? null, key, n: n ? +n : null });
  },
  fav: el => { const k = 'fav:' + el.dataset.id; S.get(k) ? S.del(k) : S.set(k, true); },
  thumb: el => {
    const k = 'rate:' + el.dataset.id, cur = S.get(k, {}), v = +el.dataset.v;
    S.set(k, { ...cur, thumb: cur.thumb === v ? 0 : v, at: Date.now() });
    const mb = el.closest('.modal'); if (mb) { mb.querySelectorAll(`[data-id="${el.dataset.id}"]`).forEach(b => b.removeAttribute('style')); if (v === 1) el.style.cssText = 'background:var(--green);color:#fff'; if (v === -1) el.style.cssText = 'background:var(--ink);color:var(--on-ink)'; }
  },
  stars: el => { const k = 'rate:' + el.dataset.id, cur = S.get(k, {}); S.set(k, { ...cur, stars: +el.dataset.v, thumb: cur.thumb || (+el.dataset.v >= 4 ? 1 : +el.dataset.v <= 2 ? -1 : 0), at: Date.now() }); toast('Merci, c\'est noté'); },
  openSearch: () => { discScope('all'); disc.focus = true; switchTab('discover'); },
  openFavs: () => { if (disc.scope !== 'fav') { disc.scope = 'fav'; disc.type = ''; } disc.shown = 30; switchTab('discover'); },
  dscope: el => {
    const v = el.dataset.v; if (v === disc.scope) return;
    const wasDefault = disc.type === discDefaultType();
    disc.scope = v; if (wasDefault) disc.type = discDefaultType();
    disc.shown = 30; window.scrollTo(0, 0); renderDiscover();
  },
  dreset: () => { Object.assign(disc, { q: '', type: discDefaultType(), cuisine: '', quick: false, easy: false, cheap: false, shown: 30 }); renderDiscover(); },
  dtype: el => { disc.type = el.dataset.v; disc.shown = 30; renderDiscover(); },
  dtog: el => { disc[el.dataset.k] = !disc[el.dataset.k]; disc.shown = 30; renderDiscover(); },
  dcuisine: () => {
    const cs = DB.meta.cuisines || [];
    const counts = {}; DB.list.forEach(r => { if (r.c) counts[r.c] = (counts[r.c] || 0) + 1; });
    modal(`<h2>Choisir un pays</h2><div class="sug"><button data-act="setCuisine" data-v="">Tous pays</button>${cs.map(c => `<button data-act="setCuisine" data-v="${esc(c)}">${esc(c)} <span class="muted small">${counts[c] || 0}</span></button>`).join('')}</div>`);
  },
  setCuisine: el => { disc.cuisine = el.dataset.v; disc.shown = 30; closeModalEl(el.closest('.modal-bg')); renderDiscover(); },
  more: () => { disc.shown += 30; renderDiscover(true); },
  shopDone: el => { const ids = el.dataset.m.split(','); ids.forEach(mid => S.set(`shopdone:${mid}`, Date.now())); toast('Courses validées, bon appétit !'); pick.cook = ids; switchTab('cook'); },
  shopReopen: el => el.dataset.m.split(',').forEach(mid => S.del(`shopdone:${mid}`)),
  cooked: el => {
    const m = getMenu(el.dataset.m) || menu(), id = +el.dataset.id, k = `cooked:${m.id}:${id}`, was = S.get(k, false);
    was ? S.del(k) : S.set(k, true);
    if (!was && !S.get('rate:' + id, {}).thumb) askRatings([id], 'Alors, c\'était bon ?');
  },
  cdel: el => {
    const m = getMenu(el.dataset.m) || menu(), id = +el.dataset.id, idx = m.items.findIndex(i => i.id === id);
    if (idx < 0) return;
    const key = S.uid();
    S.set('del:' + key, { id, ppl: m.items[idx].ppl, idx, menu: m.id, at: Date.now() });
    m.items = m.items.filter(i => i.id !== id); saveMenu(m);
    toast('Recette supprimée', { label: 'Annuler', act: 'restoreDel', id: key });
  },
  restoreDel: el => {
    const k = 'del:' + el.dataset.id, d = S.get(k); if (!d) return;
    // dans son menu d'origine s'il est encore en cours, sinon dans le menu courant
    const m = getMenu(d.menu) || menu();
    if (!m.items.some(i => i.id === d.id)) {
      // même semaine : on la remet à sa place, sinon à la fin du menu actuel
      const at = d.menu === m.id ? Math.min(d.idx ?? m.items.length, m.items.length) : m.items.length;
      m.items.splice(at, 0, { id: d.id, ppl: d.ppl || R.settings().people }); saveMenu(m);
    }
    S.del(k); $('#toast').hidden = true;
    if (el.closest('#toast') == null) toast('Recette remise dans le menu');
  },
  purgeDel: el => { const k = 'del:' + el.dataset.id; ask({ title: 'Effacer définitivement ?', text: 'La recette disparaît de la liste des recettes supprimées.', ok: 'Effacer', danger: true, onOk: () => S.del(k) }); },
  toggleDeleted: () => { showDeleted = !showDeleted; renderHistory(); },
  check: el => {
    const key = el.dataset.k, mids = el.dataset.m.split(',');
    const v = !mids.every(mid => S.get(`check:${mid}:${key}`, false));
    mids.forEach(mid => S.set(`check:${mid}:${key}`, v));
  },
  xcheck: el => { const k = `extra:${el.dataset.m}:${el.dataset.id}`; const e = S.get(k); if (e) S.set(k, { ...e, done: !e.done }); },
  xdel: el => S.del(`extra:${el.dataset.m}:${el.dataset.id}`),
  shareList: async () => {
    const items = renderShop.cache || [], ids = renderShop.ids || [];
    const txt = 'Courses La Chavitera\n\n' + AISLE_ORDER.map(a => { const l = items.filter(i => i.aisle === a && !i.pantry && !isChecked(i)); return l.length ? a + '\n' + l.map(i => `- ${i.label}${i.qty ? ' : ' + i.qty : ''}`).join('\n') : ''; }).filter(Boolean).join('\n\n')
      + ids.flatMap(mid => S.list(`extra:${mid}:`)).filter(([, e]) => !e.done).map(([, e]) => '\n- ' + e.txt).join('');
    share(txt);
  },
  shareMenu: () => share(menuName(menu()) + '\n\n' + menu().items.map(i => DB.byId.get(i.id)).filter(Boolean).map(r => '- ' + name(r) + ' (' + foodUrl(r) + ')').join('\n')),
  hopen: el => { const id = el.dataset.id; histOpen.has(id) ? histOpen.delete(id) : histOpen.add(id); renderHistory(); },
  redo: el => {
    const h = S.get('hist:' + el.dataset.id); if (!h) return;
    // ajouté comme nouveau menu en cours : les autres menus ne sont pas touchés
    const m = { id: S.uid(), created: Date.now(), items: h.items.map(i => ({ ...i })) };
    saveMenu(m); setCur(m.id); toast('Menu ajouté à vos menus en cours'); switchTab('menu');
  },
  hrate: el => { const h = S.get('hist:' + el.dataset.id); if (h) askRatings(h.items.map(i => i.id), 'Noter ce menu'); },
  hdel: el => { const k = 'hist:' + el.dataset.id; undoHist = S.get(k); if (!undoHist) return; S.del(k); toast('Menu supprimé des archives', { label: 'Annuler', act: 'undoHist', id: '' }); },
  undoHist: () => { if (undoHist) S.set('hist:' + undoHist.id, undoHist); undoHist = null; $('#toast').hidden = true; },
  // ---- plusieurs menus / listes
  pickMenu: el => { setCur(el.dataset.m); render(); },
  newMenu: () => { startNewMenu(); tab === 'menu' ? render() : switchTab('menu'); },
  renameMenu: el => {
    const mid = el.dataset.m;
    ask({ title: 'Renommer le menu', ok: 'Enregistrer', input: { value: menuName(getMenu(mid) || menu()), ph: 'Ex : Semaine chargée, Week-end…' },
      onOk: v => { const m = getMenu(mid) || menu(); m.name = (v || '').trim().slice(0, 40) || undefined; saveMenu(m); } });
  },
  delCur: () => deleteMenus([menu().id]),
  undoMenus: () => { undoMenus.forEach(m => S.set('amenu:' + m.id, m)); undoMenus = []; $('#toast').hidden = true; },
  goShop: el => { pick.shop = el.dataset.m.split(','); switchTab('shop'); },
  goCook: el => { pick.cook = el.dataset.m.split(','); switchTab('cook'); },
  lsel: el => { const s = picked[el.dataset.t], id = el.dataset.m; s.has(id) ? s.delete(id) : s.add(id); render(); },
  lall: el => { const s = picked[el.dataset.t], act = activeMenus(); if (act.every(m => s.has(m.id))) s.clear(); else act.forEach(m => s.add(m.id)); render(); },
  lclear: el => { picked[el.dataset.t].clear(); render(); },
  lopen: el => openLists(el.dataset.t, [el.dataset.m]),
  lview: el => { const t = el.dataset.t, ids = [...picked[t]]; picked[t].clear(); openLists(t, ids); },
  lback: el => {
    const t = el.dataset.t, st = navState();
    if (st.lp) return history.back(); // ouverte depuis la vue d'ensemble : le popstate y ramène
    pick[t] = null; navReplace({ ...st, list: null }); window.scrollTo(0, 0); render();
  },
  ldel: el => { const t = el.dataset.t, ids = [...picked[t]]; picked[t].clear(); deleteMenus(ids); },
  ledit: el => { setCur(el.dataset.m); switchTab('menu'); },
  aisle: el => { const a = el.dataset.a, full = el.dataset.full === '1'; aisleFold.set(a, { full, closed: !aisleClosed(a, full) }); renderShop(); },
  dishAdd: el => { setCur(el.dataset.m); switchTab('discover'); },
  dishDel: el => { const m = getMenu(el.dataset.m); if (m) removeFromMenu(+el.dataset.id, m); },
  dishUndo: () => {
    const u = dishUndo, m = u && (getMenu(u.mid) || (draft?.id === u.mid ? draft : null)); dishUndo = null; $('#toast').hidden = true;
    if (!m || m.items.some(i => i.id === u.it.id)) return;
    m.items.splice(Math.min(u.idx, m.items.length), 0, u.it); saveMenu(m);
  },
  setPeople: el => saveSettings({ people: Math.max(1, Math.min(20, R.settings().people + +el.dataset.d)) }),
  setMeals: el => saveSettings({ meals: Math.max(1, Math.min(14, R.settings().meals + +el.dataset.d)) }),
  mtype: el => { const st = R.settings(), v = el.dataset.v; let t = st.menuTypes.includes(v) ? st.menuTypes.filter(x => x !== v) : [...st.menuTypes, v]; if (!t.length) t = ['plat']; saveSettings({ menuTypes: t }); },
  maxt: el => saveSettings({ maxTime: +el.dataset.v }),
  eq: el => { const st = R.settings(), v = el.dataset.v; saveSettings({ equipment: st.equipment.includes(v) ? st.equipment.filter(x => x !== v) : [...st.equipment, v] }); },
  addex: el => { const st = R.settings(), v = el.dataset.v; if (v && !st.exclusions.includes(v)) saveSettings({ exclusions: [...st.exclusions, v] }); },
  unex: el => saveSettings({ exclusions: R.settings().exclusions.filter(x => x !== el.dataset.v) }),
  createHH: async () => { await S.setHousehold(S.newCode()); toast('Foyer créé : partagez le code'); renderProfile(); },
  joinHH: async () => { const v = $('#joincode').value.trim(); if (v.replace(/-/g, '').length < 16) return toast('Code incomplet'); await S.setHousehold(v); toast(S.sync.status === 'ok' ? 'Foyer rejoint' : 'Code enregistré'); renderProfile(); },
  copyCode: () => { navigator.clipboard?.writeText(S.householdCode()); toast('Code copié'); },
  leave: () => ask({ title: 'Quitter le foyer ?', text: 'Ce téléphone ne sera plus synchronisé. Vos données restent dessus.', ok: 'Quitter', danger: true, onOk: () => { S.setHousehold(''); renderProfile(); } }),
  checkUpdate: async () => { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.update(); toast('Vérifié : si une version existe, l\'app va se recharger'); } else location.reload(); },
  haptics: () => { setHaptics(!hapticsOn()); renderProfile(); },
  reset: () => ask({ title: 'Réinitialiser ce téléphone ?', text: 'Menus, archives et réglages de ce téléphone seront effacés.', ok: 'Tout effacer', danger: true, onOk: () => { S.resetLocal(); location.reload(); } }),
  askOk: el => {
    const f = askOk, v = $('#askIn')?.value; askOk = null;
    const bg = el.closest('.modal-bg');
    if (navState().modal) { afterPop = () => f?.(v); history.back(); } else { dropModal(bg); f?.(v); }
  },
};
async function share(text) {
  if (navigator.share) { try { await navigator.share({ text }); } catch {} }
  else { await navigator.clipboard?.writeText(text); toast('Copié dans le presse-papiers'); }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); haptic(levelFor(el.dataset.act)); fn(el); }
});

// ------------------------------------------------------------ navigation & rendu
const TAB_ORDER = { menu: 0, discover: 0.5, shop: 1, cook: 2, history: 3, profile: 4 };
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function switchTab(t, opts = {}) {
  const from = tab;
  if (!opts.fromPop) {
    // fiche ou fenêtre ouverte : on la referme par l'historique, puis on change d'onglet
    const cur = navState();
    if (cur.sheet || cur.modal) { pendingTab = t; history.back(); return; }
    if (t === from) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
    if (t === 'menu' && cur.d > 0) { goingHome = true; history.go(-cur.d); return; } // retour à la racine : le popstate affiche Choisir
    // un seul niveau au-dessus de Choisir : le retour recule ensuite d'onglet en onglet vers la gauche
    if (cur.d === 0) navPush(tabState(t));
    else navReplace({ ...tabState(t), d: 1 });
  }
  if (t === from) return;
  const update = () => {
    tab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (t === 'discover' ? 'menu' : t)));
    window.scrollTo(0, 0);
    return render();
  };
  if (reduceMotion() || opts.noAnim) return update();
  const dir = TAB_ORDER[t] >= TAB_ORDER[from] ? 'fwd' : 'back';
  document.documentElement.dataset.dir = dir;
  if (document.startViewTransition && !opts.fromPop) {
    // transition native : l'ancien écran glisse et s'efface pendant que le nouveau arrive
    document.startViewTransition(() => Promise.race([update(), new Promise(r => setTimeout(r, 400))]));
  } else {
    update();
    view.classList.remove('enter-fwd', 'enter-back'); void view.offsetWidth;
    view.classList.add('enter-' + dir);
  }
}
view.addEventListener('animationend', e => { if (e.target === view) view.classList.remove('enter-fwd', 'enter-back'); });
document.querySelectorAll('[data-ic]').forEach(el => { el.innerHTML = ic(el.dataset.ic); });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { haptic('light'); switchTab(b.dataset.tab); } });
function render() {
  if (!DB.ready) return;
  const act = activeMenus();
  // Courses : recettes des listes pas encore validées ; Cuisiner : repas restants des menus dont les courses sont faites
  const n = act.filter(m => !S.get(`shopdone:${m.id}`, 0)).reduce((s, m) => s + m.items.length, 0);
  const b = $('#shopBadge'); b.hidden = !n; b.textContent = n;
  const left = act.filter(m => S.get(`shopdone:${m.id}`, 0)).reduce((s, m) => s + m.items.filter(i => !isCooked(m, i.id)).length, 0), cb = $('#cookBadge');
  cb.hidden = !left; cb.textContent = left;
  return ({ menu: renderMenu, discover: renderDiscover, shop: renderShop, cook: renderCook, history: renderHistory, profile: renderProfile })[tab]();
}
let rt = null;
S.on(keys => {
  if (keys.includes('menu')) migrateMenu();
  if (tab !== 'discover' && (keys.includes('settings') || keys.includes('*'))) disc.shown = 30;
  clearTimeout(rt);
  rt = setTimeout(() => {
    const active = document.activeElement;
    if (!(tab === 'profile' && keys.length === 1 && keys[0] === '__sync' && active && active.tagName === 'INPUT')) {
      if (tab === 'discover') renderDiscover(true); else render();
    }
    if (sheetState) renderSheet();
  }, 30);
});

// ------------------------------------------------------------ démarrage
async function boot() {
  view.innerHTML = '<div class="loader"></div>';
  await loadDB();
  if (DB.error === 'nodata') {
    setTitle('La Chavitera');
    view.innerHTML = `<div class="empty"><div class="ee">${ic('chef')}</div><h2>La base de recettes arrive</h2><p class="muted">Les données ne sont pas encore générées. Lancez le workflow « Construire les recettes » sur GitHub (voir le README).</p></div>`;
    return;
  }
  migrateMenu();
  loadLex();
  try { const r = await fetch('data/ing_img.json?v=' + DB.meta.v); if (r.ok) ingImg = await r.json(); } catch {}
  navReplace({ tab: 'menu', d: 0 });
  render();
  S.startSync();
}
T.mount({ openRecipe: id => openRecipe(id) });
boot();

// service worker : mises à jour automatiques
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; reloaded = true;
    if (!sheetState) location.reload(); else toast('Nouvelle version installée : elle s\'appliquera au prochain lancement');
  });
}
