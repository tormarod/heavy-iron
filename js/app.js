const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
/* Exercise ids whose "Ajustes" (machine setup) box is expanded right now —
   in-memory only, so every fresh open of the app starts collapsed again. */
const expandedSetup = new Set();
/* Set by the ↓ button so the render it triggers can put the cursor straight
   into the weight box of the drop it just created — the same trick the
   "Ajustes" box uses, but for a field that does not exist until the render
   after the click. Cleared as soon as it is honoured. */
let focusDrop = '';
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

/* clampInt rounds to a whole number, which is wrong for anything measured in
   weight — 2.3 is a real plate increment, not a mistake to round away. This
   rounds to the nearest `step` instead (a "step floor": nothing finer than
   that grain survives), then clamps, then fixes floating-point noise like
   20.1 + 2.5 = 22.599999999999998 back to two decimals. `num()` first, so a
   comma-decimal typed on a Spanish keyboard works here too. */
const clampNum = (v, lo, hi, dflt, step) => {
  const n = num(v);
  if (!isFinite(n)) return dflt;
  const stepped = step > 0 ? Math.round(n / step) * step : n;
  const clamped = Math.min(hi, Math.max(lo, stepped));
  return Math.round(clamped * 100) / 100;
};

/* `ex.inc` — the weight step double progression adds once every set hit the
   top of the rep range last week (see copyPrev). Bounded to something a
   plate stack could actually add: quarter-unit granularity, nothing under
   a plate change and nothing past a round-trip's worth of iron. */
const INC_MIN = 0.25, INC_MAX = 50, INC_STEP = 0.25;

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
  const firstRun = raw == null;
  try {
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.profiles) state = defaultState();
  if (firstRun) state.setupDone = false;
  migrate();
  ready = true;
  applyTheme();
  render();
  /* Write straight back: on a first run that persists the starting plan, and
     on a later one it persists whatever migrate() had to repair, so the same
     repair does not have to be redone on every open. */
  save();
  mark('Cargado');
  if (!state.setupDone) openSetup(true);
}

/* exercise.muscle/pattern/type are plain, freeform, trimmed strings (or
   absent) — not an enforced enum. Whoever tags a block — by hand in the
   plan editor, or in an imported JSON — defines their own taxonomy, and the
   volume dashboard just draws a bar for whatever labels are actually
   present. The *_SUGGESTIONS lists are only the autocomplete offered while
   typing (and what the built-in plans use), never a validated set.
   UNCLASSIFIED_LABEL is the one label the app assigns itself, for an
   exercise nobody has tagged at all on a given dimension — never written to
   storage, the same way `share`/`ss` are only stored when true.

   `muscle` answers "what does this hit" — an anatomical grouping, by the
   muscle the exercise is actually there to grow (MUSCLE_SUGGESTIONS below
   is a list of muscles, not equipment or movements). `pattern` and `type`
   answer a different question, "what shape is this movement" — a
   horizontal push, a knee-dominant squat, an isolation move — from an
   orthogonal angle that has nothing to do with anatomy. A plan can look
   balanced by muscle and still be thin on compound pressing, or have most
   of its volume parked in isolation work; `pattern`/`type` are what let the
   volume dashboard show that, which no muscle tag can. */
const MUSCLE_SUGGESTIONS = ['Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps', 'Cuádriceps', 'Isquios', 'Glúteo', 'Gemelos', 'Core'];
const PATTERN_SUGGESTIONS = ['Empuje horizontal', 'Empuje vertical', 'Tirón horizontal', 'Tirón vertical', 'Rodilla dominante', 'Cadera dominante'];
const TYPE_SUGGESTIONS = ['Compuesto', 'Aislamiento'];
const UNCLASSIFIED_LABEL = 'Sin clasificar';
const MUSCLE_LIMIT = 40;
const PATTERN_LIMIT = 40;
const TYPE_LIMIT = 40;
/* `ex.setup` — seat height, pin position, the stuff you discover at the
   machine and that barely changes week to week. A real field for it, so it
   stops getting written into `cue` (which is for technique reminders and
   shows on every set, not settings you check once and forget). Shown
   collapsed in the session and editable inline there — see the .ex-setup
   render in drawApp. */
const SETUP_LIMIT = 200;
$('muscleSuggestions').innerHTML = MUSCLE_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');
$('patternSuggestions').innerHTML = PATTERN_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');
$('typeSuggestions').innerHTML = TYPE_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');

/* Every exercise id the two built-in plans ship with, mapped to its muscle
   tag. The grouping is anatomical — which muscle the exercise is actually
   there to grow (hack squat and leg press both go to Cuádriceps, RDL and leg
   curl both go to Isquios) — not by equipment or by movement pattern, which
   is what `pattern`/`type` are for instead. Shoulder press is deliberately
   absent: the README's own volume breakdown folds front-delt work into press
   volume rather than tracking it as its own line, and leaving it out of this
   table reproduces that exactly — it shows up as unclassified in the
   dashboard, same as a genuinely untagged custom exercise. Applied once in
   migrate() to backfill data saved before this field existed; js/data.js and
   the bundled block JSON files carry the same tags directly, so a fresh
   install never needs the backfill. */
const MUSCLE_BY_ID = {
  chestpress: 'Pecho', inclinepress: 'Pecho', pecdeck: 'Pecho', cablepress: 'Pecho',
  pulldown_w: 'Espalda', pulldown_n: 'Espalda', pulldown: 'Espalda', csrow: 'Espalda', cablerow: 'Espalda',
  lat1: 'Hombro', lat2: 'Hombro', facepull: 'Hombro', reardelt: 'Hombro',
  cablecurl: 'Bíceps', hammer: 'Bíceps', inclinecurl: 'Bíceps',
  pushdown: 'Tríceps', ohext: 'Tríceps',
  hacksquat: 'Cuádriceps', legpress: 'Cuádriceps', legext: 'Cuádriceps',
  rdl: 'Isquios', legcurl: 'Isquios',
  hipthrust: 'Glúteo', kickback: 'Glúteo', abduction: 'Glúteo',
  calfstand: 'Gemelos',
  abs: 'Core',
};

/* Runs on every load, and on every restore. Two jobs: give old data the
   shape the current app expects, and put back anything that is missing or
   contradictory. The second one matters more than it sounds — a block id in
   `blockOrder` that no longer exists, or a block with no `phase`, used to be
   a blank white screen with no way back to your history. Repairing on the
   way in means the app opens even when the data is half broken. */
function migrate() {
  const fallback = defaultState();
  if (!state.profiles || typeof state.profiles !== 'object' || !Object.keys(state.profiles).length) {
    state.profiles = fallback.profiles;
  }

  /* Repair the profiles that are here, rather than the two the seed happens
     to define. Iterating the seed used to resurrect a deleted profile —
     complete with a stranger's training plan — every time the app opened. */
  Object.keys(state.profiles).forEach((pk, i) => {
    if (!state.profiles[pk] || typeof state.profiles[pk] !== 'object') delete state.profiles[pk];
    const profile = state.profiles[pk];
    if (!profile) return;
    const seed = fallback.profiles[pk] || fallback.profiles[Object.keys(fallback.profiles)[i]] || fallback.profiles.hombre;

    if (!profile.label) profile.label = seed.label;
    if (!profile.theme) profile.theme = seed.theme;
    if (!profile.log || typeof profile.log !== 'object') profile.log = {};
    if (!profile.rir || typeof profile.rir !== 'object') profile.rir = {};
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

    profile.week = clampInt(profile.week, 1, MAX_WEEKS, 1);
    profile.day = clampInt(profile.day, 0, 99, 0);

    Object.keys(profile.blocks).forEach(bk => {
      const block = profile.blocks[bk];
      if (!block.id) block.id = bk;
      if (!block.name) block.name = 'Bloque';
      /* Blocks saved before length was configurable are exactly what the app
         used to assume: eight weeks, the eighth halved. */
      block.weeks = clampInt(block.weeks, 1, MAX_WEEKS, 8);
      if (block.deload == null) block.deload = block.weeks === 8 ? 8 : 0;
      block.deload = clampInt(block.deload, 0, MAX_WEEKS, 0);
      if (block.deload > block.weeks) block.deload = 0;
      if (!block.phase || typeof block.phase !== 'object') block.phase = genericPhase(block.weeks, block.deload);
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
          if (!ex.muscle) { if (MUSCLE_BY_ID[ex.id]) ex.muscle = MUSCLE_BY_ID[ex.id]; }
          else { const m = txt(ex.muscle, MUSCLE_LIMIT); if (m) ex.muscle = m; else delete ex.muscle; }
          if (ex.pattern != null) { const p = txt(ex.pattern, PATTERN_LIMIT); if (p) ex.pattern = p; else delete ex.pattern; }
          if (ex.type != null) { const t = txt(ex.type, TYPE_LIMIT); if (t) ex.type = t; else delete ex.type; }
          if (ex.inc != null) { const v = clampNum(ex.inc, INC_MIN, INC_MAX, 0, INC_STEP); if (v > 0) ex.inc = v; else delete ex.inc; }
          if (ex.setup != null) { const s = txt(ex.setup, SETUP_LIMIT); if (s) ex.setup = s; else delete ex.setup; }
        });
      });
    });
  });

  /* Whatever happened above, the app cannot draw with no profile at all. */
  if (!Object.keys(state.profiles).length) state.profiles = fallback.profiles;
  if (!state.profiles[state.activeProfile]) state.activeProfile = profileKeys()[0];
  if (!state.prefs || typeof state.prefs !== 'object') state.prefs = {};
  if (['auto', 'light', 'dark'].indexOf(state.prefs.theme) < 0) state.prefs.theme = 'auto';
  state.prefs.sound = !!state.prefs.sound;
  /* A label, never a conversion: you write down the number on the machine,
     and this is what the app calls it. */
  if (['kg', 'lb'].indexOf(state.prefs.units) < 0) state.prefs.units = 'kg';
  /* Calculator defaults, seeded once from whatever unit is active at the
     time — like everything else under units(), never rescaled later, so
     switching kg/lb afterwards does not silently reinterpret a saved bar
     or plate set. */
  if (!(num(state.prefs.barWeight) > 0)) state.prefs.barWeight = DEFAULT_BAR_WEIGHT[state.prefs.units];
  else state.prefs.barWeight = num(state.prefs.barWeight);
  if (!Array.isArray(state.prefs.plates) || !state.prefs.plates.length) {
    state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  } else {
    state.prefs.plates = state.prefs.plates.map(num).filter(p => p > 0);
    if (!state.prefs.plates.length) state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  }
  if (['pair', 'solo'].indexOf(state.mode) < 0) state.mode = 'pair';
  if (typeof state.setupDone !== 'boolean') state.setupDone = true;
  /* How many sessions have been completed since the last time data actually
     left the device (a backup download/copy, a profile export, a QR profile
     share) — see maybeNagBackup(). Reset to 0 by any of those. */
  state.prefs.sessionsSinceBackup = clampInt(state.prefs.sessionsSinceBackup, 0, 100000, 0);
}

const profileKeys = () => Object.keys(state.profiles);

/* A block used to be exactly eight weeks with the eighth halved as a deload,
   and that was written into every loop, the week bar and the chart's x-axis.
   Now the block says how long it is and which week (if any) is the deload;
   blocks saved before this default to 8 and 8, so nothing already logged
   moves. */
const MAX_WEEKS = 16;
const blockWeeks = block => clampInt(block && block.weeks, 1, MAX_WEEKS, 8);
const deloadWeek = block => {
  const w = clampInt(block && block.deload, 0, MAX_WEEKS, 0);
  return w >= 1 && w <= blockWeeks(block) ? w : 0;  /* 0 = no deload week */
};

/* In solo mode the second profile stays in storage untouched — hidden, not
   deleted — so switching back to two people is instant and a backup taken
   either way restores either way. */
const soloMode = () => state.mode === 'solo';
const visibleProfileKeys = () => (soloMode() ? [state.activeProfile] : profileKeys());
const units = () => state.prefs.units;

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

/* Inline feedback inside a sheet: the footer #status mark() writes to sits
   behind the full-screen sheet overlay, so a result reported through it is
   invisible until the sheet closes. Used for actions (like the block-JSON
   download/copy buttons) that are meant to be usable without closing
   whatever sheet they're in. */
function setNote(el, text, err) {
  el.textContent = text;
  el.classList.toggle('err', !!err);
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

/* ---------- undo ----------
   Every destructive action asks first, but "yes" used to be the end of it.
   One snapshot of the whole state costs a stringify of something already
   small, and covers the misfire that actually happens: the wrong day, the
   wrong profile, the wrong block. Offered through the toast, and dropped as
   soon as the next one replaces it. */
let undoSnapshot = null;

function snapshotForUndo(what) {
  try {
    undoSnapshot = JSON.stringify(state);
  } catch (e) {
    undoSnapshot = null;
    return;
  }
  toast(what, 'Deshacer', undoLast);
}

function undoLast() {
  if (!undoSnapshot) return;
  let restored;
  try { restored = JSON.parse(undoSnapshot); } catch (e) { return; }
  undoSnapshot = null;
  state = restored;
  migrate();
  applyTheme();
  save();
  render();
  mark('Deshecho');
}

/* ---------- dialogs ----------
   The app used to lean on window.confirm/alert/prompt. They block the whole
   page, cannot be styled, ignore the dark theme, and — the reason this
   mattered enough to change — an installed PWA is exactly the context
   browsers are most willing to suppress `prompt` in, which would have made
   "+ Nuevo bloque" do nothing at all with no error.

   These return a promise so the call sites read the same way they did:
   `if (!await ask(...)) return;`. Only one can be open at a time, which is
   already true of the confirm() they replace. */
let askResolve = null;

function closeAsk(value) {
  const done = askResolve;
  askResolve = null;
  $('askSheet').classList.remove('up');
  if (sheetReturn && sheetReturn.focus) sheetReturn.focus();
  sheetReturn = null;
  if (done) done(value);
}

function openAsk(opts) {
  /* A second dialog while one is open would strand the first promise. */
  if (askResolve) closeAsk(opts.textInput ? null : false);

  $('askT').textContent = opts.title || '';
  $('askBody').textContent = opts.body || '';
  $('askBody').style.display = opts.body ? '' : 'none';
  $('askOk').textContent = opts.okLabel || 'Aceptar';
  $('askOk').className = 'sm ' + (opts.danger ? 'warn' : 'key');
  $('askCancel').style.display = opts.okOnly ? 'none' : '';
  $('askCancel').textContent = opts.cancelLabel || 'Cancelar';

  const input = $('askInput');
  input.style.display = opts.textInput ? '' : 'none';
  if (opts.textInput) {
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    input.setAttribute('aria-label', opts.title || 'Valor');
  }

  sheetReturn = document.activeElement;
  $('askSheet').classList.add('up');
  const focusTarget = opts.textInput ? input : $('askOk');
  focusTarget.focus();
  if (opts.textInput) input.select();

  return new Promise(resolve => { askResolve = resolve; });
}

/* Yes/no. Resolves true only if the confirming button was pressed. */
const ask = opts => openAsk(opts).then(v => v === true);

/* A message with nothing to decide — the old alert(). */
const tell = (title, body) => openAsk({ title, body, okLabel: 'Entendido', okOnly: true }).then(() => undefined);

/* One line of text, or null if cancelled — the old prompt(). */
const askText = opts => openAsk(Object.assign({ textInput: true, okLabel: 'Crear' }, opts))
  .then(v => (typeof v === 'string' ? v : null));

$('askOk').onclick = () => {
  const input = $('askInput');
  closeAsk(input.style.display === 'none' ? true : input.value);
};
$('askCancel').onclick = () => closeAsk($('askInput').style.display === 'none' ? false : null);
$('askSheet').addEventListener('click', e => {
  if (e.target.id === 'askSheet') closeAsk($('askInput').style.display === 'none' ? false : null);
});
$('askInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); closeAsk($('askInput').value); }
});

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

/* ---------- first-run setup / settings ----------
   The app used to open on somebody else's training plan, under somebody
   else's names, measured in somebody else's units, with no way to change
   any of it short of the plan editor. This is the thirty seconds that makes
   it yours. It is offered once, on a device with no saved data, and lives
   under "Ajustes" forever after — where the starting-plan question is
   hidden, because by then that is what blocks are for. */
const ACCENTS = ['azul', 'verde'];
const ACCENT_LABEL = { azul: 'Azul', verde: 'Verde' };
/* What the two shipped profiles' accents were called before accents had
   names of their own. */
const LEGACY_ACCENT = { hombre: 'azul', mujer: 'verde' };

let setupDraft = null;
let setupFirstRun = false;

function accentOf(profile) {
  return LEGACY_ACCENT[profile.theme] || (ACCENTS.indexOf(profile.theme) >= 0 ? profile.theme : 'azul');
}

function openSetup(firstRun) {
  setupFirstRun = !!firstRun;
  setupDraft = {
    mode: state.mode,
    units: state.prefs.units,
    plan: 'example',
    barWeight: state.prefs.barWeight,
    platesText: state.prefs.plates.join(', '),
    /* On a first run the name boxes start empty, so the placeholder invites
       you to type rather than making you clear somebody else's name out
       first. Left empty, the shipped label stands. */
    people: profileKeys().map(key => ({
      key,
      label: firstRun ? '' : state.profiles[key].label,
      accent: accentOf(state.profiles[key]),
    })),
  };

  $('setupT').textContent = firstRun ? 'Bienvenido a Heavy Iron' : 'Ajustes';
  $('setupD').textContent = firstRun
    ? 'Treinta segundos y el registro es tuyo. Todo esto se puede cambiar después en "Ajustes".'
    : 'Cambia los nombres, el color de cada perfil y la unidad de peso. No toca nada de lo que ya tienes registrado.';
  $('setupSave').textContent = firstRun ? 'Empezar' : 'Guardar';
  $('setupClose').textContent = firstRun ? 'Saltar' : 'Cerrar sin guardar';
  $('setupPlanField').style.display = firstRun ? '' : 'none';
  $('setupCalcField').style.display = firstRun ? 'none' : '';
  $('setupBarWeight').value = setupDraft.barWeight;
  $('setupPlates').value = setupDraft.platesText;
  $('setupImportBlob').value = '';
  setNote($('setupImportStatus'), '', false);

  renderSetup();
  openSheet('setupSheet');
}

