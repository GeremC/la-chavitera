// État local + synchro foyer (Supabase, fusion "dernière écriture gagne" clé par clé)
const LS = 'lc_state_v1', LS_CODE = 'lc_household', LS_DIRTY = 'lc_dirty';
const listeners = new Set();
let entries = {};      // { key: { v, t } }
let dirty = {};        // clés modifiées pas encore envoyées
let syncTimer = null, syncing = false;
export const sync = { status: 'off', last: null, error: null };

try { entries = JSON.parse(localStorage.getItem(LS)) || {}; } catch { entries = {}; }
try { dirty = JSON.parse(localStorage.getItem(LS_DIRTY)) || {}; } catch { dirty = {}; }

const now = () => Date.now();
function persist() {
  try { localStorage.setItem(LS, JSON.stringify(entries)); localStorage.setItem(LS_DIRTY, JSON.stringify(dirty)); } catch {}
}
function emit(keys) { listeners.forEach(fn => fn(keys)); }

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function get(key, def = undefined) { const e = entries[key]; return e && e.v !== null && e.v !== undefined ? e.v : def; }
export function set(key, v) {
  const t = Math.max(now(), (entries[key]?.t || 0) + 1);
  entries[key] = { v, t }; dirty[key] = 1; persist(); emit([key]); scheduleSync(800);
}
export function del(key) { set(key, null); }
export function list(prefix) {
  return Object.entries(entries).filter(([k, e]) => k.startsWith(prefix) && e.v !== null && e.v !== undefined)
    .map(([k, e]) => [k.slice(prefix.length), e.v]);
}
export function uid() { return Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4); }

// ------------------------------------------------------------ foyer / synchro
const cfg = () => window.LC_CONFIG || {};
export function syncConfigured() { return !!(cfg().SUPABASE_URL && cfg().SUPABASE_ANON_KEY); }
export function householdCode() { return localStorage.getItem(LS_CODE) || ''; }
export function newCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const s = [...b].map(x => a[x % a.length]).join('');
  return s.match(/.{4}/g).join('-');
}
export function setHousehold(code) {
  code = (code || '').trim().toUpperCase();
  if (code) localStorage.setItem(LS_CODE, code); else localStorage.removeItem(LS_CODE);
  // à la première connexion on envoie tout ce qu'on a en local
  dirty = {}; Object.keys(entries).forEach(k => dirty[k] = 1); persist();
  return syncNow();
}

async function rpc(fn, body) {
  const url = cfg().SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: cfg().SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg().SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  return res.json();
}

export async function syncNow() {
  const code = householdCode();
  if (!syncConfigured() || !code) { sync.status = 'off'; emit(['__sync']); return; }
  if (syncing) return; syncing = true;
  const outgoing = {}; Object.keys(dirty).forEach(k => { if (entries[k]) outgoing[k] = entries[k]; });
  const sent = { ...dirty };
  try {
    const remote = await rpc('merge_state', { p_code: code, p_entries: outgoing }) || {};
    const changed = [];
    for (const [k, e] of Object.entries(remote)) {
      if (!entries[k] || entries[k].t < e.t) { entries[k] = e; changed.push(k); }
    }
    Object.keys(sent).forEach(k => { if (entries[k] && remote[k] && remote[k].t >= entries[k].t) delete dirty[k]; });
    persist();
    sync.status = 'ok'; sync.last = new Date(); sync.error = null;
    emit(changed.length ? changed.concat('__sync') : ['__sync']);
  } catch (err) {
    sync.status = navigator.onLine ? 'err' : 'offline'; sync.error = String(err.message || err);
    emit(['__sync']);
  } finally { syncing = false; }
}
function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }

export function startSync() {
  syncNow();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
}

export function resetLocal() { entries = {}; dirty = {}; persist(); emit(['*']); }
