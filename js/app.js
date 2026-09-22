const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
/* Keys of the cards whose fold — the alternative, the cue and the machine
   settings, everything that used to be printed under the name (plans/036) —
   is open right now. In-memory only, so every fresh open of the app starts
   collapsed again. Keyed by profile + block + exercise id, not the exercise
   id alone: JSON-authored blocks reuse ids across blocks and profiles on
   purpose (sameLift), so an id-only key left a panel opened for one
   profile's "squat" pre-expanded for the other's. */
const expandedMore = new Set();
const setupKey = (block, ex) => state.activeProfile + '|' + block.id + '|' + ex.id;
/* Same shape, same reason, for the pair note under the week row: it opens on
   a tap and stays open for the rest of the session, and because the day is
   in the key, walking to the next day starts it folded again (plans/034). */
const expandedPair = new Set();
const pairKey = (block, day) => state.activeProfile + '|' + block.id + '|' + day.id;
/* Set by the ↓ button and by the "⋯" menu's "Ajustes de máquina" row so the
   draw they trigger can put the cursor straight into a box that was not on
   screen until that draw had run. Both are
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
   review.js because the prompt (block-editor.js) and the Diagnóstico's
   verdicts (diagVerdict, below) read it too, and neither may reach into a
   split file for it (AGENTS.md). */
const reviewName = s => '«' + String(s == null ? '' : s).replace(/[«»]/g, '') + '»';

/* JSON.parse can hand back `{"toString": null}`, and String() or Number()
   on that throws a TypeError: toString is not callable, valueOf returns the
   object itself, and there is nothing left to try. Every coercion of a
   value that came from a backup, a paste or a QR checks this first — an
   object is not text anybody typed, so it reads as absent. */
const isObj = v => v !== null && (typeof v === 'object' || typeof v === 'function');

/* Weights are typed on a Spanish phone keyboard, where the decimal key is a
   comma. parseFloat('22,5') is 22 — five kilos of drift on a leg press — so
   every read of a logged weight goes through here instead. */
const num = v => {
  const n = parseFloat(String(v == null || isObj(v) ? '' : v).replace(',', '.'));
  return isFinite(n) ? n : NaN;
};

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(isObj(v) ? NaN : Number(v));
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

/* `ex.inc` — one step of weight for the objetivo rule (targetFor): how far
   a set moves up or down a rung when the weights already logged against
   the lift have none within a step and a half (nextLoad, prevLoad). Bounded
   to something a plate stack could actually add: quarter-unit granularity,
   nothing under a plate change and nothing past a round-trip's worth of
   iron. */
const INC_MIN = 0.25, INC_MAX = 50, INC_STEP = 0.25;

/* Plate bounds. The only filter used to be `p > 0`, so a near-zero plate
   typed into Ajustes (or sitting in a hand-edited or restored backup) made
   fitPlates() below loop on the order of target/p times, growing an array,
   on every Calculadora open — a same-device hang from a single bad number. */
const PLATE_MIN = { kg: 0.25, lb: 0.5 }, PLATE_MAX = { kg: 50, lb: 100 };
/* How many plate sizes a set can hold. Real racks have a dozen at most; the
   list is the one imported collection that had no ceiling, and a backup
   restore reaches prefs without passing any normalizeImported* — so a
   file could carry a list that bloats every save, the Ajustes field and
   the AI prompt, and overflows the spread in the calculator (plans/040). */
const PLATES_MAX = 24;

/* What a plate list may hold, whoever writes it: migrate() on every load
   and restore, and "Guardar" in Ajustes from the text typed there. The
   two carried a copy each (plans/055). Every entry is read the way a
   typed weight is (num, so a comma decimal counts), kept only inside the
   unit's PLATE_MIN–PLATE_MAX, each size once, and at most PLATES_MAX of
   them. Empty when nothing is left, and each caller says what that means:
   the load falls back to the unit's defaults, while Ajustes keeps the list
   it already had. */
function cleanPlates(list, unit) {
  return Array.from(new Set(list.map(num)
    .filter(p => p >= PLATE_MIN[unit] && p <= PLATE_MAX[unit]))).slice(0, PLATES_MAX);
}

/* The step to fall back on when an exercise declares no `inc` of its own —
   and most don't, since it is an optional field. Something has to size the
   rule's step for every lift, so the chain runs exercise → your own
   default (Ajustes, seeded from this) → this. Deliberately the smallest
   plate/stack step that exists on most equipment rather than a typical one:
   a step finer than the machine has only ever costs you the difference
   between two real notches, while a coarser one invents jumps the stack
   cannot make.

   It does reach the log. copyPrev ("Rellenar con el objetivo") writes the
   objetivo into the boxes, and the objetivo is priced with this — which is
   why copyPrev used to move only an exercise with an explicit `ex.inc`, so
   a default could not quietly put +2,5 kg on a 12 kg lateral raise. The
   ladder is what stops that now: the weights already logged are the
   lift's rungs, and the step only invents one when none is near (see "the
   rungs this machine actually has"). */
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
   on every part of the profile's record filed by block, and `__proto__` is
   a name a hand-edited file can carry (plans/008 item 2). Returns false
   when it refuses, so a caller cannot file a block and quietly lose its
   rows.

   normalizeImportedProfile deliberately does not come through here: it
   walks the *sender's* keys and re-keys every map afterwards, so it is a
   normalization pass over an untrusted object, not an install into a live
   profile. See plans/009 item 5.

   Which parts a block carries is RECORD_PARTS' `travelsWithBlock`, and
   each part's entry there says why it does or does not. Then each part's
   `install` hook: a phone on an older shell still sends the legacy RIR map
   beside the log (blockShareRir), so a block arriving by QR or by paste
   gets the same fold a block already on disk got on load. */
function installBlockData(profile, blockId, data) {
  const id = safeKey(blockId);
  if (!id) return false;
  const d = data || {};
  RECORD_PARTS.forEach(part => {
    if (!part.travelsWithBlock || !d[part.name]) return;
    if (!profile[part.name]) profile[part.name] = {};
    profile[part.name][id] = d[part.name];
  });
  RECORD_PARTS.forEach(part => { if (part.install) part.install(profile, id); });
  return true;
}

/* Walk the slots one block of one part of the profile's record actually
   holds (any part keyed by slot, see RECORD_PARTS), in no particular order:
   fn(key, week, dayId, value), narrowed by `filter` on dayId, week, or both.

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

/* ---------- the profile's record ----------
   Seven maps sit beside a profile's blocks and together make up its record
   (CONTEXT.md, "the profile's record"). Nothing used to say so in one
   place: the list was written out by hand at every purge, move, install and
   repair, about eighteen copies, and each copy left out a different map
   with no comment saying whether that was a decision or a slip. A part
   added later had to be found in all of them, and a missed one was data
   left behind by "borrar" or lost on "enviar a…", silently.

   So this table is the list. Each entry says how its part is keyed, which
   is what decides what every operation below does to it:

     'slot+exercise'  blockId → slot → exId → value. A purge of one lift
                      reaches inside the slot; a move carries the value
                      to the other day, merging as `merge` says.
     'slot'           blockId → slot → value. About the session, not one
                      lift, so a purge of one lift leaves it and a move
                      does not carry it (unless the part has its own hook).
     'exercise'       exId → value, with no block above it. Not filed
                      under any block, so no purge or move reaches it.

   `travelsWithBlock` is what installBlockData files when a block arrives
   by paste or QR. `accept` is how a value of the part that came from
   outside — a backup, a profile file, a QR — is checked and re-keyed to
   the ids its block landed with: normalizeImportedProfile loops over the
   table with it, and the normalizeImported* names the QR path and the
   tests call are thin calls to it (plans/051). A part filed by block
   hands its check to reKeyImportedSlots, which owns the slot rules they
   all share. A hook (`move`, `purgeExercise`, `install`, `repair`) only
   where a part is special, and its comment says why; `clean`, on the two
   parts migrate() repairs by content, is the one rule that repair and
   `accept` both read (and setOrder, for the order), so the load, the
   restore and the app's own write cannot disagree about what the part
   may hold.

   Adding an eighth part is one entry here. The operations below, the
   restore, the guard test in test/unit.js and the tests that loop over
   this table pick it up. Only the block share still builds its parts by
   hand (blockShareLog, blockShareRir, blockShareOrder): its keys are a
   contract with phones on older shells, and test/unit.js fails if they
   stop being the parts with `travelsWithBlock`. */
const RECORD_PARTS = Object.freeze([
  /* The sets logged, every row of every session. The record itself; every
     other part describes something about it. */
  {
    name: 'log', keyedBy: 'slot+exercise', merge: 'concat', travelsWithBlock: true,
    /* Which fields a row keeps, and on what terms, is the row codec's
       (ROW_FIELDS): the same list the sender builds from. A row array past
       LOG_ROW_HARD_CAP is refused, not trimmed (that constant says why),
       and that refusal is the one thing any part's accept throws, which is
       what `rejects` says: the import reports it under the block's name,
       while the QR path, which is handed one block, reports it bare. */
    rejects: true,
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized, eachExercise(rows => {
        if (!Array.isArray(rows)) return undefined;
        if (rows.length > LOG_ROW_HARD_CAP) {
          throw new Error('trae ' + rows.length + ' series para un solo ejercicio en una sesión — demasiadas para ser un registro real.');
        }
        const kept = rows.slice(0, LOG_LIMITS.rows).map(rowFromImport);
        return kept.length ? kept : undefined;
      }));
    },
  },

  /* The legacy one-chip RIR, one value per session, read as a fallback and
     never written a value again since plans/035. It still travels with a
     block because a phone on an older shell sends it beside the log
     (blockShareRir), and it is folded onto the rows wherever it arrives:
     on install for that block, on every load for all of them. It is
     cleared with the sets it belonged to, down to one lift: a chip left
     behind with no set under it is invisible until the day comes back and
     shows a RIR nobody recorded. A chip the destination already has is
     kept on a move, since two single values cannot be merged without
     picking a side. */
  {
    name: 'rir', keyedBy: 'slot+exercise', merge: 'keep-destination', travelsWithBlock: true,
    /* Unchanged by plans/035 on purpose: the map is still valid input — an
       old phone sends one with every QR, and every backup written before
       that plan has one — and the fold that moves it onto the rows runs
       afterwards (`install`, `repair`). The three chips stay its enum; a
       row's own digit is the log's to validate. */
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized,
        eachExercise(v => (RIR_OPTIONS.indexOf(v) >= 0 ? v : undefined)));
    },
    install: (profile, blockId) => foldRirMap(profile, blockId),
    /* On every load rather than behind a version gate: the fold is
       idempotent and costs one pass over a map most profiles barely have,
       and a gate that skipped it would be one more thing to be wrong about.
       The fallback read in getRir and readSession means a skipped fold is a
       slower reader, not data loss. */
    repair: profile => Object.keys(profile.rir).forEach(bk => foldRirMap(profile, bk)),
  },

  /* The session note and the energy: free text about the day, and how the
     lifter arrived at it. They describe the session rather than a set, so
     they are keyed by slot alone, and unlike a value under an exercise they
     do not quietly become unreadable when the sets go: a note would still
     be sitting there when the day came back. Whatever clears a session's
     sets clears these too; clearing one lift does not.

     They do not travel with a block: the block share builds a log, the
     legacy chips and an order (blockShareLog, blockShareRir,
     blockShareOrder) and nothing for these, so no caller of
     installBlockData has them to pass.

     Their checks on the way in are the ones the restore has run since
     plans/008 item 4: a note capped to NOTE_LIMIT, an energy inside
     ENERGY_OPTIONS, and a slot left with nothing valid dropped like any
     other. */
  {
    name: 'notes', keyedBy: 'slot',
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized, v => txt(v, NOTE_LIMIT) || undefined);
    },
  },
  {
    name: 'energy', keyedBy: 'slot',
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized, v => (ENERGY_OPTIONS.indexOf(v) >= 0 ? v : undefined));
    },
  },

  /* The session order: the ids of a slot's exercises in the order they were
     actually done, kept only when that differs from the plan's. Absent
     means "in the order the plan asks for", which is most sessions. */
  {
    name: 'order', keyedBy: 'slot', travelsWithBlock: true,
    /* Clearing one lift's sets leaves its id in the order, on purpose: the
       order describes the session, not the sets, and "borrar registro" on
       one lift does not un-reorder the day. The stored ids are resolved
       against the plan when read (orderedEx), so an id whose lift has left
       the day simply drops out. */
    purgeExercise() {},
    /* An order is a permutation of a day's exercises, not a map keyed by
       exercise id, so it needs its own move: drop the id from the source
       day's recorded order (if it had one) and append it to the
       destination's (if it has one). A day with no recorded order keeps
       meaning "the plan's order", which already includes the exercise
       wherever it now sits in the plan, so there is nothing to add there. */
    move(profile, blockId, fromDayId, toDayId, exId) {
      const blk = profile.order[blockId];
      if (!blk) return;
      /* The two halves are independent — the destination day can have a
         recorded order in a week the source day has no entry for at all,
         and the exercise still has to join it — so this walks the weeks
         *either* day has, not just the source's. */
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
    },
    /* What one recorded order may hold, whoever is writing it: the import,
       migrate()'s repair and setOrder used to carry three copies of this
       that disagreed at the edges (plans/051). A list, of which the first
       ORDER_LIMIT entries are read, each resolved to an id this phone has
       (by `resolve`: the import's goes through the sender's id map, and
       the default takes any string safeKey allows), each id once.
       Undefined when nothing is left, which every caller reads as "the
       plan's order".

       The cap comes before the ids are resolved, as the import always had
       it. Nothing the app writes holds more than ORDER_LIMIT ids or any it
       would refuse, so this only bites on a list padded with junk.

       One id is still an order, as the repair always had it. The import
       used to want two, but "Enviar a otra sesión" leaves one behind (the
       move below takes the lift out of the source day's order and keeps
       the rest), and it still says what came first once the plan has put
       another lift ahead of it; wanting two dropped it from every backup
       and would have had the repair drop it on the next load. */
    clean(ids, resolve) {
      if (!Array.isArray(ids)) return undefined;
      const toId = resolve || (id => (typeof id === 'string' && safeKey(id)) || '');
      const seen = new Set();
      const kept = [];
      ids.slice(0, ORDER_LIMIT).forEach(raw => {
        const id = toId(raw);
        if (id && !seen.has(id)) { seen.add(id); kept.push(id); }
      });
      return kept.length ? kept : undefined;
    },
    /* Ids the sender's block does not account for are dropped rather than
       carried through as strings that would never resolve on this phone.
       An element, not a key, so it can be an object, and a lookup by it
       would convert it to a key (see isObj). */
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized,
        (ids, exFor) => this.clean(ids, id => (isObj(id) ? '' : exFor[id])));
    },
    /* A slot that is not a list of distinct, usable ids cannot be drawn in
       any order, so it goes: the plan's order is the safe reading. */
    repair(profile) {
      Object.keys(profile.order).forEach(bk => {
        const blk = profile.order[bk];
        if (!blk || typeof blk !== 'object' || Array.isArray(blk)) { delete profile.order[bk]; return; }
        Object.keys(blk).forEach(k => {
          const ids = this.clean(blk[k]);
          if (ids) blk[k] = ids; else delete blk[k];
        });
      });
    },
  },

  /* The objetivo record: the target the rule put on screen for a lift in a
     slot, written once when the session starts. It is the only thing that
     can tell a back-off the plan asked for from a weight that had to come
     off. Keyed by exercise under the slot like the log, so a purge of one
     lift reaches it; a record left behind would outlive the sets it
     described and, if the id came back on that day, block the real one
     (recordTarget writes once). The destination's own record is kept on a
     move: it describes the session that was actually shown there.

     It never travels with a block (decision, plans/025): the receiving
     phone recomputes the objetivo from the log it is sent, and a record it
     did not show is not its record to hold. It moves only with a whole
     profile. */
  {
    name: 'obj', keyedBy: 'slot+exercise', merge: 'keep-destination',
    /* A record of what the rule put on the screen, so nothing in it is
       trusted past its own shape, and a file that lost it entirely (every
       backup written before v3) restores with none, which is exactly what
       a session nobody had a target for looks like anyway. */
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized, eachExercise(rec => {
        if (!rec || typeof rec !== 'object' || !Array.isArray(rec.sets)) return undefined;
        const sets = rec.sets.slice(0, LOG_LIMITS.rows).map(x => ({
          w: clampNum(x && x.w, 0, 9999, 0),
          r: clampInt(x && x.r, 0, 999, 0),
          m: (x && (x.m === '↑' || x.m === '↓')) ? x.m : '',
        }));
        if (!sets.length) return undefined;
        /* A record written before plans/021 has no `kind`, and it stays
           absent rather than being given a default: the missing field is
           the only thing that tells the two generations apart, and some of
           the older ones are reconstructions. `hold`/`brake` are stored
           only when true, the same convention the log uses for
           `share`/`ss`/`u`. */
        const keep = { v: 3, at: clampInt(rec.at, 0, Number.MAX_SAFE_INTEGER, 0),
                       conf: TARGET_CONF_OPTIONS.indexOf(rec.conf) >= 0 ? rec.conf : 'baja', sets: sets };
        if (TARGET_KIND_OPTIONS.indexOf(rec.kind) >= 0) keep.kind = rec.kind;
        if (rec.hold === true) keep.hold = true;
        if (rec.brake === true) keep.brake = true;
        /* The week's RIR the reps were solved for, when the record has
           one: an integer inside the same range a row can hold, dropped
           otherwise like `kind`. A descarga or a vuelta was never solved
           for one, so a record without it is not a record that lost it. */
        if (Number.isInteger(rec.rir) && rec.rir >= 0 && rec.rir <= RIR_MAX) keep.rir = rec.rir;
        return keep;
      }));
    },
  },

  /* The variants: the names an exercise has had, each with the date it
     started (exId → [{ n, since }]). Keyed by exercise id rather than by
     block, because an exercise is renamed in ONE block and the history the
     objetivo gathers crosses all of them.

     They survive "borrar todo el registro" and deleting a block, on
     purpose: they are the plan's naming history, not what was lifted, and
     the log keeps no copy of the name a session was done under, so a
     variant thrown away cannot be rebuilt. */
  {
    name: 'variants', keyedBy: 'exercise',
    /* What one exercise's list may hold, on every load and on every
       import: the import used to carry a copy of this, character for
       character (plans/051). Anything that is not a plain YYYY-MM-DD is
       dropped, because a malformed date would cut a history at a moment
       nobody can name; an exercise left with no dated variant reads as one
       unbroken variant, which is the reading it had before v3. Always a
       list, empty when nothing is left. */
    clean(list) {
      if (!Array.isArray(list)) return [];
      return list.filter(v => v && typeof v === 'object' && !isObj(v.since) && VARIANT_SINCE_RE.test(String(v.since)))
        .map(v => ({ n: txt(v.n, IMPORT_LIMITS.exName) || '', since: String(v.since) }))
        .slice(-VARIANT_LIMIT);
    },
    /* Keyed by exercise id and not by block, so the block-by-block
       re-keying cannot reach them: `exIds` is the union of every block's
       id map that normalizeImportedProfile leaves behind for exactly this.
       An id the importer renamed (a duplicate, or a blocked key like
       `__proto__`) follows its exercise here, the same way every part
       filed by block does; without that the rename history stayed attached
       to an id nothing trains any more, or to the wrong lift. An id the
       file never mentions is kept on safeKey alone: harmless, because
       nothing asks for it. */
    accept(raw, exIds) {
      const out = {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
      Object.keys(raw).slice(0, IMPORT_LIMITS.days * IMPORT_LIMITS.ex).forEach(rawExId => {
        const exId = exIds.get(rawExId) || safeKey(rawExId);
        const list = this.clean(raw[rawExId]);
        if (exId && list.length) out[exId] = list;
      });
      return out;
    },
    /* After the blocks are repaired (ensureRecord runs last in migrate),
       because the lateral-raise seed reads the name each of its three
       slots is carrying right now. */
    repair(profile) {
      Object.keys(profile.variants).forEach(exId => {
        const list = this.clean(profile.variants[exId]);
        if (list.length) profile.variants[exId] = list; else delete profile.variants[exId];
      });
      seedLateralVariants(profile);
    },
  },
].map(part => Object.freeze(part)));

/* One part by name, for the few callers that mean one part in particular:
   the normalizeImported* names and setOrder. Everything that means every
   part loops over the table instead. */
const recordPart = name => RECORD_PARTS.find(part => part.name === name);

/* Every key a profile carries beside the parts of its record: its name and
   accent, its plan (the blocks, their order, the one being trained) and
   where it stands in it. With RECORD_PARTS' names this is the whole of a
   profile, and a restored or loaded one keeps nothing else (plans/051):
   nothing reads another key, so one a file carried used to ride into
   storage untouched and out again in every backup after. The guard in
   test/unit.js reads this same list and fails when the app writes a key
   onto a profile that is in neither, so a new field is added here on
   purpose, or it would be dropped by the next restore. */
const NON_RECORD_FIELDS = Object.freeze(['label', 'theme', 'blocks', 'blockOrder', 'activeBlock', 'week', 'day']);

/* Clear part of the profile's record, the one way every "borrar" does it:

     purgeRecord(profile)                              whole profile (wipe)
     purgeRecord(profile, blockId)                     one block (deleteBlocks)
     purgeRecord(profile, blockId, { day })            one day, every week
     purgeRecord(profile, blockId, { day, week })      one week of one day (clearDay)
     purgeRecord(profile, blockId, { day, exercise })  one lift on one day, every week

   A day walks every week the day actually has rather than the block's
   length, on purpose: a block shortened from 12 weeks to 6 still has rows
   filed under weeks 7-12, and "borrar registro" has to mean all of it,
   including a week above MAX_WEEKS from a hand-edited or older backup (see
   forEachSlot).

   The whole profile gets fresh empty maps, not a sweep: everything the
   sheet promises, not just the sets. The legacy RIR chips used to survive
   a wipe, invisibly, but still on disk after you asked for them to be
   gone. */
function purgeRecord(profile, blockId, scope) {
  const s = scope || {};
  RECORD_PARTS.forEach(part => {
    if (part.keyedBy === 'exercise') return;
    if (blockId == null) { profile[part.name] = {}; return; }
    const map = profile[part.name];
    if (!map) return;
    if (s.day == null) { delete map[blockId]; return; }
    const blk = map[blockId];
    if (!blk) return;
    if (s.exercise != null) {
      if (part.purgeExercise) { part.purgeExercise(profile, blockId, s); return; }
      if (part.keyedBy !== 'slot+exercise') return;
      forEachSlot(map, blockId, (k, w, d, v) => { if (v) delete v[s.exercise]; }, { dayId: s.day, week: s.week });
      return;
    }
    forEachSlot(map, blockId, k => delete blk[k], { dayId: s.day, week: s.week });
  });
}

/* "Send to another session" in the plan editor: the exercise moves between
   draft days right away, but everything filed under the session it was in
   stays there until the draft is saved. This is what makes that filing
   catch up, across every week the day actually has.

   Merges into the destination's existing entry for the id rather than
   overwriting it: a block can carry the same exercise id on two days by
   design (see migrate()'s day/exercise-id repair), so the destination can
   already have its own entry, and blindly assigning would erase it. How
   is each part's `merge`: 'concat' puts the moved rows after the
   destination's own, and 'keep-destination' leaves a single value the
   destination already has, since two cannot be merged without picking a
   side (a 'concat' value that is not a list of rows is treated the same
   way). Either way nothing is ever destroyed by calling this, including
   calling it twice, which applyPlanDraft cannot do today but a future bug
   easily could.

   applyPlanDraft makes each move in two calls, through a day nothing is
   filed under (plans/053's second follow-up), so a part's own `move` has
   to compose: onto that day and then on to the destination has to end
   where the one call does. test/unit.js holds every part to it. */
function moveExerciseRecord(profile, blockId, fromDayId, toDayId, exId) {
  /* A day to itself is no move, and leaves the record as it was. The
     loop below emptied it instead: the source slot is the destination
     slot, so the log's rows were added to themselves and then deleted
     with the source, every set of that lift on that day gone, and the
     legacy chip and the objetivo record were deleted from the very slot
     that was keeping them. The session order's own move is no safer,
     which is why this comes before any part runs: it takes the id out of
     the list and appends it to the same list, filing the lift as done
     last, or drops a week's order that held that id alone. No caller
     asks for it today: applyPlanDraft skips a lift still on the day it
     started on, and the days it lifts the rest through (spareDayIds) are
     never a day of the draft. But the promise above is that nothing is
     destroyed by calling this, and this was the one call that broke it. */
  if (fromDayId === toDayId) return;
  RECORD_PARTS.forEach(part => {
    const map = profile[part.name];
    if (!map || !map[blockId]) return;
    if (part.move) { part.move(profile, blockId, fromDayId, toDayId, exId); return; }
    if (part.keyedBy !== 'slot+exercise') return;
    const blk = map[blockId];
    forEachSlot(map, blockId, (fromKey, w, d, from) => {
      if (!from || from[exId] === undefined) return;
      const toKey = slot(w, toDayId);
      if (!blk[toKey]) blk[toKey] = {};
      const dest = blk[toKey];
      const v = from[exId];
      if (part.merge === 'concat' && Array.isArray(v)) {
        dest[exId] = dest[exId] ? dest[exId].concat(v) : v;
      } else if (dest[exId] === undefined) {
        dest[exId] = v;
      }
      delete from[exId];
      if (!Object.keys(from).length) delete blk[fromKey];
    }, { dayId: fromDayId });
  });
}

