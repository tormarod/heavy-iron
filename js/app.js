const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
/* Keys of the "Ajustes" (machine setup) boxes expanded right now — in-memory
   only, so every fresh open of the app starts collapsed again. Keyed by
   profile + block + exercise id, not the exercise id alone: JSON-authored
   blocks reuse ids across blocks and profiles on purpose (sameLift), so an
   id-only key left a panel opened for one profile's "squat" pre-expanded for
   the other's. */
const expandedSetup = new Set();
const setupKey = (block, ex) => state.activeProfile + '|' + block.id + '|' + ex.id;
/* Set by the ↓ and ⚙ buttons so the draw they trigger can put the cursor
   straight into a box that does not exist until that draw has run. Both are
   honoured by takeFocusMark() once the card is in the document, because the
   card is detached while it is being built and focus() on a detached element
   is silently a no-op. Cleared as soon as they are honoured. */
let focusDrop = '';
let focusSetup = '';
/* One entry per card currently on screen, in card order: the exercise, the
   card element, the row array it is drawing (by reference, so the tick
   handler can ask whether the whole day just became done), and the numbers
   the line under the session adds up. Rebuilding one card replaces its entry
   in place — that, rather than a fresh walk of the log, is what keeps the
   footer honest after a single-card redraw. */
let dayCards = [];

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

/* Plate bounds. The only filter used to be `p > 0`, so a near-zero plate
   typed into Ajustes (or sitting in a hand-edited or restored backup) made
   fitPlates() below loop on the order of target/p times, growing an array,
   on every Calculadora open — a same-device hang from a single bad number. */
const PLATE_MIN = { kg: 0.25, lb: 0.5 }, PLATE_MAX = { kg: 50, lb: 100 };

/* The step to fall back on when an exercise declares no `inc` of its own —
   and most don't, since it is an optional field. Something has to round the
   target weight below to a number you can actually load, so the chain runs
   exercise → your own default (Ajustes) → this. Deliberately the smallest
   plate/stack step that exists on most equipment rather than a typical one:
   rounding to a step finer than the machine has only ever costs you the
   difference between two real notches, while rounding to a coarser one
   invents jumps the stack cannot make.

   Only ever used for ROUNDING a number the app shows you. copyPrev stays
   keyed on an explicit `ex.inc`: it writes weights into the log, and
   defaulting a step for an exercise nobody declared one for would quietly
   put +2,5 kg on a 12 kg lateral raise. */
const DEFAULT_INC = { kg: 2.5, lb: 5 };

/* Never call this before migrate() has run — it reads state.prefs. */
const incFor = ex => {
  const own = ex ? num(ex.inc) : NaN;
  if (own > 0) return own;
  const pref = num(state && state.prefs && state.prefs.inc);
  return pref > 0 ? pref : DEFAULT_INC[units()];
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
  /* A thrown read is not the same as an absent key: readRaw() folds both
     into null, which used to seed a fresh device over data a flaky read
     might well still be sitting on. Read directly here so the two cases
     stay apart — a genuine first run goes on to seed as before, a throw
     goes to recovery, which at least offers "Reintentar" instead of
     silently overwriting whatever is actually on disk once save() runs. */
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    showRecovery(e, null, 'read');
    return;
  }
  const firstRun = raw == null;
  if (firstRun) {
    state = defaultState();
    state.setupDone = false;
  } else {
    /* Anything that is on disk but unreadable goes to the recovery screen
       rather than being replaced: the seed plan written back over it would
       be the last thing that ever happened to a training history nobody
       else has a copy of. Repairable damage is migrate()'s job, below —
       this is only for bytes we cannot get a state object out of at all. */
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      showRecovery(e, raw);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.profiles) {
      showRecovery(new Error('Los datos guardados no tienen la forma que la app espera.'), raw);
      return;
    }
    state = parsed;
  }
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
    if (ACCENTS.indexOf(profile.theme) < 0 && !LEGACY_ACCENT[profile.theme]) profile.theme = seed.theme;
    if (!profile.log || typeof profile.log !== 'object') profile.log = {};
    if (!profile.rir || typeof profile.rir !== 'object') profile.rir = {};
    /* Two more parallel maps with the same blockId → slot shape as `rir`,
       and absent by default for the same reason. Unlike RIR they describe
       the *session* rather than a set, which is why they are keyed by slot
       alone with no exercise under them. */
    if (!profile.notes || typeof profile.notes !== 'object') profile.notes = {};
    if (!profile.energy || typeof profile.energy !== 'object') profile.energy = {};
    /* A third one with the same shape, holding an array of exercise ids
       rather than a string — the order the session was actually done in.
       See getOrder/setOrder: absent means "in the order the plan asks
       for", which is the overwhelming majority of sessions. */
    if (!profile.order || typeof profile.order !== 'object') profile.order = {};
    Object.keys(profile.order).forEach(bk => {
      const blk = profile.order[bk];
      if (!blk || typeof blk !== 'object' || Array.isArray(blk)) { delete profile.order[bk]; return; }
      Object.keys(blk).forEach(k => {
        const ids = blk[k];
        if (!Array.isArray(ids)) { delete blk[k]; return; }
        const seen = new Set();
        blk[k] = ids.filter(id => typeof id === 'string' && id && !seen.has(id) && seen.add(id)).slice(0, ORDER_LIMIT);
        if (!blk[k].length) delete blk[k];
      });
    });
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
      /* Absent by default, like `share`/`ss`: a block nobody has marked
         priorities on carries no field at all rather than an empty list. */
      if (block.priority != null) {
        const pri = cleanPriority(block.priority);
        if (pri.length) block.priority = pri; else delete block.priority;
      }
      if (!Array.isArray(block.days)) block.days = [];
      block.days = block.days.filter(d => d && typeof d === 'object');
      if (!block.days.length) block.days = [{ id: 'd0', name: 'Día 1', ex: [newExercise()] }];

      /* Log rows are filed under a day's *id*, so every day needs one and no
         two days may share it. Legacy data was keyed by index ('w3-d1'), so
         the old days get the ids 'd0', 'd1', … — the keys come out identical
         and nothing has to be rewritten. */
      const usedDays = new Set();
      block.days.forEach((day, i) => {
        let id = safeKey(day.id);
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
          let id2 = safeKey(ex.id);
          if (!id2 || usedEx.has(id2)) { id2 = slugify(ex.n) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
          ex.id = id2;
          usedEx.add(id2);
          ex.sets = clampInt(ex.sets, 1, 12, 3);
          ex.rest = clampInt(ex.rest, 0, 900, 90);
          if (ex.reps == null || ex.reps === '') ex.reps = '10–15';
          if (!ex.muscle) { if (MUSCLE_BY_ID[ex.id]) ex.muscle = MUSCLE_BY_ID[ex.id]; }
          else { const m = safeKey(txt(ex.muscle, MUSCLE_LIMIT)); if (m) ex.muscle = m; else delete ex.muscle; }
          if (ex.pattern != null) { const p = safeKey(txt(ex.pattern, PATTERN_LIMIT)); if (p) ex.pattern = p; else delete ex.pattern; }
          if (ex.type != null) { const t = safeKey(txt(ex.type, TYPE_LIMIT)); if (t) ex.type = t; else delete ex.type; }
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
  /* Whether the rest alarm keeps working with the phone in a pocket, and
     whether the browser has already been asked to protect the log — see
     keepAliveStart() and askForPersistenceOnce(). */
  state.prefs.bgAlarm = !!state.prefs.bgAlarm;
  state.prefs.persistAsked = !!state.prefs.persistAsked;
  /* A label, never a conversion: you write down the number on the machine,
     and this is what the app calls it. */
  if (['kg', 'lb'].indexOf(state.prefs.units) < 0) state.prefs.units = 'kg';
  /* Calculator defaults, seeded once from whatever unit is active at the
     time — like everything else under units(), never rescaled later, so
     switching kg/lb afterwards does not silently reinterpret a saved bar
     or plate set. */
  if (!(num(state.prefs.barWeight) > 0)) state.prefs.barWeight = DEFAULT_BAR_WEIGHT[state.prefs.units];
  else state.prefs.barWeight = num(state.prefs.barWeight);
  /* Your default weight step, for every exercise that doesn't declare its
     own `inc`. Seeded from the active unit exactly like the bar weight, and
     never rescaled afterwards for the same reason. */
  state.prefs.inc = clampNum(state.prefs.inc, INC_MIN, INC_MAX, 0, INC_STEP) || DEFAULT_INC[state.prefs.units];
  if (!Array.isArray(state.prefs.plates) || !state.prefs.plates.length) {
    state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  } else {
    state.prefs.plates = state.prefs.plates.map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]);
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

/* A row's weight is a label, never a conversion (see migrate(), above) —
   the session view shows every number exactly as typed, in whatever unit
   was active that day, and that choice stays untouched here. But a screen
   that fits one line through many sessions (diagnostics, the block review)
   cannot read two unit's numbers as one series without a real conversion,
   so writes stamp which unit the row is in and those screens convert on
   the way out. `u` is stamped only when it differs from kg — the same
   convention as `share`/`ss`, stored only when true — so a row with no `u`
   is read as kg whether that is because it predates this stamp or because
   it really was written in kg; the two are indistinguishable and both are
   correctly read the same way. */
const LB_PER_KG = 1 / 0.45359237;  /* exact: the international pound */
function convertWeight(v, fromUnit, toUnit) {
  if (!isFinite(v) || fromUnit === toUnit) return v;
  return fromUnit === 'kg' ? v * LB_PER_KG : v / LB_PER_KG;
}
const rowUnit = r => (r && r.u === 'lb') ? 'lb' : 'kg';
function rowWeight(r, toUnit) {
  return convertWeight(num(r && r.w), rowUnit(r), toUnit || units());
}
function stampRowUnit(r) {
  if (units() === 'lb') r.u = 'lb'; else delete r.u;
}

/* Writes are debounced so typing a weight doesn't serialise the whole log on
   every keystroke — but a debounce you never flush is a debounce that loses
   the last set of the session when the phone goes in your pocket. Every path
   out of the page flushes it: see the pagehide/visibilitychange handlers. */
let saveT = null;
let frozen = false;
/* Which session the cards on screen are drawing — set by drawApp, read by
   pruneLog, which must not cut the ground out from under it. */
let drawnSlot = null;

/* entry() pads a session's row arrays out to the plan's set count so that the
   boxes on the card write into live objects. The side effect is that merely
   *looking* at a week leaves a full set of blank rows behind for every
   exercise on it, and every save from then on serialises them: page through a
   twelve-week block once and the log carries eleven weeks of nothing, for
   good.

   They say nothing — every reader filters on done or rowUsed — so trailing
   unused rows are dropped here, on the way to localStorage, along with the
   exercise and slot containers that browsing alone created.

   Every session except the one on screen. Those particular row objects are
   the ones this draw's <input> handlers are holding by reference, and cutting
   them out of the array would send a weight typed into the last set nowhere
   at all. It is the only session that can be padded and live at once: entry()
   is reached from drawApp and from copyPrev, and both work on the week and
   day being shown. */
function pruneLog() {
  if (!state || !state.profiles) return;
  Object.keys(state.profiles).forEach(pKey => {
    const log = state.profiles[pKey] && state.profiles[pKey].log;
    if (!log || typeof log !== 'object') return;
    Object.keys(log).forEach(bId => {
      const blk = log[bId];
      if (!blk || typeof blk !== 'object') return;
      Object.keys(blk).forEach(k => {
        if (drawnSlot && drawnSlot.profile === pKey && drawnSlot.block === bId && drawnSlot.key === k) return;
        const sl = blk[k];
        if (!sl || typeof sl !== 'object') return;
        Object.keys(sl).forEach(exId => {
          const rows = sl[exId];
          if (!Array.isArray(rows)) return;
          let end = rows.length;
          while (end > 0 && !rowUsed(rows[end - 1])) end--;
          if (end < rows.length) rows.length = end;
          if (!rows.length) delete sl[exId];
        });
        if (!Object.keys(sl).length) delete blk[k];
      });
    });
  });
}
/* Set while a two-tab conflict toast is up (see the 'storage' handler below)
   and cleared by whichever of its two actions the user picks. The debounced
   path respects it so the write that caused the conflict cannot land behind
   the user's back while the toast is still asking; flushSave always passes
   force so closing the tab never silently drops a logged set — see its own
   comment below. */
let held = false;

/* A failed setItem (quota, private-mode limits) used to be reported only in
   the footer #status line — easy to miss, and every later keystroke retries
   and fails the same way, so a whole session could go unsaved with nothing
   above the fold to say so. The toast fires once per page load; the footer
   line still updates on every attempt for anyone who is looking at it. */
let quotaToastShown = false;

function writeState(force) {
  if (frozen) return;
  if (held && !force) return;
  held = false;
  try {
    pruneLog();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mark('Guardado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    mark('No se ha podido guardar — puede que no quede espacio en el navegador', true);
    if (!quotaToastShown) {
      quotaToastShown = true;
      toast('No se han podido guardar los últimos cambios — puede que no quede espacio en el navegador. Descarga una copia antes de seguir.',
        'Copia de seguridad', () => $('backup').click());
    }
  }
}

function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = null; writeState(); }, 400);
}

/* Always forces the write through, even mid-conflict: an unanswered toast
   must never be the reason a set logged right before closing the tab is
   lost. The conflict itself was never about *whether* to keep local
   changes — only about not overwriting the other tab's newer ones out from
   under the user without asking first. */
function flushSave() {
  if (!saveT && !held) return;
  clearTimeout(saveT);
  saveT = null;
  writeState(true);
}

window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);
/* The phone going into a pocket is the most likely moment for the tab to be
   discarded, and it is exactly when the last set was just typed. The other
   half of this event — re-reading the clock the rest timer was counting
   against — belongs to js/rest-timer.js and has its own listener there. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

/* Two tabs (or the installed app and a browser tab) share one localStorage.
   The event only fires in the *other* tab, so anything arriving here is a
   write we did not make: adopt it when we have nothing pending, and say so
   when we do rather than silently overwriting it on our next flush.

   Cancelling the pending timer here is the fix: it used to keep running and
   fire up to 400 ms later regardless, landing before anyone could have read
   the toast, let alone answered it — the two-tab guarantee the README sells
   was really just a message that arrived after the fact. */
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || frozen || !ready) return;
  if (saveT || held) {
    clearTimeout(saveT);
    saveT = null;
    held = true;
    toast(
      'Otra pestaña ha guardado cambios. Aquí tienes cambios sin guardar.',
      'Quedarme con lo mío', () => { held = false; writeState(true); },
      'Recargar', () => location.reload()
    );
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

/* ---------- keeping the log ----------
   There is no server: the only copy of a year of training is the string in
   localStorage. A browser is allowed to throw that away when the phone runs
   short of space — "best effort" is the default for every site — and the
   log is exactly the kind of small, rarely-read data that looks disposable
   from the outside.

   navigator.storage.persist() asks for the other bucket, the one the
   browser evicts only when you clear the site yourself. Installing the app
   is what makes the ask cheap: Chrome grants it to an installed app without
   asking anybody, and Firefox shows one prompt. It is asked for once, after
   the first setup is saved (there is finally something to lose), and can be
   asked for again from the backup sheet if that was denied or dismissed. */

const canPersist = () => !!(navigator.storage && navigator.storage.persist);

function persisted() {
  if (!canPersist()) return Promise.resolve(false);
  return navigator.storage.persisted().catch(() => false);
}

/* Resolves to whether the log is protected *now* — false covers "asked and
   denied" and "browser doesn't do this" alike, because the answer the caller
   acts on is the same in both cases. */
function askForPersistence() {
  if (!canPersist()) return Promise.resolve(false);
  return persisted().then(already => already || navigator.storage.persist().catch(() => false));
}

/* Asked once per device, and never again by itself: a permission prompt that
   comes back every launch is a permission prompt that gets denied for good. */
function askForPersistenceOnce() {
  if (state.prefs.persistAsked) return;
  state.prefs.persistAsked = true;
  save();
  askForPersistence();
}

/* What the log itself weighs. Deliberately not navigator.storage.estimate():
   that reports the whole origin — caches, service worker, fonts — and next
   to a quota measured in gigabytes it reads as "no problem" whether the log
   is 40 KB or gone. This number is the one somebody worried about their
   training history is actually asking about. */
function logBytes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Blob([raw]).size : 0;
  } catch (e) { return 0; }
}

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

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
/* A second action (actionLabel2/fn2) is for the rare toast offering two real
   choices rather than one action and a dismiss — today only the two-tab
   conflict, above. Omit them for the common one-action-or-none toast. */
