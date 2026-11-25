// Minuteurs de cuisine : plusieurs à la fois, gardés sur l'appareil (localStorage, pas de synchro foyer).
// Chaque minuteur retient son heure de fin : il continue de « tourner » même si on quitte l'écran,
// recharge la page ou ferme l'appli. Au retour, un minuteur échu sonne et reste affiché jusqu'à ce qu'on le valide.
//
// Limites du web (honnêtes) :
//  - PC et Android : alarme sonore + notification système tant que l'onglet / l'appli tourne encore en arrière-plan.
//    Si le système a mis l'appli en pause (écran éteint longtemps, appli fermée), l'alarme sonne à la réouverture.
//  - iPhone : iOS suspend les applis web en arrière-plan, et une notification locale programmée est impossible sans serveur.
//    Le minuteur continue et sonne dès qu'on revient dans l'appli. Pour aider, l'écran reste allumé
//    (Wake Lock) tant qu'un minuteur tourne et que l'appli est ouverte.
import { ic } from './icons.js';
import { haptic } from './haptic.js';

const KEY = 'lc-timers';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let timers = load();
let dock = null, panelOpen = false, tick = null, wake = null, ctx = null, ringTimer = null, ringUntil = 0, wakeAt = null;
const listeners = new Set();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch {} listeners.forEach(f => f()); }
export const onChange = fn => listeners.add(fn);
export const all = () => timers.slice();

const left = t => t.paused != null ? t.paused : Math.max(0, t.end - Date.now());
const running = t => !t.done && t.paused == null;
export function fmtClock(ms) {
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}

// ------------------------------------------------------------ actions
export function start({ sec, label, sub = '', rid = null }) {
  unlockAudio(); askNotif();
  const t = { id: Math.random().toString(36).slice(2, 9), label, sub, rid, dur: sec * 1000, end: Date.now() + sec * 1000, paused: null, done: false };
  timers.push(t); save(); render(); schedule();
  return t;
}
function upd(id, fn) { const t = timers.find(x => x.id === id); if (t) { fn(t); save(); render(); schedule(); } }
export const pause = id => upd(id, t => { if (running(t)) t.paused = left(t); });
export const resume = id => upd(id, t => { if (t.paused != null) { t.end = Date.now() + t.paused; t.paused = null; } });
export const add = (id, sec) => upd(id, t => {
  if (t.done) { t.done = false; t.end = Date.now() + sec * 1000; t.dur = sec * 1000; }
  else if (t.paused != null) t.paused += sec * 1000;
  else t.end += sec * 1000;
  t.dur += sec * 1000;
});
export const restart = id => upd(id, t => { t.done = false; t.paused = null; t.end = Date.now() + t.dur; });
export function remove(id) { timers = timers.filter(x => x.id !== id); save(); render(); schedule(); stopRingIfNone(); }

// ------------------------------------------------------------ échéances
function check() {
  let fired = false;
  for (const t of timers) if (running(t) && t.end <= Date.now()) { t.done = true; t.doneAt = Date.now(); fired = true; notify(t); }
  if (fired) { save(); ring(); }
  return fired;
}
function schedule() {
  clearTimeout(wakeAt);
  const next = timers.filter(running).map(t => t.end).sort((a, b) => a - b)[0];
  if (next) wakeAt = setTimeout(() => { check(); render(); schedule(); }, Math.max(50, next - Date.now() + 30));
  // rafraîchissement de l'affichage chaque seconde, seulement si visible
  clearInterval(tick);
  if (timers.some(running) && document.visibilityState === 'visible') tick = setInterval(() => { if (check()) render(); else paint(); }, 1000);
  wakeLock();
}

// ------------------------------------------------------------ son, vibration, notification
function unlockAudio() {
  try {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx?.state === 'suspended') ctx.resume();
    // iPhone : sonner même en mode silencieux (Safari 17+)
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {}
}
function beep() {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    [0, .18, .36].forEach((d, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.5, t0 + d + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + .16);
      o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + .18);
    });
  } catch {}
}
function ring() {
  ringUntil = Date.now() + 60000;
  if (ringTimer) return;
  const once = () => {
    if (!timers.some(t => t.done) || Date.now() > ringUntil || document.visibilityState !== 'visible') { clearInterval(ringTimer); ringTimer = null; return; }
    beep(); try { navigator.vibrate?.([200, 100, 200]); } catch {} haptic('strong');
  };
  once(); ringTimer = setInterval(once, 1600);
}
function stopRingIfNone() { if (!timers.some(t => t.done)) { clearInterval(ringTimer); ringTimer = null; } }
export function silence() { clearInterval(ringTimer); ringTimer = null; ringUntil = 0; }

function askNotif() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default' || localStorage.getItem('lc-notif-asked')) return;
    localStorage.setItem('lc-notif-asked', '1');
    Notification.requestPermission().catch(() => {});
  } catch {}
}
async function notify(t) {
  if (document.visibilityState === 'visible') return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: t.sub || 'Le minuteur est terminé', tag: 'lc-timer-' + t.id, renotify: true, requireInteraction: true, vibrate: [300, 120, 300, 120, 300], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { timer: t.id } };
    if (reg) await reg.showNotification('⏰ ' + t.label, opts); else new Notification('⏰ ' + t.label, opts);
  } catch {}
}