function renderSetup() {
  const solo = setupDraft.mode === 'solo';

  $('setupMode').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === setupDraft.mode ? 'true' : 'false');
    b.onclick = () => { setupDraft.mode = b.dataset.mode; renderSetup(); };
  });
  $('setupUnits').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.units === setupDraft.units ? 'true' : 'false');
    b.onclick = () => { setupDraft.units = b.dataset.units; renderSetup(); };
  });
  $('setupBarWeightU').textContent = setupDraft.units;
  $('setupPlan').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.plan === setupDraft.plan ? 'true' : 'false');
    b.onclick = () => { setupDraft.plan = b.dataset.plan; renderSetup(); };
  });
  $('setupPlanHint').textContent = setupDraft.plan === 'empty'
    ? 'Un bloque con un día y un ejercicio vacío, para montar el tuyo desde cero en "Editar plan".'
    : setupDraft.plan === 'import'
      ? 'Pega el bloque que te haya devuelto tu IA (o cualquier otro JSON válido) aquí abajo.'
      : solo
        ? 'Un bloque de 8 semanas ya montado. Está pensado para dos personas, así que trae notas de sesión compartida que no verás en modo individual. Sirve para probar la app; edítalo o bórralo cuando quieras.'
        : 'Un bloque de 8 semanas ya montado, pensado para dos personas que comparten máquinas. Sirve para ver cómo funciona la app; edítalo o bórralo cuando quieras.';
  $('setupImportField').style.display = setupDraft.plan === 'import' ? '' : 'none';

  /* In solo mode only the first name is asked for — the second profile is
     still there, just not yours to worry about. */
  $('setupNamesLbl').textContent = solo ? 'Tu nombre' : 'Nombres';
  const host = $('setupNames');
  host.innerHTML = '';
  setupDraft.people.slice(0, solo ? 1 : setupDraft.people.length).forEach((person, i) => {
    const row = document.createElement('div');
    row.className = 'setup-name';
    row.innerHTML = '<input type="text" maxlength="24" autocomplete="off"><span class="swatches"></span>';
    const input = row.querySelector('input');
    input.value = person.label;
    input.placeholder = solo ? 'Tu nombre' : (i === 0 ? 'Primera persona' : 'Segunda persona');
    input.setAttribute('aria-label', solo ? 'Tu nombre' : 'Nombre de la persona ' + (i + 1));
    input.oninput = e => { person.label = e.target.value; };

    const sw = row.querySelector('.swatches');
    ACCENTS.forEach(accent => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch ' + accent;
      b.setAttribute('aria-pressed', person.accent === accent ? 'true' : 'false');
      b.setAttribute('aria-label', 'Color ' + ACCENT_LABEL[accent] + ' para este perfil');
      b.title = ACCENT_LABEL[accent];
      b.onclick = () => { person.accent = accent; renderSetup(); };
      sw.appendChild(b);
    });
    host.appendChild(row);
  });
}

$('setupBarWeight').addEventListener('input', e => { if (setupDraft) setupDraft.barWeight = e.target.value; });
$('setupPlates').addEventListener('input', e => { if (setupDraft) setupDraft.platesText = e.target.value; });

$('setupSave').onclick = () => {
  /* Validated before anything else is touched: an invalid paste has to
     leave the sheet exactly as it was, with nothing half-applied, so the
     person can fix it and try again. */
  let importedNormalized = null;
  if (setupFirstRun && setupDraft.plan === 'import') {
    let raw;
    try { raw = JSON.parse($('setupImportBlob').value); }
    catch (e) { setNote($('setupImportStatus'), 'Eso no es JSON válido.', true); return; }
    try { importedNormalized = normalizeImportedBlock(raw); }
    catch (e) { setNote($('setupImportStatus'), e.message, true); return; }
  }

  setupDraft.people.forEach((person, i) => {
    const profile = state.profiles[person.key];
    if (!profile) return;
    profile.label = String(person.label || '').trim().slice(0, 24) || profile.label || ('Perfil ' + (i + 1));
    profile.theme = person.accent;
  });
  state.mode = setupDraft.mode;
  state.prefs.units = setupDraft.units;
  /* The calculator fields are hidden on first run (there is nothing to edit
     yet — migrate() seeded them from the 'kg' fallback before the user ever
     chose a unit), so a first save has to reseed them from whichever unit
     was actually picked rather than keep that fallback. Once the fields are
     visible (Ajustes), typed input wins; blank or unparsable input keeps
     whatever was already saved, same "don't accept garbage" rule as the
     rest of the app. */
  if (setupFirstRun) {
    state.prefs.barWeight = DEFAULT_BAR_WEIGHT[state.prefs.units];
    state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  } else {
    const bw = num(setupDraft.barWeight);
    if (bw > 0) state.prefs.barWeight = bw;
    const plates = String(setupDraft.platesText || '').split(',').map(num).filter(p => p > 0);
    if (plates.length) state.prefs.plates = plates;
  }
  if (state.mode === 'solo') state.activeProfile = setupDraft.people[0].key;

  /* Only offered on a device with nothing logged: swapping the starting plan
     out later would throw real history away, so the question is not asked. */
  if (setupFirstRun && setupDraft.plan === 'empty') {
    profileKeys().forEach(key => {
      const profile = state.profiles[key];
      const block = emptyBlock();
      profile.blocks = { [block.id]: block };
      profile.blockOrder = [block.id];
      profile.activeBlock = block.id;
      profile.log = {};
      profile.week = 1;
      profile.day = 0;
    });
  } else if (setupFirstRun && setupDraft.plan === 'import') {
    /* Same block, seeded fresh per profile — the imported JSON becomes the
       starting plan for both people in pair mode, same as 'empty' does. */
    profileKeys().forEach(key => {
      const profile = state.profiles[key];
      const block = blockFromNormalized(importedNormalized);
      profile.blocks = { [block.id]: block };
      profile.blockOrder = [block.id];
      profile.activeBlock = block.id;
      profile.log = {};
      profile.week = 1;
      profile.day = 0;
    });
  }

  state.setupDone = true;
  const wasFirstRun = setupFirstRun;
  setupDraft = null;
  save();
  applyTheme();
  render();
  closeSheet('setupSheet');
  mark(wasFirstRun ? 'Listo — cámbialo cuando quieras en "Editar plan"' : 'Ajustes guardados');
};

function closeSetup() {
  /* Skipping is a real answer: keep the defaults and never ask again. */
  if (setupFirstRun) { state.setupDone = true; save(); }
  setupDraft = null;
  closeSheet('setupSheet');
}
$('setupClose').onclick = closeSetup;
$('setupSheet').addEventListener('click', e => { if (e.target.id === 'setupSheet') closeSetup(); });
$('settings').onclick = () => openSetup(false);

/* A block with one day and one blank exercise — somewhere to build from,
   instead of deleting twenty-two exercises you have never done. */
function emptyBlock() {
  const id = 'block-' + Date.now();
  return {
    id,
    name: 'Mi bloque',
    createdAt: new Date().toISOString(),
    weeks: 8,
    deload: 8,
    days: [{ id: 'd0', name: 'Día 1', ex: [newExercise()] }],
    phase: genericPhase(8, 8),
  };
}

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
    /* The only native confirm left, and deliberately: this screen has already
       replaced document.body, so the dialog sheet is not in the page any more. */
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

/* Clipboard copy for text that has no on-screen textarea to select from
   (unlike the backup blob, which the user can already see and select). */
async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('copy failed');
}

/* ---------- state accessors ---------- */
function getProfile() { return state.profiles[state.activeProfile]; }
function getBlock() { const p = getProfile(); return p.blocks[p.activeBlock]; }

/* An exercise's tag for volume purposes, on a given dimension — falls back
   to UNCLASSIFIED_LABEL for anything left blank, so a custom exercise is
   never silently dropped from the total, only bucketed as unclassified.

   patternTag falls further back to `type` before giving up: an isolation
   move rarely has a horizontal/vertical push-or-pull plane worth naming, so
   most only ever get `type: "Aislamiento"` and no `pattern` at all. Without
   this fallback every one of them would pile up as "Sin clasificar" in the
   Patrón view, burying the isolation total in the same bucket as exercises
   nobody tagged at all. With it, the Patrón view reads as the six compound
   patterns plus one Aislamiento bucket — exactly the shape that makes an
   imbalance like "8 sets of horizontal push, 45 of isolation" visible at a
   glance, which was the point of adding `pattern`/`type` in the first
   place. */
const muscleTag = ex => txt(ex.muscle, MUSCLE_LIMIT) || UNCLASSIFIED_LABEL;
const patternTag = ex => txt(ex.pattern, PATTERN_LIMIT) || txt(ex.type, TYPE_LIMIT) || UNCLASSIFIED_LABEL;
const typeTag = ex => txt(ex.type, TYPE_LIMIT) || UNCLASSIFIED_LABEL;

/* The volume dashboard's switchable dimensions, in the order their toggle
   buttons appear. Each entry names the tag function that buckets an
   exercise under it — the dashboard itself (blockTagsFor/volumeTotals)
   never special-cases "muscle", so a fourth dimension only needs an entry
   here and a button in the volumeDim group. */
const VOLUME_DIMENSIONS = {
  muscle: { label: 'Músculo', tag: muscleTag },
  pattern: { label: 'Patrón', tag: patternTag },
  type: { label: 'Tipo', tag: typeTag },
};

function setsFor(ex, w, block) {
  let n = ex.sets;
  if (ex.add && w >= ex.add) n += 1;
  if (block && w === deloadWeek(block)) n = Math.max(2, Math.ceil(ex.sets / 2));
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

const rowUsed = r => !!(r && (r.done || (r.w !== '' && r.w != null) || (r.r !== '' && r.r != null) || dropsOf(r).some(dropUsed)));

/* ---------- rep-decay flag ----------
   Free, because it needs no input at all: derived from the reps already
   typed into the first and last set of an exercise. A first set that drops
   ≥3 reps by the last one was very likely taken closer to failure than the
   ones after it — the single most common tell in a log that only records
   {w, r, done}. Returns the drop, or 0 when there isn't one (fewer than two
   sets with reps typed counts as no signal, not a flat line). */
function repDecay(rows) {
  const withReps = (rows || []).filter(r => r && r.r !== '' && r.r != null && !isNaN(num(r.r)));
  if (withReps.length < 2) return 0;
  const drop = num(withReps[0].r) - num(withReps[withReps.length - 1].r);
  return drop >= 3 ? drop : 0;
}

/* The top of a rep range like "8–12" or "8-12" — the last number in the
   string, so it also copes with a plain "12" (no range at all). Used by
   copyPrev to decide whether double progression's condition ("top of range
   on every set") was actually met last week. */
function repRangeTop(reps) {
  const nums = String(reps || '').match(/\d+(?:[.,]\d+)?/g);
  return nums && nums.length ? num(nums[nums.length - 1]) : null;
}

/* ---------- RIR (reps in reserve) ----------
   The app prescribes an RIR target per week in `phase`, but used to record
   nothing about what actually happened — so there was no way to tell a hard
   set from a grinder short of guessing at rep decay. This is that record:
   one chip per exercise per session, not per set (mid-set entry is too much
   friction), optional and absent by default like `share`/`ss`. Filed
   separately from `profile.log` — a parallel map with the same
   blockId → slot → exId shape — rather than folded into a log row, so
   nothing that reads rows as a plain array of {w,r,done} has to change. */
const RIR_OPTIONS = ['2+', '1', '0'];
const RIR_LABEL = { '2+': '2+ RIR', '1': '1 RIR', '0': '0 RIR (al fallo)' };

function getRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}

function setRir(profile, blockId, w, dayId, exId, val) {
  if (!profile.rir[blockId]) profile.rir[blockId] = {};
  const k = slot(w, dayId);
  if (!profile.rir[blockId][k]) profile.rir[blockId][k] = {};
  if (val) profile.rir[blockId][k][exId] = val;
  else delete profile.rir[blockId][k][exId];
}

/* ---------- weight drops ----------
   A drop is what happened *inside* one set after the weight came off: the
   planned kind (a dropset — you finished the set, stripped the stack and
   kept going) and the unplanned kind (you couldn't reach the target reps at
   that weight, so you dropped and finished them lighter). Same numbers
   either way, opposite meanings, which is why `dk` records which it was.

   Unlike RIR, this does NOT get a parallel map: a drop belongs to one
   specific set of one specific exercise, and a map keyed by set index would
   need re-syncing every time the plan's set count moved, plus a twin of
   every purge/move/clear path. Living on the row means clearing a day,
   deleting a block, moving an exercise between days and undo all carry it
   for free. The cost is paid in two places only — the share/import
   normalizers and the CSV — and an older copy of the app receiving a QR
   transfer just ignores the field, which loses the drops and keeps the log.

   `d` is an array, not a single pair, because a triple drop is one set:
   60×8 → 45×5 → 30×4 is three entries against set 3, not three sets. */
const DROP_KINDS = ['drop', 'forced'];
const DROP_LABEL = { drop: 'Dropset', forced: 'Forzado' };
const DROP_HINT = {
  drop: 'Dropset: acabaste la serie y bajaste peso para seguir',
  forced: 'Forzado: no llegabas a las reps, bajaste peso para acabarlas',
};
/* Enough for a run-the-rack (60→45→35→25); past that you are doing a
   different exercise, not a drop. */
const MAX_DROPS = 4;

/* Defensive on purpose: `d` arrives from localStorage and from imported
   payloads, and every reader below runs inside the session render. This one
   hands back the *stored* array rather than a cleaned copy, so the indices
   the ✕ buttons splice on stay honest — which is why the readers filter
   with dropUsed (null-safe) instead of trusting the entries. */
const dropsOf = r => (r && Array.isArray(r.d)) ? r.d : [];
const dropUsed = d => !!(d && ((d.w !== '' && d.w != null) || (d.r !== '' && d.r != null)));
const dropKind = r => (r && DROP_KINDS.indexOf(r.dk) >= 0) ? r.dk : 'drop';

/* Only the segments that hold both numbers move any weight, and only a
   ticked set counts at all — exactly the rule the main tonnage line
   already follows for the set itself. */
function dropVolume(r) {
  return dropsOf(r).filter(dropUsed).reduce((t, d) => {
    const w = num(d.w), reps = num(d.r);
    return t + ((isNaN(w) || isNaN(reps)) ? 0 : w * reps);
  }, 0);
}

/* Kilos moved by one logged set: the set itself plus whatever the drops
   added. The reps after the weight came off are still reps that moved
   weight — they do not add a *set* anywhere (not to the progress bar, not
   to the volume dashboard, which compares set counts against the plan) but
   leaving them out would under-report the hardest sets in the session.
   Only a ticked set counts, and only one with both numbers filled in. */
function setVolume(r) {
  if (!r || !r.done) return 0;
  const w = num(r.w), reps = num(r.r);
  return ((isNaN(w) || isNaN(reps)) ? 0 : w * reps) + dropVolume(r);
}

/* Kilos in the unit the app is showing, grouped the Spanish way: the
   numbers here run to five digits by mid-block, and "45320 kg" is a number
   you have to count digits on. */
const fmtKg = n => Math.round(n).toLocaleString('es-ES') + ' ' + units();

/* "60×8" for the set, "60×8 ↓45×5" once it has a drop — the one string used
   by the previous-week line and the CSV both. */
function setSummary(r) {
  const head = String(r.w == null ? '' : r.w) + '×' + (r.r === '' || r.r == null ? '?' : r.r);
  const tail = dropsOf(r).filter(dropUsed)
    .map(d => '↓' + (d.w === '' || d.w == null ? '?' : d.w) + '×' + (d.r === '' || d.r == null ? '?' : d.r));
  return tail.length ? head + ' ' + tail.join(' ') : head;
}

/* A set the weight had to come off to finish is the plainest statement there
   is that the weight was too heavy — so it joins RIR-0 and rep decay as a
   reason for copyPrev to withhold next week's automatic increase. A planned
   dropset says nothing of the sort and is deliberately not counted here. */
function forcedDrop(rows) {
  return (rows || []).some(r => r && r.done && dropKind(r) === 'forced' && dropsOf(r).some(dropUsed));
}

/* Rows logged past what the current plan shows — kept, but out of sight. */
function parkedRows(profile, blockId, w, dayId, exId, n) {
  const a = profile.log[blockId] && profile.log[blockId][slot(w, dayId)] && profile.log[blockId][slot(w, dayId)][exId];
  return a && a.length > n ? a.slice(n).filter(rowUsed).length : 0;
}

function loggedSets(profile, blockId, dayId, exId, weeks) {
  let n = 0;
  const last = weeks || MAX_WEEKS;
  for (let w = 1; w <= last; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) n += s[exId].filter(rowUsed).length;
  }
  return n;
}

function loggedSetsDay(profile, blockId, day) {
  return day.ex.reduce((t, ex) => t + loggedSets(profile, blockId, day.id, ex.id), 0);
}

/* Rows filed under weeks past the end of a shortened block: kept, but out of
   reach until the block is made long enough to show them again. */
function weeksBeyondEnd(profile, block) {
  const blk = profile.log[block.id];
  if (!blk) return 0;
  const weeks = blockWeeks(block);
  let n = 0;
  Object.keys(blk).forEach(k => {
    const m = /^w(\d+)-/.exec(k);
    if (!m || +m[1] <= weeks) return;
    const s = blk[k];
    Object.keys(s || {}).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
  });
  return n;
}

/* These walk to MAX_WEEKS rather than the block's length on purpose: a block
   shortened from 12 weeks to 6 still has rows filed under weeks 7-12, and
   "borrar registro" has to mean all of it. */
function purgeExLog(profile, blockId, dayId, exId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
}

/* "Send to another session" in the plan editor: the exercise moves between
   draft days right away, but its logged sets stay filed under the session
   it was in until the draft is saved — this is what makes that filing
   catch up, across every week the block could have. */
function moveExLog(profile, blockId, fromDayId, toDayId, exId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const from = blk[slot(w, fromDayId)];
    if (!from || !from[exId]) continue;
    const toKey = slot(w, toDayId);
    if (!blk[toKey]) blk[toKey] = {};
    blk[toKey][exId] = from[exId];
    delete from[exId];
  }
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
  stopAlarmLoop();
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
      startAlarmLoop();
    }
    const over = Math.abs(left);
    v.textContent = '+' + Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0');
    if (over > 180) stopRest();
  }
}

