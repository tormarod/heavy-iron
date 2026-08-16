const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
let tId = null, tEndAt = 0, tTotal = 0, tOverNotified = false;
let wakeLock = null;

const $ = id => document.getElementById(id);

/* Anything that ends up inside an innerHTML string goes through this first.
   Exercise names, rep ranges and the numbers you logged all reach the app
   from places it does not control — a pasted block, a JSON file fetched
   from the repo, a restored backup — and a rep range that reads
   `10<img src=x onerror=…>` has to render as those characters, not run. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Weights are typed on a Spanish phone keyboard, where the decimal key is a
   comma. parseFloat('22,5') is 22 — five kilos of drift on a leg press — so
   every read of a logged weight goes through here instead. */
const num = v => {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) ? n : NaN;
};

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/* Log rows are filed under a day's *id*, not its position, so days can be
   added, retired or reordered without the weeks logged under them moving
   with the shuffle. */
const slot = (w, dayId) => 'w' + w + '-' + dayId;

let uidN = 0;
const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + (uidN++);

/* Retired days/exercises stay in the block with an `off` flag instead of
   being spliced out: the session only ever shows the live ones, but the
   plan keeps enough of the retired item to put it back exactly where it
   was, and its log is never touched. */
const dayList = block => block.days.filter(d => !d.off);
const exList = day => day.ex.filter(e => !e.off);

/* ---------- storage ---------- */
function readRaw() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch (e) { return null; }  /* private mode / storage blocked — run in memory */
}

function load() {
  const raw = readRaw();
  try {
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.profiles) state = defaultState();
  migrate();
  ready = true;
  applyTheme();
  render();
  /* Write straight back: on a first run that persists the starting plan, and
     on a later one it persists whatever migrate() had to repair, so the same
     repair does not have to be redone on every open. */
  save();
  mark('Cargado');
}

/* Runs on every load, and on every restore. Two jobs: give old data the
   shape the current app expects, and put back anything that is missing or
   contradictory. The second one matters more than it sounds — a block id in
   `blockOrder` that no longer exists, or a block with no `phase`, used to be
   a blank white screen with no way back to your history. Repairing on the
   way in means the app opens even when the data is half broken. */
function migrate() {
  const fallback = defaultState();
  if (!state.profiles || typeof state.profiles !== 'object') state.profiles = fallback.profiles;

  Object.keys(fallback.profiles).forEach(pk => {
    if (!state.profiles[pk] || typeof state.profiles[pk] !== 'object') state.profiles[pk] = fallback.profiles[pk];
    const profile = state.profiles[pk];
    const seed = fallback.profiles[pk];

    if (!profile.label) profile.label = seed.label;
    if (!profile.theme) profile.theme = seed.theme;
    if (!profile.log || typeof profile.log !== 'object') profile.log = {};
    if (!profile.blocks || typeof profile.blocks !== 'object' || !Object.keys(profile.blocks).length) {
      profile.blocks = seed.blocks;
      profile.blockOrder = seed.blockOrder.slice();
    }

    /* The picker is driven off blockOrder, so it has to list every block
       that exists, exactly once, and nothing that doesn't. */
    const order = (Array.isArray(profile.blockOrder) ? profile.blockOrder : [])
      .filter((id, i, a) => profile.blocks[id] && a.indexOf(id) === i);
    Object.keys(profile.blocks).forEach(id => { if (order.indexOf(id) < 0) order.push(id); });
    profile.blockOrder = order;
    if (!profile.blocks[profile.activeBlock]) profile.activeBlock = order[order.length - 1];

    profile.week = clampInt(profile.week, 1, 8, 1);
    profile.day = clampInt(profile.day, 0, 99, 0);

    Object.keys(profile.blocks).forEach(bk => {
      const block = profile.blocks[bk];
      if (!block.id) block.id = bk;
      if (!block.name) block.name = 'Bloque';
      if (!block.phase || typeof block.phase !== 'object') block.phase = JSON.parse(JSON.stringify(GENERIC_IMPORT_PHASE));
      if (!Array.isArray(block.days)) block.days = [];
      block.days = block.days.filter(d => d && typeof d === 'object');
      if (!block.days.length) block.days = [{ id: 'd0', name: 'Día 1', ex: [newExercise()] }];

      /* Log rows are filed under a day's *id*, so every day needs one and no
         two days may share it. Legacy data was keyed by index ('w3-d1'), so
         the old days get the ids 'd0', 'd1', … — the keys come out identical
         and nothing has to be rewritten. */
      const usedDays = new Set();
      block.days.forEach((day, i) => {
        let id = day.id;
        if (!id || usedDays.has(id)) {
          id = 'd' + i;
          while (usedDays.has(id)) id = uid('d');
        }
        day.id = id;
        usedDays.add(id);
        if (!day.name) day.name = 'Día ' + (i + 1);
        if (!Array.isArray(day.ex)) day.ex = [];
        day.ex = day.ex.filter(e => e && typeof e === 'object');
        if (!day.ex.length) day.ex = [newExercise()];
        const usedEx = new Set();
        day.ex.forEach((ex, j) => {
          let id2 = ex.id;
          if (!id2 || usedEx.has(id2)) { id2 = slugify(ex.n) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
          ex.id = id2;
          usedEx.add(id2);
          ex.sets = clampInt(ex.sets, 1, 12, 3);
          ex.rest = clampInt(ex.rest, 0, 900, 90);
          if (ex.reps == null || ex.reps === '') ex.reps = '10–15';
        });
      });
    });
  });

  if (!state.profiles[state.activeProfile]) state.activeProfile = 'hombre';
  if (!state.prefs || typeof state.prefs !== 'object') state.prefs = {};
  if (['auto', 'light', 'dark'].indexOf(state.prefs.theme) < 0) state.prefs.theme = 'auto';
  state.prefs.sound = !!state.prefs.sound;
}

/* Writes are debounced so typing a weight doesn't serialise the whole log on
   every keystroke — but a debounce you never flush is a debounce that loses
   the last set of the session when the phone goes in your pocket. Every path
   out of the page flushes it: see the pagehide/visibilitychange handlers. */
let saveT = null;
let frozen = false;

function writeState() {
  if (frozen) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mark('Guardado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    mark('No se ha podido guardar — puede que no quede espacio en el navegador', true);
  }
}

function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = null; writeState(); }, 400);
}

function flushSave() {
  if (!saveT) return;
  clearTimeout(saveT);
  saveT = null;
  writeState();
}

window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);

/* Two tabs (or the installed app and a browser tab) share one localStorage.
   The event only fires in the *other* tab, so anything arriving here is a
   write we did not make: adopt it when we have nothing pending, and say so
   when we do rather than silently overwriting it on our next flush. */
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || frozen || !ready) return;
  if (saveT) {
    toast('Otra pestaña ha guardado cambios. Aquí tienes cambios sin guardar: al guardarlos se quedarán los tuyos.', 'Recargar', () => location.reload());
    return;
  }
  let next;
  try { next = JSON.parse(e.newValue); } catch (err) { return; }
  if (!next || !next.profiles) return;
  state = next;
  migrate();
  applyTheme();
  render();
  mark('Actualizado desde otra pestaña');
});

function mark(msg, err) {
  const s = $('status');
  if (!s) return;
  s.textContent = msg;
  s.className = 'status' + (err ? ' err' : '');
}

/* ---------- toast ----------
   For the few notices that need an answer rather than an acknowledgement:
   a new version is waiting, another tab has changed the log. */
function toast(msg, actionLabel, fn) {
  $('toastMsg').textContent = msg;
  const act = $('toastAct');
  if (actionLabel) {
    act.hidden = false;
    act.textContent = actionLabel;
    act.onclick = () => { hideToast(); fn(); };
  } else {
    act.hidden = true;
  }
  $('toast').hidden = false;
}
function hideToast() { $('toast').hidden = true; }
$('toastDismiss').onclick = hideToast;

/* ---------- theme ----------
   Three states on purpose: most people want the phone's setting to win, but
   a gym at 7am and a gym at 10pm are different rooms and the override has to
   stick. Stored with the rest of the state, so it rides along in backups. */
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'automático', light: 'claro', dark: 'oscuro' };
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };

function applyTheme() {
  const t = (state.prefs && state.prefs.theme) || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const b = $('themeBtn');
  b.textContent = THEME_ICON[t];
  b.title = 'Tema ' + THEME_LABEL[t];
  b.setAttribute('aria-label', 'Tema ' + THEME_LABEL[t] + ' — cambiar');
}