function toast(msg, actionLabel, fn, actionLabel2, fn2) {
  $('toastMsg').textContent = msg;
  const act = $('toastAct');
  if (actionLabel) {
    act.hidden = false;
    act.textContent = actionLabel;
    act.onclick = () => { hideToast(); fn(); };
  } else {
    act.hidden = true;
  }
  const act2 = $('toastAct2');
  if (actionLabel2) {
    act2.hidden = false;
    act2.textContent = actionLabel2;
    act2.onclick = () => { hideToast(); fn2(); };
  } else {
    act2.hidden = true;
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
/* Its own variable, not the sheet stack's `sheetReturn` below: a confirm
   raised from inside an open sheet (wipe, delete block) used to null that
   shared variable on close, so when the sheet itself closed afterwards focus
   had nowhere to return to. */
let askReturn = null;

function closeAsk(value) {
  const done = askResolve;
  askResolve = null;
  $('askSheet').classList.remove('up');
  /* isConnected: a re-render between open and close can have already
     replaced the element that opened this dialog with an equivalent new
     one — focusing the old, detached node is a silent no-op, so skip it
     rather than pretend focus went somewhere. */
  if (askReturn && askReturn.isConnected && askReturn.focus) askReturn.focus();
  askReturn = null;
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
  /* .hidden, not .style.display: the markup ships with the `hidden`
     attribute (plans/008 item 22 — no inline style="" left in index.html),
     and clearing an inline style would leave that attribute in charge,
     never showing the field at all. */
  input.hidden = !opts.textInput;
  if (opts.textInput) {
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    input.setAttribute('aria-label', opts.title || 'Valor');
  }

  askReturn = document.activeElement;
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
  closeAsk(input.hidden ? true : input.value);
};
$('askCancel').onclick = () => closeAsk($('askInput').hidden ? false : null);
$('askSheet').addEventListener('click', e => {
  if (e.target.id === 'askSheet') closeAsk($('askInput').hidden ? false : null);
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

/* "auto" is resolved into an explicit light/dark right here — the same
   thing js/theme-init.js does before this script has even loaded, so the
   attribute this writes always matches what the first paint already used.
   Writing "auto" itself as data-theme, or removing the attribute, would put
   the dark palette back into a @media(prefers-color-scheme) block of its
   own instead of the single :root[data-theme="dark"] one css/style.css now
   has (plans/008 item 20). */
const systemPrefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

function applyTheme() {
  const t = (state.prefs && state.prefs.theme) || 'auto';
  document.documentElement.setAttribute('data-theme', t === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : t);
  const b = $('themeBtn');
  b.textContent = THEME_ICON[t];
  b.title = 'Tema ' + THEME_LABEL[t];
  b.setAttribute('aria-label', 'Tema ' + THEME_LABEL[t] + ' — cambiar');
}

/* Only matters in "auto": the explicit resolution above means the OS
   switching light/dark mid-session no longer repaints itself through CSS,
   so this is what keeps that live instead of waiting for the next reload. */
if (window.matchMedia) {
  const themeMq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => { if (ready && (!state.prefs || state.prefs.theme === 'auto')) applyTheme(); };
  if (themeMq.addEventListener) themeMq.addEventListener('change', onSystemThemeChange);
  else if (themeMq.addListener) themeMq.addListener(onSystemThemeChange);
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
    inc: state.prefs.inc,
    bgAlarm: !!state.prefs.bgAlarm,
    /* On a first run the name boxes start empty, so the placeholder invites
       you to type rather than making you clear somebody else's name out
       first. Left empty, the shipped label stands. */
    /* Active profile first, always — not just insertion order. Solo mode
       only shows/asks for people[0] and saves activeProfile as its key
       (below), so if the second profile were active and this stayed in
       insertion order, turning on "Solo yo" would silently rename the
       *first* profile and switch onto their log instead. */
    people: [state.activeProfile, ...profileKeys().filter(k => k !== state.activeProfile)].map(key => ({
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
  $('setupIncField').style.display = firstRun ? 'none' : '';
  $('setupBgField').style.display = firstRun ? 'none' : '';
  $('setupBarWeight').value = setupDraft.barWeight;
  $('setupPlates').value = setupDraft.platesText;
  $('setupInc').value = setupDraft.inc;
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
  $('setupBgAlarm').querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.bg === 'on';
    b.setAttribute('aria-pressed', on === setupDraft.bgAlarm ? 'true' : 'false');
    b.onclick = () => { setupDraft.bgAlarm = on; renderSetup(); };
  });
  $('setupBgHint').textContent = setupDraft.bgAlarm
    ? 'El aviso suena aunque bloquees el móvil o te vayas a otra app, y el descanso aparece en la pantalla de bloqueo con −30 / +30 / saltar. Para conseguirlo la app reproduce un sonido inaudible mientras dura el descanso: en algunos móviles eso pausa la música que estés escuchando. Si el móvil lo permite, además te avisa con una notificación.'
    : 'Con el móvil bloqueado o en otra app, el aviso llega cuando vuelves a mirar la pantalla. Actívalo si entrenas con el móvil en el bolsillo.';
  $('setupBarWeightU').textContent = setupDraft.units;
  $('setupIncU').textContent = setupDraft.units;
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
$('setupInc').addEventListener('input', e => { if (setupDraft) setupDraft.inc = e.target.value; });

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
  const bgAlarmTurnedOn = setupDraft.bgAlarm && !state.prefs.bgAlarm;
  state.prefs.bgAlarm = setupDraft.bgAlarm;
  if (!state.prefs.bgAlarm) keepAliveStop();
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
    state.prefs.inc = DEFAULT_INC[state.prefs.units];
  } else {
    const bw = num(setupDraft.barWeight);
    if (bw > 0) state.prefs.barWeight = bw;
    const plates = String(setupDraft.platesText || '').split(',').map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]);
    if (plates.length) state.prefs.plates = plates;
    const inc = clampNum(setupDraft.inc, INC_MIN, INC_MAX, 0, INC_STEP);
    if (inc > 0) state.prefs.inc = inc;
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
  /* There is something worth keeping now, and this click is a user gesture,
     which is the moment a browser is willing to hear the question. */
  askForPersistenceOnce();
  /* Only ever asked from this click, and only when the setting has just been
     switched on — the notification is the half of it that survives the page
     being frozen, and this is the one place the user asked for it. */
  if (bgAlarmTurnedOn) askForNotifications();
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
   hand the raw bytes over as a file before anything is thrown away.

   `mode` tells the three causes apart. Omitted (undefined) is load()'s
   JSON.parse/shape checks: the *data* is unreadable — "Empezar de cero" is a
   real way out, alongside downloading the raw bytes first. 'read' is
   readRaw() throwing before any bytes were even retrieved (private mode,
   storage blocked, a transient failure) — there are no bytes to download and
   the data on disk may well be intact, so "Reintentar" leads and the download
   button and its "download before anything else" copy don't show at all.
   'draw' is render()'s catch: the data parsed fine and migrate() already
   repaired its shape, so a throw here is a deterministic bug in a screen
   reading an unusual-but-valid log — pushing that person toward deleting
   intact data is the wrong first move. Offer to sidestep the screen instead:
   reset to week 1, or away from whatever block is on screen, before the
   destructive option. */
function showRecovery(err, raw, mode) {
  frozen = true;
  ready = false;
  clearTimeout(saveT); saveT = null;
  stopRest();

  const drawFailure = mode === 'draw';
  const readFailure = mode === 'read';
  const hasBytes = raw != null;

  const box = document.createElement('div');
  box.className = 'recovery';
  box.innerHTML =
    '<h1>' + (drawFailure ? 'La app ha fallado al dibujar'
      : readFailure ? 'No se ha podido leer tu registro'
      : 'No se ha podido abrir tu registro') + '</h1>' +
    (drawFailure
      ? '<p>Ha ocurrido un error dibujando la pantalla — probablemente un fallo de la app, no de tus datos. ' +
        'Se ha dejado de guardar mientras tanto, para no arriesgar nada.</p>'
      : readFailure
      ? '<p>No se ha podido leer el almacenamiento del navegador — puede ser un fallo puntual (modo privado, ' +
        'almacenamiento bloqueado) y tus datos podrían seguir intactos. Se ha dejado de guardar mientras tanto.</p>'
      : '<p>Los datos guardados en este navegador no tienen la forma que la app espera, ' +
        'así que no se ha dibujado nada — y, para no empeorarlo, se ha dejado de guardar.</p>') +
    (hasBytes
      ? '<p><b>Descarga los datos antes de nada.</b> Ese archivo es tu registro tal cual está: ' +
        'aunque la app no sepa leerlo, no se pierde y se puede recuperar a mano.</p>'
      : '') +
    '<pre></pre>' +
    '<div class="foot-btns">' +
      (readFailure ? '<button class="sm key" id="recReload" type="button">Reintentar</button>' : '') +
      (hasBytes ? '<button class="sm' + (readFailure ? '' : ' key') + '" id="recDownload" type="button">Descargar los datos tal cual</button>' : '') +
      (drawFailure
        ? '<button class="sm" id="recWeek1" type="button">Volver a la semana 1</button>' +
          '<button class="sm" id="recBlock" type="button">Cambiar de bloque</button>'
        : '') +
      (readFailure ? '' : '<button class="sm" id="recReload" type="button">Reintentar</button>') +
      '<button class="sm warn" id="recReset" type="button">Empezar de cero</button>' +
    '</div>';
  box.querySelector('pre').textContent = String((err && err.message) || err || 'Error desconocido');
  document.body.replaceChildren(box);

  const dl = box.querySelector('#recDownload');
  if (dl) dl.onclick = () =>
    downloadFile('heavy-iron-datos-sin-abrir-' + new Date().toISOString().slice(0, 10) + '.json',
                 raw == null ? '' : raw, 'application/json');
  /* Both buttons edit `state` (already a real, migrated object here — that
     is what makes drawFailure true), write it straight to localStorage
     bypassing `frozen`, and reload: render() is gone from this DOM, so the
     only way back is a reload, and this box has already replaced the
     elements render() writes into. Shared here so that reasoning has one
     copy instead of two; only the mutation differs per button. */
  const recoverAndReload = mutateProfile => {
    try {
      const profile = state.profiles && state.profiles[state.activeProfile];
      if (profile) mutateProfile(profile);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* reload surfaces whatever is still wrong */ }
    location.reload();
  };
  if (drawFailure) {
    const week1 = box.querySelector('#recWeek1');
    if (week1) week1.onclick = () => recoverAndReload(profile => { profile.week = 1; });
    const chBlock = box.querySelector('#recBlock');
    if (chBlock) chBlock.onclick = () => recoverAndReload(profile => {
      if (Array.isArray(profile.blockOrder) && profile.blockOrder.length) {
        profile.activeBlock = profile.blockOrder.find(id => id !== profile.activeBlock) || profile.blockOrder[0];
        profile.week = 1;
      }
    });
  }
  box.querySelector('#recReload').onclick = () => location.reload();
  box.querySelector('#recReset').onclick = () => {
    /* The only native confirm left, and deliberately: this screen has already
       replaced document.body, so the dialog sheet is not in the page any more. */
    if (!confirm('¿Borrar los datos guardados y empezar de cero? Descarga primero el archivo si no lo has hecho — esto no se puede deshacer.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing else to try */ }
    location.reload();
  };
}

/* Used to be a plain <a download> click. On an iOS home-screen PWA
   (apple-mobile-web-app-capable, index.html) that path is unreliable —
   there is no browser chrome to complete a download, and depending on the
   iOS version the tap does nothing or opens the blob in place with no way
   to save it. This is the backup path the app nags about after ten
   sessions, on the exact platform the icons were added for. The Web Share
   API with a file reaches the share sheet's own "Guardar en Archivos"
   there, so it is tried first; the anchor is the fallback for every
   browser that either lacks it or declines the file — which is everywhere
   else, so this one change also covers the CSV and profile-file exports
   that call downloadFile the same way. */
async function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      /* AbortError: the person saw the share sheet and closed it without
         picking anything — a choice, not a failure, so falling through to
         a second download here would be more surprising than doing
         nothing. Any other error falls through to the anchor below. */
      if (e && e.name === 'AbortError') return;
    }
  }
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
/* safeKey on a freeform tag, not just on an exercise id: every tag is a
   plain-object key somewhere downstream (byMuscle[tag] in diagnostics,
   totals[t] in the volume dashboard), and a tag of "__proto__" reads the
   inherited Object.prototype as "already there" and then throws on .push —
   an empty Diagnóstico with no message (plans/012). Typeable in the
   editor's Músculo box, so this is not only an import problem. */
const muscleTag = ex => safeKey(txt(ex.muscle, MUSCLE_LIMIT)) || UNCLASSIFIED_LABEL;

/* ---------- priority muscles ----------
   `block.priority` — the muscles this block is actually *for*, as a list of
   the same freeform names `ex.muscle` uses. A block-level field rather than
   a per-exercise flag or a profile-wide setting, because priorities are a
   property of the block you wrote: legs this block, arms the next. It
   travels with the plan through export, QR and JSON import, same as the
   days do.

   Nothing enforces that a name here matches a muscle in the plan — the
   taxonomy is freeform everywhere else and this is no different. A name
   with no exercises under it simply never gets a bar to flag. */
const PRIORITY_MAX = 12;
const blockPriority = block => (block && Array.isArray(block.priority) ? block.priority : []);
const isPriority = (block, tag) => blockPriority(block).indexOf(tag) >= 0;

/* Trimmed, length-capped, de-duplicated and capped in count — the same
   treatment every other freeform tag gets, applied to a list. Returns a
   fresh array, so callers can hand it straight to a block. */
function cleanPriority(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(v => {
    const t = safeKey(txt(v, MUSCLE_LIMIT));
    if (t && t !== UNCLASSIFIED_LABEL && out.indexOf(t) < 0 && out.length < PRIORITY_MAX) out.push(t);
  });
  return out;
}
const patternTag = ex => safeKey(txt(ex.pattern, PATTERN_LIMIT)) || safeKey(txt(ex.type, TYPE_LIMIT)) || UNCLASSIFIED_LABEL;
const typeTag = ex => safeKey(txt(ex.type, TYPE_LIMIT)) || UNCLASSIFIED_LABEL;

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
  /* Object.create(null) rather than {}: ids reach here from storage and
     from imports, and safeKey is the fix for that (see migrate() and the
     normalizeImported* functions) — this is the belt-and-braces the audit
     that found the bug called for. A plain {} answers `['__proto__']` with
     the real Object.prototype (truthy, not an array), so `entry()`'s
     `.push` below throws straight to the recovery screen; a prototype-less
     object has no such property to shadow the lookup with, so even an id
     that slipped through unsanitized becomes a real own property here. */
  if (!profile.log[blockId][k]) profile.log[blockId][k] = Object.create(null);
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
   typed into the first and last set of an exercise. A first set that falls
   away sharply by the last one was very likely taken closer to failure than
   the ones after it — the single most common tell in a log that only
   records {w, r, done}. Returns the drop, or 0 when there isn't one (fewer
   than two sets with reps typed counts as no signal, not a flat line).

   Two thresholds, and it needs both. The absolute one keeps a one-rep
   wobble from meaning anything. The proportional one is what stops the
   flag firing on ordinary fatigue: at a fixed load with real rest, sets
   taper by something like 10–25 % by the fourth one, so 15·15·12·12 is a
   normal session and 8·7·6·5 is not, even though both "drop 3 reps".
   Judging that on the absolute number alone called every high-rep machine
   session a first set taken to failure — which is how this was written
   first, and it was wrong on exactly the exercises that taper most. */
const DECAY_MIN_REPS = 2, DECAY_MIN_SHARE = 0.25;

function repDecay(rows) {
  const withReps = (rows || []).filter(r => r && r.r !== '' && r.r != null && !isNaN(num(r.r)));
  if (withReps.length < 2) return 0;
  const first = num(withReps[0].r);
  const drop = first - num(withReps[withReps.length - 1].r);
  const floor = Math.max(DECAY_MIN_REPS, DECAY_MIN_SHARE * first);
  return drop >= floor ? drop : 0;
}

/* The top of a rep range like "8–12" or "8-12" — the last number in the
   string, so it also copes with a plain "12" (no range at all). Used by
   copyPrev to decide whether double progression's condition ("top of range
   on every set") was actually met last week. */
function repRangeTop(reps) {
  const nums = String(reps || '').match(/\d+(?:[.,]\d+)?/g);
  return nums && nums.length ? num(nums[nums.length - 1]) : null;
}

/* The bottom of the same range — the first number, so "8–12" gives 8 and a
   plain "12" gives 12 (a single number is a range one wide, not an error).
   Double progression resets here every time the weight goes up, which is
   what makes it the rep count the target weight below is solved for. */
function repRangeBottom(reps) {
  const nums = String(reps || '').match(/\d+(?:[.,]\d+)?/g);
  return nums && nums.length ? num(nums[0]) : null;
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

/* The chip as a number the arithmetic can use. '2+' is open-ended — it may
   have been four — so it is read as exactly 2, which makes every estimate
   built on it come out low. That is the right direction to be wrong in:
   under-shooting costs one week of a slightly light set, over-shooting
   costs a failed session. */
const RIR_VALUE = { '2+': 2, '1': 1, '0': 0 };
const rirNumber = v => (Object.prototype.hasOwnProperty.call(RIR_VALUE, v) ? RIR_VALUE[v] : null);

/* The RIR the *plan* asks for in a given week, dug out of the free text in
   `phase[w].r` — which is prose ("2–3 RIR", "0–1 RIR", "Descarga"), not a
   field. The LOWEST number in the range wins: "2–3 RIR" is a week you are
   meant to be able to take to 2, and reading it as 3 quietly under-loads
   every estimate built on it. A week with no number at all — a deload, or
   a phase somebody wrote in their own words — returns null, and the
   estimate is skipped entirely rather than invented: a deload is not a
   progression week. */
function phaseRir(block, w) {
  const r = String((block && block.phase && block.phase[w] && block.phase[w].r) || '');
  /* Prefer the number(s) immediately before "RIR" — free text elsewhere in
     the phase (a week number, a set/rep scheme) can contain a smaller digit
     that used to win the plain lowest-digit-anywhere scan. */
  const near = r.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s*RIR/i);
  if (near) return Math.min(num(near[1]), num(near[2] != null ? near[2] : near[1]));
  const nums = r.match(/\d+/g);
  return nums && nums.length ? Math.min.apply(null, nums.map(num)) : null;
}

/* ---------- session note ----------
   One free-text line per session, written once, at the end, away from the
   sets. "Dormí 5 h", "sin desayunar", "gimnasio a reventar" — worthless
   the day you write it and the only thing that explains a dip in the chart
   six weeks later.

   Deliberately not per set and deliberately not a field you have to fill:
   the app's rule is that an input you skip on a hard day is worse than no
   input, because the gaps start looking like data. A note is prose nobody
   averages, so a missing one costs nothing. */
const NOTE_LIMIT = 240;

function getNote(profile, blockId, w, dayId) {
  const blk = profile.notes[blockId];
  return (blk && blk[slot(w, dayId)]) || '';
}

function setNoteText(profile, blockId, w, dayId, val) {
  const k = slot(w, dayId);
  const text = txt(val, NOTE_LIMIT);
  if (text) {
    if (!profile.notes[blockId]) profile.notes[blockId] = {};
    profile.notes[blockId][k] = text;
  } else if (profile.notes[blockId]) {
    delete profile.notes[blockId][k];
  }
}

/* ---------- energy at session start ----------
   The same three-chip shape as RIR, asked once before you start rather
   than after: how you arrived. Optional, absent by default, and — unlike
   RIR — never fed into any estimate. It is read back as context in the
   block review ("las sesiones flojas movieron un 18 % menos"), never
   plotted as a line, because an optional input drawn as a continuous
   series turns the days you didn't tap it into a story it cannot support. */
const ENERGY_OPTIONS = ['baja', 'normal', 'alta'];
const ENERGY_LABEL = {
  baja: 'Llegas con poca energía',
  normal: 'Llegas normal',
  alta: 'Llegas fuerte',
};

function getEnergy(profile, blockId, w, dayId) {
  const blk = profile.energy[blockId];
  return (blk && blk[slot(w, dayId)]) || '';
}

function setEnergy(profile, blockId, w, dayId, val) {
  const k = slot(w, dayId);
  if (val) {
    if (!profile.energy[blockId]) profile.energy[blockId] = {};
    profile.energy[blockId][k] = val;
  } else if (profile.energy[blockId]) {
    delete profile.energy[blockId][k];
  }
}

/* ---------- the order the session was actually done in ----------
   The plan is a prescription, not a record. The bench is taken, so you do
   the lateral raises first and come back to it — and by the next week
   nothing anywhere says that happened, even though it is the single most
   likely explanation for why the bench moved less weight that day. An
   exercise done fifth is not the same exercise done first.

   Stored per session, like the note and the energy chips, and for the same
   reason: the order is a property of the day, not of any one set. What it
   holds is the exercise ids in the sequence they were done — a permutation
   of the day's plan, never a subset with meaning of its own. And it is only
   stored when it *differs* from the plan: an absent entry means "in the
   order the plan asks for", which is what the great majority of sessions
   are, so the common case costs nothing on disk and needs no backfill for
   every session logged before this existed.

   Deliberately not a per-exercise number you type in. Numbering by hand is
   the version of this that gets half-filled — you stamp 1 and 2, get
   distracted at the third machine, and the log is left claiming things that
   are not true. Two arrows that move a card past its neighbour can only
   ever describe a complete order, because they start from the plan's. */
const ORDER_LIMIT = 60;

function getOrder(profile, blockId, w, dayId) {
  const blk = profile.order[blockId];
  const ids = blk && blk[slot(w, dayId)];
  return Array.isArray(ids) ? ids : null;
}

function setOrder(profile, blockId, w, dayId, ids) {
  const k = slot(w, dayId);
  if (ids && ids.length) {
    if (!profile.order[blockId]) profile.order[blockId] = {};
    profile.order[blockId][k] = ids.slice(0, ORDER_LIMIT);
  } else if (profile.order[blockId]) {
    delete profile.order[blockId][k];
  }
}

/* The day's live exercises in the sequence they were actually done.

   The stored ids are resolved against the plan rather than trusted: an
   exercise that has since been retired, deleted or sent to another day
   simply drops out, and one added to the plan afterwards lands at the end
   rather than silently claiming a position nobody put it in. So a plan
   edit can never strand a session on an order that no longer describes it —
   worst case the recorded sequence degrades back towards the plan's. */
function orderedEx(profile, block, w, day) {
  const plan = exList(day);
  const ids = getOrder(profile, block.id, w, day.id);
  if (!ids) return plan;
  const byId = {};
  plan.forEach(ex => { byId[ex.id] = ex; });
  const out = [];
  ids.forEach(id => { const ex = byId[id]; if (ex && out.indexOf(ex) < 0) out.push(ex); });
  plan.forEach(ex => { if (out.indexOf(ex) < 0) out.push(ex); });
  return out;
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/* Swap an exercise with its neighbour in the actual order. Writing back the
   whole sequence rather than a position keeps the stored value a complete
   permutation at every step; landing back on the plan's own order deletes
   the record instead of storing a copy of it, so "no entry" keeps meaning
   exactly one thing. */
function moveSessionEx(profile, block, w, day, exId, dir) {
  const cur = orderedEx(profile, block, w, day);
  const i = cur.findIndex(e => e.id === exId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return false;
  const tmp = cur[i]; cur[i] = cur[j]; cur[j] = tmp;
  const ids = cur.map(e => e.id);
  setOrder(profile, block.id, w, day.id, sameIds(ids, exList(day).map(e => e.id)) ? null : ids);
  return true;
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

/* setVolume with every weight read through rowWeight(): a block trained
   partly in kg and partly in lb — a mid-block unit switch, or a backup
   restored from a partner on the other unit — would otherwise be summed in
   two units at once. Used by every screen that adds up more than one
   session (diagnostics, the block review, the tonnage tile); the session
   view keeps setVolume, raw, on purpose — see rowWeight's comment. A drop
   shares its row's unit stamp; drops have none of their own. Lived as two
   identical copies in js/diagnostics.js and js/review.js until plans/011. */
function convertedSetVolume(r) {
  if (!r || !r.done) return 0;
  const toUnit = units();
  const from = rowUnit(r);
  const w = convertWeight(num(r.w), from, toUnit), reps = num(r.r);
  const dropsVol = dropsOf(r).filter(dropUsed).reduce((t, d) => {
    const dw = convertWeight(num(d.w), from, toUnit), dr = num(d.r);
    return t + ((isNaN(dw) || isNaN(dr)) ? 0 : dw * dr);
  }, 0);
  return ((isNaN(w) || isNaN(reps)) ? 0 : w * reps) + dropsVol;
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
  purgeRir(profile, blockId, dayId, exId);
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  purgeRir(profile, blockId, dayId);
  purgeSessionMeta(profile, blockId, dayId);
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
}

/* The session-level maps are keyed by slot alone, with no exercise under
   them, so unlike `rir` they do not quietly become unreadable when the
   sets they belonged to go: a note — or an order that says you started with
   the third exercise — would still be sitting there when the day came back.
   Whatever clears a session's sets clears these too. */
function purgeSessionMeta(profile, blockId, dayId, onlyWeek) {
  [profile.notes, profile.energy, profile.order].forEach(map => {
    const blk = map && map[blockId];
    if (!blk) return;
    if (onlyWeek) { delete blk[slot(onlyWeek, dayId)]; return; }
    for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
  });
}

/* `rir` is the one parallel map keyed by exercise under the slot, so it needs
   its own sweep: purgeSessionMeta cannot reach into it, and a chip left
   behind with no set under it is invisible until the day comes back and
   shows a RIR nobody recorded. */
function purgeRir(profile, blockId, dayId, exId) {
  const blk = profile.rir && profile.rir[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const k = slot(w, dayId);
    if (!blk[k]) continue;
    if (exId) delete blk[k][exId];
    else delete blk[k];
  }
}

/* "Send to another session" in the plan editor: the exercise moves between
   draft days right away, but everything filed under the session it was in —
   the log, the RIR chips (moveExRir) and the session order (moveExOrder,
   below) — stays there until the draft is saved. This is what makes that
   filing catch up, across every week the block could have.

   Merges into the destination's existing entry for the id rather than
   overwriting it: a block can carry the same exercise id on two days by
   design (see migrate()'s day/exercise-id repair), so the destination can
   already have its own rows for this id, and blindly assigning would erase
   them. An array (a day's logged rows) is concatenated; anything else (an
   RIR chip) is left alone if the destination already has one, since there
   is no way to merge two single values without picking a side. Either way
   nothing is ever destroyed by calling this — including calling it twice,
   which peSave cannot do today but a future bug easily could. */
function moveExKeyed(map, blockId, fromDayId, toDayId, exId) {
  const blk = map[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const fromKey = slot(w, fromDayId);
    const from = blk[fromKey];
    if (!from || from[exId] === undefined) continue;
    const toKey = slot(w, toDayId);
    if (!blk[toKey]) blk[toKey] = {};
    const dest = blk[toKey];
    if (Array.isArray(from[exId])) {
      dest[exId] = dest[exId] ? dest[exId].concat(from[exId]) : from[exId];
    } else if (dest[exId] === undefined) {
      dest[exId] = from[exId];
    }
    delete from[exId];
    if (!Object.keys(from).length) delete blk[fromKey];
  }
}

function moveExLog(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.log, blockId, fromDayId, toDayId, exId);
}

function moveExRir(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.rir, blockId, fromDayId, toDayId, exId);
}

/* Order arrays are a permutation of a day's exercises, not a map keyed by
   exercise id like log/rir are, so they need their own move: drop the id
   from the source day's recorded order (if it had one) and append it to
   the destination's (if it has one). A day with no recorded order keeps
   meaning "the plan's order", which already includes the exercise wherever
   it now sits in the plan, so there is nothing to add there. */
function moveExOrder(profile, blockId, fromDayId, toDayId, exId) {
  const blk = profile.order[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const fromKey = slot(w, fromDayId), toKey = slot(w, toDayId);
    const fromIds = blk[fromKey];
    if (Array.isArray(fromIds)) {
      const i = fromIds.indexOf(exId);
      if (i >= 0) fromIds.splice(i, 1);
      if (!fromIds.length) delete blk[fromKey];
    }
    const toIds = blk[toKey];
    if (Array.isArray(toIds) && toIds.indexOf(exId) < 0) toIds.push(exId);
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

/* ---------- the same lift on more than one day ----------
   A plan can put the same exercise in two sessions — chest press on the
   push day and again on the arm day — and until now each of those lived in
   its own history. The log is keyed blockId → w{week}-{dayId} → exId, so
   the dayId in the slot walls them off: you pressed 22,5 on Monday and
   Thursday's card still said the last time was 20.

   What makes two rows the same lift is the plan, not the log. A block
   written as JSON gives its exercises readable ids (`chestpress`), so both
   rows carry the same one; rows added in the plan editor get a fresh uid()
   each and share nothing but the name. Hence both keys — the id when it
   matches, the name when it does not. The name is what you read on the card
   and what you would change if you meant them to be two different lifts,
   so it is the right thing to trust.

   Deliberately read for DISPLAY only. targetEstimate and copyPrev still
   work from one session's own history, because the two slots are not
   interchangeable: the same machine done first on Monday and fourth on
   Thursday, after everything that came before it, is not the same set.
   Folding them into one target would prescribe a weight set on the fresher
   day and then read the fatigued one as a regression. Showing them next to
   each other says what happened and leaves the judgement where it belongs. */
function sameLift(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  const an = slugifyCached(a.n), bn = slugifyCached(b.n);
  return !!an && an === bn;
}

/* Every place in the block this lift is planned, in day order, as the
   { dayId, exId } pairs the log is keyed by. Retired rows (`off`) count:
   whatever was logged under them still happened. */
function liftSlots(block, ex) {
  const out = [];
  (block.days || []).forEach((day, i) => {
    (day.ex || []).forEach(e => {
      if (sameLift(e, ex)) out.push({ dayId: day.id, dayIdx: i, exId: e.id });
    });
  });
  return out;
}

/* 'Empuje', not 'D1': the day's own name is what you would say out loud,
   and the tag has room for it. A long one is cut rather than left to
   squeeze the numbers it sits beside. */
function dayTag(block, dayId) {
  const days = block.days || [];
  const i = days.findIndex(d => d.id === dayId);
  /* Normalisation always names a day, so the positional fallback is only
     for a dayId the plan no longer has — and 'D2' still beats a tag that
     trails off into a dangling separator. */
  const name = (i >= 0 && days[i].name) || (i >= 0 ? 'D' + (i + 1) : '');
  /* Trailing punctuation left by the cut reads as a typo — 'Pecho/Brazo +…'
     — so it goes with the rest of the tail. */
  return name.length > 14 ? name.slice(0, 13).replace(/[\s+/-]+$/, '') + '…' : name;
}

/* The most recent session of this lift on some OTHER day of the block —
   what the card shows underneath its own history rather than in place of
   it. Walks weeks back from the current one, and inside the current week
   counts every other day: which of them you actually trained first is not
   recorded, and a set logged this week is this week's news either way. */
function lastTimeOtherDay(profile, block, day, ex, week) {
  const slots = liftSlotsCached(block, ex).filter(s => s.dayId !== day.id);
  const blk = slots.length && profile.log[block.id];
  if (!blk) return null;
  for (let w = week; w >= 1; w--) {
    let best = null;
    slots.forEach(s => {
      const bucket = blk[slot(w, s.dayId)];
      const rows = bucket && bucket[s.exId];
      if (!Array.isArray(rows)) return;
      const done = rows.filter(x => x.done && x.w !== '');
      if (!done.length) return;
      if (!best || s.dayIdx > best.dayIdx) best = { week: w, dayId: s.dayId, dayIdx: s.dayIdx, sets: done };
    });
    if (best) return best;
  }
  return null;
}

/* ---------- the rest timer lives in js/rest-timer.js ----------
   These five are everything the rest of the app asks of it: startRest and
   stopRest from the tick handler and from every profile/week/day button,
   renderSoundBtn from drawApp, askForNotifications and keepAliveStop from
   Ajustes. They are stubbed to no-ops when that file is not on the page,
   because a returning user's service worker can still be serving an
   index.html with no script tag for it — and unlike a split-out button,
   these are not things you can afford to lose loudly: renderSoundBtn would
   take every render down to the recovery screen, and a ticked set would
   throw before it could be saved. A rest period that does not start is a
   lost convenience; a set that will not tick is lost training. */
if (typeof startRest !== 'function') globalThis.startRest = function () {};
if (typeof stopRest !== 'function') globalThis.stopRest = function () {};
if (typeof renderSoundBtn !== 'function') globalThis.renderSoundBtn = function () {};
if (typeof askForNotifications !== 'function') globalThis.askForNotifications = function () {};
if (typeof keepAliveStop !== 'function') globalThis.keepAliveStop = function () {};

/* Same again for js/chart.js, which owns one entry point: the "Progreso ↗"
   button on every card calls it from inside buildExCard, so an unguarded
   call would throw inside a card rather than merely doing nothing. And for
   js/qr-transfer.js, whose closeQr the Escape handler reaches for whenever
   the QR sheet is the top one — a sheet that cannot exist without that
   file, so the stub is only ever called in a world where it is right. */
if (typeof openChart !== 'function') globalThis.openChart = function () {};
if (typeof closeQr !== 'function') globalThis.closeQr = function () {};


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
  /* isConnected: something opened under this sheet can have triggered a full
     render() that recreated the button that opened it (the nav bar is
     rebuilt on every render) — same reasoning as closeAsk, above. */
  if (sheetReturn && sheetReturn.isConnected && sheetReturn.focus) sheetReturn.focus();
  sheetReturn = null;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (askResolve) { closeAsk($('askInput').hidden ? false : null); return; }
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
    b.onclick = () => { state.activeProfile = key; stopRest(); save(); render(); };
    host.appendChild(b);
  });
  $('app').className = 'profile-' + accentOf(getProfile()) + (soloMode() ? ' solo' : '');
}

/* ---------- shared block-config helpers ----------
   Used by js/block-editor.js (block import/plan editor) as well as by
   migrate()/emptyBlock() and the QR log limits below — left here rather
   than moved out with the rest of the import-block code, since app.js
   loads after block-editor.js/profile-transfer.js, calling these from
   either file at call-time (never at parse-time) is safe either way. */

/* Published blocks are deployed on the same origin and path as the app
   itself — the Pages build uploads the whole repo, so blocks/ always sits
   next to index.html — and fetched relative to the page, so a fork lists
   its own blocks rather than this one's with no host-parsing needed. This
   also means the request is same-origin, which is what lets the service
   worker's network-first /blocks/ handler (sw.js) actually run: fetched
   cross-origin, as this used to be, it fell straight through that handler
   and "importable offline once you've seen it" was dead in production. */
function blocksBase() {
  return 'blocks';
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

/* `__proto__`, `constructor` and `prototype` are ordinary strings everywhere
   except as a key into a fresh `{}`: `log['__proto__'] = x` sets the
   prototype instead of adding an own property, so a later `log[k][exId]`
   read (rowsFor, js/app.js) finds `Object.prototype` — truthy, not an
   array — and the next `.push` on it throws, straight to the recovery
   screen. `Object.prototype.hasOwnProperty.call({}, s)` is not a fix on its
   own: a plain `{}` owns none of these names either, hasOwnProperty says
   so, and the walk up the chain happens anyway. A fixed deny-list is what
   the reference implementation below (normalizeImportedBlock) and every
   other id read from storage or an import checks ids against; returns ''
   for a blocked id so the caller's existing "fall back to a generated one"
   path handles it for free. */
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
function safeKey(id) {
  return UNSAFE_KEYS.indexOf(id) >= 0 ? '' : id;
}

/* ---------- nav ---------- */

/* Something logged anywhere in this week of this block — what the dot on a
   week button means. One home, because renderNav draws it for every week and
   drawCard has to move it for the current one after a tick, and a rule with
   two implementations is a rule that drifts. */
function weekHasLog(profile, block, w) {
  return dayList(block).some(d => {
    const s = profile.log[block.id] && profile.log[block.id][slot(w, d.id)];
    return !!s && Object.values(s).some(a => Array.isArray(a) && a.some(x => x && x.done));
  });
}

/* The first ticked set of a week adds the dot and unticking the last one
   removes it, so a card-local redraw still owes the nav this much. Moving
   the one dot rather than calling renderNav(), which would rebuild every
   week and day button to do it — the whole point of drawCard is to stop
   rebuilding things that did not change. */
function refreshWeekDot(profile, block) {
  const host = $('weeks');
  const btn = host && host.children[profile.week - 1];
  if (!btn) return;
  const dot = btn.querySelector('.dot');
  if (weekHasLog(profile, block, profile.week)) {
    if (!dot) { const el = document.createElement('span'); el.className = 'dot'; btn.appendChild(el); }
  } else if (dot) {
    dot.remove();
  }
}

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
    if (weekHasLog(profile, block, w)) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; stopRest(); save(); render(); };
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
    b.onclick = () => { profile.day = i; stopRest(); save(); render(); };
    $('days').appendChild(b);
  });
}