function stopRest() {
  clearInterval(tId); tId = null;
  stopAlarmLoop();
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
    stopAlarmLoop();
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
   and headphones drown the buzz. A short synthesised alarm needs no audio
   file — which matters for a site that has to work offline. Sawtooth waves
   carry more harmonics than a sine or square at the same gain, so they cut
   through gym noise and tinny phone speakers better; a flat, rapid-fire
   same-pitch pulse (rather than a melodic two-tone interval) reads as a
   klaxon instead of a doorbell chime. The whole burst repeats on an
   interval — one beep is easy to miss mid-set — until the rest is skipped,
   nudged, or a repeat cap is hit. */
let audioCtx = null;
let alarmLoopId = null;
const ALARM_REPEATS = 6;
const ALARM_INTERVAL_MS = 1100;

function stopAlarmLoop() {
  if (alarmLoopId) { clearInterval(alarmLoopId); alarmLoopId = null; }
}

function startAlarmLoop() {
  stopAlarmLoop();
  let count = 0;
  const fire = () => {
    if (!state.prefs.sound || count >= ALARM_REPEATS) { stopAlarmLoop(); return; }
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    count++;
  };
  fire();
  alarmLoopId = setInterval(fire, ALARM_INTERVAL_MS);
}

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
    const pattern = [1046.5, 1046.5, 1046.5, 1046.5];
    pattern.forEach((freq, i) => {
      const off = i * 0.12;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + off);
      gain.gain.exponentialRampToValueAtTime(0.65, now + off + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + off);
      osc.stop(now + off + 0.1);
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
  else { stopAlarmLoop(); }
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
/* Order matters: Escape closes whichever of these is open *last*, so a sheet
   that can be opened on top of another (qrSheet, from the backup sheet) has
   to sit after it here. */
const SHEET_IDS = ['setupSheet', 'sheet', 'planSheet', 'blocksSheet', 'importSheet', 'chartSheet', 'calcSheet', 'volumeSheet', 'qrSheet'];
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
  if (askResolve) { closeAsk($('askInput').style.display === 'none' ? false : null); return; }
  const open = SHEET_IDS.filter(id => $(id).classList.contains('up'));
  if (!open.length) return;
  const top = open[open.length - 1];
  if (top === 'planSheet') closePlanEditor();
  else if (top === 'setupSheet') closeSetup();
  else if (top === 'qrSheet') closeQr();
  else closeSheet(top);
});

/* ---------- profile / block bars ---------- */
function renderProfiles() {
  const host = $('profiles');
  host.innerHTML = '';
  /* Solo mode hides the switcher rather than removing the other profile:
     the data stays put, so turning two-person mode back on is instant. */
  host.style.display = soloMode() ? 'none' : 'flex';
  visibleProfileKeys().forEach(key => {
    const p = state.profiles[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'profile-btn' + (key === state.activeProfile ? ' on' : '');
    b.textContent = p.label;
    b.setAttribute('aria-pressed', key === state.activeProfile ? 'true' : 'false');
    b.onclick = () => { state.activeProfile = key; stopRest(); render(); };
    host.appendChild(b);
  });
  $('app').className = 'profile-' + getProfile().theme + (soloMode() ? ' solo' : '');
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

  snapshotForUndo(drop.size === 1 ? 'Bloque eliminado.' : drop.size + ' bloques eliminados.');

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
    del.onclick = async () => {
      const cost = sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ';
      const rest = active
        ? 'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.'
        : 'El bloque actual, "' + profile.blocks[profile.activeBlock].name + '", se queda exactamente como está.';
      const okd = await ask({
        title: '¿Eliminar "' + block.name + '"' + (date ? ' (' + date + ')' : '') + '?',
        body: cost + rest + ' No se puede deshacer.',
        okLabel: 'Eliminar', danger: true,
      });
      if (!okd) return;
      deleteBlocks(profile, [id]);
      renderBlockManager();
      mark('Bloque eliminado');
    };

    host.appendChild(row);
  });
}

$('blkKeepCurrent').onclick = async () => {
  const profile = getProfile();
  const others = profile.blockOrder.filter(id => id !== profile.activeBlock);
  if (!others.length) { await tell('Nada que eliminar', '"' + getBlock().name + '" ya es el único bloque de ' + profile.label + '.'); return; }
  const sets = others.reduce((t, id) => t + blockLoggedSets(profile, id), 0);
  const names = others.map(id => '· ' + blockPickerLabel(profile, id)).join('\n');
  const okd = await ask({
    title: '¿Eliminar los otros ' + others.length + ' bloques de ' + profile.label + '?',
    body: names + '\n\n' +
      (sets ? 'Se borran ' + setsLabel(sets) + ' en total. ' : 'No tienen nada registrado. ') +
      '"' + getBlock().name + '" y todo su registro se quedan como están. No se puede deshacer.',
    okLabel: 'Eliminar', danger: true,
  });
  if (!okd) return;
  const n = deleteBlocks(profile, others);
  renderBlockManager();
  mark(n + (n === 1 ? ' bloque eliminado' : ' bloques eliminados') + ' — el bloque actual intacto');
};

$('blkClose').onclick = () => closeSheet('blocksSheet');
$('blocksSheet').addEventListener('click', e => { if (e.target.id === 'blocksSheet') closeSheet('blocksSheet'); });

async function newBlock() {
  const profile = getProfile();
  const current = getBlock();
  const n = profile.blockOrder.length + 1;
  const name = await askText({
    title: 'Nuevo bloque',
    body: 'Se crea copiando el plan de "' + current.name + '". Su registro se queda donde está.',
    value: 'Bloque ' + n,
    placeholder: 'Nombre del bloque',
  });
  if (!name || !name.trim()) return;
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
const DEFAULT_BLOCKS_BASE = 'https://raw.githubusercontent.com/tormarod/heavy-iron/main/blocks';

/* Published blocks are fetched from whichever repo is serving the app, so a
   fork lists its own blocks rather than this one's. On GitHub Pages both the
   owner and the repo are sitting in the URL; anywhere else (a local server,
   a custom domain) there is nothing to read and the original stands. */
function blocksBase() {
  const m = /^([A-Za-z0-9-]+)\.github\.io$/.exec(location.hostname);
  if (!m) return DEFAULT_BLOCKS_BASE;
  const seg = location.pathname.split('/').filter(Boolean)[0];
  const repo = seg || (m[1] + '.github.io');   /* a user site has no path segment */
  return 'https://raw.githubusercontent.com/' + m[1] + '/' + repo + '/main/blocks';
}

const DELOAD_PHASE = { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' };

/* The week-goal table a block gets when it does not bring its own. The RIR
   ramp is spread across however many working weeks there are, so a 4-week
   block gets the same shape as a 12-week one rather than running out of
   scale or repeating itself. */
const GENERIC_RAMP = [
  { at: 0.00, r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  { at: 0.30, r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  { at: 0.70, r: '0–1 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  { at: 0.95, r: '0–1 RIR', t: 'La semana más dura. Última serie de cada máquina al fallo.' },
];

function genericPhase(weeks, deload) {
  const n = clampInt(weeks, 1, MAX_WEEKS, 8);
  const dl = clampInt(deload, 0, MAX_WEEKS, 0);
  const working = [];
  for (let w = 1; w <= n; w++) if (w !== dl) working.push(w);

  const phase = {};
  for (let w = 1; w <= n; w++) {
    if (w === dl) { phase[w] = { r: DELOAD_PHASE.r, t: DELOAD_PHASE.t }; continue; }
    const i = working.indexOf(w);
    const p = working.length > 1 ? i / (working.length - 1) : 0;
    let step = GENERIC_RAMP[0];
    GENERIC_RAMP.forEach(x => { if (p >= x.at) step = x; });
    phase[w] = { r: step.r, t: step.t };
  }
  return phase;
}

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
  /* Both optional: a block that says nothing is the eight-week, deload-on-8
     shape every block had before length was configurable. */
  const weeks = clampInt(raw.weeks, 1, MAX_WEEKS, 8);
  let deload = raw.deload == null ? (weeks === 8 ? 8 : 0) : clampInt(raw.deload, 0, MAX_WEEKS, 0);
  if (deload > weeks) deload = 0;
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
      if (e.setup) out.setup = txt(e.setup, SETUP_LIMIT);
      /* clampInt would silently round a fractional "add" — 2.3 becoming 2 —
         and a program quietly rewritten under someone's feet is worse than
         a rejected import they can fix and retry. Rejected loudly instead,
         same as a missing name or rep range. `inc` is exempt: it is
         genuinely a decimal (a weight step), so it goes through clampNum,
         which is built for that, not this guard. */
      if (e.add != null) {
        const av = +e.add;
        if (!Number.isFinite(av) || !Number.isInteger(av) || av < 1) {
          throw new Error('El incremento de series ("add") de "' + n + '" tiene que ser un número entero de al menos 1 (llegó ' + JSON.stringify(e.add) + ').');
        }
        out.add = clampInt(av, 1, weeks, 1);
      }
      if (e.inc != null) { const v = clampNum(e.inc, INC_MIN, INC_MAX, 0, INC_STEP); if (v > 0) out.inc = v; }
      if (e.share) out.share = 1;
      if (e.ss) out.ss = 1;
      /* Freeform, same as everywhere else it's set — whoever built this
         block (an agent, a person, another app's export) defines their own
         muscle/pattern/type taxonomy. Only trimmed and length-capped; a
         blank or missing value is left absent rather than rejecting the
         whole import. */
      if (e.muscle != null) { const m = txt(e.muscle, MUSCLE_LIMIT); if (m) out.muscle = m; }
      if (e.pattern != null) { const p = txt(e.pattern, PATTERN_LIMIT); if (p) out.pattern = p; }
      if (e.type != null) { const t = txt(e.type, TYPE_LIMIT); if (t) out.type = t; }
      return out;
    });
    let dayId = txt(day.id, 60);
    while (!dayId || usedDayIds.has(dayId)) dayId = uid('d');
    usedDayIds.add(dayId);
    const out = { id: dayId, name: dayName, ex };
    if (day.pair) out.pair = txt(day.pair, IMPORT_LIMITS.pair);
    return out;
  });

  let phase = genericPhase(weeks, deload);
  if (raw.phase && typeof raw.phase === 'object') {
    const generic = phase;
    phase = {};
    for (let w = 1; w <= weeks; w++) {
      const p = raw.phase[w] || raw.phase[String(w)];
      phase[w] = (p && p.r && p.t)
        ? { r: txt(p.r, IMPORT_LIMITS.phaseR), t: txt(p.t, IMPORT_LIMITS.phaseT) }
        : generic[w];
    }
  }

  return { name, weeks, deload, days, phase };
}

/* A fresh block object from an already-validated import. Shared by every
   place a normalized block gets filed away — adding it to a profile that
   already has blocks, and installing it as the very first one during setup
   — so they can't drift on what fields a block actually needs. */
function blockFromNormalized(normalized) {
  return {
    id: 'block-' + Date.now(),
    name: normalized.name, createdAt: new Date().toISOString(),
    weeks: normalized.weeks, deload: normalized.deload,
    days: normalized.days, phase: normalized.phase,
  };
}

/* Filing an already-validated block into the current profile. Split out from
   the sheet below it because a block can now also arrive from a camera (see
   the QR section), and both routes have to land it identically: as a *new*
   block, never on top of an existing one, so an import can't cost you a log.
   `log`/`rir` are optional and already normalized — a QR that carried
   progress with the plan hands them in here, keyed by this block's own
   ids. */
function installImportedBlock(normalized, log, rir) {
  const profile = getProfile();
  const block = blockFromNormalized(normalized);
  profile.blocks[block.id] = block;
  profile.blockOrder.push(block.id);
  profile.activeBlock = block.id;
  profile.week = 1; profile.day = 0;
  if (log) profile.log[block.id] = log;
  if (rir) profile.rir[block.id] = rir;
  save(); render();
  return block.id;
}

function applyImportedBlock(raw, sourceLabel) {
  let normalized;
  try {
    normalized = normalizeImportedBlock(raw);
  } catch (e) {
    setNote($('importError'), e.message, true);
    return;
  }
  installImportedBlock(normalized);
  closeSheet('importSheet');
  flushSave();
  mark('Bloque "' + normalized.name + '" importado' + (sourceLabel ? ' (' + sourceLabel + ')' : '') + ' en ' + getProfile().label);
}

