// Retour haptique (petites vibrations) sur les boutons.
// Android / Chrome : navigator.vibrate, avec une durée selon l'importance du bouton.
// iPhone (Safari 17.4+) : pas de navigator.vibrate ; on déclenche le « tic » natif
// d'un <input type="checkbox" switch> caché. Une seule intensité possible, donc
// les niveaux forts y donnent deux tics rapprochés.

const KEY = 'lc-haptics';
const PATTERNS = {
  light: 8,           // puces, filtres, cases à cocher, onglets
  medium: 16,         // actions courantes : ajouter, ouvrir, noter
  strong: 32,         // actions principales : générer, archiver, ajouter au menu
  danger: [28, 60, 28], // actions destructives : supprimer, quitter, réinitialiser
};
const IOS_TICKS = { light: 1, medium: 1, strong: 2, danger: 2 };

let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch {}

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let iosSwitch = null;
function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-99px';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
    label.appendChild(input); document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}
const isIOS = !canVibrate && /iP(hone|ad|od)/.test(navigator.userAgent || '') ||
  (!canVibrate && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function haptic(level = 'light') {
  if (!enabled) return;
  const p = PATTERNS[level] ?? PATTERNS.light;
  try {
    if (canVibrate) navigator.vibrate(p);
    else if (isIOS) {
      iosTick();
      if (IOS_TICKS[level] > 1) setTimeout(iosTick, 90);
    }
  } catch {}
}
export const hapticsSupported = () => canVibrate || isIOS;
export const hapticsOn = () => enabled;
export function setHaptics(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
  if (on) haptic('medium');
}

// Niveau par action (data-act). Les actions absentes ont « light ».
const LEVELS = {
  danger: ['cdel', 'purgeDel', 'remove', 'sremove', 'xdel', 'hdel', 'leave', 'reset', 'ldel', 'delCur', 'dishDel'],
  strong: ['fill', 'archive', 'sadd', 'redo', 'createHH', 'joinHH', 'closeModal', 'shopDone', 'newMenu', 'lview'],
  medium: ['add', 'toggleMenu', 'replace', 'open', 'fav', 'thumb', 'stars', 'shareMenu', 'shareList',
    'copyCode', 'more', 'timerStart', 'setCuisine', 'checkUpdate', 'addex', 'hrate', 'cooked', 'restoreDel', 'openFavs', 'lsel', 'lopen', 'pickMenu', 'undoMenus', 'dishUndo', 'dishAdd', 'ledit'],
};
const BY_ACT = {};
for (const [lvl, acts] of Object.entries(LEVELS)) acts.forEach(a => BY_ACT[a] = lvl);
export const levelFor = act => BY_ACT[act] || 'light';