$('themeBtn').onclick = () => {
  const p = state.prefs;
  p.theme = THEME_ORDER[(THEME_ORDER.indexOf(p.theme) + 1) % THEME_ORDER.length];
  applyTheme();
  save();
  mark('Tema ' + THEME_LABEL[p.theme]);
};

/* ---------- recovery ----------
   The app draws straight from whatever is in localStorage, so data it cannot
   read used to mean a white screen and no way back. Instead: stop writing
   (so the broken copy is not overwritten with something worse), and offer to
   hand the raw bytes over as a file before anything is thrown away. */
function showRecovery(err, raw) {
  frozen = true;
  ready = false;
  clearTimeout(saveT); saveT = null;
  stopRest();

  const box = document.createElement('div');
  box.className = 'recovery';
  box.innerHTML =
    '<h1>No se ha podido abrir tu registro</h1>' +
    '<p>Los datos guardados en este navegador no tienen la forma que la app espera, ' +
    'así que no se ha dibujado nada — y, para no empeorarlo, se ha dejado de guardar.</p>' +
    '<p><b>Descarga los datos antes de nada.</b> Ese archivo es tu registro tal cual está: ' +
    'aunque la app no sepa leerlo, no se pierde y se puede recuperar a mano.</p>' +
    '<pre></pre>' +
    '<div class="foot-btns">' +
      '<button class="sm key" id="recDownload" type="button">Descargar los datos tal cual</button>' +
      '<button class="sm" id="recReload" type="button">Reintentar</button>' +
      '<button class="sm warn" id="recReset" type="button">Empezar de cero</button>' +
    '</div>';
  box.querySelector('pre').textContent = String((err && err.message) || err || 'Error desconocido');
  document.body.replaceChildren(box);

  box.querySelector('#recDownload').onclick = () =>
    downloadFile('heavy-iron-datos-sin-abrir-' + new Date().toISOString().slice(0, 10) + '.json',
                 raw == null ? '' : raw, 'application/json');
  box.querySelector('#recReload').onclick = () => location.reload();
  box.querySelector('#recReset').onclick = () => {
    if (!confirm('¿Borrar los datos guardados y empezar de cero? Descarga primero el archivo si no lo has hecho — esto no se puede deshacer.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing else to try */ }
    location.reload();
  };
}

function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- state accessors ---------- */
function getProfile() { return state.profiles[state.activeProfile]; }
function getBlock() { const p = getProfile(); return p.blocks[p.activeBlock]; }

function setsFor(ex, w) {
  let n = ex.sets;
  if (ex.add && w >= ex.add) n += 1;
  if (w === 8) n = Math.max(2, Math.ceil(ex.sets / 2));
  return n;
}

/* The stored rows are the record and are never shortened: dropping a set
   in the plan editor hides the last row from the session, it does not
   delete what was logged in it. Put the set back — this week or next
   block — and the numbers are still there. entry() only pads and returns
   the slice the current plan asks for; the row objects it hands back are
   the stored ones, so editing them writes straight through. */
function rowsFor(profile, blockId, w, dayId, exId) {
  if (!profile.log[blockId]) profile.log[blockId] = {};
  const k = slot(w, dayId);
  if (!profile.log[blockId][k]) profile.log[blockId][k] = {};
  if (!profile.log[blockId][k][exId]) profile.log[blockId][k][exId] = [];
  return profile.log[blockId][k][exId];
}

function entry(profile, blockId, w, dayId, exId, n) {
  const a = rowsFor(profile, blockId, w, dayId, exId);
  while (a.length < n) a.push({ w: '', r: '', done: false });
  return a.slice(0, n);
}

const rowUsed = r => !!(r && (r.done || (r.w !== '' && r.w != null) || (r.r !== '' && r.r != null)));

/* Rows logged past what the current plan shows — kept, but out of sight. */
function parkedRows(profile, blockId, w, dayId, exId, n) {
  const a = profile.log[blockId] && profile.log[blockId][slot(w, dayId)] && profile.log[blockId][slot(w, dayId)][exId];
  return a && a.length > n ? a.slice(n).filter(rowUsed).length : 0;
}

function loggedSets(profile, blockId, dayId, exId) {
  let n = 0;
  for (let w = 1; w <= 8; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) n += s[exId].filter(rowUsed).length;
  }
  return n;
}

function loggedSetsDay(profile, blockId, day) {
  return day.ex.reduce((t, ex) => t + loggedSets(profile, blockId, day.id, ex.id), 0);
}

function purgeExLog(profile, blockId, dayId, exId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= 8; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= 8; w++) delete blk[slot(w, dayId)];
}

/* Everything logged anywhere in a block — the number that decides whether
   a block is disposable, so it is the number every "¿eliminar?" shows. */
function blockLoggedSets(profile, blockId) {
  const blk = profile.log[blockId];
  if (!blk) return 0;
  let n = 0;
  Object.keys(blk).forEach(k => {
    const s = blk[k];
    if (!s) return;
    Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
  });
  return n;
}

function lastTime(profile, blockId, dayId, exId, beforeWeek) {
  for (let w = beforeWeek - 1; w >= 1; w--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) {
      const done = s[exId].filter(x => x.done && x.w !== '');
      if (done.length) return { week: w, sets: done };
    }
  }
  return null;
}

/* ---------- rest timer ----------
   The countdown is driven off a wall-clock end time (tEndAt), not a
   decrementing counter, so it self-corrects instantly when the phone
   was locked/backgrounded and setInterval got throttled or paused —
   the moment you look at the screen again it shows the real elapsed
   time instead of whatever it happened to freeze at. The Wake Lock
   request below tries to stop the screen from locking in the first
   place while a rest period is running, on browsers that support it. */
let tLabel = '';

function startRest(sec, label) {
  if (!sec) return;
  clearInterval(tId);
  tEndAt = Date.now() + sec * 1000;
  tTotal = sec; tOverNotified = false; tLabel = label;
  $('timer').classList.add('up');
  $('timer').classList.remove('over');
  $('tlbl').textContent = 'Descanso · ' + label;
  $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  tick();
  tId = setInterval(tick, 1000);
  requestWakeLock();
  primeAudio();  /* we are inside the tap that ticked the set — the one moment the browser lets us unlock sound */
}

function tick() {
  const v = $('tval'), f = $('tfill');
  const left = Math.round((tEndAt - Date.now()) / 1000);
  if (left > 0) {
    v.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    f.style.width = (left / tTotal * 100) + '%';
  } else {
    if (!tOverNotified) {
      tOverNotified = true;
      $('timer').classList.add('over');
      $('tlbl').textContent = 'Vamos';
      $('tmsg').textContent = 'Se acabó el descanso. Siguiente serie.';
      f.style.width = '100%';
      if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
      beep();
    }
    const over = Math.abs(left);
    v.textContent = '+' + Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0');
    if (over > 180) stopRest();
  }
}

function stopRest() {
  clearInterval(tId); tId = null;
  $('timer').classList.remove('up', 'over');
  releaseWakeLock();
}
$('tskip').onclick = stopRest;

/* The prescribed rest is a starting point, not a rule: the machine is still
   busy, or the set was easier than it looked. Nudging moves the finish line
   without restarting the countdown. */
function nudgeRest(delta) {
  if (!tId) return;
  const left = Math.max(0, Math.round((tEndAt - Date.now()) / 1000));
  const next = Math.max(5, left + delta);
  tEndAt = Date.now() + next * 1000;
  tTotal = Math.max(tTotal, next);
  if (tOverNotified) {
    tOverNotified = false;
    $('timer').classList.remove('over');
    $('tlbl').textContent = 'Descanso · ' + tLabel;
    $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  }
  tick();
}
$('tminus').onclick = () => nudgeRest(-30);
$('tplus').onclick = () => nudgeRest(30);

/* ---------- rest alarm ----------
   Vibration is silent to anyone whose phone is on a bench two metres away,
   and headphones drown the buzz. A short synthesised double beep needs no
   audio file — which matters for a site that has to work offline. */
let audioCtx = null;

function primeAudio() {
  if (!state.prefs.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio on this device — the vibration still fires */ }
}