// écran allumé tant qu'un minuteur tourne (appli au premier plan)
async function wakeLock() {
  const need = timers.some(running) && document.visibilityState === 'visible';
  try {
    if (need && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    else if (!need && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}

// ------------------------------------------------------------ interface : dock flottant + panneau
function pill(t) {
  const ms = left(t), pct = t.done ? 1 : ms / Math.max(1, t.dur); // part restante
  const C = 2 * Math.PI * 9;
  return `<button class="tpill ${t.done ? 'done' : t.paused != null ? 'paused' : ''}" data-tact="panel" data-id="${t.id}" aria-label="Minuteur ${esc(t.label)}">
    <svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle class="fg" cx="12" cy="12" r="9" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg>
    <span class="tt" data-clock="${t.id}">${t.done ? 'Terminé !' : fmtClock(ms)}</span><span class="tl">${esc(t.label)}</span></button>`;
}
function row(t) {
  const ms = left(t);
  return `<div class="trow ${t.done ? 'done' : ''}">
    <div class="tinfo"><div class="tbig" data-clock="${t.id}">${t.done ? 'Terminé !' : fmtClock(ms)}</div>
      <div class="tlab">${esc(t.label)}</div>${t.sub ? `<button class="tsub" data-tact="open" data-rid="${t.rid ?? ''}">${esc(t.sub)} ${ic('chevron', 'sm')}</button>` : ''}</div>
    <div class="tbtns">
      ${t.done ? `<button class="tb" data-tact="add" data-id="${t.id}" data-s="60">+1 min</button><button class="tb" data-tact="restart" data-id="${t.id}" aria-label="Relancer">${ic('redo')}</button><button class="tb ok" data-tact="remove" data-id="${t.id}">OK</button>`
      : `<button class="tb" data-tact="add" data-id="${t.id}" data-s="60">+1</button><button class="tb" data-tact="add" data-id="${t.id}" data-s="300">+5</button>
        <button class="tb" data-tact="${t.paused != null ? 'resume' : 'pause'}" data-id="${t.id}" aria-label="${t.paused != null ? 'Reprendre' : 'Pause'}">${t.paused != null ? ic('play') : ic('pause')}</button>
        <button class="tb del" data-tact="remove" data-id="${t.id}" aria-label="Supprimer">${ic('x')}</button>`}
    </div></div>`;
}
function render() {
  if (!dock) return;
  const order = [...timers].sort((a, b) => (b.done - a.done) || (left(a) - left(b)));
  dock.hidden = !timers.length;
  dock.classList.toggle('ringing', timers.some(t => t.done));
  dock.innerHTML = timers.length ? `<div class="tpills">${order.map(pill).join('')}</div>` : '';
  const p = document.getElementById('tpanel');
  if (panelOpen && timers.length) {
    const html = `<div class="modal tmodal"><div class="thead"><h2>Minuteurs</h2><button class="ib" data-tact="close" aria-label="Fermer">${ic('x')}</button></div>
      ${order.map(row).join('')}
      <p class="muted small tnote">${platformNote()}</p></div>`;
    if (p) p.innerHTML = html;
    else { const bg = document.createElement('div'); bg.className = 'modal-bg tpanel'; bg.id = 'tpanel'; bg.innerHTML = html; document.body.appendChild(bg); }
  } else if (p) { p.remove(); panelOpen = false; }
}
// mise à jour légère (chaque seconde) sans reconstruire le DOM
function paint() {
  document.querySelectorAll('[data-clock]').forEach(el => {
    const t = timers.find(x => x.id === el.dataset.clock); if (!t || t.done) return;
    el.textContent = fmtClock(left(t));
  });
  const C = 2 * Math.PI * 9;
  dock?.querySelectorAll('.tpill').forEach(b => {
    const t = timers.find(x => x.id === b.dataset.id); if (!t || t.done) return;
    b.querySelector('.fg')?.setAttribute('stroke-dashoffset', (C * (1 - left(t) / Math.max(1, t.dur))).toFixed(1));
  });
}
function platformNote() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'Sur iPhone, une appli web ne peut pas sonner quand elle est fermée : le minuteur continue et sonne dès que vous revenez. L\'écran reste allumé tant que l\'appli est ouverte.';
  const n = 'Notification' in window ? Notification.permission : 'unsupported';
  if (n === 'denied') return 'Notifications refusées : l\'alarme sonne quand l\'appli est ouverte. Vous pouvez les réactiver dans les réglages du navigateur.';
  return 'Les minuteurs restent sur cet appareil, même si vous fermez l\'appli. Une notification prévient quand l\'appli est en arrière-plan (si le système la laisse tourner).';
}

let openRecipe = null;
export function mount(opts = {}) {
  openRecipe = opts.openRecipe;
  dock = document.getElementById('timers');
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-tact]');
    if (!el) { if (e.target.id === 'tpanel') { panelOpen = false; render(); } return; }
    e.preventDefault(); e.stopPropagation();
    const id = el.dataset.id, a = el.dataset.tact;
    haptic(a === 'remove' ? 'medium' : 'light');
    unlockAudio();
    if (a === 'panel') { panelOpen = true; silence(); render(); }
    else if (a === 'close') { panelOpen = false; render(); }
    else if (a === 'add') add(id, +el.dataset.s);
    else if (a === 'pause') pause(id);
    else if (a === 'resume') resume(id);
    else if (a === 'restart') restart(id);
    else if (a === 'remove') remove(id);
    else if (a === 'open' && el.dataset.rid) { panelOpen = false; render(); openRecipe?.(+el.dataset.rid); }
  }, true);
  // le son ne peut démarrer qu'après un geste : on prépare l'audio au premier toucher
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { timers = load(); check(); render(); }
    schedule();
  });
  // autre onglet / fenêtre de la même appli
  window.addEventListener('storage', e => { if (e.key === KEY) { timers = load(); render(); schedule(); } });
  // clic sur la notification : le service worker remet l'appli au premier plan
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'timer-open') { panelOpen = true; render(); } });
  check(); render(); schedule();
}
