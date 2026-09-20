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
/* Same shape, same reason, for the pair note under the week row: it opens on
   a tap and stays open for the rest of the session, and because the day is
   in the key, walking to the next day starts it folded again (plans/034). */
const expandedPair = new Set();
const pairKey = (block, day) => state.activeProfile + '|' + block.id + '|' + day.id;
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

/* Exercise names, day names, block names, muscle tags and session notes
   arrive from imports and go into a document written for a language model.
   Delimited, so a name cannot read as an instruction to the model; `txt()`
   already collapsed whitespace on the way in, so the only characters to
   strip are the delimiters themselves. Lives here rather than in
   review.js because block-editor.js and diagnostics.js read it too, and a
   symbol another split file reads stays in app.js (AGENTS.md). */
const reviewName = s => '«' + String(s == null ? '' : s).replace(/[«»]/g, '') + '»';

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

/* The mirror of slot(), and with it the only pair that knows the key's
   shape. Eleven readers across four files ran /^w(\d+)-(.+)$/ by hand, so
   changing the shape meant finding all eleven; now it is these two lines. */
function parseSlot(k) {
  const m = /^w(\d+)-(.+)$/.exec(k);
  return m ? { week: +m[1], dayId: m[2] } : null;
}

/* The one way imported rows reach a profile. Both routes that add an
   imported block — the pasted/loaded JSON and a scanned QR — land in
   installImportedBlock, which used to assign the maps by hand, each
   assignment trusting that normalizeImported* had already applied the
   guards the accessors below apply. Two write vocabularies that agreed by
   convention; this is the one that does not have to.

   safeKey is what the hand-written version was missing: a block id is a key
   on five maps, and `__proto__` is a name a hand-edited file can carry
   (plans/008 item 2). Returns false when it refuses, so a caller cannot
   file a block and quietly lose its rows.

   normalizeImportedProfile deliberately does not come through here: it
   walks the *sender's* keys and re-keys every map afterwards, so it is a
   normalization pass over an untrusted object, not an install into a live
   profile. See plans/009 item 5.

   `obj` is deliberately absent from the list: the record of what the rule
   asked for travels only with a whole profile (normalizeImportedProfile),
   never with a block share. Nothing produces one — neither the pasted JSON
   nor the QR "plan + registro" payload carries it — and nothing ever will:
   the receiving phone recomputes the objetivo from the log it is sent, and
   a record it did not show is not its record to hold (decision,
   plans/025). */
function installBlockData(profile, blockId, data) {
  const id = safeKey(blockId);
  if (!id) return false;
  const d = data || {};
  ['log', 'rir', 'order', 'notes', 'energy'].forEach(name => {
    if (!d[name]) return;
    if (!profile[name]) profile[name] = {};
    profile[name][id] = d[name];
  });
  /* A phone on an older shell still sends the legacy RIR map beside the log
     (blockShareRir), so a block arriving by QR or by paste gets the same
     fold a block already on disk got on load. */
  foldRirMap(profile, id);
  return true;
}

/* Walk the slots one block of one of the four parallel maps actually holds,
   in no particular order: fn(key, week, dayId, value), narrowed by `filter`
   on dayId, week, or both.

   The sweeps this replaces rebuilt every *possible* key from 1 to MAX_WEEKS
   and looked each one up, which made "borrar registro" quietly mean "up to
   week 16": a block shortened from 12 weeks to 6 still files rows under
   weeks 7-12 — that part worked — but a hand-edited or older backup can
   hold a week past the cap, and those were walked straight past and left
   behind. Iterating what is there has no cap to be wrong about, and costs
   one pass instead of sixteen lookups.

   Object.keys() is a snapshot, so fn may delete the key it was handed. */
function forEachSlot(map, blockId, fn, filter) {
  const blk = map && map[blockId];
  if (!blk) return;
  const f = filter || {};
  Object.keys(blk).forEach(key => {
    const s = parseSlot(key);
    if (!s) return;
    /* != null, not !== undefined: the walk this replaced treated a missing
       week as "every week" via a plain truthiness check, and a caller that
       passes null would otherwise match nothing and silently purge nothing. */
    if (f.dayId != null && s.dayId !== f.dayId) return;
    if (f.week != null && s.week !== f.week) return;
    fn(key, s.week, s.dayId, blk[key]);
  });
}

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
   absent: the guide's own volume breakdown (docs/guide.md, "Los planes por
   defecto") folds front-delt work into press volume rather than tracking it
   as its own line, and leaving it out of this table reproduces that exactly
   — it shows up as unclassified in the dashboard, same as a genuinely
   untagged custom exercise. Applied once in
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
    /* The record is `row.rir` since plans/035; this map is what every
       session logged before it has. Folded onto the rows here rather than
       behind a version gate: the fold is idempotent and costs one pass over
       a map most profiles barely have, and a gate that skipped it would be
       one more thing to be wrong about — the fallback read in getRir and
       exSession means a skipped fold is a slower reader, not data loss. */
    Object.keys(profile.rir).forEach(bk => foldRirMap(profile, bk));
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
    /* A sixth map with the `rir` shape — blockId → slot → exId — holding
       the target this rule actually put on the screen that session. It is
       the only thing that can tell a back-off the plan asked for from a
       weight that had to come off, and the only way to measure the rule's
       own error instead of assuming it. Written by the session view, read
       by nothing that matters yet, and absent in every backup written
       before v3, so every reader has to cope with it missing. */
    if (!profile.obj || typeof profile.obj !== 'object') profile.obj = {};
    /* Keyed by exercise id rather than by block: an exercise is renamed in
       ONE block and the history the target rule gathers crosses all of
       them, so the record of "this is a different lift from here on" has
       to live where the id does. */
    if (!profile.variants || typeof profile.variants !== 'object') profile.variants = {};
    Object.keys(profile.variants).forEach(exId => {
      const list = profile.variants[exId];
      if (!Array.isArray(list)) { delete profile.variants[exId]; return; }
      const clean = list.filter(v => v && typeof v === 'object' && VARIANT_SINCE_RE.test(String(v.since)))
        .map(v => ({ n: txt(v.n, IMPORT_LIMITS.exName) || '', since: String(v.since) }))
        .slice(-VARIANT_LIMIT);
      if (clean.length) profile.variants[exId] = clean; else delete profile.variants[exId];
    });
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
          /* safeKey on the slug too: a name can slug straight to a reserved
             word — "Constructor" to `constructor` — and an id safeKey
             refuses is one recordVariant and the import's variants block
             silently drop, so that lift could never carry a rename cut. */
          if (!id2 || usedEx.has(id2)) { id2 = safeKey(slugify(ex.n)) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
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
          /* Absent by default, like `share`/`ss`: only the lifts that never
             go near failure carry one. See weekRir. */
          if (ex.minRir != null) { const v = clampInt(ex.minRir, 0, 5, 0); if (v > 0) ex.minRir = v; else delete ex.minRir; }
          if (ex.setup != null) { const s = txt(ex.setup, SETUP_LIMIT); if (s) ex.setup = s; else delete ex.setup; }
        });
      });
    });

    /* After the blocks are repaired, because it reads the name each of the
       three slots is carrying right now. */
    seedLateralVariants(profile);
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

/* The half of flushSave an import's pre-flight needs: land the pending
   debounce so its "Guardado hh:mm" cannot overwrite the rejection reason
   printed a few lines later — and nothing else. flushSave forces because it
   runs when the tab is going away, where an unanswered conflict toast must
   not cost a set; a file that turns out not to be a backup is not that
   moment, and restoreFromText calling the forcing one meant that opening a
   bad file answered "Quedarme con lo mío" on the user's behalf. While
   `held` the storage handler has already cancelled the timer, so there is
   nothing here to land and the conflict is left exactly as it was. */
function flushPending() {
  if (!saveT) return;
  clearTimeout(saveT);
  saveT = null;
  writeState();
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
   the toast, let alone answered it — the two-tab guarantee the guide sells
   (docs/guide.md, "When the data goes wrong") was really just a message that
   arrived after the fact. */
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

/* What the confirm dialog in front of a snapshot is allowed to promise,
   kept next to the snapshot so the two cannot drift apart. Five dialogs
   used to say "No se puede deshacer." and then call snapshotForUndo
   anyway: anyone who believed the dialog never went looking for the toast,
   which is the whole point of the feature (plans/013). The one dialog in
   js/block-editor.js that still says it — deleting a retired exercise's
   log from the editor — is right to, because that path has no snapshot
   behind it until the editor's own save takes one.
   Same scope rule as UNCLASSIFIED_LABEL above: defined here, read from the
   files that load before this one, and only ever from inside a handler. */
const UNDO_PROMISE = 'Podrás deshacerlo justo después, mientras no hagas otra cosa.';

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
/* Its own variable, not an entry on the sheet stack below: a confirm raised
   from inside an open sheet (wipe, delete block) used to null the one shared
   return target sheets had between them, so when the sheet itself closed
   afterwards focus had nowhere to return to. The stack would survive that
   now, but a confirm is still not a sheet and never goes on it. */
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

/* ---------- sheets ----------
   Escape closes the top one, and focus goes into the dialog when it opens
   and back to whatever opened it when it closes, so the whole app is usable
   without a mouse. */
/* One registration per sheet, made from the owning file's own wire*(), so a
   new sheet is one call rather than four separate edits that had to agree: a
   hand-kept id list, a branch in the Escape handler, and a copy of the
   backdrop-click and close-button pair. The list and the branch are exactly
   what went wrong — reviewSheet and diagSheet were opened by openSheet() but
   missing from the list, and Escape did nothing on them (plans/013 fixed the
   two; this is the shape that stops a third).

   `onClose` is the teardown Escape and the backdrop must run instead of a
   bare closeSheet: closePlanEditor, closeSetup, closeQr and closeReview each
   do something on the way out that losing would be a bug — reviewSheet, for
   one, carries the resume callback "+ Nuevo bloque" is waiting on.

   Registering is optional on purpose. A precache hole — the worker serving
   an index.html whose script tag for a split file was never cached — leaves
   that file's registration unmade, and an unregistered sheet still opens and
   still closes on Escape with the default closeSheet. That is what lets
   app.js stop naming closeQr and closeReview at all: the structure now
   covers the hole a no-op stub used to (AGENTS.md rule (a)). */
const sheets = Object.create(null);   /* id -> { onClose } */
const sheetStack = [];                /* [{ id, returnTo }], bottom to top */

function registerSheet(id, opts) {
  const o = opts || {};
  sheets[id] = { onClose: o.onClose || null };
  const close = () => (o.onClose ? o.onClose() : closeSheet(id));
  if (o.closeBtn) $(o.closeBtn).onclick = close;
  $(id).addEventListener('click', e => { if (e.target.id === id) close(); });
}

/* A stack, not the single slot this used to be: qrSheet opens on top of the
   backup sheet and reviewSheet on top of the blocks sheet, and one shared
   return target meant the inner sheet's close overwrote the outer one's — so
   closing the outer sheet afterwards sent focus nowhere. */
function openSheet(id) {
  const el = $(id);
  /* Opening a sheet that is already up must not stack a second entry, or
     Escape would need two presses and the first return target would be
     something inside the sheet itself. */
  if (!el.classList.contains('up')) sheetStack.push({ id: id, returnTo: document.activeElement });
  el.classList.add('up');
  const box = el.querySelector('.sheet-box');
  box.setAttribute('tabindex', '-1');
  box.focus();
}

function closeSheet(id) {
  $(id).classList.remove('up');
  const i = sheetStack.map(s => s.id).lastIndexOf(id);
  const back = i < 0 ? null : sheetStack.splice(i, 1)[0].returnTo;
  /* isConnected: something opened under this sheet can have triggered a full
     render() that recreated the button that opened it (the nav bar is
     rebuilt on every render) — same reasoning as closeAsk, above. */
  if (back && back.isConnected && back.focus) back.focus();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (askResolve) { closeAsk($('askInput').hidden ? false : null); return; }
  const top = sheetStack[sheetStack.length - 1];
  if (!top) return;
  const reg = sheets[top.id];
  if (reg && reg.onClose) reg.onClose(); else closeSheet(top.id);
});

/* ---------- first-run setup / settings ----------
   The app used to open on somebody else's training plan, under somebody
   else's names, measured in somebody else's units, with no way to change
   any of it short of the plan editor. This is the thirty seconds that makes
   it yours. It is offered once, on a device with no saved data, and lives
   under "Ajustes" forever after — where the starting-plan question is
   hidden, because by then that is what blocks are for. */
const ACCENTS = ['azul', 'verde'];
const ACCENT_LABEL = { azul: 'Brasa', verde: 'Cian' };
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
registerSheet('setupSheet', { closeBtn: 'setupClose', onClose: closeSetup });
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
   totals[t] in the volume dashboard), and a tag of "__proto__" — or
   "toString", or any other name `Object.prototype` carries — reads the
   inherited member as "already there" and then throws on .push — an empty
   Diagnóstico with no message (plans/012). Typeable in the editor's
   Músculo box, so this is not only an import problem. */
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

/* Half the sets on a deload, counting the one `ex.add` brings in rather
   than discarding it: the week is "mitad de series" of the week you would
   otherwise have done, and the target line prices exactly this many. The
   phase text is read alongside the block's own `deload` field so a
   hand-written "Descarga" week halves too — see deloadAt. */