function beep() {
  if (!state.prefs.sound || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [0, 0.3].forEach(off => {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + off);
      gain.gain.exponentialRampToValueAtTime(0.3, now + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.24);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + off);
      osc.stop(now + off + 0.26);
    });
  } catch (e) { /* ignore — never let the alarm break the countdown */ }
}

function renderSoundBtn() {
  const b = $('tsound');
  const on = !!state.prefs.sound;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Aviso sonoro activado' : 'Aviso sonoro desactivado';
}

$('tsound').onclick = () => {
  state.prefs.sound = !state.prefs.sound;
  renderSoundBtn();
  save();
  if (state.prefs.sound) { primeAudio(); beep(); }
};

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported, or permission denied — countdown still self-corrects on tick */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    /* The phone going into a pocket is the most likely moment for the tab to
       be discarded, and it is exactly when the last set was just typed. */
    flushSave();
    return;
  }
  if (tId) {
    tick();
    requestWakeLock();
  }
});

/* ---------- sheets ----------
   Escape closes the top one, and focus goes into the dialog when it opens
   and back to whatever opened it when it closes, so the whole app is usable
   without a mouse. */
const SHEET_IDS = ['sheet', 'planSheet', 'blocksSheet', 'importSheet', 'chartSheet'];
let sheetReturn = null;

function openSheet(id) {
  sheetReturn = document.activeElement;
  const el = $(id);
  el.classList.add('up');
  const box = el.querySelector('.sheet-box');
  box.setAttribute('tabindex', '-1');
  box.focus();
}

function closeSheet(id) {
  $(id).classList.remove('up');
  if (sheetReturn && sheetReturn.focus) sheetReturn.focus();
  sheetReturn = null;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = SHEET_IDS.filter(id => $(id).classList.contains('up'));
  if (!open.length) return;
  const top = open[open.length - 1];
  if (top === 'planSheet') closePlanEditor(); else closeSheet(top);
});

/* ---------- profile / block bars ---------- */
function renderProfiles() {
  const host = $('profiles');
  host.innerHTML = '';
  Object.keys(state.profiles).forEach(key => {
    const p = state.profiles[key];
    const b = document.createElement('button');
    b.className = 'profile-btn' + (key === state.activeProfile ? ' on' : '');
    b.textContent = p.label;
    b.onclick = () => { state.activeProfile = key; stopRest(); render(); };
    host.appendChild(b);
  });
  $('app').className = 'profile-' + getProfile().theme;
}

function blockDate(block) {
  if (!block.createdAt) return '';
  const d = new Date(block.createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}

/* Importing the same file twice (or copying a block without renaming it)
   leaves several blocks called exactly the same, and a picker full of
   identical rows is how you delete the wrong one. Same-named blocks get
   their position and creation date appended; a unique name is left alone. */
function blockPickerLabel(profile, id) {
  const name = profile.blocks[id].name || 'Bloque';
  const twins = profile.blockOrder.filter(x => (profile.blocks[x].name || 'Bloque') === name);
  if (twins.length < 2) return name;
  const d = blockDate(profile.blocks[id]);
  return name + ' (' + (twins.indexOf(id) + 1) + ')' + (d ? ' · ' + d : '');
}

function renderBlockBar() {
  const profile = getProfile();
  const host = $('blockbar');
  host.innerHTML = '';

  const select = document.createElement('select');
  profile.blockOrder.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = blockPickerLabel(profile, id);
    if (id === profile.activeBlock) opt.selected = true;
    select.appendChild(opt);
  });
  select.onchange = () => { profile.activeBlock = select.value; profile.week = 1; profile.day = 0; stopRest(); save(); render(); };
  host.appendChild(select);

  const newBtn = document.createElement('button');
  newBtn.className = 'sm';
  newBtn.textContent = '+ Nuevo bloque';
  newBtn.onclick = newBlock;
  host.appendChild(newBtn);

  const importBtn = document.createElement('button');
  importBtn.className = 'sm';
  importBtn.textContent = 'Importar JSON';
  importBtn.onclick = openImportSheet;
  host.appendChild(importBtn);

  const manageBtn = document.createElement('button');
  manageBtn.className = 'sm';
  manageBtn.textContent = 'Gestionar';
  manageBtn.onclick = openBlockManager;
  host.appendChild(manageBtn);
}

/* ---------- deleting blocks ----------
   The one rule: deleting somebody else's block must not move you. Only
   when the block you are actually training disappears do week/day reset
   and the app land somewhere else — on the newest block left, which is
   the one you are most likely training next. A profile is never left
   without a block. */
function deleteBlocks(profile, ids) {
  const drop = new Set(ids.filter(id => profile.blocks[id]));
  if (!drop.size) return 0;
  const keep = profile.blockOrder.filter(id => !drop.has(id));
  if (!keep.length) return 0;

  drop.forEach(id => { delete profile.blocks[id]; delete profile.log[id]; });
  profile.blockOrder = keep;
  if (drop.has(profile.activeBlock)) {
    profile.activeBlock = keep[keep.length - 1];
    profile.week = 1; profile.day = 0;
    stopRest();
  }
  save(); render();
  return drop.size;
}

function openBlockManager() {
  openSheet('blocksSheet');
  renderBlockManager();
}

function renderBlockManager() {
  const profile = getProfile();
  const host = $('blockList');
  host.innerHTML = '';
  const only = profile.blockOrder.length <= 1;

  profile.blockOrder.forEach(id => {
    const block = profile.blocks[id];
    const active = id === profile.activeBlock;
    const sets = blockLoggedSets(profile, id);
    const date = blockDate(block);

    const row = document.createElement('div');
    row.className = 'blk-row' + (active ? ' on' : '');
    row.innerHTML =
      '<span class="blk-l"><b></b><i></i></span>' +
      '<span class="pe-tools"><button type="button" class="pe-icon-btn danger blk-del">Eliminar</button></span>';
    row.querySelector('b').textContent = block.name + (active ? ' · actual' : '');
    row.querySelector('i').textContent =
      [date, dayList(block).length + (dayList(block).length === 1 ? ' día' : ' días'),
       sets ? setsLabel(sets) : 'sin registro'].filter(Boolean).join(' · ');

    const del = row.querySelector('.blk-del');
    del.disabled = only;
    del.onclick = () => {
      const what = '¿Eliminar "' + block.name + '"' + (date ? ' (' + date + ')' : '') + '?\n\n';
      const cost = sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ';
      const rest = active
        ? 'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.'
        : 'El bloque actual, "' + profile.blocks[profile.activeBlock].name + '", se queda exactamente como está.';
      if (!confirm(what + cost + rest + '\n\nNo se puede deshacer.')) return;
      deleteBlocks(profile, [id]);
      renderBlockManager();
      mark('Bloque eliminado');
    };

    host.appendChild(row);
  });
}

$('blkKeepCurrent').onclick = () => {
  const profile = getProfile();
  const others = profile.blockOrder.filter(id => id !== profile.activeBlock);
  if (!others.length) { alert('"' + getBlock().name + '" ya es el único bloque de ' + profile.label + '.'); return; }
  const sets = others.reduce((t, id) => t + blockLoggedSets(profile, id), 0);
  const names = others.map(id => '· ' + blockPickerLabel(profile, id)).join('\n');
  const msg =
    '¿Eliminar los otros ' + others.length + ' bloques de ' + profile.label + '?\n\n' + names + '\n\n' +
    (sets ? 'Se borran ' + setsLabel(sets) + ' en total. ' : 'No tienen nada registrado. ') +
    '"' + getBlock().name + '" y todo su registro se quedan como están.\n\nNo se puede deshacer.';
  if (!confirm(msg)) return;
  const n = deleteBlocks(profile, others);
  renderBlockManager();
  mark(n + (n === 1 ? ' bloque eliminado' : ' bloques eliminados') + ' — el bloque actual intacto');
};

$('blkClose').onclick = () => closeSheet('blocksSheet');
$('blocksSheet').addEventListener('click', e => { if (e.target.id === 'blocksSheet') closeSheet('blocksSheet'); });