/* ---------- keeping the keyboard's place across a redraw ----------
   Redrawing anything destroys the control the keyboard was on, even when the
   new markup has the same shape, and focus lands back on <body>: press an
   RIR chip and the next Tab starts from the top of the page. These record
   where it was as the chain of child indices from a root that survives the
   redraw — "second child, third child, first child" — and put it back.

   Indices rather than a selector because none of these controls carry a
   stable id, and because a redraw that really did change the card's shape
   (a drop segment added) then simply misses, which is the same no-op it
   was before. The text cursor comes along too: a weight box rebuilt under
   a half-typed number should not jump to the end of it. */
function focusPathIn(root) {
  const el = document.activeElement;
  if (!el || el === root || !root || typeof root.contains !== 'function' || !root.contains(el)) return null;
  const path = [];
  let node = el;
  while (node && node !== root) {
    const p = node.parentNode;
    if (!p) return null;
    path.unshift(Array.prototype.indexOf.call(p.children, node));
    node = p;
  }
  if (node !== root) return null;
  let start = null, end = null;
  /* selectionStart throws on input types that have no selection to report.
     Every box in a card is type=text, but the guard costs nothing. */
  try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { start = null; }
  return { path: path, start: start, end: end };
}

function applyFocusPath(root, at) {
  let el = root;
  at.path.forEach(i => { el = el && el.children && el.children[i]; });
  if (!el || typeof el.focus !== 'function') return;
  el.focus();
  if (at.start == null || typeof el.setSelectionRange !== 'function') return;
  try { el.setSelectionRange(at.start, at.end); } catch (e) { /* not a selectable input any more */ }
}