function setsFor(ex, w, block) {
  let n = ex.sets;
  if (ex.add && w >= ex.add) n += 1;
  if (block && deloadAt(block, w)) n = Math.max(2, Math.ceil(n / 2));
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

/* The line the card prints for that drop, or '' when there is no drop. It
   used to ask the question — "¿primera serie al fallo?" — because the log
   held nothing that could answer it. Since plans/035 the first set can say
   so itself, and the line says what it said instead of guessing: at 0 or 1
   in reserve the drop is explained, at 2 or more it is not and the rests
   are the next thing to look at. Its OWN value only, never the inherited
   one: a reserve nobody typed on the first set is not evidence about the
   first set.

   A pure function of `rows` so the unit suite can read the four texts
   without a browser; the flag's job — naming what phi[k] cannot — has not
   changed. */
function decayLine(rows) {
  const drop = repDecay(rows);
  if (!drop) return '';
  const head = '⚠ caída de ' + drop + ' reps';
  const first = rowRir((rows || [])[0]);
  if (first == null) return head + ': ¿primera serie al fallo?';
  if (first >= 2) return head + ' con la primera serie holgada (RIR ' + first + '): ¿descansos cortos?';
  return head + ': primera serie a ' + first + ' RIR — las de después se vacían';
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
   The app prescribes an RIR target per week in `phase`, and this is the
   record of what actually happened — the only thing that tells a hard set
   from a grinder short of guessing at rep decay.

   It used to be ONE value per exercise per session, filed in a parallel map
   (`profile.rir[blockId][slot][exId]`, the three chips below), on the theory
   that mid-set entry was too much friction. The cost was paid by every
   reader: one RIR priced every set of the session, so a session run 3 → 2 →
   1 → 0 down its four sets — which is what a well-paced session looks like —
   read as a lifter who lost far more capacity between sets than they did.

   Since plans/035 the record is `r.rir` on the log row: one digit '0'–'5',
   absent by default like `share`/`ss`, the same shape as `r.r` (a string out
   of an input, read with num()). On the row it travels with every purge,
   move, share, backup and import the row already survives, and there is one
   value per set for the rule to read.

   The old map is legacy: folded onto the rows on load and on import
   (foldRirMap), read as a fallback by getRir and by exSession, and never
   written again. The chip below is still the writer for one more plan —
   plans/036 draws the box next to the reps — and it writes onto the row.

   The inheritance rule (sessionRirs) is what makes a log with no per-set
   values read exactly as it always did: a set with nothing typed takes the
   reserve of the nearest LATER set that has one, and sets after the last
   typed value have none. A set done before a set typed at N RIR had at
   least N left, so pricing it at N under-reads it — the safe direction (see
   the censoring note) — and it is precisely what the one chip used to do to
   every set of the session. */
const RIR_OPTIONS = ['2+', '1', '0'];
const RIR_LABEL = { '2+': '2+ RIR', '1': '1 RIR', '0': '0 RIR (al fallo)' };
/* Past five reps in reserve the number stops saying anything a lifter can
   feel: it says "easy", which '5' already says. One digit, so the box in
   plans/036 is one keypress and maxlength="1" is the whole validation. */
const RIR_MAX = 5;

/* The row's own value as a number, or null when the row has none. Nothing
   else reads r.rir directly — a reader that wants the session's reading
   wants sessionRirs or getRir. */
const rowRir = r => {
  const v = r && r.rir;
  return /^[0-5]$/.test(String(v)) ? +v : null;
};

/* Working sets are what the rule reads and what the RIR belongs to: a row
   nobody ticked, or one with no weight or no reps, is not a set that had
   anything left in reserve. Same filter exSession applies. */
const rowWorked = r => !!(r && r.done && rowWeight(r) > 0 && num(r.r) > 0);

/* The per-set reading of one exercise-session, with the inheritance rule
   above. `legacy` is the old one-chip value as a number, used only when NO
   row carries one of its own: the chip then behaves exactly as if it had
   been typed on the last set, which is the reading every session logged
   before plans/035 has always had. */
function sessionRirs(rows, legacy) {
  const out = (rows || []).map(rowRir);
  if (out.length && legacy != null && !out.some(v => v != null)) out[out.length - 1] = legacy;
  let carry = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = carry; else carry = out[i];
  }
  return out;
}

/* The exercise-level reader the screens that still say "the session's RIR"
   keep using — the Diagnóstico's signals, the review's buckets, the chip's
   own pressed state: the last working set that has a value, else the legacy
   map, else ''. It returns a string either way ('3' or '2+'), because its
   callers compare it against the chips; take a number through rirNumber. */
function getRir(profile, blockId, w, dayId, exId) {
  const bucket = profile.log && profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
  const rows = bucket && bucket[exId];
  if (Array.isArray(rows)) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rowWorked(rows[i]) && rowRir(rows[i]) != null) return String(rowRir(rows[i]));
    }
  }
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}

/* Any recorded value as a number the arithmetic can use: a typed digit, or
   one of the three legacy chips. '2+' is open-ended — it may have been four
   — so it is read as exactly 2, which makes every estimate built on it come
   out low. That is the right direction to be wrong in: under-shooting costs
   one week of a slightly light set, over-shooting costs a failed session.
   Everything that used to compare a raw value against '2+' or '0' goes
   through this instead; the only string comparisons left are in
   normalizeImportedRir (the legacy map's own enum) and the review's
   buckets. */
const RIR_VALUE = { '2+': 2, '1': 1, '0': 0 };
const rirNumber = v => {
  if (Object.prototype.hasOwnProperty.call(RIR_VALUE, v)) return RIR_VALUE[v];
  return /^[0-5]$/.test(String(v)) ? +v : null;
};

/* Where a value recorded for the whole session goes on the rows: the last
   set actually done, else the last row of the exercise — a session nobody
   has ticked yet still has somewhere to put it. One rule, used by both the
   chip (setRir) and the fold below, so a chip written last week and a chip
   written today land on the same row. */
function rirRowFor(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let at = -1;
  rows.forEach((r, i) => { if (rowWorked(r)) at = i; });
  return rows[at >= 0 ? at : rows.length - 1] || null;
}

/* The one-time move of the legacy map onto the rows, run on load (migrate)
   and on every block that arrives with one (installBlockData — an old phone
   still sends the map with its QR). The map entry is left where it is: it
   costs nothing, it is what getRir and exSession fall back to when a slot
   has no rows to fold onto, and a receiver on an older shell still needs it.

   Idempotent by construction — a row that already carries a value is never
   overwritten — so running it on every load is cheap and a skipped run is
   not data loss. A malformed entry is skipped rather than thrown on, like
   every other repair in migrate. */
function foldRirMap(profile, blockId) {
  if (!profile || !profile.rir || !profile.log) return;
  forEachSlot(profile.rir, blockId, (key, w, dayId, slotRir) => {
    if (!slotRir || typeof slotRir !== 'object' || Array.isArray(slotRir)) return;
    const slotLog = profile.log[blockId] && profile.log[blockId][key];
    if (!slotLog || typeof slotLog !== 'object' || Array.isArray(slotLog)) return;
    Object.keys(slotRir).forEach(exId => {
      const n = rirNumber(slotRir[exId]);
      if (n == null) return;
      const row = rirRowFor(slotLog[exId]);
      if (!row || typeof row !== 'object' || rowRir(row) != null) return;
      row.rir = String(n);
    });
  });
}

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

/* The most recent note written on this same day of the block, before this
   week — the walk lastTime does for the sets. A note is written once and,
   until now, read back only by the block review weeks later; "rodilla
   izquierda en la hack" typed in week 2 is exactly what week 5, standing at
   the hack machine, needs in front of it. */
function lastNote(profile, blockId, dayId, beforeWeek) {
  const blk = profile.notes[blockId];
  if (!blk) return null;
  for (let w = beforeWeek - 1; w >= 1; w--) {
    const text = blk[slot(w, dayId)];
    if (text) return { week: w, text: text };
  }
  return null;
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

/* Writes the recorded RIR onto the row, never into the legacy map (see the
   RIR section). The chip says "RIR último set", so the row it writes is the
   last one actually done; a session with nothing ticked yet has no last set
   to speak of, so it falls back to the last row of the exercise rather than
   silently recording nothing. `val` is anything rirNumber understands — a
   chip ('2+' → '2') or a digit — and an empty value clears the row. */
function setRir(profile, blockId, w, dayId, exId, val) {
  const bucket = profile.log && profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
  const row = rirRowFor(bucket && bucket[exId]);
  if (!row) return;
  const n = val === '' || val == null ? null : rirNumber(val);
  if (n == null) delete row.rir; else row.rir = String(n);
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
  const weeks = blockWeeks(block);
  let n = 0;
  forEachSlot(profile.log, block.id, (k, w, d, s) => {
    if (w <= weeks) return;
    Object.keys(s || {}).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
  });
  return n;
}

/* These walk every week the day actually has rather than the block's length,
   on purpose: a block shortened from 12 weeks to 6 still has rows filed under
   weeks 7-12, and "borrar registro" has to mean all of it. They used to walk
   1..MAX_WEEKS for the same reason, which was the same intention with a cap
   on it — a key above the cap, from a hand-edited or older backup, was left
   behind to reappear if the block was ever lengthened again. */
function purgeExLog(profile, blockId, dayId, exId) {
  purgeRir(profile, blockId, dayId, exId);
  purgeObj(profile, blockId, dayId, exId);
  forEachSlot(profile.log, blockId, (k, w, d, s) => { if (s) delete s[exId]; }, { dayId: dayId });
}

function purgeDayLog(profile, blockId, dayId) {
  purgeRir(profile, blockId, dayId);
  purgeSessionMeta(profile, blockId, dayId);
  const blk = profile.log[blockId];
  forEachSlot(profile.log, blockId, k => delete blk[k], { dayId: dayId });
}

/* The session-level maps are keyed by slot alone, with no exercise under
   them, so unlike `rir` they do not quietly become unreadable when the
   sets they belonged to go: a note — or an order that says you started with
   the third exercise — would still be sitting there when the day came back.
   Whatever clears a session's sets clears these too. */
function purgeSessionMeta(profile, blockId, dayId, onlyWeek) {
  [profile.notes, profile.energy, profile.order, profile.obj].forEach(map => {
    const blk = map && map[blockId];
    if (!blk) return;
    forEachSlot(map, blockId, k => delete blk[k], { dayId: dayId, week: onlyWeek });
  });
}

/* `rir` and `obj` are the two parallel maps keyed by exercise under the slot,
   so each needs its own sweep: purgeSessionMeta cannot reach inside a slot,
   and a chip left behind with no set under it is invisible until the day
   comes back and shows a RIR nobody recorded. */
function purgeRir(profile, blockId, dayId, exId) {
  const blk = profile.rir && profile.rir[blockId];
  if (!blk) return;
  forEachSlot(profile.rir, blockId, (k, w, d, s) => {
    if (!s) return;
    if (exId) delete s[exId];
    else delete blk[k];
  }, { dayId: dayId });
}

/* The same sweep for the objetivo record: it is the other map keyed by
   exercise under the slot, and a record left behind after "borrar
   registro" outlives the sets it described — and, if the id is ever reused
   on that day, blocks the real record (recordTarget writes once). */
function purgeObj(profile, blockId, dayId, exId) {
  const blk = profile.obj && profile.obj[blockId];
  if (!blk) return;
  forEachSlot(profile.obj, blockId, (k, w, d, s) => {
    if (!s) return;
    if (exId) delete s[exId];
    else delete blk[k];
  }, { dayId: dayId });
}

/* "Send to another session" in the plan editor: the exercise moves between
   draft days right away, but everything filed under the session it was in —
   the log, the RIR chips (moveExRir), the objetivo record (moveExObj) and
   the session order (moveExOrder, below) — stays there until the draft is
   saved. This is what makes that filing catch up, across every week the
   block could have.

   Merges into the destination's existing entry for the id rather than
   overwriting it: a block can carry the same exercise id on two days by
   design (see migrate()'s day/exercise-id repair), so the destination can
   already have its own rows for this id, and blindly assigning would erase
   them. An array (a day's logged rows) is concatenated; anything else (an
   RIR chip, an objetivo record) is left alone if the destination already
   has one, since there is no way to merge two single values without
   picking a side — and for a record that is what it wants anyway: the
   destination day's own record describes the session that was actually
   shown there. Either way
   nothing is ever destroyed by calling this — including calling it twice,
   which peSave cannot do today but a future bug easily could. */
function moveExKeyed(map, blockId, fromDayId, toDayId, exId) {
  const blk = map[blockId];
  if (!blk) return;
  forEachSlot(map, blockId, (fromKey, w, d, from) => {
    if (!from || from[exId] === undefined) return;
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
  }, { dayId: fromDayId });
}

function moveExLog(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.log, blockId, fromDayId, toDayId, exId);
}

function moveExRir(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.rir, blockId, fromDayId, toDayId, exId);
}