function newBlock() {
  const profile = getProfile();
  const current = getBlock();
  const n = profile.blockOrder.length + 1;
  const name = prompt('Nombre del nuevo bloque:', 'Bloque ' + n);
  if (!name) return;
  const id = 'block-' + Date.now();
  const clone = JSON.parse(JSON.stringify(current));
  clone.id = id;
  clone.name = name;
  clone.createdAt = new Date().toISOString();
  /* Retired days/exercises exist to guard the old block's history, and the
     new block has none — copy the plan as it is actually trained. */
  clone.days = dayList(clone).map(d => { d.ex = exList(d); return d; });
  profile.blocks[id] = clone;
  profile.blockOrder.push(id);
  profile.activeBlock = id;
  profile.week = 1; profile.day = 0;
  save(); render();
  mark('Bloque creado a partir de "' + current.name + '" — edítalo con "Editar plan"');
}

/* ---------- import block from JSON ----------
   Lets an external agent (or you, by hand) hand over a block as plain
   JSON — either pasted in, or committed to blocks/ in this repo and
   picked from the list, fetched read-only via raw.githubusercontent.com
   (no token, no write access). See README for the expected JSON shape. */
const GITHUB_BLOCKS_BASE = 'https://raw.githubusercontent.com/tormarod/heavy-iron/main/blocks';