/* The other half: a box that did not exist before this draw, so there is no
   old element to path back to — the ↓ button's new drop weight box, or the
   ⚙ button's machine-settings box. The builder marks it and this claims it,
   once the card is actually in the document. */
function takeFocusMark(root) {
  if (!focusDrop && !focusSetup) return;
  focusDrop = ''; focusSetup = '';
  const target = root.querySelector('[data-focus-mark]');
  if (!target) return;
  target.focus();
  if (typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(target.value.length, target.value.length); } catch (e) { /* ignore */ }
  }
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
    showRecovery(e, readRaw(), 'draw');
  }
}

/* The best weight ever completed on each exercise, across every block of the
   profile — the bar a set has to clear to count as a personal record. The
   session being drawn is excluded, or its own sets would beat themselves. */
function bestByExercise(profile, skipBlockId, skipSlot) {
  /* Prototype-less for the same reason rowsFor's slot objects are: exercise
     ids arrive from storage and from imports, and `best['__proto__'] = 90`
     on a plain {} is silently dropped, so that one exercise could never show
     a RECORD badge however heavy the set. */
  const best = Object.create(null);
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

/* The same answer for one exercise. Rebuilding a single card (drawCard)
   needs one id's bar, and walking the other six exercises' history only to
   throw it away is most of what made a set tick cost a whole render. The
   full draw still asks for all of them, in the one pass above. */
function bestForExercise(profile, exId, skipBlockId, skipSlot) {
  const best = Object.create(null);
  Object.keys(profile.log).forEach(bId => {
    const blk = profile.log[bId];
    if (!blk) return;
    Object.keys(blk).forEach(k => {
      if (bId === skipBlockId && k === skipSlot) return;
      const rows = blk[k] && blk[k][exId];
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (!r || !r.done) return;
        const w = num(r.w);
        if (isNaN(w)) return;
        if (!(exId in best) || w > best[exId]) best[exId] = w;
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

/* Everything below is a pure function of (profile, block, week, day) and is
   asked for the same answer several times inside one render — lastTime twice
   per card, liftSlots once per card over every card. Held for the duration of
   one draw and dropped at the start of the next, so nothing can go stale:
   every path that changes the log already ends in render(). */
let renderCache = null;

function resetRenderCache() {
  renderCache = { lastTime: Object.create(null), liftSlots: Object.create(null), slug: Object.create(null) };
}

/* Same five arguments, same answer — and the card loop asks twice: once
   directly for the previous-week band, once inside targetEstimate. */
function lastTimeCached(profile, blockId, dayId, exId, beforeWeek) {
  if (!renderCache) return lastTime(profile, blockId, dayId, exId, beforeWeek);
  const k = blockId + '|' + dayId + '|' + exId + '|' + beforeWeek;
  if (!(k in renderCache.lastTime)) {
    renderCache.lastTime[k] = lastTime(profile, blockId, dayId, exId, beforeWeek);
  }
  return renderCache.lastTime[k];
}

/* O(days × exercises) per call, and the card loop calls it once per card —
   so this is the difference between O(exercises) and O(exercises²) work on
   every tick. */
function liftSlotsCached(block, ex) {
  if (!renderCache) return liftSlots(block, ex);
  const k = block.id + '|' + ex.id;
  if (!(k in renderCache.liftSlots)) renderCache.liftSlots[k] = liftSlots(block, ex);
  return renderCache.liftSlots[k];
}

function slugifyCached(s) {
  if (!renderCache) return slugify(s);
  const k = String(s == null ? '' : s);
  if (!(k in renderCache.slug)) renderCache.slug[k] = slugify(k);
  return renderCache.slug[k];
}

function drawApp() {
  resetRenderCache();
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
  /* Before anything is drawn from it: pruneLog reads this to know which row
     arrays are the live ones. */
  drawnSlot = { profile: state.activeProfile, block: block.id, key: slot(profile.week, day.id) };
  drawEnergy(profile, block, day);
  drawDeloadCheck(profile, block);
  drawSessionNote(profile, block, day);
  const pairNote = soloMode() ? '' : (day.pair || '');
  $('pair').textContent = pairNote;
  $('pair').style.display = pairNote ? 'flex' : 'none';

  const list = $('list');
  list.innerHTML = '';
  dayCards = [];

  /* Drawn in the order the session was actually done, which is the plan's
     until somebody says otherwise — see orderedEx and the arrows on each
     card. Everything downstream still keys off ex.id, so nothing but the
     sequence of the cards changes. */
  const sessionEx = orderedEx(profile, block, profile.week, day);
  drawOrderNote(profile, block, day, sessionEx);

  /* One walk of the profile for every card's all-time best, since every card
     is being built anyway. drawCard takes the other side of that trade. */
  const ctx = {
    profile: profile, block: block, day: day, days: days, sessionEx: sessionEx,
    best: bestByExercise(profile, block.id, slot(profile.week, day.id)),
  };
  sessionEx.forEach((ex, i) => list.appendChild(buildExCard(ctx, ex, i)));
  takeFocusMark(list);

  const stranded = weeksBeyondEnd(profile, block);
  $('beyond').textContent = stranded
    ? (stranded === 1
        ? 'Hay 1 serie registrada en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guarda: alarga el bloque en "Editar plan" para volver a verla.'
        : 'Hay ' + stranded + ' series registradas en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guardan: alarga el bloque en "Editar plan" para volver a verlas.')
    : '';
  $('beyond').style.display = stranded ? 'block' : 'none';

  drawSessionFoot(profile, days);
}

/* One exercise's card, built detached and handed back for the caller to put
   in place: drawApp appends all of them, drawCard swaps one out. `ctx` is
   everything that is the same for every card in the day, so the two callers
   differ in exactly one thing — how they arrived at `best`. */
function buildExCard(ctx, ex, i) {
  const profile = ctx.profile, block = ctx.block, day = ctx.day;
  const sessionEx = ctx.sessionEx, best = ctx.best;
  const n = setsFor(ex, profile.week, block);
  const rows = entry(profile, block.id, profile.week, day.id, ex.id, n);
  const parked = parkedRows(profile, block.id, profile.week, day.id, ex.id, n);
  const allDone = rows.every(r => r.done);

  const isPr = r => r.done && !isNaN(num(r.w)) && (!(ex.id in best) || num(r.w) > best[ex.id]);
  const cardPr = rows.some(isPr);

  /* Everything the line under the session adds up, recorded here on the way
     past. `rows` is the live array, which is also what lets the tick handler
     below ask whether the whole day just became done. */
  const stat = {
    ex: ex, el: null, rows: rows, n: n,
    done: rows.filter(r => r.done).length, tonnage: 0, pr: cardPr, lastTs: 0,
  };
  dayCards[i] = stat;

  const card = document.createElement('div');
  /* How drawCard finds this card again. */
  card.dataset.ex = ex.id;
  stat.el = card;
  card.className = 'ex' + (allDone ? ' complete' : '') + (ex.share && !soloMode() ? ' shared' : '');

  const prev = lastTimeCached(profile, block.id, day.id, ex.id, profile.week);
  /* The same lift on another day of the block, shown UNDER this session's
     own history rather than instead of it: the first band is what the
     estimate further down was built from, and quietly swapping in another
     session's numbers would leave that target looking like it came from
     nowhere. Two bands, no comparison drawn — the reading is yours. */
  const other = lastTimeOtherDay(profile, block, day, ex, profile.week);
  const band = (cls, tag, sets) => '<div class="last' + cls + '"><span class="tag">' + esc(tag) +
    '</span><span><b>' + sets.map(s => esc(setSummary(s))).join('</b> · <b>') + '</b></span></div>';
  const prevTxt =
    (prev ? band('', 'Sem. ' + prev.week, prev.sets) : '') +
    (other ? band(' other', 'Sem. ' + other.week + ' · ' + dayTag(block, other.dayId), other.sets) : '');

  const decay = repDecay(rows);
  /* Read off the previous session, so it is the same number all week and
     does not move as you tick sets. */
  const est = targetEstimate(profile, block, day, ex, profile.week);
  const setupOpen = expandedSetup.has(setupKey(block, ex));

  card.innerHTML =
    '<div class="ex-head">' +
      '<div class="ex-num">' +
        '<button type="button" class="ex-ord up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<span class="ex-ord-n">' + (i + 1) + '</span>' +
        '<button type="button" class="ex-ord down"' + (i === sessionEx.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '</div>' +
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
    (est ? '<div class="ex-est ' + est.kind + '"><span class="ex-est-l"></span>' +
      targetNotes(est).map(() => '<span class="ex-est-n"></span>').join('') + '</div>' : '') +
    '<div class="ex-rir"><span class="ex-rir-lbl">RIR último set</span><div class="rir-chips"></div></div>' +
    (parked ? '<div class="ex-parked"></div>' : '');

  if (decay) {
    card.querySelector('.ex-decay').textContent = '⚠ caída de ' + decay + ' reps: ¿primera serie al fallo?';
  }

  if (est) {
    card.querySelector('.ex-est-l').textContent = targetLine(est);
    const noteEls = card.querySelectorAll('.ex-est-n');
    targetNotes(est).forEach((t, i) => { if (noteEls[i]) noteEls[i].textContent = t; });
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

  /* The number is the position this exercise was done in, and the two
     arrows are how you correct it — the machine was taken, you did the
     next one first, two taps and the card is where it belongs. Ends stay
     rendered but disabled rather than hidden, so the column keeps its
     width and the numbers do not shuffle sideways card to card. */
  card.querySelectorAll('.ex-ord').forEach(btn => {
    const dir = btn.classList.contains('up') ? -1 : 1;
    const label = 'Hiciste ' + ex.n + (dir < 0 ? ' antes' : ' después') +
      ': moverlo al puesto ' + (i + 1 + dir) + ' de la sesión';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.onclick = () => {
      if (!moveSessionEx(profile, block, profile.week, day, ex.id, dir)) return;
      save(); render();
    };
  });

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
    if (setupOpen) expandedSetup.delete(setupKey(block, ex));
    else { expandedSetup.add(setupKey(block, ex)); focusSetup = ex.id; }
    drawCard(ex.id);
  };
  if (setupOpen) {
    const setupIn = card.querySelector('.ex-setup-in');
    setupIn.value = ex.setup || '';
    setupIn.setAttribute('aria-label', 'Ajustes de máquina de ' + ex.n);
    setupIn.oninput = e => { const v = e.target.value; if (v) ex.setup = v; else delete ex.setup; save(); };
    /* Marked, not focused, and only when this press is what opened it.
       Focusing on every draw was a workaround for render() rebuilding the
       card on every set tick; it also meant that leaving a settings box open
       and moving to another day popped the keyboard up for a field nobody
       had asked for. */
    if (focusSetup === ex.id) setupIn.dataset.focusMark = '1';
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
      save(); drawCard(ex.id);
    };
    rirHost.appendChild(b);
  });

  const box = card.querySelector('.sets');
  rows.forEach((r, si) => {
    if (r.done) {
      stat.tonnage += setVolume(r);
      if (r.ts > stat.lastTs) stat.lastTs = r.ts;
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
    wIn.oninput = e => { r.w = e.target.value.replace(/[^0-9.,]/g, ''); if (r.w !== e.target.value) e.target.value = r.w; stampRowUnit(r); save(); };
    rIn.oninput = e => { r.r = e.target.value.replace(/[^0-9]/g, ''); if (r.r !== e.target.value) e.target.value = r.r; save(); };

    const tick = row.querySelector('.tick');
    tick.setAttribute('aria-label', (r.done ? 'Desmarcar' : 'Marcar') + ' serie ' + (si + 1) + ' de ' + ex.n);
    tick.onclick = () => {
      let adopted = '';
      if (!r.done) {
        /* Ticking a set whose weight box is still empty takes the greyed
           number showing in it — last week's weight for this same set. It
           is the common case, but it is also a guess, so it says so. */
        if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; stampRowUnit(r); }
        r.ts = Date.now();
      }
      r.done = !r.done;
      if (r.done && ex.rest) startRest(ex.rest, ex.n + ' · serie ' + (si + 1));
      if (r.done && !ex.rest) stopRest();
      /* The tick that finishes the whole day counts as a session — see
         maybeNagBackup. dayCards holds every card's rows by live reference,
         so this reads true only once every row across every exercise is
         done — including the cards this redraw is not going to touch. */
      if (r.done && dayCards.every(c => c.rows.every(rr => rr.done))) {
        state.prefs.sessionsSinceBackup++;
        maybeNagBackup();
      }
      save(); drawCard(ex.id);
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
      save(); drawCard(ex.id);
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
      dwIn.oninput = e => { d.w = e.target.value.replace(/[^0-9.,]/g, ''); if (d.w !== e.target.value) e.target.value = d.w; stampRowUnit(r); save(); };
      drIn.oninput = e => { d.r = e.target.value.replace(/[^0-9]/g, ''); if (d.r !== e.target.value) e.target.value = d.r; save(); };

      const del = dRow.querySelector('.drop-x');
      del.setAttribute('aria-label', 'Quitar ' + where);
      del.onclick = () => {
        r.d.splice(di, 1);
        /* No segments left means no kind to remember either — the row goes
           back to being exactly the {w,r,done,ts} it started as. */
        if (!r.d.length) { delete r.d; delete r.dk; }
        save(); drawCard(ex.id);
      };

      box.appendChild(dRow);

      /* Marked now, focused at the end of the render: the card is still
         detached from the document at this point, and focus() on a
         detached element is silently a no-op. */
      if (focusDrop === ex.id + '#' + si + '#' + di) dwIn.dataset.focusMark = '1';
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
        b.onclick = () => { r.dk = k; save(); drawCard(ex.id); };
        kindRow.appendChild(b);
      });
      box.appendChild(kindRow);
    }
  });

  return card;
}

/* Redraw one exercise's card, and the few things outside it that a change
   confined to that card can still move.

   Ticking a set used to go through render(), which rebuilds the whole day —
   about 400 nodes and 160 handlers for a seven-exercise session — on the
   app's most frequent interaction. Everything else on screen was destroyed
   and rebuilt identically, including the half-typed weight in another card's
   box and wherever the keyboard happened to be.

   What rides along is listed rather than left to a blanket redraw, because
   each one is a thing that could otherwise silently go stale here:
     - the line under the session: tonnage, records, the progress bar and the
       "N de M series" count (drawSessionFoot, off dayCards)
     - the dot on the week button, which the first ticked set of a week adds
     - the deload comparison, when this is the week after a deload
   Nothing else on screen reads one card's rows. The "weeks beyond the end of
   the block" note does not, because a card only ever writes to the week
   being drawn, which is inside the block by construction.

   Anything that changes which cards exist, or the order they sit in —
   navigation, reordering, retiring an exercise, an import — still goes
   through render(). */
function drawCard(exId) {
  if (!ready) return;
  const i = dayCards.findIndex(c => c.ex.id === exId);
  const old = i < 0 ? null : dayCards[i].el;
  /* The card is not on screen any more: something redrew the day under this
     handler. A full draw is the right answer and costs nothing here, because
     this is not the path being made cheap. */
  if (!old || !old.parentNode) { render(); return; }
  try {
    resetRenderCache();
    const profile = getProfile();
    const block = getBlock();
    const days = dayList(block);
    const day = days[profile.day];
    const sessionEx = orderedEx(profile, block, profile.week, day);
    /* A different exercise at this index means the plan moved; same answer. */
    if (!sessionEx[i] || sessionEx[i].id !== exId) { render(); return; }
    const ctx = {
      profile: profile, block: block, day: day, days: days, sessionEx: sessionEx,
      best: bestForExercise(profile, exId, block.id, slot(profile.week, day.id)),
    };
    const at = focusPathIn(old);
    const fresh = buildExCard(ctx, sessionEx[i], i);
    old.replaceWith(fresh);
    /* A box this press created outranks putting the keyboard back where it
       was — creating it is what the press was for. */
    if (focusDrop || focusSetup) takeFocusMark(fresh);
    else if (at) applyFocusPath(fresh, at);
    drawSessionFoot(profile, days);
    refreshWeekDot(profile, block);
    drawDeloadCheck(profile, block);
  } catch (e) {
    showRecovery(e, readRaw(), 'draw');
  }
}

/* The progress bar and the line under the session are sums over the cards,
   not over the log: each card recorded its own contribution as it was built,
   so this costs one pass over dayCards whether it follows a full draw or a
   single card being swapped. */
function drawSessionFoot(profile, days) {
  let total = 0, doneN = 0, tonnage = 0, prs = 0, lastTs = 0;
  dayCards.forEach(c => {
    total += c.n;
    doneN += c.done;
    tonnage += c.tonnage;
    if (c.pr) prs++;
    if (c.lastTs > lastTs) lastTs = c.lastTs;
  });

  $('barfill').style.width = total ? (doneN / total * 100) + '%' : '0%';

  const extra = [];
  if (tonnage > 0) extra.push('Volumen: ' + fmtKg(tonnage) + ' movidos');
  if (prs) extra.push(prs === 1 ? '1 récord personal' : prs + ' récords personales');
  if (lastTs) extra.push('último registro ' + new Date(lastTs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
  const head = doneN === total
    ? 'Sesión completa — ' + total + ' series registradas. Siguiente: ' + days[(profile.day + 1) % days.length].name + (profile.day === days.length - 1 ? ', semana ' + (profile.week + 1) : '') + '.'
    : doneN + ' de ' + total + ' series hechas. Llega al tope del rango en todas las series y sube el peso el próximo día.';
  $('note').textContent = head + (extra.length ? ' · ' + extra.join(' · ') + '.' : '');
}

/* Silent while the session is running in the order the plan asks for —
   which is most of them, and a line saying "you did this in the planned
   order" is noise on every one of them. It appears the moment the sequence
   stops matching the plan, both to confirm the change was recorded and to
   offer the way back, since undoing four swaps one arrow at a time is not
   a way back. */
function drawOrderNote(profile, block, day, sessionEx) {
  /* Guarded for the same reason wireDiagnostics/wireReview are at the foot
     of this file: a returning user's service worker can still be holding
     the previous index.html, which has no #ordNote in it. Losing the reset
     line until the worker updates is fine; throwing here would take the
     whole session render down with it, and the arrows on the cards work
     either way. */
  const host = $('ordNote');
  if (!host) return;
  const changed = !sameIds(sessionEx.map(e => e.id), exList(day).map(e => e.id));
  host.innerHTML = '';
  host.style.display = changed ? 'flex' : 'none';
  if (!changed) return;
  const txtEl = document.createElement('span');
  txtEl.textContent = 'Orden cambiado: empezaste por ' + sessionEx[0].n + '.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ord-reset';
  btn.textContent = 'Volver al orden del plan';
  btn.onclick = () => {
    setOrder(profile, block.id, profile.week, day.id, null);
    save(); render();
    mark('Orden del plan restablecido');
  };
  host.appendChild(txtEl);
  host.appendChild(btn);
}

/* Three chips before the sets rather than after them: this is how you
   arrived, and answering it once you have finished is answering a
   different question. */
function drawEnergy(profile, block, day) {
  const host = $('energy');
  host.innerHTML = '<span class="energy-lbl">¿Cómo llegas?</span><div class="energy-chips"></div>';
  const chips = host.querySelector('.energy-chips');
  const current = getEnergy(profile, block.id, profile.week, day.id);
  ENERGY_OPTIONS.forEach(opt => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'energy-chip' + (current === opt ? ' on' : '');
    b.textContent = opt;
    b.setAttribute('aria-pressed', current === opt ? 'true' : 'false');
    b.setAttribute('aria-label', ENERGY_LABEL[opt]);
    b.onclick = () => {
      setEnergy(profile, block.id, profile.week, day.id, current === opt ? '' : opt);
      save();
      /* Just the strip: nothing else on screen reads how you arrived, and a
         full render would take the whole session list down with it for the
         sake of three chips — including the chip under your finger, which is
         why the keyboard's place is carried across. */
      const at = focusPathIn(host);
      drawEnergy(profile, block, day);
      if (at) applyFocusPath(host, at);
    };
    chips.appendChild(b);
  });
}

function drawSessionNote(profile, block, day) {
  const el = $('sesNote');
  const stored = getNote(profile, block.id, profile.week, day.id);
  /* Never write over what is being typed: render() runs on every tick. */
  if (document.activeElement !== el) el.value = stored;
  el.setAttribute('maxlength', NOTE_LIMIT);
  el.oninput = e => {
    setNoteText(profile, block.id, profile.week, day.id, e.target.value);
    save();
  };
}

/* ---------- did the deload work? ----------
   Nothing checked whether the week after a deload actually came back up,
   which is the only evidence there is about whether your deloads are the
   right length. One comparison, on matched pairs so a swapped exercise
   cannot fake it: the week before the deload against the week after. */
function deloadCheck(profile, block) {
  const dl = deloadWeek(block);
  if (!dl || dl < 2 || dl + 1 > blockWeeks(block)) return null;
  const before = dl - 1, after = dl + 1;
  const byEx = strengthByExercise(profile, block);
  const ratios = [];
  Object.keys(byEx).forEach(exId => {
    const a = byEx[exId][before - 1], b = byEx[exId][after - 1];
    if (a > 0 && b > 0) ratios.push(b / a);
  });
  if (!ratios.length) return null;
  const change = 100 * (ratios.reduce((t, v) => t + v, 0) / ratios.length - 1);
  return { before: before, after: after, deload: dl, n: ratios.length, change: change };
}

function drawDeloadCheck(profile, block) {
  const el = $('deloadCheck');
  /* The week test before the comparison rather than after it: deloadCheck
     walks every logged set of the block, drawCard calls this after every
     tick, and on any week that is not the one after the deload the only
     thing that walk can produce is display:none. */
  const dl = deloadWeek(block);
  if (!dl || profile.week !== dl + 1) { el.style.display = 'none'; return; }
  const d = deloadCheck(profile, block);
  /* Only where it is the news of the week — standing on the week after the
     deload. The block review carries it the rest of the time. */
  if (!d) { el.style.display = 'none'; return; }
  const pct = (d.change > 0 ? '+' : d.change < 0 ? '−' : '') +
    String(Math.abs(Math.round(d.change * 10) / 10)).replace('.', ',') + ' %';
  el.textContent = (d.change >= 1 ? '✓ La descarga funcionó: ' : d.change <= -1 ? '⚠ Tras la descarga has bajado: ' : '→ Tras la descarga estás igual: ') +
    pct + ' respecto a la semana ' + d.before +
    ' (sobre ' + (d.n === 1 ? '1 ejercicio' : d.n + ' ejercicios') + ').';
  el.className = 'deload-check' + (d.change >= 1 ? ' good' : d.change <= -1 ? ' bad' : '');
  el.style.display = 'block';
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
  let leveled = 0, heldBack = 0, lowered = 0, reset = 0;
  exList(day).forEach(ex => {
    const from = src[ex.id]; if (!from || !from.length) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week, block));
    /* One rule, one place: the same estimate the session line shows decides
       what this button writes. It used to carry its own inline copy of
       double progression — top of the range, minus a failure signal, plus
       `ex.inc` — which is case 2 of targetEstimate() and nothing else. Two
       implementations of one rule is how they drift, and this one could
       only ever answer "same weight" or "one increment more": it could not
       size the step off what the set actually cost, and it could never
       say a weight was too heavy at all. */
    const est = targetEstimate(profile, block, day, ex, profile.week);
    const moved = est && (est.kind === 'up' || est.kind === 'down') ? est.weight : null;
    if (est && est.kind === 'up') leveled++;
    else if (est && est.kind === 'down' && est.note === 'reset') reset++;
    else if (est && est.kind === 'down') lowered++;
    else if (est && (est.note === 'topFailure' || est.note === 'topForced')) heldBack++;
    to.forEach((r, i) => {
      if (r.done) return;
      const w = (from[i] || from[from.length - 1] || {}).w || '';
      r.w = moved != null ? String(moved) : w;
      stampRowUnit(r);
    });
  });
  save(); render();
  mark('Pesos copiados de la semana ' + (profile.week - 1) +
    (leveled ? ' — ' + leveled + (leveled === 1 ? ' ejercicio sube' : ' ejercicios suben') + ' de peso (tope de rango la semana pasada)' : '') +
    (lowered ? ' — ' + lowered + (lowered === 1 ? ' ejercicio baja' : ' ejercicios bajan') + ' de peso (las series no llegan al rango a este peso)' : '') +
    (reset ? ' — ' + reset + (reset === 1 ? ' ejercicio baja un escalón' : ' ejercicios bajan un escalón') + ' para reconstruir (' + STALL_RESET + ' sesiones sin sumar reps)' : '') +
    (heldBack ? ' — ' + heldBack + (heldBack === 1 ? ' ejercicio llegó al tope pero no sube' : ' ejercicios llegaron al tope pero no suben') + ' (hubo que bajar peso, o la última serie fue al fallo)' : '') +
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
  if (profile.rir[block.id]) delete profile.rir[block.id][slot(profile.week, day.id)];
  purgeSessionMeta(profile, block.id, day.id, profile.week);
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
  /* Everything the sheet promises, not just the sets: the RIR chips used
     to survive this, invisibly (nothing reads one without the sets it
     belonged to) but still on disk after you asked for them to be gone. */
  profile.log = {};
  profile.rir = {};
  profile.notes = {};
  profile.energy = {};
  profile.order = {};
  save(); render();
  mark('Registro de ' + profile.label + ' borrado');
};

function setsLabel(n) { return n + (n === 1 ? ' serie registrada' : ' series registradas'); }
/* The plan editor (draftBlock and friends) now lives in js/block-editor.js,
   alongside block CRUD/import — setsLabel stays here since it's used
   file-wide, not just by the editor. */

/* ---------- estimated 1RM ----------
   The chart that made these necessary now lives in js/chart.js, but they
   stayed: targetEstimate below reads both, and so does js/diagnostics.js
   for its own trend. */
/* Epley: est1RM(w, r) = w × (1 + r/30). Simpler than Brzycki, it's what most
   lifting apps already show, and its error band is well understood. It
   degrades past ~12 reps, which callers are expected to flag rather than
   plot as if it were a reliable number. */
const est1RM = (w, r) => w * (1 + r / 30);

/* A set counts toward the 1RM series only if it has a usable rep count —
   unlike the weight series, which needs nothing but the weight itself. */
const hasReps = r => r.r !== '' && r.r != null && !isNaN(num(r.r)) && num(r.r) > 0;

/* ---------- target weight and reps for this week ----------
   Double progression is REP-FIRST. e1RM only answers *how much* weight to
   move, and only once the reps have earned the move. Driving the whole
   estimate off e1RM instead — which is what this did first — tells a
   lifter who put up 32×15/15/12/12 on a 10–15 range to jump to 35 kg and
   restart at 10 reps, throwing away two sets of 15 he already owns and
   putting him back at the bottom of a range he never finished. The reps
   decide the case; e1RM only sizes the step.

   The logged RIR is not a gate either, it is a scale factor. The same
   32×12 means three different things at 2+, 1 and 0 RIR, and it enters the
   arithmetic twice: it normalises last week's set to a failure-equivalent,
   and it predicts what THIS week's prescribed RIR will actually produce.

       rirLast   = the chip, or what the plan asked for that week
       equivFail = lastSetReps + rirLast      reps at true failure
       e1RM      = w × (1 + equivFail/30)     Epley — est1RM() above
       predictedAt(ww) = (e1RM/ww − 1) × 30 − rirThis

   And, for the sets that stay at the same weight, the same normalisation
   per set rather than one number for the last one:

       pred[i]   = max(reps[i], lastSetReps) + rirLast − rirThis

   The chip describes the LAST set. Earlier sets at the same weight were
   done fresher, so they carried at least that much reserve, and none of
   them had less in it than the set that came after all of them — reading
   each one at the same RIR, and at no less than the last set's reps, is a
   lower bound, and the low side is the cheap side to be wrong on. Then
   the cases, in this order. Any set under the bottom of
   the range means the weight was picked too heavy — the answer copyPrev
   could never give. Every set at or above the top means the jump is
   earned. A weight that cannot reach the bottom at THIS week's RIR is the
   first case in disguise. Anything else holds the weight and buys reps —
   how many, and on which sets, is decided by what this weight has been
   doing all block, not by adding one to last week and hoping.

   Nothing here is typed for it: the reps are in the log, the chip is
   optional with the plan's own prescription standing in, and the range and
   the phase text are in the plan. */

/* Above this Epley drifts far enough that the estimate would be inventing
   a number rather than reading one. */
const EST_MAX_REPS = 15;

/* How many sessions in a row at the same weight may go by without the
   effort-normalised reps moving before the rule stops asking for the same
   thing again. One flat session is noise — sleep, a bad day, a busy gym —
   so the rate holds through it. Two is a pattern: the +1-on-every-set ask
   has failed twice, so the ask shrinks to one rep in total, on the set
   with the most reserve. Three is a stall: the weight comes down one step
   and the reps are rebuilt to the top of the range from there, which is
   the oldest trick in double progression (two steps forward, one back) and
   the one a rule that only ever adds a rep can never take. */
const STALL_CONCENTRATE = 2, STALL_RESET = 3;

/* No target ever asks for more than this many reps over last week on one
   set. The RIR normalisation and the weekly gain compound — a week that
   went from 3 RIR to 2 with +1 progress is honestly r + 2 — and past that
   the number is a guess dressed as a target. Under-shooting costs one
   slightly light set; over-shooting costs a failed session. */
const EST_MAX_RISE = 2;

/* The sets of one session that were done at its working weight.

   The weight is *usually* constant across the sets, and the rule reads a
   rep count per set — so when it varied, taking one set's weight and
   every set's reps mixes them into nonsense. 14×15, 14×11, 9×12 came out
   as "9 kg × 15/12/13": fifteen reps at a weight two of the three sets
   were nowhere near.

   So the working weight is the one most of the sets were actually done
   at, heaviest on a tie, and only those sets feed the rule. Whatever was
   done at some other weight — a back-off, a stack that had to come down,
   a mis-tap — is left out and said so, rather than folded in as though it
   had happened at the working weight. `chipFits` says whether the RIR chip
   — which records the LAST set of the session — describes one of these
   sets at all. */
function workingSets(rows) {
  const weights = rows.map(r => num(r.w)).filter(v => v > 0);
  if (!weights.length) return null;
  const seen = {};
  weights.forEach(v => { seen[v] = (seen[v] || 0) + 1; });
  let w = weights[0];
  Object.keys(seen).forEach(k => {
    const v = num(k);
    if (seen[k] > seen[w] || (seen[k] === seen[w] && v > w)) w = v;
  });
  const atW = rows.filter(r => num(r.w) === w);
  return { w: w, sets: atW.map(r => num(r.r)), apart: rows.length - atW.length,
           chipFits: num(rows[rows.length - 1].w) === w };
}

/* The RIR a session's last working set was done at: the chip when it was
   tapped AND describes a set at the working weight, the plan's own
   prescription for that week otherwise. `value` is null only in a week
   the plan gave no number for — a deload — which is not evidence about
   anything. */
function sessionRir(profile, block, day, ex, sess, ws) {
  const logged = ws.chipFits ? getRir(profile, block.id, sess.week, day.id, ex.id) : '';
  const val = rirNumber(logged);
  return { logged: logged, value: val == null ? phaseRir(block, sess.week) : val, assumed: val == null };
}

const avgOf = a => a.reduce((t, v) => t + v, 0) / a.length;

/* How many sessions in a row, ending at `prev`, have been done at weight
   `w` without the effort-normalised reps improving on the session before.
   "Effort-normalised" is reps per set plus the RIR they were left at: the
   same 12 reps at 0 RIR in a week that asked for 2 is not the same
   session as 12 at 2, and a session that held its reps while the plan
   turned the RIR down did not stand still, it went backwards. Per set
   rather than in total so that the extra set `ex.add` brings in one week
   — a tired set, always the lowest — does not read as a jump.

   Only the block's own history at this exact weight counts. A session at
   any other weight ends the walk: a step up or a reset is a new run, and
   the reps it opens with have nothing to say about the old one. */
function stallStreak(profile, block, day, ex, prev, w, effort) {
  let stall = 0, cur = effort, week = prev.week;
  for (;;) {
    const before = lastTimeCached(profile, block.id, day.id, ex.id, week);
    if (!before) break;
    const rows = before.sets.filter(hasReps);
    const ws = rows.length ? workingSets(rows) : null;
    if (!ws || ws.w !== w) break;
    const rir = sessionRir(profile, block, day, ex, before, ws).value;
    if (rir == null) break;
    const then = avgOf(ws.sets) + rir;
    if (cur > then) break;
    stall++;
    cur = then;
    week = before.week;
  }
  return stall;
}

function targetEstimate(profile, block, day, ex, week) {
  const prev = lastTimeCached(profile, block.id, day.id, ex.id, week);
  if (!prev) return null;

  const rows = prev.sets.filter(hasReps);
  if (!rows.length) return null;

  const ws = workingSets(rows);
  if (!ws) return null;
  const w = ws.w, sets = ws.sets, apart = ws.apart;
  const last = sets[sets.length - 1];
  const lo = repRangeBottom(ex.reps), hi = repRangeTop(ex.reps);
  if (!(w > 0) || !(lo > 0) || !(hi > 0) || !(last > 0)) return null;

  /* A deload prescribes no RIR to solve for, and is not a progression
     week in the first place. Say nothing at all. */
  const rirThis = phaseRir(block, week);
  if (rirThis == null) return null;

  /* The chip records the RIR of the LAST set of the session. When that set
     was not at the working weight it describes a set this estimate is not
     built on, so it is not this set's evidence — the plan's own
     prescription stands in instead, exactly as when no chip was tapped. */
  const rirInfo = sessionRir(profile, block, day, ex, prev, ws);
  const rirLogged = rirInfo.logged, rirLast = rirInfo.value;
  if (rirLast == null) return null;

  const inc = incFor(ex);
  /* The sets the plan asks for THIS week, which is not always how many
     were logged last time: `ex.add` brings one in mid-block, and a set
     the plan gained has no history at this weight to read a target off. */
  const n = setsFor(ex, week, block);
  const out = { week: prev.week, from: w, fromReps: last, sets: sets,
                rir: rirLast, rirThis: rirThis, assumed: rirInfo.assumed,
                apart: apart, weight: w, reps: [last] };

  /* Only the cases that have to PRICE a weight need Epley, and only those
     are blocked by its rep ceiling. Holding the weight to chase reps is
     pure rep arithmetic — it never touches the estimate — so checking the
     ceiling before the cases silenced the app on exactly the high-rep
     isolation work where holding is nearly always the answer. A 12–20
     range spends most of its life above 15 reps. */
  const canPrice = last <= EST_MAX_REPS;

  const equivFail = last + rirLast;
  const e1 = est1RM(w, equivFail);
  const predictedAt = ww => (e1 / ww - 1) * 30 - rirThis;
  const round2 = v => Math.round(v * 100) / 100;
  const bottomAt = () => round2(Math.floor((e1 / (1 + (lo + rirThis) / 30)) / inc) * inc);
  /* What every set should do at some other weight: the last set priced
     off its own e1RM, and the rest keeping the shape of the decay last
     week showed. One number for the whole session — which is what the
     down line used to print — read as "that many on every set", and a
     42,75 × 8 under a 45 × 12/10/9/8 looked like a quarter of the volume
     gone when the model was actually predicting 12/10/9/8 at the lighter
     weight. */
  const atWeight = nw => {
    const lastNew = Math.round(predictedAt(nw));
    return sets.map(r => Math.max(1, Math.min(hi, lastNew + (r - last))));
  };

  /* Sets beyond the ones this weight has a record for get the tail of the
     observed decay: what the last known set did, less the average drop
     between one set and the next. Never below one rep — a fifth set that
     the arithmetic prices at zero is still a set you are going to do —
     and never above the top. Only the per-set answers extend; a jump
     prices one number for every set and stays that way. */
  const extend = () => {
    const extra = n - rows.length;
    if (extra <= 0 || out.reps.length !== sets.length) return;
    const drop = sets.length > 1 ? Math.max(0, Math.round((sets[0] - last) / (sets.length - 1))) : 0;
    for (let i = 0; i < extra; i++) {
      out.reps.push(Math.max(1, Math.min(hi, out.reps[out.reps.length - 1] - drop)));
    }
    out.extra = extra;
  };

  /* Case 3 — any set under the bottom of the range. The weight was picked
     too heavy, and rounding DOWN is the point: landing back inside the
     range matters more than the last increment of load. */
  if (sets.some(r => r < lo)) {
    if (!canPrice) { out.kind = 'skip'; return out; }
    out.kind = 'down';
    out.weight = bottomAt();
    out.reps = atWeight(out.weight);
    return out;
  }

  /* Case 2 — every set at or above the top. The jump is earned. */
  if (sets.every(r => r >= hi)) {
    /* Hitting the top means every set equals hi, so there is no rep decay
       left to detect — only a set taken to failure or one that needed the
       weight stripped can still say the number was not honestly owned. */
    if (forcedDrop(prev.sets) || rirLogged === '0') {
      out.kind = 'hold';
      out.reps = sets.map(() => hi);
      out.note = forcedDrop(prev.sets) ? 'topForced' : 'topFailure';
      extend();
      return out;
    }
    if (!canPrice) { out.kind = 'skip'; return out; }
    let nw = roundToStep(e1 / (1 + (lo + rirThis) / 30), inc);
    /* Step down rather than land under the range. This replaces the old
       ±10 %/week clamp, which was the wrong guardrail: on a coarse machine
       stack the only available step can exceed 10 %, and the clamp then
       froze the exercise forever. Saying it in reps says the same thing in
       the units the program already uses, and degrades correctly. */
    while (nw > w + inc && predictedAt(nw) < lo) nw -= inc;
    /* However coarse the stack, one step is always allowed. */
    if (nw <= w) nw = w + inc;
    nw = round2(nw);
    const pred = Math.round(predictedAt(nw));
    out.kind = 'up';
    out.weight = nw;
    out.reps = [pred];
    if (pred < lo) out.note = 'coarse';
    return out;
  }

  /* From here on the weight stays and the sets are read one by one. The
     gap is what this week's prescription costs or gives back against
     last week's effort: positive when last week was easier than this one
     asks for (the reps it left in the tank are reps to collect), negative
     when it was harder (the reps have to come down to get back to the
     prescription, and that is not a loss). */
  const gap = rirLast - rirThis;
  const pred = sets.map(r => Math.max(r, last) + gap);
  out.predLast = last + gap;
  out.pred = pred;

  /* Case 3 again, one step removed: every set was inside the range, but at
     the RIR this week asks for, the same strength does not reach its
     bottom on MOST of them. 10 reps at 0 RIR in a week that prescribes 2
     is 8 reps at the prescription — under a 10–15 range — and holding the
     weight would ask for a session the range itself says is too heavy.

     Most, not any. A 45 × 12/10/9/8 with the last set at 0 RIR reads
     10/8/7/6 at 2 RIR: two sets short, two not, and the first set has
     the top of the range in it. That weight is not too heavy — the
     freshest set says so — the session fell away, which is pacing and
     rest, and the rep-decay line above the sets already names it. Pricing
     the weight off the most fatigued set there took 5 % off a load the
     lifter plainly owns. When the majority of the sets miss, the
     freshest one is not carrying the session either, and the weight is
     the answer; the weight priced is the one that puts the LAST set back
     at the bottom, so every set lands inside the range. The weekly gain
     is not counted on to rescue a weight, because a target is a number
     you can fail. */
  const missed = pred.filter(p => p < lo).length;
  if (missed * 2 > sets.length) {
    if (!canPrice) { out.kind = 'skip'; return out; }
    out.kind = 'down';
    out.weight = bottomAt();
    out.reps = atWeight(out.weight);
    out.note = 'predUnder';
    out.missed = missed;
    return out;
  }

  const stall = stallStreak(profile, block, day, ex, prev, w, avgOf(sets) + rirLast);
  out.stall = stall;

  /* A stall long enough resets: one step down, and the sets are priced
     off the same e1RM at the lighter weight, keeping the shape of the
     decay last week showed. The reset needs Epley, so past its ceiling it
     falls through to the concentrated ask and says the stall in words. */
  if (stall >= STALL_RESET && canPrice && round2(w - inc) > 0) {
    out.kind = 'down';
    out.note = 'reset';
    out.weight = round2(w - inc);
    const lastNew = Math.round(predictedAt(out.weight));
    out.reps = sets.map(r => Math.max(1, Math.min(hi, lastNew + (r - last))));
    extend();
    return out;
  }

  /* Case 1 — hold the weight and buy reps. At full rate that is one rep
     on every set on top of what the prescription already predicts; once
     the weight has stalled it is one rep in total, on the first set that
     still has room — the freshest set, where the reserve actually is.
     Capped at the top of the range and at EST_MAX_RISE over last week;
     never under one rep. No Epley anywhere in here, so this stands however
     long the sets ran. */
  const each = stall < STALL_CONCENTRATE;
  let given = false;
  out.kind = 'hold';
  /* Clamped at the bottom of the range, not at one rep. A set the
     prescription prices under the range is still asked for the bottom —
     the range is the plan — and the cost is said in the note: that set
     will land closer to failure than the week asks. Named off the
     prescription alone, not off the gain: a set the weekly rep would
     just lift to the bottom still lands a rep under the RIR asked for,
     and that is the fact the lifter needs standing in front of it. The
     landing RIR is what the set's capacity leaves after the bottom, never
     negative here, because every set in this case actually reached the
     bottom last week. */
  out.short = pred.map((p, i) => ({ set: i + 1, land: p + rirThis - lo })).filter((x, i) => pred[i] < lo);
  out.reps = sets.map((r, i) => {
    let gain = 0;
    if (each) gain = 1;
    else if (!given && pred[i] < hi) { gain = 1; given = true; }
    return Math.max(lo, Math.min(hi, r + EST_MAX_RISE, pred[i] + gain));
  });
  if (!each) out.note = stall >= STALL_RESET ? 'stallLong' : 'stallOne';
  /* The whole reason RIR has to be in the arithmetic. If last week's final
     set went to failure and this week prescribes 2 RIR, the rep count
     SHOULD fall — that is pulling back to the prescription, not losing
     ground. The line above already prices that in; without saying so it
     looks like the app is reporting a loss. The other direction is said
     too, because a target two reps up looks like a demand rather than a
     rebate. */
  if (out.short.length) out.pacing = true;
  else if (gap < 0) out.rirDrop = true;
  else if (gap > 0) out.rirGain = true;
  extend();
  return out;
}

/* Deliberately the same voice and the same slot as the rep-decay warning:
   a line under the sets that you read, not a control you operate. The
   greyed placeholder in the weight box is left exactly as it was — it has
   a contract ("tick without typing takes that number") and that contract
   is what makes copyPrev safe to press. */
function targetLine(est) {
  const u = ' ' + units();
  const n = v => String(Math.round(v * 100) / 100).replace('.', ',');
  if (est.kind === 'skip') {
    return 'objetivo: sin estimar — por encima de ' + EST_MAX_REPS +
      ' reps la estimación deja de valer';
  }
  const reps = est.reps.join('/');
  if (est.kind === 'hold') {
    /* An arrow only where something actually moves: holding the weight to
       chase reps is progress, repeating the same set numbers is not, and
       pulling back to the prescription is neither — compared over the
       sets that have a last week to compare with, not the ones the plan
       added since. */
    const total = a => a.reduce((t, v) => t + v, 0);
    const was = total(est.sets), now = total(est.reps.slice(0, est.sets.length));
    const head = now > was ? '↗ objetivo: ' : now === was ? '→ objetivo: mantener ' : '→ objetivo: ';
    return head + n(est.weight) + u + ' × ' + reps;
  }
  return (est.kind === 'up' ? '↗' : '↘') + ' objetivo: ' + n(est.weight) + u + ' × ' + reps;
}

/* The lines under the estimate, in order. Every one of them exists because
   the number above it would otherwise be read as something it is not, and
   more than one can be true at once — a set logged at another weight and a
   RIR that will cost reps are independent facts about the same session. */
function targetNotes(est) {
  const out = [];
  if (!est) return out;
  const u = ' ' + units();
  if (est.apart) {
    out.push(est.apart === 1
      ? 'una serie fue a otro peso y queda fuera: el objetivo va sobre las que hiciste a ' + est.from + u
      : est.apart + ' series fueron a otro peso y quedan fuera: el objetivo va sobre las que hiciste a ' + est.from + u);
  }
  const rirWas = est.rir + ' RIR' + (est.assumed ? ' previstos' : '');
  if (est.note === 'topFailure') {
    out.push('tope del rango pero al fallo — mismo peso, ejecútalo a ' + est.rirThis + ' RIR');
  } else if (est.note === 'topForced') {
    out.push('tope del rango pero hubo que bajar peso — mismo peso, ejecútalo a ' + est.rirThis + ' RIR');
  } else if (est.note === 'coarse') {
    out.push('el siguiente escalón te deja en ~' + est.reps[0] + ' reps, por debajo del rango — ' +
      'normal con stack grueso, sube en 1-2 semanas');
  } else if (est.note === 'predUnder') {
    out.push('la última fue a ' + rirWas + '; a ' + est.rirThis + ' RIR, ' + est.from + u +
      ' se queda por debajo del rango en ' + est.missed + ' de ' + est.sets.length + ' series (~' +
      est.pred.join('/') + '). Peso de más para lo que pide esta semana');
  } else if (est.note === 'reset') {
    out.push('reinicio: ' + est.stall + ' sesiones sin sumar reps a ' + est.from + u +
      ' — un escalón abajo y a reconstruir hasta el tope del rango');
  } else if (est.note === 'stallOne') {
    out.push(est.stall + ' sesiones sin sumar reps a ' + est.from + u +
      ': una rep más en total, en la primera serie con margen, y el resto igual');
  } else if (est.note === 'stallLong') {
    out.push(est.stall + ' sesiones sin sumar reps a ' + est.from + u +
      ': si esta tampoco suma, baja un escalón o cambia el ejercicio');
  }
  if (est.pacing) {
    /* The clamped sets, in the order they come, with the RIR each one will
       land at. Said as pacing rather than as load because the first set
       reaches the range at the prescription — it is the session that
       falls away, not the weight that is wrong. */
    const nums = est.short.map(x => x.set);
    const list = nums.length === 1 ? String(nums[0]) : nums.slice(0, -1).join(', ') + ' y ' + nums[nums.length - 1];
    const lands = est.short.map(x => '~' + Math.max(0, x.land));
    const landTxt = lands.length === 1 ? lands[0] : lands.slice(0, -1).join(', ') + ' y ' + lands[lands.length - 1];
    out.push('a ' + est.rirThis + ' RIR ' + (nums.length === 1 ? 'la serie ' : 'las series ') + list +
      (nums.length === 1 ? ' no llega' : ' no llegan') + ' a ' + est.reps[nums[0] - 1] + ': ' +
      (nums.length === 1 ? 'va' : 'van') + ' igualmente, y ' + (nums.length === 1 ? 'saldrá' : 'saldrán') +
      ' a ' + landTxt + ' RIR. El peso lo aguanta la primera serie; lo que cae es el resto de la sesión');
  } else if (est.rirDrop) {
    out.push('ojo: la última fue a ' + rirWas + '; a ' + est.rirThis + ' RIR las mismas fuerzas dan ~' +
      est.predLast + ' y no ' + est.fromReps + ' — el objetivo ya lo descuenta. No es retroceso.');
  } else if (est.rirGain) {
    out.push('la última fue a ' + rirWas + ' y esta semana pide ' + est.rirThis +
      ': parte de las reps de más salen de ahí, no de ganar fuerza');
  }
  if (est.extra) {
    const first = est.reps.length - est.extra + 1, lastIdx = est.reps.length;
    out.push(est.extra === 1
      ? 'la serie ' + first + ' no tiene referencia a ' + est.from + u + ': ~' + est.reps[est.reps.length - 1] +
        ' reps es una extrapolación de la caída entre series'
      : 'las series ' + first + '–' + lastIdx + ' no tienen referencia a ' + est.from + u +
        ': sus reps son una extrapolación de la caída entre series');
  }
  return out;
}

/* The progress chart lives in js/chart.js. */

/* The bar, the plate set and the machine-stack increment a profile starts
   with. Read by migrate() and by Ajustes, and by the warm-up calculator in
   js/calculator.js — which is why they are declared here, in the file that
   is always on the page, rather than travelling with the calculator. */
const DEFAULT_BAR_WEIGHT = { kg: 20, lb: 45 };
const DEFAULT_PLATES = { kg: [1.25, 2.5, 5, 10, 15, 20], lb: [2.5, 5, 10, 25, 35, 45] };
const DEFAULT_STACK_INC = { kg: 5, lb: 10 };

/* Shared: the calculator rounds a warm-up step with it, targetEstimate
   rounds next week's weight with it. */
const roundToStep = (v, step) => step > 0 ? Math.round(v / step) * step : v;

/* The warm-up ramp and plate calculator live in js/calculator.js. */

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
/* `volumeOf` defaults to setVolume (raw, unconverted — the session view's
   own definition), but every reader that spans sessions passes
   convertedSetVolume (above) instead: see the comment by rowWeight for why
   the two must stay separate functions. */
function blockTonnageByWeek(profile, block, volumeOf) {
  const vol = volumeOf || setVolume;
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
      if (Array.isArray(rows)) out[w - 1] += rows.reduce((t, r) => t + vol(r), 0);
    });
  });
  return out;
}