function moveExObj(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.obj, blockId, fromDayId, toDayId, exId);
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
  /* The two halves are independent — the destination day can have a recorded
     order in a week the source day has no entry for at all, and the exercise
     still has to join it — so this walks the weeks *either* day has, not
     just the source's. */
  const weeks = new Set();
  forEachSlot(profile.order, blockId, (k, w, d) => { if (d === fromDayId || d === toDayId) weeks.add(w); });
  weeks.forEach(w => {
    const fromKey = slot(w, fromDayId), toKey = slot(w, toDayId);
    const fromIds = blk[fromKey];
    if (Array.isArray(fromIds)) {
      const i = fromIds.indexOf(exId);
      if (i >= 0) fromIds.splice(i, 1);
      if (!fromIds.length) delete blk[fromKey];
    }
    const toIds = blk[toKey];
    if (Array.isArray(toIds) && toIds.indexOf(exId) < 0) toIds.push(exId);
  });
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

   The NAME half is deliberately read for DISPLAY only. targetFor gathers
   its history by id alone, because that is the one statement the plan
   makes on purpose: two rows written with the same id are the same lift
   and two rows that merely read alike are not — the unilateral pec deck on
   Monday and the bilateral one on Thursday share a name and nothing else.
   Matching those two by name would prescribe a weight set on the fresher
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
   call would throw inside a card rather than merely doing nothing.

   js/qr-transfer.js needed one too until sheets registered their own
   teardown: the Escape handler used to name closeQr directly. It does not
   any more (see registerSheet below), and nothing outside that file can open
   the QR sheet, so there is no longer a symbol to stub. */
if (typeof openChart !== 'function') globalThis.openChart = function () {};


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
    /* Picking somebody puts the sheet away: the answer to "who is training"
       is one tap, not a tap and a dismissal. */
    b.onclick = () => { closeSheet('profileSheet'); state.activeProfile = key; stopRest(); commit(); };
    host.appendChild(b);
  });
  /* The header carries the answer, not the question: a dot in the profile's
     own accent, the name, and the chevron that says the sheet above is
     behind it. The dot takes its colour from #app.profile-* through
     --signal, so nothing here has to know which accent is in play. */
  const chip = $('profileBtn');
  chip.style.display = soloMode() ? 'none' : 'flex';
  chip.innerHTML = '<span class="dot"></span><span class="chip-lbl"></span><span class="chev" aria-hidden="true">▾</span>';
  chip.querySelector('.chip-lbl').textContent = getProfile().label;
  chip.setAttribute('aria-label', 'Perfil: ' + getProfile().label + '. Cambiar');
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

/* An id or a tag is an ordinary string everywhere except as a key into a
   fresh `{}`. Every name `Object.prototype` carries reads back truthy off
   an object that does not own it, so the `if (!m[k]) m[k] = []; m[k].push()`
   pattern skips the initialisation and throws on the `.push` (strengthRows,
   js/diagnostics.js; rowsFor, js/app.js) — straight to the recovery screen,
   or to a Diagnóstico blanked after its host was already cleared. For
   `__proto__` specifically the assignment re-points the object's prototype
   instead of adding a property. `Object.prototype.hasOwnProperty.call({}, s)`
   is not a fix on its own: a plain `{}` owns none of these names either,
   hasOwnProperty says so, and the walk up the chain happens anyway.

   Naming the three obvious ones was the bug. `toString`, `valueOf` and
   `hasOwnProperty` are just as typeable into the Músculo box and break
   exactly as hard; `in` asks the prototype chain the same question the
   truthy read asks, so this can no longer fall behind it.

   `prototype` stays enumerated: `'prototype' in {}` is false — it is a
   property of functions, not of `Object.prototype` — so the `in` test
   cannot see it, and the callers here were written against a contract that
   blocks it. Returns '' for a blocked key so the caller's existing "fall
   back to a generated one" path handles it for free. */
const UNSAFE_KEYS = ['prototype'];
function safeKey(id) {
  return (id in Object.prototype) || UNSAFE_KEYS.indexOf(id) >= 0 ? '' : id;
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

/* ---------- the week selector ----------
   The strip of week buttons used to be a permanent row in the header, for a
   choice that is made once a week. It is behind #weekBtn now, and this pair
   is what remembers whether it is showing. Open only for the day, block and
   profile it was opened on: stepping somewhere else is a new question, and a
   panel left open would push the first set row back below the fold — which
   is the entire point of folding the header (plans/034). */
let expandedWeek = false;
let weekPanelFor = '';

function applyWeekPanel() {
  $('weekPanel').hidden = !expandedWeek;
  $('weekBtn').setAttribute('aria-expanded', expandedWeek ? 'true' : 'false');
}

function renderNav() {
  const profile = getProfile();
  const block = getBlock();
  const days = dayList(block);

  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;

  $('weeks').innerHTML = '';
  const weeks = blockWeeks(block), dl = deloadWeek(block);

  /* The selector says which week and what it asks for, because with the
     strip folded away that line is the only place either is written. */
  const ph = block.phase[profile.week] || { r: '', t: '' };
  const wkBtn = $('weekBtn');
  wkBtn.innerHTML = '<span class="week-lbl"></span><span class="week-rir"></span><span class="chev" aria-hidden="true">▾</span>';
  wkBtn.querySelector('.week-lbl').textContent = 'Semana ' + profile.week + ' de ' + weeks;
  /* The leading space is for the accessible name, not the pixels: .week-rir
     is a flex item, so it is stripped before it is drawn, and the gap either
     side of the separator is the 6px one. */
  wkBtn.querySelector('.week-rir').textContent = ph.r ? ' · ' + ph.r : '';
  const scope = state.activeProfile + '|' + block.id + '|' + profile.day;
  if (scope !== weekPanelFor) { expandedWeek = false; weekPanelFor = scope; }
  applyWeekPanel();

  /* The arrows are the common case — next week, last week — and take the
     same route a .wk click does, so a step and a tap are the same event. */
  const prev = $('weekPrev'), next = $('weekNext');
  prev.disabled = profile.week <= 1;
  next.disabled = profile.week >= weeks;
  prev.onclick = () => { if (profile.week > 1) { profile.week--; stopRest(); commit(); } };
  next.onclick = () => { if (profile.week < weeks) { profile.week++; stopRest(); commit(); } };

  for (let w = 1; w <= weeks; w++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (w === dl ? ' deload' : '');
    b.textContent = w === dl ? 'DL' : w;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', w === profile.week ? 'true' : 'false');
    b.setAttribute('aria-label', 'Semana ' + w + (w === dl ? ', descarga' : ''));
    if (weekHasLog(profile, block, w)) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; stopRest(); commit(); };
    $('weeks').appendChild(b);
  }

  $('days').innerHTML = '';
  days.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day' + (i === profile.day ? ' on' : '');
    b.id = 'day-' + i;
    b.innerHTML = '<span class="day-n">Día ' + (i + 1) + '</span><span class="day-t"></span>';
    b.querySelector('.day-t').textContent = d.name;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === profile.day ? 'true' : 'false');
    b.setAttribute('aria-controls', 'list');
    b.setAttribute('aria-label', 'Día ' + (i + 1) + ': ' + d.name);
    /* Roving tabindex, the other half of what role="tab" promises: one stop
       for the whole strip in the Tab order, the arrows move within it. */
    b.tabIndex = i === profile.day ? 0 : -1;
    b.onclick = () => { profile.day = i; stopRest(); commit(); };
    $('days').appendChild(b);
  });
  /* The cards are this tab's panel, and which day they belong to is the tab
     that is on — so the label has to be re-pointed every draw. */
  $('list').setAttribute('aria-labelledby', 'day-' + profile.day);
}

/* role="tab" is a promise that the arrow keys work, and a tablist that only
   answers clicks is a worse lie than a row of plain buttons would have been.
   The WAI tabs pattern with automatic activation: moving the focus selects
   the day, exactly as a tap does. Bound once to the container, because
   renderNav replaces every button underneath it on every draw — which is
   also why the focus has to be put back by hand afterwards. */