async function loadRepoBlockList() {
  const host = $('importRepoList');
  host.textContent = 'Cargando…';
  try {
    const res = await fetch(blocksBase() + '/index.json', { cache: 'no-store' });
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
        setNote($('importError'), '', false);
        try {
          const r = await fetch(blocksBase() + '/' + encodeURIComponent(file), { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyImportedBlock(await r.json(), label);
        } catch (e) {
          setNote($('importError'), 'No se pudo cargar "' + label + '": ' + e.message, true);
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
  setNote($('importError'), '', false);
  openSheet('importSheet');
  loadRepoBlockList();
}

$('importFromText').onclick = () => {
  setNote($('importError'), '', false);
  let raw;
  try { raw = JSON.parse($('importBlob').value); } catch (e) { setNote($('importError'), 'Eso no es JSON válido.', true); return; }
  applyImportedBlock(raw, 'texto pegado');
};
$('importClose').onclick = () => closeSheet('importSheet');
$('importSheet').addEventListener('click', e => { if (e.target.id === 'importSheet') closeSheet('importSheet'); });

/* Builds a self-contained prompt for a third party's AI agent, describing
   the block JSON shape from the same limits the importer itself enforces
   (IMPORT_LIMITS, MUSCLE_LIMIT, PATTERN_LIMIT, TYPE_LIMIT, MAX_WEEKS) so it can't quietly drift out of
   sync with what normalizeImportedBlock actually accepts. The worked
   example is fetched from blocks/ejemplo-plantilla.json — the same file the
   download button offers — rather than duplicated inline, for the same
   reason. Works with no network too: the example is just left out. */
async function buildAiPrompt() {
  const L = IMPORT_LIMITS;
  const lines = [
    'Genera un bloque de entrenamiento como JSON para la app "Heavy Iron". Responde solo con el JSON, sin texto ni comentarios alrededor.',
    '',
    'Formato exacto:',
    '{',
    '  "name": string opcional (máx ' + L.name + ' car., por defecto "Bloque importado"),',
    '  "weeks": número opcional 1-' + MAX_WEEKS + ' (por defecto 8),',
    '  "deload": número opcional — semana de descarga (0 = sin descarga; por defecto 8 si weeks=8, si no, ninguna),',
    '  "days": [ // obligatorio, 1-' + L.days + ' días',
    '    {',
    '      "name": string opcional (máx ' + L.name + ' car., por defecto "Día N"),',
    '      "pair": string opcional (máx ' + L.pair + ' car.) — nota para una sesión conjunta de pareja ese día,',
    '      "ex": [ // obligatorio, 1-' + L.ex + ' ejercicios',
    '        {',
    '          "n": string OBLIGATORIO — nombre del ejercicio (máx ' + L.exName + ' car.),',
    '          "reps": string OBLIGATORIO — rango de reps, p.ej. "8-12" (máx ' + L.reps + ' car.),',
    '          "sets": número opcional 1-12 (por defecto 3),',
    '          "rest": número opcional — segundos de descanso 0-900 (por defecto 90; usa 0 si el ejercicio va encadenado en superserie),',
    '          "add": número entero opcional 1-weeks — desde esa semana se añade una serie extra (progresión de series; tiene que ser un entero o se rechaza todo el bloque),',
    '          "inc": número opcional, admite decimales, ' + INC_MIN + '-' + INC_MAX + ' — cuánto peso añadir cuando "copiar semana anterior" detecta que se llegó al tope del rango en todas las series (progresión de carga),',
    '          "alt": string opcional — alternativa (máx ' + L.alt + ' car.),',
    '          "cue": string opcional — indicación técnica, para todas las series (máx ' + L.cue + ' car.),',
    '          "setup": string opcional — ajustes de la máquina (altura de asiento, posición del respaldo…), no técnica (máx ' + SETUP_LIMIT + ' car.),',
    '          "muscle": string opcional — músculo principal, libre, p.ej. Pecho/Espalda/Hombro/Bíceps/Tríceps/Cuádriceps/Isquios/Glúteo/Gemelos/Core (máx ' + MUSCLE_LIMIT + ' car.),',
    '          "pattern": string opcional — patrón de movimiento, libre, p.ej. Empuje horizontal/Empuje vertical/Tirón horizontal/Tirón vertical/Rodilla dominante/Cadera dominante (máx ' + PATTERN_LIMIT + ' car.),',
    '          "type": string opcional — tipo de ejercicio, libre, p.ej. Compuesto/Aislamiento (máx ' + TYPE_LIMIT + ' car.),',
    '          "share": 1 opcional — marca el ejercicio como estación compartida en pareja ("JUNTOS"),',
    '          "ss": 1 opcional — marca el ejercicio como parte de una superserie ("SS")',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "phase": { // opcional — objetivo de cada semana, clave = número de semana',
    '    "1": { "r": string corto, p.ej. RIR objetivo (máx ' + L.phaseR + ' car.), "t": texto del objetivo de esa semana (máx ' + L.phaseT + ' car.) }',
    '  }',
    '}',
  ];

  let example = '';
  try {
    const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
    if (r.ok) example = JSON.stringify(JSON.parse(await r.text()));
  } catch (e) { /* offline: the prompt still works without the embedded example */ }
  if (example) lines.push('', 'Ejemplo de referencia (formato válido, contenido de muestra):', example);

  lines.push(
    '',
    'Ahora genera un bloque para mí según mis objetivos. Mi contexto: [tu nivel, cuántos días a la semana, material del gimnasio disponible, qué músculos priorizar, si entrenas solo o en pareja, y cuántas semanas quieres el bloque].',
    '',
    'Responde solo con el JSON.',
  );
  return lines.join('\n');
}

/* Shared by the import sheet and the setup screen's own copy of these two
   buttons (see openSetup/renderSetup below) — the work is identical, only
   which note element gets the result differs. */
async function downloadBlockTemplate(noteEl) {
  setNote(noteEl, '', false);
  try {
    const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    downloadFile('heavy-iron-bloque-ejemplo.json', await r.text(), 'application/json');
    setNote(noteEl, 'Plantilla descargada', false);
  } catch (e) {
    setNote(noteEl, 'No se pudo descargar la plantilla ahora mismo: ' + e.message, true);
  }
}

async function copyBlockPrompt(noteEl) {
  setNote(noteEl, '', false);
  try {
    await copyText(await buildAiPrompt());
    setNote(noteEl, 'Prompt copiado — pégaselo a tu IA junto con tus objetivos', false);
  } catch (e) {
    setNote(noteEl, 'No se pudo copiar el prompt: ' + e.message, true);
  }
}

$('importDownloadTemplate').onclick = () => downloadBlockTemplate($('importError'));
$('importCopyPrompt').onclick = () => copyBlockPrompt($('importError'));
$('setupDownloadTemplate').onclick = () => downloadBlockTemplate($('setupImportStatus'));
$('setupCopyPrompt').onclick = () => copyBlockPrompt($('setupImportStatus'));

/* ---------- nav ---------- */
function renderNav() {
  const profile = getProfile();
  const block = getBlock();
  const days = dayList(block);

  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;

  $('weeks').innerHTML = '';
  const weeks = blockWeeks(block), dl = deloadWeek(block);
  for (let w = 1; w <= weeks; w++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (w === dl ? ' deload' : '');
    b.textContent = w === dl ? 'DL' : w;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', w === profile.week ? 'true' : 'false');
    b.setAttribute('aria-label', 'Semana ' + w + (w === dl ? ', descarga' : ''));
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
    b.type = 'button';
    b.className = 'day' + (i === profile.day ? ' on' : '');
    b.innerHTML = '<span class="day-n">Día ' + (i + 1) + '</span><span class="day-t"></span>';
    b.querySelector('.day-t').textContent = d.name;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === profile.day ? 'true' : 'false');
    b.setAttribute('aria-label', 'Día ' + (i + 1) + ': ' + d.name);
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
  /* Shortening a block can leave you standing on a week it no longer has. */
  if (!(profile.week >= 1)) profile.week = 1;
  if (profile.week > blockWeeks(block)) profile.week = blockWeeks(block);

  renderProfiles();
  renderBlockBar();
  renderNav();
  renderSoundBtn();

  const ph = block.phase[profile.week] || { r: '', t: '' };
  const dl = profile.week === deloadWeek(block);
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
  const pairNote = soloMode() ? '' : (day.pair || '');
  $('pair').textContent = pairNote;
  $('pair').style.display = pairNote ? 'flex' : 'none';

  const list = $('list');
  list.innerHTML = '';
  let total = 0, doneN = 0, tonnage = 0, prs = 0, lastTs = 0;
  const best = bestByExercise(profile, block.id, slot(profile.week, day.id));
  /* Every exercise's row array for this day, by reference — so the tick
     handler below can tell, after any one toggle, whether the whole day just
     became fully done (see maybeNagBackup). */
  const dayRowSets = [];

  exList(day).forEach((ex, i) => {
    const n = setsFor(ex, profile.week, block);
    const rows = entry(profile, block.id, profile.week, day.id, ex.id, n);
    dayRowSets.push(rows);
    const parked = parkedRows(profile, block.id, profile.week, day.id, ex.id, n);
    const allDone = rows.every(r => r.done);
    total += n; doneN += rows.filter(r => r.done).length;

    const isPr = r => r.done && !isNaN(num(r.w)) && (!(ex.id in best) || num(r.w) > best[ex.id]);
    const cardPr = rows.some(isPr);
    if (cardPr) prs++;

    const card = document.createElement('div');
    card.className = 'ex' + (allDone ? ' complete' : '') + (ex.share && !soloMode() ? ' shared' : '');

    const prev = lastTime(profile, block.id, day.id, ex.id, profile.week);
    const prevTxt = prev
      ? '<div class="last"><span class="tag">Sem. ' + prev.week + '</span><span><b>' +
        prev.sets.map(s => esc(setSummary(s))).join('</b> · <b>') + '</b></span></div>'
      : '';

    const decay = repDecay(rows);
    const setupOpen = expandedSetup.has(ex.id);

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
      '<div class="ex-setup">' +
        '<button type="button" class="ex-setup-btn"></button>' +
        (setupOpen ? '<div class="ex-setup-box"><input type="text" class="ex-setup-in" maxlength="' + SETUP_LIMIT + '" autocomplete="off" placeholder="asiento 4, respaldo 2…"></div>' : '') +
      '</div>' +
      '<div class="sets"></div>' +
      (decay ? '<div class="ex-decay"></div>' : '') +
      '<div class="ex-rir"><span class="ex-rir-lbl">RIR último set</span><div class="rir-chips"></div></div>' +
      (parked ? '<div class="ex-parked"></div>' : '');

    if (decay) {
      card.querySelector('.ex-decay').textContent = '⚠ caída de ' + decay + ' reps: ¿primera serie al fallo?';
    }

    if (parked) {
      card.querySelector('.ex-parked').textContent = parked === 1
        ? 'Hay 1 serie registrada por encima de las que pide el plan. Se guarda: sube las series de este ejercicio para volver a verla.'
        : 'Hay ' + parked + ' series registradas por encima de las que pide el plan. Se guardan: sube las series de este ejercicio para volver a verlas.';
    }

    const nameEl = card.querySelector('.ex-name');
    nameEl.appendChild(document.createTextNode(ex.n));
    if (!soloMode()) {
      const s = document.createElement('span');
      s.className = 'badge ' + (ex.share ? 'together' : 'solo');
      s.textContent = ex.share ? 'JUNTOS' : 'SOLO';
      nameEl.appendChild(s);
    }
    if (ex.ss) { const s = document.createElement('span'); s.className = 'ss'; s.textContent = 'SS'; nameEl.appendChild(s); }
    if (cardPr) { const s = document.createElement('span'); s.className = 'badge pr'; s.textContent = 'RÉCORD'; nameEl.appendChild(s); }
    if (ex.alt) card.querySelector('.ex-alt').textContent = ex.alt;
    if (ex.cue) card.querySelector('.ex-cue').textContent = ex.cue;

    card.querySelector('.ex-chart-btn').onclick = () => openChart(ex, day.id);

    /* `ex.setup` — seat height, pin position: a plan field, not a log field,
       so editing it here writes straight to the live exercise, the same way
       the plan editor's own text fields do. Collapsed by default (folded
       behind the ⚙ button) since it rarely changes and isn't what you came
       to read mid-set; the button's own label previews it so you don't have
       to open it just to check. */
    const setupBtn = card.querySelector('.ex-setup-btn');
    setupBtn.textContent = ex.setup ? '⚙ ' + (ex.setup.length > 28 ? ex.setup.slice(0, 28) + '…' : ex.setup) : '⚙ Ajustes';
    setupBtn.setAttribute('aria-expanded', setupOpen ? 'true' : 'false');
    setupBtn.setAttribute('aria-label', 'Ajustes de máquina de ' + ex.n);
    setupBtn.onclick = () => {
      if (setupOpen) expandedSetup.delete(ex.id); else expandedSetup.add(ex.id);
      render();
    };
    if (setupOpen) {
      const setupIn = card.querySelector('.ex-setup-in');
      setupIn.value = ex.setup || '';
      setupIn.setAttribute('aria-label', 'Ajustes de máquina de ' + ex.n);
      setupIn.oninput = e => { const v = e.target.value; if (v) ex.setup = v; else delete ex.setup; save(); };
      setupIn.focus();
      setupIn.setSelectionRange(setupIn.value.length, setupIn.value.length);
    }

    const rirHost = card.querySelector('.rir-chips');
    const rirVal = getRir(profile, block.id, profile.week, day.id, ex.id);
    RIR_OPTIONS.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rir-chip' + (rirVal === opt ? ' on' : '');
      b.textContent = opt;
      b.setAttribute('aria-pressed', rirVal === opt ? 'true' : 'false');
      b.setAttribute('aria-label', RIR_LABEL[opt] + ' en la última serie de ' + ex.n);
      b.onclick = () => {
        setRir(profile, block.id, profile.week, day.id, ex.id, rirVal === opt ? '' : opt);
        save(); render();
      };
      rirHost.appendChild(b);
    });

    const box = card.querySelector('.sets');
    rows.forEach((r, si) => {
      if (r.done) {
        tonnage += setVolume(r);
        if (r.ts > lastTs) lastTs = r.ts;
      }

      const row = document.createElement('div');
      row.className = 'set-row' + (r.done ? ' done' : '') + (isPr(r) ? ' pr' : '');
      /* text + inputmode rather than type=number: a Spanish keyboard sends a
         comma, and type=number throws the whole value away when it sees one,
         so "22,5" silently became an empty box. */
      const drops = dropsOf(r);
      row.innerHTML =
        '<div class="set-n">' + (si + 1) + '</div>' +
        '<div class="fld"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"><u>' + esc(units()) + '</u></div>' +
        '<div class="fld"><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"><u>rep</u></div>' +
        '<button type="button" class="drop-add' + (drops.length ? ' on' : '') + '"' +
          (drops.length >= MAX_DROPS ? ' disabled' : '') + '>↓</button>' +
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
        /* The tick that finishes the whole day counts as a session — see
           maybeNagBackup. dayRowSets holds live references, so this reads
           true only once every row across every exercise is done. */
        if (r.done && dayRowSets.every(rs => rs.every(rr => rr.done))) {
          state.prefs.sessionsSinceBackup++;
          maybeNagBackup();
        }
        save(); render();
        if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (lo de la semana anterior) — cámbialo si no fue eso');
      };

      /* ↓ adds a segment rather than opening a panel: there is nothing to
         configure before you have one, and mid-set — rest timer running,
         hand on the stack — one tap and a cursor in the weight box is the
         whole interaction. The segments are the panel. */
      const dropAdd = row.querySelector('.drop-add');
      dropAdd.setAttribute('aria-label', drops.length >= MAX_DROPS
        ? 'Máximo de bajadas de peso alcanzado en la serie ' + (si + 1) + ' de ' + ex.n
        : 'Añadir bajada de peso a la serie ' + (si + 1) + ' de ' + ex.n);
      dropAdd.onclick = () => {
        if (dropsOf(r).length >= MAX_DROPS) return;
        if (!Array.isArray(r.d)) r.d = [];
        r.d.push({ w: '', r: '' });
        focusDrop = ex.id + '#' + si + '#' + (r.d.length - 1);
        save(); render();
      };
      box.appendChild(row);

      drops.forEach((d, di) => {
        if (!d || typeof d !== 'object' || Array.isArray(d)) return;
        const dRow = document.createElement('div');
        dRow.className = 'drop-row' + (r.done ? ' done' : '');
        dRow.innerHTML =
          '<div class="drop-n">↳</div>' +
          '<div class="fld"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"><u>' + esc(units()) + '</u></div>' +
          '<div class="fld"><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"><u>rep</u></div>' +
          '<span></span>' +
          '<button type="button" class="drop-x">✕</button>';

        const [dwIn, drIn] = dRow.querySelectorAll('input');
        dwIn.value = d.w == null ? '' : d.w;
        drIn.value = d.r == null ? '' : d.r;
        dwIn.placeholder = '—';
        drIn.placeholder = '—';
        const where = 'bajada ' + (di + 1) + ', serie ' + (si + 1) + ' de ' + ex.n;
        dwIn.setAttribute('aria-label', 'Peso tras bajar, ' + where);
        drIn.setAttribute('aria-label', 'Repeticiones tras bajar, ' + where);
        dwIn.oninput = e => { d.w = e.target.value.replace(/[^0-9.,]/g, ''); if (d.w !== e.target.value) e.target.value = d.w; save(); };
        drIn.oninput = e => { d.r = e.target.value.replace(/[^0-9]/g, ''); if (d.r !== e.target.value) e.target.value = d.r; save(); };

        const del = dRow.querySelector('.drop-x');
        del.setAttribute('aria-label', 'Quitar ' + where);
        del.onclick = () => {
          r.d.splice(di, 1);
          /* No segments left means no kind to remember either — the row goes
             back to being exactly the {w,r,done,ts} it started as. */
          if (!r.d.length) { delete r.d; delete r.dk; }
          save(); render();
        };

        box.appendChild(dRow);

        /* Marked now, focused at the end of the render: the card is still
           detached from the document at this point, and focus() on a
           detached element is silently a no-op. */
        if (focusDrop === ex.id + '#' + si + '#' + di) dwIn.dataset.dropFocus = '1';
      });

      /* One kind per set, not per segment: a triple drop is one decision
         about one set, and the two readings never mix inside it. */
      if (drops.length) {
        const kindRow = document.createElement('div');
        kindRow.className = 'drop-kind';
        const current = dropKind(r);
        DROP_KINDS.forEach(k => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'drop-chip ' + k + (current === k ? ' on' : '');
          b.textContent = DROP_LABEL[k];
          b.setAttribute('aria-pressed', current === k ? 'true' : 'false');
          b.setAttribute('aria-label', DROP_HINT[k] + ' — serie ' + (si + 1) + ' de ' + ex.n);
          b.title = DROP_HINT[k];
          b.onclick = () => { r.dk = k; save(); render(); };
          kindRow.appendChild(b);
        });
        box.appendChild(kindRow);
      }
    });

    list.appendChild(card);
  });

  if (focusDrop) {
    focusDrop = '';
    const target = list.querySelector('[data-drop-focus]');
    if (target) target.focus();
  }

  $('barfill').style.width = total ? (doneN / total * 100) + '%' : '0%';

  const stranded = weeksBeyondEnd(profile, block);
  $('beyond').textContent = stranded
    ? (stranded === 1
        ? 'Hay 1 serie registrada en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guarda: alarga el bloque en "Editar plan" para volver a verla.'
        : 'Hay ' + stranded + ' series registradas en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guardan: alarga el bloque en "Editar plan" para volver a verlas.')
    : '';
  $('beyond').style.display = stranded ? 'block' : 'none';

  const extra = [];
  if (tonnage > 0) extra.push('Volumen: ' + fmtKg(tonnage) + ' movidos');
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
  let leveled = 0, heldBack = 0;
  exList(day).forEach(ex => {
    const from = src[ex.id]; if (!from || !from.length) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week, block));
    /* Double progression, automated: `ex.inc` is the step, and the condition
       is the same one the week banners already state in prose — but the
       cues actually say "top of the range AT 2 RIR", not just "top of the
       range". A set ground out to failure can hit the same rep number
       without meaning the same thing, so top-of-range alone isn't enough to
       trust here — it has to agree with what the set actually cost.
       A logged RIR of 0 (to failure) says so directly. RIR is optional
       though, so when it wasn't tapped, the rep-decay flag stands in for
       it: the same "first set probably went too close to failure" signal
       the session view already shows for free. A *forced* weight drop
       outranks both and is checked whatever the chip says — having to
       strip the stack to finish the reps is not an inference about how
       hard the set was, it is a record of the weight being too heavy.
       (A planned dropset is not this and doesn't count.) Any of them
       withholds the add and falls back to a plain copy, same as short of
       `inc` or the range not being reached at all. */
    const top = repRangeTop(ex.reps);
    const reachedTop = top != null && from.every(r => r && r.done && hasReps(r) && num(r.r) >= top);
    const priorRir = getRir(profile, block.id, profile.week - 1, day.id, ex.id);
    const suspectFailure = forcedDrop(from) || priorRir === '0' || (!priorRir && repDecay(from) > 0);
    const hitTop = !!(ex.inc && reachedTop && !suspectFailure);
    if (hitTop) leveled++;
    else if (ex.inc && reachedTop && suspectFailure) heldBack++;
    to.forEach((r, i) => {
      if (r.done) return;
      const w = (from[i] || from[from.length - 1] || {}).w || '';
      r.w = (hitTop && w !== '' && !isNaN(num(w))) ? String(Math.round((num(w) + ex.inc) * 100) / 100) : w;
    });
  });
  save(); render();
  mark('Pesos copiados de la semana ' + (profile.week - 1) +
    (leveled ? ' — ' + leveled + (leveled === 1 ? ' ejercicio sube' : ' ejercicios suben') + ' de peso (tope de rango la semana pasada)' : '') +
    (heldBack ? ' — ' + heldBack + (heldBack === 1 ? ' ejercicio llegó al tope pero no sube' : ' ejercicios llegaron al tope pero no suben') + ' (hubo que bajar peso, o la última serie parece que fue al fallo y no a 2 RIR)' : '') +
    ' — supéralos');
};

$('clearDay').onclick = async () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  const okd = await ask({
    title: '¿Borrar este día?',
    body: 'Se borran todas las series de ' + day.name + ', semana ' + profile.week + '.',
    okLabel: 'Borrar', danger: true,
  });
  if (!okd) return;
  snapshotForUndo('Borrado ' + day.name + ', semana ' + profile.week + '.');
  if (profile.log[block.id]) delete profile.log[block.id][slot(profile.week, day.id)];
  save(); render();
  mark('Día borrado');
};

$('wipe').onclick = async () => {
  const profile = getProfile();
  const okd = await ask({
    title: '¿Borrar todo el registro de ' + profile.label + '?',
    body: 'Todos los bloques y todas las semanas. El plan de ejercicios no se borra.',
    okLabel: 'Borrar todo', danger: true,
  });
  if (!okd) return;
  snapshotForUndo('Borrado todo el registro de ' + profile.label + '.');
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
/* exId -> the session it lived in when the editor was opened. The real log
   is still filed under that session until "Guardar cambios", so anything
   that reads "how much history does this exercise have" while the sheet is
   open has to look there, not at wherever the draft has moved it to. */
let draftOriginalDay = {};

$('editPlan').onclick = () => {
  draftBlock = JSON.parse(JSON.stringify(getBlock()));
  draftPurge = [];
  draftOriginalDay = {};
  draftBlock.days.forEach(day => day.ex.forEach(ex => { draftOriginalDay[ex.id] = day.id; }));
  $('peBlockName').value = draftBlock.name;
  $('peWeeks').value = blockWeeks(draftBlock);
  renderDeloadOptions();
  renderPlanEditor();
  openSheet('planSheet');
};

/* Logged-set counts for the editor: keyed off the exercise's original
   session (see draftOriginalDay) so a pending "send to another session"
   move doesn't make its history look gone before the draft is saved. */
function draftExLogged(profile, exId, currentDayId) {
  return loggedSets(profile, draftBlock.id, draftOriginalDay[exId] || currentDayId, exId);
}
function draftDayLogged(profile, day) {
  return day.ex.reduce((t, ex) => t + draftExLogged(profile, ex.id, day.id), 0);
}

/* Move an exercise to another session, keeping its id (and so its log)
   intact. The real log entries only move once the draft is saved — see
   the migration in peSave. */
function moveExToDay(ex, fromDay, toDay) {
  fromDay.ex.splice(fromDay.ex.indexOf(ex), 1);
  toDay.ex.push(ex);
}

/* The deload list only offers weeks the block actually has, so shortening a
   block cannot leave the deload pointing off the end of it. */
function renderDeloadOptions() {
  const weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(draftBlock));
  const sel = $('peDeload');
  const current = deloadWeek(draftBlock);
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '0';
  none.textContent = 'Sin descarga';
  sel.appendChild(none);
  for (let w = 1; w <= weeks; w++) {
    const o = document.createElement('option');
    o.value = String(w);
    o.textContent = 'Semana ' + w;
    sel.appendChild(o);
  }
  sel.value = String(current >= 1 && current <= weeks ? current : 0);
}