/* ---------- volume landmarks ----------
   The volume view answers "this week", one week at a time. The question
   you actually have is "did chest volume go up across the block, and is it
   enough?" — and "enough" needs a number on the chart, not in your head.

   Working ranges from the hypertrophy literature, not precision targets:
   roughly 10 hard sets per muscle per week as a floor for growth, more
   continuing to help up to about 20 with clearly diminishing returns and a
   rising fatigue bill, and below about 6 doing little more than holding
   what you have. Individual response varies enough that the point of
   drawing them is to find YOUR numbers — which is why they are a shaded
   band you read against, never a target the app nags you toward.

   They only make sense per muscle. A "pattern" or a "type" has no such
   landmark — nobody has established a weekly set range for horizontal
   pushing — so the band is drawn on the muscle dimension alone. */
const VOL_BAND_LOW = 10, VOL_BAND_HIGH = 20, VOL_MAINTENANCE = 6;
/* Short on purpose: this sits on one line next to the muscle's name on a
   360px phone, and the shaded band right below it is the real explanation. */
const VOL_ZONE = {
  under: 'bajo mantenimiento',
  maint: 'mantenimiento',
  in: 'en la franja',
  over: 'sobre la franja',
};

/* Set counts for every tag across every week of the block, as
   { tag: [w1, w2, …] }. volumeTotals() already answers this one week at a
   time for either scope, so this is that call in a loop — same deload
   halving, same "+1 serie desde semana N", same plan-vs-registrado rule. */