$('days').addEventListener('keydown', e => {
  const tabs = Array.prototype.slice.call($('days').querySelectorAll('.day'));
  const at = tabs.indexOf(document.activeElement);
  if (at < 0) return;
  let to = -1;
  if (e.key === 'ArrowRight') to = (at + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') to = (at - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = tabs.length - 1;
  if (to < 0) return;
  e.preventDefault();
  getProfile().day = to;
  stopRest();
  commit();
  const fresh = $('days').querySelectorAll('.day')[to];
  if (fresh) fresh.focus();
});

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
/* Persist and redraw, as one word, so a mutation that has to do both cannot
   forget half: without save() the change is on screen and not on disk (plan
   006 fix 1 was that bug, three times over), without render() it is the
   other way round. A navigation-only change still calls render() alone. */
function commit() { save(); render(); }

function render() {
  if (!ready) return;
  try {
    drawApp();
  } catch (e) {
    showRecovery(e, readRaw(), 'draw');
  }
}

/* One rule for both scans below: the heaviest completed weight, and the
   best estimated 1RM among the sets that can honestly carry one — reps
   present and at or under EST_MAX_REPS, where Epley stops drifting. `e` is
   null until a set with reps has been logged. Raw num(r.w), not
   rowWeight(): the badge is judged against the number the row shows, the
   decision the weight badge already made (plans/README.md, third audit
   item 17). */
function noteBest(best, exId, r) {
  if (!r || !r.done) return;
  const w = num(r.w);
  if (isNaN(w)) return;
  if (!(exId in best)) best[exId] = { w: w, e: null };
  else if (w > best[exId].w) best[exId].w = w;
  if (hasReps(r) && num(r.r) <= EST_MAX_REPS) {
    const e = est1RM(w, num(r.r));
    if (best[exId].e == null || e > best[exId].e) best[exId].e = e;
  }
}

/* The best weight ever completed on each exercise, and the best estimated
   1RM alongside it, across every block of the profile — the bar a set has
   to clear to count as a personal record. The session being drawn is
   excluded, or its own sets would beat themselves. */
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
        rows.forEach(r => noteBest(best, exId, r));
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
      rows.forEach(r => noteBest(best, exId, r));
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

/* ---------- the block before this one ----------
   Every block starts at week 1 with nothing of its own behind it, and
   priorWeight only walks this block's own weeks — so the first session of
   every block asked for eight weeks of loads to be retyped from memory.
   targetFor reads across blocks by exercise id now and usually answers on
   week 1 by itself; this stays for the band that names where the numbers
   came from, and for the hint on an exercise the rule cannot price. The log of the
   block this one was copied from is one step back in blockOrder.

   This reads it as a HINT only: a greyed placeholder and a labelled band,
   never a target, never a write. The deload week is skipped — it is ~60 %
   of the working weight by design, and it is usually the last week logged.
   The same lift is matched the way the chart's "Todos los bloques" matches
   it, by id and then by name (liftSlots), so a block that arrived as JSON
   with its own ids still finds the machine by its name. Newest earlier
   block first; within it, the latest week with a ticked set. */
function priorBlockSets(profile, block, ex) {
  const order = profile.blockOrder || [];
  let at = order.indexOf(block.id);
  if (at < 0) at = order.length;
  for (let b = at - 1; b >= 0; b--) {
    const prev = profile.blocks[order[b]];
    if (!prev || !profile.log[prev.id]) continue;
    const slots = liftSlots(prev, ex);
    if (!slots.length) continue;
    for (let w = blockWeeks(prev); w >= 1; w--) {
      /* deloadAt, not `w === deloadWeek(prev)`: the same definition the rule
         uses (exHistory), so the band and the objetivo cannot disagree about
         which week was the deload. A block whose deload was written by hand
         into the phase text used to show its ~60 % weights here while the
         rule correctly ignored them. */
      if (deloadAt(prev, w)) continue;
      for (let i = 0; i < slots.length; i++) {
        const s = profile.log[prev.id][slot(w, slots[i].dayId)];
        const arr = s && s[slots[i].exId];
        if (!Array.isArray(arr)) continue;
        const done = arr.filter(x => x && x.done && x.w !== '' && x.w != null);
        if (done.length) return { block: prev, week: w, dayId: slots[i].dayId, sets: done };
      }
    }
  }
  return null;
}

/* Once per card, not once per set row: the walk above visits every earlier
   block, and buildExCard asks for the hint on every row. Held in
   renderCache like lastTime is. */
function priorBlockSetsCached(profile, block, ex) {
  const key = block.id + '|' + ex.id;
  const c = renderCache && renderCache.priorBlock;
  if (c && key in c) return c[key];
  const v = priorBlockSets(profile, block, ex);
  if (c) c[key] = v;
  return v;
}

/* Everything below is a pure function of (profile, block, week, day) and is
   asked for the same answer several times inside one render — lastTime twice
   per card, liftSlots once per card over every card. Held for the duration of
   one draw and dropped at the start of the next full draw, so nothing can go
   stale: every path that changes the log already ends in render(). A single
   card swapped in between (drawCard) reads what is already here instead of
   rebuilding it — the note above that call says why a tick cannot stale any
   of these maps. */
let renderCache = null;

function resetRenderCache() {
  renderCache = { lastTime: Object.create(null), liftSlots: Object.create(null), slug: Object.create(null),
                  priorBlock: Object.create(null), history: Object.create(null), target: Object.create(null), brake: null };
}

/* Same five arguments, same answer — and the card loop asks for the
   previous-week band once per card while every set row asks again. */
function lastTimeCached(profile, blockId, dayId, exId, beforeWeek) {
  if (!renderCache) return lastTime(profile, blockId, dayId, exId, beforeWeek);
  const k = blockId + '|' + dayId + '|' + exId + '|' + beforeWeek;
  if (!(k in renderCache.lastTime)) {
    renderCache.lastTime[k] = lastTime(profile, blockId, dayId, exId, beforeWeek);
  }
  return renderCache.lastTime[k];
}

/* The target rule walks every block of the profile for one exercise, and
   three callers inside one draw want the same answer: the card's own line,
   the placeholder in every weight box of that card, and — once per day —
   the global brake, which asks the same question of every exercise. Held
   here for exactly as long as lastTime is, and dropped by the same reset.

   The brake is a single value rather than a map because it is a fact about
   the whole day; targetFor still takes it as an argument, so the rule
   itself neither reads the clock nor the other exercises. */
function exHistoryCached(profile, block, ex, dayId, week, onlyBlockId) {
  if (!renderCache) return exHistory(profile, block, ex, dayId, week, onlyBlockId);
  const k = block.id + '|' + ex.id + '|' + (dayId || '') + '|' + week + '|' + (onlyBlockId || '');
  if (!(k in renderCache.history)) renderCache.history[k] = exHistory(profile, block, ex, dayId, week, onlyBlockId);
  return renderCache.history[k];
}

function brakeCached(profile, block, week, now) {
  if (!renderCache) return brakeOn(profile, block, week, now);
  if (renderCache.brake == null) renderCache.brake = brakeOn(profile, block, week, now);
  return renderCache.brake;
}

/* The one entry point the app uses: the brake and the clock filled in, and
   the answer held for the rest of the draw. */
function targetNow(profile, block, day, ex, week) {
  const now = Date.now();
  const dayId = day && day.id;
  if (!renderCache) return targetFor(profile, block, day, ex, week, now, brakeOn(profile, block, week, now));
  const k = block.id + '|' + ex.id + '|' + (dayId || '') + '|' + week;
  if (!(k in renderCache.target)) {
    renderCache.target[k] = targetFor(profile, block, day, ex, week, now, brakeCached(profile, block, week, now));
  }
  return renderCache.target[k];
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
  /* No "Objetivo semana N" label any more: the row that opens this panel
     already says which week it is, and the panel that repeats its own
     trigger is the kind of line that made the header 295px tall. What is
     left is the RIR target and the week's own sentence (plans/034). */
  bannerDiv.innerHTML = '<div class="banner-v"></div><div class="banner-r"></div>';
  bannerDiv.querySelector('.banner-v').textContent = ph.r;
  bannerDiv.querySelector('.banner-r').textContent = ph.t;
  $('banner').appendChild(bannerDiv);

  const day = days[profile.day];
  /* Before anything is drawn from it: pruneLog reads this to know which row
     arrays are the live ones. */
  drawnSlot = { profile: state.activeProfile, block: block.id, key: slot(profile.week, day.id) };
  drawEnergy(profile, block, day);
  drawDeloadCheck(profile, block);
  drawBrakeNote(profile, block);
  drawSessionNote(profile, block, day);
  /* One line until it is asked for. These notes run to two or three lines of
     "who takes which machine first", read once at the start of the session
     and never again, and at the top of the page that was three lines of the
     first screen every time (plans/034). */
  const pairNote = soloMode() ? '' : (day.pair || '');
  const pairBtn = $('pair');
  pairBtn.hidden = !pairNote;
  /* Emptied and closed, not just hidden: the note used to be one textContent
     write, so turning solo mode on cleared it by writing ''. Leaving the
     markup standing behind `hidden` left a JUNTOS badge in a document that
     is supposed to have none — and leaving `open` and aria-expanded on the
     button says a note you walked away from is still showing, of a note
     that is not there at all. */
  if (!pairNote) {
    pairBtn.innerHTML = '';
    pairBtn.classList.remove('open');
    pairBtn.setAttribute('aria-expanded', 'false');
  } else {
    pairBtn.innerHTML =
      '<span class="badge together">JUNTOS</span><span class="pair-text"></span>' +
      '<span class="chev" aria-hidden="true">▾</span>';
    pairBtn.querySelector('.pair-text').textContent = pairNote;
    const openNote = expandedPair.has(pairKey(block, day));
    pairBtn.classList.toggle('open', openNote);
    pairBtn.setAttribute('aria-expanded', openNote ? 'true' : 'false');
  }

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

  /* `bar`, not `prior`: this same function already declares `const prior`
     for the previous block's sets (plans/018), and two consts of one name
     in one scope is the parse failure that leaves every returning phone on
     "Cargando…" (AGENTS.md). "The bar a set has to clear" is the phrase the
     comment above bestByExercise already uses. */
  const bar = best[ex.id];
  const isPr = r => r.done && !isNaN(num(r.w)) && (!bar || num(r.w) > bar.w);
  /* A new best estimated 1RM at a weight already lifted: the rep progress
     double progression is made of, which the weight badge cannot see. Only
     against an existing estimate — the first session of an exercise already
     earns the weight badge, and two badges for one first set would devalue
     both — and never past EST_MAX_REPS, where the estimate stops being one.
     The weight badge wins when both apply. */
  const isPrE = r => !isPr(r) && r.done && !!bar && bar.e != null && hasReps(r) &&
    num(r.r) <= EST_MAX_REPS && !isNaN(num(r.w)) && est1RM(num(r.w), num(r.r)) > bar.e;
  const cardPr = rows.some(isPr);
  const cardPrE = !cardPr && rows.some(isPrE);

  /* Everything the line under the session adds up, recorded here on the way
     past. `rows` is the live array, which is also what lets the tick handler
     below ask whether the whole day just became done. */
  const stat = {
    ex: ex, el: null, rows: rows, n: n,
    done: rows.filter(r => r.done).length, tonnage: 0, pr: cardPr || cardPrE, lastTs: 0,
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
  /* Only when this block has nothing of its own to show for this lift —
     neither this session's earlier weeks nor another day's. The block
     before is older than either, and would only muddy a card that
     already has a history. */
  const prior = (!prev && !other) ? priorBlockSetsCached(profile, block, ex) : null;
  const priorTag = prior
    ? (prior.block.name.length > 14 ? prior.block.name.slice(0, 13).replace(/[\s+/-]+$/, '') + '…' : prior.block.name) + ' · Sem. ' + prior.week
    : '';
  const band = (cls, tag, sets) => '<div class="last' + cls + '"><span class="tag">' + esc(tag) +
    '</span><span><b>' + sets.map(s => esc(setSummary(s))).join('</b> · <b>') + '</b></span></div>';
  const prevTxt =
    (prev ? band('', 'Sem. ' + prev.week, prev.sets) : '') +
    (other ? band(' other', 'Sem. ' + other.week + ' · ' + dayTag(block, other.dayId), other.sets) : '') +
    (prior ? band(' prior', priorTag, prior.sets) : '');

  /* No longer a gate on anything — the decay between sets is measured
     properly by the target rule's own phi[k] now (see targetFor). What it
     still does is name, in one line, the thing that number cannot: that
     the first set of THIS session was probably taken closer to failure
     than the ones after it. */
  const decay = repDecay(rows);
  /* Read off the sessions before this one, so it is the same line all week
     and does not move as you tick sets. */
  const est = targetNow(profile, block, day, ex, profile.week);
  /* `est` is only drawn here. Recording it is the job of the handlers below
     that start the session — see recordTargetOnStart for why a draw must
     never do it. */
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
    (est ? '<div class="ex-est ' + (est.dir || 'flat') + '"><span class="ex-est-l"></span>' +
      '<span class="ex-est-c ' + est.conf + '"></span>' +
      targetNotes(est).map(() => '<span class="ex-est-n"></span>').join('') + '</div>' : '') +
    '<div class="ex-rir"><span class="ex-rir-lbl">RIR último set</span><div class="rir-chips"></div></div>' +
    (parked ? '<div class="ex-parked"></div>' : '');

  if (decay) {
    card.querySelector('.ex-decay').textContent = decayLine(rows);
  }

  if (est) {
    card.querySelector('.ex-est-l').textContent = targetLine(est);
    card.querySelector('.ex-est-c').textContent = TARGET_CONF_LABEL[est.conf];
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
  else if (cardPrE) { const s = document.createElement('span'); s.className = 'badge pr-e1rm'; s.textContent = 'RÉCORD 1RM'; nameEl.appendChild(s); }
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
      commit();
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
    row.className = 'set-row' + (r.done ? ' done' : '') + (isPr(r) ? ' pr' : '') + (isPrE(r) ? ' pr-e1rm' : '');
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
    /* The greyed number in the weight box is the target's own weight for
       THIS set — one rule, one number, and the contract the box has always
       had ("tick without typing takes what it shows") now adopts the
       target rather than a copy of last week. Which is also what makes
       "Copiar pesos" and the line above agree by construction instead of
       by two implementations happening to say the same thing. */
    const tgtRow = est && est.sets[si];
    const ownHint = priorWeight(profile, block.id, profile.week, day.id, ex.id, si);
    /* No earlier week in this block: the previous block's last logged
       session, same set index, last set when the plan has since grown —
       the same fallback priorWeight applies within a block. */
    const priorRow = (!tgtRow && !ownHint && prior) ? (prior.sets[si] || prior.sets[prior.sets.length - 1]) : null;
    const hint = tgtRow ? loadText(tgtRow.w) : (ownHint || (priorRow ? String(priorRow.w) : ''));
    /* The whole parenthetical rather than a noun the line then glues "lo de"
       in front of: "lo de el objetivo" is not Spanish. */
    const hintFrom = tgtRow ? 'lo que pide el objetivo de esta semana'
      : ownHint ? 'lo de la semana anterior'
      : (priorRow ? 'lo de "' + prior.block.name + '", semana ' + prior.week : '');
    wIn.value = r.w; rIn.value = r.r;
    wIn.placeholder = hint || '—';
    rIn.placeholder = '—';
    wIn.setAttribute('aria-label', 'Peso, serie ' + (si + 1) + ' de ' + ex.n);
    rIn.setAttribute('aria-label', 'Repeticiones, serie ' + (si + 1) + ' de ' + ex.n);
    /* `wasSession` is read BEFORE the assignment in every one of these, and
       that order is the whole mechanism: read it after and the row is
       already used, every keystroke looks like a start, and the draw-time
       write is back by another route. */
    wIn.oninput = e => {
      const wasSession = rows.some(rowUsed);
      r.w = e.target.value.replace(/[^0-9.,]/g, ''); if (r.w !== e.target.value) e.target.value = r.w; stampRowUnit(r); save();
      recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);
    };
    rIn.oninput = e => {
      const wasSession = rows.some(rowUsed);
      r.r = e.target.value.replace(/[^0-9]/g, ''); if (r.r !== e.target.value) e.target.value = r.r; save();
      recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);
    };

    const tick = row.querySelector('.tick');
    tick.setAttribute('aria-label', (r.done ? 'Desmarcar' : 'Marcar') + ' serie ' + (si + 1) + ' de ' + ex.n);
    tick.onclick = () => {
      /* Read first, before the adoption below can put a weight in the row:
         after it, every tick would look like the start of a session. */
      const wasSession = rows.some(rowUsed);
      let adopted = '';
      if (!r.done) {
        /* Ticking a set whose weight box is still empty takes the greyed
           number showing in it — last week's weight for this same set. It
           is the common case, but it is also a guess, so it says so. */
        if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; stampRowUnit(r); }
        r.ts = Date.now();
      }
      r.done = !r.done;
      recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);
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
      if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (' + hintFrom + ') — cámbialo si no fue eso');
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
      /* A typed drop weight makes the row used too — rowUsed counts
         dropsOf(r).some(dropUsed) — so a session can start here, and
         `wasSession` is read before the assignment for the same reason. */
      dwIn.oninput = e => {
        const wasSession = rows.some(rowUsed);
        d.w = e.target.value.replace(/[^0-9.,]/g, ''); if (d.w !== e.target.value) e.target.value = d.w; stampRowUnit(r); save();
        recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);
      };
      drIn.oninput = e => {
        const wasSession = rows.some(rowUsed);
        d.r = e.target.value.replace(/[^0-9]/g, ''); if (d.r !== e.target.value) e.target.value = d.r; save();
        recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);
      };

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
    /* The draw's cache is kept, not thrown away. A tick — or a keystroke in a
       weight box — writes exactly one slot: profile.log[activeBlock][slot(
       profile.week, day.id)], and profile.rir/profile.obj under the same key.
       Every map held here is built to exclude that slot: exHistory drops the
       block being trained at `w >= beforeWeek`, lastTime starts its walk at
       `beforeWeek - 1`, priorBlockSets reads strictly earlier blocks, and
       liftSlots and slug are facts about the plan, which a tick does not
       touch. The one thing a tick changes that this card shows is the RÉCORD
       bar, and `best` below is recomputed on every call.

       Resetting here undid what plans/008 item 14 bought: the rebuilt card
       asks targetNow, targetNow asks for the day's brake, and brakeOn asks
       every exercise of every live day for its history — the whole-block,
       whole-log walk, once per tick, growing with the log rather than with
       the plan. Anything that changes which cards exist, which week is shown
       or an earlier week's rows goes through render() → drawApp(), which
       does reset. */
    if (!renderCache) resetRenderCache();
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
    commit();
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
  /* Guarded the same way the storage-actions block is: shown and hidden
     with the attribute index.html ships it with, never with an inline
     style. */
  const prevEl = $('sesNotePrev');
  if (prevEl) {
    const last = lastNote(profile, block.id, day.id, profile.week);
    prevEl.textContent = '';
    if (last) {
      /* Two elements set through textContent, not innerHTML and not a text
         node: the note is user text, and test/unit.js's inert document stub
         has createElement but no createTextNode — drawSessionNote runs on
         every render, including load() in the headless suite. */
      const b = document.createElement('b');
      b.textContent = 'Sem. ' + last.week + ': ';
      const t = document.createElement('span');
      t.textContent = last.text;
      prevEl.appendChild(b);
      prevEl.appendChild(t);
    }
    prevEl.hidden = !last;
  }
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