$('peWeeks').oninput = () => {
  draftBlock.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, 8);
  if (deloadWeek(draftBlock) > draftBlock.weeks) draftBlock.deload = 0;
  renderDeloadOptions();
  draftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  renderPlanEditor();
};
$('peDeload').onchange = () => {
  draftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  renderPlanEditor();
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

  const logged = draftDayLogged(profile, day);
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
  del.onclick = async () => {
    if (logged) {
      const okd = await ask({
        title: 'Retirar "' + day.name + '"',
        body: 'Tiene ' + setsLabel(logged) + ' en este bloque. Se retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.',
        okLabel: 'Retirar',
      });
      if (!okd) return;
      day.off = 1;
    } else {
      const okd = await ask({
        title: '¿Quitar "' + day.name + '" del bloque?',
        body: 'No tiene nada registrado.',
        okLabel: 'Quitar', danger: true,
      });
      if (!okd) return;
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
    const logged = isDay ? draftDayLogged(profile, it.day)
                         : draftExLogged(profile, it.ex.id, it.day.id);
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
    row.querySelector('.a-del').onclick = async () => {
      const what = isDay ? ('el día "' + it.day.name + '"') : ('"' + (it.ex.n || 'este ejercicio') + '"');
      const okd = await ask({
        title: logged ? '¿Borrar el registro para siempre?' : '¿Borrar del bloque?',
        body: logged
          ? 'Se borra ' + what + ' y sus ' + setsLabel(logged) + '. No se puede deshacer.'
          : 'Se borra ' + what + '. No tiene nada registrado.',
        okLabel: 'Borrar', danger: true,
      });
      if (!okd) return;
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
        '<select class="pe-move-sel" title="Enviar a otra sesión"></select>' +
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
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Ajustes de máquina (asiento, respaldo…)</span><input type="text" class="f-setup" maxlength="' + SETUP_LIMIT + '"></div></div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">Series</span><input type="number" min="1" class="f-sets"></div>' +
      '<div style="flex:1;min-width:70px;"><span class="pe-field-lbl">Reps</span><input type="text" class="f-reps"></div>' +
      '<div><span class="pe-field-lbl">Descanso (s)</span><input type="number" min="0" step="5" class="f-rest"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="8" class="f-add"></div>' +
      '<div><span class="pe-field-lbl">Incremento de peso (' + esc(units()) + ')</span><input type="number" min="' + INC_MIN + '" max="' + INC_MAX + '" step="' + INC_STEP + '" class="f-inc"></div>' +
    '</div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Músculo</span>' +
      '<input type="text" class="f-muscle" list="muscleSuggestions" placeholder="Sin clasificar" maxlength="' + MUSCLE_LIMIT + '"></div></div>' +
    '<div class="pe-row">' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Patrón</span>' +
        '<input type="text" class="f-pattern" list="patternSuggestions" placeholder="Sin clasificar" maxlength="' + PATTERN_LIMIT + '"></div>' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Tipo</span>' +
        '<input type="text" class="f-type" list="typeSuggestions" placeholder="Sin clasificar" maxlength="' + TYPE_LIMIT + '"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<label class="pe-check pe-check-share"><input type="checkbox" class="f-share"> Compartido (JUNTOS)</label>' +
      '<label class="pe-check"><input type="checkbox" class="f-ss"> Superserie (SS)</label>' +
    '</div>';

  row.querySelector('.f-n').value = ex.n;
  row.querySelector('.f-n').oninput = e => ex.n = e.target.value;
  row.querySelector('.f-alt').value = ex.alt || '';
  row.querySelector('.f-alt').oninput = e => ex.alt = e.target.value;
  row.querySelector('.f-cue').value = ex.cue || '';
  row.querySelector('.f-cue').oninput = e => ex.cue = e.target.value;
  row.querySelector('.f-setup').value = ex.setup || '';
  row.querySelector('.f-setup').oninput = e => { const v = e.target.value; if (v) ex.setup = v; else delete ex.setup; };
  row.querySelector('.f-sets').value = ex.sets;
  row.querySelector('.f-sets').oninput = e => ex.sets = parseInt(e.target.value, 10) || 1;
  row.querySelector('.f-reps').value = ex.reps;
  row.querySelector('.f-reps').oninput = e => ex.reps = e.target.value;
  row.querySelector('.f-rest').value = ex.rest || 0;
  row.querySelector('.f-rest').oninput = e => ex.rest = parseInt(e.target.value, 10) || 0;
  row.querySelector('.f-add').value = ex.add || '';
  row.querySelector('.f-add').oninput = e => { const v = parseInt(e.target.value, 10); if (v) ex.add = v; else delete ex.add; };
  row.querySelector('.f-inc').value = ex.inc || '';
  /* Decimals, not just integers — clampNum is what makes that safe: 2.3 kg
     is a real plate increment, not a typo to round away like clampInt would
     (see the "add" import guard below for the bug that taught us that). */
  row.querySelector('.f-inc').oninput = e => {
    const v = e.target.value;
    if (v === '') { delete ex.inc; return; }
    ex.inc = clampNum(v, INC_MIN, INC_MAX, INC_MIN, INC_STEP);
  };
  row.querySelector('.f-muscle').value = ex.muscle || '';
  /* Freeform text with a suggestion list (see the shared #muscleSuggestions
     datalist), not a fixed set — type any tag, or clear it to fall back to
     "Sin clasificar". An empty/whitespace value is never stored, the same
     convention share/ss use for their default state. */
  row.querySelector('.f-muscle').oninput = e => { const v = e.target.value.trim(); if (v) ex.muscle = v; else delete ex.muscle; };
  row.querySelector('.f-pattern').value = ex.pattern || '';
  row.querySelector('.f-pattern').oninput = e => { const v = e.target.value.trim(); if (v) ex.pattern = v; else delete ex.pattern; };
  row.querySelector('.f-type').value = ex.type || '';
  row.querySelector('.f-type').oninput = e => { const v = e.target.value.trim(); if (v) ex.type = v; else delete ex.type; };
  row.querySelector('.f-share').checked = !!ex.share;
  row.querySelector('.f-share').onchange = e => { if (e.target.checked) ex.share = 1; else delete ex.share; };
  row.querySelector('.f-ss').checked = !!ex.ss;
  row.querySelector('.f-ss').onchange = e => { if (e.target.checked) ex.ss = 1; else delete ex.ss; };

  const logged = draftExLogged(profile, ex.id, day.id);
  if (logged) row.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  const moveSel = row.querySelector('.pe-move-sel');
  const otherDays = dayList(draftBlock).filter(d => d !== day);
  if (otherDays.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Enviar a…';
    moveSel.appendChild(placeholder);
    otherDays.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      moveSel.appendChild(o);
    });
    moveSel.onchange = () => {
      const target = otherDays.find(d => d.id === moveSel.value);
      if (!target) return;
      moveExToDay(ex, day, target);
      renderPlanEditor();
      mark('"' + (ex.n || 'Ejercicio') + '" enviado a ' + target.name + ' — el registro se conserva');
    };
  } else {
    moveSel.style.display = 'none';
  }

  const up = row.querySelector('.e-up'), down = row.querySelector('.e-down'), del = row.querySelector('.e-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(day.ex, ex, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(day.ex, ex, 1); renderPlanEditor(); };
  del.onclick = async () => {
    if (logged) {
      const okd = await ask({
        title: 'Retirar "' + (ex.n || 'este ejercicio') + '"',
        body: 'Tiene ' + setsLabel(logged) + ' en este bloque. Se retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.',
        okLabel: 'Retirar',
      });
      if (!okd) return;
      ex.off = 1;
    } else {
      day.ex.splice(day.ex.indexOf(ex), 1);
    }
    renderPlanEditor();
  };

  return row;
}

/* Pulls the form fields (name/weeks/deload) into draftBlock, regenerates
   the phase banner for whatever weeks that leaves it with, and defaults
   blank day names — the same shape-up that used to live inline in
   "Guardar cambios". Shared with the export button below: exporting reads
   draftBlock too, so it needs to see the fields as currently typed, not as
   they were when the sheet was opened, and shouldn't ship a plan missing a
   name or a set of reps any more than a save should write one. Returns an
   error message, or null once draftBlock is ready to use. */
function syncDraftFromForm() {
  draftBlock.name = $('peBlockName').value.trim() || draftBlock.name;
  draftBlock.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(draftBlock));
  draftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  if (draftBlock.deload > draftBlock.weeks) draftBlock.deload = 0;
  /* Weeks the block has grown into need a goal to show in the banner, and
     the deload week may have moved; anything you wrote yourself is kept. */
  const phase = draftBlock.phase && typeof draftBlock.phase === 'object' ? draftBlock.phase : {};
  const generic = genericPhase(draftBlock.weeks, draftBlock.deload);
  const nextPhase = {};
  for (let w = 1; w <= draftBlock.weeks; w++) {
    const mine = phase[w] || phase[String(w)];
    const isDeload = w === draftBlock.deload;
    const wasDeload = mine && mine.r === DELOAD_PHASE.r;
    nextPhase[w] = (mine && mine.r && mine.t && isDeload === wasDeload) ? mine : generic[w];
  }
  draftBlock.phase = nextPhase;
  const days = dayList(draftBlock);
  if (!days.length) return 'El bloque necesita al menos un día.';
  days.forEach((day, i) => { if (!String(day.name || '').trim()) day.name = 'Día ' + (i + 1); });
  for (const day of days) {
    const ex = exList(day);
    if (!ex.length) return 'Cada día necesita al menos un ejercicio — revisa "' + day.name + '".';
    for (const e of ex) {
      if (!String(e.n || '').trim()) return 'Todos los ejercicios necesitan un nombre.';
      if (!e.reps || !String(e.reps).trim()) return 'Falta el rango de repeticiones en "' + (e.n || 'un ejercicio') + '".';
    }
  }
  return null;
}

$('peSave').onclick = async () => {
  const problem = syncDraftFromForm();
  if (problem) { await tell('Falta algo', problem); return; }
  const profile = getProfile();
  /* Catch the real log up on any "enviar a…" moves made while the sheet was
     open, before anything below reads or purges it by session id. */
  draftBlock.days.forEach(day => {
    day.ex.forEach(ex => {
      const from = draftOriginalDay[ex.id];
      if (from && from !== day.id) moveExLog(profile, draftBlock.id, from, day.id, ex.id);
    });
  });
  /* The only path that erases logged sets, and only the ones explicitly
     confirmed in "Retirados". */
  draftPurge.forEach(p => {
    if (p.exId) purgeExLog(profile, draftBlock.id, p.dayId, p.exId);
    else purgeDayLog(profile, draftBlock.id, p.dayId);
  });
  profile.blocks[draftBlock.id] = draftBlock;
  draftBlock = null; draftPurge = []; draftOriginalDay = {};
  save(); render();
  closeSheet('planSheet');
  mark('Plan actualizado — el registro se mantiene');
};

/* Same shape as the "block" QR payload and the repo's blocks/*.json
   templates — no ids, no log, retired days/exercises left out — so the
   file downloaded here can be pasted straight into "Importar JSON" on any
   device, or committed to blocks/ as a new template. Reads the draft as it
   stands, unsaved edits included, so you don't have to "Guardar cambios"
   first just to pull a template out of a block you're reshaping — it goes
   through the same field-sync and validation "Guardar cambios" does, so
   what you export is never missing a name or a rep range either. */
$('peExport').onclick = async () => {
  const problem = syncDraftFromForm();
  if (problem) { await tell('Falta algo', problem); return; }
  renderPlanEditor();
  const plan = blockSharePlan(draftBlock);
  const name = 'heavy-iron-plan-' + (slugify(draftBlock.name) || 'bloque') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  downloadFile(name, JSON.stringify(plan, null, 2), 'application/json');
  mark('Plan descargado — sin registro, listo para "Importar JSON" en otro sitio');
};

function closePlanEditor() {
  closeSheet('planSheet');
  draftBlock = null;
  draftPurge = [];
  draftOriginalDay = {};
}

$('peClose').onclick = closePlanEditor;
$('planSheet').addEventListener('click', e => { if (e.target.id === 'planSheet') closePlanEditor(); });

$('peDeleteBlock').onclick = async () => {
  const profile = getProfile();
  if (profile.blockOrder.length <= 1) { await tell('No se puede', 'No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
  const id = draftBlock.id;
  const sets = blockLoggedSets(profile, id);
  const okd = await ask({
    title: '¿Eliminar "' + draftBlock.name + '"?',
    body: (sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ') +
      'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede. No se puede deshacer.',
    okLabel: 'Eliminar', danger: true,
  });
  if (!okd) return;
  closePlanEditor();
  deleteBlocks(profile, [id]);
  mark('Bloque eliminado');
};

/* ---------- progress chart ---------- */
/* Epley: est1RM(w, r) = w × (1 + r/30). Simpler than Brzycki, it's what most
   lifting apps already show, and its error band is well understood. It
   degrades past ~12 reps, which callers are expected to flag rather than
   plot as if it were a reliable number. */
const est1RM = (w, r) => w * (1 + r / 30);

/* A set counts toward the 1RM series only if it has a usable rep count —
   unlike the weight series, which needs nothing but the weight itself. */
const hasReps = r => r.r !== '' && r.r != null && !isNaN(num(r.r)) && num(r.r) > 0;

/* Which logged set of a group "wins" depends on what's being charted: the
   heaviest weight for the weight series, but the highest estimated 1RM for
   the 1RM series — a heavier single at fewer reps can out-rank a lighter
   set done for many reps, which is the point of showing this at all. */
function bestSet(done, metric) {
  if (metric === 'e1rm') {
    const withReps = done.filter(hasReps);
    if (!withReps.length) return null;
    let best = withReps[0];
    withReps.forEach(r => { if (est1RM(num(r.w), num(r.r)) > est1RM(num(best.w), num(best.r))) best = r; });
    return best;
  }
  let best = done[0];
  done.forEach(r => { if (num(r.w) > num(best.w)) best = r; });
  return best;
}

function collectHistory(profile, blockId, dayId, exId, weeks, metric) {
  const points = [];
  for (let w = 1; w <= (weeks || MAX_WEEKS); w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    const rows = s && s[exId];
    if (!rows) continue;
    const done = rows.filter(r => r.done && r.w !== '' && r.w != null && !isNaN(num(r.w)));
    if (!done.length) continue;
    const best = bestSet(done, metric);
    if (!best) continue;
    points.push({ week: w, weight: num(best.w), reps: best.r });
  }
  return points;
}

/* The same exercise across every block the profile has ever run, oldest
   first. Blocks key their logs separately, so this walks each block's slots
   looking for the exercise id rather than a day — the same exercise can sit
   on a different day in a later block and it is still the same lift. */
function collectHistoryAll(profile, exId, metric) {
  const out = [];
  profile.blockOrder.forEach(bId => {
    const block = profile.blocks[bId];
    const blk = profile.log[bId];
    if (!block || !blk) return;
    for (let w = 1; w <= blockWeeks(block); w++) {
      Object.keys(blk).forEach(k => {
        const m = /^w(\d+)-(.+)$/.exec(k);
        if (!m || +m[1] !== w) return;
        const rows = blk[k][exId];
        if (!Array.isArray(rows)) return;
        const done = rows.filter(r => r && r.done && r.w !== '' && r.w != null && !isNaN(num(r.w)));
        if (!done.length) return;
        const best = bestSet(done, metric);
        if (!best) return;
        out.push({ label: block.name + ' · S' + w, weight: num(best.w), reps: best.r });
      });
    }
  });
  return out;
}

/* `series` is [{ i, weight, reps }] with i a 1-based position, and `ticks`
   is the label for each position — weeks when looking at one block, one per
   logged session when looking across all of them. */
function buildChartSVG(series, ticks) {
  const W = 600, H = 220, padL = 40, padR = 16, padT = 16, padB = 28;
  const n = Math.max(1, ticks.length);
  const weights = series.map(p => p.weight);
  let min = Math.min(...weights), max = Math.max(...weights);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = i => padL + (n > 1 ? (i - 1) / (n - 1) : 0.5) * (W - padL - padR);
  const y = v => H - padB - ((v - min) / (max - min)) * (H - padT - padB);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img">';

  /* Sixteen weeks — or a season's worth of sessions across every block —
     would turn the axis into a picket fence, so labels thin out as the
     series grows. The gridlines stay: they are what shows the gaps. */
  const every = Math.ceil(n / 8);
  ticks.forEach((label, idx) => {
    const i = idx + 1;
    svg += '<line x1="' + x(i) + '" y1="' + padT + '" x2="' + x(i) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>';
    if (idx % every === 0 || i === n) {
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + esc(label) + '</text>';
    }
  });

  svg += '<text x="4" y="' + (y(max - pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(max - pad) + '</text>';
  svg += '<text x="4" y="' + (y(min + pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(min + pad) + '</text>';

  if (series.length) {
    /* Points the caller marks `muted` (an estimate built from too many reps
       to trust) are dropped from the line entirely rather than plotted as
       if they were as reliable as the rest — they still get a marker, just
       a hollow one, so the data isn't hidden either. */
    const reliable = series.filter(p => !p.muted);
    if (reliable.length) {
      const path = reliable.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.i) + ' ' + y(p.weight)).join(' ');
      svg += '<path d="' + path + '" fill="none" stroke="var(--signal)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    series.forEach(p => {
      svg += p.muted
        ? '<circle cx="' + x(p.i) + '" cy="' + y(p.weight) + '" r="4" fill="var(--card)" stroke="var(--soft)" stroke-width="1.5" stroke-dasharray="2,2"/>'
        : '<circle cx="' + x(p.i) + '" cy="' + y(p.weight) + '" r="4" fill="var(--signal)"/>';
    });
  }
  svg += '</svg>';
  return svg;
}

let chartFor = null;          /* { ex, dayId } — kept so the toggle can redraw */
let chartScope = 'block';     /* 'block' | 'all' */
let chartMetric = 'weight';   /* 'weight' | 'e1rm' */

/* A logged set feeds the 1RM series only if it has usable reps; beyond 12
   reps Epley's estimate is unreliable rather than merely imprecise, so
   those points are flagged instead of plotted at full confidence. */
const e1rmValue = p => (p.reps !== '' && p.reps != null && !isNaN(num(p.reps)) && num(p.reps) > 0)
  ? Math.round(est1RM(p.weight, num(p.reps)) * 10) / 10 : null;
const isHighRep = p => p.reps !== '' && p.reps != null && !isNaN(num(p.reps)) && num(p.reps) > 12;

function openChart(ex, dayId) {
  chartFor = { ex, dayId };
  drawChart();
  openSheet('chartSheet');
}

function drawChart() {
  if (!chartFor) return;
  const { ex, dayId } = chartFor;
  const profile = getProfile(), block = getBlock();
  const host = $('chartHost');

  $('chartTitle').textContent = ex.n;
  $('chartScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === chartScope ? 'true' : 'false');
    b.onclick = () => { chartScope = b.dataset.scope; drawChart(); };
  });
  $('chartMetric').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.metric === chartMetric ? 'true' : 'false');
    b.onclick = () => { chartMetric = b.dataset.metric; drawChart(); };
  });

  const isE1rm = chartMetric === 'e1rm';
  const valueCol = isE1rm ? '1RM est.' : 'Peso';
  /* The 1RM series plots est1RM(weight, reps) per point; unreliable
     (>12-rep) points are kept in the table but dropped from the chart's
     line and marked so they don't read as trustworthy. */
  const toSeriesPoint = p => {
    if (!isE1rm) return { weight: p.weight, muted: false, display: p.weight, reliable: true };
    const v = e1rmValue(p);
    return { weight: v == null ? p.weight : v, muted: v == null || isHighRep(p), display: v, reliable: v != null && !isHighRep(p) };
  };
  const rowCell = (p, sp) => sp.display == null ? '—' : (sp.reliable ? '' : '≈ ') + sp.display + ' ' + esc(units());

  if (chartScope === 'all') {
    const points = collectHistoryAll(profile, ex.id, chartMetric);
    $('chartSub').textContent = 'Todos los bloques de ' + profile.label +
      ' — ' + (isE1rm ? '1RM estimado (Epley) de cada sesión registrada, en ' + units() + '.' :
        'mejor peso de cada sesión registrada, en ' + units() + ' (× repeticiones de esa serie).');
    if (!points.length) {
      host.innerHTML = '<p class="chart-empty">Aún no hay series completadas con peso para este ejercicio en ningún bloque.</p>';
      return;
    }
    const series = points.map((p, i) => Object.assign({ i: i + 1, reps: p.reps }, toSeriesPoint(p)));
    let html = buildChartSVG(series, points.map(p => p.label));
    html += '<table class="chart-table"><thead><tr><th>Sesión</th><th>' + valueCol + '</th><th>Reps</th></tr></thead><tbody>';
    points.forEach((p, i) => {
      const sp = series[i];
      html += '<tr' + (sp.reliable ? '' : ' class="unreliable"') + '><td>' + esc(p.label) + '</td><td>' + rowCell(p, sp) + '</td><td>' + esc(p.reps || '—') + '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
    return;
  }

  const weeks = blockWeeks(block);
  const points = collectHistory(profile, block.id, dayId, ex.id, weeks, chartMetric);
  $('chartSub').textContent = block.name + ' — ' + (isE1rm ? '1RM estimado (Epley) por semana, en ' + units() + '.' :
    'mejor peso registrado por semana, en ' + units() + ' (× repeticiones de esa serie).');
  if (!points.length) {
    host.innerHTML = '<p class="chart-empty">Aún no hay series completadas con peso para este ejercicio en este bloque.</p>';
    return;
  }
  const ticks = [];
  for (let w = 1; w <= weeks; w++) ticks.push('S' + w);
  const series = points.map(p => Object.assign({ i: p.week, reps: p.reps }, toSeriesPoint(p)));
  let html = buildChartSVG(series, ticks);
  html += '<table class="chart-table"><thead><tr><th>Semana</th><th>' + valueCol + '</th><th>Reps</th></tr></thead><tbody>';
  points.forEach((p, i) => {
    const sp = series[i];
    html += '<tr' + (sp.reliable ? '' : ' class="unreliable"') + '><td>Semana ' + p.week + '</td><td>' + rowCell(p, sp) + '</td><td>' + esc(p.reps || '—') + '</td></tr>';
  });
  html += '</tbody></table>';
  host.innerHTML = html;
}

$('chartClose').onclick = () => closeSheet('chartSheet');
$('chartSheet').addEventListener('click', e => { if (e.target.id === 'chartSheet') closeSheet('chartSheet'); });

/* ---------- warm-up ramp & plate calculator ----------
   A standalone tool, not wired to any particular exercise or set: enter a
   working weight, get a warm-up ramp and — for barbell work — the plates
   for each side. Bar weight and the available plate set are settings
   (state.prefs.barWeight/.plates, defaulted in migrate() and editable from
   Ajustes) so this sheet only ever reads them. */
const DEFAULT_BAR_WEIGHT = { kg: 20, lb: 45 };
const DEFAULT_PLATES = { kg: [1.25, 2.5, 5, 10, 15, 20], lb: [2.5, 5, 10, 25, 35, 45] };
const DEFAULT_STACK_INC = { kg: 5, lb: 10 };

const roundToStep = (v, step) => step > 0 ? Math.round(v / step) * step : v;

/* 40/60/80% of the target, each rounded to the nearest loadable step and
   never below `floor` (the empty bar, on barra mode) — the actual target
   weight is a separate, unrounded fourth row, since a plate breakdown for
   *that* has to fit the number you asked for, not a rounded stand-in. */
function warmupRamp(target, step, floor) {
  return [0.4, 0.6, 0.8].map(p => Math.max(floor || 0, roundToStep(target * p, step)));
}

/* Greedy fit, largest plate first. The available set can land short of an
   exact fit (e.g. a gap smaller than the smallest plate) — the remainder is
   reported rather than hidden, so a breakdown that doesn't add up is never
   shown as if it did. */
function fitPlates(perSide, plateSet) {
  const sorted = (plateSet || []).filter(p => p > 0).sort((a, b) => b - a);
  let remaining = Math.max(0, perSide);
  const used = [];
  sorted.forEach(p => {
    while (remaining - p > -1e-6) { used.push(p); remaining -= p; }
  });
  remaining = Math.round(remaining * 100) / 100;
  return { plates: used, remainder: remaining > 0.01 ? remaining : 0 };
}

let calcDraft = { mode: 'bar', target: '', inc: '' };

function openCalc() {
  if (!(num(calcDraft.inc) > 0)) calcDraft.inc = String(DEFAULT_STACK_INC[units()]);
  drawCalc();
  openSheet('calcSheet');
}

function drawCalc() {
  const u = units();
  $('calcTargetU').textContent = u;
  $('calcIncU').textContent = u;
  $('calcMode').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === calcDraft.mode ? 'true' : 'false');
    b.onclick = () => { calcDraft.mode = b.dataset.mode; drawCalc(); };
  });
  const isBar = calcDraft.mode === 'bar';
  $('calcIncField').style.display = isBar ? 'none' : '';
  if ($('calcTarget').value !== calcDraft.target) $('calcTarget').value = calcDraft.target;
  if ($('calcInc').value !== calcDraft.inc) $('calcInc').value = calcDraft.inc;

  const barWeight = state.prefs.barWeight;
  const plates = state.prefs.plates;
  $('calcBarHint').style.display = isBar ? '' : 'none';
  $('calcBarHint').textContent = isBar
    ? 'Barra de ' + barWeight + ' ' + u + ', discos de ' + plates.join('/') + ' ' + u + ' — cámbialo en Ajustes.'
    : '';

  const target = num(calcDraft.target);
  const out = $('calcOut');
  if (!(target > 0)) { out.innerHTML = ''; return; }

  if (isBar && target < barWeight) {
    out.innerHTML = '<p class="chart-empty">El peso objetivo es menor que la barra (' + barWeight + ' ' + esc(u) + ').</p>';
    return;
  }

  const labels = ['40%', '60%', '80%', 'Objetivo'];
  let rows;
  if (isBar) {
    const smallest = plates.length ? Math.min(...plates) : DEFAULT_PLATES[u][0];
    const step = smallest * 2;
    const weights = warmupRamp(target, step, barWeight).concat([target]);
    rows = weights.map((w, i) => {
      const perSide = (w - barWeight) / 2;
      const fit = fitPlates(perSide, plates);
      const plateTxt = fit.plates.length ? fit.plates.join(' + ') : '(vacía)';
      const remTxt = fit.remainder ? ' · falta ' + fit.remainder + ' ' + u : '';
      return '<tr><td>' + labels[i] + '</td><td>' + (Math.round(w * 100) / 100) + ' ' + esc(u) + '</td><td>' + esc(plateTxt + remTxt) + '</td></tr>';
    });
    out.innerHTML = '<table class="chart-table"><thead><tr><th>Paso</th><th>Peso total</th><th>Por lado</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  } else {
    const inc = num(calcDraft.inc) > 0 ? num(calcDraft.inc) : DEFAULT_STACK_INC[u];
    const weights = warmupRamp(target, inc, 0).concat([target]);
    rows = weights.map((w, i) => '<tr><td>' + labels[i] + '</td><td>' + (Math.round(w * 100) / 100) + ' ' + esc(u) + '</td></tr>');
    out.innerHTML = '<table class="chart-table"><thead><tr><th>Paso</th><th>Peso</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
}

$('calcTarget').addEventListener('input', e => { calcDraft.target = e.target.value; drawCalc(); });
$('calcInc').addEventListener('input', e => { calcDraft.inc = e.target.value; drawCalc(); });
$('calcBtn').onclick = openCalc;
$('calcClose').onclick = () => closeSheet('calcSheet');
$('calcSheet').addEventListener('click', e => { if (e.target.id === 'calcSheet') closeSheet('calcSheet'); });

/* ---------- volume dashboard ----------
   A weekly hard-sets-per-tag view: the same kind of count the README's own
   volume analysis reasons about in prose, made visible in the app. The tag
   can come from any of VOLUME_DIMENSIONS (muscle/pattern/type) — "what does
   this hit" and "what shape is this movement" are different, orthogonal
   questions, and a plan that looks balanced on one can still be lopsided on
   the other (e.g. plenty of press volume but almost all of it isolation). */

/* The tags actually in play for this block on one dimension, in
   first-seen order — there is no fixed list any more, so the row set a bar
   chart draws has to come from whoever tagged these exercises, not from the
   app. Retired exercises are already excluded by dayList/exList, same as
   everywhere else they're hidden from. */
function blockTagsFor(dim, block) {
  const tagFn = VOLUME_DIMENSIONS[dim].tag;
  const tags = [];
  dayList(block).forEach(day => {
    exList(day).forEach(ex => { const t = tagFn(ex); if (tags.indexOf(t) < 0) tags.push(t); });
  });
  return tags;
}

/* Set counts by tag for one dimension and scope: 'plan' goes through the
   same setsFor() the session view uses, so deload halving and "+1 serie
   desde semana N" are already respected; 'log' counts sets actually ticked
   done this week. Both are seeded from blockTagsFor() first so toggling
   between them never adds or drops a bar — only the numbers move, which is
   the point of a plan-vs-adherence comparison. */
function volumeTotals(scope, profile, block, week, dim) {
  const tagFn = VOLUME_DIMENSIONS[dim].tag;
  const totals = {};
  blockTagsFor(dim, block).forEach(t => { totals[t] = 0; });
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      const t = tagFn(ex);
      if (scope === 'log') {
        const s = profile.log[block.id] && profile.log[block.id][slot(week, day.id)];
        const rows = s && s[ex.id];
        if (Array.isArray(rows)) totals[t] += rows.filter(r => r && r.done).length;
      } else {
        totals[t] += setsFor(ex, week, block);
      }
    });
  });
  return totals;
}