const GENERIC_IMPORT_PHASE = {
  1: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  2: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  3: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  4: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  5: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  6: { r: '0–1 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  7: { r: '0–1 RIR', t: 'La semana más dura. Última serie de cada máquina al fallo.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/* Imported blocks come from outside the app — a file in the repo, a paste
   from a chat, an agent's output — so nothing in them is taken on trust.
   Every string is trimmed to a length that still fits on the card, every
   number is clamped to something a human could train, and the block as a
   whole has a ceiling: a "block" with 40 000 exercises is not a training
   plan, it is a way to hang the phone. Anything the app then draws is
   escaped on the way out (see `esc`), so this is a second line, not the
   only one. */
const IMPORT_LIMITS = { days: 14, ex: 40, name: 80, exName: 120, alt: 200, cue: 400, reps: 40, pair: 1000, phaseR: 40, phaseT: 400 };

function txt(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeImportedBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El JSON no es un objeto válido.');
  const name = txt(raw.name, IMPORT_LIMITS.name) || 'Bloque importado';
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error('Falta "days" (al menos un día de entrenamiento).');
  if (raw.days.length > IMPORT_LIMITS.days) throw new Error('Demasiados días (' + raw.days.length + '): el máximo es ' + IMPORT_LIMITS.days + '.');

  const usedIds = new Set();
  const usedDayIds = new Set();
  const days = raw.days.map((day, di) => {
    if (!day || typeof day !== 'object') throw new Error('El día ' + (di + 1) + ' no es válido.');
    const dayName = txt(day.name, IMPORT_LIMITS.name) || ('Día ' + (di + 1));
    if (!Array.isArray(day.ex) || !day.ex.length) throw new Error('El día "' + dayName + '" necesita al menos un ejercicio.');
    if (day.ex.length > IMPORT_LIMITS.ex) throw new Error('El día "' + dayName + '" tiene ' + day.ex.length + ' ejercicios: el máximo es ' + IMPORT_LIMITS.ex + '.');
    const ex = day.ex.map((e, ei) => {
      if (!e || typeof e !== 'object') throw new Error('Un ejercicio del día "' + dayName + '" no es válido.');
      const n = txt(e.n, IMPORT_LIMITS.exName);
      if (!n) throw new Error('Falta el nombre de un ejercicio en "' + dayName + '".');
      const reps = txt(e.reps, IMPORT_LIMITS.reps);
      if (!reps) throw new Error('Falta el rango de repeticiones en "' + n + '".');
      const baseId = txt(e.id, 60) || (slugify(n) || ('ex-' + di + '-' + ei));
      let uniqueId = baseId, suffix = 2;
      while (usedIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
      usedIds.add(uniqueId);
      const out = {
        id: uniqueId, n, reps,
        sets: clampInt(e.sets, 1, 12, 3),
        rest: clampInt(e.rest, 0, 900, 90),
      };
      if (e.alt) out.alt = txt(e.alt, IMPORT_LIMITS.alt);
      if (e.cue) out.cue = txt(e.cue, IMPORT_LIMITS.cue);
      if (e.add != null && Number.isFinite(+e.add) && +e.add >= 1) out.add = clampInt(e.add, 1, 8, 1);
      if (e.share) out.share = 1;
      if (e.ss) out.ss = 1;
      return out;
    });
    let dayId = txt(day.id, 60);
    while (!dayId || usedDayIds.has(dayId)) dayId = uid('d');
    usedDayIds.add(dayId);
    const out = { id: dayId, name: dayName, ex };
    if (day.pair) out.pair = txt(day.pair, IMPORT_LIMITS.pair);
    return out;
  });

  let phase = JSON.parse(JSON.stringify(GENERIC_IMPORT_PHASE));
  if (raw.phase && typeof raw.phase === 'object') {
    phase = {};
    for (let w = 1; w <= 8; w++) {
      const p = raw.phase[w] || raw.phase[String(w)];
      phase[w] = (p && p.r && p.t)
        ? { r: txt(p.r, IMPORT_LIMITS.phaseR), t: txt(p.t, IMPORT_LIMITS.phaseT) }
        : GENERIC_IMPORT_PHASE[w];
    }
  }

  return { name, days, phase };
}

function applyImportedBlock(raw, sourceLabel) {
  let normalized;
  try {
    normalized = normalizeImportedBlock(raw);
  } catch (e) {
    $('importError').textContent = e.message;
    return;
  }
  const profile = getProfile();
  const id = 'block-' + Date.now();
  profile.blocks[id] = { id, name: normalized.name, createdAt: new Date().toISOString(), days: normalized.days, phase: normalized.phase };
  profile.blockOrder.push(id);
  profile.activeBlock = id;
  profile.week = 1; profile.day = 0;
  save(); render();
  closeSheet('importSheet');
  mark('Bloque "' + normalized.name + '" importado' + (sourceLabel ? ' (' + sourceLabel + ')' : '') + ' en ' + profile.label);
}

async function loadRepoBlockList() {
  const host = $('importRepoList');
  host.textContent = 'Cargando…';
  try {
    const res = await fetch(GITHUB_BLOCKS_BASE + '/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) { host.textContent = 'No hay bloques publicados todavía en blocks/.'; return; }
    host.innerHTML = '';
    list.slice(0, 60).forEach(item => {
      if (!item || typeof item !== 'object' || !item.file) return;
      /* The file name is pasted into a URL, so it may only ever name a file
         sitting in blocks/ — no directory hops, no absolute URLs. */
      const file = String(item.file);
      if (!/^[A-Za-z0-9._-]+\.json$/.test(file) || file.indexOf('..') >= 0) return;
      const label = txt(item.label, 120) || file;
      const row = document.createElement('div');
      row.className = 'import-item';
      row.innerHTML = '<span></span><button type="button" class="sm">Importar</button>';
      row.querySelector('span').textContent = label;
      row.querySelector('button').onclick = async () => {
        $('importError').textContent = '';
        try {
          const r = await fetch(GITHUB_BLOCKS_BASE + '/' + encodeURIComponent(file), { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyImportedBlock(await r.json(), label);
        } catch (e) {
          $('importError').textContent = 'No se pudo cargar "' + label + '": ' + e.message;
        }
      };
      host.appendChild(row);
    });
  } catch (e) {
    host.textContent = 'No se pudo conectar con GitHub ahora mismo. Puedes pegar el JSON a mano abajo.';
  }
}

function openImportSheet() {
  $('importBlob').value = '';
  $('importError').textContent = '';
  openSheet('importSheet');
  loadRepoBlockList();
}

$('importFromText').onclick = () => {
  $('importError').textContent = '';
  let raw;
  try { raw = JSON.parse($('importBlob').value); } catch (e) { $('importError').textContent = 'Eso no es JSON válido.'; return; }
  applyImportedBlock(raw, 'texto pegado');
};
$('importClose').onclick = () => closeSheet('importSheet');
$('importSheet').addEventListener('click', e => { if (e.target.id === 'importSheet') closeSheet('importSheet'); });

/* ---------- nav ---------- */
function renderNav() {
  const profile = getProfile();
  const block = getBlock();
  const days = dayList(block);

  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;

  $('weeks').innerHTML = '';
  for (let w = 1; w <= 8; w++) {
    const b = document.createElement('button');
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (w === 8 ? ' deload' : '');
    b.textContent = w === 8 ? 'DL' : w;
    const has = days.some(d => {
      const s = profile.log[block.id] && profile.log[block.id][slot(w, d.id)];
      return s && Object.values(s).some(a => a.some(x => x.done));
    });
    if (has) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; stopRest(); render(); };
    $('weeks').appendChild(b);
  }

  $('days').innerHTML = '';
  days.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'day' + (i === profile.day ? ' on' : '');
    b.innerHTML = '<span class="day-n">Día ' + (i + 1) + '</span><span class="day-t"></span>';
    b.querySelector('.day-t').textContent = d.name;
    b.onclick = () => { profile.day = i; stopRest(); render(); };
    $('days').appendChild(b);
  });
}

/* ---------- main render ----------
   Everything the app draws goes through here, so this is also the one place
   that has to survive bad data: if drawing throws, the recovery screen takes
   over instead of leaving a blank page and an unreachable log. */
function render() {
  if (!ready) return;
  try {
    drawApp();
  } catch (e) {
    showRecovery(e, readRaw());
  }
}

/* The best weight ever completed on each exercise, across every block of the
   profile — the bar a set has to clear to count as a personal record. The
   session being drawn is excluded, or its own sets would beat themselves. */
function bestByExercise(profile, skipBlockId, skipSlot) {
  const best = {};
  Object.keys(profile.log).forEach(bId => {
    const blk = profile.log[bId];
    if (!blk) return;
    Object.keys(blk).forEach(k => {
      if (bId === skipBlockId && k === skipSlot) return;
      const s = blk[k];
      if (!s) return;
      Object.keys(s).forEach(exId => {
        const rows = s[exId];
        if (!Array.isArray(rows)) return;
        rows.forEach(r => {
          if (!r || !r.done) return;
          const w = num(r.w);
          if (isNaN(w)) return;
          if (!(exId in best) || w > best[exId]) best[exId] = w;
        });
      });
    });
  });
  return best;
}

/* What you put on the bar for this set last time round, used as the greyed
   placeholder in the empty weight box. Walks back week by week and falls
   back to the last set of that week when the plan has since grown. */
function priorWeight(profile, blockId, w, dayId, exId, idx) {
  for (let k = w - 1; k >= 1; k--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(k, dayId)];
    const rows = s && s[exId];
    if (!Array.isArray(rows) || !rows.length) continue;
    const r = rows[idx] || rows[rows.length - 1];
    if (r && r.w !== '' && r.w != null) return String(r.w);
  }
  return '';
}

function drawApp() {
  const profile = getProfile();
  const block = getBlock();

  /* A block always keeps one live day: retiring every day would leave the
     session with nothing to draw, so the first one comes back. */
  if (!dayList(block).length && block.days.length) delete block.days[0].off;
  const days = dayList(block);
  if (!(profile.day >= 0) || profile.day > days.length - 1) profile.day = 0;

  renderProfiles();
  renderBlockBar();
  renderNav();
  renderSoundBtn();

  const ph = block.phase[profile.week] || { r: '', t: '' };
  const dl = profile.week === 8;
  $('banner').innerHTML = '';
  const bannerDiv = document.createElement('div');
  bannerDiv.className = 'banner' + (dl ? ' deload' : '');
  bannerDiv.innerHTML =
    '<div><div class="banner-l">Objetivo semana ' + profile.week + '</div>' +
    '<div class="banner-v"></div></div><div class="banner-r"></div>';
  bannerDiv.querySelector('.banner-v').textContent = ph.r;
  bannerDiv.querySelector('.banner-r').textContent = ph.t;
  $('banner').appendChild(bannerDiv);

  const day = days[profile.day];
  $('pair').textContent = day.pair || '';
  $('pair').style.display = day.pair ? 'flex' : 'none';

  const list = $('list');
  list.innerHTML = '';
  let total = 0, doneN = 0, tonnage = 0, prs = 0, lastTs = 0;
  const best = bestByExercise(profile, block.id, slot(profile.week, day.id));

  exList(day).forEach((ex, i) => {
    const n = setsFor(ex, profile.week);
    const rows = entry(profile, block.id, profile.week, day.id, ex.id, n);
    const parked = parkedRows(profile, block.id, profile.week, day.id, ex.id, n);
    const allDone = rows.every(r => r.done);
    total += n; doneN += rows.filter(r => r.done).length;

    const isPr = r => r.done && !isNaN(num(r.w)) && (!(ex.id in best) || num(r.w) > best[ex.id]);
    const cardPr = rows.some(isPr);
    if (cardPr) prs++;

    const card = document.createElement('div');
    card.className = 'ex' + (allDone ? ' complete' : '') + (ex.share ? ' shared' : '');

    const prev = lastTime(profile, block.id, day.id, ex.id, profile.week);
    const prevTxt = prev
      ? '<div class="last"><span class="tag">Sem. ' + prev.week + '</span><span><b>' +
        prev.sets.map(s => esc(s.w) + '×' + esc(s.r || '?')).join('</b> · <b>') + '</b></span></div>'
      : '';

    card.innerHTML =
      '<div class="ex-head">' +
        '<div class="ex-num">' + (i + 1) + '</div>' +
        '<div class="ex-body">' +
          '<div class="ex-name"></div>' +
          (ex.alt ? '<div class="ex-alt"></div>' : '') +
          (ex.cue ? '<div class="ex-cue"></div>' : '') +
        '</div>' +
        '<div><div class="ex-target">' + n + ' × ' + esc(ex.reps) + '</div>' +
        '<div class="ex-rest">' + (ex.rest ? 'desc. ' + (ex.rest >= 60 ? (ex.rest / 60).toFixed(ex.rest % 60 ? 1 : 0).replace('.0', '') + ' min' : ex.rest + 's') : 'superserie →') + '</div>' +
        '<button class="ex-chart-btn" type="button">Progreso ↗</button></div>' +
      '</div>' + prevTxt +
      '<div class="sets"></div>' +
      (parked ? '<div class="ex-parked"></div>' : '');

    if (parked) {
      card.querySelector('.ex-parked').textContent = parked === 1
        ? 'Hay 1 serie registrada por encima de las que pide el plan. Se guarda: sube las series de este ejercicio para volver a verla.'
        : 'Hay ' + parked + ' series registradas por encima de las que pide el plan. Se guardan: sube las series de este ejercicio para volver a verlas.';
    }

    const nameEl = card.querySelector('.ex-name');
    nameEl.appendChild(document.createTextNode(ex.n));
    if (ex.share) { const s = document.createElement('span'); s.className = 'badge together'; s.textContent = 'JUNTOS'; nameEl.appendChild(s); }
    else { const s = document.createElement('span'); s.className = 'badge solo'; s.textContent = 'SOLO'; nameEl.appendChild(s); }
    if (ex.ss) { const s = document.createElement('span'); s.className = 'ss'; s.textContent = 'SS'; nameEl.appendChild(s); }
    if (cardPr) { const s = document.createElement('span'); s.className = 'badge pr'; s.textContent = 'RÉCORD'; nameEl.appendChild(s); }
    if (ex.alt) card.querySelector('.ex-alt').textContent = ex.alt;
    if (ex.cue) card.querySelector('.ex-cue').textContent = ex.cue;

    card.querySelector('.ex-chart-btn').onclick = () => openChart(ex, day.id);

    const box = card.querySelector('.sets');
    rows.forEach((r, si) => {
      if (r.done) {
        const w = num(r.w), reps = num(r.r);
        if (!isNaN(w) && !isNaN(reps)) tonnage += w * reps;
        if (r.ts > lastTs) lastTs = r.ts;
      }

      const row = document.createElement('div');
      row.className = 'set-row' + (r.done ? ' done' : '') + (isPr(r) ? ' pr' : '');
      /* text + inputmode rather than type=number: a Spanish keyboard sends a
         comma, and type=number throws the whole value away when it sees one,
         so "22,5" silently became an empty box. */
      row.innerHTML =
        '<div class="set-n">' + (si + 1) + '</div>' +
        '<div class="fld"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"><u>kg</u></div>' +
        '<div class="fld"><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"><u>rep</u></div>' +
        '<button type="button" class="tick' + (r.done ? ' on' : '') + '" aria-pressed="' + (r.done ? 'true' : 'false') + '">✓</button>';

      const [wIn, rIn] = row.querySelectorAll('input');
      const hint = priorWeight(profile, block.id, profile.week, day.id, ex.id, si);
      wIn.value = r.w; rIn.value = r.r;
      wIn.placeholder = hint || '—';
      rIn.placeholder = '—';
      wIn.setAttribute('aria-label', 'Peso, serie ' + (si + 1) + ' de ' + ex.n);
      rIn.setAttribute('aria-label', 'Repeticiones, serie ' + (si + 1) + ' de ' + ex.n);
      wIn.oninput = e => { r.w = e.target.value.replace(/[^0-9.,]/g, ''); if (r.w !== e.target.value) e.target.value = r.w; save(); };
      rIn.oninput = e => { r.r = e.target.value.replace(/[^0-9]/g, ''); if (r.r !== e.target.value) e.target.value = r.r; save(); };

      const tick = row.querySelector('.tick');
      tick.setAttribute('aria-label', (r.done ? 'Desmarcar' : 'Marcar') + ' serie ' + (si + 1) + ' de ' + ex.n);
      tick.onclick = () => {
        let adopted = '';
        if (!r.done) {
          /* Ticking a set whose weight box is still empty takes the greyed
             number showing in it — last week's weight for this same set. It
             is the common case, but it is also a guess, so it says so. */
          if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; }
          r.ts = Date.now();
        }
        r.done = !r.done;
        if (r.done && ex.rest) startRest(ex.rest, ex.n + ' · serie ' + (si + 1));
        if (r.done && !ex.rest) stopRest();
        save(); render();
        if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' kg (lo de la semana anterior) — cámbialo si no fue eso');
      };
      box.appendChild(row);
    });

    list.appendChild(card);
  });

  $('barfill').style.width = total ? (doneN / total * 100) + '%' : '0%';

  const extra = [];
  if (tonnage > 0) extra.push('Volumen: ' + Math.round(tonnage).toLocaleString('es-ES') + ' kg movidos');
  if (prs) extra.push(prs === 1 ? '1 récord personal' : prs + ' récords personales');
  if (lastTs) extra.push('último registro ' + new Date(lastTs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
  const head = doneN === total
    ? 'Sesión completa — ' + total + ' series registradas. Siguiente: ' + days[(profile.day + 1) % days.length].name + (profile.day === days.length - 1 ? ', semana ' + (profile.week + 1) : '') + '.'
    : doneN + ' de ' + total + ' series hechas. Llega al tope del rango en todas las series y sube el peso el próximo día.';
  $('note').textContent = head + (extra.length ? ' · ' + extra.join(' · ') + '.' : '');
}

/* ---------- day/data actions ---------- */
function currentDay() {
  const days = dayList(getBlock());
  return days[Math.min(getProfile().day, days.length - 1)];
}

$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  const src = profile.log[block.id] && profile.log[block.id][slot(profile.week - 1, day.id)];
  if (profile.week === 1 || !src) { mark('No hay nada registrado en la semana ' + (profile.week - 1) + ' para este día'); return; }
  exList(day).forEach(ex => {
    const from = src[ex.id]; if (!from) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week));
    to.forEach((r, i) => { if (!r.done) r.w = (from[i] || from[from.length - 1] || {}).w || ''; });
  });
  save(); render();
  mark('Pesos copiados de la semana ' + (profile.week - 1) + ' — supéralos');
};