/* ---------- the global brake, said out loud ----------
   The one line on the screen that overrides every card's own answer, so it
   has to be visible before the cards are read rather than inferred from
   twenty exercises that all quietly declined to move. Read from the same
   cached value targetFor was handed, so the banner and the numbers under
   it can never disagree. */
function drawBrakeNote(profile, block) {
  const el = $('brakeNote');
  if (!brakeCached(profile, block, profile.week, Date.now())) { el.style.display = 'none'; return; }
  el.textContent = 'Esta semana no sube nada: ' + BRAKE_COUNT +
    ' ejercicios han bajado a la vez. Mira sueño, comida o fatiga antes que el plan.';
  el.style.display = 'block';
}

/* ---------- day/data actions ---------- */
function currentDay() {
  const days = dayList(getBlock());
  return days[Math.min(getProfile().day, days.length - 1)];
}

$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  /* One rule, one place — and now the button has no special cases left of
     its own. Week 1 used to be one: the old estimate could only read this
     block's own weeks, so the first session of a block fell back to a
     plain copy of whatever the previous block ended on. The rule below
     reads the history by exercise id across blocks, so week 1 of a new
     block is simply a week with six sessions behind it like any other, and
     what goes in the boxes is the objetivo the card is already showing. */
  let written = 0, up = 0, down = 0, back = 0;
  exList(day).forEach(ex => {
    const t = targetNow(profile, block, day, ex, profile.week);
    if (!t) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week, block));
    /* Before the loop writes a single weight, for the same reason the card
       handlers read it first: this button starts a session with no tick. */
    const wasSession = to.some(rowUsed);
    to.forEach((r, i) => {
      if (r.done) return;
      /* A row past the last set the rule priced — a plan grown since, or a
         deload's half session — takes the last weight rather than nothing:
         an empty box is worse than a number you can see is the previous
         set's. */
      const from = t.sets[i] || t.sets[t.sets.length - 1];
      r.w = loadText(from.w);
      stampRowUnit(r);
    });
    recordTargetOnStart(profile, block, day, ex, to, wasSession, t);
    written++;
    if (t.kind === 'vuelta') back++;
    /* Counted independently, not as a chain: the common shape of a v3
       answer is one set up and one set down in the SAME exercise, and a
       message that names only the first of them reads as a rule that did
       half its job. */
    if (t.sets.some(x => x.move === '↑')) up++;
    if (t.sets.some(x => x.move === '↓')) down++;
  });
  if (!written) { mark('Todavía no hay historial de estos ejercicios: el objetivo empieza con la primera sesión registrada'); return; }
  commit();
  mark('Objetivo escrito en ' + written + (written === 1 ? ' ejercicio' : ' ejercicios') +
    (up ? ' — ' + up + (up === 1 ? ' sube' : ' suben') + ' de peso en alguna serie' : '') +
    (down ? ' — ' + down + (down === 1 ? ' baja' : ' bajan') + ' de peso en alguna serie' : '') +
    (back ? ' — ' + back + (back === 1 ? ' repite' : ' repiten') + ' la última sesión (vuelta de parón)' : '') +
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
  commit();
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
  profile.obj = {};
  commit();
  mark('Registro de ' + profile.label + ' borrado');
};

function setsLabel(n) { return n + (n === 1 ? ' serie registrada' : ' series registradas'); }
/* The plan editor (draftBlock and friends) now lives in js/block-editor.js,
   alongside block CRUD/import — setsLabel stays here since it's used
   file-wide, not just by the editor. */

/* ---------- estimated 1RM ----------
   The chart that made these necessary now lives in js/chart.js, but they
   stayed: the target rule below reads both, and so does js/diagnostics.js
   for its own trend. */
/* Epley: est1RM(w, r) = w × (1 + r/30). Simpler than Brzycki, it's what most
   lifting apps already show, and its error band is well understood. It
   degrades past ~12 reps, which callers are expected to flag rather than
   plot as if it were a reliable number. */
const est1RM = (w, r) => w * (1 + r / 30);

/* A set counts toward the 1RM series only if it has a usable rep count —
   unlike the weight series, which needs nothing but the weight itself. */
const hasReps = r => r.r !== '' && r.r != null && !isNaN(num(r.r)) && num(r.r) > 0;

/* ---------- peso objetivo: una respuesta por serie ----------
   The rule that reads the log and says what to put on the machine. It used
   to price one weight for the whole exercise off the LAST set of LAST week.
   That is one session's worth of evidence spent on a decision the log has
   months of data for, and it froze two shapes of session solid: the one
   that ends every set at the top of the range (nothing to compare, so
   nothing moves) and the one whose first set is plainly stronger than its
   fourth (one weight for both, priced off whichever end the rule happened
   to read).

   Three estimates come out of the history instead, and each answers a
   different question:

     level   what the first set can do today — the best capacity of the
             last three sessions, so one bad night cannot lower it
     phi[k]  what is left by set k — measured as a ratio between sets, so
             it survives a back-off set at another weight
     g       what one more session is worth — Theil-Sen over the last six,
             so one strange point cannot steer it

   Then every set is decided on its own: a set that reached the top of the
   range goes up a rung if the reps still land inside the range at the new
   weight, a set the model cannot get to the bottom of the range comes
   down, and everything else keeps its weight and chases a rep. The reps
   pick the case and the capacity only sizes the step — that part is
   unchanged, and it is what stops a lifter who put 32×15/15/12/12 on a
   10-15 range being told to jump to 35 and restart at 10.

   Almost nothing new is typed for any of it: the weights and reps are in
   the log, the RIR is optional per set with the week's own prescription
   standing in, and the range, the step and the phase text are in the plan.
   Since plans/035 every set carries its own reserve, so each of the three
   estimates is priced on the set it is actually about rather than on one
   number stretched across the session. */

/* Epley's denominator. est1RM() above bakes the same 30 in for the chart;
   here it is named because three different formulas divide by it. */
const EPLEY_A = 30;

/* Above this Epley drifts far enough that the estimate would be inventing
   a number rather than reading one. Still the ceiling the chart and the
   Diagnóstico plot to; the rule below does not refuse past it, it reads
   the set as a MINIMUM instead (see the censoring note). */
const EST_MAX_REPS = 15;

/* ---- censoring ----
   A set that ends at the top of the range, or was recorded at two or more
   reps in reserve, or has nothing recorded at all, or ran past twelve reps,
   is not a measurement of what that set could do — it is a floor under it.
   Read per set since plans/035: it is the set's own reserve that decides,
   so a first set typed at 0 is a reading even when the fourth ended at 3,
   and the "nothing recorded" case is a set the inheritance rule could not
   reach — no later set in the session carried a value either.

   Halperin et al. (2022) found lifters under-estimate the reps they have
   left by nearly one on average, and that the error grows sharply past
   twelve; a set cut off at the top of the range never went near failure in
   the first place. Both biases push the estimate DOWN, which is the safe
   side: a target one rep light costs one slightly easy set, a target one
   rep heavy costs the session.

   So a censored set may only ever RAISE the level, never lower it, and the
   set that has to guess how much is in reserve gets one rep of slack when it
   decides whether the next rung fits. */
const CENSOR_REPS = 12;

/* The level is the best of the last three sessions: a single bad day is not
   allowed to move it, three sessions renew it completely. */
const LEVEL_SESSIONS = 3;
/* The window for both the trend and the between-set decay — roughly a block.
   Long enough that one night does not set the verdict, short enough that a
   plateau broken two months ago is not still being counted. */
const TREND_SESSIONS = 6;
/* Two points are not a trend, they are a line through two points. */
const TREND_MIN_POINTS = 3;
/* Per session, as a fraction of capacity. Above this the "trend" is the
   learning curve of a new movement, and extrapolating it prescribes a
   weight nobody can lift in three weeks' time. */
const MAX_SLOPE = 0.03;
/* The first sessions on a new variant, where the jump is skill and not
   strength — so the trend is not read at all and the ordinary +1 rep
   stands in. */
const LEARNING_SESSIONS = 3;
/* Longer than the gap a normal week leaves, so an ordinary Monday-to-Monday
   never reads as a layoff. Räntilä et al. (2021): no group lost maximal
   strength in the first three weeks off, which is why coming back repeats
   the last session rather than discounting it. */
const GAP_DAYS = 10;
/* How far under the best of the three sessions before it a session has to
   fall to count as a real decline rather than a bad day. */
const DECLINE_DROP = 0.05;
/* Declines at once that stop the whole day going up, and the window they
   have to fall inside. Three exercises down in the same week is a fact
   about sleep, food or fatigue, not about the plan. */
const BRAKE_COUNT = 3, BRAKE_DAYS = 7;
/* What one set costs the next when there is nothing to measure it on, and
   the floor under a measured one — below this the "decay" is a mis-typed
   row or a set done at a weight the rule could not see. */
const PSI_PRIOR = 0.97, PSI_MIN = 0.8;
/* Two loads a hair apart are the same load, and repsAt() lands exactly on
   an integer often enough (63/47,25 is 9 reps, not 8,999…) that the floor
   below it has to be nudged off the boundary. */
const WEIGHT_EPS = 1e-6;
const DAY_MS = 86400000;

/* A set's reserve as the reps it stands for, with nothing recorded read as
   zero — and a set with nothing recorded is censored anyway (see above), so
   reading it as "went to failure" can only make the estimate lower, never
   higher. Takes a number, a legacy chip or null, because a session logged
   before plans/035 arrives as a chip. */
const rhoOf = raw => { const v = rirNumber(raw); return v == null ? 0 : v; };

/* Epley with the reserve added back in: what the set would have been worth
   taken to failure. */
const capOf = (w, r, rho) => w * (1 + (r + rho) / EPLEY_A);

/* The other direction — how many reps a capacity is good for at a given
   weight, leaving this week's prescribed reserve in the tank. Floored,
   because a target is a number you have to be able to hit. */
const repsAt = (w, cap, rirWeek) => Math.floor(EPLEY_A * (cap / w - 1) - rirWeek + WEIGHT_EPS);

const sameLoad = (a, b) => Math.abs(a - b) < WEIGHT_EPS;
const round2 = v => Math.round(v * 100) / 100;
/* A weight written the way it is typed and read on the card: two decimals
   at most, no trailing zeros, Spanish comma. */
const loadText = v => String(round2(v)).replace('.', ',');

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* Theil-Sen: the median of the slopes between every pair of points. A
   least-squares line through six sessions is steered by whichever one went
   worst; the median of the pairwise slopes is not, which matters because
   the one bad session is exactly the point a training log always has. */
function theilSen(pts) {
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j][0] !== pts[i][0]) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    }
  }
  return slopes.length ? median(slopes) : 0;
}

/* A deload is ~60 % of the working weight by design, so its sessions are
   evidence about nothing and are kept out of every window below. The
   block's own `deload` field is the answer whenever there is one; the text
   is read too, because a hand-written phase can say "Descarga" on a week
   the field never heard about, and halving the sets on a week that says
   "Descarga" is what the week asks for either way. */
function deloadAt(block, w) {
  if (w === deloadWeek(block)) return true;
  return /descarga/i.test(String((block && block.phase && block.phase[w] && block.phase[w].r) || ''));
}

/* The RIR the plan asks for, never under what the exercise itself says is
   its floor: `ex.minRir` is for the lifts nobody takes to failure — a
   squat, a Romanian deadlift — where a week prescribing 0-1 RIR is a
   number you are not going to follow, and an estimate built on it is a
   weight you cannot make. A phase with no number at all (somebody's own
   words) falls back to the reserve the last session was left at, which
   asks for no change rather than inventing one. */
function weekRir(block, ex, w, lastRho) {
  let v = phaseRir(block, w);
  if (v == null) v = lastRho == null ? 0 : lastRho;
  const floor = num(ex && ex.minRir);
  return floor > 0 ? Math.max(v, floor) : v;
}

/* ---- one session, as the rule reads it ----
   Only working sets: ticked, with a weight and a rep count. rowWeight()
   rather than num(r.w), because this window spans months and a profile
   that switched kg↔lb mid-block would otherwise have two scales in one
   average — the same reason js/diagnostics.js converts and the old
   single-session estimate did not have to.

   The date is the MEDIAN of the row timestamps, not the first or the last:
   a set ticked days later from memory moves a mean and does not move a
   median. */