/* One row per tag that's actually in play, sorted by set count descending —
   including the ones at zero, since seeing which of *this block's own*
   muscles aren't getting hit this week is as much the point as the
   ranking. Ties fall back to alphabetical so the table doesn't reshuffle
   from one open to the next. */
function volumeRows(totals) {
  return Object.keys(totals).map(tag => ({ label: tag, value: totals[tag] }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'es'));
}

/* Kilos moved in this block, week by week — index 0 is week 1, and a week
   with nothing ticked stays at zero rather than disappearing.
   The log is walked raw here instead of through dayList/exList, unlike the
   set counts above: a retired exercise's sets were still lifted, and rows
   parked past an exercise's current set count were still lifted too.
   Hiding them from the plan doesn't unlift them. Weeks past the block's
   current length are left out for the same reason the session view hides
   them — the "series en semanas por encima" notice is what speaks for
   those. */
function blockTonnageByWeek(profile, block) {
  const weeks = blockWeeks(block);
  const out = new Array(weeks).fill(0);
  const blk = profile.log[block.id] || {};
  Object.keys(blk).forEach(k => {
    const m = /^w(\d+)-/.exec(k);
    if (!m) return;
    const w = +m[1];
    if (w < 1 || w > weeks) return;
    const s = blk[k] || {};
    Object.keys(s).forEach(exId => {
      const rows = s[exId];
      if (Array.isArray(rows)) out[w - 1] += rows.reduce((t, r) => t + setVolume(r), 0);
    });
  });
  return out;
}

/* Horizontal sibling of buildChartSVG: one bar per row, same monospace
   labels and accent colour so it reads as the same chart family. */
function buildBarSVG(rows) {
  const W = 600, rowH = 26, padT = 6, padB = 6, labelW = 122, valueW = 34;
  const barMaxW = W - labelW - valueW;
  const H = rows.length * rowH + padT + padB;
  const max = Math.max(1, ...rows.map(r => r.value));
  const barH = 14;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img">';
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    const barY = y + (rowH - barH) / 2;
    const w = r.value > 0 ? Math.max(2, (r.value / max) * barMaxW) : 0;
    svg += '<text x="0" y="' + (y + rowH / 2 + 4) + '" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono, monospace">' + esc(r.label) + '</text>';
    svg += '<rect x="' + labelW + '" y="' + barY + '" width="' + barMaxW + '" height="' + barH + '" fill="var(--sunk)" rx="2"/>';
    if (w > 0) svg += '<rect x="' + labelW + '" y="' + barY + '" width="' + w + '" height="' + barH + '" fill="var(--signal)" rx="2"/>';
    svg += '<text x="' + (labelW + barMaxW + 6) + '" y="' + (y + rowH / 2 + 4) + '" font-size="11" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + r.value + '</text>';
  });
  svg += '</svg>';
  return svg;
}

/* The kilos strip above the bars. It answers a different question from
   the chart below it — "how much have I actually shifted in this block",
   not "where did this week's sets go" — so it sits in its own boxed row and
   ignores both toggles: tonnage only ever comes from what was ticked done,
   there is no plan-side number to compare it against. */
function drawVolumeTonnage(profile, block, week) {
  const byWeek = blockTonnageByWeek(profile, block);
  const total = byWeek.reduce((t, v) => t + v, 0);
  const thisWeek = byWeek[week - 1] || 0;
  const logged = byWeek.filter(v => v > 0).length;
  const host = $('volumeTonnage');
  if (!total) {
    host.innerHTML = '<p class="vol-kg-empty">Aún no has movido ningún kilo en este bloque.</p>';
    return;
  }
  /* Early in a block the two figures are the same number twice, which reads
     as a bug rather than as a total. One tile until they diverge. */
  if (total === thisWeek) {
    host.innerHTML = '<div><b>' + esc(fmtKg(total)) + '</b><span>movidos en el bloque, todo en la semana ' + week + '</span></div>';
    return;
  }
  host.innerHTML =
    '<div><b>' + esc(fmtKg(total)) + '</b><span>movidos en el bloque · ' +
      (logged === 1 ? '1 semana registrada' : logged + ' semanas registradas') + '</span></div>' +
    '<div><b>' + esc(fmtKg(thisWeek)) + '</b><span>' +
      (thisWeek ? 'esta semana (semana ' + week + ')' : 'aún nada esta semana (semana ' + week + ')') + '</span></div>';
}

let volumeScope = 'plan';  /* 'plan' | 'log' */
let volumeDim = 'muscle';  /* key into VOLUME_DIMENSIONS */

function openVolume() {
  drawVolume();
  openSheet('volumeSheet');
}

function drawVolume() {
  const profile = getProfile(), block = getBlock();
  const week = profile.week;
  $('volumeScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === volumeScope ? 'true' : 'false');
    b.onclick = () => { volumeScope = b.dataset.scope; drawVolume(); };
  });
  $('volumeDim').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.dim === volumeDim ? 'true' : 'false');
    b.onclick = () => { volumeDim = b.dataset.dim; drawVolume(); };
  });

  drawVolumeTonnage(profile, block, week);

  const dimLabel = VOLUME_DIMENSIONS[volumeDim].label.toLowerCase();
  const isLog = volumeScope === 'log';
  const totals = volumeTotals(isLog ? 'log' : 'plan', profile, block, week, volumeDim);
  $('volumeSub').textContent = block.name + ' — semana ' + week + ' — ' +
    (isLog ? 'series marcadas como hechas esta semana, por ' + dimLabel + '.'
           : 'series que pide el plan esta semana, por ' + dimLabel + ' (ya cuenta la descarga y las series añadidas).');

  const rows = volumeRows(totals);
  const host = $('volumeHost');
  if (!rows.some(r => r.value > 0)) {
    host.innerHTML = '<p class="chart-empty">' +
      (isLog ? 'Aún no hay ninguna serie marcada como hecha esta semana.' : 'Este bloque no tiene series programadas esta semana.') +
      '</p>';
    return;
  }
  let html = buildBarSVG(rows);
  html += '<table class="chart-table"><thead><tr><th>' + esc(VOLUME_DIMENSIONS[volumeDim].label) + '</th><th>Series</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + esc(r.label) + '</td><td>' + r.value + '</td></tr>'; });
  html += '</tbody></table>';
  host.innerHTML = html;
}

$('volumeBtn').onclick = openVolume;
$('volumeClose').onclick = () => closeSheet('volumeSheet');
$('volumeSheet').addEventListener('click', e => { if (e.target.id === 'volumeSheet') closeSheet('volumeSheet'); });

/* ---------- backup nag ----------
   "A lost phone with no backup is a lost history" per the README's own
   Known Limits, and nothing used to remind you. Sessions-since-last-export
   is computable from data the app already has, so this rides on top of it
   rather than asking for anything new: a day's sets going from incomplete
   to complete (see the tick handler in drawApp) is close enough to "a
   session happened" for a gentle nag, not a precise ledger. */
function resetBackupNag() {
  state.prefs.sessionsSinceBackup = 0;
  save();
}

function maybeNagBackup() {
  const n = state.prefs.sessionsSinceBackup;
  if (n >= 10 && n % 10 === 0) {
    toast('Llevas ' + n + ' sesiones sin hacer una copia de seguridad. Un móvil perdido sin copia es historial perdido.',
      'Copia de seguridad', () => $('backup').click());
  }
}

/* ---------- backup / restore ---------- */
$('backup').onclick = () => {
  $('blob').value = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state });
  renderProfileExports();
  openSheet('sheet');
};
$('bClose').onclick = () => closeSheet('sheet');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet('sheet'); });