$('clearDay').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  if (!confirm('¿Borrar todas las series de ' + day.name + ', semana ' + profile.week + '?')) return;
  if (profile.log[block.id]) delete profile.log[block.id][slot(profile.week, day.id)];
  save(); render();
  mark('Día borrado');
};

$('wipe').onclick = () => {
  const profile = getProfile();
  if (!confirm('¿Borrar TODO el registro de ' + profile.label + ' (todos los bloques y semanas)? El plan de ejercicios no se borra. No se puede deshacer.')) return;
  profile.log = {};
  save(); render();
  mark('Registro de ' + profile.label + ' borrado');
};

/* ---------- plan editor ----------
   Everything here edits a *draft* copy of the block; nothing reaches the
   real block (or the log) until "Guardar cambios". Structural edits are
   built so the logged sets survive them: exercises and days keep their
   ids when moved or renamed, dropping a set only hides the row, and
   removing something that has history retires it instead of deleting it.
   Erasing logged sets for good takes a second, explicit click in
   "Retirados". */
let draftBlock = null;
let draftPurge = [];

$('editPlan').onclick = () => {
  draftBlock = JSON.parse(JSON.stringify(getBlock()));
  draftPurge = [];
  $('peBlockName').value = draftBlock.name;
  renderPlanEditor();
  openSheet('planSheet');
};

function newExercise() {
  return { id: uid('ex'), n: '', alt: '', cue: '', sets: 3, reps: '10–15', rest: 90, share: 0, ss: 0 };
}

/* Swap with the nearest live neighbour, leaving retired items parked
   where they are. */
function moveLive(arr, item, dir) {
  const i = arr.indexOf(item);
  let j = i + dir;
  while (j >= 0 && j < arr.length && arr[j].off) j += dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  arr[i] = arr[j];
  arr[j] = item;
}

function setsLabel(n) { return n + (n === 1 ? ' serie registrada' : ' series registradas'); }

function renderPlanEditor() {
  const host = $('peDays');
  const profile = getProfile();
  host.innerHTML = '';

  const live = dayList(draftBlock);
  live.forEach((day, pos) => host.appendChild(buildDayBox(profile, day, pos, live.length)));

  const addDay = document.createElement('button');
  addDay.type = 'button';
  addDay.className = 'pe-add-ex';
  addDay.textContent = '+ Añadir día';
  addDay.onclick = () => {
    draftBlock.days.push({ id: uid('d'), name: 'Día ' + (live.length + 1), ex: [newExercise()] });
    renderPlanEditor();
  };
  host.appendChild(addDay);

  renderRetired(host, profile);
}