function volumeByWeek(scope, profile, block, dim) {
  const weeks = blockWeeks(block);
  const out = {};
  blockTagsFor(dim, block).forEach(t => { out[t] = new Array(weeks).fill(0); });
  for (let w = 1; w <= weeks; w++) {
    const totals = volumeTotals(scope, profile, block, w, dim);
    Object.keys(totals).forEach(t => {
      if (!out[t]) out[t] = new Array(weeks).fill(0);
      out[t][w - 1] = totals[t];
    });
  }
  return out;
}

/* Which weeks count toward "where does this muscle usually sit". A deload
   is halved on purpose, so counting it would drag every muscle under the
   band and flag a block that is doing exactly what it says. On the
   registrado side, weeks you simply have not trained yet are not weeks of
   low volume — only weeks with something logged are evidence. */
function volumeWeeksInPlay(scope, block, series) {
  const dl = deloadWeek(block);
  const idx = [];
  series.forEach((v, i) => {
    if (i + 1 === dl) return;
    if (scope === 'log' && !v) return;
    idx.push(i);
  });
  return idx;
}

/* Median, not mean: one deliberately light week shouldn't move the verdict,
   and neither should one heavy one. */
function volumeTypical(scope, block, series) {
  const vals = volumeWeeksInPlay(scope, block, series).map(i => series[i]).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/* One row per tag: its weekly series, where it typically sits, and — for
   muscles only — how that reads against the band. Sorted so the rows that
   need looking at come first: priority muscles under the band, then
   everything else by volume. */
function volumeTrendRows(scope, profile, block, dim) {
  const byWeek = volumeByWeek(scope, profile, block, dim);
  const banded = dim === 'muscle';
  const rows = Object.keys(byWeek).map(tag => {
    const series = byWeek[tag];
    const typical = volumeTypical(scope, block, series);
    const priority = banded && isPriority(block, tag);
    /* "Sin clasificar" is a bucket the app assigned itself, not a muscle:
       reading it against a per-muscle landmark would be inventing a verdict
       about a group whose only shared property is missing a tag. */
    const rated = banded && tag !== UNCLASSIFIED_LABEL && typical != null;
    const zone = !rated ? ''
      : typical < VOL_MAINTENANCE ? 'under'
      : typical < VOL_BAND_LOW ? 'maint'
      : typical > VOL_BAND_HIGH ? 'over' : 'in';
    return {
      label: tag, series: series, typical: typical, priority: priority, zone: zone,
      total: series.reduce((t, v) => t + v, 0),
      flagged: priority && (zone === 'under' || zone === 'maint'),
    };
  });
  return rows.sort((a, b) =>
    (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) ||
    (b.priority ? 1 : 0) - (a.priority ? 1 : 0) ||
    b.total - a.total ||
    a.label.localeCompare(b.label, 'es'));
}

/* The dashboard that draws all of this lives in js/volume-sheet.js. */

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

/* The webfont is parked on media="print" so it cannot hold up the app (see
   index.html). Once it has loaded there is nothing left to wait for, so it
   is switched on for real. Never switched on while it is still pending:
   that would hand back the render-blocking this exists to avoid. */
function enableWebfont() {
  const link = document.getElementById('webfont');
  if (!link || link.media === 'all') return;
  /* link.sheet is set once the stylesheet has parsed — on a repeat visit the
     worker serves it from cache and it is already there by now. */
  if (link.sheet) { link.media = 'all'; return; }
  link.addEventListener('load', () => { link.media = 'all'; }, { once: true });
}

/* ---------- offline ----------
   A gym basement with no signal is the normal case, not the edge case, so
   the app installs itself and serves from cache. Updates are never applied
   under you mid-session: a new version waits until you say so, and the
   pending write is flushed before the reload that picks it up. */
/* ---------- which version is this? ----------
   "Did it update?" was, until this line existed, a question you could only
   answer by reasoning about service workers. The number comes from the
   worker currently serving the page, because that is the thing that decides
   which copy of the app you got — a constant compiled into this file would
   only ever tell you what this file thinks it is.

   Nothing is shown when there is no answer: no worker yet (a first visit,
   or file://), or one too old to know the question. It appears by itself
   once a worker that does answer takes over. */
function renderVersion() {
  const el = $('version');
  if (!el) return;
  const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!worker) return;
  try {
    const channel = new MessageChannel();
    channel.port1.onmessage = e => {
      if (!e.data) return;
      el.textContent = 'Heavy Iron ' + e.data;
      el.hidden = false;
    };
    worker.postMessage('version', [channel.port2]);
  } catch (e) { /* no channel here — the line just stays hidden */ }
}