function exSession(profile, blockId, week, dayId, exId, lo, hi) {
  const bucket = profile.log[blockId] && profile.log[blockId][slot(week, dayId)];
  const rows = bucket && bucket[exId];
  if (!Array.isArray(rows)) return null;
  const work = rows.filter(r => r && r.done && rowWeight(r) > 0 && num(r.r) > 0);
  if (!work.length) return null;
  /* One reserve per set since plans/035. `raw` is the exercise-level
     reading — the last working set that carries a value, or the legacy map
     for a session logged before the rows carried one — and it is passed in
     as sessionRirs' fallback so that a session with nothing on its rows is
     read exactly as the one chip always read it: the chip on the last set,
     inherited backwards over all of them. */
  const raw = getRir(profile, blockId, week, dayId, exId) || null;
  const rirs = sessionRirs(work, rirNumber(raw));
  const stamps = work.map(r => +r.ts).filter(t => t > 0);
  const lastRho = rhoOf(rirs.length ? rirs[rirs.length - 1] : null);
  return {
    blockId: blockId, week: week, dayId: dayId,
    /* The session's own `rir`/`rho` are the LAST working set's — what
       rhoLast, the chip's label and the Diagnóstico all mean by "the
       session's RIR". Every set carries its own below. */
    rir: rirs.length && rirs[rirs.length - 1] != null ? String(rirs[rirs.length - 1]) : null,
    rho: lastRho,
    ts: stamps.length ? median(stamps) : 0,
    sets: work.map((r, k) => {
      const w = rowWeight(r), n = num(r.r);
      const rk = rirs[k];
      /* `conv` marks a row that was logged in the other unit, so loadLadder
         can leave it out: the capacity it proves is real, but the number it
         converts to was never a pin on this stack. Nothing else reads it —
         a reader that wants "the weight as logged" should read
         rowWeight(r, rowUnit(r)) at the row, not un-convert this one. */
      return { w: w, r: n, e: capOf(w, n, rhoOf(rk)), conv: rowUnit(r) !== units(),
               rir: rk, rho: rhoOf(rk),
               cens: n >= hi || n > CENSOR_REPS || rk == null || rk >= 2 };
    }),
  };
}

/* ---- the variant an exercise is on ----
   Renaming an exercise in the plan editor usually means a different
   machine or a different groove — "Elevaciones laterales en polea" became
   "Elevaciones en Y en polea cruzada" and the loads are not comparable.
   `profile.variants[exId]` records the names with the date each started;
   everything logged before the current one began is a different lift and
   is left out. A session with no timestamp at all is kept: it cannot be
   placed either side of the change, and dropping history the app is merely
   unsure about is the more expensive mistake. */
const VARIANT_SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;
/* One entry per rename. Capped because it is written from an edit nobody
   rate-limits and read only at its tail: a plan somebody renames forty
   times has forty rows of history nothing will ever ask for. */
const VARIANT_LIMIT = 12;
const isoDay = ts => new Date(ts).toISOString().slice(0, 10);

function variantSince(profile, exId) {
  const list = profile && profile.variants && profile.variants[exId];
  if (!Array.isArray(list) || !list.length) return 0;
  const last = list[list.length - 1];
  const t = last && last.since ? Date.parse(String(last.since) + 'T00:00:00Z') : NaN;
  return isFinite(t) ? t : 0;
}

/* ---- one-off: the lateral raises ----
   The three lateral-raise slots (`lat1`/`lat2`/`lat3` in the shipped plan)
   were renamed from "Elevaciones laterales en polea" to "Elevaciones en Y
   en polea cruzada" before there was anything to record a rename with, so
   the pair of names is seeded here for any profile still carrying it.

   The DATE is the oldest session the exercise has, not the day of the
   rename: that day is in nobody's data — the log keeps weights and reps,
   never the name they were done under — and a guess at it would silently
   throw away every session before the guess, which on a lift trained three
   days a week is most of a block. So this records the names and cuts
   nothing. Every rename from v3 on gets a real date from recordVariant. */
const LEGACY_LAT_IDS = ['lat1', 'lat2', 'lat3'];
const LEGACY_LAT_NAME = 'Elevaciones laterales en polea';
function seedLateralVariants(profile) {
  LEGACY_LAT_IDS.forEach(exId => {
    if (profile.variants[exId]) return;
    let now = '';
    Object.keys(profile.blocks).forEach(bk => {
      ((profile.blocks[bk] || {}).days || []).forEach(d => (d.ex || []).forEach(e => {
        if (e && e.id === exId && e.n) now = e.n;
      }));
    });
    if (!now || slugify(now).indexOf('elevaciones-en-y') !== 0) return;
    let first = 0;
    Object.keys(profile.log).forEach(bk => {
      forEachSlot(profile.log, bk, (k, w, dayId, sl) => {
        const rows = sl && sl[exId];
        if (!Array.isArray(rows)) return;
        rows.forEach(r => { const t = r && +r.ts; if (t > 0 && (!first || t < first)) first = t; });
      });
    });
    profile.variants[exId] = [
      { n: LEGACY_LAT_NAME, since: '1970-01-01' },
      { n: now, since: isoDay(first || Date.now()) },
    ];
  });
}

/* Called when a plan edit is saved: an exercise whose NAME changed is
   treated as a different lift from today on, and the loads before the
   change stop feeding its target. Deliberately the name and not the id —
   the id is the app's own handle and never changes under an edit, while
   the name is the one thing a person edits when they mean "this is a
   different machine now". A first record is written for the name it had
   before, so the cut is a date and not a guess.

   This is also why `variants` is written at all rather than derived: the
   log keeps no copy of the name a session was done under, so once the
   plan is saved the old name is gone and the date with it.

   Compared as slugs, not as text: a rename is the only evidence the lift
   changed, and fixing a capital, an accent or a bracket is not a rename —
   it used to cut months of history for "Pajaros" → "Pájaros". slugify
   strips exactly those and nothing a person would call a different name.
   Returns whether a rename was recorded, so the save handler can tell the
   user their objetivo history just started over. */
function recordVariant(profile, exId, oldName, newName, ts) {
  const from = txt(oldName, IMPORT_LIMITS.exName) || '';
  const to = txt(newName, IMPORT_LIMITS.exName) || '';
  if (!to || slugify(from) === slugify(to)) return false;
  const id = safeKey(exId);
  if (!id) return false;
  if (!profile.variants) profile.variants = {};
  const list = profile.variants[id] || (profile.variants[id] = []);
  /* The variant that was running until today, dated only if this is the
     first rename we ever saw — after that its own `since` is already on
     file. Without it the cut would be "since the rename", with everything
     before it kept, which is the opposite of what a rename means. */
  if (!list.length && from) list.push({ n: from, since: '1970-01-01' });
  list.push({ n: to, since: isoDay(ts || Date.now()) });
  profile.variants[id] = list.slice(-VARIANT_LIMIT);
  return true;
}

/* The record is written by the handlers that can turn an empty session into
   a started one — the tick, the weight and rep boxes, the drop boxes, and
   "Rellenar con el objetivo" — and by nothing else. It used to be written
   by the draw, for whatever week was on screen, as soon as that week had a
   row in it: every week logged before v3 got a rebuilt target the first
   time anyone scrolled past it, stamped with today's clock, so a week from
   two months ago was filed as a "vuelta de parón". `wasSession` is whether
   the exercise's rows already counted as a session when the handler began;
   only the transition from "not yet" to "yes" records, so browsing writes
   nothing and a session that already has its record keeps it. */
function recordTargetOnStart(profile, block, day, ex, rows, wasSession, est) {
  if (wasSession || !est || !rows.some(rowUsed)) return false;
  if (!recordTarget(profile, block.id, profile.week, day.id, ex.id, est)) return false;
  save();
  return true;
}

/* The target as it was on the screen, kept once the session has actually
   started. Written once per session and never rewritten: the point of the
   record is what was ASKED for, so a weight that came down mid-session has
   something to be compared against — the rule's own back-off, or a set the
   lifter had to strip. Rebuilding it later would only ever reproduce the
   rule, which is the one thing it must not do.
   `kind`, `hold` and `brake` are kept with it because a descarga or a
   vuelta de parón is not a prescription the rule can be wrong about — it is
   the rule deliberately asking for less — and a record that cannot say
   which of the three it was turns every deload week into evidence the rule
   overshot.

   `rir` is the week's RIR the reps were solved for (rirWeek, a number or
   null). Now that every set records its own reserve, asked-versus-done is
   the only way the record can say whether the rule was right: without the
   number it asked for, a set that missed its reps at 0 RIR and one that
   stopped at 3 are the same row. */
function recordTarget(profile, blockId, week, dayId, exId, t) {
  const k = slot(week, dayId);
  const blk = profile.obj[blockId] || (profile.obj[blockId] = Object.create(null));
  const sl = blk[k] || (blk[k] = Object.create(null));
  if (sl[exId]) return false;
  sl[exId] = { v: 3, at: Date.now(), conf: t.conf, kind: t.kind,
               hold: !!t.hold, brake: !!t.brake, rir: t.rirWeek == null ? null : t.rirWeek,
               sets: t.sets.map(x => ({ w: x.w, r: x.r, m: x.move })) };
  return true;
}

/* ---- every session of one exercise, oldest first ----
   Joined by exercise id and across blocks, which is what makes a rule built
   on six sessions work at all in week 1 of a new block. By id and not by
   name on purpose: two rows that read the same on two different days can be
   two different lifts (the unilateral pec deck on Monday, the bilateral one
   on Thursday), and the plan is what says whether they are the same — a
   block written as JSON gives both the same id when they are.

   Chronology is blockOrder, then week, then the day's position in the
   block: the log records no clock of its own for a session that was never
   ticked, and the plan's own order is the only other thing that knows
   which came first. */
function exHistory(profile, block, ex, dayId, beforeWeek, onlyBlockId) {
  const lo = repRangeBottom(ex.reps), hi = repRangeTop(ex.reps);
  const order = profile.blockOrder || [];
  const at = order.indexOf(block.id);
  const all = at >= 0 ? order.slice(0, at + 1) : order.concat([block.id]);
  /* `onlyBlockId` is for the Diagnóstico's own "este bloque" scope, which
     asks the same question of a narrower window. The rule itself never
     passes it: a block boundary is a fact about the calendar, not about
     the lifter, and starting every block from no history is what made
     week 1 ask for eight weeks of loads from memory. */
  const ids = onlyBlockId ? all.filter(id => id === onlyBlockId) : all;
  /* A plan may put one lift on two days of the same week, and those two
     slots are not interchangeable: the same machine pressed first on
     Monday and fourth on Thursday, after everything before it, is not the
     same set. Folding them would prescribe a weight set on the fresher day
     and then read the fatigued one as a decline. So inside the block being
     trained the day is part of the key whenever the plan actually splits
     the lift; everywhere else it is not, because an earlier block's days
     were renumbered by whoever wrote it and matching on them would throw
     away the history rather than separate it. */
  let splitDays = 0;
  (block.days || []).forEach(d => { if ((d.ex || []).some(e => e && e.id === ex.id)) splitDays++; });
  const ownDay = splitDays > 1 ? dayId : null;
  const out = [];
  ids.forEach((bId, bi) => {
    const bk = profile.blocks[bId];
    if (!bk || !profile.log[bId]) return;
    const dayIdx = {};
    (bk.days || []).forEach((d, i) => { dayIdx[d.id] = i; });
    forEachSlot(profile.log, bId, (k, w, dayId2, s) => {
      if (!s || !Array.isArray(s[ex.id])) return;
      if (bId === block.id && w >= beforeWeek) return;
      if (bId === block.id && ownDay && dayId2 !== ownDay) return;
      if (deloadAt(bk, w)) return;
      const sess = exSession(profile, bId, w, dayId2, ex.id, lo, hi);
      if (!sess) return;
      sess.ord = [bi, w, dayIdx[dayId2] == null ? 99 : dayIdx[dayId2]];
      out.push(sess);
    });
  });
  out.sort((x, y) => x.ord[0] - y.ord[0] || x.ord[1] - y.ord[1] || x.ord[2] - y.ord[2]);
  const since = variantSince(profile, ex.id);
  return since ? out.filter(s => !s.ts || s.ts >= since) : out;
}

/* ---- the rungs this machine actually has ----
   `ex.inc` says what one step is worth, but a plate stack is not a ruler:
   the lateral raise goes 18 → 19 and the pec deck goes 39 → 45 → 52. The
   weights already logged against this exercise ARE the stack, so the next
   rung up is the lowest of them within one and a half steps, and only when
   there is none does the step itself have to invent one. That is what
   keeps a 2,5 kg default from proposing 20,5 on a machine whose next pin
   is 23, and what lets a micro-plate of 1 kg be a real rung.

   A row logged in the other unit (`conv`) is converted for the capacity it
   proves, but the number it converts to was never a pin on this stack: a kg
   profile with one lb block behind it got a rung at 45,359237, the card read
   "objetivo: 45,36×10", and the tick wrote that placeholder into the log,
   where it became a genuine rung from then on. Those rows are left out of
   the ladder only — everything else still reads them. If every session is
   converted (a permanent unit switch) the ladder is empty and nextLoad /
   prevLoad fall back to `w ± inc`, which is the documented fallback. */
