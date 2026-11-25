import * as S from './store.js';
import { DB, loadDB, details, DIFF, COST, TYPES, EQUIP, kwFr, name, minutes, ingEmoji, typeEmoji,
  fmtQty, unitFamily, toBase, fromBase, foodUrl } from './data.js';
import * as R from './reco.js';
import { APP_VERSION } from './version.js';

const $ = s => document.querySelector(s);
const view = $('#view'), sheet = $('#sheet');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let tab = 'menu', sheetState = null, ingLex = null;
const disc = { q: '', type: 'plat', cuisine: '', quick: false, easy: false, cheap: false, shown: 30 };
const histOpen = new Set();

// ------------------------------------------------------------ helpers UI
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200);
}
function modal(html) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg); return bg;
}
function plate(r, cls = 'plate') {
  if (r && r.img) return `<img class="${cls}" loading="lazy" src="${esc(r.img)}" alt="" data-fb="${typeEmoji(r.t)}">`;
  return `<div class="${cls} ph">${typeEmoji(r?.t)}</div>`;
}
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName === 'IMG' && el.dataset.fb) {
    const d = document.createElement('div'); d.className = el.className + ' ph'; d.textContent = el.dataset.fb; el.replaceWith(d);
  }
}, true);
const stepper = (act, id, val, suffix = '') =>
  `<span class="stepper"><button data-act="${act}" data-id="${id}" data-d="-1">−</button><span>${val}${suffix}</span><button data-act="${act}" data-id="${id}" data-d="1">+</button></span>`;
function setTitle(t, actions = '') { $('#title').innerHTML = t; $('#topActions').innerHTML = actions; }

// ------------------------------------------------------------ menu
const menu = () => S.get('menu') || { id: S.uid(), created: Date.now(), items: [] };
const inMenu = id => menu().items.some(i => i.id === id);
function saveMenu(m) { S.set('menu', m); }
function addToMenu(id, ppl) {
  const m = menu(); if (m.items.some(i => i.id === id)) return;
  m.items.push({ id, ppl: ppl || R.settings().people }); saveMenu(m); toast('Ajouté au menu');
}
function removeFromMenu(id) { const m = menu(); m.items = m.items.filter(i => i.id !== id); saveMenu(m); }
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
function archiveWeek() {
  const m = menu();
  if (!m.items.length) return toast('Le menu est vide');
  S.set('hist:' + m.id, { id: m.id, date: Date.now(), created: m.created, items: m.items });
  S.set('menu', { id: S.uid(), created: Date.now(), items: [] });
  S.set('skipped', []);
  askRatings(m.items.map(i => i.id), 'Comment était la semaine ?');
  fillMenu();
}

function askRatings(ids, title) {
  const rows = ids.map(id => DB.byId.get(id)).filter(Boolean).map(r => {
    const rt = S.get('rate:' + r.id, {});
    return `<div class="hist"><div class="row">${r.img ? `<img src="${esc(r.img)}" alt="" data-fb="${typeEmoji(r.t)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover">` : `<span style="font-size:36px">${typeEmoji(r.t)}</span>`}<div class="spacer">${esc(name(r))}</div></div>
      <div class="row" style="margin-top:10px;justify-content:center;gap:8px">
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="1" ${rt.thumb === 1 ? 'style="background:var(--green);color:#fff"' : ''}>👍 J'ai aimé</button>
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="-1" ${rt.thumb === -1 ? 'style="background:var(--ink);color:#fff"' : ''}>👎 Bof</button>
        <button class="pill" data-act="thumb" data-id="${r.id}" data-v="0">Pas fait</button></div></div>`;
  }).join('');
  const m = modal(`<h2>${esc(title)}</h2><p class="muted">Vos avis affinent les prochaines suggestions.</p>${rows}<button class="btn big" data-act="closeModal">C'est noté</button>`);
  m.classList.add('ratings');
}