function buildDayBox(profile, day, pos, liveCount) {
  const box = document.createElement('div');
  box.className = 'pe-day';
  box.innerHTML =
    '<div class="pe-bar">' +
      '<span class="pe-bar-n">Día ' + (pos + 1) + '</span>' +
      '<span class="pe-log-tag"></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn d-up" title="Subir día">↑</button>' +
        '<button type="button" class="pe-icon-btn d-down" title="Bajar día">↓</button>' +
        '<button type="button" class="pe-icon-btn danger d-del">Quitar día</button>' +
      '</span>' +
    '</div>' +
    '<div class="pe-day-head">' +
      '<input type="text" class="pe-day-name" placeholder="Nombre del día">' +
      '<textarea class="pe-day-pair" placeholder="Nota de pareja para este día (opcional)"></textarea>' +
    '</div><div class="pe-exlist"></div>';

  const logged = loggedSetsDay(profile, draftBlock.id, day);
  if (logged) box.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  box.querySelector('.pe-day-name').value = day.name;
  box.querySelector('.pe-day-name').oninput = e => { day.name = e.target.value; };
  box.querySelector('.pe-day-pair').value = day.pair || '';
  box.querySelector('.pe-day-pair').oninput = e => { day.pair = e.target.value; };

  const up = box.querySelector('.d-up'), down = box.querySelector('.d-down'), del = box.querySelector('.d-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(draftBlock.days, day, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(draftBlock.days, day, 1); renderPlanEditor(); };
  del.onclick = () => {
    if (logged) {
      if (!confirm('"' + day.name + '" tiene ' + setsLabel(logged) + ' en este bloque.\n\nSe retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.')) return;
      day.off = 1;
    } else {
      if (!confirm('¿Quitar "' + day.name + '" del bloque? No tiene nada registrado.')) return;
      draftBlock.days.splice(draftBlock.days.indexOf(day), 1);
    }
    renderPlanEditor();
  };

  const exlist = box.querySelector('.pe-exlist');
  const liveEx = exList(day);
  liveEx.forEach((ex, i) => exlist.appendChild(buildExRow(profile, day, ex, i, liveEx.length)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pe-add-ex';
  addBtn.textContent = '+ Añadir ejercicio';
  addBtn.onclick = () => { day.ex.push(newExercise()); renderPlanEditor(); };
  box.appendChild(addBtn);
  return box;
}

function renderRetired(host, profile) {
  const items = [];
  draftBlock.days.forEach(day => {
    if (day.off) { items.push({ day }); return; }
    day.ex.forEach(ex => { if (ex.off) items.push({ day, ex }); });
  });
  if (!items.length) return;

  const box = document.createElement('div');
  box.className = 'pe-retired';
  box.innerHTML =
    '<div class="pe-bar"><span class="pe-bar-n">Retirados</span></div>' +
    '<p class="pe-retired-d">Fuera del plan, con su registro intacto. Al restaurarlos vuelven con todo lo que tenían anotado.</p>';

  items.forEach(it => {
    const isDay = !it.ex;
    const logged = isDay ? loggedSetsDay(profile, draftBlock.id, it.day)
                         : loggedSets(profile, draftBlock.id, it.day.id, it.ex.id);
    const row = document.createElement('div');
    row.className = 'pe-arch';
    row.innerHTML =
      '<span class="pe-arch-l"><b></b><i></i></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn a-back">Restaurar</button>' +
        '<button type="button" class="pe-icon-btn danger a-del">' + (logged ? 'Borrar registro' : 'Borrar') + '</button>' +
      '</span>';
    row.querySelector('b').textContent = isDay ? ('Día · ' + it.day.name) : (it.ex.n || 'Ejercicio sin nombre');
    row.querySelector('i').textContent = (isDay ? '' : it.day.name + ' · ') + (logged ? setsLabel(logged) : 'sin registro');
    row.querySelector('.a-back').onclick = () => {
      if (isDay) delete it.day.off; else delete it.ex.off;
      renderPlanEditor();
    };
    row.querySelector('.a-del').onclick = () => {
      const what = isDay ? ('el día "' + it.day.name + '"') : ('"' + (it.ex.n || 'este ejercicio') + '"');
      const msg = logged
        ? '¿Borrar ' + what + ' y sus ' + setsLabel(logged) + ' definitivamente? No se puede deshacer.'
        : '¿Borrar ' + what + ' del bloque? No tiene nada registrado.';
      if (!confirm(msg)) return;
      if (isDay) {
        draftBlock.days.splice(draftBlock.days.indexOf(it.day), 1);
        draftPurge.push({ dayId: it.day.id });
      } else {
        it.day.ex.splice(it.day.ex.indexOf(it.ex), 1);
        draftPurge.push({ dayId: it.day.id, exId: it.ex.id });
      }
      renderPlanEditor();
    };
    box.appendChild(row);
  });

  host.appendChild(box);
}

function buildExRow(profile, day, ex, pos, liveCount) {
  const row = document.createElement('div');
  row.className = 'pe-ex';
  row.innerHTML =
    '<div class="pe-bar">' +
      '<span class="pe-bar-n">' + (pos + 1) + '</span>' +
      '<span class="pe-log-tag"></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn e-up" title="Subir ejercicio">↑</button>' +
        '<button type="button" class="pe-icon-btn e-down" title="Bajar ejercicio">↓</button>' +
        '<button type="button" class="pe-icon-btn danger e-del">Quitar</button>' +
      '</span>' +
    '</div>' +
    '<div class="pe-row">' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Ejercicio</span><input type="text" class="f-n"></div>' +
    '</div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Alternativa</span><input type="text" class="f-alt"></div></div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Nota / cue</span><input type="text" class="f-cue"></div></div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">Series</span><input type="number" min="1" class="f-sets"></div>' +
      '<div style="flex:1;min-width:70px;"><span class="pe-field-lbl">Reps</span><input type="text" class="f-reps"></div>' +
      '<div><span class="pe-field-lbl">Descanso (s)</span><input type="number" min="0" step="5" class="f-rest"></div>' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="8" class="f-add"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<label class="pe-check"><input type="checkbox" class="f-share"> Compartido (JUNTOS)</label>' +
      '<label class="pe-check"><input type="checkbox" class="f-ss"> Superserie (SS)</label>' +
    '</div>';

  row.querySelector('.f-n').value = ex.n;
  row.querySelector('.f-n').oninput = e => ex.n = e.target.value;
  row.querySelector('.f-alt').value = ex.alt || '';
  row.querySelector('.f-alt').oninput = e => ex.alt = e.target.value;
  row.querySelector('.f-cue').value = ex.cue || '';
  row.querySelector('.f-cue').oninput = e => ex.cue = e.target.value;
  row.querySelector('.f-sets').value = ex.sets;
  row.querySelector('.f-sets').oninput = e => ex.sets = parseInt(e.target.value, 10) || 1;
  row.querySelector('.f-reps').value = ex.reps;
  row.querySelector('.f-reps').oninput = e => ex.reps = e.target.value;
  row.querySelector('.f-rest').value = ex.rest || 0;
  row.querySelector('.f-rest').oninput = e => ex.rest = parseInt(e.target.value, 10) || 0;
  row.querySelector('.f-add').value = ex.add || '';
  row.querySelector('.f-add').oninput = e => { const v = parseInt(e.target.value, 10); if (v) ex.add = v; else delete ex.add; };
  row.querySelector('.f-share').checked = !!ex.share;
  row.querySelector('.f-share').onchange = e => { if (e.target.checked) ex.share = 1; else delete ex.share; };
  row.querySelector('.f-ss').checked = !!ex.ss;
  row.querySelector('.f-ss').onchange = e => { if (e.target.checked) ex.ss = 1; else delete ex.ss; };

  const logged = loggedSets(profile, draftBlock.id, day.id, ex.id);
  if (logged) row.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  const up = row.querySelector('.e-up'), down = row.querySelector('.e-down'), del = row.querySelector('.e-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(day.ex, ex, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(day.ex, ex, 1); renderPlanEditor(); };
  del.onclick = () => {
    if (logged) {
      if (!confirm('"' + (ex.n || 'Este ejercicio') + '" tiene ' + setsLabel(logged) + ' en este bloque.\n\nSe retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.')) return;
      ex.off = 1;
    } else {
      day.ex.splice(day.ex.indexOf(ex), 1);
    }
    renderPlanEditor();
  };

  return row;
}

$('peSave').onclick = () => {
  draftBlock.name = $('peBlockName').value.trim() || draftBlock.name;
  const days = dayList(draftBlock);
  if (!days.length) { alert('El bloque necesita al menos un día.'); return; }
  days.forEach((day, i) => { if (!String(day.name || '').trim()) day.name = 'Día ' + (i + 1); });
  for (const day of days) {
    const ex = exList(day);
    if (!ex.length) { alert('Cada día necesita al menos un ejercicio — revisa "' + day.name + '".'); return; }
    for (const e of ex) {
      if (!String(e.n || '').trim()) { alert('Todos los ejercicios necesitan un nombre.'); return; }
      if (!e.reps || !String(e.reps).trim()) { alert('Falta el rango de repeticiones en "' + (e.n || 'un ejercicio') + '".'); return; }
    }
  }
  const profile = getProfile();
  /* The only path that erases logged sets, and only the ones explicitly
     confirmed in "Retirados". */
  draftPurge.forEach(p => {
    if (p.exId) purgeExLog(profile, draftBlock.id, p.dayId, p.exId);
    else purgeDayLog(profile, draftBlock.id, p.dayId);
  });
  profile.blocks[draftBlock.id] = draftBlock;
  draftBlock = null; draftPurge = [];
  save(); render();
  closeSheet('planSheet');
  mark('Plan actualizado — el registro se mantiene');
};

function closePlanEditor() {
  closeSheet('planSheet');
  draftBlock = null;
  draftPurge = [];
}

$('peClose').onclick = closePlanEditor;
$('planSheet').addEventListener('click', e => { if (e.target.id === 'planSheet') closePlanEditor(); });

$('peDeleteBlock').onclick = () => {
  const profile = getProfile();
  if (profile.blockOrder.length <= 1) { alert('No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
  const id = draftBlock.id;
  const sets = blockLoggedSets(profile, id);
  const msg = '¿Eliminar "' + draftBlock.name + '"?\n\n' +
    (sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ') +
    'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.\n\nNo se puede deshacer.';
  if (!confirm(msg)) return;
  closePlanEditor();
  deleteBlocks(profile, [id]);
  mark('Bloque eliminado');
};

/* ---------- progress chart ---------- */
function collectHistory(profile, blockId, dayId, exId) {
  const points = [];
  for (let w = 1; w <= 8; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    const rows = s && s[exId];
    if (!rows) continue;
    const done = rows.filter(r => r.done && r.w !== '' && r.w != null && !isNaN(num(r.w)));
    if (!done.length) continue;
    let best = done[0];
    done.forEach(r => { if (num(r.w) > num(best.w)) best = r; });
    points.push({ week: w, weight: num(best.w), reps: best.r });
  }
  return points;
}

function buildChartSVG(points) {
  const W = 600, H = 220, padL = 40, padR = 16, padT = 16, padB = 28;
  const weights = points.map(p => p.weight);
  let min = Math.min(...weights), max = Math.max(...weights);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = w => padL + ((w - 1) / 7) * (W - padL - padR);
  const y = v => H - padB - ((v - min) / (max - min)) * (H - padT - padB);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;">';

  // gridlines + x labels for weeks 1-8
  for (let w = 1; w <= 8; w++) {
    svg += '<line x1="' + x(w) + '" y1="' + padT + '" x2="' + x(w) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>';
    svg += '<text x="' + x(w) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="var(--soft)" font-family="IBM Plex Mono, monospace">S' + w + '</text>';
  }
  // y labels
  svg += '<text x="4" y="' + (y(max - pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(max - pad) + '</text>';
  svg += '<text x="4" y="' + (y(min + pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(min + pad) + '</text>';

  if (points.length) {
    const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.week) + ' ' + y(p.weight)).join(' ');
    svg += '<path d="' + path + '" fill="none" stroke="var(--signal)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    points.forEach(p => {
      svg += '<circle cx="' + x(p.week) + '" cy="' + y(p.weight) + '" r="4" fill="var(--signal)"/>';
    });
  }
  svg += '</svg>';
  return svg;
}

function openChart(ex, dayId) {
  const profile = getProfile(), block = getBlock();
  const points = collectHistory(profile, block.id, dayId, ex.id);
  $('chartTitle').textContent = ex.n;
  $('chartSub').textContent = block.name + ' — mejor peso registrado por semana (× repeticiones de esa serie).';
  const host = $('chartHost');
  if (!points.length) {
    host.innerHTML = '<p style="font-size:12px;color:var(--soft);padding:20px 4px;">Aún no hay series completadas con peso para este ejercicio en este bloque.</p>';
  } else {
    let html = buildChartSVG(points);
    html += '<table class="chart-table"><thead><tr><th>Semana</th><th>Peso</th><th>Reps</th></tr></thead><tbody>';
    points.forEach(p => { html += '<tr><td>Semana ' + p.week + '</td><td>' + p.weight + ' kg</td><td>' + esc(p.reps || '—') + '</td></tr>'; });
    html += '</tbody></table>';
    host.innerHTML = html;
  }
  openSheet('chartSheet');
}

$('chartClose').onclick = () => closeSheet('chartSheet');
$('chartSheet').addEventListener('click', e => { if (e.target.id === 'chartSheet') closeSheet('chartSheet'); });

/* ---------- backup / restore ---------- */
$('backup').onclick = () => {
  $('blob').value = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state });
  openSheet('sheet');
};
$('bClose').onclick = () => closeSheet('sheet');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet('sheet'); });

$('bDownload').onclick = () => {
  const payload = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
  downloadFile('heavy-iron-backup-' + new Date().toISOString().slice(0, 10) + '.json', payload, 'application/json');
  mark('Copia descargada — ' + setsLabel(countBackupSets(state)));
};

$('bUploadBtn').onclick = () => $('bUpload').click();
$('bUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => restoreFromText(reader.result);
  reader.readAsText(file);
  e.target.value = '';
});

$('bCopy').onclick = async () => {
  const ta = $('blob');
  ta.focus(); ta.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ta.value);
    else if (!document.execCommand('copy')) throw new Error();
    mark('Copiado al portapapeles');
  } catch (e) {
    mark('No se pudo copiar — selecciona el texto y cópialo a mano', true);
  }
};