$('bDownload').onclick = () => {
  const payload = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
  downloadFile('heavy-iron-backup-' + new Date().toISOString().slice(0, 10) + '.json', payload, 'application/json');
  resetBackupNag();
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
    resetBackupNag();
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
  if (!data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) return 'no tiene perfiles';
  /* Whatever the profiles are called — the two this app shipped with, or the
     names you gave them — a backup has to carry at least one, and every one
     it does carry has to be readable. */
  const keys = Object.keys(data.profiles);
  if (!keys.length) return 'no tiene ningún perfil';
  for (const pk of keys) {
    const problem = describeProfileProblem(data.profiles[pk], pk);
    if (problem) return problem;
  }
  return null;
}

/* One profile's worth of the same checks, so a single-profile file gets the
   same scrutiny as a full backup before it replaces anything. */
function describeProfileProblem(p, pk) {
  const who = (p && p.label) || pk || 'sin nombre';
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'el perfil "' + who + '" está corrupto';
  if (!p.blocks || typeof p.blocks !== 'object' || !Object.keys(p.blocks).length) return 'el perfil "' + who + '" no tiene bloques';
  if (p.log && typeof p.log !== 'object') return 'el registro del perfil "' + who + '" está corrupto';
  for (const bk of Object.keys(p.blocks)) {
    const b = p.blocks[bk];
    if (!b || typeof b !== 'object') return 'el bloque "' + bk + '" de "' + who + '" está corrupto';
    if (!Array.isArray(b.days)) return 'el bloque "' + (b.name || bk) + '" de "' + who + '" no tiene días';
  }
  return null;
}

function countProfileSets(p) {
  let n = 0;
  const log = p && p.log;
  if (!log || typeof log !== 'object') return 0;
  Object.keys(log).forEach(bId => {
    const blk = log[bId];
    if (!blk || typeof blk !== 'object') return;
    Object.keys(blk).forEach(k => {
      const sl = blk[k];
      if (!sl || typeof sl !== 'object') return;
      Object.keys(sl).forEach(exId => { if (Array.isArray(sl[exId])) n += sl[exId].filter(rowUsed).length; });
    });
  });
  return n;
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

async function restoreFromText(text) {
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

  const okd = await ask({
    title: '¿Reemplazar todo tu registro con esta copia?',
    body: 'Copia' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Ahora mismo tienes: ' + setsLabel(mine) + '.\n\n' +
      (theirs < mine ? 'La copia tiene MENOS registro que lo que hay ahora — comprueba que es la que quieres. ' : '') +
      'No se puede deshacer.',
    okLabel: 'Reemplazar', danger: true,
  });
  if (!okd) return;

  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  migrate();
  applyTheme();
  save(); render();
  closeSheet('sheet');
  flushSave();
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

/* ---------- moving one person between phones ----------
   The two of you train together but each phone keeps its own log, and a full
   restore replaces everything — so there was no way to put her history on his
   device without destroying his. A profile file carries exactly one person,
   and loading it overwrites exactly that one. */
function profileExportPayload(key) {
  return JSON.stringify({
    app: STORAGE_KEY, kind: 'profile', v: 1,
    saved: new Date().toISOString(),
    key,
    profile: state.profiles[key],
  }, null, 2);
}

function renderProfileExports() {
  const host = $('profileExports');
  host.innerHTML = '';
  profileKeys().forEach(key => {
    const profile = state.profiles[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm';
    b.textContent = 'Exportar ' + profile.label;
    b.onclick = () => {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadFile('heavy-iron-' + (slugify(profile.label) || key) + '-' + stamp + '.json',
                   profileExportPayload(key), 'application/json');
      resetBackupNag();
      mark(profile.label + ' exportado — ' + setsLabel(countProfileSets(profile)));
    };
    host.appendChild(b);
  });
}

async function loadProfileFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese archivo no es un perfil válido', true); return; }

  if (!parsed || parsed.kind !== 'profile' || !parsed.profile) {
    mark('Eso no es un perfil suelto. Si es una copia completa, usa "Cargar copia".', true);
    return;
  }

  const incoming = parsed.profile;
  const problem = describeProfileProblem(incoming, parsed.key);
  if (problem) { mark('Ese perfil no se puede usar: ' + problem, true); return; }

  /* Land it on the slot it came from. The keys are internal and never
     renamed, so this matches whoever exported it; a file from somewhere
     stranger falls back to the profile you are looking at. */
  const target = (parsed.key && state.profiles[parsed.key]) ? parsed.key : state.activeProfile;
  const local = state.profiles[target];
  const theirs = countProfileSets(incoming);
  const mine = countProfileSets(local);
  const when = parsed.saved ? new Date(parsed.saved) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  const others = profileKeys().filter(k => k !== target).map(k => state.profiles[k].label);

  const okd = await ask({
    title: '¿Sustituir el perfil de ' + local.label + '?',
    body: 'Entra "' + (incoming.label || target) + '"' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Se reemplaza ' + local.label + ', que tiene ahora ' + setsLabel(mine) + '.\n\n' +
      (others.length ? others.join(' y ') + ' no se toca' + (others.length > 1 ? 'n' : '') + '. ' : '') +
      'No se puede deshacer.',
    okLabel: 'Sustituir', danger: true,
  });
  if (!okd) return;

  snapshotForUndo('Perfil de ' + local.label + ' sustituido.');
  state.profiles[target] = incoming;
  migrate();
  applyTheme();
  save(); render();
  closeSheet('sheet');
  /* Flushed before the message, not after: save() is debounced 400 ms and
     ends in mark('Guardado …'), so anything said here would be wiped off the
     status line half a second later, unread. Everything below that reports
     the result of an import does the same. */
  flushSave();
  mark(state.profiles[target].label + ' cargado — ' + setsLabel(theirs) + landingNote(state.profiles[target]));
}

/* A profile carries the week its owner was on, and that is where it opens —
   which is usually a week they have not trained yet. So the session shows no
   ticks, and the weight boxes show the greyed placeholder from last week,
   which looks exactly like a transfer that arrived stripped of its ✓. It is
   not: the history is a week back. Say so, because the alternative is the
   person concluding their partner's log did not survive the trip. */
function landingNote(profile) {
  const block = profile.blocks[profile.activeBlock];
  if (!block) return '';
  const week = clampInt(profile.week, 1, MAX_WEEKS, 1);
  let inWeek = 0, earlier = 0;
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      for (let w = 1; w <= blockWeeks(block); w++) {
        const s = profile.log[block.id] && profile.log[block.id][slot(w, day.id)];
        const rows = s && s[ex.id];
        if (!Array.isArray(rows)) continue;
        const n = rows.filter(r => r && r.done).length;
        if (w === week) inWeek += n; else if (w < week) earlier += n;
      }
    });
  });
  if (inWeek || !earlier) return '';
  return ' · abre en la semana ' + week + ', que aún está sin marcar — el registro está en las semanas anteriores';
}

$('pUploadBtn').onclick = () => $('pUpload').click();
$('pUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadProfileFromText(reader.result);
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- QR transfer ----------
   The two of you are standing next to each other in a gym with no signal and
   one of you edited the plan. Every other way to move it — a file, a chat, a
   mail to yourself — needs something this app deliberately does not have: a
   network. The camera is the one channel that is already there.

   So: one phone draws the data as QR codes, the other reads them off the
   screen. Nothing is uploaded, nothing is fetched, the CSP is untouched
   (`getUserMedia` is not a network request and both libraries are vendored
   under `script-src 'self'`), and the "nothing leaves the device" promise in
   the README stays literally true — the data goes device → photons → device.

   Three things can be sent, smallest first, because size is the whole problem:

     bloque    the plan only. Usually one or two frames.
     bloque+   the plan *and* every set logged against it, for the profile
               sending it. The common case: "put my block on your phone so we
               can both see where I am."
     perfil    the whole profile — every block, every log. Biggest, slowest,
               and it *replaces* a profile on the other phone rather than
               adding to it, so it asks first through the same confirmation
               the file-based profile transfer already uses.

   A single QR that a phone camera can actually read across a gym holds a few
   hundred bytes, and a profile with months of history is tens of kilobytes.
   So the payload is deflated, base64'd and cut into numbered frames that
   cycle on screen; the reader collects them by index until it has the set.
   Frames may arrive in any order and repeat freely — that is the point of
   the animation, you just hold the phone there until it fills up. */

const QR_MAGIC = 'HI1';
/* Base64 characters per frame. Plus a ~30-character header this lands each
   frame at QR version 18 (89×89 modules) at error-correction level M, which
   is about as dense as a phone screen can be read at arm's length in bad
   light. Raising it means fewer frames that are each harder to catch. */
const QR_CHUNK = 480;
/* Past this the animation takes longer than a person will stand still for,
   and the file-based transfer is simply the better tool. */
const QR_MAX_FRAMES = 60;
const QR_FRAME_MS = 500;

/* Rows arrive from a camera, so they get the same treatment as any other
   imported data: bounded, coerced, never trusted for length or type. */
const LOG_LIMITS = { rows: 24, val: 12, slots: MAX_WEEKS * IMPORT_LIMITS.days };

/* ---- checksum ----
   QR carries Reed–Solomon error correction of its own: a frame that decodes
   at all is essentially never wrong, so per-frame checksums would be belt
   and braces. What is worth catching is a *reassembly* fault — frames from
   two different shares mixed together, or a chunk quietly lost. The random
   transfer id catches the first, this CRC over the whole payload the
   second, and it is checked before anything is parsed. */
const CRC32_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(str) {
  let c = 0 ^ (-1);
  for (let i = 0; i < str.length; i++) c = (c >>> 8) ^ CRC32_TABLE[(c ^ str.charCodeAt(i)) & 0xFF];
  return ((c ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

/* ---- base64url ----
   Plain base64 uses '+' and '/', and '/' is awkward the moment any of this
   is ever pasted into a URL or a file name. The url-safe alphabet costs
   nothing and avoids the question. Padding is dropped and re-added on the
   way back in. */
function bytesToB64u(bytes) {
  let bin = '';
  /* String.fromCharCode has an argument limit, so this walks in slices
     rather than spreading a 40 000-byte array into one call. */
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---- compression ----
   A block's log is the same three keys repeated a few hundred times, which
   is exactly what deflate is good at — usually an 8–10× win, and that is
   the difference between four frames and forty. CompressionStream is in
   every browser this app targets, but if it is missing the payload simply
   travels uncompressed and the header says so, rather than the feature
   disappearing. */
async function qrDeflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch (e) { return null; }
}

async function qrInflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/* ---- frames ----
   HI1|<id>|<index>|<total>|<crc32>|<enc>|<data>
   `id` is a random per-transfer tag: start a second share while someone is
   still scanning the first and the reader notices the id changed and starts
   over, instead of welding halves of two payloads together. */
async function qrPackFrames(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const squeezed = await qrDeflate(raw);
  /* Only take the compressed form if it actually won — for a tiny payload
     deflate's own header can make it bigger. */
  const useDeflate = squeezed && squeezed.length < raw.length;
  const b64 = bytesToB64u(useDeflate ? squeezed : raw);
  const enc = useDeflate ? 'd' : 'p';
  const id = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const crc = crc32(b64);
  const total = Math.max(1, Math.ceil(b64.length / QR_CHUNK));
  const frames = [];
  for (let i = 0; i < total; i++) {
    frames.push([QR_MAGIC, id, i, total, crc, enc, b64.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK)].join('|'));
  }
  return { frames, id, total, bytes: raw.length, sent: b64.length, enc };
}

function qrParseFrame(text) {
  if (typeof text !== 'string') return null;
  const p = text.split('|');
  if (p.length < 7 || p[0] !== QR_MAGIC) return null;
  const i = +p[2], n = +p[3];
  if (!Number.isInteger(i) || !Number.isInteger(n)) return null;
  if (n < 1 || n > QR_MAX_FRAMES || i < 0 || i >= n) return null;
  if (!/^[0-9a-f]{8}$/.test(p[4]) || (p[5] !== 'd' && p[5] !== 'p')) return null;
  /* Anything after the sixth separator is payload. base64url never contains
     '|', so this only ever rejoins a single piece — it is here so a stray
     separator can't silently truncate the data. */
  return { id: p[1], i, n, crc: p[4], enc: p[5], data: p.slice(6).join('|') };
}

/* The receiving end of a transfer: hand it whatever the camera decoded and
   it tells you where it is up to. Deliberately a plain object with no DOM
   in it, so the whole protocol can be round-tripped in a test without a
   camera anywhere near it. */
function qrReceiver() {
  return {
    id: null, total: 0, crc: '', enc: '', parts: new Map(),
    get count() { return this.parts.size; },
    get complete() { return this.total > 0 && this.parts.size === this.total; },
    reset() { this.id = null; this.total = 0; this.crc = ''; this.enc = ''; this.parts = new Map(); },
    /* 'foreign'  — not one of ours (a wifi QR, a poster, noise)
       'restart'  — a different transfer appeared; the old partial is dropped
       'added'    — a frame we did not have
       'dup'      — one we already had, which is most of them while it cycles */
    accept(text) {
      const f = qrParseFrame(text);
      if (!f) return 'foreign';
      let status = 'added';
      if (this.id !== f.id) { this.reset(); this.id = f.id; status = 'restart'; }
      this.total = f.n; this.crc = f.crc; this.enc = f.enc;
      if (this.parts.has(f.i)) return status === 'restart' ? 'restart' : 'dup';
      this.parts.set(f.i, f.data);
      return status;
    },
    joined() {
      let out = '';
      for (let i = 0; i < this.total; i++) {
        const part = this.parts.get(i);
        if (part == null) return null;
        out += part;
      }
      return out;
    },
    /* Throws rather than returning null on a bad payload: every failure here
       is worth showing the person holding the phone, and they are different
       problems with different fixes. */
    async payload() {
      /* Checked before joining so an empty or half-filled receiver says what
         is actually wrong, rather than failing the checksum further down and
         blaming the frames it did get. */
      if (!this.complete) throw new Error('Faltan fotogramas.');
      const b64 = this.joined();
      if (b64 == null) throw new Error('Faltan fotogramas.');
      if (crc32(b64) !== this.crc) throw new Error('Los fotogramas no encajan — vuelve a escanear.');
      let bytes = b64uToBytes(b64);
      if (this.enc === 'd') {
        if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir el código.');
        bytes = await qrInflate(bytes);
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}

/* ---- what gets sent ----
   Retired days and exercises (`off`) are left out on purpose: you are
   sharing the plan as you see it, and the import path has no concept of a
   retired item anyway, so sending them would quietly resurrect them on the
   other phone. Their log rows go with them. */
function blockSharePlan(block) {
  return {
    name: block.name,
    weeks: blockWeeks(block),
    deload: block.deload,
    phase: block.phase,
    days: dayList(block).map(d => {
      const out = { id: d.id, name: d.name, ex: exList(d).map(e => Object.assign({}, e)) };
      if (d.pair) out.pair = d.pair;
      return out;
    }),
  };
}

/* Every set logged against one block, stripped of the padding rows that
   `entry()` creates just by opening a day. Those are the majority of rows in
   a fresh block and carry no information, so dropping them is most of the
   reason a real log fits on a screen at all. */
function blockShareLog(profile, block) {
  const src = profile.log[block.id];
  if (!src) return {};
  const liveDays = dayList(block);
  const out = {};
  liveDays.forEach(day => {
    const liveEx = exList(day).map(e => e.id);
    for (let w = 1; w <= MAX_WEEKS; w++) {
      const key = slot(w, day.id);
      const slotLog = src[key];
      if (!slotLog) continue;
      const kept = {};
      liveEx.forEach(exId => {
        const rows = slotLog[exId];
        if (!Array.isArray(rows)) return;
        let last = -1;
        rows.forEach((r, i) => { if (rowUsed(r)) last = i; });
        if (last < 0) return;
        kept[exId] = rows.slice(0, last + 1).map(r => {
          const row = { w: r && r.w != null ? String(r.w) : '', r: r && r.r != null ? String(r.r) : '', done: !!(r && r.done) };
          if (r && Number.isFinite(+r.ts) && +r.ts > 0) row.ts = +r.ts;
          /* Half-typed segments are dropped rather than sent: they are worth
             nothing on the other phone and every byte here costs QR frames.
             `dk` only travels when there is something for it to describe. */
          const drops = dropsOf(r).filter(dropUsed)
            .map(d => ({ w: d.w != null ? String(d.w) : '', r: d.r != null ? String(d.r) : '' }));
          if (drops.length) { row.d = drops; row.dk = dropKind(r); }
          return row;
        });
      });
      if (Object.keys(kept).length) out[key] = kept;
    }
  });
  return out;
}

/* Every RIR chip logged against one block, in the same {slot: {exId: value}}
   shape blockShareLog uses for rows — kept separate from it (see the RIR
   section near getRir/setRir) so a receiver that doesn't know about `rir`
   yet still parses the rest of the payload fine. */
function blockShareRir(profile, block) {
  const src = profile.rir[block.id];
  if (!src) return {};
  const liveDays = dayList(block);
  const out = {};
  liveDays.forEach(day => {
    const liveEx = new Set(exList(day).map(e => e.id));
    for (let w = 1; w <= MAX_WEEKS; w++) {
      const key = slot(w, day.id);
      const slotRir = src[key];
      if (!slotRir) continue;
      const kept = {};
      Object.keys(slotRir).forEach(exId => {
        if (liveEx.has(exId) && RIR_OPTIONS.indexOf(slotRir[exId]) >= 0) kept[exId] = slotRir[exId];
      });
      if (Object.keys(kept).length) out[key] = kept;
    }
  });
  return out;
}

/* Two different numbers, and the difference is the whole point of showing
   them. A row counts as "registrada" the moment it holds anything at all —
   including a weight typed into the box and then never ticked. Only a row
   marked *done* feeds the progress chart, the RÉCORD badge or the volume
   dashboard. A transfer carries both kinds faithfully, so a block that was
   full of untouched numbers before it was sent is still full of them after,
   and the sheet has to say so rather than promising "234 series" and
   handing over a chart with nothing in it. */
function countShareLog(log, onlyDone) {
  let n = 0;
  Object.keys(log || {}).forEach(k => {
    const s = log[k];
    Object.keys(s || {}).forEach(exId => {
      if (!Array.isArray(s[exId])) return;
      n += s[exId].filter(r => (onlyDone ? !!(r && r.done) : rowUsed(r))).length;
    });
  });
  return n;
}

/* The done-only twin of blockLoggedSets, for the same reason. */
function blockDoneSets(profile, blockId) {
  const blk = profile.log[blockId];
  if (!blk) return 0;
  let n = 0;
  Object.keys(blk).forEach(k => {
    const s = blk[k];
    if (!s) return;
    Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(r => r && r.done).length; });
  });
  return n;
}

/* "12 series registradas" when every one of them is ticked, and the fuller
   "…, 9 marcadas como hechas" when they are not — silence when there is
   nothing to warn about. */
function setsWithDoneLabel(total, done) {
  if (!total || done === total) return setsLabel(total);
  return setsLabel(total) + ', ' + done + ' marcada' + (done === 1 ? '' : 's') + ' como hecha' + (done === 1 ? '' : 's');
}

/* ---- what arrives ----
   The mirror of the above, and the reason it exists: the block came through
   `normalizeImportedBlock`, which may have renamed an id it did not like, so
   a log keyed by the *sender's* ids has to be re-keyed to the ids the block
   actually ended up with. `normalizeImportedBlock` maps days and exercises
   one-to-one and in order, so position is a reliable bridge between the two. */
/* Shared by normalizeImportedLog and normalizeImportedRir: both need to
   re-key a payload from the sender's day/exercise ids to whatever
   `normalizeImportedBlock` renamed them to. First occurrence wins, both here
   and for days. A sender whose block had the same id on two exercises leaves
   a mapping that is genuinely ambiguous — but `normalizeImportedBlock`
   renames the *later* duplicate and leaves the first one's id alone, so rows
   filed under that id belong to the first. Letting the duplicate overwrite
   the mapping would quietly move somebody's sets onto a different
   exercise. */
function importIdMaps(rawBlock, normalized) {
  const dayMap = {}, exMap = {};
  const put = (map, from, to) => { if (from != null && !(String(from) in map)) map[String(from)] = to; };
  (rawBlock.days || []).forEach((rd, di) => {
    const nd = normalized.days[di];
    if (!nd || !rd) return;
    put(dayMap, rd.id, nd.id);
    /* A log already keyed by the id the block ended up with still resolves. */
    put(dayMap, nd.id, nd.id);
    (Array.isArray(rd.ex) ? rd.ex : []).forEach((re, ei) => {
      const ne = nd.ex[ei];
      if (!ne || !re) return;
      put(exMap, re.id, ne.id);
      put(exMap, ne.id, ne.id);
    });
  });
  return { dayMap, exMap };
}

function normalizeImportedLog(rawLog, rawBlock, normalized) {
  if (!rawLog || typeof rawLog !== 'object' || Array.isArray(rawLog)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(rawLog).slice(0, LOG_LIMITS.slots).forEach(key => {
    const m = /^w(\d+)-(.+)$/.exec(key);
    if (!m) return;
    const w = +m[1];
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[m[2]];
    if (!dayId) return;
    const slotLog = rawLog[key];
    if (!slotLog || typeof slotLog !== 'object' || Array.isArray(slotLog)) return;
    const kept = {};
    Object.keys(slotLog).forEach(rawExId => {
      const exId = exMap[rawExId];
      if (!exId || !Array.isArray(slotLog[rawExId])) return;
      const rows = slotLog[rawExId].slice(0, LOG_LIMITS.rows).map(r => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return { w: '', r: '', done: false };
        const row = { w: txt(r.w, LOG_LIMITS.val), r: txt(r.r, LOG_LIMITS.val), done: !!r.done };
        if (Number.isFinite(+r.ts) && +r.ts > 0) row.ts = +r.ts;
        const drops = (Array.isArray(r.d) ? r.d : []).slice(0, MAX_DROPS)
          .filter(d => d && typeof d === 'object' && !Array.isArray(d))
          .map(d => ({ w: txt(d.w, LOG_LIMITS.val), r: txt(d.r, LOG_LIMITS.val) }))
          .filter(dropUsed);
        if (drops.length) {
          row.d = drops;
          row.dk = DROP_KINDS.indexOf(r.dk) >= 0 ? r.dk : 'drop';
        }
        return row;
      });
      if (rows.length) kept[exId] = rows;
    });
    if (Object.keys(kept).length) out[slot(w, dayId)] = kept;
  });
  return out;
}

/* The RIR twin of normalizeImportedLog, re-keyed the same way. */
function normalizeImportedRir(rawRir, rawBlock, normalized) {
  if (!rawRir || typeof rawRir !== 'object' || Array.isArray(rawRir)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(rawRir).slice(0, LOG_LIMITS.slots).forEach(key => {
    const m = /^w(\d+)-(.+)$/.exec(key);
    if (!m) return;
    const w = +m[1];
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[m[2]];
    if (!dayId) return;
    const slotRir = rawRir[key];
    if (!slotRir || typeof slotRir !== 'object' || Array.isArray(slotRir)) return;
    const kept = {};
    Object.keys(slotRir).forEach(rawExId => {
      const exId = exMap[rawExId];
      if (exId && RIR_OPTIONS.indexOf(slotRir[rawExId]) >= 0) kept[exId] = slotRir[rawExId];
    });
    if (Object.keys(kept).length) out[slot(w, dayId)] = kept;
  });
  return out;
}

/* ---- drawing one frame ----
   Always dark-on-light with a four-module quiet zone, whatever the app's
   theme is: an inverted QR is a coin flip across readers, and the person
   pointing a camera at this has no way to know that is why it will not
   catch. One <path> rather than a rect per module — a version-17 code is
   7 000 modules and that many elements makes the animation stutter. */
function buildQrSVG(text) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    }
  }
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="qr-svg" shape-rendering="crispEdges" ' +
         'role="img" aria-label="Código QR"><rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
         '<path d="' + d + '" fill="#000"/></svg>';
}

/* ---- loading the two vendored libraries ----
   Neither is touched until this sheet opens, so the app still starts on the
   same bytes it did before the feature existed. Injecting a same-origin
   <script> is allowed by `script-src 'self'` — no CSP change, which is the
   whole reason they are vendored rather than pulled from a CDN. */
const qrScripts = {};
function loadScriptOnce(src) {
  if (!qrScripts[src]) {
    qrScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete qrScripts[src]; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return qrScripts[src];
}
const qrEncoderReady = () => (typeof qrcode !== 'undefined' ? Promise.resolve() : loadScriptOnce('js/vendor/qrcode.js'));
const qrDecoderReady = () => (typeof jsQR !== 'undefined' ? Promise.resolve() : loadScriptOnce('js/vendor/jsQR.js'));

/* ---------- the sheet ---------- */
let qrMode = 'show';           /* 'show' | 'scan' */
let qrKind = 'blocklog';       /* what the show side is sending */
let qrFrames = [];
let qrAt = 0;
let qrTimer = null;
let qrPaused = false;
let qrStream = null;
let qrScanTimer = null;
let qrRx = null;
let qrBusy = false;
let qrShowToken = 0;

function openQr() {
  qrMode = 'show';
  openSheet('qrSheet');
  drawQr();
}

/* Everything this sheet starts has to be stopped here: a timer redrawing a
   QR nobody is looking at is merely wasteful, but a camera left streaming
   after the sheet closes is a light on the phone and a fair question about
   what this app is doing. */
function closeQr() {
  stopQrShow();
  stopQrScan();
  closeSheet('qrSheet');
}

/* Bumping the token is what cancels a build still in flight — closing the
   sheet while the deflate is running would otherwise let it finish and start
   an interval redrawing frames into a panel nobody can see. */
function stopQrShow() {
  qrShowToken++;
  if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
  qrFrames = []; qrAt = 0; qrPaused = false;
}

function stopQrScan() {
  if (qrScanTimer) { clearInterval(qrScanTimer); qrScanTimer = null; }
  if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  const v = $('qrVideo');
  if (v) v.srcObject = null;
  qrRx = null;
}

function drawQr() {
  $('qrMode').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === qrMode ? 'true' : 'false');
    b.onclick = () => {
      if (qrMode === b.dataset.mode) return;
      stopQrShow(); stopQrScan();
      qrMode = b.dataset.mode;
      drawQr();
    };
  });
  const showing = qrMode === 'show';
  $('qrShowPane').style.display = showing ? '' : 'none';
  $('qrScanPane').style.display = showing ? 'none' : '';
  if (showing) { stopQrScan(); drawQrShow(); }
  else { stopQrShow(); startQrScan(); }
}