function loadLadder(sessions) {
  const seen = [];
  sessions.forEach(s => s.sets.forEach(x => { if (!x.conv && !seen.some(v => sameLoad(v, x.w))) seen.push(x.w); }));
  return seen.sort((a, b) => a - b);
}
function nextLoad(ladder, w, inc) {
  const up = ladder.filter(v => v > w + WEIGHT_EPS && v <= w + 1.5 * inc + WEIGHT_EPS);
  return up.length ? up[0] : w + inc;
}
function prevLoad(ladder, w, inc) {
  const dn = ladder.filter(v => v < w - WEIGHT_EPS && v >= w - 1.5 * inc - WEIGHT_EPS);
  return dn.length ? dn[dn.length - 1] : w - inc;
}

/* ---- the level, and what counts as losing it ----
   A capacity sequence is one number per session: what the FIRST set was
   worth, because it is the only set done fresh and therefore the only one
   comparable across sessions of different lengths.

   A decline is a session at least DECLINE_DROP under the best of the three
   before it, read off a set that was not censored — a session that ended at
   the top of the range is a floor, and a floor cannot say you got weaker.

   `sets[0].cens` is the FIRST set's own state since plans/035, not the
   whole session's: a 0 or 1 typed on the first set makes it a reading and
   the level can move on it, a 2 or more (or nothing typed) keeps it a
   floor. That is what typing the first set's RIR buys, and `conf` in
   targetFor — the count of un-censored first sets over the last six
   sessions — is where the lifter sees it: the confidence chip climbs from
   "baja" to "alta" on the one set per session that matters most.
   One of those stops the weights going up for a day (a set the range says
   is out of reach still comes down). Two in a row is the level itself
   moving, which is the only thing that lowers it. */
function capSeq(sessions) {
  return sessions.map(s => ({ C: s.sets[0].e, cens: s.sets[0].cens }));
}
function declineAt(seq, i) {
  if (i <= 0 || !seq[i] || seq[i].cens) return false;
  const before = seq.slice(Math.max(0, i - 3), i).map(x => x.C);
  if (!before.length) return false;
  return seq[i].C < Math.max.apply(null, before) * (1 - DECLINE_DROP);
}
function levelOf(seq) {
  if (!seq.length) return { level: 0, cens: true, hold: false, confirmed: false };
  const top = seq.slice(-LEVEL_SESSIONS).reduce((best, x) => (x.C > best.C ? x : best));
  const out = { level: top.C, cens: top.cens, hold: false, confirmed: false };
  const li = seq.length - 1;
  if (declineAt(seq, li)) {
    if (declineAt(seq, li - 1)) { out.level = seq[li].C; out.cens = seq[li].cens; out.confirmed = true; }
    else out.hold = true;
  }
  return out;
}

/* ---- the whole rule ----
   `now` and `brake` are arguments and not reads, so this stays a pure
   function of (profile, block, ex, week): the brake is a fact about the
   WHOLE day and is worked out once when the day is drawn, and the clock is
   the one input a rule about layoffs cannot avoid. */
function targetFor(profile, block, day, ex, week, now, brake) {
  const lo = repRangeBottom(ex.reps), hi = repRangeTop(ex.reps);
  if (!(lo > 0) || !(hi > 0) || hi < lo) return null;
  const sessions = exHistoryCached(profile, block, ex, day && day.id, week);
  if (!sessions.length) return null;

  const last = sessions[sessions.length - 1];
  const inc = incFor(ex);
  const n = setsFor(ex, week, block);
  const ladder = loadLadder(sessions);
  const notes = [];
  /* How many of the last six sessions read the first set rather than only
     bounding it. Nothing downstream changes with it — it is what the
     lifter needs in order to know how hard to argue with the number. */
  const clear = sessions.slice(-TREND_SESSIONS).filter(s => !s.sets[0].cens).length;
  const conf = clear <= 1 ? 'baja' : clear <= 3 ? 'media' : 'alta';
  const t = { kind: 'objetivo', sets: [], conf: conf, notes: notes, dir: '',
              from: last.sets[0].w, week: last.week, sessions: sessions.length };

  /* A deload prescribes half the sets at the bottom of the range and about
     60 % of the load — and 60 % of a stack is usually not a number the
     stack has, so it is the first rung at or under it, walked down the same
     ladder everything else moves on. */
  if (deloadAt(block, week)) {
    let w = last.sets[0].w;
    const floor = w * 0.6;
    for (let i = 0; i < 60 && w > floor + WEIGHT_EPS; i++) {
      const down = prevLoad(ladder, w, inc);
      if (!(down > 0)) break;
      w = down;
    }
    t.kind = 'descarga';
    t.dir = 'down';
    for (let k = 0; k < n; k++) t.sets.push({ w: round2(w), r: lo, move: '' });
    return t;
  }

  /* Back from a layoff: repeat the last session exactly. Three weeks off
     does not cost a trained lifter maximal strength (Räntilä 2021), and
     discounting it prescribes a week of work already owned — but neither
     is it the week to add anything, so nothing moves and the set the plan
     has gained since carries the last set's weight at the bottom of the
     range. */
  if (now && last.ts && now - last.ts > GAP_DAYS * DAY_MS) {
    t.kind = 'vuelta';
    notes.push('vuelta');
    for (let k = 0; k < n; k++) {
      const L = last.sets[k];
      t.sets.push(L ? { w: round2(L.w), r: L.r, move: '' }
                    : { w: round2(last.sets[last.sets.length - 1].w), r: lo, move: '' });
    }
    return t;
  }

  /* The segment is the run of sessions since the last layoff. The level is
     rebuilt inside it — coming back at 90 % and being measured against the
     best week of two months ago prices every set as a failure — while the
     between-set decay below deliberately is NOT cut, because how much a
     fourth set gives away is a property of the exercise and not of the
     month. */
  let start = 0;
  for (let i = 1; i < sessions.length; i++) {
    const a = sessions[i - 1].ts, b = sessions[i].ts;
    if (a && b && b - a > GAP_DAYS * DAY_MS) start = i;
  }
  const seq = capSeq(sessions.slice(start));
  const lv = levelOf(seq);
  const level = lv.level, levelCens = lv.cens, hold = lv.hold;
  const r1Last = last.sets[0].r, rhoLast = last.rho;
  const rirWeek = weekRir(block, ex, week, rhoLast);

  /* What the next session is expected to be worth, as a fraction of
     capacity — and only for the sets that keep their weight, because going
     up a rung IS the progression and adding a rep on top of it is asking
     for both at once. The floor is always one more rep on the first set:
     a flat trend still gets asked for a rep, and whether that ask keeps
     failing is the Diagnóstico's question, not this one's.

     It is the FIRST set's rep-equivalent, so it is priced at the first
     set's own reserve (plans/035). The last set's used to stand in here
     only because one chip was all there was; on a session run 3 → 2 → 1 → 0
     those are different numbers, and the one this term is about is the one
     the first set was done at. */
  const oneRep = 1 / (EPLEY_A + r1Last + last.sets[0].rho);
  let g;
  if (hold || brake) g = 0;
  else if (sessions.length <= LEARNING_SESSIONS) g = oneRep;
  else {
    const pts = seq.slice(-TREND_SESSIONS)
      .map((s, i) => [i, s]).filter(p => !p[1].cens).map(p => [p[0], p[1].C]);
    g = pts.length >= TREND_MIN_POINTS
      ? Math.max(oneRep, Math.min(theilSen(pts) / level, MAX_SLOPE))
      : oneRep;
  }

  /* ---- what is left by set k ----
     Measured between CONSECUTIVE sets and in capacity rather than in reps,
     which is what lets a back-off set at another weight count: 45×9
     following 45×12 and 42,75×9 following 45×12 say the same thing about
     fatigue, and only the ratio of the two capacities knows it. A censored
     set says nothing about the drop INTO it (it is a floor, and the drop
     could be anything above it) but it does bound the drop OUT of it from
     above — the true capacity it came from was at least that high, so the
     true ratio is at most this one.

     No code here changed for plans/035 and the reading did: every `e` is
     now priced at the reserve its own set was done at. A session run
     3 → 2 → 1 → 0 RIR down four sets — what a well-paced session looks like
     — used to be read at one reserve throughout, so the reps coming down
     were the only thing in the ratio and it reported something like a 15 %
     loss of capacity by set four. Priced per set, the reserve coming down
     pays for most of that drop and what is left is the fatigue that was
     actually there. `upper[k]` follows the same way: a censored set bounds
     the drop out of itself because THAT set is a floor, not because the
     whole session was.

     This is also what prices the set `ex.add` brings in mid-block, which
     has never been done at all. */
  const obs = {}, upper = {}, allObs = [];
  sessions.slice(-TREND_SESSIONS).forEach(s => {
    for (let k = 1; k < s.sets.length; k++) {
      const a = s.sets[k - 1], b = s.sets[k];
      if (b.cens) continue;
      const ratio = b.e / a.e;
      if (a.cens) (upper[k] = upper[k] || []).push(ratio);
      else { (obs[k] = obs[k] || []).push(ratio); allObs.push(ratio); }
    }
  });
  const phi = [1];
  for (let k = 1; k < n; k++) {
    let psi = obs[k] ? median(obs[k]) : allObs.length ? median(allObs) : PSI_PRIOR;
    if (upper[k]) psi = Math.min.apply(null, [psi].concat(upper[k]));
    phi.push(phi[k - 1] * Math.min(1, Math.max(PSI_MIN, psi)));
  }

  /* ---- one decision per set ----
     `base` is the better of two claims about this set: what it has actually
     done (its own capacity last time) and what the level says it should be
     good for. Taking the maximum is what keeps a pessimistic decay profile
     — the kind a calibration week full of back-offs leaves behind — from
     prescribing less than the set has already proved it can do.

     A set never goes heavier than the set before it. That is not a
     refinement, it is the difference between a prescription and a list of
     numbers: sets get harder down a session, never easier. */
  let prevW = Infinity;
  for (let k = 0; k < n; k++) {
    const L = last.sets[k];
    const own = L ? L.e : -1, model = level * phi[k];
    const base = Math.max(own, model);
    /* One rep of slack when the number underneath is a floor rather than a
       reading. Without it a set that always ends at the top of its range
       can never go up — the estimate it is judged on is the very number
       being under-read — which is the freeze the old RIR-0 veto produced
       by a different route. */
    const baseCens = L && own >= model ? L.cens : levelCens;
    const slack = baseCens ? 1 : 0;
    let W = null, r, move = '';

    if (L && L.r >= hi && !hold && !brake) {
      const up = nextLoad(ladder, L.w, inc);
      const rp = repsAt(up, base, rirWeek);
      if (rp >= lo - slack && up <= prevW + WEIGHT_EPS) {
        W = up;
        /* The bottom HALF of the range after a step up, never the top of
           what the estimate allows: a jump priced off an optimistic
           reading would otherwise earn the next jump on the same reading,
           and two weeks later the weight is somewhere nobody lifted. */
        r = Math.max(lo, Math.min(rp, lo + Math.floor((hi - lo) / 2)));
        move = '↑';
      } else if (k === 0 && rp < lo - slack) { notes.push('step'); t.step = round2(up); }
    }
    if (W === null) {
      W = Math.min(L ? L.w : last.sets[last.sets.length - 1].w, prevW);
      r = repsAt(W, base * (1 + g), rirWeek);
      /* At the same weight the target never asks for less than was already
         done, minus only what a stricter RIR this week honestly costs.
         Anything else is the model contradicting the log.

         The discount is priced on THIS set's own reserve (plans/035): a set
         done at 3 RIR and asked for 2 this week gives up nothing, whatever
         the last set of that session was done at. */
      if (L && sameLoad(W, L.w)) r = Math.max(r, L.r - Math.max(0, rirWeek - L.rho));
      r = Math.min(r, hi);
      /* Coming down needs the model AND that floor to agree the bottom of
         the range is out of reach — three rungs at most, because past that
         something other than the weight is wrong. */
      for (let s = 0; r < lo && s < 3; s++) {
        const down = prevLoad(ladder, W, inc);
        if (!(down > 0)) break;
        W = down;
        r = Math.min(hi, repsAt(W, base * (1 + g), rirWeek));
        move = '↓';
      }
      /* Still under the range after the walk gave up: the reps printed are
         honest — they are what the model says that weight is worth — but
         under a header that reads "3 × 10–15" they look like a rule that
         cannot count. The mirror case, a step UP that does not fit, has
         said so since v3 ('step'); this is the same courtesy coming down.
         At most once per target: the note names the situation, not the set. */
      if (r < lo && notes.indexOf('floor') < 0) notes.push('floor');
    }
    prevW = W;
    t.sets.push({ w: round2(W), r: Math.max(1, r), move: move });
  }

  if (hold) notes.push('hold');
  if (lv.confirmed) notes.push('confirmed');
  if (rirWeek > rhoLast) notes.push('moreRir');
  t.dir = t.sets.some(s => s.move === '↑') ? 'up' : t.sets.some(s => s.move === '↓') ? 'down' : '';
  t.level = level; t.hold = hold; t.confirmed = lv.confirmed; t.brake = !!brake;
  t.rirWeek = rirWeek; t.g = g; t.phi = phi;
  return t;
}