$('bRestore').onclick = () => restoreFromText($('blob').value);

/* A restore replaces everything, so a file that is *almost* a backup is the
   most dangerous input the app takes: accepting it wipes real history and
   leaves something the app may not be able to draw. Checked before anything
   is touched, and the reason is reported rather than a generic "no vale". */
function describeBackupProblem(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'no contiene un objeto de datos';
  if (!data.profiles || typeof data.profiles !== 'object') return 'no tiene perfiles';
  for (const pk of ['hombre', 'mujer']) {
    const p = data.profiles[pk];
    if (!p || typeof p !== 'object') return 'le falta el perfil "' + pk + '"';
    if (!p.blocks || typeof p.blocks !== 'object' || !Object.keys(p.blocks).length) return 'el perfil "' + pk + '" no tiene bloques';
    if (p.log && typeof p.log !== 'object') return 'el registro del perfil "' + pk + '" está corrupto';
    for (const bk of Object.keys(p.blocks)) {
      const b = p.blocks[bk];
      if (!b || typeof b !== 'object') return 'el bloque "' + bk + '" de "' + pk + '" está corrupto';
      if (!Array.isArray(b.days)) return 'el bloque "' + (b.name || bk) + '" de "' + pk + '" no tiene días';
    }
  }
  return null;
}

function countBackupSets(data) {
  let n = 0;
  Object.keys(data.profiles).forEach(pk => {
    const log = data.profiles[pk].log;
    if (!log || typeof log !== 'object') return;
    Object.keys(log).forEach(bId => {
      const blk = log[bId];
      if (!blk || typeof blk !== 'object') return;
      Object.keys(blk).forEach(k => {
        const s = blk[k];
        if (!s || typeof s !== 'object') return;
        Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
      });
    });
  });
  return n;
}

function restoreFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese texto no es una copia válida', true); return; }
  const data = parsed && parsed.data ? parsed.data : parsed;

  const problem = describeBackupProblem(data);
  if (problem) { mark('Esa copia no se puede usar: ' + problem, true); return; }

  const mine = countBackupSets(state);
  const theirs = countBackupSets(data);
  const when = parsed && parsed.saved ? new Date(parsed.saved) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  const msg = '¿Reemplazar TODO tu registro con esta copia?\n\n' +
    'Copia' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
    'Ahora mismo tienes: ' + setsLabel(mine) + '.\n\n' +
    (theirs < mine ? 'La copia tiene MENOS registro que lo que hay ahora — comprueba que es la que quieres.\n\n' : '') +
    'No se puede deshacer.';
  if (!confirm(msg)) return;

  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  migrate();
  applyTheme();
  save(); render();
  closeSheet('sheet');
  mark('Registro restaurado — ' + setsLabel(theirs));
}

/* ---------- offline ----------
   A gym basement with no signal is the normal case, not the edge case, so
   the app installs itself and serves from cache. Updates are never applied
   under you mid-session: a new version waits until you say so, and the
   pending write is flushed before the reload that picks it up. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;

  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Hay una versión nueva de la app.', 'Actualizar', () => sw.postMessage('skipWaiting'));
        }
      });
    });
  }).catch(() => { /* offline on first load, or opened from file:// — the app still runs */ });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    flushSave();
    location.reload();
  });
}

/* ---------- CSV export ----------
   One row per logged set, for looking at the numbers somewhere the app
   cannot: a spreadsheet, a chart, a coach's inbox. Deliberately one-way —
   the .json is what restores, and mixing the two up loses data. */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv() {
  const rows = [['perfil', 'bloque', 'semana', 'dia', 'ejercicio', 'serie', 'kg', 'reps', 'hecha', 'fecha']];
  Object.keys(state.profiles).forEach(pk => {
    const profile = state.profiles[pk];
    profile.blockOrder.forEach(bId => {
      const block = profile.blocks[bId];
      block.days.forEach(day => {
        day.ex.forEach(ex => {
          for (let w = 1; w <= 8; w++) {
            const s = profile.log[bId] && profile.log[bId][slot(w, day.id)];
            const arr = s && s[ex.id];
            if (!Array.isArray(arr)) continue;
            arr.forEach((r, i) => {
              if (!rowUsed(r)) return;
              rows.push([profile.label, block.name, w, day.name, ex.n, i + 1, r.w, r.r,
                         r.done ? 'si' : 'no', r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '']);
            });
          }
        });
      });
    });
  });
  /* The BOM is what makes Excel open a UTF-8 CSV without mangling accents. */
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

$('bCsv').onclick = () => {
  const csv = buildCsv();
  const lines = csv.split('\r\n').length - 1;
  if (!lines) { mark('No hay ninguna serie registrada todavía', true); return; }
  downloadFile('heavy-iron-series-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
  mark(lines === 1 ? '1 serie exportada' : lines + ' series exportadas');
};

load();
registerServiceWorker();