/* Not more often than this, however many times the app is brought back to
   the foreground — a check between two sets is a wasted request. */
const UPDATE_CHECK_MS = 15 * 60 * 1000;
let lastUpdateCheck = 0;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;

  const offerUpdate = sw => {
    toast('Hay una versión nueva de la app.', 'Actualizar', () => sw.postMessage('skipWaiting'));
  };

  navigator.serviceWorker.register('sw.js').then(reg => {
    /* A version that finished installing while nobody was looking — the app
       was closed, or the prompt was dismissed — is already *waiting* by the
       time this runs, and updatefound never fires again for it. Without this
       line the app sits on the old code with the new one parked behind it
       and nothing on screen to say so: waiting workers only take over once
       every window is closed, and an installed app that gets backgrounded
       rather than quit never closes. */
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(sw);
      });
    });

    /* The browser looks for a new worker when the page is navigated to, and
       an installed app coming back from the background never navigates: it
       is the same page it was on Tuesday. So ask on the way back in. */
    renderVersion();

    lastUpdateCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
      lastUpdateCheck = Date.now();
      reg.update().catch(() => { /* no signal — the basement case, and fine */ });
      /* A worker that installed with a hole in its precache (sw.js,
         'install') self-heals on 'activate', but a device that has been
         open since then never re-activates on its own. Ask the controller
         to check its own cache on the same cadence as the update check
         above, so the hole does not outlive the current session. */
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('checkShell');
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