/* ---- the global brake ----
   Three exercises whose latest session is a real decline, inside a week, is
   not three programming problems. Nothing goes up that day and every
   exercise's expected gain drops to zero, which is the cheapest possible
   way to be wrong about it: one week of repeating a session you can
   certainly do. Worked out once when the day is drawn and handed to
   targetFor, so the rule itself never reads the clock or the other
   exercises. */
function brakeOn(profile, block, week, now) {
  let down = 0;
  const seen = Object.create(null);
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      if (seen[ex.id]) return;
      seen[ex.id] = 1;
      const sessions = exHistoryCached(profile, block, ex, day.id, week);
      if (sessions.length < 2) return;
      const lastTs = sessions[sessions.length - 1].ts;
      if (!lastTs || !now || now - lastTs > BRAKE_DAYS * DAY_MS) return;
      const seq = capSeq(sessions);
      if (declineAt(seq, seq.length - 1)) down++;
    });
  });
  return down >= BRAKE_COUNT;
}

/* Deliberately the same voice and the same slot as the rep-decay warning:
   a line under the sets that you read, not a control you operate. The
   greyed placeholder in each weight box now shows this rule's own weight
   for that set — same contract as before ("tick without typing takes that
   number"), a better number inside it. */
function targetLine(t) {
  const head = t.dir === 'up' ? '↗' : t.dir === 'down' ? '↘' : '→';
  const what = t.kind === 'descarga' ? ' descarga: ' : ' objetivo: ';
  return head + what + t.sets.map(s => loadText(s.w) + '×' + s.r).join(' · ');
}

/* The lines under it, in the order they matter. Every one exists because
   the numbers above would otherwise be read as something they are not, and
   more than one can be true of the same session. */
function targetNotes(t) {
  if (!t) return [];
  const u = ' ' + units();
  const txts = {
    vuelta: 'Vuelta de parón: repite la última sesión.',
    hold: 'La última sesión bajó: hoy no sube la carga. Si vuelve a bajar, el nivel se ajusta.',
    confirmed: 'Dos sesiones seguidas por debajo: el objetivo baja contigo.',
    step: 'El siguiente escalón (' + loadText(t.step) + u + ') no cabe en el rango: micro-carga, medio escalón o más tempo.',
    floor: 'Ni tres escalones abajo entran las reps del rango: el peso sigue alto — baja más de lo que propone la línea, o revisa el rango.',
    moreRir: 'Esta semana pide más RIR: las reps pueden bajar y no es retroceso.',
  };
  return ['vuelta', 'hold', 'confirmed', 'step', 'floor', 'moreRir']
    .filter(k => t.notes.indexOf(k) >= 0).map(k => txts[k]);
}

const TARGET_CONF_LABEL = { baja: 'confianza baja', media: 'confianza media', alta: 'confianza alta' };
/* The same two vocabularies as lists, for the import validator. A plain
   object literal answers truthily to every name it inherits from
   Object.prototype, so 'constructor' would have passed a lookup on
   TARGET_CONF_LABEL; a membership test is what RIR_OPTIONS and
   ENERGY_OPTIONS already use for exactly that reason. */
const TARGET_CONF_OPTIONS = ['baja', 'media', 'alta'];
const TARGET_KIND_OPTIONS = ['objetivo', 'descarga', 'vuelta'];

/* The progress chart lives in js/chart.js. */

/* The bar, the plate set and the machine-stack increment a profile starts
   with. Read by migrate() and by Ajustes, and by the warm-up calculator in
   js/calculator.js — which is why they are declared here, in the file that
   is always on the page, rather than travelling with the calculator. */
const DEFAULT_BAR_WEIGHT = { kg: 20, lb: 45 };
const DEFAULT_PLATES = { kg: [1.25, 2.5, 5, 10, 15, 20], lb: [2.5, 5, 10, 25, 35, 45] };
const DEFAULT_STACK_INC = { kg: 5, lb: 10 };

/* The calculator rounds a warm-up step with it. The target rule does not:
   it moves along the rungs this exercise has actually been logged at (see
   loadLadder), because a plate stack is not a ruler. */
const roundToStep = (v, step) => step > 0 ? Math.round(v / step) * step : v;

/* The warm-up ramp and plate calculator live in js/calculator.js. */

/* ---------- volume dashboard ----------
   A weekly hard-sets-per-tag view: the same kind of count the guide's own
   volume analysis (docs/guide.md, "Weekly volume") reasons about in prose,
   made visible in the app. The tag can come from any of VOLUME_DIMENSIONS
   (muscle/pattern/type) — "what does this hit" and "what shape is this
   movement" are different, orthogonal questions, and a plan that looks
   balanced on one can still be lopsided on the other (e.g. plenty of press
   volume but almost all of it isolation). */

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
  forEachSlot(profile.log, block.id, (k, w, d, slotRows) => {
    if (w < 1 || w > weeks) return;
    const s = slotRows || {};
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
   "A lost phone with no backup is a lost history" per the guide's own
   Known limits (docs/guide.md), and nothing used to remind you.
   Sessions-since-last-export is computable from data the app already has, so
   this rides on top of it rather than asking for anything new: a day's sets
   going from incomplete to complete (see the tick handler in drawApp) is
   close enough to "a session happened" for a gentle nag, not a precise
   ledger. */
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
          /* The field list here is mirrored by normalizeImportedLog on the
             other side: a field added to one and not the other is a field
             that crosses the camera and is thrown away on arrival. */
          if (rowRir(r) != null) row.rir = String(rowRir(r));
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

/* The legacy one-per-session RIR map, in the same {slot: {exId: value}}
   shape blockShareLog uses for rows — still emitted, and still separate
   from the log, because the phone on the other side of the camera may be
   running a shell from before plans/035: it reads this map and nothing
   else, and a share that dropped it would land there with no RIR at all.

   Derived from the rows now rather than copied out of profile.rir, so a
   value typed this week travels to that old phone too: getRir is the
   exercise-level reading (the last working set, or the legacy map behind
   it) and it is squeezed back into the three chips the old receiver knows.
   The rows carry the real per-set values beside it; a receiver that
   understands them reads those and folds this map onto rows that already
   have one, which changes nothing. */
function blockShareRir(profile, block) {
  const src = profile.log[block.id];
  if (!src) return {};
  const liveDays = dayList(block);
  const out = {};
  liveDays.forEach(day => {
    const liveEx = exList(day).map(e => e.id);
    for (let w = 1; w <= MAX_WEEKS; w++) {
      const key = slot(w, day.id);
      if (!src[key]) continue;
      const kept = {};
      liveEx.forEach(exId => {
        const v = rirNumber(getRir(profile, block.id, w, day.id, exId));
        if (v == null) return;
        kept[exId] = v >= 2 ? '2+' : String(v);
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
    const s = parseSlot(key);
    if (!s) return;
    const w = s.week;
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[s.dayId];
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
        /* One digit or nothing: anything else is dropped rather than
           coerced. A '2+' on a row is not a row value — the legacy map
           carries those, and normalizeImportedRir validates them there — so
           coercing it here would invent a measurement out of a chip that
           belonged to the whole session. */
        if (/^[0-5]$/.test(String(r.rir))) row.rir = String(r.rir);
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

/* The legacy RIR map's twin of normalizeImportedLog, re-keyed the same way.
   Unchanged by plans/035 on purpose: the map is still valid input — an old
   phone sends one with every QR, and every backup written before that plan
   has one — and the fold that moves it onto the rows runs afterwards, in
   installBlockData. The three chips stay its enum; a row's own digit is
   validated by normalizeImportedLog instead. */
function normalizeImportedRir(rawRir, rawBlock, normalized) {
  if (!rawRir || typeof rawRir !== 'object' || Array.isArray(rawRir)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(rawRir).slice(0, LOG_LIMITS.slots).forEach(key => {
    const s = parseSlot(key);
    if (!s) return;
    const w = s.week;
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[s.dayId];
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

/* The objetivo twin, re-keyed the same way. A record of what the rule put
   on the screen — so nothing here is trusted past its own shape, and a
   file that lost it entirely (every backup written before v3) restores
   with none, which is exactly what a session nobody had a target for
   looks like anyway. */
function normalizeImportedObj(rawObj, rawBlock, normalized) {
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(rawObj).slice(0, LOG_LIMITS.slots).forEach(key => {
    const s = parseSlot(key);
    if (!s) return;
    const w = s.week;
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[s.dayId];
    if (!dayId) return;
    const slotObj = rawObj[key];
    if (!slotObj || typeof slotObj !== 'object' || Array.isArray(slotObj)) return;
    const exFor = exMap[dayId] || Object.create(null);
    const kept = {};
    Object.keys(slotObj).forEach(rawExId => {
      const exId = exFor[rawExId];
      const rec = slotObj[rawExId];
      if (!exId || !rec || typeof rec !== 'object' || !Array.isArray(rec.sets)) return;
      const sets = rec.sets.slice(0, LOG_LIMITS.rows).map(x => ({
        w: clampNum(x && x.w, 0, 9999, 0),
        r: clampInt(x && x.r, 0, 999, 0),
        m: (x && (x.m === '↑' || x.m === '↓')) ? x.m : '',
      }));
      if (!sets.length) return;
      /* A record written before plans/021 has no `kind`, and it stays
         absent rather than being given a default: the missing field is the
         only thing that tells the two generations apart, and some of the
         older ones are reconstructions. `hold`/`brake` are stored only when
         true, the same convention the log uses for `share`/`ss`/`u`. */
      const keep = { v: 3, at: clampInt(rec.at, 0, Number.MAX_SAFE_INTEGER, 0),
                     conf: TARGET_CONF_OPTIONS.indexOf(rec.conf) >= 0 ? rec.conf : 'baja', sets: sets };
      if (TARGET_KIND_OPTIONS.indexOf(rec.kind) >= 0) keep.kind = rec.kind;
      if (rec.hold === true) keep.hold = true;
      if (rec.brake === true) keep.brake = true;
      /* The week's RIR the reps were solved for, when the record has one:
         an integer inside the same range a row can hold, dropped otherwise
         like `kind`. A descarga or a vuelta was never solved for one, so a
         record without it is not a record that lost it. */
      if (Number.isInteger(rec.rir) && rec.rir >= 0 && rec.rir <= RIR_MAX) keep.rir = rec.rir;
      kept[exId] = keep;
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
    const s = parseSlot(key);
    if (!s) return;
    const w = s.week;
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[s.dayId];
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
  const rows = [['perfil', 'bloque', 'semana', 'dia', 'ejercicio', 'orden', 'serie', 'peso', 'unidad', 'reps', 'hecha', 'fecha', 'rir', 'bajadas', 'tipo_bajada', 'nota', 'energia']];
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
            /* Per session, repeated on every row of that session so a
               spreadsheet filter on the column finds the whole session.
               Unlike `rir`, which is per set from plans/035 on — see the
               column below. */
            const note = getNote(profile, bId, w, day.id);
            const energy = getEnergy(profile, bId, w, day.id);
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
              /* The set's OWN value, blank where nothing was typed — the
                 file is the record as written, not as the rule reads it,
                 so the inheritance rule stays out of it. A session logged
                 before plans/035 carries its one chip on the row the fold
                 put it on, which is the last set of that session. */
              rows.push([profile.label, block.name, w, day.name, ex.n, ordAt[w][ex.id] || '', i + 1, r.w, rowUnit(r), r.r,
                         r.done ? 'si' : 'no', r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '',
                         rowRir(r) == null ? '' : String(rowRir(r)),
                         drops, used.length ? DROP_LABEL[dropKind(r)] : '', note, energy]);
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

/* ---------- the folded header's three sheets and two disclosures ----------
   Unguarded registrations, unlike the wire*() list below: these three sheets
   are app.js's own, so there is no shell old enough to be served this file
   without them. */
registerSheet('profileSheet', { closeBtn: 'profileClose' });
registerSheet('blockSheet', { closeBtn: 'blockClose' });
registerSheet('moreSheet', { closeBtn: 'moreClose' });
$('profileBtn').onclick = () => openSheet('profileSheet');
$('blockBtn').onclick = () => openSheet('blockSheet');
$('moreBtn').onclick = () => openSheet('moreSheet');

$('weekBtn').onclick = () => { expandedWeek = !expandedWeek; applyWeekPanel(); };

/* The note itself is redrawn on every draw, but the button holding it is in
   the markup, so this is bound once and reads the day it is standing on at
   click time rather than closing over one. */
$('pair').onclick = () => {
  const block = getBlock();
  const day = dayList(block)[getProfile().day];
  if (!day) return;
  const k = pairKey(block, day);
  const openNote = !expandedPair.has(k);
  if (openNote) expandedPair.add(k); else expandedPair.delete(k);
  $('pair').classList.toggle('open', openNote);
  $('pair').setAttribute('aria-expanded', openNote ? 'true' : 'false');
};

/* block-editor.js, diagnostics.js and profile-transfer.js load before
   app.js, but their DOM wiring (button clicks etc.) is deferred into these
   functions instead of running at their own top level — so it only ever
   runs once every script on the page (this one included) has finished
   parsing, regardless of load order. See js/block-editor.js,
   js/diagnostics.js and js/profile-transfer.js for why that matters. */
wireBlockEditor();
/* Guarded, unlike wireBlockEditor/wireProfileTransfer, because the files
   below are newer than some already-deployed shells: a returning user
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