/* migrate()'s share: give every part the shape the app expects, then run
   each part's own repair. Absent is the normal case for most of them —
   every backup written before v3 lacks obj and variants — so a part that is
   missing, or not an object, starts empty rather than failing the load. */
function ensureRecord(profile) {
  RECORD_PARTS.forEach(part => {
    if (!profile[part.name] || typeof profile[part.name] !== 'object') profile[part.name] = {};
  });
  RECORD_PARTS.forEach(part => { if (part.repair) part.repair(profile); });
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
/* How long the machine settings may be, on every path — see `setup` in
   EX_FIELDS for what the field is. */
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
    if (ACCENTS.indexOf(profile.theme) < 0 && !legacyAccent(profile.theme)) profile.theme = seed.theme;

    /* A block that is not an object — null, a string, a list — has no plan
       left to repair, and every step below writes onto it: a null threw on
       `id`, so load() stopped here and the app never drew. The import
       refuses the same shape (describeProfileProblem), but localStorage is
       not an import. It goes the way a deleted block goes, record and all,
       and before the check for no blocks, so a profile left with none gets
       the seed like one that had none. Its record matters most there: the
       seed's block reuses a fixed id, and would otherwise open on sets
       logged under a corrupt block that happened to carry it. */
    if (profile.blocks && typeof profile.blocks === 'object') {
      Object.keys(profile.blocks).forEach(bk => {
        const block = profile.blocks[bk];
        if (block && typeof block === 'object' && !Array.isArray(block)) return;
        delete profile.blocks[bk];
        purgeRecord(profile, bk);
      });
    }
    if (!profile.blocks || typeof profile.blocks !== 'object' || !Object.keys(profile.blocks).length) {
      profile.blocks = seed.blocks;
      profile.blockOrder = seed.blockOrder.slice();
    }

    /* "Exists" is an own key, the same test plans/040 put on activeProfile
       below: a plain object answers profile.blocks['toString'] with a
       function and ['__proto__'] with Object.prototype. An import never
       reaches here with a name like that (normalizeImportedProfile re-keys
       every block), but localStorage itself is not an import. */
    const ownBlock = id => Object.prototype.hasOwnProperty.call(profile.blocks, id) ? profile.blocks[id] : undefined;

    /* A block filed under a name safeKey refuses moves to a fresh key, and
       everything that names it follows — the rename normalizeImportedProfile
       gives an import. Owning the key is not enough: the key is the block's
       id (below), and the id indexes every other part of the record, where
       it is not an own key yet. A block owning '__proto__' filed its first
       logged set onto Object.prototype itself, and nothing was saved. */
    Object.keys(profile.blocks).forEach(bk => {
      if (safeKey(bk)) return;
      let id = uid('block');
      while (ownBlock(id)) id = uid('block');
      profile.blocks[id] = profile.blocks[bk];
      delete profile.blocks[bk];
      RECORD_PARTS.forEach(part => {
        const map = profile[part.name];
        if (part.keyedBy === 'exercise' || !map || typeof map !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(map, bk)) { map[id] = map[bk]; delete map[bk]; }
      });
      if (Array.isArray(profile.blockOrder)) profile.blockOrder = profile.blockOrder.map(x => (x === bk ? id : x));
      if (profile.activeBlock === bk) profile.activeBlock = id;
    });

    /* The picker is driven off blockOrder, so it has to list every block
       that exists, exactly once, and nothing that doesn't. A hand-edited
       blockOrder or activeBlock naming 'toString' or 'constructor' used to
       pass a truthy read here, and getBlock() then handed the first draw a
       function instead of a block. */
    const order = (Array.isArray(profile.blockOrder) ? profile.blockOrder : [])
      .filter((id, i, a) => ownBlock(id) && a.indexOf(id) === i);
    Object.keys(profile.blocks).forEach(id => { if (order.indexOf(id) < 0) order.push(id); });
    profile.blockOrder = order;
    if (!ownBlock(profile.activeBlock)) profile.activeBlock = order[order.length - 1];

    profile.week = clampInt(profile.week, 1, MAX_WEEKS, 1);
    profile.day = clampInt(profile.day, 0, 99, 0);

    Object.keys(profile.blocks).forEach(bk => {
      const block = profile.blocks[bk];
      /* Always the key, never a stored id that disagrees with it. Every
         write to the record is filed under block.id (entry, setOrder, the
         plan editor's save into profile.blocks), while blockOrder and every
         reader go by the key, so a block whose id said 'constructor' filed
         its sets onto the global Object function, where no save finds them,
         and one whose id named another block wrote into that block's
         history. The app's own writers always keep the two equal;
         normalizeImportedProfile makes the same call for the same reason. */
      block.id = bk;
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
          /* Every other field by its own entry: what a stored exercise may
             hold is EX_FIELDS', the same table the import reads. */
          repairExercise(ex, block.weeks);
        });
      });
    });

    /* The profile's record last, after the blocks are repaired: the
       variants' repair seeds the lateral raises from the name each of the
       three slots is carrying right now. Nothing above reads a part of
       the record, so creating them here rather than first changes
       nothing. */
    ensureRecord(profile);
  });

  /* Whatever happened above, the app cannot draw with no profile at all. */
  if (!Object.keys(state.profiles).length) state.profiles = fallback.profiles;
  /* An own key, not a truthy read: `state.profiles['constructor']` is a
     function and `state.profiles['__proto__']` is Object.prototype, and a
     backup can name either. Either one used to pass here, getBlock() then
     threw on the way to the first draw, and the recovery screen's buttons
     wrote that state back to disk (plans/040). */
  if (!Object.prototype.hasOwnProperty.call(state.profiles, state.activeProfile)) state.activeProfile = profileKeys()[0];
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
  const plates = Array.isArray(state.prefs.plates) ? cleanPlates(state.prefs.plates, state.prefs.units) : [];
  state.prefs.plates = plates.length ? plates : DEFAULT_PLATES[state.prefs.units].slice();
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

/* A logged weight as text in the unit on screen: exactly as typed when it
   was typed in that unit, converted (and written the way the card writes a
   weight, loadText) when it was not. Anything that does not read as a
   positive number is handed back untouched — a half-typed "," is not a 0. */
function weightText(raw, unit) {
  if (raw === '' || raw == null) return '';
  const v = num(raw);
  return unit === units() || !(v > 0) ? String(raw) : loadText(convertWeight(v, unit, units()));
}

/* The stamp for a write into a set, where `fresh` is the set or drop whose
   `w` was just typed (or adopted). A set carries ONE stamp for itself and
   its drops, and stampRowUnit alone relabels the whole row: 100 kg logged,
   the preference switched to lb, a drop typed — and the set's 100 read as
   100 lb from then on. The same the other way round, typing the set over
   drops written in the old unit.

   So when the row's stamp is not the unit on screen, the row's OTHER
   weights are converted into it before the new stamp goes on. Converting
   rather than keeping the old stamp because the card has exactly one unit
   in it — the column heading, units() — and it is the unit anything typed
   now was typed in; keeping the kg stamp would file the new lb drop as kg,
   which is the same bug on the other half of the row. It is the one place
   the app rewrites a number somebody typed, and only a number in the set
   being written to, which after the switch the card was already showing
   under the wrong heading. Empty weights stay empty, so rowUsed and
   pruneLog see exactly what they saw, and `w` stays a comma string with
   `u` as 'lb' or nothing, which is all ROW_FIELDS carries.

   Answers whether anything was converted, so a handler can refresh the
   boxes that still show the old numbers. */
function stampForWrite(r, fresh) {
  const from = rowUnit(r);
  let moved = false;
  if (from !== units()) {
    [r].concat(dropsOf(r)).forEach(x => {
      if (x === fresh || !x || typeof x !== 'object') return;
      const t = weightText(x.w, from);
      if (t !== '' && t !== String(x.w)) { x.w = t; moved = true; }
    });
  }
  stampRowUnit(r);
  return moved;
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

function save(scope) {
  /* Before the timer, not inside it: the next draw can be this same tick
     (a set ticked and its card redrawn), and it must not read the history
     from before the write. See logChanged for what `scope` may claim. */
  logChanged(scope);
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
  /* The row's own hint, not its whole text: since plans/037 "Tema" is a
     labelled row in "Más" rather than a one-glyph button, and writing
     textContent here would take the label with it. */
  $('themeHint').textContent = THEME_LABEL[t];
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
/* Own keys only, and strings only: a theme read from a file can be
   'constructor' (inherited, truthy) or an object whose key conversion
   throws (see isObj). */
const legacyAccent = t => typeof t === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_ACCENT, t) ? LEGACY_ACCENT[t] : '';

let setupDraft = null;
let setupFirstRun = false;

function accentOf(profile) {
  return legacyAccent(profile.theme) || (ACCENTS.indexOf(profile.theme) >= 0 ? profile.theme : 'azul');
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
    const plates = cleanPlates(String(setupDraft.platesText || '').split(','), state.prefs.units);
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
    '<div class="rec-btns">' +
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
      const profile = state.profiles && Object.prototype.hasOwnProperty.call(state.profiles, state.activeProfile)
        ? state.profiles[state.activeProfile] : null;
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
  /* Half the sets, floored at two so a deload still has a pair to compare
     — but never MORE than the week's own count: a one-set finisher used to
     draw two rows on the one week that asks for less (plans/041). */
  if (block && deloadAt(block, w)) n = Math.min(n, Math.max(2, Math.ceil(n / 2)));
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

/* What makes a row worth keeping: something the person put in it. `rir`
   is one of those since plans/035 — it is the record now, not a parallel
   map — and leaving it out meant a reserve written before any set was
   ticked lived on a row pruneLog deleted on the next save and
   blockShareLog never sent. */
const rowUsed = r => !!(r && (r.done || (r.w !== '' && r.w != null) || (r.r !== '' && r.r != null) ||
                              rowRir(r) != null || dropsOf(r).some(dropUsed)));

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

/* The rows the decay is measured over: the ones with a rep count. One
   list, read by repDecay for the numbers and by decayLine and the
   Diagnóstico for which set is "the first" — three readers that each
   picked their own first set disagreed on a session whose first row was
   ticked without reps, which the tick contract allows (plans/041).

   The card hands these two its stored rows; the Diagnóstico hands them a
   session's sets (plans/056), and they read the same: a set's `r` is what
   num() made of the row's, NaN where the box was empty, and num() gives a
   number back unchanged. */
const decayRows = rows => (rows || []).filter(r => r && r.r !== '' && r.r != null && !isNaN(num(r.r)));

function repDecay(rows) {
  const withReps = decayRows(rows);
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
  const first = rowRir(decayRows(rows)[0]);
  if (first == null) return head + ': ¿primera serie al fallo?';
  if (first >= 2) return head + ' con la primera serie holgada (RIR ' + first + '): ¿descansos cortos?';
  return head + ': primera serie a ' + first + ' RIR — las de después se vacían';
}

/* The top of a rep range like "8–12" or "8-12" — the last number in the
   string, so it also copes with a plain "12" (no range at all). Read by the
   objetivo rule (targetFor, and ruleSession through exHistory), set by
   set: a set that reached it is the one that moves up a rung, and is read
   as a floor under what the set could do rather than a measurement of it.
   copyPrev ("Rellenar con el objetivo") no longer asks it anything; it
   writes whatever weights the rule priced. */
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
   (`profile.rir[blockId][slot][exId]`) and tapped into a row of three chips
   under the sets, on the theory that mid-set entry was too much friction.
   plans/036 answered that by putting the box IN the set row, beside the
   reps, where it is one keypress on the keyboard already up. The cost was
   paid by every
   reader: one RIR priced every set of the session, so a session run 3 → 2 →
   1 → 0 down its four sets — which is what a well-paced session looks like —
   read as a lifter who lost far more capacity between sets than they did.

   Since plans/035 the record is `r.rir` on the log row: one digit '0'–'5',
   absent by default like `share`/`ss`, the same shape as `r.r` (a string out
   of an input, read with num()). On the row it travels with every purge,
   move, share, backup and import the row already survives, and there is one
   value per set for the rule to read.

   The old map is legacy: folded onto the rows on load and on import
   (foldRirMap), and read as a fallback by getRir, and by the rule's reader
   (readSession) through legacyRir. Nothing writes a VALUE into it again;
   dropLegacyRir deletes the entry for the exercise-session a box is
   recording, and that deletion is the one exception — without it, emptying
   a box on anything logged before plans/035 does nothing, because getRir
   falls back to the map and foldRirMap puts the value straight back. See
   dropLegacyRir.

   The inheritance rule (sessionRirs) is what makes a log with no per-set
   values read exactly as it always did: a set with nothing typed takes the
   reserve of the nearest LATER set that has one, and sets after the last
   typed value have none. A set done before a set typed at N RIR had at
   least N left, so pricing it at N under-reads it — the safe direction (see
   the censoring note) — and it is precisely what the one chip used to do to
   every set of the session. */
/* The three values the retired chip offered. No control draws them any
   more (plans/036); they survive as the legacy map's own enum, which the
   rir part's accept (RECORD_PARTS) and blockShareRir still have to
   validate against, and as the buckets js/review.js counts sessions into. */
const RIR_OPTIONS = ['2+', '1', '0'];
/* Past five reps in reserve the number stops saying anything a lifter can
   feel: it says "easy", which '5' already says. One digit, so the box in
   the set row is one keypress and maxlength="1" is most of the validation.

   Read by the objetivo record's accept only (RECORD_PARTS). The four
   places that validate a row's own value spell the range out as a literal
   — rowRir, rirNumber and the row codec's accept as /^[0-5]$/, and the
   box's own oninput as /[^0-5]/g — because a regex is what they need and
   building one from the constant would be the harder thing to read.
   Raising this number means editing those four as well; grep for the
   literal. */
const RIR_MAX = 5;

/* The row's own value as a number, or null when the row has none. Nothing
   else reads r.rir directly — a reader that wants the session's reading
   wants sessionRirs or getRir. */
const rowRir = r => {
  const v = r && r.rir;
  return !isObj(v) && /^[0-5]$/.test(String(v)) ? +v : null;
};

/* Working sets are what the rule reads and what the RIR belongs to: a row
   nobody ticked, or one with no weight or no reps, is not a set that had
   anything left in reserve. It is the `worked` flag readSession sets. */
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

/* The row the session's RIR is read off: the last SET ACTUALLY DONE that
   carries one, and only if no set done carries one, the last row that
   does. That second pass is what keeps a reserve typed before anything is
   ticked from being unreadable — an untouched day has no set done for the
   value to sit on, so it sits on a padding row (the box's own row, or
   rirRowFor's for a legacy chip being folded), and a reader that only
   looked at the sets done could not see it. The first pass is why that
   padding row cannot shadow a set ticked afterwards on the screens that
   read this; the rule never takes the second pass at all — see
   legacyRir. */
function rirRowRead(rows) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowWorked(rows[i]) && rowRir(rows[i]) != null) return rows[i];
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowRir(rows[i]) != null) return rows[i];
  }
  return null;
}

/* The exercise-level reader the screens that still say "the session's RIR"
   keep using — the Diagnóstico's signals, the review's buckets, readSession's
   fallback: the row above, else the legacy map, else ''. It returns a
   string either way ('3' or '2+'), because the legacy map's own values are
   strings; take a number through rirNumber. */
/* The legacy map's own value for one exercise-session, or ''. Its own
   function because the rule's reader — readSession since plans/038 — wants
   THIS and nothing else as its fallback: getRir's second pass, below,
   returns any row carrying a value, ticked or not, which is right for a
   screen printing "the session's RIR" on a day nobody has ticked yet, and
   wrong as evidence about the sets that were done — a 0 typed on a set
   that was then un-ticked used to price every working set of the session
   at failure (plans/039). */
function legacyRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}

function getRir(profile, blockId, w, dayId, exId) {
  const bucket = profile.log && profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
  const row = rirRowRead(bucket && bucket[exId]);
  if (row) return String(rowRir(row));
  return legacyRir(profile, blockId, w, dayId, exId);
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
  if (isObj(v)) return null;
  if (Object.prototype.hasOwnProperty.call(RIR_VALUE, v)) return RIR_VALUE[v];
  return !isObj(v) && /^[0-5]$/.test(String(v)) ? +v : null;
};

/* Where a value recorded for the whole session goes on the rows: the last
   set actually done, else the last row of the exercise — a session nobody
   has ticked yet still has somewhere to put it. The chip that used to write
   through this is gone (plans/036), so the fold below is its only caller;
   it is still a rule of its own because what it encodes is the reading the
   chip always had — "RIR último set" — and every legacy value in the
   installed base has to keep landing where it did. */
function rirRowFor(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let at = -1;
  rows.forEach((r, i) => { if (rowWorked(r)) at = i; });
  return rows[at >= 0 ? at : rows.length - 1] || null;
}

/* The one-time move of the legacy map onto the rows, run on load (migrate)
   and on every block that arrives with one (installBlockData — an old phone
   still sends the map with its QR). The map entry is left where it is: it
   costs nothing, it is what getRir and readSession fall back to when a slot
   has no rows to fold onto, and a receiver on an older shell still needs it.

   Idempotent by construction — a session any row of which already carries
   a value is never touched — so running it on every load is cheap and a
   skipped run is not data loss. A malformed entry is skipped rather than
   thrown on, like every other repair in migrate. */
function foldRirMap(profile, blockId) {
  if (!profile || !profile.rir || !profile.log) return;
  forEachSlot(profile.rir, blockId, (key, w, dayId, slotRir) => {
    if (!slotRir || typeof slotRir !== 'object' || Array.isArray(slotRir)) return;
    const slotLog = profile.log[blockId] && profile.log[blockId][key];
    if (!slotLog || typeof slotLog !== 'object' || Array.isArray(slotLog)) return;
    Object.keys(slotRir).forEach(exId => {
      const n = rirNumber(slotRir[exId]);
      if (n == null) return;
      const rows = slotLog[exId];
      /* Once per session, never again: a session any set of which already
         carries a value has either been folded already or been typed on
         since, and in both cases the rows are the record and the map is
         not. Guarding the target row alone was the bug twice over — the
         row rirRowFor picks MOVES when a later set is ticked, so a chip
         folded onto set 3 was folded again onto set 4 on the next load;
         and a block shared from a phone whose rows carried values arrived
         with the map blockShareRir still emits for older receivers, and
         that map was written onto the one working set that had no value
         of its own (plans/039). */
      if (!Array.isArray(rows) || rows.some(r => rowRir(r) != null)) return;
      const row = rirRowFor(rows);
      if (!row || typeof row !== 'object') return;
      row.rir = String(n);
    });
  });
}

/* The RIR the *plan* asks for in a given week, dug out of the free text in
   `phase[w].r` — which is prose ("2–3 RIR", "RIR 2", "0–1 RIR", "Descarga"),
   not a field. Only a number immediately BEFORE or AFTER "RIR" is a
   prescription — "RIR 2" is as natural in Spanish as "2 RIR", and the AI
   prompt's free text invites either; any other digit in the label is a week
   number, a percentage or a rep scheme, and the week says nothing about
   reserve — `weekRir` then falls back to the reserve the last session was
   left at. The FIRST such number in the label wins, whichever side of
   "RIR" it sits on. A range picks the LOWEST number: "2–3 RIR" is a week
   you are meant to be able to take to 2, and reading it as 3 quietly
   under-loads every estimate built on it — the dash class covers the
   hyphen, the en dash, the em dash and the minus sign so a range split by
   any of them still reads its lower end, rather than the regex missing the
   pair and grabbing the lone digit next to "RIR" instead. A week with no
   "RIR" at all — a deload, or a phase somebody wrote in their own words —
   returns null, and so does a number above RIR_MAX: a label like "60 RIR"
   is not a prescription either. */