/* ---- show ---- */
function drawQrShow() {
  const profile = getProfile(), block = getBlock();
  const logged = blockLoggedSets(profile, block.id);
  const doneSets = blockDoneSets(profile, block.id);

  $('qrKind').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.kind === qrKind ? 'true' : 'false');
    b.onclick = () => { qrKind = b.dataset.kind; drawQrShow(); };
  });

  const desc = {
    block: 'Solo el plan de "' + block.name + '": ejercicios, series, repeticiones y descansos. ' +
           'Se añade como bloque nuevo en el otro móvil, sin tocar nada de lo que ya tenga.',
    blocklog: 'El plan de "' + block.name + '" y lo que llevas hecho en él: ' + setsWithDoneLabel(logged, doneSets) + '. ' +
              'También entra como bloque nuevo: no sustituye nada.' +
              (logged > doneSets
                ? ' Ojo: las ' + (logged - doneSets) + ' sin marcar viajan con su peso y sus reps, pero llegan sin marcar — ' +
                  'igual que aquí, no cuentan para las gráficas hasta que les des al ✓.'
                : ''),
    profile: 'Todo el perfil de ' + profile.label + ': todos sus bloques y todo su registro. ' +
             'En el otro móvil sustituye a ese perfil entero — te lo preguntará antes.',
  }[qrKind];
  $('qrShowDesc').textContent = desc;

  const host = $('qrHost');
  host.innerHTML = '<p class="chart-empty">Preparando…</p>';
  $('qrCount').textContent = '';
  stopQrShow();

  const token = ++qrShowToken;

  buildQrPayload(qrKind, profile, block)
    .then(async payload => {
      await qrEncoderReady();
      const packed = await qrPackFrames(payload);
      /* The sheet may have been closed, or the selection changed, while the
         libraries and the deflate were in flight. */
      if (token !== qrShowToken) return;
      if (packed.total > QR_MAX_FRAMES) {
        host.innerHTML = '<p class="chart-empty">Esto ocupa demasiado para pasarlo por la cámara (' +
          packed.total + ' fotogramas). Usa "Descargar copia" o "Exportar ' + esc(profile.label) +
          '" y pasa el archivo.</p>';
        return;
      }
      qrFrames = packed.frames;
      qrAt = 0;
      renderQrFrame();
      if (qrFrames.length > 1) {
        qrTimer = setInterval(() => {
          if (qrPaused) return;
          qrAt = (qrAt + 1) % qrFrames.length;
          renderQrFrame();
        }, QR_FRAME_MS);
      }
    })
    .catch(e => {
      if (token !== qrShowToken) return;
      host.innerHTML = '<p class="chart-empty">' + esc(e.message || 'No se pudo generar el código.') + '</p>';
    });
}

async function buildQrPayload(kind, profile, block) {
  const base = { app: STORAGE_KEY, v: 1, saved: new Date().toISOString() };
  if (kind === 'profile') {
    /* Shaped exactly like the profile file the app already exports, so the
       receiving side can hand it straight to loadProfileFromText. */
    resetBackupNag();
    return Object.assign(base, { kind: 'profile', key: state.activeProfile, profile: state.profiles[state.activeProfile] });
  }
  const plan = blockSharePlan(block);
  if (kind === 'block') return Object.assign(base, { kind: 'block', from: profile.label, block: plan });
  return Object.assign(base, { kind: 'blocklog', from: profile.label, block: plan, log: blockShareLog(profile, block), rir: blockShareRir(profile, block) });
}

function renderQrFrame() {
  const host = $('qrHost');
  try {
    host.innerHTML = buildQrSVG(qrFrames[qrAt]);
  } catch (e) {
    host.innerHTML = '<p class="chart-empty">No se pudo dibujar el código.</p>';
    stopQrShow();
    return;
  }
  const total = qrFrames.length;
  $('qrCount').textContent = total === 1
    ? 'Un solo código — apunta con el otro móvil.'
    : 'Fotograma ' + (qrAt + 1) + '/' + total + ' — mantén el otro móvil apuntando hasta que los recoja todos.';
  $('qrPause').style.display = total > 1 ? '' : 'none';
  $('qrPause').textContent = qrPaused ? 'Reanudar' : 'Pausa';
}

/* ---- scan ---- */
async function startQrScan() {
  const status = $('qrScanStatus');
  qrRx = qrReceiver();
  status.textContent = 'Pidiendo permiso para la cámara…';
  $('qrScanProgress').textContent = '';

  let stream;
  try {
    await qrDecoderReady();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    /* No camera, no permission, or an insecure origin. None of them are worth
       a dead end: the file transfer above does the same job. */
    status.textContent = e && e.message === 'nocam'
      ? 'Este navegador no da acceso a la cámara. Usa "Cargar copia" o "Cargar un perfil" con un archivo.'
      : 'Sin acceso a la cámara. Dale permiso en el navegador, o pasa los datos con un archivo desde los botones de arriba.';
    return;
  }
  if (qrMode !== 'scan' || !$('qrSheet').classList.contains('up')) { stream.getTracks().forEach(t => t.stop()); return; }

  qrStream = stream;
  const video = $('qrVideo');
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  try { await video.play(); } catch (e) { /* some browsers resolve this late; the frame loop copes */ }
  status.textContent = 'Apunta al código del otro móvil.';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  qrScanTimer = setInterval(() => {
    if (qrBusy || !qrStream || !video.videoWidth) return;
    /* Downscaled: a version-17 code still resolves to several pixels per
       module at this width, and reading a full 1280px frame every 120 ms
       makes the preview stutter on an older phone. */
    const scale = Math.min(1, 720 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let result;
    try {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    } catch (e) { return; }
    if (!result || !result.data) return;

    const status2 = qrRx.accept(result.data);
    if (status2 === 'foreign') return;
    $('qrScanProgress').textContent = 'Recibido ' + qrRx.count + '/' + qrRx.total;
    if (!qrRx.complete) return;

    qrBusy = true;
    const rx = qrRx;
    stopQrScan();
    $('qrScanStatus').textContent = 'Comprobando…';
    rx.payload()
      .then(payload => applyQrPayload(payload))
      .catch(e => { mark(e.message || 'No se pudo leer el código', true); })
      .then(() => { qrBusy = false; });
  }, 120);
}

/* The last step, and the one place all of this rejoins the app: every kind
   lands in the confirmation flow that the file-based transfer already uses,
   so arriving by camera is not a way to get looser validation than arriving
   by file. */
async function applyQrPayload(payload) {
  if (!payload || typeof payload !== 'object') { mark('Ese código no trae datos de Heavy Iron', true); return; }

  if (payload.kind === 'profile') {
    closeQr();
    await loadProfileFromText(JSON.stringify(payload));
    return;
  }

  if (payload.kind === 'block' || payload.kind === 'blocklog') {
    let normalized;
    try {
      normalized = normalizeImportedBlock(payload.block);
    } catch (e) {
      mark('Ese bloque no se puede usar: ' + e.message, true);
      return;
    }
    const log = payload.kind === 'blocklog' ? normalizeImportedLog(payload.log, payload.block, normalized) : null;
    const rir = payload.kind === 'blocklog' ? normalizeImportedRir(payload.rir, payload.block, normalized) : null;
    const sets = log ? countShareLog(log) : 0;
    const doneSets = log ? countShareLog(log, true) : 0;
    const profile = getProfile();
    const from = txt(payload.from, IMPORT_LIMITS.name);

    const okd = await ask({
      title: '¿Añadir "' + normalized.name + '"?',
      body: 'Llega' + (from ? ' de ' + from : '') + ': ' + normalized.days.length +
        (normalized.days.length === 1 ? ' día' : ' días') + ', ' + normalized.weeks +
        (normalized.weeks === 1 ? ' semana' : ' semanas') +
        (log ? ' y ' + setsWithDoneLabel(sets, doneSets) : ', sin registro') + '.\n\n' +
        (log && sets > doneSets
          ? 'Las ' + (sets - doneSets) + ' sin marcar traen peso y reps pero llegan sin el ✓, tal y como estaban en el otro móvil.\n\n'
          : '') +
        'Entra como bloque nuevo en ' + profile.label + ' y pasa a ser el bloque activo. ' +
        'No se toca nada de lo que ya tienes.',
      okLabel: 'Añadir',
    });
    if (!okd) return;

    closeQr();
    installImportedBlock(normalized, log, rir);
    flushSave();
    mark('Bloque "' + normalized.name + '" añadido' + (log && sets ? ' con ' + setsWithDoneLabel(sets, doneSets) : '') + ' en ' + profile.label);
    return;
  }

  mark('Ese código es de otra cosa, no de Heavy Iron', true);
}

$('qrBtn').onclick = openQr;
$('qrClose').onclick = closeQr;
$('qrSheet').addEventListener('click', e => { if (e.target.id === 'qrSheet') closeQr(); });
$('qrPause').onclick = () => { qrPaused = !qrPaused; renderQrFrame(); };

/* ---------- CSV export ----------
   One row per logged set, for looking at the numbers somewhere the app
   cannot: a spreadsheet, a chart, a coach's inbox. Deliberately one-way —
   the .json is what restores, and mixing the two up loses data. */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv() {
  const rows = [['perfil', 'bloque', 'semana', 'dia', 'ejercicio', 'serie', units(), 'reps', 'hecha', 'fecha', 'rir', 'bajadas', 'tipo_bajada']];
  Object.keys(state.profiles).forEach(pk => {
    const profile = state.profiles[pk];
    profile.blockOrder.forEach(bId => {
      const block = profile.blocks[bId];
      block.days.forEach(day => {
        day.ex.forEach(ex => {
          for (let w = 1; w <= blockWeeks(block); w++) {
            const s = profile.log[bId] && profile.log[bId][slot(w, day.id)];
            const arr = s && s[ex.id];
            if (!Array.isArray(arr)) continue;
            /* The RIR chip is per exercise per session, not per set, so it
               repeats on every row of that exercise/week rather than
               belonging to any one of them. */
            const rir = getRir(profile, bId, w, day.id, ex.id);
            arr.forEach((r, i) => {
              if (!rowUsed(r)) return;
              /* Drops stay on their set's own row, as "45x5 30x4", rather
                 than becoming rows of their own — "serie" has to keep
                 meaning the set number the plan asked for, or every count
                 taken off this file stops matching the app's. */
              const used = dropsOf(r).filter(dropUsed);
              const drops = used.map(d => (d.w == null ? '' : d.w) + 'x' + (d.r == null ? '' : d.r)).join(' ');
              rows.push([profile.label, block.name, w, day.name, ex.n, i + 1, r.w, r.r,
                         r.done ? 'si' : 'no', r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '', rir,
                         drops, used.length ? DROP_LABEL[dropKind(r)] : '']);
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