/* profileExportPayload/renderProfileExports above are the export half of
   moving one person between phones; loadProfileFromText, the load half, now
   lives in js/profile-transfer.js alongside backup/restore. */

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

/* ---------- sharing a block, and what it is safe to accept back ----------
   The QR transfer that made all of this necessary lives in
   js/qr-transfer.js. These stayed because three other files read them:
   blockSharePlan from js/block-editor.js, blockDoneSets from there and
   from js/review.js, and LOG_LIMITS/normalizeImportedLog/
   normalizeImportedRir from js/profile-transfer.js, which runs a restored
   backup through the same per-row checks the camera path has. */

/* Rows arrive from a camera or from a restored backup file, so they get the
   same treatment as any other imported data: bounded, coerced, never trusted
   for length or type. */
const LOG_LIMITS = { rows: 24, val: 12, slots: MAX_WEEKS * IMPORT_LIMITS.days };
/* A single exercise logging LOG_LIMITS.rows (24) sets in one session is
   already more than a real workout has; two orders of magnitude past that
   is not a long session, it is a row array padded to make every consumer
   that walks the whole array — the CSV export, the volume dashboard's
   Math.max spreads, countProfileSets — hang the tab the first time it
   opens. Rejected outright rather than silently sliced to LOG_LIMITS.rows,
   the same call ex.add makes in normalizeImportedBlock: a backup this far
   off is not a backup with a little extra padding, and truncating it would
   restore silently instead of saying so. */
const LOG_ROW_HARD_CAP = LOG_LIMITS.rows * 100;

/* ---- what gets sent ----
   Retired days and exercises (`off`) are left out on purpose: you are
   sharing the plan as you see it, and the import path has no concept of a
   retired item anyway, so sending them would quietly resurrect them on the
   other phone. Their log rows go with them. */
function blockSharePlan(block) {
  const plan = {
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
  /* Only when there is one, so a plan nobody marked priorities on exports
     byte-identical to how it always did. */
  const priority = blockPriority(block);
  if (priority.length) plan.priority = priority.slice();
  return plan;
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

/* The session orders logged against one block, keyed by slot like the maps
   above, each one an array of the block's own exercise ids. Retired and
   deleted exercises are stripped here rather than sent — the receiver's
   orderedEx would drop them anyway, and the sequence that survives is
   still the sequence they were done in. A slot left holding fewer than two
   is not an order at all and does not travel. */
function blockShareOrder(profile, block) {
  const src = profile.order[block.id];
  if (!src) return {};
  const liveDays = dayList(block);
  const out = {};
  liveDays.forEach(day => {
    const liveEx = new Set(exList(day).map(e => e.id));
    for (let w = 1; w <= MAX_WEEKS; w++) {
      const key = slot(w, day.id);
      const ids = src[key];
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter(id => liveEx.has(id));
      if (kept.length > 1) out[key] = kept;
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
/* Shared by normalizeImportedLog, normalizeImportedRir and
   normalizeImportedOrder: all three need to re-key a payload from the
   sender's day/exercise ids to whatever `normalizeImportedBlock` renamed
   them to. First occurrence wins, both here and for days. A sender whose
   block had the same id on two exercises *of one day* leaves a mapping that
   is genuinely ambiguous — but `normalizeImportedBlock` renames the *later*
   duplicate and leaves the first one's id alone, so rows filed under that
   id belong to the first. Letting the duplicate overwrite the mapping would
   quietly move somebody's sets onto a different exercise. */
function importIdMaps(rawBlock, normalized) {
  /* Object.create(null), not {}: every key below is a raw, untrusted id.
     A plain object answers `map['__proto__']` with the real Object.prototype
     and `map['toString']` with a function — both truthy, so an id like that
     resolved to an object and the rows it carried were filed under the
     literal key '[object Object]'. `put`'s `in` check has the mirror
     problem: `'__proto__' in {}` is already true, so that mapping was never
     stored to begin with. With no prototype there is nothing to inherit,
     so any string is just a key (same reasoning as ownGet,
     js/profile-transfer.js). */
  const dayMap = Object.create(null), exMap = Object.create(null);
  const put = (map, from, to) => { if (from != null && !(String(from) in map)) map[String(from)] = to; };
  (rawBlock.days || []).forEach((rd, di) => {
    const nd = normalized.days[di];
    if (!nd || !rd) return;
    put(dayMap, rd.id, nd.id);
    /* A log already keyed by the id the block ended up with still resolves. */
    put(dayMap, nd.id, nd.id);
    /* Per day, not per block: the log is keyed by slot (week + day) and then
       by exercise id, so an id that appears on two days resolves differently
       depending on which day's slot is being read. One flat map sent day B's
       rows to day A's exercise (plans/010). Normalized day ids are unique
       across the block (`usedDayIds` in normalizeImportedBlock), so each day
       gets its own map. */
    const forDay = exMap[nd.id] || (exMap[nd.id] = Object.create(null));
    (Array.isArray(rd.ex) ? rd.ex : []).forEach((re, ei) => {
      const ne = nd.ex[ei];
      if (!ne || !re) return;
      put(forDay, re.id, ne.id);
      put(forDay, ne.id, ne.id);
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
    const exFor = exMap[dayId] || Object.create(null);
    const kept = {};
    Object.keys(slotLog).forEach(rawExId => {
      const exId = exFor[rawExId];
      if (!exId || !Array.isArray(slotLog[rawExId])) return;
      if (slotLog[rawExId].length > LOG_ROW_HARD_CAP) {
        throw new Error('trae ' + slotLog[rawExId].length + ' series para un solo ejercicio en una sesión — demasiadas para ser un registro real.');
      }
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
    const exFor = exMap[dayId] || Object.create(null);
    const kept = {};
    Object.keys(slotRir).forEach(rawExId => {
      const exId = exFor[rawExId];
      if (exId && RIR_OPTIONS.indexOf(slotRir[rawExId]) >= 0) kept[exId] = slotRir[rawExId];
    });
    if (Object.keys(kept).length) out[slot(w, dayId)] = kept;
  });
  return out;
}

/* The session-order twin, re-keyed the same way. Ids the sender's block
   does not account for are dropped rather than carried through as strings
   that would never resolve on this phone. */
function normalizeImportedOrder(rawOrder, rawBlock, normalized) {
  if (!rawOrder || typeof rawOrder !== 'object' || Array.isArray(rawOrder)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(rawOrder).slice(0, LOG_LIMITS.slots).forEach(key => {
    const m = /^w(\d+)-(.+)$/.exec(key);
    if (!m) return;
    const w = +m[1];
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[m[2]];
    if (!dayId) return;
    const ids = rawOrder[key];
    if (!Array.isArray(ids)) return;
    const exFor = exMap[dayId] || Object.create(null);
    const seen = new Set();
    const kept = [];
    ids.slice(0, ORDER_LIMIT).forEach(rawExId => {
      const exId = exFor[rawExId];
      if (exId && !seen.has(exId)) { seen.add(exId); kept.push(exId); }
    });
    if (kept.length > 1) out[slot(w, dayId)] = kept;
  });
  return out;
}

/* ---------- CSV export ----------
   One row per logged set, for looking at the numbers somewhere the app
   cannot: a spreadsheet, a chart, a coach's inbox. Deliberately one-way —
   the .json is what restores, and mixing the two up loses data. */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  /* A cell starting with = + - @ (or a tab/CR) is a formula to Excel,
     LibreOffice and Sheets. Names in this file come from imported blocks
     and profile files, so the file that travels to a coach must not be
     able to carry one. A leading apostrophe is the conventional way to say
     "text" — spreadsheets hide it. Logged numbers never start with these. */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv() {
  /* `peso` is the number exactly as it was typed and `unidad` is what that
     number is in, taken from the row's own stamp. A fixed column name plus
     an explicit unit is what makes a file holding both kg and lb rows — a
     mid-block unit switch, a profile from a partner on the other unit —
     readable at all; a header that just said "kg" was making a claim about
     rows it could not make. */
  const rows = [['perfil', 'bloque', 'semana', 'dia', 'ejercicio', 'orden', 'serie', 'peso', 'unidad', 'reps', 'hecha', 'fecha', 'rir', 'bajadas', 'tipo_bajada']];
  Object.keys(state.profiles).forEach(pk => {
    const profile = state.profiles[pk];
    profile.blockOrder.forEach(bId => {
      const block = profile.blocks[bId];
      block.days.forEach(day => {
        /* The position each exercise was actually done in, per week. It
           falls back to the plan's own order for every session nobody
           reordered — which is most of them — so the column is filled in
           for every live exercise and sorting a spreadsheet by it always
           works. A retired exercise is not in any session's order and
           leaves the cell empty rather than borrowing a number off one
           that was actually done. */
        const ordAt = {};
        for (let w = 1; w <= blockWeeks(block); w++) {
          ordAt[w] = {};
          orderedEx(profile, block, w, day).forEach((e, i) => { ordAt[w][e.id] = i + 1; });
        }
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
              /* The weight stays as typed, so a row here matches the card
                 it was logged on rather than being converted to whichever
                 unit happened to be selected at export time; `unidad` is
                 what says which one it is. The drops share that stamp —
                 they have none of their own. */
              rows.push([profile.label, block.name, w, day.name, ex.n, ordAt[w][ex.id] || '', i + 1, r.w, rowUnit(r), r.r,
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

/* block-editor.js, diagnostics.js and profile-transfer.js load before
   app.js, but their DOM wiring (button clicks etc.) is deferred into these
   functions instead of running at their own top level — so it only ever
   runs once every script on the page (this one included) has finished
   parsing, regardless of load order. See js/block-editor.js,
   js/diagnostics.js and js/profile-transfer.js for why that matters. */
wireBlockEditor();
/* Guarded, unlike wireBlockEditor/wireProfileTransfer, because these
   three files are newer than some already-deployed shells: a returning user
   whose service worker still holds the previous index.html can be served
   this app.js against markup that has no script tag for them yet. An
   unguarded call would throw here, load() below would never run, and the
   app would sit on "Cargando tu registro…" — the same stuck screen the
   first script split caused. Losing a button until the worker updates is
   the right failure. Every file split out of this one from now on joins
   this list — see plans/008 item 13. */
if (typeof wireDiagnostics === 'function') wireDiagnostics();
if (typeof wireReview === 'function') wireReview();
if (typeof wireCalculator === 'function') wireCalculator();
if (typeof wireRestTimer === 'function') wireRestTimer();
if (typeof wireChart === 'function') wireChart();
if (typeof wireVolumeSheet === 'function') wireVolumeSheet();
if (typeof wireQrTransfer === 'function') wireQrTransfer();
wireProfileTransfer();

load();
enableWebfont();
registerServiceWorker();