// ------------------------------------------------------------ vue Menu
function renderMenu() {
  const st = R.settings(), m = menu(), prof = R.tasteProfile();
  const nEx = st.exclusions.length, nEq = st.equipment.length;
  setTitle('Mon menu', `<button class="ib" data-act="shareMenu" aria-label="Partager">↗︎</button>`);
  const old = m.items.length && Date.now() - m.created > 6 * 86400000;
  const items = m.items.map(it => {
    const r = DB.byId.get(it.id); if (!r) return '';
    const rs = R.reason(r, prof, st);
    return `<div class="meal">
      <button data-act="open" data-id="${r.id}">${plate(r)}</button>
      <div class="info">
        <h3 data-act="open" data-id="${r.id}">${esc(name(r))}</h3>${r.fr ? `<div class="en">${esc(r.n)}</div>` : ''}
        <div class="chips">${rs ? `<span class="chip ${rs.cls}">${esc(rs.txt)}</span>` : ''}<span class="chip star">${r.r.toFixed(1)}</span><span class="chip">⏱ ${minutes(r.tm)}</span></div>
        <div class="acts"><button class="pill" data-act="replace" data-id="${r.id}">Remplacer</button>
          ${stepper('ppl', r.id, it.ppl, ' 🍴')}
          <button class="round" data-act="remove" data-id="${r.id}" aria-label="Retirer">🗑</button></div>
      </div></div>`;
  }).join('');
  const ex = new Set(m.items.map(i => i.id));
  const extras = R.suggest(3, { exclude: ex, types: ['dessert', 'entree'] });
  view.innerHTML = `
    <div class="prefbar">
      <button data-act="go" data-tab="profile"><span class="pi">👥<b>${st.people}</b></span>Foyer</button>
      <button data-act="go" data-tab="profile"><span class="pi ${nEx ? '' : 'off'}">🚫${nEx ? `<b>${nEx}</b>` : ''}</span>Exclusions</button>
      <button data-act="go" data-tab="profile"><span class="pi">🍳<b>${nEq}</b></span>Équipement</button>
      <button data-act="go" data-tab="profile"><span class="pi">🧭<b>${Math.round(st.discovery * 10)}</b></span>Découverte</button>
    </div>
    ${old ? `<div class="banner yellow"><span class="be">📅</span><div class="spacer"><b style="background:none;color:inherit;padding:0">Nouvelle semaine ?</b><br><span class="small">Archivez ce menu pour le retrouver dans l'historique.</span></div><button class="btn small" data-act="archive">Archiver</button></div>` : ''}
    ${!prof.size ? `<div class="banner"><span class="be">🧑‍🍳</span><div>Notez les recettes après les avoir cuisinées : <b>👍 / 👎</b> et les suggestions s'adaptent à vos goûts.</div></div>` : ''}
    <div class="row" style="margin:20px 0 4px">${stepper('meals', 0, m.items.length)} <span style="font-size:20px">repas</span><span class="spacer"></span>
      <button class="btn" data-act="go" data-tab="discover">＋ Ajouter</button></div>
    ${m.items.length ? items : `<div class="empty"><div class="ee">🍽️</div><h2>Menu vide</h2><p class="muted">On vous propose ${st.meals} recettes selon vos goûts ?</p><button class="btn" data-act="fill">Générer mon menu</button></div>`}
    <div class="addmeal" data-act="go" data-tab="discover"><div class="plate ph">♨️</div><span class="spacer" style="font-size:18px">Ajouter un autre repas</span><span class="round red">＋</span></div>
    ${m.items.length ? `<div class="center" style="margin-top:14px"><button class="pill" data-act="archive">✓ Semaine terminée : archiver et noter</button></div>` : ''}
    ${extras.length ? `<div class="suggest"><h2>On vous suggère aussi…</h2>${extras.map(r => `
      <div class="meal"><button data-act="open" data-id="${r.id}">${plate(r)}</button><div class="info">
        <h3 data-act="open" data-id="${r.id}">${esc(name(r))}</h3>
        <div class="chips"><span class="chip star" style="color:var(--ink)">${r.r.toFixed(1)}</span><span class="chip" style="color:var(--ink)">⏱ ${minutes(r.tm)}</span></div>
        <div><button class="pill" data-act="add" data-id="${r.id}">Ajouter</button></div></div></div>`).join('')}</div>` : ''}
    <div style="height:90px"></div>
    ${m.items.length ? `<div class="sticky-cta"><button class="btn big" data-act="go" data-tab="shop">Créer ma liste de courses</button></div>` : ''}`;
}

// ------------------------------------------------------------ vue Découvrir
function matchQuery(r, words) {
  const hay = norm([r.n, r.fr, r.c, TYPES[r.t], ...r.k].join(' ') + ' ' + (ingLex ? r.k.map(k => ingLex.fr.get(k) || '').join(' ') : ''));
  return words.every(w => hay.includes(w));
}
function renderDiscover(keepScroll) {
  setTitle('Découvrir');
  const st = R.settings();
  const words = norm(disc.q).split(/\s+/).filter(Boolean);
  let list = DB.list.filter(r =>
    (!disc.type || r.t === disc.type) && (!disc.cuisine || r.c === disc.cuisine) &&
    (!disc.quick || (r.tm && r.tm <= 30)) && (!disc.easy || r.d <= 1) && (!disc.cheap || r.p <= 1) &&
    !R.isExcluded(r, st) && (!words.length || matchQuery(r, words)));
  list = R.ranked(list);
  const total = list.length; list = list.slice(0, disc.shown);
  const tchip = (v, l) => `<button class="fchip ${disc.type === v ? 'on' : ''}" data-act="dtype" data-v="${v}">${l}</button>`;
  const tog = (k, l) => `<button class="fchip ${disc[k] ? 'on' : ''}" data-act="dtog" data-k="${k}">${l}</button>`;
  const html = `
    <div class="search"><span>🔎</span><input id="q" type="search" placeholder="Recette, ingrédient, pays…" value="${esc(disc.q)}" autocomplete="off"></div>
    <div class="fchips">${tchip('plat', 'Plats')}${tchip('entree', 'Entrées & soupes')}${tchip('dessert', 'Desserts')}${tchip('petit-dej', 'Petit-déj')}${tchip('boulangerie', 'Boulangerie')}${tchip('', 'Tout')}</div>
    <div class="fchips">${tog('quick', '⏱ ≤ 30 min')}${tog('easy', '👌 Très facile')}${tog('cheap', '€ Bon marché')}
      <button class="fchip ${disc.cuisine ? 'on' : ''}" data-act="dcuisine">🌍 ${esc(disc.cuisine || 'Tous pays')}</button></div>
    <p class="muted small">${total.toLocaleString('fr-FR')} recette${total > 1 ? 's' : ''}${words.length ? '' : ', triées pour vous'}</p>
    <div class="grid">${list.map(r => `
      <div class="card"><button data-act="open" data-id="${r.id}" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:8px">${plate(r)}
        <h3>${esc(name(r))}</h3></button>
        <div class="chips"><span class="chip star">${r.r.toFixed(1)}</span><span class="chip">⏱ ${minutes(r.tm)}</span>${r.c ? `<span class="chip">${esc(r.c)}</span>` : ''}</div>
        <button class="round red add ${inMenu(r.id) ? 'in' : ''}" data-act="toggleMenu" data-id="${r.id}">${inMenu(r.id) ? '✓' : '＋'}</button>
      </div>`).join('')}</div>
    ${total > disc.shown ? `<div class="center" style="margin:20px"><button class="btn ghost" data-act="more" id="more">Voir plus</button></div>` : ''}
    ${!total ? `<div class="empty"><div class="ee">🤷</div><h2>Rien trouvé</h2><p class="muted">Essayez d'autres mots ou retirez des filtres.</p></div>` : ''}`;
  const y = window.scrollY;
  view.innerHTML = html;
  if (keepScroll) window.scrollTo(0, y);
  const q = $('#q');
  q.addEventListener('input', () => { disc.q = q.value; disc.shown = 30; clearTimeout(q.t); q.t = setTimeout(() => { renderDiscover(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  const more = $('#more');
  if (more && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); disc.shown += 30; renderDiscover(true); } }, { rootMargin: '400px' });
    io.observe(more);
  }
}

// ------------------------------------------------------------ vue Courses
async function shoppingList(m) {
  const agg = new Map();
  for (const it of m.items) {
    const r = DB.byId.get(it.id); if (!r) continue;
    const d = await details(it.id); if (!d) continue;
    const f = it.ppl / (d.serv || 4);
    for (const e of d.ing) {
      const label = cap(e.fr || e.n);
      const fam = unitFamily(e.u);
      const key = norm(label).replace(/(\w)s\b/g, '$1') + '|' + fam;
      if (!agg.has(key)) agg.set(key, { key, label, aisle: e.a || 'Autres', pantry: !!e.p, fam, q: 0, hasQ: false, units: new Set(), from: new Set(), en: e.n });
      const a = agg.get(key);
      if (e.q != null) { a.q += toBase(e.q * f, e.u); a.hasQ = true; if (e.u) a.units.add(e.u); }
      a.from.add(name(r));
    }
  }
  return [...agg.values()].map(a => {
    let qty = '';
    if (a.hasQ) { const [q, u] = fromBase(a.q, a.fam, a.units); qty = fmtQty(q, u); }
    return { ...a, qty };
  });
}
const AISLE_ORDER = ['Fruits & légumes', 'Viandes & poissons', 'Crèmerie & œufs', 'Boulangerie', 'Épicerie salée', 'Épicerie sucrée', 'Épices & condiments', 'Surgelés', 'Boissons', 'Autres'];
async function renderShop() {
  const m = menu();
  setTitle('Liste de courses', m.items.length ? `<button class="ib" data-act="shareList" aria-label="Partager">↗︎</button>` : '');
  if (!m.items.length) {
    view.innerHTML = `<div class="empty"><div class="ee">🛒</div><h2>Pas encore de liste</h2><p class="muted">Choisissez des recettes : la liste se remplit toute seule.</p><button class="btn" data-act="go" data-tab="menu">Voir mon menu</button></div>`;
    return;
  }
  if (!renderShop.cache || renderShop.cacheKey !== JSON.stringify(m.items)) view.innerHTML = '<div class="loader"></div>';
  const items = await shoppingList(m);
  renderShop.cache = items; renderShop.cacheKey = JSON.stringify(m.items);
  if (tab !== 'shop') return;
  const ck = k => S.get(`check:${m.id}:${k}`, false);
  const extras = S.list(`extra:${m.id}:`);
  const main = items.filter(i => !i.pantry), pantry = items.filter(i => i.pantry);
  const doneN = main.filter(i => ck(i.key)).length + extras.filter(([, e]) => e.done).length;
  const totalN = main.length + extras.length;
  const row = i => `<div class="item ${ck(i.key) ? 'done' : ''}" data-act="check" data-k="${esc(i.key)}">
      <span class="box">${ck(i.key) ? '✓' : ''}</span><div class="it">${esc(i.label)}<div class="from">${esc([...i.from].join(' · '))}</div></div><span class="qty">${esc(i.qty)}</span></div>`;
  const groups = AISLE_ORDER.map(a => [a, main.filter(i => i.aisle === a)]).filter(([, l]) => l.length);
  view.innerHTML = `
    <p class="muted" style="margin:0">${m.items.length} recette${m.items.length > 1 ? 's' : ''} · ${doneN}/${totalN} articles</p>
    <div class="progress"><i style="width:${totalN ? Math.round(doneN / totalN * 100) : 0}%"></i></div>
    ${groups.map(([a, l]) => `<div class="aisle"><h3>${a}</h3>${l.sort((x, y) => x.label.localeCompare(y.label, 'fr')).map(row).join('')}</div>`).join('')}
    <div class="aisle"><h3>Autres articles</h3>
      ${extras.map(([id, e]) => `<div class="item ${e.done ? 'done' : ''}"><span class="box" data-act="xcheck" data-id="${id}">${e.done ? '✓' : ''}</span><div class="it" data-act="xcheck" data-id="${id}">${esc(e.txt)}</div><button class="del" data-act="xdel" data-id="${id}">✕</button></div>`).join('')}
      <form id="addx" class="item"><input class="field" id="xtxt" placeholder="Ajouter : lessive, pain, café…" style="padding:9px 12px"><button class="round red" style="width:40px;height:40px;font-size:22px">＋</button></form></div>
    ${pantry.length ? `<details class="aisle"><summary><h3>🧂 Placard : à vérifier (${pantry.length})</h3></summary>${pantry.map(row).join('')}</details>` : ''}
    <p class="muted small center">Les quantités tiennent compte du nombre de personnes de chaque recette.</p>`;
  $('#addx').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#xtxt').value.trim(); if (!v) return;
    S.set(`extra:${m.id}:${S.uid()}`, { txt: v, done: false });
  });
}

// ------------------------------------------------------------ vue Historique
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
function renderHistory() {
  setTitle('Historique');
  const hs = S.list('hist:').map(([, h]) => h).sort((a, b) => b.date - a.date);
  if (!hs.length) {
    view.innerHTML = `<div class="empty"><div class="ee">📖</div><h2>Aucun menu archivé</h2><p class="muted">Quand une semaine est finie, appuyez sur « Semaine terminée » dans votre menu : elle arrive ici.</p></div>`;
    return;
  }
  view.innerHTML = hs.map(h => {
    const rs = h.items.map(i => DB.byId.get(i.id)).filter(Boolean);
    const open = histOpen.has(h.id);
    return `<div class="hist">
      <div class="row" data-act="hopen" data-id="${h.id}"><div class="spacer"><h3>Semaine du ${fmtDate(h.created || h.date)}</h3><span class="muted small">${rs.length} recettes</span></div><span style="font-size:20px">${open ? '▴' : '▾'}</span></div>
      <div class="thumbs" data-act="hopen" data-id="${h.id}">${rs.slice(0, 7).map(r => r.img ? `<img src="${esc(r.img)}" loading="lazy" alt="" data-fb="${typeEmoji(r.t)}">` : `<div class="ph">${typeEmoji(r.t)}</div>`).join('')}</div>
      ${open ? `<div class="list">${rs.map(r => {
        const rt = S.get('rate:' + r.id, {});
        const it = h.items.find(i => i.id === r.id);
        return `<div class="li" data-act="open" data-id="${r.id}" data-ppl="${it?.ppl || ''}">${r.img ? `<img src="${esc(r.img)}" loading="lazy" alt="" data-fb="${typeEmoji(r.t)}">` : `<div class="ph">${typeEmoji(r.t)}</div>`}<span class="nm">${esc(name(r))}</span><span>${rt.thumb === 1 ? '👍' : rt.thumb === -1 ? '👎' : ''}${rt.stars ? ' ' + '★'.repeat(rt.stars) : ''}</span></div>`;
      }).join('')}
        <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn small" data-act="redo" data-id="${h.id}">↺ Refaire ce menu</button>
        <button class="pill" data-act="hrate" data-id="${h.id}">Noter</button><span class="spacer"></span><button class="pill" data-act="hdel" data-id="${h.id}">🗑</button></div></div>` : ''}
    </div>`;
  }).join('');
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
  setTitle('Profil');
  const code = S.householdCode();
  const sy = S.sync;
  const exLabel = k => ingLex?.fr.get(k) ? `${ingLex.fr.get(k)}` : k;
  view.innerHTML = `
    <div class="panel"><h3>👥 Foyer</h3><p class="muted small">Valeurs par défaut des nouveaux menus.</p>
      <div class="row"><span class="spacer">Personnes</span>${stepper('setPeople', 0, st.people)}</div>
      <div class="row" style="margin-top:10px"><span class="spacer">Repas par semaine</span>${stepper('setMeals', 0, st.meals)}</div>
      <div style="margin-top:14px"><span>Dans le menu de la semaine :</span><div class="fchips" style="margin-top:8px;flex-wrap:wrap">
        ${['plat', 'entree', 'petit-dej', 'dessert'].map(t => `<button class="fchip ${st.menuTypes.includes(t) ? 'on' : ''}" data-act="mtype" data-v="${t}">${TYPES[t]}</button>`).join('')}</div></div>
      <div style="margin-top:6px"><span>Temps max conseillé :</span><div class="fchips" style="margin-top:8px">
        ${[[0, 'Sans limite'], [30, '30 min'], [45, '45 min'], [60, '1 h']].map(([v, l]) => `<button class="fchip ${st.maxTime === v ? 'on' : ''}" data-act="maxt" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="panel"><h3>🚫 Ingrédients exclus</h3><p class="muted small">Allergies, ingrédients que vous détestez : ils ne seront jamais proposés.</p>
      <div class="chips">${st.exclusions.map(x => `<button class="xchip" data-act="unex" data-v="${esc(x)}">${esc(exLabel(x))} ✕</button>`).join('') || '<span class="muted small">Aucun pour l\'instant</span>'}</div>
      <input class="field" id="exq" placeholder="Ex : champignons, coriandre, crevettes…" style="margin-top:12px" autocomplete="off"><div class="sug" id="exsug"></div></div>
    <div class="panel"><h3>🍳 Équipement</h3><p class="muted small">Les recettes qui demandent un appareil que vous n'avez pas sont masquées.</p>
      <div class="eqgrid">${EQUIP.map(([c, e, l]) => `<button class="eq ${st.equipment.includes(c) ? 'on' : ''}" data-act="eq" data-v="${c}"><span class="e">${e}</span>${l}</button>`).join('')}</div></div>
    <div class="panel"><h3>🧭 Mode découverte</h3><p class="muted small">Plus vous montez, plus on vous pousse vers des pays et des ingrédients jamais cuisinés.</p>
      <input type="range" class="slider" id="discov" min="0" max="1" step="0.05" value="${st.discovery}">
      <div class="row small muted"><span>Valeurs sûres</span><span class="spacer"></span><span>Aventuriers</span></div></div>
    <div class="panel"><h3>🔄 Synchro du foyer</h3>
      ${!S.syncConfigured() ? `<p class="muted small">La synchro n'est pas encore configurée (Supabase dans <code>config.js</code>). En attendant, tout reste sur ce téléphone.</p>` :
        code ? `<p class="small"><span class="syncdot ${sy.status === 'ok' ? 'ok' : sy.status === 'err' ? 'err' : ''}"></span>${sy.status === 'ok' ? 'Synchronisé ' + (sy.last ? 'à ' + sy.last.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') : sy.status === 'offline' ? 'Hors ligne' : sy.status === 'err' ? 'Erreur : ' + esc(sy.error) : 'Connexion…'}</p>
          <p class="muted small">Code du foyer, à saisir sur l'autre téléphone (dans l'app installée) :</p><div class="code">${esc(code)}</div>
          <div class="row" style="margin-top:12px"><button class="btn small" data-act="copyCode">Copier le code</button><span class="spacer"></span><button class="pill" data-act="leave">Quitter</button></div>` :
        `<p class="muted small">Partagez menu, liste de courses, historique et notes entre vos deux téléphones.</p>
          <button class="btn small" data-act="createHH">Créer un foyer</button>
          <p class="muted small" style="margin-top:14px">Ou rejoindre un foyer existant :</p>
          <div class="row"><input class="field" id="joincode" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters"><button class="btn small" data-act="joinHH">OK</button></div>`}
    </div>
    <div class="panel"><h3>ℹ️ L'app</h3>
      <p class="small">${DB.list.length.toLocaleString('fr-FR')} recettes notées ≥ 4,5★ par la communauté Food.com, sans doublons.<br>
      <span class="muted">Données ${esc(DB.meta?.v || '')} du ${esc(DB.meta?.built || '')} · App ${esc(APP_VERSION.slice(0, 7))}</span></p>
      <div class="row" style="flex-wrap:wrap"><button class="pill" data-act="checkUpdate">Chercher une mise à jour</button><button class="pill" data-act="reset">Réinitialiser ce téléphone</button></div>
      <p class="muted small" style="margin-top:12px">iPhone : ouvrez le site dans Safari, bouton Partager, puis « Sur l'écran d'accueil ».</p></div>`;
  const discov = $('#discov');
  discov.addEventListener('change', () => saveSettings({ discovery: +discov.value }));
  const exq = $('#exq'), exsug = $('#exsug');
  exq.addEventListener('input', async () => {
    const lex = await loadLex(); const q = norm(exq.value.trim());
    if (q.length < 2) { exsug.innerHTML = ''; return; }
    const res = lex.arr.filter(([k, fr]) => norm(k).includes(q) || norm(fr || '').includes(q)).slice(0, 12);
    exsug.innerHTML = res.map(([k, fr]) => `<button data-act="addex" data-v="${esc(k)}">${esc(fr || k)}${fr ? ` <span class="muted small">(${esc(k)})</span>` : ''}</button>`).join('')
      + `<button data-act="addex" data-v="${esc(exq.value.trim().toLowerCase())}">＋ « ${esc(exq.value.trim())} »</button>`;
  });
}
function saveSettings(patch) { S.set('settings', { ...R.settings(), ...patch }); }

// ------------------------------------------------------------ fiche recette
async function openRecipe(id, ppl) {
  const r = DB.byId.get(id); if (!r) return;
  const m = menu(), it = m.items.find(i => i.id === id);
  sheetState = { id, ppl: ppl || it?.ppl || R.settings().people, showEn: false };
  sheet.hidden = false; document.body.style.overflow = 'hidden';
  sheet.innerHTML = '<div class="loader"></div>';
  history.pushState({ sheet: id }, '');
  await renderSheet(true);
}
function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; sheetState = null; document.body.style.overflow = ''; }
window.addEventListener('popstate', () => { if (!sheet.hidden) closeSheet(); });

async function renderSheet(top) {
  if (!sheetState) return;
  const { id, ppl, showEn } = sheetState;
  const r = DB.byId.get(id), d = await details(id);
  if (!sheetState || sheetState.id !== id) return;
  const y = sheet.scrollTop;
  const f = ppl / (d.serv || 4);
  const rt = S.get('rate:' + id, {}), fav = S.get('fav:' + id, false), inM = inMenu(id);
  const main = d.ing.filter(e => !e.p), pantry = d.ing.filter(e => e.p);
  const full = Math.round(r.r * 2) / 2;
  const starsTxt = '★'.repeat(Math.floor(full)) + (full % 1 ? '⯪' : '') + '☆'.repeat(5 - Math.ceil(full));
  const kws = (d.kw || []).map(kwFr).filter(Boolean);
  const steps = showEn && d.stEn ? d.stEn : d.st;
  sheet.innerHTML = `<div class="inner">
    <div class="hero">${plate(r)}<button class="fab l" data-act="close" aria-label="Fermer">✕</button>
      <button class="fab r fav" data-act="fav" data-id="${id}" aria-label="Favori">${fav ? '♥' : '♡'}</button></div>
    <div class="rhead"><div class="stars">${starsTxt}</div><div class="muted">${r.rc.toLocaleString('fr-FR')} avis · ${r.r.toFixed(2).replace('.', ',')}/5</div>
      <h2>${esc(name(r))}</h2>${r.fr ? `<div class="en">${esc(r.n)}</div>` : ''}<div class="bar"></div>
      ${d.desc ? `<p style="margin:0">${esc(d.desc)}</p>` : ''}</div>
    <div class="tagrow">
      <div><span class="euro">${'€'.repeat(r.p)}<i>${'€'.repeat(3 - r.p)}</i></span>${COST[r.p]}</div>
      <div><span class="diffbars">${[1, 2, 3, 4].map(i => `<i class="${i <= r.d ? 'on' : ''}" style="height:${6 + i * 4}px"></i>`).join('')}</span>${DIFF[r.d]}</div>
      <div><span class="tv">${typeEmoji(r.t)}</span>${TYPES[r.t] || ''}</div>
      <div><span class="tv">🌍</span>${esc(r.c || 'Monde')}</div>
    </div>
    <div class="timesband">
      <div><div class="ic">🔪</div><b>${minutes(d.prep)}</b><span>Préparation</span></div>
      <div><div class="ic">♨️</div><b>${minutes(d.cook)}</b><span>Cuisson</span></div>
      <div><div class="ic">🔥</div><b>${r.kc ? r.kc + ' kcal' : '?'}</b><span>Par portion</span></div>
    </div>
    ${kws.length || r.eq?.length ? `<div class="kw chips" style="margin-top:16px">${r.eq.map(e => { const q = EQUIP.find(x => x[0] === e); return q ? `<span class="chip">${q[1]} ${q[2]}</span>` : ''; }).join('')}${kws.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}
    <div class="block"><h3>Ingrédients</h3>
      <div class="forppl">Pour ${stepper('sppl', id, ppl, ' 🍴')}</div>
      ${!d.units ? `<p class="muted small center">La source ne précise pas toujours les unités : quantités indicatives (adaptées à ${ppl} pers.).</p>` : ''}
      <div class="ings">${main.map(e => `<div class="ing"><div class="bub">${ingEmoji(e.n)}</div><b>${e.q != null ? esc(fmtQty(e.q * f, e.u)) : ''}</b>${esc(cap(e.fr || e.n))}${e.raw && !e.fr ? `<div class="orig">${esc(e.raw)}</div>` : ''}</div>`).join('')}</div>
      ${pantry.length ? `<div class="pantry"><b>Vérifiez que vous avez…</b><br><span class="muted">${pantry.map(e => esc(cap(e.fr || e.n)) + (e.q != null && e.u ? ' (' + esc(fmtQty(e.q * f, e.u)) + ')' : '')).join(' · ')}</span></div>` : ''}
    </div>
    <div class="block steps"><h3>Recette</h3>
      ${d.stEn ? `<div class="center" style="margin-bottom:8px"><button class="pill" data-act="toggleEn">${showEn ? 'Voir en français' : 'Voir la version originale (anglais)'}</button></div>` : ''}
      ${steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span><div class="tx"><div class="lbl">Étape ${i + 1}</div>${esc(s)}</div></div>`).join('')}
    </div>
    <div class="rate"><h3>Vous l'avez cuisinée ?</h3>
      <div class="thumbs"><button class="${rt.thumb === 1 ? 'sel' : ''}" data-act="thumb" data-id="${id}" data-v="1">👍</button><button class="${rt.thumb === -1 ? 'sel' : ''}" data-act="thumb" data-id="${id}" data-v="-1">👎</button></div>
      <div class="st">${[1, 2, 3, 4, 5].map(i => `<button class="${(rt.stars || 0) >= i ? 'on' : ''}" data-act="stars" data-id="${id}" data-v="${i}">★</button>`).join('')}</div></div>
    <div class="srcline">Recette de la communauté Food.com${d.by ? ' · par ' + esc(d.by) : ''} · <a href="${foodUrl(r)}" target="_blank" rel="noopener">voir l'original</a></div>
    <div class="sticky-cta"><button class="btn big" data-act="${inM ? 'sremove' : 'sadd'}" data-id="${id}">${inM ? 'Retirer du menu' : 'Ajouter au menu'}</button></div>
  </div>`;
  sheet.scrollTop = top ? 0 : y;
}

// ------------------------------------------------------------ actions
const A = {
  go: el => switchTab(el.dataset.tab),
  open: el => openRecipe(+el.dataset.id, +el.dataset.ppl || 0),
  close: () => history.back(),
  closeModal: el => el.closest('.modal-bg').remove(),
  add: el => addToMenu(+el.dataset.id),
  remove: el => removeFromMenu(+el.dataset.id),
  replace: el => replaceInMenu(+el.dataset.id),
  toggleMenu: el => { const id = +el.dataset.id; inMenu(id) ? removeFromMenu(id) : addToMenu(id); },
  ppl: el => { const m = menu(); const it = m.items.find(i => i.id === +el.dataset.id); if (!it) return; it.ppl = Math.max(1, Math.min(20, it.ppl + +el.dataset.d)); saveMenu(m); },
  meals: el => { const n = Math.max(0, Math.min(14, menu().items.length + +el.dataset.d)); fillMenu(n); },
  fill: () => fillMenu(),
  archive: () => { if (confirm('Archiver ce menu dans l\'historique et en commencer un nouveau ?')) archiveWeek(); },
  sadd: el => addToMenu(+el.dataset.id, sheetState?.ppl),
  sremove: el => removeFromMenu(+el.dataset.id),
  sppl: el => { sheetState.ppl = Math.max(1, Math.min(20, sheetState.ppl + +el.dataset.d)); const m = menu(); const it = m.items.find(i => i.id === sheetState.id); if (it) { it.ppl = sheetState.ppl; saveMenu(m); } else renderSheet(); },
  toggleEn: () => { sheetState.showEn = !sheetState.showEn; renderSheet(); },
  fav: el => { const k = 'fav:' + el.dataset.id; S.get(k) ? S.del(k) : S.set(k, true); },
  thumb: el => {
    const k = 'rate:' + el.dataset.id, cur = S.get(k, {}), v = +el.dataset.v;
    S.set(k, { ...cur, thumb: cur.thumb === v ? 0 : v, at: Date.now() });
    const mb = el.closest('.modal'); if (mb) { mb.querySelectorAll(`[data-id="${el.dataset.id}"]`).forEach(b => b.removeAttribute('style')); if (v === 1) el.style.cssText = 'background:var(--green);color:#fff'; if (v === -1) el.style.cssText = 'background:var(--ink);color:#fff'; }
  },
  stars: el => { const k = 'rate:' + el.dataset.id, cur = S.get(k, {}); S.set(k, { ...cur, stars: +el.dataset.v, thumb: cur.thumb || (+el.dataset.v >= 4 ? 1 : +el.dataset.v <= 2 ? -1 : 0), at: Date.now() }); toast('Merci, c\'est noté'); },
  dtype: el => { disc.type = el.dataset.v; disc.shown = 30; renderDiscover(); },
  dtog: el => { disc[el.dataset.k] = !disc[el.dataset.k]; disc.shown = 30; renderDiscover(); },
  dcuisine: () => {
    const cs = DB.meta.cuisines || [];
    const counts = {}; DB.list.forEach(r => { if (r.c) counts[r.c] = (counts[r.c] || 0) + 1; });
    modal(`<h2>Choisir un pays</h2><div class="sug"><button data-act="setCuisine" data-v="">Tous pays</button>${cs.map(c => `<button data-act="setCuisine" data-v="${esc(c)}">${esc(c)} <span class="muted small">${counts[c] || 0}</span></button>`).join('')}</div>`);
  },
  setCuisine: el => { disc.cuisine = el.dataset.v; disc.shown = 30; el.closest('.modal-bg').remove(); renderDiscover(); },
  more: () => { disc.shown += 30; renderDiscover(true); },
  check: el => { const k = `check:${menu().id}:${el.dataset.k}`; S.set(k, !S.get(k, false)); },
  xcheck: el => { const k = `extra:${menu().id}:${el.dataset.id}`; const e = S.get(k); if (e) S.set(k, { ...e, done: !e.done }); },
  xdel: el => S.del(`extra:${menu().id}:${el.dataset.id}`),
  shareList: async () => {
    const items = renderShop.cache || []; const m = menu();
    const txt = 'Courses La Chavitera\n\n' + AISLE_ORDER.map(a => { const l = items.filter(i => i.aisle === a && !i.pantry && !S.get(`check:${m.id}:${i.key}`)); return l.length ? a + '\n' + l.map(i => `- ${i.label}${i.qty ? ' : ' + i.qty : ''}`).join('\n') : ''; }).filter(Boolean).join('\n\n')
      + S.list(`extra:${m.id}:`).filter(([, e]) => !e.done).map(([, e]) => '\n- ' + e.txt).join('');
    share(txt);
  },
  shareMenu: () => share('Menu de la semaine 🍽️\n\n' + menu().items.map(i => DB.byId.get(i.id)).filter(Boolean).map(r => '- ' + name(r) + ' (' + foodUrl(r) + ')').join('\n')),
  hopen: el => { const id = el.dataset.id; histOpen.has(id) ? histOpen.delete(id) : histOpen.add(id); renderHistory(); },
  redo: el => {
    const h = S.get('hist:' + el.dataset.id); if (!h) return;
    const m = menu();
    if (m.items.length && !confirm('Remplacer le menu actuel par celui-ci ?')) return;
    saveMenu({ id: S.uid(), created: Date.now(), items: h.items.map(i => ({ ...i })) }); toast('Menu rechargé'); switchTab('menu');
  },
  hrate: el => { const h = S.get('hist:' + el.dataset.id); if (h) askRatings(h.items.map(i => i.id), 'Noter cette semaine'); },
  hdel: el => { if (confirm('Supprimer ce menu de l\'historique ?')) S.del('hist:' + el.dataset.id); },
  setPeople: el => saveSettings({ people: Math.max(1, Math.min(20, R.settings().people + +el.dataset.d)) }),
  setMeals: el => saveSettings({ meals: Math.max(1, Math.min(14, R.settings().meals + +el.dataset.d)) }),
  mtype: el => { const st = R.settings(), v = el.dataset.v; let t = st.menuTypes.includes(v) ? st.menuTypes.filter(x => x !== v) : [...st.menuTypes, v]; if (!t.length) t = ['plat']; saveSettings({ menuTypes: t }); },
  maxt: el => saveSettings({ maxTime: +el.dataset.v }),
  eq: el => { const st = R.settings(), v = el.dataset.v; saveSettings({ equipment: st.equipment.includes(v) ? st.equipment.filter(x => x !== v) : [...st.equipment, v] }); },
  addex: el => { const st = R.settings(), v = el.dataset.v; if (v && !st.exclusions.includes(v)) saveSettings({ exclusions: [...st.exclusions, v] }); },
  unex: el => saveSettings({ exclusions: R.settings().exclusions.filter(x => x !== el.dataset.v) }),
  createHH: async () => { await S.setHousehold(S.newCode()); toast('Foyer créé : partagez le code'); renderProfile(); },
  joinHH: async () => { const v = $('#joincode').value.trim(); if (v.replace(/-/g, '').length < 16) return toast('Code incomplet'); await S.setHousehold(v); toast(S.sync.status === 'ok' ? 'Foyer rejoint 🎉' : 'Code enregistré'); renderProfile(); },
  copyCode: () => { navigator.clipboard?.writeText(S.householdCode()); toast('Code copié'); },
  leave: () => { if (confirm('Ce téléphone ne sera plus synchronisé. Continuer ?')) { S.setHousehold(''); renderProfile(); } },
  checkUpdate: async () => { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.update(); toast('Vérifié : si une version existe, l\'app va se recharger'); } else location.reload(); },
  reset: () => { if (confirm('Effacer menu, historique et réglages de CE téléphone ?')) { S.resetLocal(); location.reload(); } },
};
async function share(text) {
  if (navigator.share) { try { await navigator.share({ text }); } catch {} }
  else { await navigator.clipboard?.writeText(text); toast('Copié dans le presse-papiers'); }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});

// ------------------------------------------------------------ navigation & rendu
function switchTab(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (!sheet.hidden) history.back();
  window.scrollTo(0, 0); render();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
function render() {
  if (!DB.ready) return;
  const n = menu().items.length, b = $('#shopBadge'); b.hidden = !n; b.textContent = n;
  ({ menu: renderMenu, discover: renderDiscover, shop: renderShop, history: renderHistory, profile: renderProfile })[tab]();
}
let rt = null;
S.on(keys => {
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
    view.innerHTML = `<div class="empty"><div class="ee">🧑‍🍳</div><h2>La base de recettes arrive</h2><p class="muted">Les données ne sont pas encore générées. Lancez le workflow « Construire les recettes » sur GitHub (voir le README).</p></div>`;
    return;
  }
  loadLex();
  render();
  S.startSync();
}
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