function phaseRir(block, w) {
  const r = String((block && block.phase && block.phase[w] && block.phase[w].r) || '');
  const before = r.match(/(\d+)(?:\s*[-–—−]\s*(\d+))?\s*RIR/i);
  const after = r.match(/RIR\s*(\d+)(?:\s*[-–—−]\s*(\d+))?/i);
  const near = !before ? after : !after ? before : (before.index <= after.index ? before : after);
  if (!near) return null;
  const v = Math.min(num(near[1]), num(near[2] != null ? near[2] : near[1]));
  return v > RIR_MAX ? null : v;
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

/* Through the order part's own rule (RECORD_PARTS), the one migrate() and
   the import read too. Its callers hand it the day's own ids, which the
   rule passes as they are; it used to apply the cap alone. */
function setOrder(profile, blockId, w, dayId, ids) {
  const k = slot(w, dayId);
  const kept = recordPart('order').clean(ids);
  if (kept) {
    if (!profile.order[blockId]) profile.order[blockId] = {};
    profile.order[blockId][k] = kept;
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
  const byId = Object.create(null);   /* no prototype, so a recorded id can only ever match the plan (plans/041) */
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

/* Dropping this exercise-session's entry from the legacy map, which is the
   ONE change this file makes to it — the single exception the RIR section
   above names, and all that survives of the chip's writer (plans/035's
   setRir, retired with the chip in plans/036).

   It has to survive: getRir falls back to the map and foldRirMap would put
   the old value straight back on the row on the next load, so without this,
   emptying a box on any session logged before plans/035 does nothing at all
   — the guide's "clear it by emptying the box" would be false for the whole
   of the installed base's history. It is a deletion and not a write, so it
   can only ever drop a value the person just asked to change; the
   alternative — making getRir ignore the map once the rows carry values —
   cannot tell a slot that has been folded from one that has not, and would
   silently re-read every session logged before that release as having no
   RIR at all.

   What did NOT survive is the sweep. setRir cleared every row's `rir`
   before writing, because one chip stood for the whole exercise-session and
   two rows carrying values would have made getRir read the wrong one. With
   a box per set the row a value belongs to is the row it was typed in, and
   the same sweep would wipe the three boxes beside the one being typed in.
   plans/036 is the commit that deletes both halves together, on purpose. */
function dropLegacyRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  if (!slotRir || typeof slotRir !== 'object') return;
  delete slotRir[exId];
  if (!Object.keys(slotRir).length) delete profile.rir[blockId][slot(w, dayId)];
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

/* "60×8" for the set, "60×8 ↓45×5" once it has a drop — the one string
   every band on the card prints. Takes a session's set (sessionsOf), and
   prints it the way it was typed: wLogged and rLogged are the row's own
   strings, so a comma decimal or an lb weight reads back exactly as it sits
   in the boxes. Its drops are already the ones with something in them. */
function setSummary(x) {
  const head = x.wLogged + '×' + (x.rLogged === '' ? '?' : x.rLogged);
  const tail = x.drops.map(d => '↓' + (d.wLogged === '' ? '?' : d.wLogged) + '×' + (d.rLogged === '' ? '?' : d.rLogged));
  return tail.length ? head + ' ' + tail.join(' ') : head;
}

/* A set the weight had to come off to finish is the plainest statement there
   is that the weight was too heavy — so it joins RIR 0 as what makes the
   Diagnóstico read a session as run at failure. It used to veto next
   week's increase in copyPrev as well, and no longer does: copyPrev writes
   the objetivo, and the rule reads the level off the reps done at the
   working weight, which the stripped ones never were. A planned dropset
   says nothing of the sort and is deliberately not counted here.

   Reads a session's sets (sessionsOf), where every set is ticked, its kind
   is `dropKind` and its drops are already the ones with something in
   them. It read stored rows until plans/056, which its one caller — the
   Diagnóstico's rows — fetched again out of the log with a cached
   session's coordinates, a re-read that once crashed the smoke suite
   (plans/045). Changed rather than given a twin for sets: that caller
   lives in this file, so nothing is left to hand it stored rows. */
function forcedDrop(sets) {
  return (sets || []).some(x => x.dropKind === 'forced' && x.drops.length > 0);
}

/* Rows logged past what the current plan shows — kept, but out of sight. */
function parkedRows(profile, blockId, w, dayId, exId, n) {
  const a = profile.log[blockId] && profile.log[blockId][slot(w, dayId)] && profile.log[blockId][slot(w, dayId)][exId];
  return a && a.length > n ? a.slice(n).filter(rowUsed).length : 0;
}

/* The count the plan editor quotes before "borrar registro", so it walks
   exactly what purgeRecord walks for a day or one lift on it: every week
   the day has. It used
   to rebuild keys 1..MAX_WEEKS, and a week filed above the cap was deleted
   by the purge without ever having been counted in the warning. */
function loggedSets(profile, blockId, dayId, exId) {
  let n = 0;
  forEachSlot(profile.log, blockId, (k, w, d, s) => {
    if (s && Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length;
  }, { dayId: dayId });
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

/* Everything logged anywhere in a block — the number that decides whether
   a block is disposable, so it is the number every "¿eliminar?" shows. */
function blockLoggedSets(profile, blockId) {
  return countSets(profile.log[blockId]);
}

/* The card's first band: the latest earlier week of this same session —
   this block, this day, this lift — with a ticked set that has a weight,
   and those sets. A ticked set with no weight is left out of the band; a
   week whose ticked sets all lack one is passed over for the week before.

   'logged' rather than 'plan' because it is exact for any week it is
   handed: the week on screen is never past the block's end (drawApp clamps
   it), so no stranded week comes before it and the two would agree. Deload
   weeks are kept — the band says what happened, not what to aim for. */
function lastTime(profile, blockId, dayId, exId, beforeWeek) {
  const sessions = sessionsOf(profile, {
    weeks: 'logged', lift: { id: exId }, day: dayId,
    blocks: [blockId], before: { block: blockId, week: beforeWeek },
  });
  for (let i = sessions.length - 1; i >= 0; i--) {
    /* A new array of the cached sets, never a trim of the cached one. */
    const sets = sessions[i].sets.filter(x => x.wLogged !== '');
    if (sets.length) return { week: sessions[i].week, sets: sets };
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
   recorded, and a set logged this week is this week's news either way.
   Of two days in the same week, the later one in the plan wins.

   One question per planned slot, by id and day, rather than one `like`
   question for the lift: a tick on this card's own day then leaves every
   one of them in the history cache (a `like` answer over this block would
   be read again after every tick, since the cache cannot rule it out by
   lift — plans/045). The same sets as lastTime: ticked, with a weight. */
function lastTimeOtherDay(profile, block, day, ex, week) {
  const slots = liftSlotsCached(block, ex).filter(s => s.dayId !== day.id);
  if (!slots.length || !profile.log[block.id]) return null;
  let best = null;
  slots.forEach(s => {
    const sessions = sessionsOf(profile, {
      weeks: 'logged', lift: { id: s.exId }, day: s.dayId,
      blocks: [block.id], before: { block: block.id, week: week + 1 },
    });
    for (let i = sessions.length - 1; i >= 0; i--) {
      const x = sessions[i];
      const sets = x.sets.filter(t => t.wLogged !== '');
      if (!sets.length) continue;
      if (!best || x.week > best.week || (x.week === best.week && s.dayIdx > best.dayIdx)) {
        best = { week: x.week, dayId: s.dayId, dayIdx: s.dayIdx, sets: sets };
      }
      break;
    }
  });
  return best;
}

/* ---------- sessions: the one reading of the log ----------
   Every screen that looks back at what was lifted used to turn a slot's
   raw rows into "the sets that count" by hand, and about thirteen of them
   did, each with its own filter, its own idea of which week is the deload,
   which weeks exist and which rows are the same lift. Plan 035 had to find
   every one of them to move a single field (plans/038). This is the one
   reader they move onto: what a session is lives here, and the question a
   screen is asking lives in the query it passes.

   sessionsOf(profile, {
     weeks: 'plan' | 'logged',        required — a block's own weeks, or
                                      every week logged, stranded ones too
     lift: { id } | { like: ex },     by id, or the way liftSlots matches
                                      (id, then name); omitted = every lift
     day, blocks, before: { block, week }, skipDeload,
   })

   A session is every TICKED set of one lift in one slot, parsed, oldest
   first. Which of those sets a screen counts is the screen's business —
   `worked` is here because it is the one definition two screens share,
   not a filter every reader has to accept. Nothing is returned for a slot
   with no ticked set. See CONTEXT.md for the words.

   Reps carry the same two-field shape decision 6 gave weight: `r` is the
   parsed number (`num(row.r)`, NaN when empty) and `rLogged` is the exact
   string the row had — the chart's table prints `rLogged`, not `r`, so a
   comma, a leading zero or a stray character an import left in the field
   (normalizeImportedLog only trims it) still reads back the way it was
   typed. A drop carries the same pair, for the same reason: the card's
   bands print a drop's reps back too (setSummary).

   Answered from the history cache below whenever the log has not moved
   since the same question was last asked, so what comes back is SHARED:
   frozen, and not yours to change. Copy before editing. */
function sessionsOf(profile, q) {
  q = q || {};
  /* No default on purpose: "hide the weeks a shortened block no longer
     has" and "count everything ever lifted" are both right, for different
     screens, and a default is how a screen ends up asking the wrong one
     without anybody deciding it. */
  if (q.weeks !== 'plan' && q.weeks !== 'logged') throw new Error("sessionsOf: weeks must be 'plan' or 'logged'");
  /* A copy: blockOrder grows in place (newBlock pushes onto it), and the
     list a cached answer was read over is part of what it answered. */
  const ids = (q.blocks || (profile && profile.blockOrder) || []).slice();
  return historyRead(profile, q, ids);
}

/* The walk itself, uncached. Only historyRead calls it. */
function readSessions(profile, q, ids) {
  const out = [];
  const liftId = q.lift && q.lift.id;
  const like = q.lift && q.lift.like;
  for (let bi = 0; bi < ids.length; bi++) {
    const bId = ids[bi];
    const block = profile.blocks && profile.blocks[bId];
    const blk = profile.log && profile.log[bId];
    if (!block || !blk) continue;
    const cutoff = q.before && q.before.block === bId ? q.before.week : Infinity;
    const days = block.days || [];
    const dayIdx = {};
    days.forEach((d, i) => { dayIdx[d.id] = i; });
    /* { dayId: { exId: true } } for a `like` query: only the rows this
       block's plan says are the same lift. Retired rows are in the plan,
       so what was logged under them still counts. */
    let match = null;
    if (like) {
      match = {};
      liftSlots(block, like).forEach(s => { (match[s.dayId] = match[s.dayId] || {})[s.exId] = true; });
    }
    forEachSlot(profile.log, bId, (k, w, dayId, s) => {
      if (!s || w >= cutoff) return;
      if (q.weeks === 'plan' && w > blockWeeks(block)) return;
      if (q.skipDeload && deloadAt(block, w)) return;
      const day = days[dayIdx[dayId]];
      const exIds = liftId != null ? [liftId]
        : match ? Object.keys(match[dayId] || {})
        : Object.keys(s);
      exIds.forEach(exId => {
        const rows = Object.prototype.hasOwnProperty.call(s, exId) ? s[exId] : null;
        if (!Array.isArray(rows)) return;
        const sess = readSession(profile, block, w, dayId, exId, rows, day);
        if (!sess) return;
        const exAt = day ? (day.ex || []).findIndex(e => e && e.id === exId) : -1;
        sess.ord = [bi, w, day ? dayIdx[dayId] : 99, exAt >= 0 ? exAt : 999];
        out.push(sess);
      });
    }, q.day != null ? { dayId: q.day } : null);
    /* Nothing after the cut-off point: a later block in the list is later
       in time than the week the question stops at. */
    if (cutoff !== Infinity) break;
  }
  out.sort((x, y) => x.ord[0] - y.ord[0] || x.ord[1] - y.ord[1] || x.ord[2] - y.ord[2] || x.ord[3] - y.ord[3]);
  out.forEach(s => { delete s.ord; });
  return out;
}

/* One slot's rows for one lift, as a session. The RIR a working set
   carries is exactly the reading the rule has always had — sessionRirs
   over the working sets, with the old one-chip value (legacyRir) as the
   fallback when none of them carries its own — so moving the rule onto
   this changes no number it prices. A ticked set that is not a working
   set has no reserve to inherit: it keeps whatever was typed on it. */
function readSession(profile, block, week, dayId, exId, rows, day) {
  const ticked = [];
  rows.forEach((r, i) => { if (r && r.done) ticked.push({ r: r, i: i }); });
  if (!ticked.length) return null;
  const worked = ticked.filter(t => rowWorked(t.r));
  const legacy = rirNumber(legacyRir(profile, block.id, week, dayId, exId));
  const rirs = sessionRirs(worked.map(t => t.r), legacy);
  const rirAt = new Map();
  worked.forEach((t, k) => rirAt.set(t, rirs[k]));
  const ex = day && (day.ex || []).find(e => e && e.id === exId);
  const planned = ex ? setsFor(ex, week, block) : Infinity;
  const stamps = [];
  const sets = ticked.map(t => {
    const r = t.r;
    const unit = rowUnit(r);
    const ts = Number.isFinite(+r.ts) && +r.ts > 0 ? +r.ts : 0;
    if (ts) stamps.push(ts);
    return {
      w: rowWeight(r),
      wLogged: r.w == null ? '' : String(r.w),
      unit: unit,
      r: num(r.r),
      rLogged: r.r == null ? '' : String(r.r),
      rir: rirAt.has(t) ? rirAt.get(t) : rowRir(r),
      /* What was typed on this set and nothing else — no inheritance, no
         legacy chip. `rir` is the reading a screen prices with; this is
         the record, for a screen that counts what was written down. */
      rirOwn: rowRir(r),
      drops: dropsOf(r).filter(dropUsed).map(d => ({
        w: convertWeight(num(d.w), unit, units()),
        wLogged: d.w == null ? '' : String(d.w),
        r: num(d.r),
        rLogged: d.r == null ? '' : String(d.r),
      })),
      dropKind: dropKind(r),
      ts: ts,
      worked: rirAt.has(t),
      extra: t.i >= planned,
    };
  });
  return {
    block: block.id, week: week, day: dayId, lift: exId,
    ts: stamps.length ? median(stamps) : 0,
    sets: sets,
  };
}

/* convertedSetVolume, over a session's own sets instead of a slot's stored
   rows: a session's `w` is already rowWeight(r) — the exact conversion
   convertedSetVolume applies to `r.w` itself — and its drops are already the
   ones dropUsed kept, converted the same way. Summing here is
   convertedSetVolume term for term over the rows the session was built from
   (test/unit.js proves it over random rows, drops and lb included), so every
   walk that used to sum convertedSetVolume over a slot's raw rows can sum
   this over sessionsOf's sessions instead (plans/057). */
function sessionVolume(sets) {
  return sets.reduce((t, s) => {
    const own = (isNaN(s.w) || isNaN(s.r)) ? 0 : s.w * s.r;
    const drops = s.drops.reduce((dt, d) => dt + ((isNaN(d.w) || isNaN(d.r)) ? 0 : d.w * d.r), 0);
    return t + own + drops;
  }, 0);
}

/* ---------- the history cache ----------
   Reading a lift's whole history is ~20 µs a session, and a draw asks for
   it once per card, once per exercise of the block for the brake, and —
   once the card bands move onto sessionsOf (plans/038 PR 6) — twice more
   per card. It is the same answer every time until something is logged,
   so it is kept between draws and dropped by the WRITE, not by the draw:
   a cache the draw has to remember to reset is a stale objetivo the day
   somebody forgets, which is how plans/027 needed a reset at the top of
   diagRows and a page of prose in drawCard to explain why a tick could
   keep the rest (plans/045).

   Three things make an answer stale, and each is caught where it happens:
     - the log, the legacy RIR map or the plan changed: every write that
       persists goes through save(), and save() says so here. That is the
       one path a change cannot skip — one that does is lost on reload,
       which is a bug of its own (see commit()). With no argument the
       change is assumed to reach everything; see logChanged for the two
       narrower claims a caller can make instead.
     - the whole state was swapped (a restore, an import, undo, another
       tab): answers are filed under the profile OBJECT, and a swapped
       state has new ones, so nothing is found for them.
     - the unit: `w` is converted to it, so the answers are filed under it
       too, and a switch starts over.
   The key also carries the block list the query was answered over, so a
   block added to blockOrder is a different question rather than a stale
   answer.

   What comes back is frozen, all the way down, because every caller gets
   the same objects: a reader that wrote onto a session (exHistory used to
   leave an `ord` on each) would change the next reader's answer. Writes to
   a frozen object are silently dropped in these sloppy-mode scripts, so
   the freeze protects the cache; it does not report the caller. */
let logGen = 0;
/* Moves on every change the log has had, however narrow — the render cache
   checks it (see renderLogFresh). */
let logSeq = 0;
const historyCache = new WeakMap();
/* Every array historyRead has filed, so historyDerived can tell a cached
   answer from one somebody built by hand. */
const historyAnswers = new WeakSet();
/* Past this many answers for one profile the lot is dropped: a long
   session paging through weeks asks a new question per week and lift, and
   nothing needs them to outlive a few draws. A draw files about a
   hundred (an uncut answer and its slice per exercise of the block). */
const HISTORY_CACHE_MAX = 2000;

/* What changed, as the caller that wrote it knows it:
     logChanged()       — anything may have: every answer goes. The default,
                          and the only safe one when in doubt.
     logChanged('view') — nothing a session reads: which week, day, block
                          or profile is on screen, a note, the energy
                          chips, the session order, the objetivo record,
                          ex.setup, a preference other than the unit.
     logChanged({ profile, block, week, day, lift })
                        — one lift's rows in one slot, and the legacy RIR
                          entry beside them: what a card's own boxes write.
                          Only the answers whose query can see that slot go
                          (historySees), so the brake and every other card —
                          which stop before the week being trained — keep
                          theirs through a tick.
   A narrower claim than the write is a stale objetivo; a wider one only
   costs a cold read. */
function logChanged(scope) {
  if (scope === 'view') return;
  logSeq++;
  if (!scope || typeof scope !== 'object' || !scope.profile) { logGen++; return; }
  const c = historyCache.get(scope.profile);
  if (!c) return;
  c.map.forEach((e, k) => { if (historySees(e, scope)) c.map.delete(k); });
}

/* Whether a cached answer read the slot a card just wrote — the same walk
   readSessions makes, asked backwards. Anything this cannot rule out
   counts as seen: a `like` query matches by name through the plan, so it
   is never ruled out by the lift. */
function historySees(e, s) {
  const at = e.ids.indexOf(s.block);
  if (at < 0) return false;
  if (e.day != null && e.day !== s.day) return false;
  if (e.liftId != null && s.lift != null && e.liftId !== s.lift) return false;
  if (e.before) {
    const stop = e.ids.indexOf(e.before.block);
    if (stop >= 0 && (at > stop || (at === stop && s.week >= e.before.week))) return false;
  }
  return true;
}

function historyKey(q, ids, before) {
  const lift = !q.lift ? null
    : q.lift.id != null ? ['id', q.lift.id]
    /* The two things sameLift matches on. */
    : q.lift.like ? ['like', q.lift.like.id || '', slugify(q.lift.like.n)]
    : null;
  return JSON.stringify([q.weeks, lift, q.day == null ? null : q.day, ids,
    before ? [before.block, before.week] : null, !!q.skipDeload]);
}

/* A question with a cut-off (`before`) is answered as a slice of the same
   question without one: readSessions returns oldest first, block by block
   and week by week, so "everything before week W of block B" is a prefix
   of "everything up to the end of B". That is what keeps a change of week
   warm — every card's objetivo and the whole brake ask again with the new
   week as their cut-off, and a week is a slice of an answer already held,
   not a walk. Both are filed: the slice keeps its own cut-off, so a tick in
   the week being trained drops the uncut answer (it can see that week) and
   leaves every slice that stops before it. */
function historyRead(profile, q, ids) {
  if (!profile || typeof profile !== 'object') return freezeHistory(readSessions(profile, q, ids));
  const u = state && state.prefs ? state.prefs.units : null;
  let c = historyCache.get(profile);
  if (!c || c.gen !== logGen || c.units !== u || c.map.size >= HISTORY_CACHE_MAX) {
    c = { gen: logGen, units: u, map: new Map() };
    historyCache.set(profile, c);
  }
  /* A cut-off in a block the list does not name cuts nothing (readSessions
     never reaches it), so it is not part of the question either. */
  const stop = q.before ? ids.indexOf(q.before.block) : -1;
  const whole = { weeks: q.weeks, lift: q.lift, day: q.day, skipDeload: q.skipDeload };
  if (stop < 0) return historyEntry(c, whole, ids, null, () => freezeHistory(readSessions(profile, whole, ids)));
  const before = { block: q.before.block, week: q.before.week };
  return historyEntry(c, whole, ids, before, () => {
    const upTo = ids.slice(0, stop + 1);
    const all = historyEntry(c, whole, upTo, null, () => freezeHistory(readSessions(profile, whole, upTo)));
    return Object.freeze(all.filter(x => x.block !== before.block || x.week < before.week));
  });
}

function historyEntry(c, q, ids, before, build) {
  const key = historyKey(q, ids, before);
  let e = c.map.get(key);
  if (!e) {
    e = {
      ids: ids,
      day: q.day == null ? null : q.day,
      liftId: q.lift && q.lift.id != null ? q.lift.id : null,
      before: before,
      value: build(),
    };
    c.map.set(key, e);
    historyAnswers.add(e.value);
  }
  return e.value;
}

/* Room for what a reader builds out of one cached answer and nothing else
   but the key it files it under — exHistory's projection for the rule. It
   lives exactly as long as the answer: a write that drops the answer
   drops this with it, because a fresh read is a different array. Null for
   an array historyRead did not hand out. */
const historyDerivedMaps = new WeakMap();
function historyDerived(sessions) {
  if (!sessions || !historyAnswers.has(sessions)) return null;
  let m = historyDerivedMaps.get(sessions);
  if (!m) { m = new Map(); historyDerivedMaps.set(sessions, m); }
  return m;
}

/* Sessions are plain objects and arrays built fresh by readSession — no
   log row is reachable from one — so this never freezes the log itself.
   Walks the two shapes it is handed (a session's, and ruleSession's, which
   is the same nesting with no drops) rather than recursing into every
   field: a generic recursive freeze added ~40 % to a cold draw, this
   ~8 % (plans/045, Maintenance notes) — the price of every reader
   sharing one answer. */
const NO_DROPS = Object.freeze([]);
function freezeHistory(list) {
  for (let i = 0; i < list.length; i++) {
    const s = list[i], sets = s.sets;
    for (let j = 0; j < sets.length; j++) {
      const x = sets[j];
      /* Most sets have no drops: one shared frozen empty list for all of
         them is one freeze fewer per set. */
      if (x.drops && !x.drops.length) x.drops = NO_DROPS;
      else if (x.drops) { for (let k = 0; k < x.drops.length; k++) Object.freeze(x.drops[k]); Object.freeze(x.drops); }
      Object.freeze(x);
    }
    Object.freeze(sets);
    Object.freeze(s);
  }
  return Object.freeze(list);
}

/* ---------- the rest timer lives in js/rest-timer.js ----------
   These five are everything the rest of the app asks of it: startRest from
   the tick handler; stopRest from there and from drawApp, which stops a
   running rest whenever the session on screen changes (plans/049);
   renderSoundBtn from drawApp too; askForNotifications and keepAliveStop
   from Ajustes. They are stubbed to no-ops when that file is not on the page,
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
   row of every card's "⋯" menu calls it from openExMenu, so an unguarded
   call would throw inside a sheet rather than merely doing nothing.

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
    b.onclick = () => { closeSheet('profileSheet'); state.activeProfile = key; commit('view'); };
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

/* The day and exercise ceilings for a block the app wrote itself: a
   backup, a profile file, a QR "perfil" (normalizeImportedBlock's `own`
   mode). The plan editor stops at IMPORT_LIMITS, counting retired days and
   exercises the way every importer does, so nothing it adds needs more.
   It did not always stop. "+ Añadir día" and "+ Añadir ejercicio" had no
   ceiling at all, a block restructured a few times went past IMPORT_LIMITS
   with its retired days in it, and then its own backup would not restore —
   plans/010's promise, broken by a 15th day. Those blocks are still in
   people's storage and still have to come back, so this path allows twice
   the limit: far past anything retiring and adding by hand grew a block
   to, and still small enough that a crafted "backup" draws. The restore
   path's ceilings stop a hang; they do not police a plan (plans/004).

   `blocks` is the same rule one level up, for the profile those files
   carry (normalizeImportedProfile). "+ Nuevo bloque" and every import stop
   at PROFILE_LIMITS.blocks (blocksFullNote, js/block-editor.js), and they
   did not always stop either: each pasted attempt at an AI-written block
   is a block of its own, nothing kept a profile from passing forty that
   way, and its own backup then refused the 41st. Both halves, because
   neither is the fix alone: the ceiling without this headroom leaves a
   profile already past forty unable to come back from its own backup, and
   the headroom without the ceiling only moves the refusal to the 81st
   block, since nothing would stop the 81st being added. Nor can it be
   unlimited, since this count is what keeps a crafted backup from walking
   ten thousand blocks. Twice is safe because a restore walks a profile
   block by block, so eighty costs twice what forty already could; and a
   profile only ever passed forty by hand, one block at a time, so twice is
   as many again. PROFILE_LIMITS is js/profile-transfer.js's, which loads
   before this file and is in every shell (AGENTS.md). */
const OWN_LIMITS = { days: IMPORT_LIMITS.days * 2, ex: IMPORT_LIMITS.ex * 2, blocks: PROFILE_LIMITS.blocks * 2 };

/* The same headroom for text, in the fields the plan editor never capped:
   an exercise's name, alternative, cue and rep range (`ownMax` in
   EX_FIELDS), and a day's name, its pair note and the block's name. The
   editor stops each of them at its IMPORT_LIMITS length now, so anything
   typed from here on fits every door back in. It did not always stop, and
   the app's own restore cut what it had let you type: a 147-character name
   came back as 120, with another slug, a 450-character cue as 400 and a
   90-character day name as 80 — plans/010's promise broken the way a 15th
   day broke it above. That text is still in people's storage and can be
   any length, so this is one flat bound rather than twice each limit:
   past anything typed by hand, and still small enough that a crafted
   "backup" draws. The fields the app always held to one length — the
   machine settings and the three tags, which the editor and migrate() cap,
   and the phase texts, which no box lets anyone type — keep that length on
   every path. A paste, a QR block and the AI round trip keep IMPORT_LIMITS
   (plans/055). */
const OWN_TEXT_LIMIT = 2000;

function txt(v, max) {
  return String(v == null || isObj(v) ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* An id or a tag is an ordinary string everywhere except as a key into a
   fresh `{}`. Every name `Object.prototype` carries reads back truthy off
   an object that does not own it, so the `if (!m[k]) m[k] = []; m[k].push()`
   pattern skips the initialisation and throws on the `.push` (strengthRows
   and rowsFor, both in js/app.js) — straight to the recovery screen,
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

/* ---------- what a plan exercise may hold ----------
   Every field an exercise in a block can carry, declared once: its
   default, how migrate() repairs a stored one (`repair`), how an imported
   one is taken (`accept`), the IMPORT_LIMITS length the plan editor stops
   its box at (`max`, for text) and the line the AI prompt describes it
   with (`prompt`). Those rules used to be written out separately in
   normalizeImportedBlock, migrate(), the plan editor and the prompt, and
   the copies drifted: the editor capped none of the text the importer
   capped, so the app's own restore cut what the editor had let you type,
   and migrate() never looked at `add`, the text or the flags (plans/055).
   All four read this table now, and test/unit.js fails when the code
   writes an exercise field it does not declare.

   `accept(v, ctx)` is handed the raw value and { own, weeks, n }: whether
   this is the app's own data coming back (normalizeImportedBlock's `own`),
   the block's length, and the exercise's name for a refusal to quote. It
   returns what to keep, or undefined to leave the field out. Only an entry
   marked `rejects` throws, and it throws rather than coerce. A paste is
   cut to `max`; a restore to `ownMax` where an entry has one
   (OWN_TEXT_LIMIT). `repair(ex, weeks)` mends the stored exercise in
   place. The text repairs this table added (the name, the alternative, the
   cue and the rep range) only ever cut a string at its bound, never
   rewrite it, so what the editor stored comes through untouched; the
   machine settings and the tags keep the repair migrate() always gave
   them, which tidies their spacing the way an import does.

   `id` and `n` are identity as well as fields. Which id an exercise ends
   up with, and what a blank name means (a paste is refused over it, a
   restore names it), stay with the code that files the exercise —
   normalizeImportedBlock and migrate() — because they decide where its
   history is kept, not what a value may hold. The table carries the name's
   lengths and both prompt lines.

   Declared in the order an imported exercise has always been written in:
   the importer resolves the id, the name and the rep range before the rest
   (its refusals come in that order, and they name the exercise), writes
   them first, and the others after them in this order. The one exception
   is `reps`, after `sets` and `rest`: migrate() appends a field that is
   missing where its repair reaches it, and it has always filled in those
   three in that order. The prompt lists them in an order of its own,
   EX_PROMPT_ORDER. */

/* The length a text field is held to on this path. */
const exMax = (f, own) => (own && f.ownMax) || f.max;

/* A stored text field as migrate() leaves it: a string is only cut at
   `max`, never rewritten, since its spacing is whoever typed it; anything
   else becomes the text txt() reads it as, '' for an object. */
const storedText = (v, max) => (typeof v === 'string' ? v.slice(0, max) : txt(v, max));

/* An optional one: absent stays absent, text is cut as above, and a value
   that is not text becomes what a restore would make of it — its text
   when it is truthy, and nothing when it is not. */
function repairOptionalText(ex, key, max) {
  const v = ex[key];
  if (v === undefined) return;
  if (typeof v === 'string' || v) ex[key] = storedText(v, max); else delete ex[key];
}

/* A tag, on the way in and on the shelf: trimmed, capped, and dropped
   when it is blank or a name safeKey refuses. */
const acceptTag = (v, max) => (v == null ? undefined : safeKey(txt(v, max)) || undefined);
function repairTag(ex, key, max) {
  if (ex[key] == null) return;
  const t = acceptTag(ex[key], max);
  if (t) ex[key] = t; else delete ex[key];
}

/* A flag is stored as 1, and only when it is set. */
function repairFlag(ex, key) {
  if (ex[key]) ex[key] = 1; else delete ex[key];
}

const EX_FIELDS = Object.freeze([
  /* Identity (above): normalizeImportedBlock and migrate() give every
     exercise one, and the importer holds a stated one to 60 characters. */
  { key: 'id',
    prompt: () => 'string opcional (máx 60 car.) — identificador estable del ejercicio. Si abajo te paso mi bloque actual, conserva el id de cada ejercicio que mantengas, para que su historial siga unido; un ejercicio nuevo puede ir sin id. El mismo ejercicio en dos días lleva el mismo nombre (no repitas el id en dos días: se renombraría)' },
  /* A string once repaired, blank included: the blank name newExercise()
     ships is the empty box the editor shows to type into. */
  { key: 'n', max: IMPORT_LIMITS.exName, ownMax: OWN_TEXT_LIMIT,
    accept(v, ctx) { return txt(v, exMax(this, ctx.own)); },
    repair(ex) { ex.n = storedText(ex.n, this.ownMax); },
    prompt() { return 'string OBLIGATORIO — nombre del ejercicio (máx ' + this.max + ' car.)'; } },
  { key: 'sets', lo: 1, hi: 12, dflt: 3,
    accept(v) { return clampInt(v, this.lo, this.hi, this.dflt); },
    repair(ex) { ex.sets = this.accept(ex.sets); },
    prompt() { return 'número opcional ' + this.lo + '-' + this.hi + ' (por defecto ' + this.dflt + ')'; } },
  { key: 'rest', lo: 0, hi: 900, dflt: 90,
    accept(v) { return clampInt(v, this.lo, this.hi, this.dflt); },
    repair(ex) { ex.rest = this.accept(ex.rest); },
    prompt() { return 'número opcional — segundos de descanso ' + this.lo + '-' + this.hi + ' (por defecto ' + this.dflt + '; usa 0 si el ejercicio va encadenado en superserie)'; } },
  /* Refused on a paste when blank, naming the exercise. Own data gets the
     default instead, the one migrate() has always filled a blank range
     with. */
  { key: 'reps', max: IMPORT_LIMITS.reps, ownMax: OWN_TEXT_LIMIT, dflt: '10–15', rejects: true,
    accept(v, ctx) {
      const reps = txt(v, exMax(this, ctx.own)) || (ctx.own ? this.dflt : '');
      if (!reps) throw new Error('Falta el rango de repeticiones en "' + ctx.n + '".');
      return reps;
    },
    repair(ex) { ex.reps = storedText(ex.reps, this.ownMax) || this.dflt; },
    prompt() { return 'string OBLIGATORIO — rango de reps, p.ej. "8-12" (máx ' + this.max + ' car.)'; } },
  { key: 'alt', max: IMPORT_LIMITS.alt, ownMax: OWN_TEXT_LIMIT,
    accept(v, ctx) { return v ? txt(v, exMax(this, ctx.own)) : undefined; },
    repair(ex) { repairOptionalText(ex, this.key, this.ownMax); },
    prompt() { return 'string opcional — alternativa (máx ' + this.max + ' car.)'; } },
  { key: 'cue', max: IMPORT_LIMITS.cue, ownMax: OWN_TEXT_LIMIT,
    accept(v, ctx) { return v ? txt(v, exMax(this, ctx.own)) : undefined; },
    repair(ex) { repairOptionalText(ex, this.key, this.ownMax); },
    prompt() { return 'string opcional — indicación técnica, para todas las series (máx ' + this.max + ' car.)'; } },
  /* Seat height, pin position, the stuff you discover at the machine and
     that barely changes week to week. A real field for it, so it stops
     getting written into `cue` (which is for technique reminders and shows
     on every set, not settings you check once and forget). Shown collapsed
     in the session and editable inline there — see the .ex-setup render in
     drawApp. One length on every path, a restore included: the editor's
     box, the card's and migrate() have always held it there. */
  { key: 'setup', max: SETUP_LIMIT,
    accept(v) { return v ? txt(v, this.max) : undefined; },
    repair(ex) {
      if (ex.setup == null) return;
      const s = txt(ex.setup, this.max);
      if (s) ex.setup = s; else delete ex.setup;
    },
    prompt() { return 'string opcional — ajustes de la máquina (altura de asiento, posición del respaldo…), no técnica (máx ' + this.max + ' car.)'; } },
  /* One set more from this week on. clampInt would silently round a
     fractional "add" — 2.3 becoming 2 — and a program quietly rewritten
     under someone's feet is worse than a rejected import they can fix and
     retry, so an import refuses it loudly instead, as it refuses a missing
     name or rep range. `inc` is exempt: it is genuinely a decimal (a weight
     step), so it goes through clampNum, which is built for that, not this
     guard. migrate() has no import to refuse, so it drops a stored one
     that is not a whole number of weeks, and holds one past the block's
     end to its last week, as the import does. */
  { key: 'add', rejects: true,
    /* The whole number of weeks `v` says, or 0 when it says none. */
    whole(v) { const n = isObj(v) ? NaN : +v; return Number.isInteger(n) && n >= 1 ? n : 0; },
    accept(v, ctx) {
      if (v == null) return undefined;
      const n = this.whole(v);
      if (!n) throw new Error('El incremento de series ("add") de "' + ctx.n + '" tiene que ser un número entero de al menos 1 (llegó ' + JSON.stringify(v) + ').');
      return clampInt(n, 1, ctx.weeks, 1);
    },
    repair(ex, weeks) {
      if (ex.add == null) return;
      const n = this.whole(ex.add);
      if (n) ex.add = clampInt(n, 1, weeks, 1); else delete ex.add;
    },
    prompt: () => 'número entero opcional 1-weeks — desde esa semana se añade una serie extra (progresión de series; tiene que ser un entero o se rechaza todo el bloque)' },
  /* One step of weight for the objetivo rule; INC_MIN says why these
     bounds. Kept only when it is a step. */
  { key: 'inc',
    accept(v) {
      if (v == null) return undefined;
      const n = clampNum(v, INC_MIN, INC_MAX, 0, INC_STEP);
      return n > 0 ? n : undefined;
    },
    repair(ex) {
      if (ex.inc == null) return;
      const n = this.accept(ex.inc);
      if (n !== undefined) ex.inc = n; else delete ex.inc;
    },
    prompt: () => 'número opcional (en ' + units() + '), admite decimales, ' + INC_MIN + '-' + INC_MAX + ' — el escalón de peso más pequeño que se puede cargar en ese ejercicio: lo que sube el objetivo cuando una serie llega al tope del rango, y el paso que se usa mientras no haya pesos registrados de los que leer la pila real de la máquina. Si falta, se usa el incremento por defecto de los ajustes. Pon uno realista por ejercicio (mancuernas y poleas suelen subir de 1-2,5 en 2,5; prensas y hacks, de 5 en 5)' },
  /* The reserve this lift never goes under, whatever the week's phase text
     asks for: a squat or a Romanian deadlift nobody takes to failure. A
     week prescribing 0–1 RIR on one of those is a number you are not going
     to follow, and a target solved for it is a weight you cannot make.
     Clamped rather than rejected: it is an advisory floor, not a
     program-defining integer like `add`. Absent by default, like the
     flags: only the lifts that never go near failure carry one. See
     weekRir. */
  { key: 'minRir', lo: 0, hi: 5,
    accept(v) {
      if (v == null) return undefined;
      const n = clampInt(v, this.lo, this.hi, 0);
      return n > 0 ? n : undefined;
    },
    repair(ex) {
      if (ex.minRir == null) return;
      const n = this.accept(ex.minRir);
      if (n !== undefined) ex.minRir = n; else delete ex.minRir;
    },
    prompt() { return 'número entero opcional ' + this.lo + '-' + this.hi + ' — el RIR mínimo de ese ejercicio: nunca se le pide menos reserva que esta, aunque la semana pida menos. Ponlo (1) en los ejercicios que no se llevan al fallo — sentadilla, peso muerto rumano, hip thrust pesado — y déjalo fuera en máquinas y aislamiento'; } },
  { key: 'share',
    accept: v => (v ? 1 : undefined),
    repair(ex) { repairFlag(ex, this.key); },
    prompt: () => '1 opcional — marca el ejercicio como estación compartida en pareja ("JUNTOS")' },
  { key: 'ss',
    accept: v => (v ? 1 : undefined),
    repair(ex) { repairFlag(ex, this.key); },
    prompt: () => '1 opcional — marca el ejercicio como parte de una superserie ("SS")' },
  /* The three tags are freeform, same as everywhere else they are set —
     whoever built this block (an agent, a person, another app's export)
     defines their own muscle/pattern/type taxonomy (MUSCLE_SUGGESTIONS says
     why that is not an enum). Only trimmed and length-capped; a blank or
     missing one is left absent rather than rejecting the whole import. One
     length on every path: the editor's boxes and migrate() have always
     held them to it. A stored exercise with no muscle takes the one
     MUSCLE_BY_ID gives its id, the backfill for data saved before the
     field existed. */
  { key: 'muscle', max: MUSCLE_LIMIT,
    accept(v) { return acceptTag(v, this.max); },
    repair(ex) {
      if (!ex.muscle) { if (MUSCLE_BY_ID[ex.id]) ex.muscle = MUSCLE_BY_ID[ex.id]; return; }
      repairTag(ex, this.key, this.max);
    },
    prompt() { return 'string opcional — músculo principal, libre, p.ej. Pecho/Espalda/Hombro/Bíceps/Tríceps/Cuádriceps/Isquios/Glúteo/Gemelos/Core (máx ' + this.max + ' car.)'; } },
  { key: 'pattern', max: PATTERN_LIMIT,
    accept(v) { return acceptTag(v, this.max); },
    repair(ex) { repairTag(ex, this.key, this.max); },
    prompt() { return 'string opcional — patrón de movimiento, libre, p.ej. Empuje horizontal/Empuje vertical/Tirón horizontal/Tirón vertical/Rodilla dominante/Cadera dominante (máx ' + this.max + ' car.)'; } },
  { key: 'type', max: TYPE_LIMIT,
    accept(v) { return acceptTag(v, this.max); },
    repair(ex) { repairTag(ex, this.key, this.max); },
    prompt() { return 'string opcional — tipo de ejercicio, libre, p.ej. Compuesto/Aislamiento (máx ' + this.max + ' car.)'; } },
  /* Retired: "Retirar" in the editor, out of the plan with its history
     kept. Own data only, and never in the prompt. A share drops retired
     items outright (blockSharePlan) so the receiver gets the plan as
     trained, but a restore that resurrected them handed the user back a
     plan they had already edited away from, with no way to tell. */
  { key: 'off',
    accept: (v, ctx) => (ctx.own && v ? 1 : undefined),
    repair(ex) { repairFlag(ex, this.key); } },
].map(f => Object.freeze(f)));

/* One field by name, for the few callers that mean one field in
   particular; everything that means every field loops over the table. */
const exField = key => EX_FIELDS.find(f => f.key === key);

/* The order the AI prompt has always described the fields in: what the
   model needs first — the name, the id and the range — then the numbers,
   the text, the tags and the flags. It is not the order they are stored
   in, and test/unit.js holds it to the table: every field with a prompt
   line is here once, and nothing else is. */
const EX_PROMPT_ORDER = Object.freeze(['n', 'id', 'reps', 'sets', 'rest', 'add', 'inc', 'minRir',
  'alt', 'cue', 'setup', 'muscle', 'pattern', 'type', 'share', 'ss']);

/* An imported exercise, written in the order one always has been: `head`
   — the id, the name and the rep range, which normalizeImportedBlock
   resolves itself before anything else — and then every other field the
   table declares, in the table's order. ctx is { own, weeks, n }. Throws
   where a field `rejects`. */
function acceptExercise(raw, head, ctx) {
  const out = Object.assign({}, head);
  EX_FIELDS.forEach(f => {
    if (!f.accept || Object.prototype.hasOwnProperty.call(out, f.key)) return;
    const v = f.accept(raw[f.key], ctx);
    if (v !== undefined) out[f.key] = v;
  });
  return out;
}

/* migrate()'s share of an exercise, once its id is settled: every field's
   own repair, in the table's order. `weeks` is the block's, already
   repaired. */
function repairExercise(ex, weeks) {
  EX_FIELDS.forEach(f => { if (f.repair) f.repair(ex, weeks); });
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
  const weeks = blockWeeks(block);

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
  prev.onclick = () => { if (profile.week > 1) { profile.week--; commit('view'); } };
  next.onclick = () => { if (profile.week < weeks) { profile.week++; commit('view'); } };

  for (let w = 1; w <= weeks; w++) {
    const b = document.createElement('button');
    b.type = 'button';
    /* deloadAt, not the field alone: a week that only says "Descarga" in
       its own goal is a deload here too (plans/054). */
    const dl = deloadAt(block, w);
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (dl ? ' deload' : '');
    b.textContent = dl ? 'DL' : w;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', w === profile.week ? 'true' : 'false');
    b.setAttribute('aria-label', 'Semana ' + w + (dl ? ', descarga' : ''));
    if (weekHasLog(profile, block, w)) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; commit('view'); };
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
    b.onclick = () => { profile.day = i; commit('view'); };
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
  commit('view');
  const fresh = $('days').querySelectorAll('.day')[to];
  if (fresh) fresh.focus();
});

/* ---------- keeping the keyboard's place across a redraw ----------
   Redrawing anything destroys the control the keyboard was on, even when the
   new markup has the same shape, and focus lands back on <body>: tick a set
   and the next Tab starts from the top of the page. These record
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

/* The bar goes away while a box in the list has the keyboard. iOS has no
   `interactive-widget` viewport segment, so the visual viewport does not
   shrink and a `position: fixed` bar floats on top of the software
   keyboard — which on a phone is exactly where the row being typed into
   is (plans/031 § L8). Delegated on #list, which survives every redraw,
   rather than bound per input on a card that is rebuilt on every tick. */
$('list').addEventListener('focusin', e => {
  if (e.target && e.target.tagName === 'INPUT') $('app').classList.add('kb-open');
});
$('list').addEventListener('focusout', e => {
  if (e.target && e.target.tagName === 'INPUT') $('app').classList.remove('kb-open');
});

/* ---------- main render ----------
   Everything the app draws goes through here, so this is also the one place
   that has to survive bad data: if drawing throws, the recovery screen takes
   over instead of leaving a blank page and an unreachable log. */
/* Persist and redraw, as one word, so a mutation that has to do both cannot
   forget half: without save() the change is on screen and not on disk (plan
   006 fix 1 was that bug, three times over), without render() it is the
   other way round. A navigation-only change still calls render() alone. */
function commit(scope) { save(scope); render(); }

function render() {
  if (!ready) return;
  try {
    drawApp();
  } catch (e) {
    showRecovery(e, readRaw(), 'draw');
  }
}

/* The bar a set has to clear to count as a personal record: the heaviest
   completed weight, and the best estimated 1RM among the sets that can
   honestly carry one — reps present and at or under EST_MAX_REPS, where
   Epley stops drifting. `e` is null until a set with reps has been logged.
   The weight as typed (wLogged), not the converted `w`: the badge is judged
   against the number the row shows, the decision the weight badge already
   made (plans/README.md, third audit item 17). Null for no weighed set. */
function bestOf(sessions) {
  let b = null;
  sessions.forEach(s => s.sets.forEach(x => {
    const w = num(x.wLogged);
    if (isNaN(w)) return;
    if (!b) b = { w: w, e: null };
    else if (w > b.w) b.w = w;
    /* hasReps, on a parsed set: `r` is NaN when the box was empty. */
    if (x.r > 0 && x.r <= EST_MAX_REPS) {
      const e = est1RM(w, x.r);
      if (b.e == null || e > b.e) b.e = e;
    }
  }));
  return b;
}

/* Two bars as one: each half is a max, so the order does not matter. */
function bestJoin(a, b) {
  if (!a || !b) return a || b;
  return { w: Math.max(a.w, b.w), e: a.e == null ? b.e : b.e == null ? a.e : Math.max(a.e, b.e) };
}

/* The best weight ever completed on one exercise, and the best estimated
   1RM alongside it, across every block of the profile — including a
   shortened block's stranded weeks ('logged', plans/008 item 20): a record
   is about the lifter over time. The session being drawn is excluded, or
   its own sets would beat themselves. Returns { [exId]: { w, e } }, or an
   empty map for an exercise with no weighed set; prototype-less, because
   exercise ids arrive from storage and from imports, and `best['__proto__']`
   on a plain {} is not an own property.

   Asked as two questions rather than one, split at the week being drawn,
   because every tick on this card asks again (drawCard): everything before
   that week is a slice the tick cannot reach, so the history cache keeps
   it and the bar made from it (historyDerived); only this block from that
   week on is read again. One question over every block would re-read the
   lift's whole history on every tick. */
function bestForExercise(profile, exId, skipBlockId, skipSlot) {
  const out = Object.create(null);
  const order = profile.blockOrder || [];
  const at = order.indexOf(skipBlockId);
  const skip = parseSlot(skipSlot);
  const lift = { id: exId };
  const drawn = s => s.block === skipBlockId && slot(s.week, s.day) === skipSlot;
  let bar;
  if (at >= 0 && skip) {
    const head = sessionsOf(profile, { weeks: 'logged', lift: lift, before: { block: skipBlockId, week: skip.week } });
    const memo = historyDerived(head);
    let headBar = memo && memo.has('best') ? memo.get('best') : undefined;
    if (headBar === undefined) {
      headBar = bestOf(head);
      if (headBar) Object.freeze(headBar);
      if (memo) memo.set('best', headBar);
    }
    const tail = sessionsOf(profile, { weeks: 'logged', lift: lift, blocks: order.slice(at) })
      .filter(s => (s.block !== skipBlockId || s.week >= skip.week) && !drawn(s));
    bar = bestJoin(headBar, bestOf(tail));
  } else {
    bar = bestOf(sessionsOf(profile, { weeks: 'logged', lift: lift }).filter(s => !drawn(s)));
  }
  if (bar) out[exId] = { w: bar.w, e: bar.e };
  return out;
}

/* What you put on the bar for this set last time round, used as the greyed
   placeholder in the empty weight box. Walks back week by week and falls
   back to the last set of that week when the plan has since grown.

   In the unit on screen, not as typed: the box sits under a units()
   heading and a tick on an empty box adopts this text and stamps it with
   units(), so last week's 100 kg read after a switch to lb was a "100"
   under "lb" and, ticked, 100 lb in the log. Converted with weightText,
   which leaves a weight already in today's unit exactly as it was typed. */
function priorWeight(profile, blockId, w, dayId, exId, idx) {
  for (let k = w - 1; k >= 1; k--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(k, dayId)];
    const rows = s && s[exId];
    if (!Array.isArray(rows) || !rows.length) continue;
    const r = rows[idx] || rows[rows.length - 1];
    if (r && r.w !== '' && r.w != null) return weightText(r.w, rowUnit(r));
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
   block first; within it, the latest week with a ticked set that has a
   weight, and of two days in that week the earlier one in the plan.

   'plan' weeks: a week stranded above the earlier block's end is hidden
   from every screen about that block, and this band names the block. The
   deload is skipped by skipDeload, which is deloadAt — the definition the
   rule uses (exHistory), so the band and the objetivo cannot disagree
   about which week was the deload (a deload written by hand into the
   phase text used to show its ~60 % weights here while the rule ignored
   them).

   Asked one block at a time, newest first, because the band is about the
   block before this one and nearly always stops there: asking for every
   earlier block at once would read the lift's whole history to use one
   block of it. Each block's answer is its own entry in the history cache,
   and none of them can see a tick in the block being trained. */
function priorBlockSets(profile, block, ex) {
  const order = profile.blockOrder || [];
  let at = order.indexOf(block.id);
  if (at < 0) at = order.length;
  for (let b = at - 1; b >= 0; b--) {
    const prev = profile.blocks[order[b]];
    if (!prev) continue;
    const sessions = sessionsOf(profile, { weeks: 'plan', lift: { like: ex }, blocks: [order[b]], skipDeload: true });
    let hit = null;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const x = sessions[i];
      if (hit && x.week !== hit.week) break;
      const sets = x.sets.filter(t => t.wLogged !== '');
      if (sets.length) hit = { block: prev, week: x.week, dayId: x.day, sets: sets };
    }
    if (hit) return hit;
  }
  return null;
}

/* Everything below is asked for the same answer several times inside one
   draw — liftSlots once per card over every card, the objetivo once per
   card and again in every weight box — and held for that draw. Two kinds,
   dropped at two different moments:
     - facts about the PLAN (liftSlots, slug): dropped at the start of the
       next full draw, which every plan change goes through (commit()).
     - facts about the LOG (target, brake): dropped as well the moment the
       log moves (renderLogFresh), so a card redrawn after a tick
       (drawCard) rebuilds them instead of trusting that the tick could not
       have reached them. Rebuilding is cheap because the history they are
       made of is not dropped with them: it lives in the history cache,
       which keeps every answer the tick could not see (logChanged).
   The card's bands (lastTime, lastTimeOtherDay, priorBlockSets) and its
   record bar (bestForExercise) used to be held here too. They read
   sessionsOf now, whose own cache answers them across draws, so a second
   copy per draw would only be one more thing a tick has to empty
   (plans/038 PR 6).

   target and brake are filed under the profile object first (a WeakMap,
   the history cache's own lead — plans/045 — since a profile has no id of
   its own), and only then by block/day/exercise/week. A draw only ever
   reads one profile, so the extra layer buys that draw nothing; what it
   buys is every OTHER caller of targetNow/brakeCached, chiefly the unit
   suite, which builds a fresh defaultState() profile per case and would
   otherwise collide with whichever earlier profile's block also happened
   to be called "block-1" (plans/047). */
let renderCache = null;

function resetRenderCache() {
  renderCache = { liftSlots: Object.create(null), slug: Object.create(null),
                  target: new WeakMap(), brake: new WeakMap(), logSeq: logSeq };
}

/* Whether renderCache may be read for a fact about the log: false when
   there is no draw in progress, and the log-derived maps are emptied first
   when anything has been logged since they were filled. */
function renderLogFresh() {
  if (!renderCache) return false;
  if (renderCache.logSeq !== logSeq) {
    renderCache.target = new WeakMap();
    renderCache.brake = new WeakMap();
    renderCache.logSeq = logSeq;
  }
  return true;
}

/* The brake is a single value per profile/block/week rather than a map over
   everything else, because it is a fact about the whole day; targetFor
   still takes it as an argument, so the rule itself neither reads the clock
   nor the other exercises. It asks every exercise of the block for its
   history, which the history cache answers without a walk once the day has
   been drawn. */
function brakeCached(profile, block, week, now) {
  if (!renderLogFresh()) return brakeOn(profile, block, week, now);
  let m = renderCache.brake.get(profile);
  if (!m) { m = Object.create(null); renderCache.brake.set(profile, m); }
  const k = block.id + '|' + week;
  if (!(k in m)) m[k] = brakeOn(profile, block, week, now);
  return m[k];
}

/* The one entry point the app uses: the brake and the clock filled in, and
   the answer held for the rest of the draw. */
function targetNow(profile, block, day, ex, week) {
  const now = Date.now();
  const dayId = day && day.id;
  if (!renderLogFresh()) return targetFor(profile, block, day, ex, week, now, brakeOn(profile, block, week, now));
  let m = renderCache.target.get(profile);
  if (!m) { m = Object.create(null); renderCache.target.set(profile, m); }
  const k = block.id + '|' + ex.id + '|' + (dayId || '') + '|' + week;
  if (!(k in m)) {
    m[k] = targetFor(profile, block, day, ex, week, now, brakeCached(profile, block, week, now));
  }
  return m[k];
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

/* The session drawApp drew last time, as the string sessionOnScreen(state)
   below returns — null before the first draw, so there is nothing to
   compare against yet and nothing is stopped then. */
let lastSessionOnScreen = null;

/* The profile, block and slot on screen, joined into one key so two draws'
   answers can be compared with !==. Takes `state` rather than reading the
   global so a test can hand it a bare one (defaultState() plus a mutation)
   without going through a draw. drawApp calls this every draw and stops the
   rest timer when the answer changed since the last one (plans/049): eight
   navigation controls used to call stopRest() by hand, one per button, and
   undo and adopting another tab's write changed the session without either
   having a call of its own. The draw is the one place that sees every way
   of leaving a session, this one included. */
function sessionOnScreen(state) {
  const profile = state.profiles[state.activeProfile];
  const block = profile.blocks[profile.activeBlock];
  const days = dayList(block);
  const day = days[profile.day] || days[0];
  return state.activeProfile + '|' + block.id + '|' + slot(profile.week, day.id);
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
  const dl = deloadAt(block, profile.week);
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
  /* Stop a running rest the moment the session it belongs to leaves the
     screen — see sessionOnScreen above. A redraw of the same session (a
     tick's commit(), a sheet closing) compares equal and stops nothing. */
  const onScreen = sessionOnScreen(state);
  if (lastSessionOnScreen !== null && onScreen !== lastSessionOnScreen) stopRest();
  lastSessionOnScreen = onScreen;
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

  const ctx = { profile: profile, block: block, day: day, days: days, sessionEx: sessionEx };
  sessionEx.forEach((ex, i) => list.appendChild(buildExCard(ctx, ex, i)));
  takeFocusMark(list);

  const stranded = weeksBeyondEnd(profile, block);
  $('beyond').textContent = stranded
    ? (stranded === 1
        ? 'Hay 1 serie registrada en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guarda: alarga el bloque en "Editar plan" para volver a verla.'
        : 'Hay ' + stranded + ' series registradas en semanas por encima de las ' + blockWeeks(block) + ' que tiene ahora el bloque. Se guardan: alarga el bloque en "Editar plan" para volver a verlas.')
    : '';
  /* .hidden, not .style.display, on all four notes in this file — see the
     rule at openAsk: they ship with the attribute, and an inline display
     over it left every one permanently [hidden] in the DOM while visibly
     on screen (plans/041). */
  $('beyond').hidden = !stranded;

  drawSessionFoot(profile, block, days);
}

/* ---------- what a card decides ----------
   The three answers below lived as closures inside buildExCard, where the
   unit suite cannot reach: its document is inert and builds no card, so the
   tick's contract — adopt the weight, never the RIR — and which hint wins
   were pinned only in a browser. Each is an answer from its inputs now,
   and the card paints what they say. */

/* The two record flags of every set on a card, against `bar` — the heaviest
   weight ever completed on the lift and its best estimated 1RM, both from
   before this session (bestForExercise), or nothing for a lift never
   weighed.

   `pr` is a ticked set heavier than the bar, or any weighed one when there
   is no bar yet. `prE` is a new best estimated 1RM at a weight already
   lifted: the rep progress double progression is made of, which the weight
   badge cannot see. Only against an existing estimate — the first session
   of an exercise already earns the weight badge, and two badges for one
   first set would devalue both — and never past EST_MAX_REPS, where the
   estimate stops being one. The weight badge wins when both apply, and
   matching the bar is not beating it, for either. */
function recordFlags(bar, rows) {
  return rows.map(r => {
    const pr = !!(r.done && !isNaN(num(r.w)) && (!bar || num(r.w) > bar.w));
    const prE = !pr && !!r.done && !!bar && bar.e != null && hasReps(r) &&
      num(r.r) <= EST_MAX_REPS && !isNaN(num(r.w)) && est1RM(num(r.w), num(r.r)) > bar.e;
    return { pr: pr, prE: prE };
  });
}

/* Every greyed number on a card and where it came from: for each set, the
   weight a tick on its empty box adopts (`hint`), the parenthetical the
   tick's message names it by (`from`) and what its weight and rep boxes
   show (`placeholder`); the set you are about to do (`nextAt`, the first
   not yet ticked); and the rest timer's second line after each set
   (`next`). The inputs are the three places a weight hint can come from —
   the objetivo (`est`, targetNow), your own earlier weeks in this block
   (`own`, priorWeight for each set) and the block before (`prior`,
   priorBlockSets) — and the plan's rep range (`reps`).

   The objetivo wins: the greyed weight is the target's own weight for THIS
   set — one rule, one number — so the box's old contract ("tick without
   typing takes what it shows") adopts the target rather than a copy of
   last week, and "Rellenar" and the objetivo's own line on the card agree
   by construction. Without one, last week. With no earlier week in this
   block either, the previous block's last logged session, same set index,
   last set when the plan has since grown — the fallback priorWeight
   applies within a block — in the unit on screen, like the within-block
   hint and for the same reason (the tick adopts it); the objetivo's weight
   already is, read through rowWeight. The rep box, one column over, asks
   what the objetivo asks of THIS set, and without one — the first session
   of a lift — the plan's own rep range, the only thing there is to ask for.

   One answer read from two places, the box and the "Siguiente" line that
   prices the set you are walking back to: two copies would disagree the
   first time the objetivo's rule moved, and the whole point of the line is
   that it says what the box is about to say. An empty second line under a
   timer reads as something that failed to load, so the last set says so
   instead. `nextAt` is -1 without an objetivo: the boxes are empty then,
   and there is nothing to point at. */
function setHints(rows, est, own, prior, reps) {
  const sets = rows.map((r, si) => {
    const tgt = est && est.sets[si];
    const prv = (!tgt && !own[si] && prior) ? (prior.sets[si] || prior.sets[prior.sets.length - 1]) : null;
    const hint = tgt ? loadText(tgt.w) : (own[si] || (prv ? weightText(prv.wLogged, prv.unit) : ''));
    return {
      hint: hint,
      /* The whole parenthetical rather than a noun the line then glues "lo
         de" in front of: "lo de el objetivo" is not Spanish. */
      from: tgt ? 'lo que pide el objetivo de esta semana'
        : own[si] ? 'lo de la semana anterior'
        : (prv ? 'lo de "' + prior.block.name + '", semana ' + prior.week : ''),
      placeholder: { w: hint || '—', r: tgt && tgt.r ? String(tgt.r) : (reps || '—') },
    };
  });
  return {
    sets: sets,
    nextAt: est ? rows.findIndex(r => !r.done) : -1,
    next: rows.map((r, si) => !rows[si + 1] ? 'Última serie hecha'
      : 'Siguiente: serie ' + (si + 2) +
        (sets[si + 1].hint ? ' · ' + sets[si + 1].hint + ' ' + units() + (reps ? ' × ' + reps : '') : '')),
  };
}

/* What a tick does to its set; writeRows does the rest. Ticking a set whose
   weight box is still empty takes `hint`, the greyed number showing in it
   (setHints). It is the common case, but it is also a guess, so the answer
   is what was adopted ('' for nothing) and the handler says so. The adopted
   weight is a write in the unit on screen like a typed one, so it goes
   through stampForWrite: the rest of the set is converted, not relabelled.

   Only the weight box has this contract. The RIR box's placeholder is what
   the week ASKS for, and a reserve nobody reported is not a measurement
   (plans/035 Step H.4): a blank RIR box stays blank on tick and the set
   reads as a floor, which is what it always did. The rep box has never
   adopted either — an unreported rep count would go straight into the
   objetivo's arithmetic.

   `now` is the caller's clock, so the unit suite can pin the rule without
   one. An untick keeps the time the set was done at. */
function tickRow(r, hint, now) {
  let adopted = '';
  if (!r.done) {
    if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; stampForWrite(r, r); }
    r.ts = now;
  }
  r.done = !r.done;
  return adopted;
}

/* One exercise's card, built detached and handed back for the caller to put
   in place: drawApp appends all of them, drawCard swaps one out. `ctx` is
   everything that is the same for every card in the day, and the two
   callers build it the same way. They used to differ in how they arrived
   at the record bar — one walk of the whole profile for the day's cards, one
   exercise for a tick — until each card asked for its own through the
   history cache (bestForExercise). */
function buildExCard(ctx, ex, i) {
  const profile = ctx.profile, block = ctx.block, day = ctx.day;
  const sessionEx = ctx.sessionEx;
  const n = setsFor(ex, profile.week, block);
  const rows = entry(profile, block.id, profile.week, day.id, ex.id, n);
  /* What every box on this card writes, and all it writes: this lift's rows
     in this one slot (and dropLegacyRir, the legacy entry beside them).
     Handed to save() so the history cache keeps every answer that stops
     before this week — the brake's and every other card's (logChanged).
     Taken now, at build, because it describes these rows; the week on
     screen can only change through a full draw, which builds a new card. */
  const here = { profile: profile, block: block.id, week: profile.week, day: day.id, lift: ex.id };
  const parked = parkedRows(profile, block.id, profile.week, day.id, ex.id, n);
  const allDone = rows.every(r => r.done);

  /* `bar`, not `prior`: this same function already declares `const prior`
     for the previous block's sets (plans/018), and two consts of one name
     in one scope is the parse failure that leaves every returning phone on
     "Cargando…" (AGENTS.md). "The bar a set has to clear" is the phrase the
     comment above bestOf already uses. */
  const bar = bestForExercise(profile, ex.id, block.id, slot(profile.week, day.id))[ex.id];
  const flags = recordFlags(bar, rows);
  const cardPr = flags.some(f => f.pr);
  const cardPrE = !cardPr && flags.some(f => f.prE);

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

  const prev = lastTime(profile, block.id, day.id, ex.id, profile.week);
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
  const prior = (!prev && !other) ? priorBlockSets(profile, block, ex) : null;
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
  /* `est` is only drawn here. Recording it is writeRows's job, on the write
     that starts the session — see recordTargetOnStart for why a draw must
     never do it. */
  /* What every write on this card hands writeRows, built once like `here`
     and for the same reason. Not `card`, writeRows's name for it: that is
     this card's element, above. */
  const cardCtx = { profile: profile, block: block, day: day, ex: ex, rows: rows, here: here, est: est };
  const moreOpen = expandedMore.has(setupKey(block, ex));

  /* One mono line where three stacked blocks used to be: the sets × reps,
     the rest, and a preview of the machine settings so you can read them
     without opening anything. Same 28-character truncation the ⚙ button's
     own label used, and for the same reason — it is a preview, not the
     field. Recomputed rather than stamped once, because the field that
     feeds its last third sits two lines below it in the fold: typing there
     does not redraw the card, and a preview showing the seat height you
     just changed away from is worse than no preview. */
  const restTxt = ex.rest
    ? 'desc. ' + (ex.rest >= 60 ? (ex.rest / 60).toFixed(ex.rest % 60 ? 1 : 0).replace('.0', '') + ' min' : ex.rest + 's')
    : 'superserie →';
  const metaText = () => n + ' × ' + ex.reps + ' · ' + restTxt +
    (ex.setup ? ' · ' + (ex.setup.length > 28 ? ex.setup.slice(0, 28) + '…' : ex.setup) : '');

  card.innerHTML =
    '<div class="ex-head">' +
      /* The position, and nothing to operate: aria-hidden because the two
         controls that move the card — the "⋯" menu's own rows — say
         "puesto N" in their labels already, and a bare number read out
         ahead of every exercise name is noise. */
      '<span class="ex-pos" aria-hidden="true">' + (i + 1) + '</span>' +
      '<button type="button" class="ex-name-btn" aria-expanded="' + (moreOpen ? 'true' : 'false') + '">' +
        '<span class="ex-name"></span>' +
        /* Outside the clamped name, not inside it: -webkit-line-clamp
           counts the badges' own line, so a name that fills both lines
           took JUNTOS and RÉCORD away with the third. The badge is the
           point of the badge. */
        '<span class="ex-badges"></span>' +
        /* The chevron closes the plan line. Beside the name it reserved a
           column and pushed two of the seed's seven day-1 names onto a
           second line, and a second bare glyph next to the ⋯ read as
           clutter rather than as a control. Its own span rather than inside
           .ex-meta, whose textContent is rewritten on every draw. */
        '<span class="ex-meta-row">' +
          '<span class="ex-meta"></span>' +
          '<span class="chev" aria-hidden="true">▾</span>' +
        '</span>' +
      '</button>' +
      '<button type="button" class="ex-menu-btn">⋯</button>' +
    '</div>' +
    '<div class="ex-more"' + (moreOpen ? '' : ' hidden') + '>' +
      (ex.alt ? '<div class="ex-alt"></div>' : '') +
      (ex.cue ? '<div class="ex-cue"></div>' : '') +
      '<label class="ex-setup-lbl">Ajustes de máquina' +
        '<input type="text" class="ex-setup-in" maxlength="' + SETUP_LIMIT + '" autocomplete="off" placeholder="asiento 4, respaldo 2…">' +
      '</label>' +
    '</div>' + prevTxt +
    '<div class="sets"></div>' +
    (decay ? '<div class="ex-decay"></div>' : '') +
    (est ? '<div class="ex-est ' + (est.dir || 'flat') + '"><span class="ex-est-l"></span>' +
      '<span class="ex-est-c ' + est.conf + '"></span>' +
      targetNotes(est).map(() => '<span class="ex-est-n"></span>').join('') + '</div>' : '') +
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

  const metaEl = card.querySelector('.ex-meta');
  metaEl.textContent = metaText();

  const nameEl = card.querySelector('.ex-name');
  nameEl.appendChild(document.createTextNode(ex.n));
  /* Still the first child of .ex-name, which is how five smoke cases across
     two sections read an exercise's name off a card — the badges are what
     moved out. */
  const badgeEl = card.querySelector('.ex-badges');
  if (!soloMode()) {
    const s = document.createElement('span');
    s.className = 'badge ' + (ex.share ? 'together' : 'solo');
    s.textContent = ex.share ? 'JUNTOS' : 'SOLO';
    badgeEl.appendChild(s);
  }
  if (ex.ss) { const s = document.createElement('span'); s.className = 'ss'; s.textContent = 'SS'; badgeEl.appendChild(s); }
  if (cardPr) { const s = document.createElement('span'); s.className = 'badge pr'; s.textContent = 'RÉCORD'; badgeEl.appendChild(s); }
  else if (cardPrE) { const s = document.createElement('span'); s.className = 'badge pr-e1rm'; s.textContent = 'RÉCORD 1RM'; badgeEl.appendChild(s); }
  if (ex.alt) card.querySelector('.ex-alt').textContent = ex.alt;
  if (ex.cue) card.querySelector('.ex-cue').textContent = ex.cue;

  /* The name IS the disclosure: everything a card used to print under it —
     the alternative, the amber cue, the machine settings — is one tap away
     instead of 117px of head read once per block (plans/031 § "The
     numbers", plans/036). Flipped in place rather than through drawCard:
     nothing else on the card depends on it, and a redraw here would throw
     away a half-typed weight two rows down for no gain. `expandedMore` is
     written too, so a later redraw (a tick, a drop) comes back open. */
  const nameBtn = card.querySelector('.ex-name-btn');
  const moreBox = card.querySelector('.ex-more');
  nameBtn.onclick = () => {
    const open = moreBox.hidden;
    moreBox.hidden = !open;
    nameBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) expandedMore.add(setupKey(block, ex));
    else expandedMore.delete(setupKey(block, ex));
  };

  const menuBtn = card.querySelector('.ex-menu-btn');
  const menuLabel = 'Más sobre ' + ex.n + ': progreso, mover, ajustes de máquina';
  menuBtn.setAttribute('aria-label', menuLabel);
  menuBtn.title = menuLabel;
  menuBtn.onclick = () => openExMenu(ctx, ex, i);

  /* `ex.setup` — seat height, pin position: a plan field, not a log field,
     so editing it here writes straight to the live exercise, the same way
     the plan editor's own text fields do. It lives in the fold because it
     rarely changes and isn't what you came to read mid-set; the head's
     mono line previews it so you don't have to open the fold just to
     check. Always built, open or not: the fold is one `hidden` attribute,
     so there is no draw between the tap and the field being there. */
  const setupIn = card.querySelector('.ex-setup-in');
  setupIn.value = ex.setup || '';
  /* Names the exercise, where the visible label cannot: seven cards in a
     session would otherwise offer seven fields called "Ajustes de
     máquina". It still starts with the visible text (SC 2.5.3). */
  setupIn.setAttribute('aria-label', 'Ajustes de máquina de ' + ex.n);
  setupIn.oninput = e => {
    const v = e.target.value;
    if (v) ex.setup = v; else delete ex.setup;
    metaEl.textContent = metaText();
    /* A plan field, but not one a session reads. */
    save('view');
  };
  /* Marked, not focused, and only when the "⋯" menu's own row is what
     opened it. Focusing on every draw was a workaround for render()
     rebuilding the card on every set tick; it also meant that leaving a
     settings box open and moving to another day popped the keyboard up for
     a field nobody had asked for. */
  if (focusSetup === ex.id) setupIn.dataset.focusMark = '1';

  /* The week's own reserve, greyed into every RIR box the way the
     objetivo's weight is greyed into the weight box. phaseRir first rather
     than weekRir alone: weekRir answers 0 for a phase with no number in it
     (a deload, or a week somebody wrote in their own words), and a box
     that quietly says "0" is telling you to go to failure. No number in
     the phase, no placeholder. */
  const wkRir = phaseRir(block, profile.week) == null
    ? null : weekRir(block, ex, profile.week, null);

  const box = card.querySelector('.sets');
  /* One column line for the card instead of a unit glued inside every box
     and a rep label beside it — three headings read once, and the boxes
     under them are free to be numbers and nothing else. aria-hidden
     because each box states its own column in its label. */
  const setHead = document.createElement('div');
  setHead.className = 'set-head';
  setHead.setAttribute('aria-hidden', 'true');
  setHead.innerHTML = '<span>' + esc(units()) + '</span><span>rep</span><span>RIR</span><span></span><span></span>';
  box.appendChild(setHead);

  const hints = setHints(rows, est,
    rows.map((r, si) => priorWeight(profile, block.id, profile.week, day.id, ex.id, si)), prior, ex.reps);

  rows.forEach((r, si) => {
    if (r.done) {
      stat.tonnage += setVolume(r);
      if (r.ts > stat.lastTs) stat.lastTs = r.ts;
    }

    const row = document.createElement('div');
    row.className = 'set-row' + (r.done ? ' done' : '') + (si === hints.nextAt ? ' next' : '') +
      (flags[si].pr ? ' pr' : '') + (flags[si].prE ? ' pr-e1rm' : '');
    /* No set number: four rows in a column ARE first, second, third,
       fourth, and a 26px column spent saying so was 26px the boxes did not
       have (plans/031 § "The numbers", plans/036). The labels still say
       which set each box belongs to, which is where it was ever needed.

       text + inputmode rather than type=number: a Spanish keyboard sends a
       comma, and type=number throws the whole value away when it sees one,
       so "22,5" silently became an empty box. */
    const drops = dropsOf(r);
    row.innerHTML =
      '<input type="text" class="w-in" inputmode="decimal" autocomplete="off" enterkeyhint="next">' +
      '<input type="text" class="r-in" inputmode="numeric" autocomplete="off" enterkeyhint="next">' +
      '<input type="text" class="rir-in" inputmode="numeric" autocomplete="off" enterkeyhint="done" maxlength="1">' +
      '<button type="button" class="drop-add' + (drops.length ? ' on' : '') + '"' +
        (drops.length >= MAX_DROPS ? ' disabled' : '') + '>↓</button>' +
      '<button type="button" class="tick' + (r.done ? ' on' : '') + '" aria-pressed="' + (r.done ? 'true' : 'false') + '">✓</button>';

    const [wIn, rIn, rirIn] = row.querySelectorAll('input');
    const { hint, from: hintFrom, placeholder } = hints.sets[si];
    wIn.value = r.w; rIn.value = r.r;
    rirIn.value = r.rir == null ? '' : r.rir;
    wIn.placeholder = placeholder.w;
    rIn.placeholder = placeholder.r;
    rirIn.placeholder = wkRir == null ? '—' : String(wkRir);
    wIn.setAttribute('aria-label', 'Peso, serie ' + (si + 1) + ' de ' + ex.n);
    rIn.setAttribute('aria-label', 'Repeticiones, serie ' + (si + 1) + ' de ' + ex.n);
    rirIn.setAttribute('aria-label', 'RIR, serie ' + (si + 1) + ' de ' + ex.n);
    /* Every weight box of this set, with the object it writes: when a write
       in today's unit converts the rest of the set (stampForWrite), the
       boxes still showing the old numbers are refilled in place rather than
       by a redraw, which would take the cursor out of the box being typed in. */
    const weightBoxes = [{ el: wIn, o: r }];
    const refreshWeights = fresh => weightBoxes.forEach(b => {
      if (b.o !== fresh) b.el.value = b.o.w == null ? '' : b.o.w;
    });
    /* Every box that can put something in the set, and the tick, write
       through writeRows: it owns the order a write follows, and why. */
    wIn.oninput = e => {
      writeRows(cardCtx, () => {
        r.w = e.target.value.replace(/[^0-9.,]/g, ''); if (r.w !== e.target.value) e.target.value = r.w;
        if (stampForWrite(r, r)) refreshWeights(r);
      });
    };
    rIn.oninput = e => {
      writeRows(cardCtx, () => {
        r.r = e.target.value.replace(/[^0-9]/g, ''); if (r.r !== e.target.value) e.target.value = r.r;
      });
    };
    /* One digit, 0-5, and the box refuses anything else rather than
       storing it and hoping a reader copes — the fourth place that spells
       RIR_MAX's range out as a literal, for the same reason as the other
       three (rowRir, rirNumber, normalizeImportedLog): a regex is what is
       needed here and building one from the constant would be the harder
       thing to read. Raising RIR_MAX means editing all four. */
    rirIn.oninput = e => {
      writeRows(cardCtx, () => {
        const v = e.target.value.replace(/[^0-5]/g, '').slice(0, 1);
        if (v !== e.target.value) e.target.value = v;
        if (v) r.rir = v; else delete r.rir;
        dropLegacyRir(profile, block.id, profile.week, day.id, ex.id);
      });
    };

    const tick = row.querySelector('.tick');
    tick.setAttribute('aria-label', (r.done ? 'Desmarcar' : 'Marcar') + ' serie ' + (si + 1) + ' de ' + ex.n);
    tick.onclick = () => {
      let adopted = '';
      writeRows(cardCtx, () => { adopted = tickRow(r, hint, Date.now()); });
      if (r.done && ex.rest) startRest(ex.rest, ex.n + ' · serie ' + (si + 1), hints.next[si]);
      if (r.done && !ex.rest) stopRest();
      /* The tick that finishes the whole day counts as a session — see
         maybeNagBackup. dayCards holds every card's rows by live reference,
         so this reads true only once every row across every exercise is
         done — including the cards this redraw is not going to touch. */
      if (r.done && dayCards.every(c => c.rows.every(rr => rr.done))) {
        state.prefs.sessionsSinceBackup++;
        maybeNagBackup();
      }
      drawCard(ex.id);
      if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (' + hintFrom + ') — cámbialo si no fue eso');
    };

    /* ↓ adds a segment rather than opening a panel: there is nothing to
       configure before you have one, and mid-set — rest timer running,
       hand on the stack — one tap and a cursor in the weight box is the
       whole interaction. The segments are the panel.

       It, the ✕ on a segment and the kind chips save their slot directly
       rather than through writeRows: adding an empty segment, taking one
       away or picking a kind never makes a set used that was not — rowUsed
       counts neither an empty segment nor `dk` — so none of the three can
       start a session, and there is no objetivo for them to keep. */
    const dropAdd = row.querySelector('.drop-add');
    dropAdd.setAttribute('aria-label', drops.length >= MAX_DROPS
      ? 'Máximo de bajadas de peso alcanzado en la serie ' + (si + 1) + ' de ' + ex.n
      : 'Añadir bajada de peso a la serie ' + (si + 1) + ' de ' + ex.n);
    dropAdd.onclick = () => {
      if (dropsOf(r).length >= MAX_DROPS) return;
      if (!Array.isArray(r.d)) r.d = [];
      r.d.push({ w: '', r: '' });
      focusDrop = ex.id + '#' + si + '#' + (r.d.length - 1);
      save(here); drawCard(ex.id);
    };
    box.appendChild(row);

    drops.forEach((d, di) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return;
      const dRow = document.createElement('div');
      dRow.className = 'drop-row' + (r.done ? ' done' : '');
      /* The same five columns as the set above it, so the weight and rep
         boxes line up with the ones they came off — that alignment is what
         makes the pair read as one set at a glance. The ↳ went with the
         set number; what marks the sub-row now is its shorter boxes and
         the rule down the left. The third column is empty on purpose: a
         drop is part of the set's reserve, not a reserve of its own. */
      dRow.innerHTML =
        '<input type="text" class="w-in" inputmode="decimal" autocomplete="off" enterkeyhint="next">' +
        '<input type="text" class="r-in" inputmode="numeric" autocomplete="off" enterkeyhint="next">' +
        '<span></span>' +
        '<span></span>' +
        '<button type="button" class="drop-x">✕</button>';

      const [dwIn, drIn] = dRow.querySelectorAll('input');
      dwIn.value = d.w == null ? '' : d.w;
      drIn.value = d.r == null ? '' : d.r;
      dwIn.placeholder = '—';
      weightBoxes.push({ el: dwIn, o: d });
      drIn.placeholder = '—';
      const where = 'bajada ' + (di + 1) + ', serie ' + (si + 1) + ' de ' + ex.n;
      dwIn.setAttribute('aria-label', 'Peso tras bajar, ' + where);
      drIn.setAttribute('aria-label', 'Repeticiones tras bajar, ' + where);
      /* A typed drop makes the set used too, so a session can start here:
         through writeRows like the set's own boxes. */
      dwIn.oninput = e => {
        writeRows(cardCtx, () => {
          d.w = e.target.value.replace(/[^0-9.,]/g, ''); if (d.w !== e.target.value) e.target.value = d.w;
          if (stampForWrite(r, d)) refreshWeights(d);
        });
      };
      drIn.oninput = e => {
        writeRows(cardCtx, () => {
          d.r = e.target.value.replace(/[^0-9]/g, ''); if (d.r !== e.target.value) e.target.value = d.r;
        });
      };

      const del = dRow.querySelector('.drop-x');
      del.setAttribute('aria-label', 'Quitar ' + where);
      del.onclick = () => {
        r.d.splice(di, 1);
        /* No segments left means no kind to remember either — the row goes
           back to being exactly the {w,r,done,ts} it started as. */
        if (!r.d.length) { delete r.d; delete r.dk; }
        save(here); drawCard(ex.id);
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
        b.onclick = () => { r.dk = k; save(here); drawCard(ex.id); };
        kindRow.appendChild(b);
      });
      box.appendChild(kindRow);
    }
  });

  return card;
}

/* The five things a card used to draw for itself. Four of them — the two
   order arrows, "Progreso ↗" and the ⚙ settings line — cost 117 px of head
   on every card of every session to save one tap on the few days anybody
   reaches for them (plans/031 § "The numbers", plans/036). One sheet,
   shared by every card and rewired on each open, rather than a sheet per
   card: seven cards' worth of menu markup on screen is seven times the
   nodes for one thing at a time.

   `ctx` is the card's own draw context, so nothing here re-derives the
   profile, the block or the day the card was built from. */
function openExMenu(ctx, ex, i) {
  const profile = ctx.profile, block = ctx.block, day = ctx.day, sessionEx = ctx.sessionEx;
  $('exMenuT').textContent = ex.n;

  const up = $('exMenuUp'), down = $('exMenuDown');
  const first = i === 0, last = i === sessionEx.length - 1;
  /* Rendered and disabled at the ends, never hidden: a menu whose rows
     move depending on where in the session you are is one you have to read
     every time instead of reaching for. The label says the destination,
     because "arriba" means nothing once the arrows are gone. */
  up.disabled = first;
  down.disabled = last;
  up.textContent = first ? 'Ya es el primero de la sesión' : 'Hiciste este antes: al puesto ' + i;
  down.textContent = last ? 'Ya es el último de la sesión' : 'Hiciste este después: al puesto ' + (i + 2);

  $('exMenuChart').onclick = () => { closeSheet('exMenuSheet'); openChart(ex, day.id); };

  const move = dir => {
    closeSheet('exMenuSheet');
    if (!moveSessionEx(profile, block, profile.week, day, ex.id, dir)) return;
    /* The session order only: sessions keep the plan's order. */
    commit('view');
    /* render() has just rebuilt every card, so the "⋯" the menu was opened
       from no longer exists and closeSheet handed focus to a detached
       node. Put it on the same button of the card where it landed — the
       same thing the week and day buttons do after a move. */
    const at = dayCards.findIndex(c => c.ex.id === ex.id);
    const fresh = at >= 0 && dayCards[at].el.querySelector('.ex-menu-btn');
    if (fresh) fresh.focus();
  };
  up.onclick = () => move(-1);
  down.onclick = () => move(1);

  $('exMenuSetup').onclick = () => {
    closeSheet('exMenuSheet');
    expandedMore.add(setupKey(block, ex));
    focusSetup = ex.id;
    drawCard(ex.id);
  };

  /* js/calculator.js is a split file, so `openCalc` can be missing from a
     shell with a precache hole — a guarded call, not a bare one (AGENTS.md
     rule (a)). A row that does nothing is the cost; a card that throws
     mid-session is not. */
  $('exMenuCalc').onclick = () => {
    closeSheet('exMenuSheet');
    if (typeof openCalc === 'function') openCalc();
  };

  openSheet('exMenuSheet');
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
    /* The draw's cache is kept, not thrown away — but nothing here has to
       argue that a tick cannot reach it any more (plans/045). What the draw
       holds about the log (the objetivo, the brake) is dropped by the
       tick's own save() before this runs (renderLogFresh), and rebuilt —
       with the bands and the record bar, which the draw no longer holds —
       from the history cache, which the same save() emptied of exactly the
       answers that could see the ticked slot and nothing else
       (logChanged). What is kept is what a tick cannot touch by
       construction: liftSlots and slug, facts about the plan.

       Resetting here undid what plans/008 item 14 bought, and would again:
       the rebuilt card asks targetNow, targetNow asks for the day's brake,
       and brakeOn asks every exercise of every live day for its history —
       answered from the history cache, which a reset of this one does not
       empty, but the plan facts would be rebuilt for no reason. Anything
       that changes which cards exist or which week is shown goes through
       render() → drawApp(), which does reset. */
    if (!renderCache) resetRenderCache();
    const profile = getProfile();
    const block = getBlock();
    const days = dayList(block);
    const day = days[profile.day];
    const sessionEx = orderedEx(profile, block, profile.week, day);
    /* A different exercise at this index means the plan moved; same answer. */
    if (!sessionEx[i] || sessionEx[i].id !== exId) { render(); return; }
    const ctx = { profile: profile, block: block, day: day, days: days, sessionEx: sessionEx };
    const at = focusPathIn(old);
    const fresh = buildExCard(ctx, sessionEx[i], i);
    old.replaceWith(fresh);
    /* A box this press created outranks putting the keyboard back where it
       was — creating it is what the press was for. */
    if (focusDrop || focusSetup) takeFocusMark(fresh);
    else if (at) applyFocusPath(fresh, at);
    drawSessionFoot(profile, block, days);
    refreshWeekDot(profile, block);
    drawDeloadCheck(profile, block);
  } catch (e) {
    showRecovery(e, readRaw(), 'draw');
  }
}

/* Where the session after this one is, said once every set is ticked. The
   last day of a week wraps to the first day of the next — and used to wrap
   past the last week too, so the final session of an eight-week block
   promised a "semana 9" the week bar has no button for. Past the block's
   end there is no week to name: the next block in blockOrder, which is the
   picker's order and the order "+ Nuevo bloque" appends in, or the button
   that makes one when there is none. Takes the week being drawn, which
   drawApp has already pulled back inside the block. */
function nextSessionLine(profile, block, days) {
  if (profile.day < days.length - 1) return 'Siguiente: ' + days[profile.day + 1].name + '.';
  if (profile.week < blockWeeks(block)) return 'Siguiente: ' + days[0].name + ', semana ' + (profile.week + 1) + '.';
  const order = profile.blockOrder || [];
  const at = order.indexOf(block.id);
  const nextId = at >= 0 ? order[at + 1] : undefined;
  if (!nextId || !profile.blocks[nextId]) return 'Fin del bloque: crea el siguiente con "+ Nuevo bloque", en Plan.';
  /* A block with every day retired has no first day to name; drawApp
     brings one back when it is opened, so the block alone is enough. */
  const first = dayList(profile.blocks[nextId])[0];
  return 'Fin del bloque. Siguiente: ' + (first ? first.name + ', ' : '') +
    'semana 1 de "' + blockPickerLabel(profile, nextId) + '".';
}

/* The progress bar and the line under the session are sums over the cards,
   not over the log: each card recorded its own contribution as it was built,
   so this costs one pass over dayCards whether it follows a full draw or a
   single card being swapped. */
function drawSessionFoot(profile, block, days) {
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
    ? 'Sesión completa — ' + total + ' series registradas. ' + nextSessionLine(profile, block, days)
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
  host.hidden = !changed;
  if (!changed) return;
  const txtEl = document.createElement('span');
  txtEl.textContent = 'Orden cambiado: empezaste por ' + sessionEx[0].n + '.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ord-reset';
  btn.textContent = 'Volver al orden del plan';
  btn.onclick = () => {
    setOrder(profile, block.id, profile.week, day.id, null);
    commit('view');
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
      save('view');
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
    save('view');
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

/* ---------- best e1RM per exercise per week ----------
   Both of these are the Diagnóstico's (its strength index and frequency
   view read them) and lived in js/diagnostics.js, but deloadCheck below
   reads strengthByExercise on every draw, and a symbol app.js reads stays
   in app.js (AGENTS.md rule 1). Loaded without that file — a precache
   hole — the week after a mid-block deload threw a ReferenceError inside
   the draw and landed on the recovery screen. Not stubbed: an empty answer
   here would draw no deload check at all and look like there was nothing
   to compare. */

/* Every exercise the block has ever carried, retired ones included, mapped
   to its muscle. Retired exercises are excluded from the *plan* side of the
   frequency view (plannedMuscleDays, below) — they are not scheduled any
   more — but the sessions they were logged in still happened, and
   dropping them would invent gaps that were not there. */
function muscleOfBlock(block) {
  const map = {};
  (block.days || []).forEach(day => {
    (day.ex || []).forEach(ex => { map[ex.id] = muscleTag(ex); });
  });
  return map;
}

/* Best estimated 1RM per exercise per week of this block, as
   { exId: [w1, w2, …] } with null for a week it was not logged. A muscle
   trained on two days in the same week keeps the better of the two — the
   week's best, same rule the progress chart uses within a session. */
function strengthByExercise(profile, block) {
  const muscleOf = muscleOfBlock(block);
  const weeks = blockWeeks(block);
  const out = {};
  /* The block's own weeks, and the deload week KEPT: this is the series
     the chart draws, and those sets happened. It is strengthRows, below,
     that refuses to measure to or from it — and deloadCheck, further down,
     reads the weeks either side of it straight out of this. */
  sessionsOf(profile, { weeks: 'plan', blocks: [block.id] }).forEach(sess => {
    const exId = sess.lift, w = sess.week;
    if (!muscleOf[exId]) return;
    /* Same rep ceiling as the trend: past it Epley is inventing a number
       rather than reading one, and one 20-rep back-off set would move a
       muscle's whole index. Each set's weight is already converted to the
       unit on screen, so a row logged in the other unit is not blended in
       raw — see rowWeight(). */
    const done = sess.sets.filter(x => x.worked && x.r <= EST_MAX_REPS);
    if (!done.length) return;
    let best = 0;
    done.forEach(x => { const v = est1RM(x.w, x.r); if (v > best) best = v; });
    if (!out[exId]) out[exId] = new Array(weeks).fill(null);
    if (out[exId][w - 1] == null || best > out[exId][w - 1]) out[exId][w - 1] = best;
  });
  return out;
}

/* ---------- the Diagnóstico's rows ----------
   What the Diagnóstico reads off the log — the trend per exercise and the
   matrix that turns it into a verdict, frequency per muscle and the
   strength index — lived in js/diagnostics.js with the sheet that draws
   it. But the block review (js/review.js) is built on six of these names:
   diagRows, freqRows, strengthRows, DIAG_TRENDS, DIAG_WINDOW and diagPct.
   A symbol another split file reads stays in app.js outright (AGENTS.md
   rule 2), so they are here, with everything they are built from. Loaded
   without js/diagnostics.js — a precache hole — "+ Nuevo bloque → Ver la
   revisión" threw "strengthRows is not defined" and the block was never
   made. Not stubbed: an empty answer would hand the next block a review
   that says nothing happened. The sheet, its toggles, the calendar and the
   index chart stay in js/diagnostics.js. */

/* How many of an exercise's most recent sessions the slope is fitted over.
   Six is roughly a block: long enough that one bad night doesn't set the
   verdict, short enough that a plateau you broke two months ago isn't still
   being counted against you. */
const DIAG_WINDOW = 6;
/* Two flat weeks is noise, not a stall — hold the verdict until there are
   three sessions to draw a line through. */
const DIAG_MIN_SESSIONS = 3;
/* Per session, as a fraction of the exercise's own average e1RM — a
   percentage, because ±1 kg means something different on a 30 kg lateral
   raise and a 180 kg leg press. Anything inside the band is flat. */
const DIAG_FLAT = 0.005;
/* Above this, a "stall" is an attendance record, not a programming
   problem — see the matrix. */
const DIAG_GAP_DAYS = 7;
/* The same idea for the work axis, and it needs its own number. e1RM moves
   in kilos and DIAG_FLAT is drawn for that; kilos per set move in REPS,
   and one rep out of ten is a 10 % session all by itself. Half a percent
   would fire this on ordinary wobble. One and a half sits above the noise
   a ±1 rep session puts through a six-point fit and well below the ~10 %
   per session a set genuinely walking up its rep range puts up. */
const DIAG_WORK_FLAT = 0.015;

const DIAG_TRENDS = {
  down: { label: 'bajando', plural: 'bajando', rank: 0 },
  flat: { label: 'plano', plural: 'planos', rank: 1 },
  up: { label: 'subiendo', plural: 'subiendo', rank: 2 },
  none: { label: 'sin datos', plural: 'sin datos', rank: 3 },
};

/* One point per session, oldest first: what the signals and the work axis
   read off each session of a row. The sessions are handed in, and they are
   the objetivo's own — liftHistory's, from the same call the row's trend is
   fitted on (diagRows) — so this chooses nothing. Which weeks (stranded
   ones included), which blocks, which day of a lift the plan splits, the
   deload and the rename are the objetivo's decisions, made once, in
   liftHistory. This used to make its own: the block's weeks only, both
   days of a split lift, every block in the list, no rename, and no session
   whose working sets all ran past EST_MAX_REPS. So a row could read
   "6 sesiones" over a trend fitted on four, and the verdict's signals came
   from sessions the trend had never seen (plans/056).

   Nothing here reads an Epley estimate any more, so nothing needs that
   ceiling: the trend is the objetivo's level, which reads a set past twelve
   reps as a floor and never as a measurement, and one 20-rep back-off set
   cannot fake a line through it.

   A point keeps what the diagnosis needs and a session does not say
   outright: the kilos it moved and its working sets, the RIR of every
   working set, and the latest tick, so a gap between sessions can be told
   from a gap in progress. `ticked` is every set it ticked, in order, for
   the two signals that read more than the working sets. */
function diagPoints(sessions) {
  return sessions.map(sess => {
    /* Working sets, the session's own flag: ticked, with a weight and a
       rep count. Each set's weight is already converted to the unit on
       screen (rowWeight() on the way in), so a row logged in the other
       unit is not blended into this line raw — the session view stays
       exempt on purpose; this is a screen that fits one line through many
       of them, which the session view is not. */
    const worked = sess.sets.filter(x => x.worked);
    return {
      /* The work side of the session, and it counts every working set. The
         sum is convertedSetVolume() term for term — the set, then each drop
         with something in it, an empty box adding nothing — read off the
         session's already-converted numbers. */
      vol: worked.reduce((t, x) => t + (x.w * x.r + x.drops.reduce((u, d) =>
        u + ((isNaN(d.w) || isNaN(d.r)) ? 0 : d.w * d.r), 0)), 0),
      sets: worked.length,
      /* The LATEST tick, not the session date: the gap between sessions
         has always been measured from the last set of each. */
      ts: sess.sets.reduce((t, x) => (x.ts > t ? x.ts : t), 0),
      /* Per set since plans/044, and the array is the reader's own:
         readSession (plans/038) builds it with sessionRirs over the working
         sets, the legacy map as the fallback since plans/039 — the same
         array the objetivo prices from. One number per session hid the
         difference between a session paced 3 → 2 → 1 → 0 and one ground
         out at 0 throughout. */
      rirs: worked.map(x => x.rir),
      /* The session's own sets, for forcedDrop and repDecay, which used to
         be handed stored rows fetched again from the log: the same sets,
         read off the same answer as everything else on the row (plans/056). */
      ticked: sess.sets,
    };
  });
}

/* ---------- frequency, from the timestamps already on every row ----------
   Every ticked set carries `r.ts` and nothing read it except one line in
   the session footer. It answers the question that otherwise eats a whole
   block: at three days a week, one skipped session quietly moves chest
   from every ~3,5 days to every ~7, and a lift that stalls on that spacing
   has an attendance record behind it, not a programming problem.

   Which is why this lives in the same sheet as the trend rather than a
   screen of its own — a stall and a nine-day gap have to be read together
   or the wrong thing gets changed. */

/* The sessions in which a muscle was actually trained, as one local day
   each, oldest first. A session is a logged day-slot with at least one
   ticked set of an exercise tagged to that muscle; its date is the first
   set ticked in it, which is when you were in the gym. */
function muscleSessions(profile, block, upToWeek) {
  const muscleOf = muscleOfBlock(block);
  const out = {};
  /* One slot at a time: a muscle trained by three lifts on the same day is
     one visit to the gym, not three. The block's own weeks — stranded ones
     stay hidden, as everywhere else on this screen — and the deload kept:
     turning up for it is attendance. */
  const bySlot = new Map();
  sessionsOf(profile, { weeks: 'plan', blocks: [block.id] }).forEach(sess => {
    if (sess.week < 1 || sess.week > upToWeek) return;
    const k = slot(sess.week, sess.day);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(sess);
  });
  bySlot.forEach(list => {
    const firstTs = {};
    list.forEach(sess => {
      const tag = muscleOf[sess.lift];
      if (!tag) return;
      sess.sets.forEach(x => {
        if (!(x.ts > 0)) return;
        if (!firstTs[tag] || x.ts < firstTs[tag]) firstTs[tag] = x.ts;
      });
    });
    Object.keys(firstTs).forEach(tag => {
      if (!out[tag]) out[tag] = [];
      out[tag].push(firstTs[tag]);
    });
  });
  Object.keys(out).forEach(tag => out[tag].sort((a, b) => a - b));
  return out;
}

/* Median gap in days between consecutive sessions. Median because one
   holiday in the middle of a block would drag a mean past every threshold
   and label an otherwise well-attended muscle an attendance problem. */
function medianGapDays(stamps) {
  if (!stamps || stamps.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) gaps.push((stamps[i] - stamps[i - 1]) / 86400000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/* How often the plan says to train each muscle: the live days that carry at
   least one exercise for it. Retired exercises are not counted — the plan
   as it stands is what adherence is measured against. */
function plannedMuscleDays(block) {
  const out = {};
  blockTagsFor('muscle', block).forEach(t => { out[t] = 0; });
  dayList(block).forEach(day => {
    const tags = {};
    exList(day).forEach(ex => { tags[muscleTag(ex)] = 1; });
    Object.keys(tags).forEach(t => { out[t] = (out[t] || 0) + 1; });
  });
  return out;
}

/* One row per muscle: how often the plan asks for it, how often you
   actually got there, and the spacing that came out of it. Sorted by the
   thing worth acting on — the widest gaps first. */
function freqRows(profile, block, upToWeek) {
  const planned = plannedMuscleDays(block);
  const sessions = muscleSessions(profile, block, upToWeek);
  const rows = Object.keys(planned).map(tag => {
    const stamps = sessions[tag] || [];
    const plannedTotal = planned[tag] * upToWeek;
    return {
      tag: tag,
      perWeek: planned[tag],
      planned: plannedTotal,
      done: stamps.length,
      adherence: plannedTotal ? stamps.length / plannedTotal : null,
      gap: medianGapDays(stamps),
      priority: isPriority(block, tag),
      last: stamps.length ? stamps[stamps.length - 1] : 0,
    };
  });
  /* Worst attendance first, and "never got there at all" is the worst of
     all — sorting by gap alone would file a muscle with zero sessions
     below one you trained every week, since it has no gaps to measure. */
  return rows.sort((a, b) =>
    (a.adherence == null ? 1 : a.adherence) - (b.adherence == null ? 1 : b.adherence) ||
    (b.gap == null ? -1 : b.gap) - (a.gap == null ? -1 : a.gap) ||
    a.tag.localeCompare(b.tag, 'es'));
}

/* ---------- strength index per muscle ----------
   A per-exercise chart fragments every time you change a machine, and over
   a year of blocks you will. "Pecho +8 % en 8 semanas" is the sentence
   actually being looked for, and it is much closer to "my chest grew" than
   any single machine's number.

   Two decisions make it survive a swap:

   1. It indexes to a baseline week rather than plotting kilos. Different
      exercises carry wildly different absolute loads, and a leg press
      would drown an extension in any average of raw weight.
   2. Each week is compared to the baseline over the exercises present in
      BOTH — matched pairs. Averaging whatever was logged that week instead
      would turn every swapped machine into a cliff, which is exactly the
      artefact this view exists to remove.

   The average is of each exercise's own ratio, not a ratio of averages: an
   exercise counts once regardless of what it loads, which is the same
   reason the index is a ratio in the first place. */

/* One indexed series per muscle. The baseline is the first week that muscle
   has anything logged in — usually week 1, but a log that starts late gets
   a baseline it can actually use instead of an empty chart. */
function strengthRows(profile, block) {
  const muscleOf = muscleOfBlock(block);
  const byEx = strengthByExercise(profile, block);
  const weeks = blockWeeks(block);
  const byMuscle = {};
  Object.keys(byEx).forEach(exId => {
    const tag = muscleOf[exId];
    if (!byMuscle[tag]) byMuscle[tag] = [];
    byMuscle[tag].push(byEx[exId]);
  });

  /* A deload week is lighter on purpose. Its sets are real and stay on the
     chart, but it can be neither end of the comparison: measuring to it
     would report a planned ~40 % back-off as a strength loss, which is the
     same artefact the volume view already refuses to draw. deloadAt, the
     objetivo's reading, so a week the phase text calls "Descarga" is out
     of the comparison too, not only the one the deload field names
     (plans/038). */
  const usable = w => !deloadAt(block, w + 1);

  return Object.keys(byMuscle).map(tag => {
    const series = byMuscle[tag];
    let base = -1;
    for (let w = 0; w < weeks && base < 0; w++) {
      if (usable(w) && series.some(s => s[w] != null)) base = w;
    }
    const index = new Array(weeks).fill(null);
    const matched = new Array(weeks).fill(0);
    if (base >= 0) {
      for (let w = base; w < weeks; w++) {
        const ratios = [];
        series.forEach(s => {
          if (s[base] != null && s[w] != null && s[base] > 0) ratios.push(s[w] / s[base]);
        });
        if (!ratios.length) continue;
        index[w] = 100 * ratios.reduce((t, v) => t + v, 0) / ratios.length;
        matched[w] = ratios.length;
      }
    }
    let lastWeek = -1;
    for (let w = weeks - 1; w >= 0 && lastWeek < 0; w--) if (usable(w) && index[w] != null) lastWeek = w;
    return {
      tag: tag,
      index: index,
      matched: matched,
      base: base,
      lastWeek: lastWeek,
      exercises: series.length,
      change: lastWeek > base ? index[lastWeek] - 100 : null,
      priority: isPriority(block, tag),
    };
  }).sort((a, b) =>
    (a.change == null ? 1 : 0) - (b.change == null ? 1 : 0) ||
    (a.change || 0) - (b.change || 0) ||
    a.tag.localeCompare(b.tag, 'es'));
}

/* Least squares over the window, expressed as a fraction of the series'
   own mean so the number is comparable between a lateral raise and a leg
   press — and, now that two things are fitted, between kilos and kilos per
   set, which do not share a unit either. */
function fitSlope(values) {
  const n = values.length;
  const mx = (n - 1) / 2;
  const my = values.reduce((t, v) => t + v, 0) / n;
  let cov = 0, varx = 0;
  values.forEach((v, i) => { cov += (i - mx) * (v - my); varx += (i - mx) * (i - mx); });
  const slope = varx ? cov / varx : 0;
  return my ? slope / my : 0;
}

/* The trend the objetivo rule itself sees, rather than a second reading of
   the same log with a different definition of "how strong is this today".

   The line used to be fitted through the best e1RM of every session, and
   that number disagrees with the target rule in public: a session that
   ended 15/15/15 at the top of its range is a FLOOR under the capacity,
   not a measurement of it, so reading it as one reported the pec deck as
   "pierde fuerza" and the shoulder press, the incline press and the
   Romanian deadlift as "planos" while the card right next to them was
   putting the weight up. Fitted through the rule's own level instead —
   the best of the last three sessions, which a censored session can only
   raise — and handed straight to the rule's own verdict when it has
   already confirmed a drop. One log, one definition, one answer.

   Takes the rule's projection of the row's sessions (liftHistory's `rule`)
   rather than asking for it: diagRows hands the same history to the rest
   of the row, which is what keeps the two from being two histories
   (plans/056). */
function diagLevelTrend(sessions) {
  if (!sessions.length) return null;
  const seq = capSeq(sessions).slice(-DIAG_WINDOW);
  const lv = levelOf(seq);
  const series = seq.map((x, i) => levelOf(seq.slice(0, i + 1)).level);
  return {
    pct: fitSlope(series), confirmed: lv.confirmed, hold: lv.hold,
    change: series[0] > 0 ? (series[series.length - 1] - series[0]) / series[0] : null,
  };
}

/* Kilos per set, not kilos. The claim the verdict makes is about what a
   set is worth, and a block that adds a fourth set has not made the first
   three any harder — raw tonnage would report that as progress. */
const diagWorkSlope = points => fitSlope(points.map(p => p.vol / p.sets));

/* Median rather than mean: one three-week holiday in the middle of a block
   would drag an average past the threshold and label a perfectly attended
   exercise an attendance problem. */
function diagMedianGap(points) {
  const stamps = points.map(p => p.ts).filter(t => t > 0).sort((a, b) => a - b);
  if (stamps.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) gaps.push((stamps[i] - stamps[i - 1]) / 86400000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/* The matrix. Trend on its own is the left-hand column; the reading and the
   change come from crossing it with what the log says about HOW those
   sessions went. Checked in the order the rows are written, so the
   most specific signal wins: a stall with a forced drop behind it is a
   fatigue problem even if the RIR also read 2+ three weeks ago. */
function diagVerdict(trend, sig) {
  if (trend === 'down') {
    if (sig.gap > DIAG_GAP_DAYS) {
      return { lectura: 'Asistencia, no programa — ' + Math.round(sig.gap) + ' días entre sesiones de media',
               cambio: 'Nada que tocar en el plan: entrénalo más seguido y vuelve a mirar.' };
    }
    return { lectura: 'Pierde fuerza de verdad',
             cambio: 'Si varios ejercicios bajan a la vez, el plan no es el problema: mira el descanso y lo que comes (eso la app no lo ve).' };
  }
  if (trend === 'flat') {
    if (sig.estDown) {
      return { lectura: 'Peso mal elegido — el objetivo de esta semana está por debajo de lo que estás cargando',
               cambio: 'Baja al objetivo que marca la ficha y sube el rango de reps como es debido.' };
    }
    if (sig.failure) {
      return { lectura: 'Fatiga, no falta de esfuerzo',
               cambio: 'Mismo peso, vuelve a 1–2 RIR. Apretar más es la palanca equivocada aquí.' };
    }
    if (sig.decay) {
      return { lectura: 'Primera serie al fallo — las de después se vacían',
               cambio: 'Empieza más ligero para que las series 2 y 3 sumen volumen de verdad.' };
    }
    if (sig.easy) {
      return { lectura: 'Falta intensidad — RIR 2+ repetido',
               cambio: 'Sube carga o reps: te estás dejando el estímulo sin usar.' };
    }
    /* The row the top-set metric cannot see, and the reason the work axis
       is here at all. The trend reads one set of a session — the level,
       off its first — and throws the rest away, so 45×12/8/6 and
       45×12/12/11 are the same point on it: nine more reps of work.
       That is series 2 and 3 catching up, which is progress, and calling
       it a stall sends you to fix a lift that is fixing itself.

       Last of the flat rows on purpose: every signal above it is a reason
       the extra kilos are not good news. A forced drop adds work too —
       setVolume() counts the reps after the weight came off, as it
       should — and `failure` has already claimed that session two rows
       up, which is why the work reading needs no rule of its own for it. */
    if (sig.workPct > DIAG_WORK_FLAT) {
      return { lectura: 'La serie tope está clavada, pero el trabajo sube — ' + diagPct(sig.workPct) +
                 ' de kilos por serie cada sesión',
               cambio: 'Las series de después se están poniendo al día. Déjalo correr: cuando dejen de sumar, entonces sí es un estancamiento.' };
    }
    /* The same axis pointing the other way, and it has to be said or the
       row below it lies: "neither one is moving" is false when the kilos
       are moving downwards. A top set that holds while the session's work
       drains away is fatigue arriving across the session rather than
       within it — which is why `decay`, the within-session version of the
       same story, is checked further up and wins when both fire. */
    if (sig.workPct < -DIAG_WORK_FLAT) {
      return { lectura: 'La serie tope aguanta, pero el trabajo cae — ' + diagPct(sig.workPct) +
                 ' de kilos por serie cada sesión',
               cambio: 'Se te vacían las series de después. Empieza más ligero, o quita una serie y haz enteras las que queden.' };
    }
    /* Flat on both axes is a stronger statement than flat on one, and it
       is the one case here that has actually been measured rather than
       merely not detected — so it gets said, instead of being filed under
       "no clear signal" with the sessions nobody marked an RIR on. */
    if (sig.workPct != null) {
      return { lectura: 'Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
               cambio: 'No hay progreso escondido en las series de después: haz lo que mande el objetivo de la semana, y si lleva medio bloque igual, cambia el ejercicio.' };
    }
    return { lectura: 'Estancado, sin una señal clara en el registro',
             cambio: 'Apunta el RIR de cada serie unas semanas: sin eso no se puede distinguir fatiga de falta de intensidad.' };
  }
  if (trend === 'up') {
    /* The row that stops this screen contradicting the session's own
       target. targetFor() already holds the weight when the last session
       came in under the level, or when three exercises fell at once — and
       until now the diagnosis read that same exercise as "Funciona · No
       toques nada". Two screens, one log, opposite instructions.

       It is not a stall: the reps really did climb. It is a rise bought
       with effort rather than with load, which is what a calibration week
       that started too heavy looks like three weeks later — you spend the
       block earning your way to the top of the range at 0 RIR instead of
       at the RIR the plan asked for. Checked before the volume row: what
       to do about this week's weight beats where to spend spare sets. */
    if (sig.held) {
      return { lectura: 'Sube, pero la ficha no sube el peso esta semana — ' +
                 (sig.held === 'brake' ? 'hay varios ejercicios bajando a la vez' : 'la última sesión cayó por debajo del nivel'),
               cambio: sig.held === 'brake'
                 ? 'Mira sueño, comida y fatiga antes que el plan. Repite la sesión a ' + sig.heldRir + ' RIR y vuelve a mirarlo la semana que viene.'
                 : 'Mismo peso, ejecutado a ' + sig.heldRir + ' RIR. Si las reps vuelven, sube; si vuelve a caer, el nivel se ajusta solo.' };
    }
    /* The one row of the matrix that needs the volume side: growing on
       fewer sets than the range asks for is not a problem, it is unused
       margin — and the muscle you said the block was for is where to
       spend it. */
    /* sig.volTag is an imported muscle tag, and this sentence is exported
       verbatim into the review's AI document, so it is delimited here
       rather than parsed back out of the verdict text in js/review.js. */
    if (sig.volLow) {
      return { lectura: 'Funciona, y con margen: ' + reviewName(sig.volTag) + ' se queda por debajo de la franja de series' +
                 (sig.volPriority ? ', siendo prioritario' : ''),
               cambio: 'Va bien con pocas series. Si quieres más, añádeselas a ' + reviewName(sig.volTag) + ' antes que a nada.' };
    }
    return { lectura: 'Funciona', cambio: 'No toques nada.' };
  }
  return { lectura: 'Aún no hay suficientes sesiones',
           cambio: 'Hacen falta ' + DIAG_MIN_SESSIONS + ' sesiones con peso y reps anotados.' };
}

/* The session's typical reserve: the median of its sets' RIR, or null when
   no set carries one. The median and not the last set, because a session
   that ends at failure on purpose after three sets with reserve is not a
   session at failure; and not the mean, because one 0 among 3s should not
   drag an easy session halfway to "hard". A log typed the old way — one
   value on the last set — arrives already spread over every set by the
   inheritance rule, so its median is that value and the screen reads it
   as it always did (plans/044). */
function diagSessionRir(rirs) {
  const typed = (rirs || []).filter(v => v != null);
  return typed.length ? median(typed) : null;
}

/* One row per exercise of the live plan, and one per day for a lift the
   plan puts on two. The verdict is computed over the window; the signals
   are read off the most recent sessions, since what you change on Monday
   answers to how last Monday went. */
function diagRows(profile, block, scope) {
  /* No reset of the render cache here any more (plans/045). It used to be
     the only thing between this sheet and a trend read from before the last
     tick, because its history entries include the week being trained and
     a tick kept the cache. The history cache is dropped by the tick's own
     save() now, and the render cache's log facts with it, so reopening the
     sheet after a tick reads the tick, and reopening it after nothing
     reads what the last draw already read. */
  /* The caller's to say: the sheet passes its own toggle (drawDiag), and
     the block review passes 'block', because what it exports must not
     depend on whatever the Diagnóstico sheet happened to be showing last.
     Left out, it is this block — never the toggle read from here, which
     would tie the review's rows to the sheet's state. */
  const useScope = scope || 'block';
  const scopeBlockId = useScope === 'all' ? '' : block.id;
  const rows = [];
  const seen = new Set();
  /* Volume as actually logged, not as prescribed: "you have room to add
     sets" is a claim about the sets you did. Computed once for the whole
     block and looked up per exercise by its muscle tag. */
  const volByTag = {};
  volumeTrendRows('log', profile, block, 'muscle').forEach(r => { volByTag[r.label] = r; });
  /* How many live days carry each lift. On two, it is two rows: the
     objetivo keeps the two days' histories apart inside the block
     (liftHistory), so each day has its own count, signals and trend, and a
     row that folded them read a lift climbing on Monday and falling on
     Thursday as one "Funciona" (plans/056). */
  const liveDays = {};
  dayList(block).forEach(day => {
    new Set(exList(day).map(e => e.id)).forEach(id => { liveDays[id] = (liveDays[id] || 0) + 1; });
  });
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      /* The same id twice on one day is still one row. */
      const key = JSON.stringify([ex.id, day.id]);
      if (seen.has(key)) return;
      seen.add(key);
      /* The one history every part of the row reads — the count and the
         three-session gate, the gap, the three signals, the work axis and
         the trend: the objetivo's own sessions, and the rule's projection
         of each (liftHistory). MAX_WEEKS + 1 is every week, the one being
         trained included. Through the history cache like every other
         reader, so reopening the sheet with nothing logged since asks for
         nothing new, and a tick drops what it could change. */
      const hist = liftHistory(profile, block, ex, day.id, MAX_WEEKS + 1, scopeBlockId);
      const points = diagPoints(hist.sessions.slice(-DIAG_WINDOW));
      const est = targetNow(profile, block, day, ex, profile.week);
      const last = points[points.length - 1];
      const recent = points.slice(-3);
      const sig = {
        /* The session's typical set (diagSessionRir — the median of the
           per-set reserves, since plans/044), not its last set: a lifter
           who paces 3 → 2 → 1 → 0 has not run the session at failure, and
           one who holds three sets at 3 has not trained hard because the
           fourth went to 0. A typed '3' still counts as the old '2+' chip
           did and a typed '0' as the old '0' (rirNumber, plans/035). */
        easy: recent.filter(p => diagSessionRir(p.rirs) >= 2).length >= 2,
        failure: !!last && (diagSessionRir(last.rirs) === 0 || forcedDrop(last.ticked)),
        /* A first set the lifter typed as two or more in reserve did not go
           to failure, so the drop after it is not "primera serie al fallo"
           and this signal stands down: the verdict falls through to the
           work-axis rows below, which is where a session that drains
           without a hard first set belongs. Its own value only — `rirOwn`,
           not `rir`: an inherited reserve says nothing about the first
           set. repDecay needs two sets with reps, so there is a first. */
        decay: !!last && repDecay(last.ticked) >= 3 && !(decayRows(last.ticked)[0].rirOwn >= 2),
        /* A stall reset is also `down`, but it is not "the weight was
           picked wrong" — it is the target rule's own answer to the
           stall this screen is about to name, so it reads as the stall,
           not as a mis-chosen weight. A deload is `down` too, and it is
           neither: the rule lowered the load because the week asked it
           to, and reading that as a mis-chosen weight told every flat
           exercise to drop to its deload load for good. */
        estDown: !!est && est.kind === 'objetivo' && est.dir === 'down',
        /* Not a fourth reading of the log: the target rule has already
           crossed the level with this week's sessions and come back with
           "hold today" or with the whole day braked. Reading its answer
           rather than re-deriving it is what keeps the two screens saying
           the same thing. */
        held: est && est.brake ? 'brake' : est && est.hold ? 'hold' : null,
        heldRir: est ? est.rirWeek : null,
        conf: est ? est.conf : null,
        gap: diagMedianGap(points),
      };
      /* Withheld unless the set count held still across the whole window.
         Per-set already takes the count out of the total, but not out of
         the average: a fourth set is a tired set, so adding one lowers
         kilos per set and dropping one raises it. Refusing to read it then
         costs a true flag rather than inventing a false one, which is the
         direction to be wrong in. The kilos check is the divide's guard:
         every session the objetivo reads has a working set, and every
         working set a positive weight and a positive rep count, today —
         this is what keeps that a fact rather than an assumption. */
      if (points.length >= DIAG_MIN_SESSIONS &&
          points.every(p => p.sets === points[0].sets && p.vol > 0)) {
        sig.workPct = diagWorkSlope(points);
      }
      const vol = volByTag[muscleTag(ex)];
      if (vol && vol.label !== UNCLASSIFIED_LABEL) {
        sig.volTag = vol.label;
        sig.volPriority = vol.priority;
        sig.volLow = vol.zone === 'under' || vol.zone === 'maint';
      }
      let trend = 'none', pct = 0, change = null;
      /* Gated on the row's own sessions, which are the trend's: the
         verdict text promises "N sesiones con peso y reps anotados", and
         the N it prints is the number the level was fitted on. */
      const lvt = points.length >= DIAG_MIN_SESSIONS ? diagLevelTrend(hist.rule) : null;
      if (lvt) {
        pct = lvt.pct;
        /* A confirmed decline is the rule's own verdict and outranks the
           fitted line: two sessions in a row under the level is the thing
           the line is trying to detect, already detected. */
        trend = lvt.confirmed ? 'down' : pct >= DIAG_FLAT ? 'up' : pct <= -DIAG_FLAT ? 'down' : 'flat';
        change = lvt.change;
      }
      rows.push(Object.assign({
        id: ex.id, name: ex.n,
        /* What the sheet calls the row: a lift on two days says which day
           it is, with the tag the card's second band uses (dayTag). */
        label: liveDays[ex.id] > 1 ? ex.n + ' · ' + dayTag(block, day.id) : ex.n,
        day: day.name, dayId: day.id, sessions: points.length,
        trend: trend, pct: pct, change: change, est: est, gap: sig.gap,
      }, diagVerdict(trend, sig)));
    });
  });
  /* Worst first: the point of the screen is what needs changing, not a
     league table of what is going well. */
  return rows.sort((a, b) =>
    DIAG_TRENDS[a.trend].rank - DIAG_TRENDS[b.trend].rank ||
    a.pct - b.pct ||
    a.name.localeCompare(b.name, 'es'));
}

const diagPct = v => (v > 0 ? '+' : v < 0 ? '−' : '') +
  String(Math.abs(Math.round(v * 1000) / 10)).replace('.', ',') + ' %';

/* ---------- did the deload work? ----------
   Nothing checked whether the week after a deload actually came back up,
   which is the only evidence there is about whether your deloads are the
   right length. One comparison per deload span (CONTEXT.md, "deload
   span"), on matched pairs so a swapped exercise cannot fake it: the week
   before the span against the week after it — the same arithmetic as a
   single deload week, since a one-week span's before/after are exactly
   dl-1/dl+1, so this reads identically to before wherever a block's only
   deload is still the field. A span with nothing on one side of it (the
   block starts or ends on it) has nothing to compare and is left out. */
function deloadCheck(profile, block) {
  const weeks = blockWeeks(block);
  const byEx = strengthByExercise(profile, block);
  const out = [];
  deloadSpans(block).forEach(span => {
    const before = span.start - 1, after = span.end + 1;
    if (before < 1 || after > weeks) return;
    const ratios = [];
    Object.keys(byEx).forEach(exId => {
      const a = byEx[exId][before - 1], b = byEx[exId][after - 1];
      if (a > 0 && b > 0) ratios.push(b / a);
    });
    if (!ratios.length) return;
    const change = 100 * (ratios.reduce((t, v) => t + v, 0) / ratios.length - 1);
    out.push({ before: before, after: after, deload: span.start, deloadEnd: span.end, n: ratios.length, change: change });
  });
  return out;
}

function drawDeloadCheck(profile, block) {
  const el = $('deloadCheck');
  /* The week test before the comparison rather than after it: deloadCheck
     walks every logged set of the block, drawCard calls this after every
     tick, and on any week that is not right after a deload span the only
     thing that walk can produce is the hidden attribute. */
  if (!deloadSpans(block).some(s => s.end + 1 === profile.week)) { el.hidden = true; return; }
  const d = deloadCheck(profile, block).find(x => x.after === profile.week);
  /* Only where it is the news of the week — standing on the week right
     after a span. The block review carries every span the rest of the
     time. */
  if (!d) { el.hidden = true; return; }
  const pct = (d.change > 0 ? '+' : d.change < 0 ? '−' : '') +
    String(Math.abs(Math.round(d.change * 10) / 10)).replace('.', ',') + ' %';
  el.textContent = (d.change >= 1 ? '✓ La descarga funcionó: ' : d.change <= -1 ? '⚠ Tras la descarga has bajado: ' : '→ Tras la descarga estás igual: ') +
    pct + ' respecto a la semana ' + d.before +
    ' (sobre ' + (d.n === 1 ? '1 ejercicio' : d.n + ' ejercicios') + ').';
  el.className = 'deload-check' + (d.change >= 1 ? ' good' : d.change <= -1 ? ' bad' : '');
  el.hidden = false;
}

/* ---------- the global brake, said out loud ----------
   The one line on the screen that overrides every card's own answer, so it
   has to be visible before the cards are read rather than inferred from
   twenty exercises that all quietly declined to move. Read from the same
   cached value targetFor was handed, so the banner and the numbers under
   it can never disagree. */
function drawBrakeNote(profile, block) {
  const el = $('brakeNote');
  if (!brakeCached(profile, block, profile.week, Date.now())) { el.hidden = true; return; }
  el.textContent = 'Esta semana no sube nada: ' + BRAKE_COUNT +
    ' ejercicios han bajado a la vez. Mira sueño, comida o fatiga antes que el plan.';
  el.hidden = false;
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
  /* What the loop wrote, recorded after the commit below rather than inside
     the loop: save, then record, the order writeRows keeps on a card, and
     what lets the record's own save('view') claim nothing a session reads —
     the rows it is made of were claimed by the commit already. */
  const started = [];
  exList(day).forEach(ex => {
    const t = targetNow(profile, block, day, ex, profile.week);
    if (!t) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week, block));
    /* Before the loop writes a single weight, for the same reason writeRows
       reads it first: this button starts a session with no tick. */
    const wasSession = to.some(rowUsed);
    to.forEach((r, i) => {
      if (r.done) return;
      /* A row past the last set the rule priced — a plan grown since, or a
         deload's half session — takes the last weight rather than nothing:
         an empty box is worse than a number you can see is the previous
         set's. */
      const from = t.sets[i] || t.sets[t.sets.length - 1];
      r.w = loadText(from.w);
      stampForWrite(r, r);
    });
    started.push({ ex: ex, rows: to, wasSession: wasSession, est: t });
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
  started.forEach(s => recordTargetOnStart(profile, block, day, s.ex, s.rows, s.wasSession, s.est));
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
  /* This week only, as the sheet says, and every part of the session with
     its sets: the note, the energy and the order are keyed by slot alone,
     so unlike a value under an exercise they would still be sitting there
     when the day came back. */
  purgeRecord(profile, block.id, { day: day.id, week: profile.week });
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
  /* Everything the sheet promises, not just the sets (see purgeRecord).
     The plan stays, as the sheet says, and so do the variants, its naming
     history: their entry in RECORD_PARTS says why. */
  purgeRecord(profile);
  commit();
  mark('Registro de ' + profile.label + ' borrado');
};

function setsLabel(n) { return n + (n === 1 ? ' serie registrada' : ' series registradas'); }
/* The plan editor (draftBlock and friends) now lives in js/block-editor.js,
   alongside block CRUD/import — setsLabel stays here since it's used
   file-wide, not just by the editor. */

/* ---------- estimated 1RM ----------
   The chart that made these necessary now lives in js/chart.js, but they
   stayed: the target rule below reads both, and so does the Diagnóstico
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
   a number rather than reading one. Still the ceiling the Diagnóstico
   plots to and the RÉCORD 1RM badge is judged under; the rule below does
   not refuse past it, it reads the set as a MINIMUM instead (see the
   censoring note). The progress chart is not on it: its 1RM view keeps a
   stricter cut of its own, at twelve (isHighRep, js/chart.js), and past
   that it leaves the point off the line and marks it rather than
   dropping it. */
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

/* A "descarga" that the goal itself negates — "sin descarga", "no
   descarga" — is the block saying there is no deload here (CONTEXT.md,
   "deload week"), so it must not flip a week into one. A lookbehind would
   answer this in one regex, but Safari only parses one from 16.4, and a
   regex literal the engine cannot read is a SyntaxError for the whole of
   app.js — the app never starts (plans/059). The floor is Safari 15, so
   this walks every match instead and asks whether any one of them is
   unnegated. */
function saysDescarga(text) {
  const re = /descarga/gi;
  let m;
  while ((m = re.exec(text))) {
    if (!/\b(?:sin|no)\s+$/i.test(text.slice(0, m.index))) return true;
  }
  return false;
}

/* Every deload week of the block, sorted and deduped: the `deload` field
   (deloadWeek) union every week whose phase text says "descarga" without
   "sin"/"no" right before it — a hand-written phase can say "Descarga" on a
   week the field never heard about, and halving the sets on a week that
   says so is what the week asks for either way. Bounded to the block's own
   weeks, the same as deloadWeek already is, so a week the block has since
   been shortened past is left out. This is the one list every reader but
   the editor's own field (block-editor.js) asks — deloadAt is this list's
   membership test, and deloadWeek stays only as the field's accessor
   (plans/054: seven readers used to ask the field alone). */
function deloadWeeks(block) {
  const weeks = blockWeeks(block);
  const out = new Set();
  const fieldDl = deloadWeek(block);
  if (fieldDl) out.add(fieldDl);
  for (let w = 1; w <= weeks; w++) {
    const text = String((block && block.phase && block.phase[w] && block.phase[w].r) || '');
    if (saysDescarga(text)) out.add(w);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/* Consecutive deload weeks, taken as one deload span (CONTEXT.md, "deload
   span"), in week order. deloadCheck compares the week before a span with
   the week after it; drawDeloadCheck shows that line on the week right
   after a span ends. */
function deloadSpans(block) {
  const spans = [];
  deloadWeeks(block).forEach(w => {
    const last = spans[spans.length - 1];
    if (last && w === last.end + 1) last.end = w;
    else spans.push({ start: w, end: w });
  });
  return spans;
}

/* deloadWeeks' membership test. A deload is ~60 % of the working weight by
   design, so its sessions are evidence about nothing and are kept out of
   every window that reads this. */
function deloadAt(block, w) {
  return deloadWeeks(block).indexOf(w) !== -1;
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
   A session from sessionsOf, projected for the rule: only its working sets,
   each priced at its own reserve. The session reader knows nothing about
   capacities or censoring (plans/038, decision 13); this is where the rule's
   maths meets it. `w` is already converted to the profile's unit, because
   this window spans months and a profile that switched kg↔lb mid-block
   would otherwise have two scales in one average — the same reason the
   Diagnóstico's points (diagPoints) convert and the old single-session
   estimate did not have to.

   The RIR on a working set is already resolved by the reader — one reserve
   per set since plans/035, inherited backwards from the last set that
   carries one, with the legacy map as the fallback for a session logged
   before the rows carried a value — so a session with nothing on its rows
   is read exactly as the one chip always read it: the chip on the last set,
   inherited backwards over all of them. */
function ruleSession(session, lo, hi) {
  const work = session ? session.sets.filter(x => x.worked) : [];
  if (!work.length) return null;
  const rirs = work.map(x => x.rir);
  /* The date is the MEDIAN of the working sets' timestamps, not the first or
     the last: a set ticked days later from memory moves a mean and does not
     move a median. Computed here rather than taken from session.ts, which is
     the median over every TICKED set — a ticked set with no reps would
     otherwise move the date the variant cut-off and the gap check read. */
  const stamps = work.map(x => x.ts).filter(t => t > 0);
  const lastRho = rhoOf(rirs[rirs.length - 1]);
  return {
    blockId: session.block, week: session.week, dayId: session.day,
    /* The session's own `rir`/`rho` are the LAST working set's — what
       rhoLast, the chip's label and the Diagnóstico all mean by "the
       session's RIR". Every set carries its own below. */
    rir: rirs[rirs.length - 1] != null ? String(rirs[rirs.length - 1]) : null,
    rho: lastRho,
    ts: stamps.length ? median(stamps) : 0,
    sets: work.map(x => {
      const rk = x.rir, rho = rhoOf(rk);
      /* `conv` marks a row that was logged in the other unit, so loadLadder
         can leave it out: the capacity it proves is real, but the number it
         converts to was never a pin on this stack. Nothing else reads it —
         a reader that wants "the weight as logged" should read the session
         set's wLogged, not un-convert this one. */
      return { w: x.w, r: x.r, e: capOf(x.w, x.r, rho), conv: x.unit !== units(),
               rir: rk, rho: rho,
               cens: x.r >= hi || x.r > CENSOR_REPS || rk == null || rk >= 2 };
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

/* ---------- one way to write a set ----------
   Every write a card makes that can start a session comes through here —
   the weight, rep and RIR boxes, both drop boxes and the tick — in five
   steps whose order is the whole mechanism:

     1. `wasSession`, whether the lift's rows already counted as a session,
        is read BEFORE anything is written. Read after, the row is already
        used, every keystroke looks like a start, and the draw-time write
        recordTargetOnStart replaced is back by another route; on a tick it
        is the adopted weight that does it. Reading it late has shipped
        twice (plans/021, plans/035).
     2. `mutate` writes the set, field by field and literally (`r.w = …`),
        so the row codec's guard in test/unit.js still sees every field a
        set can carry.
     3. The unit stamp, when a weight was written: inside `mutate`, through
        stampForWrite, because only the write knows which weight is the new
        one and which boxes to refill when the rest of the set is converted.
     4. save(card.here): this lift's rows in this slot, the narrow claim a
        card's boxes make (logChanged).
     5. recordTargetOnStart, after the save: its own save('view') says that
        nothing a session reads changed, which is only true once step 4 has
        claimed the rows the start is made of.

   A session starts in whichever box its first value lands in, because
   rowUsed counts every one of them — a reserve since plans/035, a drop's
   weight or reps — so none of them may write on its own. One that did would
   be a start nobody records, after which every write reads as the same
   session: typing an RIR first would lose that session's objetivo record
   for good (plans/035 § "One thing 036 must not undo").

   Only the write is here. The redraw, the rest timer, the backup nag and
   the messages stay with each handler, after it.

   `card` is what buildExCard builds once for this: the rows, their save
   scope (`here`), the objetivo on screen (`est`), and the profile, block,
   day and exercise its record is filed under. Top-level rather than inside
   the card so the unit suite can call it. Answers whether this write
   started the session. */
function writeRows(card, mutate) {
  const wasSession = card.rows.some(rowUsed);
  mutate();
  save(card.here);
  recordTargetOnStart(card.profile, card.block, card.day, card.ex, card.rows, wasSession, card.est);
  return !wasSession && card.rows.some(rowUsed);
}

/* The record is written on a session start, by writeRows for a card and by
   "Rellenar con el objetivo", and by nothing else. It used to be written
   by the draw, for whatever week was on screen, as soon as that week had a
   row in it: every week logged before v3 got a rebuilt target the first
   time anyone scrolled past it, stamped with today's clock, so a week from
   two months ago was filed as a "vuelta de parón". `wasSession` is whether
   the exercise's rows already counted as a session when the write began;
   only the transition from "not yet" to "yes" records, so browsing writes
   nothing and a session that already has its record keeps it. */
function recordTargetOnStart(profile, block, day, ex, rows, wasSession, est) {
  if (wasSession || !est || !rows.some(rowUsed)) return false;
  if (!recordTarget(profile, block.id, profile.week, day.id, ex.id, est)) return false;
  /* `obj` is not read by any session: the rows this start is made of were
     already claimed by the save that wrote them — both callers record after
     it. */
  save('view');
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
   which came first.

   Two lists, one for one: `sessions`, the reader's own (sessionsOf), and
   `rule`, ruleSession's projection of each, which is what the rule prices
   from. Most callers want the second and ask exHistory, below. The
   Diagnóstico takes both from one call, so a row's count, signals and work
   axis are read off the very sessions its trend is fitted on: they used to
   come from a second choice of sessions that folded both days of a split
   lift, ignored a rename and hid stranded weeks, and the row said
   "Funciona" over six sessions its trend had never seen (plans/056). */
function liftHistory(profile, block, ex, dayId, beforeWeek, onlyBlockId) {
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
  /* 'logged', not 'plan': the objetivo is about the lifter over time, so a
     week stranded above a block that was shortened later is still something
     this lift was done at, in an earlier block or in this one. */
  const sessions = sessionsOf(profile, {
    weeks: 'logged', lift: { id: ex.id }, blocks: ids,
    before: { block: block.id, week: beforeWeek }, skipDeload: true,
  });
  const since = variantSince(profile, ex.id);
  /* The projection below is most of what this costs once the read is
     cached — the brake asks it of every exercise of the block on every
     draw — so it is kept beside the read it was made from (historyDerived)
     and goes when that does. The key is everything else it reads. */
  const memo = historyDerived(sessions);
  const key = lo + '|' + hi + '|' + (ownDay || '') + '|' + since + '|' + units();
  const hit = memo && memo.get(key);
  if (hit) return hit;
  const kept = [], rule = [];
  sessions.forEach(s => {
    if (ownDay && s.block === block.id && s.day !== ownDay) return;
    const sess = ruleSession(s, lo, hi);
    /* The variant cut-off reads the rule's own date, the median of the
       working sets' times — so it is applied to the projection, and the
       session goes with it. An undated session is kept (variantSince). */
    if (!sess || (since && sess.ts && sess.ts < since)) return;
    kept.push(s);
    rule.push(sess);
  });
  /* The sessions are already frozen, as every answer of the history cache
     is; the lists holding them are new, so they are frozen here. */
  const res = Object.freeze({ sessions: Object.freeze(kept), rule: freezeHistory(rule) });
  if (memo) memo.set(key, res);
  return res;
}

function exHistory(profile, block, ex, dayId, beforeWeek, onlyBlockId) {
  return liftHistory(profile, block, ex, dayId, beforeWeek, onlyBlockId).rule;
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
   One of those stops the weights going up for a day (a set the range says
   is out of reach still comes down). Two in a row is the level itself
   moving, which is the only thing that lowers it.

   `sets[0].cens` is the FIRST set's own state since plans/035, not the
   whole session's: a 0 or 1 typed on the first set makes it a reading and
   the level can move on it, a 2 or more — or nothing typed — keeps it a
   floor. That is what typing the first set's RIR buys, and `conf` in
   targetFor, the count of un-censored first sets over the last six
   sessions, is where the lifter sees it: the confidence chip climbs from
   "baja" to "alta" on the one set per session that matters most. */
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
  const sessions = exHistory(profile, block, ex, day && day.id, week);
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
     now priced at the reserve its own set was done at, so the two sides of
     each ratio are comparable. Take a session run 3 → 2 → 1 → 0 RIR down
     four sets at 60 kg — 10, 9, 8, 8 reps, what a well-paced session looks
     like. Read at the one chip the lifter tapped for the last set, every
     set was priced as if it had gone to failure: the first set's capacity
     came out at 80 and the drop by set four at 5 %. Read per set the first
     set is worth 86, which is what it actually proved, and the measured
     drop is 10 % — the reserve that was genuinely spent down the session,
     which the single chip had hidden. The level rises further than the
     decay costs, so the last set is asked for more rather than less.
     `upper[k]` follows the same way: a censored set bounds the drop out of
     itself because THAT set is a floor, not because the whole session was.

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
         the last set of that session was done at.

         As the arithmetic stands the Math.max always returns `r`, so the
         floor never actually binds: `base` is at least `L.e`, and
         repsAt(L.w, L.e, rirWeek) is exactly L.r + L.rho - rirWeek, which
         is never below L.r - max(0, rirWeek - L.rho). Deleting the line
         changed none of 4032 probe cases. It is kept because it states what
         the rule may not do rather than computing a step of it — the day
         `base`, `g` or repsAt changes shape, this is what stops the model
         prescribing less than the log already proves. Nothing in
         test/unit.js can see it, and that is expected.

         Reading `rhoLast` here, which is what it did while one chip was all
         there was, is not the same dead line: whenever the last set of the
         session was left with more in reserve than this set, the discount
         came out too small and the floor rose ABOVE what the model allows —
         211 of those same 4032 cases. That is why it had to change. */
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
      const sessions = exHistory(profile, block, ex, day.id, week);
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
   done this week, one sessionsOf query per exercise the plan still shows —
   like the plan side, a retired exercise's old sets are not this week's
   adherence. Both are seeded from blockTagsFor() first so toggling between
   them never adds or drops a bar — only the numbers move, which is the
   point of a plan-vs-adherence comparison. */
function volumeTotals(scope, profile, block, week, dim) {
  const tagFn = VOLUME_DIMENSIONS[dim].tag;
  const totals = {};
  blockTagsFor(dim, block).forEach(t => { totals[t] = 0; });
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      const t = tagFn(ex);
      if (scope === 'log') {
        const sess = sessionsOf(profile, { weeks: 'plan', blocks: [block.id], lift: { id: ex.id }, day: day.id })
          .find(s => s.week === week);
        totals[t] += sess ? sess.sets.length : 0;
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
   sessionsOf is asked for every lift here, unlike the set counts above, so
   a retired exercise's sets still count — hiding them from the plan
   doesn't unlift them — and so do rows parked past an exercise's current
   set count, since a session carries every ticked set regardless of what
   `extra` says about it. `weeks: 'plan'` is what leaves out weeks past the
   block's current length, for the same reason the session view hides them
   — the "series en semanas por encima" notice is what speaks for those.
   Always the converted reading (sessionVolume, plans/057): every reader
   that spans sessions needs one, since a block trained partly in another
   unit would otherwise be summed as if every row were in the one on screen
   — see the comment by rowWeight. The session view is the one screen that
   still wants setVolume, raw, and it never reads a whole week at once. */
function blockTonnageByWeek(profile, block) {
  const weeks = blockWeeks(block);
  const out = new Array(weeks).fill(0);
  sessionsOf(profile, { weeks: 'plan', blocks: [block.id] }).forEach(sess => {
    out[sess.week - 1] += sessionVolume(sess.sets);
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
   week — the field or a hand-written phase, deloadAt reads both — is
   halved on purpose, so counting it would drag every muscle under the band
   and flag a block that is doing exactly what it says. On the registrado
   side, weeks you simply have not trained yet are not weeks of low volume
   — only weeks with something logged are evidence. */
function volumeWeeksInPlay(scope, block, series) {
  const idx = [];
  series.forEach((v, i) => {
    if (deloadAt(block, i + 1)) return;
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
  /* One sessionsOf query per exercise the plan still shows, weeks:'plan'
     (plans/057) — a retired exercise's old sets are not what this note
     warns about, same reasoning as volumeTotals. `week` is clamped only to
     MAX_WEEKS above, not to blockWeeks(block) — a profile can land on a
     week past a block that has since been shortened — so a session's own
     week is compared to it exactly as the raw loop did, not re-bounded. */
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      sessionsOf(profile, { weeks: 'plan', blocks: [block.id], lift: { id: ex.id }, day: day.id }).forEach(sess => {
        if (sess.week === week) inWeek += sess.sets.length;
        else if (sess.week < week) earlier += sess.sets.length;
      });
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
   js/qr-transfer.js and reads most of this section directly — building
   and describing what it sends, validating what it receives. A few
   symbols stayed here for a second reader too, which is what actually
   keeps them out of qr-transfer.js: blockSharePlan and blockDoneSets are
   also read by js/block-editor.js's own export and delete dialogs (not by
   js/review.js any more — plans/050 gave the block review its own
   week-bounded count instead, in js/review.js itself), and countSets and
   the checks on what arrives are also read by js/profile-transfer.js,
   which runs a restored backup through the same per-row checks the camera
   path has — countProfileSets and countBackupSets there are one-liners
   over countSets (plans/050). Those checks are each part's `accept` in
   RECORD_PARTS now (plans/051); the normalizeImported* names at the end
   of this section only name them, for the camera path. */

/* Rows arrive from a camera or from a restored backup file, so they get the
   same treatment as any other imported data: bounded, coerced, never trusted
   for length or type.

   `slots` is every week of every day of the biggest block any path
   accepts — a restored one (OWN_LIMITS), retired days included, since a
   retired day keeps its rows. reKeyImportedSlots stops reading at this
   many keys, so sizing it off
   IMPORT_LIMITS.days would let a block past fourteen days restore and then
   drop its later sessions without a word. A shared block is fourteen days
   at most and never comes near it. */
const LOG_LIMITS = { rows: 24, val: 12, slots: MAX_WEEKS * OWN_LIMITS.days };
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

/* ---- the row codec ----
   Every field a logged set can carry, once: how it is sent, how it is
   accepted back, and which CSV column it fills. The share builder and the
   import validator used to hold two field lists "mirrored" by a comment,
   and when `u` was added to rows it was missing from both, so every lb set
   restored as kg (fixed by PR #119). Now a field that is not in this list
   is not sent, not accepted and not exported, and test/unit.js fails when
   the code writes a row field this list does not name (plans/038).

   `send(r)` and `accept(raw, row)` return undefined to leave the field
   out: kg is the absence of `u`, and `dk` only exists beside drops.
   `accept` is handed the row built so far, in this order, which is how
   `dk` knows whether `d` survived. The order is also the CSV's. */
const ROW_FIELDS = [
  { key: 'w', col: 'peso',
    send: r => (r.w != null ? String(r.w) : ''),
    accept: raw => txt(raw.w, LOG_LIMITS.val),
    /* As typed, so a row matches the card it was logged on; `unidad` says
       which unit it is in. */
    cell: r => r.w },
  { key: 'u', col: 'unidad',
    send: r => (rowUnit(r) === 'lb' ? 'lb' : undefined),
    /* The exact 'lb' or nothing, the convention stampRowUnit writes: a
       'kg', an 'LB' or anything else is dropped rather than stored as a
       value no reader expects. */
    accept: raw => (raw.u === 'lb' ? 'lb' : undefined),
    cell: r => rowUnit(r) },
  { key: 'r', col: 'reps',
    send: r => (r.r != null ? String(r.r) : ''),
    accept: raw => txt(raw.r, LOG_LIMITS.val),
    cell: r => r.r },
  { key: 'done', col: 'hecha',
    send: r => !!r.done,
    accept: raw => !!raw.done,
    cell: r => (r.done ? 'si' : 'no') },
  { key: 'ts', col: 'fecha',
    send: r => (Number.isFinite(+r.ts) && +r.ts > 0 ? +r.ts : undefined),
    accept: raw => {
      const ts = isObj(raw.ts) ? NaN : +raw.ts;
      return Number.isFinite(ts) && ts > 0 ? ts : undefined;
    },
    cell: r => (r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '') },
  { key: 'rir', col: 'rir',
    send: r => (rowRir(r) != null ? String(rowRir(r)) : undefined),
    /* One digit or nothing. A '2+' on a row is not a row value — the
       legacy map carries those, and normalizeImportedRir validates them
       there — so coercing it here would invent a measurement out of a
       chip that belonged to the whole session. */
    accept: raw => (!isObj(raw.rir) && /^[0-5]$/.test(String(raw.rir)) ? String(raw.rir) : undefined),
    /* The set's OWN value, blank where nothing was typed: the file is the
       record as written, not as the rule reads it, so the inheritance
       rule stays out of it. */
    cell: r => (rowRir(r) == null ? '' : String(rowRir(r))) },
  { key: 'd', col: 'bajadas',
    /* Half-typed segments are dropped rather than sent: they are worth
       nothing on the other phone and every byte costs QR frames. */
    send: r => {
      const drops = dropsOf(r).filter(dropUsed)
        .map(d => ({ w: d.w != null ? String(d.w) : '', r: d.r != null ? String(d.r) : '' }));
      return drops.length ? drops : undefined;
    },
    accept: raw => {
      const drops = (Array.isArray(raw.d) ? raw.d : []).slice(0, MAX_DROPS)
        .filter(d => d && typeof d === 'object' && !Array.isArray(d))
        .map(d => ({ w: txt(d.w, LOG_LIMITS.val), r: txt(d.r, LOG_LIMITS.val) }))
        .filter(dropUsed);
      return drops.length ? drops : undefined;
    },
    /* On their set's own line, as "45x5 30x4", rather than lines of their
       own: "serie" has to keep meaning the set number the plan asked for.
       They share the set's unit stamp; drops have none of their own. */
    cell: r => dropsOf(r).filter(dropUsed)
      .map(d => (d.w == null ? '' : d.w) + 'x' + (d.r == null ? '' : d.r)).join(' ') },
  { key: 'dk', col: 'tipo_bajada',
    /* Only where there is something for it to describe. */
    send: r => (dropsOf(r).some(dropUsed) ? dropKind(r) : undefined),
    accept: (raw, row) => (row.d ? (DROP_KINDS.indexOf(raw.dk) >= 0 ? raw.dk : 'drop') : undefined),
    cell: r => (dropsOf(r).some(dropUsed) ? DROP_LABEL[dropKind(r)] : '') },
];
const ROW_CSV_COLUMNS = ROW_FIELDS.map(f => f.col);

function rowToShare(r) {
  const row = {};
  ROW_FIELDS.forEach(f => {
    const v = f.send(r || {});
    if (v !== undefined) row[f.key] = v;
  });
  return row;
}

function rowFromImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { w: '', r: '', done: false };
  const row = {};
  ROW_FIELDS.forEach(f => {
    const v = f.accept(raw, row);
    if (v !== undefined) row[f.key] = v;
  });
  return row;
}

const rowCsvCells = r => ROW_FIELDS.map(f => f.cell(r));

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
        /* Which fields travel, and how, is the row codec's (ROW_FIELDS). */
        kept[exId] = rows.slice(0, last + 1).map(rowToShare);
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

/* The one counter every raw storage count reduces to (plans/050): every
   other counting function below and in js/profile-transfer.js is a
   one-liner over this. It keeps walking every stored key rather than
   switching to forEachSlot, because blockLoggedSets feeds the delete
   dialogs, and those have to count everything deleteBlocks deletes,
   including a key that is not a real slot. A caller that wants only what a
   share payload carries — the QR send sheet — hands it blockShareLog's
   output instead of a raw block log; see js/qr-transfer.js.

   Two different numbers, and the difference is the whole point of showing
   them at all. A row counts as "registrada" the moment it holds anything —
   including a weight typed into the box and then never ticked. Only a row
   marked *done* feeds the progress chart, the RÉCORD badge or the volume
   dashboard. A transfer carries both kinds faithfully, so a block that was
   full of untouched numbers before it was sent is still full of them after,
   and the sheet has to say so rather than promising "234 series" and
   handing over a chart with nothing in it. */
function countSets(log, onlyDone) {
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
  return countSets(profile.log[blockId], true);
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
/* Read by reKeyImportedSlots below, for the `accept` of every part of the
   record filed by block (RECORD_PARTS): each needs to re-key a payload
   from the sender's day/exercise ids to whatever `normalizeImportedBlock`
   renamed them to. First occurrence wins, both here and for days. A
   sender whose block had the same id on two exercises *of one day* leaves
   a mapping that is genuinely ambiguous — but `normalizeImportedBlock`
   renames the *later* duplicate and leaves the first one's id alone, so
   rows filed under that id belong to the first. Letting the duplicate
   overwrite the mapping would quietly move somebody's sets onto a
   different exercise. */
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
  const put = (map, from, to) => { if (from != null && !isObj(from) && !(String(from) in map)) map[String(from)] = to; };
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

/* The skeleton every part filed by block plugs its check into (its
   `accept`, RECORD_PARTS): which keys are slots at all, the week bound,
   the slot cap, and the day id re-keyed through importIdMaps. Only what a
   slot holds differs, so that is all `keep` is asked — it gets the slot's
   raw value and that day's exercise map, and returns what to file or
   undefined to drop the slot. Notes and energy hold no exercise ids and
   ignore the second argument, but their key still carries a day id: they
   used to be copied across under it untouched, so a renamed day lost its
   notes and energy on every restore. */
function reKeyImportedSlots(raw, rawBlock, normalized, keep) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const { dayMap, exMap } = importIdMaps(rawBlock, normalized);

  const out = {};
  Object.keys(raw).slice(0, LOG_LIMITS.slots).forEach(key => {
    const s = parseSlot(key);
    if (!s) return;
    const w = s.week;
    if (!Number.isInteger(w) || w < 1 || w > MAX_WEEKS) return;
    const dayId = dayMap[s.dayId];
    if (!dayId) return;
    const kept = keep(raw[key], exMap[dayId] || Object.create(null));
    if (kept !== undefined) out[slot(w, dayId)] = kept;
  });
  return out;
}

/* The `keep` for a part keyed by exercise under the slot — the log, the
   legacy chips, the objetivo record — so each of them is only asked what
   one exercise's value keeps: the slot has to be a map, each exercise id in
   it is re-keyed through that day's map (an id the sender's block does not
   account for is dropped), `check` returns what to file or undefined to
   drop it, and a slot left with nothing is dropped like any other. */
function eachExercise(check) {
  return (slotVal, exFor) => {
    if (!slotVal || typeof slotVal !== 'object' || Array.isArray(slotVal)) return undefined;
    const kept = {};
    Object.keys(slotVal).forEach(rawExId => {
      const exId = exFor[rawExId];
      if (!exId) return;
      const v = check(slotVal[rawExId]);
      if (v !== undefined) kept[exId] = v;
    });
    return Object.keys(kept).length ? kept : undefined;
  };
}

/* The names the QR "blocklog" path (js/qr-transfer.js) and the tests call,
   one block at a time. What each accepts, and on what terms, is its part's
   `accept` in RECORD_PARTS; these only name it. A refusal comes back bare
   here: the QR path puts "Ese bloque no se puede usar" in front of it, and
   normalizeImportedProfile, which walks many blocks, the block's name. */
function normalizeImportedLog(rawLog, rawBlock, normalized) {
  return recordPart('log').accept(rawLog, rawBlock, normalized);
}

function normalizeImportedRir(rawRir, rawBlock, normalized) {
  return recordPart('rir').accept(rawRir, rawBlock, normalized);
}

function normalizeImportedOrder(rawOrder, rawBlock, normalized) {
  return recordPart('order').accept(rawOrder, rawBlock, normalized);
}

function normalizeImportedObj(rawObj, rawBlock, normalized) {
  return recordPart('obj').accept(rawObj, rawBlock, normalized);
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
  const rows = [['perfil', 'bloque', 'semana', 'dia', 'ejercicio', 'orden', 'serie'].concat(ROW_CSV_COLUMNS, ['nota', 'energia'])];
  Object.keys(state.profiles).forEach(pk => {
    const profile = state.profiles[pk];
    profile.blockOrder.forEach(bId => {
      const block = profile.blocks[bId];
      /* Every set ever logged, not only the ones the app still shows: the
         file is the record, and the record keeps weeks past a shortened
         block's end (stranded weeks) and exercises since taken out of the
         plan, whose rows nothing ever deletes. Walking the plan — its days,
         its exercises, weeks 1 to its length — was silently leaving both
         out of the one place they could still be read (plans/038). So the
         walk is over the slots that exist, grouped by day and week, and the
         plan only decides the order: its own days, its own exercises and
         the block's own weeks come out exactly where they always did, and
         what the plan no longer has comes after them. */
      const byDay = {};
      forEachSlot(profile.log, bId, (k, w, dayId, s) => {
        if (!s || typeof s !== 'object') return;
        (byDay[dayId] = byDay[dayId] || []).push({ w: w, s: s });
      });
      Object.keys(byDay).forEach(dayId => { byDay[dayId].sort((a, b) => a.w - b.w); });
      /* A removed exercise has no row on its day to be named by, but a
         retired or moved one is still somewhere in the plan, and that is
         the name it was logged under. The raw id only when nothing is. */
      const exName = {};
      block.days.forEach(d => d.ex.forEach(e => { if (!(e.id in exName)) exName[e.id] = e.n; }));
      const nameOf = id => (Object.prototype.hasOwnProperty.call(exName, id) ? exName[id] : id);
      const ords = {};
      const ordAt = (day, w) => {
        const key = slot(w, day.id);
        if (!ords[key]) {
          ords[key] = {};
          orderedEx(profile, block, w, day).forEach((e, i) => { ords[key][e.id] = i + 1; });
        }
        return ords[key];
      };
      const emit = (dayId, dayName, day, exId, exN) => {
        (byDay[dayId] || []).forEach(({ w, s }) => {
          const arr = Object.prototype.hasOwnProperty.call(s, exId) ? s[exId] : null;
          if (!Array.isArray(arr)) return;
          /* The position each exercise was actually done in, per week. It
             falls back to the plan's own order for every session nobody
             reordered — which is most of them — so the column is filled in
             for every live exercise and sorting a spreadsheet by it always
             works. A retired exercise is not in any session's order and
             leaves the cell empty rather than borrowing a number off one
             that was actually done; so does one removed from the plan, or
             logged on a day the plan no longer has. */
          const ord = day ? ordAt(day, w)[exId] : '';
          /* Per session, repeated on every row of that session so a
             spreadsheet filter on the column finds the whole session.
             Unlike `rir`, which is per set from plans/035 on — see the
             column below. */
          const note = getNote(profile, bId, w, dayId);
          const energy = getEnergy(profile, bId, w, dayId);
          arr.forEach((r, i) => {
            if (!rowUsed(r)) return;
            /* The set's own columns are the row codec's (ROW_FIELDS),
               which says why each is written the way it is. A session
               logged before plans/035 carries its one chip on the row
               the fold put it on, the last set of that session. */
            rows.push([profile.label, block.name, w, dayName, exN, ord || '', i + 1]
              .concat(rowCsvCells(r), [note, energy]));
          });
        });
      };
      /* Every id logged on a day that its plan does not name, in the order
         they were first logged: week, then the slot's own order. */
      const unplanned = (dayId, planned) => {
        const out = [];
        (byDay[dayId] || []).forEach(({ s }) => Object.keys(s).forEach(id => {
          if (planned.indexOf(id) < 0 && out.indexOf(id) < 0 && Array.isArray(s[id])) out.push(id);
        }));
        return out;
      };
      block.days.forEach(day => {
        const planned = day.ex.map(e => e.id);
        day.ex.forEach(ex => emit(day.id, day.name, day, ex.id, ex.n));
        unplanned(day.id, planned).forEach(id => emit(day.id, day.name, day, id, nameOf(id)));
      });
      /* A day taken out of the plan altogether has no name left to show,
         so it goes by its id, after the plan's days, earliest logged first. */
      const planDays = block.days.map(d => d.id);
      Object.keys(byDay).filter(id => planDays.indexOf(id) < 0)
        .sort((a, b) => byDay[a][0].w - byDay[b][0].w || (a < b ? -1 : a > b ? 1 : 0))
        .forEach(dayId => unplanned(dayId, []).forEach(id => emit(dayId, dayId, null, id, nameOf(id))));
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
/* The bar's other two hubs, app.js's own for the same reason (plans/037).
   Their rows belong to five different files, but the sheets around them do
   not. */
registerSheet('progressSheet', { closeBtn: 'progressClose' });
registerSheet('planHubSheet', { closeBtn: 'planHubClose' });
/* The card's "⋯" menu is app.js's own too, and its five rows are rewired on
   every open by openExMenu — only the sheet's own close belongs here. */
registerSheet('exMenuSheet', { closeBtn: 'exMenuClose' });
$('profileBtn').onclick = () => openSheet('profileSheet');
$('blockBtn').onclick = () => openSheet('blockSheet');
$('moreBtn').onclick = () => openSheet('moreSheet');

/* ---------- the bar ----------
   Three of the four open a hub; Sesión is the page you are already on, so
   it keeps aria-current and takes you back to the top of the day. The
   closeSheet loop inside it never actually runs: a sheet's backdrop covers
   the whole viewport at z-index 60, the bar sits at 50, and
   elementFromPoint over #navSession with any sheet up returns a row of
   that sheet. It stays as the answer to "what if something is up" rather
   than as a live path. A route model would buy nothing here either —
   there is one screen and three sheets. */
const HUBS = ['progressSheet', 'planHubSheet', 'moreSheet'];
$('navProgress').onclick = () => openSheet('progressSheet');
$('navPlan').onclick = () => openSheet('planHubSheet');
$('navMore').onclick = () => openSheet('moreSheet');
$('navSession').onclick = () => {
  HUBS.forEach(id => { if ($(id).classList.contains('up')) closeSheet(id); });
  $('main').scrollIntoView({ block: 'start' });
};

/* A hub row that opens another sheet puts the hub away first, so the stack
   holds one sheet rather than a dashboard with a hub underneath it that
   Escape then has to be pressed twice to leave.

   In the capture phase, which is the half that matters: closing the hub
   AFTER the row's own handler has run pulls focus back out of the sheet
   that just opened (closeSheet returns it to whatever opened the hub), and
   leaves that sheet's own return target pointing at a row that is no longer
   on screen. Closing first means the row's openSheet() records the bar
   button as its return target, which is where Escape should land.

   data-keep-open is for the one row that opens nothing: "Tema" cycles in
   place and the sheet has to still be there to show what it cycled to. */
HUBS.forEach(id => {
  $(id).addEventListener('click', e => {
    const row = e.target && e.target.closest ? e.target.closest('.sheet-row') : null;
    if (!row || row.dataset.keepOpen) return;
    closeSheet(id);
  }, true);
});

/* It is a field in Ajustes, not a setting of its own — this row is the
   shortcut to it, and the focus is what stops "Aviso con la pantalla
   apagada" opening a long sheet and leaving you to find it. */
$('bgAlarmBtn').onclick = () => {
  openSetup(false);
  const seg = $('setupBgAlarm').querySelector('.seg-btn[aria-pressed="true"]') || $('setupBgAlarm').querySelector('.seg-btn');
  if (seg) seg.focus();
};

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
