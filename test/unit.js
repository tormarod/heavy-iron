/* Headless assertions for the logic that does not need a browser.
 *
 *   node test/unit.js
 *
 * No server, no Chromium, no dependencies. The six source files are plain
 * <script> tags sharing one global scope (see index.html), so loading them
 * into a single node:vm context in the same order reproduces that scope
 * closely enough to call the pure functions directly.
 *
 * This does not replace test/smoke.js. Anything a user could observe — a
 * class on an element, a value surviving a reload, a sheet opening — belongs
 * there, in a real browser. What belongs here is arithmetic and data repair:
 * migrate(), the import validators, the statistics. Those are expensive and
 * imprecise to assert through a browser and cheap to assert here.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Every DOM object the sources touch at load time answers to the same inert
   stub: the three innerHTML writes at js/app.js:158-160 and the wire*()
   handlers just need something that does not throw. Nothing here pretends to
   be a real DOM — if a test needs real rendering, it belongs in smoke.js. */
const inert = () => ({
  style: {}, dataset: {}, children: [], hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
  appendChild() {}, replaceChildren() {}, remove() {},
  addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
  querySelector() { return inert(); }, querySelectorAll() { return []; },
  focus() {},
  get innerHTML() { return ''; }, set innerHTML(v) {},
  get textContent() { return ''; }, set textContent(v) {},
  get value() { return ''; }, set value(v) {},
});

function loadApp() {
  const store = {};
  const ctx = vm.createContext({
    document: {
      getElementById: () => inert(), createElement: () => inert(),
      querySelector: () => inert(), querySelectorAll: () => [],
      addEventListener() {}, documentElement: inert(), body: inert(), head: inert(),
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    navigator: {},
    location: { hostname: 'localhost', pathname: '/' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  });
  ctx.window.self = ctx.window;
  ctx.globalThis = ctx;

  /* The same order as the <script> tags in index.html — theme-init.js first
     because it loads in <head>, app.js after the ten it wires and then calls
     load() from, and boot-guard.js last, after app.js, because it is the one
     script that has to run even when app.js could not. */
  ['js/theme-init.js', 'js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
   'js/profile-transfer.js', 'js/calculator.js', 'js/rest-timer.js',
   'js/chart.js', 'js/volume-sheet.js', 'js/qr-transfer.js',
   'js/app.js', 'js/boot-guard.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

const app = loadApp();
const call = expr => vm.runInContext(expr, app);
const throws = expr => { try { call(expr); return false; } catch (e) { return true; } };

console.log('\n== the harness ==');
ok('every source file loads in one shared scope', call('typeof migrate') === 'function');
ok('load() seeded a state object', call('!!state && !!state.profiles'));

console.log('\n== pure arithmetic ==');
ok('est1RM matches the Epley formula by hand', call('est1RM(100, 5)') === 100 * (1 + 5 / 30));
ok('est1RM at 1 rep returns the weight itself', call('est1RM(80, 1)') === 80 * (1 + 1 / 30));

ok('fitPlates finds an exact fit', call('JSON.stringify(fitPlates(20, [20, 10, 5]).plates)') === '[20]');
ok('fitPlates reports zero remainder on an exact fit', call('fitPlates(20, [20, 10, 5]).remainder') === 0);
ok('fitPlates reports a remainder rather than hiding it',
   call('fitPlates(21, [20, 10, 5]).remainder') === 1,
   String(call('JSON.stringify(fitPlates(21, [20, 10, 5]))')));

ok('clampInt keeps an in-range value', call('clampInt(5, 1, 10, 3)') === 5);
ok('clampInt clamps to the low bound rather than the default', call('clampInt(0, 1, 10, 3)') === 1);
ok('clampInt clamps to the high bound rather than the default', call('clampInt(99, 1, 10, 3)') === 10);
ok('clampInt falls back to the default on non-numeric input', call('clampInt("abc", 1, 10, 3)') === 3);

ok('clampNum keeps an in-range value', call('clampNum(5.5, 1, 10, 3, 0.5)') === 5.5);
ok('clampNum falls back on non-numeric input', call('clampNum("abc", 1, 10, 3, 0.5)') === 3);

ok('txt collapses internal whitespace', call('txt("a   b\\tc", 40)') === 'a b c');
ok('txt caps to the given length', call('txt("x".repeat(50), 10).length') === 10);

ok('esc escapes &', call('esc("&")') === '&amp;');
ok('esc escapes <', call('esc("<")') === '&lt;');
ok('esc escapes >', call('esc(">")') === '&gt;');
ok('esc escapes "', call('esc(\'"\')') === '&quot;');
ok("esc escapes '", call("esc(\"'\")") === '&#39;');

ok('slot has the w<week>-<dayId> shape', call('slot(3, "d1")') === 'w3-d1');

console.log('\n== normalizeImportedBlock ==');
const minimalBlock = {
  name: 'Test', weeks: 8, deload: 8,
  days: [{ name: 'Día 1', ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] }],
};
ok('a minimal valid block is accepted', !throws('normalizeImportedBlock(' + JSON.stringify(minimalBlock) + ')'));
ok('accepted block keeps its day and exercise', call(
  'normalizeImportedBlock(' + JSON.stringify(minimalBlock) + ').days[0].ex[0].n'
) === 'Ex');

const tooManyDaysBlock = Object.assign({}, minimalBlock, {
  days: Array.from({ length: 15 }, (_, i) => ({ name: 'D' + i, ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] })),
});
ok('a block with more than IMPORT_LIMITS.days days throws',
   throws('normalizeImportedBlock(' + JSON.stringify(tooManyDaysBlock) + ')'));

const tooManyExBlock = Object.assign({}, minimalBlock, {
  days: [{ name: 'Día 1', ex: Array.from({ length: 41 }, (_, i) => ({ n: 'Ex' + i, sets: 3, reps: '10-15' })) }],
});
ok('a day with more than IMPORT_LIMITS.ex exercises throws',
   throws('normalizeImportedBlock(' + JSON.stringify(tooManyExBlock) + ')'));

const longNameBlock = Object.assign({}, minimalBlock, { name: 'x'.repeat(200) });
ok('an over-long name is truncated, not rejected', !throws('normalizeImportedBlock(' + JSON.stringify(longNameBlock) + ')'));
ok('...to IMPORT_LIMITS.name', call(
  'normalizeImportedBlock(' + JSON.stringify(longNameBlock) + ').name.length'
) === 80);

const clampedExBlock = Object.assign({}, minimalBlock, {
  days: [{ name: 'Día 1', ex: [{ n: 'Ex', sets: 99, rest: -5, reps: '10-15' }] }],
});
ok('sets outside its clamp comes back clamped', call(
  'normalizeImportedBlock(' + JSON.stringify(clampedExBlock) + ').days[0].ex[0].sets'
) === 12);
ok('rest outside its clamp comes back clamped', call(
  'normalizeImportedBlock(' + JSON.stringify(clampedExBlock) + ').days[0].ex[0].rest'
) === 0);

const dupIdBlock = Object.assign({}, minimalBlock, {
  days: [
    { name: 'Día 1', ex: [{ id: 'dup', n: 'A', sets: 3, reps: '10-15' }] },
    { name: 'Día 2', ex: [{ id: 'dup', n: 'B', sets: 3, reps: '10-15' }] },
  ],
});
const dupResult = call(
  'JSON.stringify(normalizeImportedBlock(' + JSON.stringify(dupIdBlock) + ').days.map(d => d.ex[0].id))'
);
const dupIds = JSON.parse(dupResult);
ok('exercise ids are made unique across the whole block',
   dupIds[0] !== dupIds[1], dupResult);

console.log('\n== migrate() ==');
ok('the deleted-profile guard does not resurrect a deleted profile', (() => {
  const migrated = call(
    'state = ' + JSON.stringify({ profiles: {}, activeProfile: 'ghost' }) + '; migrate(); JSON.parse(JSON.stringify(state));'
  );
  return !migrated.profiles.ghost;
})());

const bareProfile = {
  profiles: { hombre: { blocks: {}, blockOrder: [], log: {} } },
  activeProfile: 'hombre',
};
const migratedBare = call('state = ' + JSON.stringify(bareProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
const p = migratedBare.profiles.hombre;
ok('rir is created when absent', typeof p.rir === 'object' && p.rir !== null);
ok('notes is created when absent', typeof p.notes === 'object' && p.notes !== null);
ok('energy is created when absent', typeof p.energy === 'object' && p.energy !== null);
ok('order is created when absent', typeof p.order === 'object' && p.order !== null);

const badOrderProfile = {
  profiles: {
    hombre: {
      blocks: {}, blockOrder: [], log: {},
      order: { b1: { s1: 'not-an-array', s2: ['a', 'a', 'b'] } },
    },
  },
  activeProfile: 'hombre',
};
const migratedOrder = call('state = ' + JSON.stringify(badOrderProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
const op = migratedOrder.profiles.hombre.order.b1;
ok('a non-array order value is deleted', !op || !('s1' in op), JSON.stringify(op));
ok('duplicate ids are removed from a session order', !op || !op.s2 || new Set(op.s2).size === op.s2.length, JSON.stringify(op));

const outOfRangeWeekProfile = {
  profiles: { hombre: { blocks: { b1: { weeks: 4 } }, blockOrder: ['b1'], activeBlock: 'b1', log: {}, week: 99, day: -5 } },
  activeProfile: 'hombre',
};
const migratedWeek = call('state = ' + JSON.stringify(outOfRangeWeekProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
ok('week is clamped to MAX_WEEKS, independent of the block\'s own length',
   migratedWeek.profiles.hombre.week === call('MAX_WEEKS'), String(migratedWeek.profiles.hombre.week));
ok('a negative day is clamped up to 0', migratedWeek.profiles.hombre.day === 0, String(migratedWeek.profiles.hombre.day));

const dupExProfile = {
  profiles: {
    hombre: {
      blocks: {
        b1: {
          weeks: 8,
          days: [
            { id: 'd0', ex: [{ id: 'e1', n: 'A' }, { id: 'e1', n: 'B' }] },
            { id: 'd1', ex: [{ id: 'e1', n: 'C' }] },
          ],
        },
      },
      blockOrder: ['b1'], activeBlock: 'b1', log: {},
    },
  },
  activeProfile: 'hombre',
};
const migratedDup = call('state = ' + JSON.stringify(dupExProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
const days = migratedDup.profiles.hombre.blocks.b1.days;
ok('duplicate exercise ids on the same day are deduped', days[0].ex[0].id !== days[0].ex[1].id,
   JSON.stringify(days[0].ex.map(e => e.id)));
ok('the same id on two different days survives, by design', days[1].ex[0].id === 'e1', days[1].ex[0].id);

const badThemeProfile = { profiles: { hombre: { blocks: {}, blockOrder: [], log: {} } }, activeProfile: 'hombre', prefs: { theme: 'not-a-theme' } };
const migratedTheme = call('state = ' + JSON.stringify(badThemeProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
ok('an unknown theme falls back to auto', migratedTheme.prefs.theme === 'auto', migratedTheme.prefs.theme);

console.log('\n== normalizeImportedProfile ==');

/* The most important assertion in this section: a profile the app itself
   exported must come back with every meaningful field intact. Built from
   defaultState(), not by hand, so this tracks whatever the app actually
   produces rather than what a test author assumed it produces. */
const roundTrip = call(`
  (function() {
    const original = JSON.parse(JSON.stringify(defaultState().profiles.hombre));
    const copy = JSON.parse(JSON.stringify(original));
    const normalized = normalizeImportedProfile(copy);
    return {
      sameBlockCount: Object.keys(normalized.blocks).length === Object.keys(original.blocks).length,
      sameBlockOrder: JSON.stringify(normalized.blockOrder) === JSON.stringify(original.blockOrder),
      sameExerciseNames: JSON.stringify(normalized.blocks[normalized.blockOrder[0]].days.map(d => d.ex.map(e => e.n)))
                       === JSON.stringify(original.blocks[original.blockOrder[0]].days.map(d => d.ex.map(e => e.n))),
      sameExerciseIds: JSON.stringify(normalized.blocks[normalized.blockOrder[0]].days.map(d => d.ex.map(e => e.id)))
                     === JSON.stringify(original.blocks[original.blockOrder[0]].days.map(d => d.ex.map(e => e.id))),
      sameAccent: accentOf(normalized) === accentOf(original),
    };
  })()
`);
ok('a profile the app itself exported keeps the same blocks', roundTrip.sameBlockCount);
ok('...in the same order', roundTrip.sameBlockOrder);
ok('...with every exercise name intact', roundTrip.sameExerciseNames);
ok('...and every exercise id intact', roundTrip.sameExerciseIds);
ok('...and resolves to the same rendered accent', roundTrip.sameAccent);

/* Plan 008 item 4's STOP condition, carried over from plan 004: the
   normalizer must accept every backup the app itself has ever produced.
   The round trip above only covers an untouched profile (empty log); this
   one populates every parallel map through the app's own writers
   (entry/setRir/setNoteText/setEnergy/setOrder) — the shape a real week of
   training actually produces, now that item 4 runs log/rir through the
   same per-row limits and RIR enum the QR path does — and checks nothing
   in it is trimmed, re-keyed or dropped. Two different exercises on the
   same day (not two days sharing an id — normalizeImportedBlock dedupes
   ids across the whole block, a separate, pre-existing limitation noted in
   plans/README.md, not something this item touches). */
const populatedRoundTrip = call(`
  (function() {
    state = defaultState();
    migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0];
    const ex1 = day.ex[0], ex2 = day.ex[1];

    for (let i = 0; i < ex1.sets; i++) {
      const row = entry(profile, block.id, 1, day.id, ex1.id, ex1.sets)[i];
      row.w = String(40 + i); row.r = String(10 - i); row.done = true;
    }
    const row2 = entry(profile, block.id, 1, day.id, ex2.id, ex2.sets)[0];
    row2.w = '20'; row2.r = '12'; row2.done = true;
    setRir(profile, block.id, 1, day.id, ex1.id, '1');
    setNoteText(profile, block.id, 1, day.id, 'Buena sesión');
    setEnergy(profile, block.id, 1, day.id, 'alta');
    setOrder(profile, block.id, 1, day.id, [ex2.id, ex1.id].concat(day.ex.slice(2).map(e => e.id)));

    const before = JSON.parse(JSON.stringify(profile));
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));

    return {
      sameLog: JSON.stringify(after.log) === JSON.stringify(before.log),
      sameRir: JSON.stringify(after.rir) === JSON.stringify(before.rir),
      sameNotes: JSON.stringify(after.notes) === JSON.stringify(before.notes),
      sameEnergy: JSON.stringify(after.energy) === JSON.stringify(before.energy),
      sameOrder: JSON.stringify(after.order) === JSON.stringify(before.order),
      beforeLog: JSON.stringify(before.log), afterLog: JSON.stringify(after.log),
    };
  })()
`);
ok('a real week of logged sets round-trips through normalizeImportedProfile unchanged',
   populatedRoundTrip.sameLog, populatedRoundTrip.beforeLog + ' vs ' + populatedRoundTrip.afterLog);
ok('...RIR chips too', populatedRoundTrip.sameRir, JSON.stringify(populatedRoundTrip));
ok('...session notes too', populatedRoundTrip.sameNotes, JSON.stringify(populatedRoundTrip));
ok('...energy too', populatedRoundTrip.sameEnergy, JSON.stringify(populatedRoundTrip));
ok('...session order too', populatedRoundTrip.sameOrder, JSON.stringify(populatedRoundTrip));

const validBlock = { name: 'B', weeks: 8, deload: 8, days: [{ name: 'D', ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] }] };
const tooManyBlocksProfile = { blocks: {}, blockOrder: [], log: {} };
for (let i = 0; i < 41; i++) { tooManyBlocksProfile.blocks['b' + i] = validBlock; tooManyBlocksProfile.blockOrder.push('b' + i); }
ok('a profile with more than PROFILE_LIMITS.blocks blocks throws',
   throws('normalizeImportedProfile(' + JSON.stringify(tooManyBlocksProfile) + ')'));

const badBlockProfile = { blocks: { orphan: { name: 'Bloque roto', weeks: 8, deload: 8, days: [] } }, blockOrder: ['orphan'], log: {} };
const badBlockMessage = (() => {
  try { call('normalizeImportedProfile(' + JSON.stringify(badBlockProfile) + ')'); return null; }
  catch (e) { return e.message; }
})();
ok('a block inside a profile that violates IMPORT_LIMITS throws', badBlockMessage !== null);
ok('...and the message names the block', !!badBlockMessage && badBlockMessage.indexOf('Bloque roto') >= 0, badBlockMessage);

const longLabelProfile = { blocks: { b1: validBlock }, blockOrder: ['b1'], log: {}, label: 'x'.repeat(200) };
ok('an over-long label is truncated, not rejected', !throws('normalizeImportedProfile(' + JSON.stringify(longLabelProfile) + ')'));
ok('...to 80 characters', call('normalizeImportedProfile(' + JSON.stringify(longLabelProfile) + ').label.length') === 80);

const weirdThemeProfile = { blocks: { b1: validBlock }, blockOrder: ['b1'], log: {}, theme: 'azul solo' };
ok('an invalid theme comes back as a value in ACCENTS',
   call('ACCENTS.indexOf(normalizeImportedProfile(' + JSON.stringify(weirdThemeProfile) + ').theme) >= 0'));

const orphanMapProfile = {
  blocks: { b1: validBlock }, blockOrder: ['b1'],
  log: { b1: { 'w1-d0': {} }, ghost: { 'w1-d0': {} } },
};
const survivingLogKeys = call('Object.keys(normalizeImportedProfile(' + JSON.stringify(orphanMapProfile) + ').log)');
ok('log entries for a block id not in blocks are dropped',
   survivingLogKeys.indexOf('ghost') < 0 && survivingLogKeys.indexOf('b1') >= 0,
   JSON.stringify(survivingLogKeys));

console.log('\n== normalizeImportedProfile: the app can read back everything it writes (plans/010) ==');

/* The rule plan 004 wrote down and plan 008 item 4 narrowed by accident:
   never reject or alter data the app itself wrote. Every probe below is a
   file the app produces on its own — an untouched new install, a plan with
   something retired, a block migrate() left with one id on two days — and
   each one came back wrong, or not at all, through "Cargar copia",
   "Importar perfil" and the QR "perfil". Foreign pasted blocks keep the
   strict treatment; that is asserted in `== normalizeImportedBlock ==`. */

/* 1. The empty starting plan. emptyBlock() ships exactly one exercise with
      no name yet (the editor shows an empty box to type into), and the
      strict validator threw on it — so a brand-new install's very first
      backup could not be restored by any route. */
const emptyPlanRestore = call(`
  (function() {
    const p = JSON.parse(JSON.stringify(defaultState().profiles.hombre));
    const b = emptyBlock();
    p.blocks = {}; p.blocks[b.id] = b;
    p.blockOrder = [b.id]; p.activeBlock = b.id;
    p.log = {}; p.rir = {}; p.notes = {}; p.energy = {}; p.order = {};
    try {
      const after = normalizeImportedProfile(JSON.parse(JSON.stringify(p)));
      const ab = after.blocks[after.blockOrder[0]];
      return { threw: false, exCount: ab.days[0].ex.length, name: ab.days[0].ex[0].n, reps: ab.days[0].ex[0].reps };
    } catch (e) { return { threw: true, msg: e.message }; }
  })()
`);
ok('the empty starting plan restores at all', emptyPlanRestore.threw === false, emptyPlanRestore.msg);
ok('...keeping its one exercise', emptyPlanRestore.exCount === 1, JSON.stringify(emptyPlanRestore));
ok('...which comes back with a name to show', !!emptyPlanRestore.name, JSON.stringify(emptyPlanRestore));
ok('...and a rep range', !!emptyPlanRestore.reps, JSON.stringify(emptyPlanRestore));

/* 2. "Retirar" is the non-destructive way to drop a day or an exercise: it
      stays in the block behind an `off` flag so its history is never
      touched. The flag was not in the validator's output, so a restore
      silently resurrected everything the user had retired. */
const retiredRoundTrip = call(`
  (function() {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    block.days[1].off = 1;
    block.days[0].ex[2].off = 1;
    const before = { days: block.days.length, ex: block.days[0].ex.length,
                     liveDays: dayList(block).length, liveEx: exList(block.days[0]).length };
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const ab = after.blocks[after.blockOrder[0]];
    return {
      sameDays: ab.days.length === before.days,
      sameEx: ab.days[0].ex.length === before.ex,
      dayOff: ab.days[1].off === 1,
      exOff: ab.days[0].ex[2].off === 1,
      sameLiveDays: dayList(ab).length === before.liveDays,
      sameLiveEx: exList(ab.days[0]).length === before.liveEx,
      before: JSON.stringify(before),
      afterOff: JSON.stringify({ day: ab.days[1].off, ex: ab.days[0].ex[2].off }),
    };
  })()
`);
ok('a retired day is still in the restored block', retiredRoundTrip.sameDays, retiredRoundTrip.before);
ok('...and still retired', retiredRoundTrip.dayOff, retiredRoundTrip.afterOff);
ok('...so the session shows the same live days as before the restore', retiredRoundTrip.sameLiveDays);
ok('a retired exercise is still in the restored day', retiredRoundTrip.sameEx, retiredRoundTrip.before);
ok('...and still retired', retiredRoundTrip.exOff, retiredRoundTrip.afterOff);
ok('...so the day shows the same live exercises as before the restore', retiredRoundTrip.sameLiveEx);

/* 3. migrate() dedupes exercise ids within a day but lets the same id live
      on two days by design (asserted in `== migrate() ==`), because that is
      how the app records "the same lift twice a week". The strict validator
      renames the second one, and the flat id map then filed day B's sets
      under day A's exercise — one day's history gone on restore. */
const dupIdRoundTrip = call(`
  (function() {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const d0 = block.days[0], d2 = block.days[2];
    const src = d0.ex[0];
    d2.ex.push(JSON.parse(JSON.stringify(src)));
    const r0 = entry(profile, block.id, 1, d0.id, src.id, src.sets)[0];
    r0.w = '60'; r0.r = '8'; r0.done = true;
    const r2 = entry(profile, block.id, 1, d2.id, src.id, src.sets)[0];
    r2.w = '75'; r2.r = '5'; r2.done = true;
    setRir(profile, block.id, 1, d2.id, src.id, '1');
    setOrder(profile, block.id, 1, d2.id, [src.id].concat(d2.ex.slice(0, 2).map(e => e.id)));
    const beforeOrder = JSON.stringify(profile.order);

    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const ab = after.blocks[after.blockOrder[0]];
    const ad0 = ab.days[0], ad2 = ab.days[2];
    const s0 = (after.log[ab.id] || {})[slot(1, ad0.id)] || {};
    const s2 = (after.log[ab.id] || {})[slot(1, ad2.id)] || {};
    const rir2 = (after.rir[ab.id] || {})[slot(1, ad2.id)] || {};
    /* Looked up under the id the RESTORED exercise carries, not the one it
       had before: a row filed under an id no card on that day reads is the
       bug, and asserting against src.id would pass straight through it. */
    const id0 = ad0.ex[0].id, id2 = ad2.ex[ad2.ex.length - 1].id;
    const order2 = ((after.order[ab.id] || {})[slot(1, ad2.id)]) || [];
    const live2 = ad2.ex.map(e => e.id);
    return {
      notRenamed: id2 === src.id,
      day0Row: !!(s0[id0] && s0[id0][0] && s0[id0][0].w === '60'),
      day2Row: !!(s2[id2] && s2[id2][0] && s2[id2][0].w === '75'),
      day2Rir: rir2[id2] === '1',
      sameOrder: JSON.stringify(after.order) === beforeOrder,
      orderResolves: order2.length === 3 && order2.every(id => live2.indexOf(id) >= 0),
      srcId: src.id, keptId: id2,
      s2keys: Object.keys(s2).join(','),
      beforeOrder: beforeOrder, afterOrder: JSON.stringify(after.order),
    };
  })()
`);
ok('the same id on two days is not renamed on the restore path',
   dupIdRoundTrip.notRenamed, dupIdRoundTrip.srcId + ' -> ' + dupIdRoundTrip.keptId);
ok("...the first day's sets are still under it", dupIdRoundTrip.day0Row, dupIdRoundTrip.s2keys);
ok("...the second day's sets are too, not merged into the first's",
   dupIdRoundTrip.day2Row, dupIdRoundTrip.s2keys);
ok("...and the second day's RIR chip with them", dupIdRoundTrip.day2Rir, dupIdRoundTrip.s2keys);
ok('...and the recorded session order is unchanged',
   dupIdRoundTrip.sameOrder, dupIdRoundTrip.beforeOrder + ' vs ' + dupIdRoundTrip.afterOrder);
ok('...naming exercises that day actually has', dupIdRoundTrip.orderResolves,
   dupIdRoundTrip.afterOrder);

/* 4. Order was the one parallel map normalizeImportedProfile never re-keyed
      — log and rir went through their normalizers, order was copied across
      with its exercise ids untouched. safeKey() rewrites a blocked id on
      every path, own data included, so an order naming one came back
      pointing at an exercise no card on this phone has, and the session
      silently fell back to plan order. */
const orderRekey = call(`
  (function() {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0];
    day.ex[0].id = '__proto__';
    setOrder(profile, block.id, 1, day.id, ['__proto__', day.ex[1].id, day.ex[2].id]);

    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const ab = after.blocks[after.blockOrder[0]];
    const ad = ab.days[0];
    const ids = ((after.order[ab.id] || {})[slot(1, ad.id)]) || [];
    const live = ad.ex.map(e => e.id);
    return {
      kept: ids.length === 3,
      allResolve: ids.length > 0 && ids.every(id => live.indexOf(id) >= 0),
      ids: ids.join(','), live: live.join(','),
    };
  })()
`);
ok('a restored session order keeps all three of its exercises',
   orderRekey.kept, orderRekey.ids);
ok('...re-keyed to ids the restored day actually has',
   orderRekey.allResolve, orderRekey.ids + ' vs ' + orderRekey.live);

/* 5. The same misfiling, on the strict path that keeps renaming: two days
      sharing a raw id normalize to two different ids, so the id map has to
      be read per day. This is the QR "blocklog" wire format, which is why
      it is asserted against normalizeImportedLog directly rather than
      through a profile. */
const strictDayAwareLog = call(`
  (function() {
    const raw = {
      name: 'B', weeks: 4, deload: 0,
      days: [
        { id: 'da', name: 'A', ex: [{ id: 'chestpress', n: 'Press banca', reps: '8-10' }] },
        { id: 'db', name: 'B', ex: [{ id: 'chestpress', n: 'Press banca', reps: '8-10' }] },
      ],
    };
    const normalized = normalizeImportedBlock(raw);
    const log = {};
    log[slot(1, 'da')] = { chestpress: [{ w: '60', r: '8', done: true }] };
    log[slot(1, 'db')] = { chestpress: [{ w: '75', r: '5', done: true }] };
    const out = normalizeImportedLog(log, raw, normalized);
    const idA = normalized.days[0].ex[0].id, idB = normalized.days[1].ex[0].id;
    const sa = out[slot(1, normalized.days[0].id)] || {};
    const sb = out[slot(1, normalized.days[1].id)] || {};
    return {
      renamed: idB !== idA,
      dayARow: !!(sa[idA] && sa[idA][0] && sa[idA][0].w === '60'),
      dayBRow: !!(sb[idB] && sb[idB][0] && sb[idB][0].w === '75'),
      ids: idA + ' / ' + idB,
      sbKeys: Object.keys(sb).join(','),
    };
  })()
`);
/* 6. An id the re-keying maps could not carry at all. importIdMaps indexes
      by raw, untrusted id, and a plain {} answers `map['__proto__']` with
      the real Object.prototype — truthy — while `put`'s `in` check saw that
      same inherited hit and never stored the mapping. So the rows came back
      filed under the literal key '[object Object]', on every path that
      re-keys: QR "blocklog", a restored backup, a profile file. */
const protoIdReKey = call(`
  (function() {
    /* JSON.parse, not an object literal: { '__proto__': x } as literal
       syntax sets the prototype instead of creating an own property, which
       would test nothing. JSON.parse is also how these ids really arrive. */
    const raw = JSON.parse('{"name":"B","weeks":4,"deload":0,"days":[{"id":"d0","name":"D","ex":[{"id":"__proto__","n":"Press","reps":"8-10"}]}]}');
    const rawLog = JSON.parse('{"w1-d0":{"__proto__":[{"w":"60","r":"8","done":true}]}}');
    const normalized = normalizeImportedBlock(raw);
    const exId = normalized.days[0].ex[0].id;
    const s = normalizeImportedLog(rawLog, raw, normalized)[slot(1, normalized.days[0].id)] || {};
    return {
      renamed: exId !== '__proto__',
      landed: !!(s[exId] && s[exId][0] && s[exId][0].w === '60'),
      keys: Object.keys(s).join(','), exId: exId,
    };
  })()
`);
ok('an exercise id of "__proto__" is renamed rather than kept', protoIdReKey.renamed, protoIdReKey.exId);
ok('...and its sets are re-keyed onto the renamed exercise, not "[object Object]"',
   protoIdReKey.landed, 'slot holds: ' + protoIdReKey.keys + ' (expected ' + protoIdReKey.exId + ')');

ok('a pasted block with one id on two days still renames the second (strict path unchanged)',
   strictDayAwareLog.renamed, strictDayAwareLog.ids);
ok("...day A's sets land on day A's exercise", strictDayAwareLog.dayARow, strictDayAwareLog.sbKeys);
ok("...and day B's on the renamed one, not day A's id",
   strictDayAwareLog.dayBRow, strictDayAwareLog.ids + ' - slot B has ' + strictDayAwareLog.sbKeys);

/* 7. Every other field a block carries. The probes above each name the
      field the bug was about, which is the problem: `off` was found because
      plans/010 named it, and a field added to the editor next year would be
      dropped on restore exactly the same way with nothing to catch it. So
      this one names no fields at all — it walks whatever the fixture holds.

      The invariant is containment, not equality: every own key whose stored
      value is truthy must come back with that value. Deliberately not a
      JSON.stringify compare — normalizeImportedBlock builds `out` in a
      fixed key order that will not match the stored one, and it drops falsy
      optionals on purpose (newExercise() ships alt: '', share: 0, ss: 0,
      and a blank field is genuinely nothing to carry). */
call(`
  function restoreGaps(stored, restored, path, out) {
    if (stored === null || stored === undefined) return out;
    if (Array.isArray(stored)) {
      if (!Array.isArray(restored)) { out.push(path + ': array -> ' + typeof restored); return out; }
      if (restored.length !== stored.length) out.push(path + '.length: ' + stored.length + ' -> ' + restored.length);
      stored.forEach((v, i) => restoreGaps(v, restored[i], path + '[' + i + ']', out));
      return out;
    }
    if (typeof stored === 'object') {
      if (!restored || typeof restored !== 'object') { out.push(path + ': object -> ' + typeof restored); return out; }
      Object.keys(stored).forEach(k => restoreGaps(stored[k], restored[k], path + '.' + k, out));
      return out;
    }
    if (!stored) return out;
    if (restored !== stored) out.push(path + ': ' + JSON.stringify(stored) + ' -> ' + JSON.stringify(restored));
    return out;
  }
  true;
`);

/* 7a. The two blocks nobody hand-wrote: the plan the app ships and the one
       "Nuevo bloque" creates. They grow when the app grows, so a field added
       to either is covered here without anyone remembering to add it. */
const shippedFieldsSurvive = call(`
  (function() {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const fresh = emptyBlock();
    profile.blocks[fresh.id] = fresh;
    profile.blockOrder.push(fresh.id);
    const stored = JSON.parse(JSON.stringify(profile));
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const gaps = [];
    Object.keys(stored.blocks).forEach(k => restoreGaps(stored.blocks[k], after.blocks[k], k, gaps));
    return { gaps: gaps.slice(0, 6), count: gaps.length, blocks: Object.keys(stored.blocks).length };
  })()
`);
ok('both blocks in the fixture are actually there', shippedFieldsSurvive.blocks === 2,
   String(shippedFieldsSurvive.blocks));
ok('every truthy field on the blocks the app ships survives a restore',
   shippedFieldsSurvive.count === 0, shippedFieldsSurvive.gaps.join(' | '));

/* 7b. And the same walk over a block with every optional field the plan
       editor can write set to something — the fields 7a's fixtures happen
       not to use. Values are chosen to sit inside their own clamps (inc on
       the 0.25 grid, add <= weeks, nothing over a txt() cap and no double
       spaces for it to collapse), so anything this reports is a field being
       dropped or rewritten, not a bound doing its job. */
const everyFieldSurvives = call(`
  (function() {
    const block = {
      id: 'block-ks', name: 'Bloque completo', createdAt: '2026-01-02T03:04:05.000Z',
      weeks: 6, deload: 6,
      days: [
        { id: 'da', name: 'Día A', pair: 'A/B', ex: [
          { id: 'sq', n: 'Sentadilla', reps: '5', sets: 5, rest: 180,
            alt: 'Prensa', cue: 'Pecho arriba', setup: 'Barra a 1,40 m',
            add: 2, inc: 2.5, share: 1, ss: 1,
            muscle: 'cuádriceps', pattern: 'rodilla', type: 'compuesto' },
          { id: 'sq-viejo', n: 'Retirado', reps: '10', sets: 3, rest: 90, off: 1 },
        ] },
        { id: 'db', name: 'Día B', off: 1, ex: [
          { id: 'sq', n: 'Sentadilla', reps: '8', sets: 3, rest: 120 },
        ] },
      ],
      phase: {
        1: { r: '3', t: 'Acumulación' }, 2: { r: '2', t: 'Acumulación' },
        3: { r: '2', t: 'Intensificación' }, 4: { r: '1', t: 'Intensificación' },
        5: { r: '1', t: 'Pico' }, 6: { r: '4', t: 'Descarga' },
      },
      priority: ['cuádriceps'],
    };
    const p = { blocks: { 'block-ks': block }, blockOrder: ['block-ks'], activeBlock: 'block-ks',
                log: {}, rir: {}, notes: {}, energy: {}, order: {} };
    const stored = JSON.parse(JSON.stringify(p));
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(p)));
    const gaps = restoreGaps(stored.blocks['block-ks'], after.blocks['block-ks'], 'block', []);
    return { gaps: gaps.slice(0, 6), count: gaps.length };
  })()
`);
ok('every optional field the plan editor writes survives a restore',
   everyFieldSurvives.count === 0, everyFieldSurvives.gaps.join(' | '));

console.log('\n== render cache ==');
const renderCacheProbe = `
  (function() {
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = {};
    profile.log[blockId][slot(1, day.id)][exId] = [{ done: true, w: '50', r: '5' }];

    resetRenderCache();
    const a = lastTimeCached(profile, blockId, day.id, exId, 2);
    const b = lastTimeCached(profile, blockId, day.id, exId, 2);
    const sameRef = a === b;

    resetRenderCache();
    const c = lastTimeCached(profile, blockId, day.id, exId, 2);
    return { sameRef, differentAfterReset: a !== c };
  })()
`;
const renderCacheResult = call(renderCacheProbe);
ok('lastTimeCached returns the same object reference on a second identical call',
   renderCacheResult.sameRef);
ok('lastTimeCached returns a different reference after resetRenderCache() in between',
   renderCacheResult.differentAfterReset);
ok('slugifyCached("constructor") returns the slug of the string, not an inherited property',
   call('slugifyCached("constructor")') === 'constructor');
ok('slugifyCached agrees with slugify for accented Spanish text',
   call('slugifyCached("Press militar")') === call('slugify("Press militar")') &&
   call('slugifyCached("Extensión de tríceps")') === call('slugify("Extensión de tríceps")'));

console.log('\n== diagnostics statistics ==');
ok('fitSlope is positive for a clean upward series', call('fitSlope([1,2,3])') > 0);
ok('fitSlope is 0 for a flat series', call('fitSlope([5,5,5])') === 0);
ok('fitSlope on a single point does not produce NaN', Number.isNaN(call('fitSlope([5])')) === false);

/* ts values are filtered by `t > 0` inside diagMedianGap, so a real base
   timestamp is used rather than 0 — an actual session never logs at the
   epoch, and a 0 would silently drop out of the sample here too. */
const dayMs = 86400000;
const base = dayMs * 1000;
const stampsOf = offsets => offsets.map(o => '{ts:' + (base + o * dayMs) + '}').join(',');
ok('diagMedianGap on an odd number of gaps picks the middle one',
   call('diagMedianGap([' + stampsOf([0, 1, 3, 6]) + '])') === 2,
   String(call('diagMedianGap([' + stampsOf([0, 1, 3, 6]) + '])')));
ok('diagMedianGap on an even number of gaps averages the middle two',
   call('diagMedianGap([' + stampsOf([0, 1, 5]) + '])') === 2.5,
   String(call('diagMedianGap([' + stampsOf([0, 1, 5]) + '])')));
ok('diagMedianGap on too few timestamps returns null rather than NaN',
   call('diagMedianGap([])') === null);

console.log('\n== diagVerdict ==');
ok('a downward trend with a long gap reads as an attendance problem',
   call('diagVerdict("down", { gap: 30 }).lectura').indexOf('Asistencia') === 0);
ok('a downward trend with no gap reads as a real strength loss',
   call('diagVerdict("down", { gap: 1 }).lectura') === 'Pierde fuerza de verdad');
ok('a flat trend with no signals falls through to the generic stall',
   call('diagVerdict("flat", {}).lectura') === 'Estancado, sin una señal clara en el registro');
ok('an upward trend with no signals reads as working as intended',
   call('diagVerdict("up", {}).lectura') === 'Funciona');
ok('too few sessions is its own verdict',
   call('diagVerdict("none", {}).lectura') === 'Aún no hay suficientes sesiones');

console.log('\n== objetivo: la tasa de progresión ==');
/* The single-session cases live in smoke.js, next to the lines they draw.
   What belongs here is the part of the rule that reads MORE than one
   session: the effort-normalised targets and the progression rate the
   block's own history at a weight sets. `weeks` is one array of reps per
   logged week, all at `opts.w` (default 32) unless a set is given as
   [weight, reps]; the target is asked for the week after the last one. */
const estimateProbe = `
  (function(weeks, opts) {
    opts = opts || {};
    const phase = {};
    for (let i = 1; i <= weeks.length + 1; i++) {
      phase[i] = { r: (opts.rirPlan && opts.rirPlan[i - 1] != null ? opts.rirPlan[i - 1] : 2) + ' RIR' };
    }
    const ex = { id: 'E', n: 'x', sets: opts.sets || weeks[0].length, reps: opts.range || '10–15', inc: opts.inc || 2 };
    if (opts.add) ex.add = opts.add;
    const block = { id: 'B', name: 'B', weeks: 8, deload: 0, phase: phase, days: [{ id: 'D', name: 'D', ex: [ex] }] };
    const profile = { log: { B: {} }, rir: { B: {} } };
    weeks.forEach((sets, i) => {
      profile.log.B['w' + (i + 1) + '-D'] = { E: sets.map(r => Array.isArray(r)
        ? { w: String(r[0]), r: String(r[1]), done: true }
        : { w: String(opts.w || 32), r: String(r), done: true }) };
      if (opts.rir && opts.rir[i]) profile.rir.B['w' + (i + 1) + '-D'] = { E: opts.rir[i] };
    });
    /* Same block/day/ex ids on every call, and no drawApp() between them
       to reset the render cache — so reset it here or the second call
       reads the first call's history. */
    resetRenderCache();
    const e = targetEstimate(profile, block, block.days[0], ex, weeks.length + 1);
    return e && { kind: e.kind, note: e.note || '', stall: e.stall, weight: e.weight,
                  reps: e.reps.join('/'), line: targetLine(e), notes: targetNotes(e).join(' | ') };
  })
`;
const estimate = (weeks, opts) => call(estimateProbe)(weeks, opts);
const flat = [12, 12, 10, 10];

/* The effort-normalised line: the number on the line is the number the
   note used to contradict. 12 at 0 RIR is 10 at 2 RIR; plus the week's
   rep is 11, and that is what the line says. */
let e = estimate([[15, 15, 12, 12]], { rir: ['0'] });
ok('a set taken to failure is priced at this week\'s RIR on the line itself',
   e.kind === 'hold' && e.reps === '14/14/11/11' && e.line.indexOf('→ objetivo: 32 kg') === 0, JSON.stringify(e));
ok('and the note says the line already discounts it',
   e.notes.includes('~10 y no 12') && e.notes.includes('ya lo descuenta'), e.notes);
e = estimate([[11, 11, 10, 10]], { rirPlan: [3, 2] });
ok('a week that prescribed more reserve than this one gives those reps back',
   e.reps === '13/13/12/12', JSON.stringify(e));
ok('and says where the extra reps come from', e.notes.includes('no de ganar fuerza'), e.notes);
e = estimate([[11, 11, 10, 10]], { rirPlan: [3, 0] });
ok('but never more than two reps over last week on one set', e.reps === '13/13/12/12', JSON.stringify(e));
/* A middle set that did fewer reps than the last one did not have less in
   it — the last set came after it. 14×15/11/12 at 0 RIR: set two is
   floored at the last set's 12, so it reads 11 at 2 RIR, not 10. */
e = estimate([[[14, 15], [14, 11], [14, 12]]], { rir: ['0'], w: 14, inc: 1 });
ok('a middle set is never read as weaker than the set that came after it',
   e.kind === 'hold' && e.reps === '14/11/11', JSON.stringify(e));

/* The weight that cannot reach the range at this week's RIR — on MOST of
   its sets. 12/11/10/10 at 0 RIR reads 10/9/8/8 at 2 RIR: three of four
   under a 10–15 range, so the weight is the answer, priced so that every
   set lands back inside the range and shown per set. */
e = estimate([[12, 11, 10, 10]], { rir: ['0'] });
ok('sets inside the range at 0 RIR that would mostly fall under it at 2 RIR mean the weight is too heavy',
   e.kind === 'down' && e.note === 'predUnder' && e.weight === 30 && e.reps === '13/12/11/11', JSON.stringify(e));
ok('and the note counts the sets that miss and prices each at this week\'s RIR',
   e.notes.includes('3 de 4 series') && e.notes.includes('~10/9/8/8'), e.notes);
e = estimate([[16, 16, 16, 16]], { rir: ['0'], range: '16–20', w: 12, inc: 1 });
ok('past the Epley ceiling that case says sin estimar rather than guessing', e.kind === 'skip', JSON.stringify(e));
/* The report that changed the rule: 45 × 12/10/9/8 at 0 RIR on 8–12, next
   week at 2 RIR, used to come out as "42,75 × 8". Two sets short at the
   prescription, two not, and the first set has the top of the range in it:
   the weight is owned, the session fell away. Hold, clamp the short sets
   at the bottom, and say where they will land. */
e = estimate([[12, 10, 9, 8]], { rir: ['0'], w: 45, range: '8–12', inc: 0.25 });
ok('half the sets short at the prescription is pacing, not load: the weight holds',
   e.kind === 'hold' && e.weight === 45 && e.reps === '11/9/8/8', JSON.stringify(e));
ok('and the short sets are named with the RIR they will land at',
   e.notes.includes('las series 3 y 4 no llegan a 8') && e.notes.includes('~1 y ~0 RIR') &&
   !e.notes.includes('No es retroceso'), e.notes);
e = estimate([[12, 8, 8, 8]], { rir: ['0'], w: 45, range: '8–12', inc: 0.25 });
ok('but three of four sets short is the weight, and the line shows every set at the lighter one',
   e.kind === 'down' && e.weight === 42.75 && e.reps === '12/8/8/8', JSON.stringify(e));
/* An actual set under the range keeps its case, and now shows the sets —
   priced at the weight the step grid allows, which is a shade under the
   exact one, so the reps come out a shade over the bottom. */
e = estimate([[12, 10, 9, 8]], { rir: ['0'] });
ok('a set under the range prices every set at the weight that puts the last one back at the bottom',
   e.kind === 'down' && e.note === '' && e.weight === 28 && e.reps === '15/13/12/11', JSON.stringify(e));

/* The progression rate. */
e = estimate([flat, [13, 13, 11, 11]]);
ok('a session that gained reps keeps the full rate: one more on every set',
   e.stall === 0 && e.reps === '14/14/12/12', JSON.stringify(e));
e = estimate([flat, flat]);
ok('one flat session is noise — the full rate holds through it',
   e.stall === 1 && e.reps === '13/13/11/11' && e.note === '', JSON.stringify(e));
e = estimate([flat, flat, flat]);
ok('two flat sessions shrink the ask to one rep in total, on the first set with room',
   e.stall === 2 && e.note === 'stallOne' && e.reps === '13/12/10/10', JSON.stringify(e));
ok('and say so', e.notes.includes('2 sesiones sin sumar reps a 32 kg'), e.notes);
e = estimate([flat, flat, flat, flat]);
ok('three flat sessions reset: one step down, the reps rebuilt off the same e1RM',
   e.kind === 'down' && e.note === 'reset' && e.stall === 3 && e.weight === 30 && e.reps === '15/15/13/13', JSON.stringify(e));
ok('and the line points down with the reset named', e.line.indexOf('↘ objetivo: 30 kg') === 0 && e.notes.includes('reinicio'), JSON.stringify(e));
e = estimate([flat, flat, flat, flat], { rirPlan: [3, 2, 2, 1, 1] });
ok('holding the reps while the plan turns the RIR down is a stall, not a hold',
   e.note === 'reset', JSON.stringify(e));
e = estimate([[10, 10, 10, 10], [10, 10, 10, 10], [10, 10, 10, 10], [11, 11, 10, 10]]);
ok('one rep gained anywhere ends the streak', e.stall === 0 && e.reps === '12/12/11/11', JSON.stringify(e));
e = estimate([[[30, 14], [30, 14], [30, 12], [30, 12]], flat, flat, flat]);
ok('a session at another weight ends the walk — the streak is this weight\'s own',
   e.stall === 2 && e.note === 'stallOne', JSON.stringify(e));
e = estimate([flat, flat, flat, flat, [[30, 15], [30, 15], [30, 13], [30, 13]]]);
ok('so the week after a reset starts a fresh run at the lighter weight',
   e.kind === 'hold' && e.stall === 0 && e.reps === '15/15/14/14', JSON.stringify(e));
const long = [18, 17, 16, 16];
e = estimate([long, long, long, long], { range: '12–20', w: 12, inc: 1 });
ok('past the Epley ceiling a stall cannot be priced, so it is said in words instead',
   e.kind === 'hold' && e.note === 'stallLong' && e.reps === '19/17/16/16', JSON.stringify(e));

/* The sets the plan asks for this week, not the sets logged last time. */
e = estimate([[15, 15, 12, 12]], { rir: ['2+'], add: 2 });
ok('a set the plan adds this week gets the tail of the observed decay',
   e.reps === '15/15/13/13/12' && e.notes.includes('la serie 5 no tiene referencia'), JSON.stringify(e));
e = estimate([flat, flat, flat, flat], { add: 5 });
ok('and a reset prices the added set too', e.note === 'reset' && e.reps === '15/15/13/13/12', JSON.stringify(e));
e = estimate([[15, 15, 15, 15]], { rir: ['2+'], add: 2 });
ok('a jump prices one number for every set and does not extend', e.kind === 'up' && e.reps === '12', JSON.stringify(e));

console.log('\n== __proto__ / constructor / prototype ids are never trusted as keys (plans/008 item 2) ==');
ok('safeKey blocks __proto__', call("safeKey('__proto__')") === '');
ok('safeKey blocks constructor', call("safeKey('constructor')") === '');
ok('safeKey blocks prototype', call("safeKey('prototype')") === '');
ok('safeKey leaves an ordinary id alone', call("safeKey('squat')") === 'squat');

const protoExBlock = Object.assign({}, minimalBlock, {
  days: [{ name: 'Día 1', ex: [{ id: '__proto__', n: 'Ex', sets: 3, reps: '10-15' }] }],
});
ok('an exercise id of "__proto__" is never kept as the exercise\'s own id',
   call('normalizeImportedBlock(' + JSON.stringify(protoExBlock) + ').days[0].ex[0].id') !== '__proto__');

const protoDayBlock = Object.assign({}, minimalBlock, {
  days: [{ id: '__proto__', name: 'Día 1', ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] }],
});
ok('a day id of "__proto__" is never kept as the day\'s own id',
   call('normalizeImportedBlock(' + JSON.stringify(protoDayBlock) + ').days[0].id') !== '__proto__');

const rowsForProbe = call(`
  (function() {
    const profile = { log: {} };
    const rows = rowsFor(profile, 'b1', 1, 'd0', '__proto__');
    return { isArray: Array.isArray(rows), length: rows.length };
  })()
`);
ok('rowsFor hands back a real (empty) array for a "__proto__" exercise id, not Object.prototype',
   rowsForProbe.isArray && rowsForProbe.length === 0, JSON.stringify(rowsForProbe));

/* Built via JSON.parse inside the sandbox rather than an object literal out
   here: `{ '__proto__': x }` as literal syntax sets the prototype instead
   of creating an own property, which would test nothing — the exact case
   this guards against is JSON.parse (CreateDataProperty, a real own
   property either way), which is how every one of these ids actually
   arrives, from a file or a QR scan. */
const protoBlockKeyJson = JSON.stringify({ blocks: { PLACEHOLDER: validBlock }, blockOrder: ['PLACEHOLDER'], log: {} })
  .replace(/PLACEHOLDER/g, '__proto__');
const protoKeyProbe = call(`
  (function() {
    const raw = JSON.parse(${JSON.stringify(protoBlockKeyJson)});
    const normalized = normalizeImportedProfile(raw);
    const keys = Object.keys(normalized.blocks);
    return {
      noProtoBlockKey: keys.indexOf('__proto__') < 0,
      onePlainBlock: keys.length === 1,
      orderMatchesTheRenamedKey: normalized.blockOrder.length === 1 && normalized.blockOrder[0] === keys[0],
      activeIsTheRenamedKey: normalized.activeBlock === keys[0],
    };
  })()
`);
ok('a block keyed "__proto__" in a restored profile is renamed rather than setting Object.prototype',
   protoKeyProbe.noProtoBlockKey && protoKeyProbe.onePlainBlock, JSON.stringify(protoKeyProbe));
ok('...and blockOrder/activeBlock follow the rename',
   protoKeyProbe.orderMatchesTheRenamedKey && protoKeyProbe.activeIsTheRenamedKey, JSON.stringify(protoKeyProbe));
ok('Object.prototype itself is never touched by any of the above', Object.getPrototypeOf({}) === Object.prototype);

console.log('\n== normalizeImportedLog / normalizeImportedRir (plans/008 item 4) ==');
const logProbe = call(`
  (function() {
    const rawBlock = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };
    const normalized = normalizeImportedBlock(rawBlock);
    const dayId = normalized.days[0].id, exId = normalized.days[0].ex[0].id;

    const goodLog = {};
    goodLog['w1-' + dayId] = {};
    goodLog['w1-' + dayId][exId] = [{ w: '50', r: '10', done: true }];
    const outLog = normalizeImportedLog(goodLog, rawBlock, normalized);
    const roundTripOk = !!(outLog['w1-' + dayId] && outLog['w1-' + dayId][exId] && outLog['w1-' + dayId][exId][0].w === '50');

    const hugeLog = {};
    hugeLog['w1-' + dayId] = {};
    hugeLog['w1-' + dayId][exId] = new Array(LOG_ROW_HARD_CAP + 1).fill({ w: '1', r: '1', done: false });
    let threw = false;
    try { normalizeImportedLog(hugeLog, rawBlock, normalized); } catch (e) { threw = true; }

    const goodRir = {};
    goodRir['w1-' + dayId] = {};
    goodRir['w1-' + dayId][exId] = '1';
    const outRir = normalizeImportedRir(goodRir, rawBlock, normalized);
    const rirOk = !!(outRir['w1-' + dayId] && outRir['w1-' + dayId][exId] === '1');

    const badRir = {};
    badRir['w1-' + dayId] = {};
    badRir['w1-' + dayId][exId] = 'not-a-real-rir';
    const outBadRir = normalizeImportedRir(badRir, rawBlock, normalized);
    const badRirDropped = !outBadRir['w1-' + dayId];

    return { roundTripOk, threwOnHugeRows: threw, rirOk, badRirDropped };
  })()
`);
ok('normalizeImportedLog keeps a well-formed row', logProbe.roundTripOk, JSON.stringify(logProbe));
ok('normalizeImportedLog rejects a row array past LOG_ROW_HARD_CAP rather than silently truncating it',
   logProbe.threwOnHugeRows, JSON.stringify(logProbe));
ok('normalizeImportedRir keeps a value in RIR_OPTIONS', logProbe.rirOk, JSON.stringify(logProbe));
ok('normalizeImportedRir drops a value outside RIR_OPTIONS', logProbe.badRirDropped, JSON.stringify(logProbe));

console.log('\n== normalizeImportedProfile: a restore runs the same per-row limits QR already had (plans/008 item 4) ==');
const restoreProbe = call(`
  (function() {
    const block = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };

    const hugeProfile = {
      blocks: { b1: JSON.parse(JSON.stringify(block)) }, blockOrder: ['b1'], activeBlock: 'b1',
      log: { b1: { 'w1-d0': { e1: new Array(LOG_ROW_HARD_CAP + 1).fill({ w: '1', r: '1', done: false }) } } },
    };
    let threw = false, message = '';
    try { normalizeImportedProfile(hugeProfile); } catch (e) { threw = true; message = e.message; }

    const badRirProfile = {
      blocks: { b1: JSON.parse(JSON.stringify(block)) }, blockOrder: ['b1'], activeBlock: 'b1',
      rir: { b1: { 'w1-d0': { e1: 'nope' } } },
    };
    const normalizedRirProfile = normalizeImportedProfile(badRirProfile);
    const rirDropped = !normalizedRirProfile.rir.b1 || !normalizedRirProfile.rir.b1['w1-d0'];

    const notesEnergyProfile = {
      blocks: { b1: JSON.parse(JSON.stringify(block)) }, blockOrder: ['b1'], activeBlock: 'b1',
      notes: { b1: { 'w1-d0': 'x'.repeat(400) } },
      energy: { b1: { 'w1-d0': 'not-a-real-level' } },
    };
    const normalizedNE = normalizeImportedProfile(notesEnergyProfile);

    return {
      threwOnHugeRows: threw, message,
      rirDropped,
      noteCapped: normalizedNE.notes.b1['w1-d0'].length === NOTE_LIMIT,
      badEnergyDropped: !normalizedNE.energy.b1 || !normalizedNE.energy.b1['w1-d0'],
    };
  })()
`);
ok('restoring a profile with a row array past LOG_ROW_HARD_CAP is rejected, not silently restored',
   restoreProbe.threwOnHugeRows, JSON.stringify(restoreProbe));
ok('...and the message names the block', restoreProbe.message.indexOf('"B"') >= 0, restoreProbe.message);
ok('restoring a profile drops a RIR value outside RIR_OPTIONS', restoreProbe.rirDropped, JSON.stringify(restoreProbe));
ok('restoring a profile caps a note to NOTE_LIMIT', restoreProbe.noteCapped, JSON.stringify(restoreProbe));
ok('restoring a profile drops an energy value outside ENERGY_OPTIONS', restoreProbe.badEnergyDropped, JSON.stringify(restoreProbe));

console.log('\n== moveExLog / moveExRir / moveExOrder merge rather than overwrite (plans/008 items 1, 3) ==');
const moveProbe = call(`
  (function() {
    const profile = {
      log: { B: {
        'w1-d0': { e1: [{ w: '50', r: '10', done: true }] },
        'w1-d1': { e1: [{ w: '60', r: '8', done: true }] },
      } },
      rir: { B: { 'w1-d0': { e1: '1' }, 'w1-d1': { e1: '0' } } },
      order: { B: { 'w1-d0': ['e1', 'e2'], 'w1-d1': ['e3'] } },
    };
    moveExLog(profile, 'B', 'd1', 'd0', 'e1');
    const mergedRows = profile.log.B['w1-d0'].e1;
    const sourceLogGone = !profile.log.B['w1-d1'] || !profile.log.B['w1-d1'].e1;

    moveExRir(profile, 'B', 'd1', 'd0', 'e1');
    const rirKeptTheDestinations = profile.rir.B['w1-d0'].e1 === '1';

    moveExOrder(profile, 'B', 'd1', 'd0', 'e1');
    const orderRemoved = profile.order.B['w1-d1'].indexOf('e1') < 0;
    const orderAdded = profile.order.B['w1-d0'].indexOf('e1') >= 0;

    /* Calling it again must be a no-op, not a second overwrite — the
       source has nothing left under this id after the first move. */
    moveExLog(profile, 'B', 'd1', 'd0', 'e1');
    const stillBothRows = profile.log.B['w1-d0'].e1.length === 2;

    return { mergedRows: JSON.stringify(mergedRows), sourceLogGone, rirKeptTheDestinations, orderRemoved, orderAdded, stillBothRows };
  })()
`);
ok('moveExLog concatenates the destination day\'s own rows with the moved ones, in order',
   JSON.parse(moveProbe.mergedRows).length === 2 &&
   JSON.parse(moveProbe.mergedRows)[0].w === '50' && JSON.parse(moveProbe.mergedRows)[1].w === '60',
   moveProbe.mergedRows);
ok('...and empties the source rather than leaving a stale copy', moveProbe.sourceLogGone, JSON.stringify(moveProbe));
ok('moveExRir never overwrites an RIR chip the destination already has',
   moveProbe.rirKeptTheDestinations, JSON.stringify(moveProbe));
ok('moveExOrder drops the id from the source day\'s recorded order', moveProbe.orderRemoved, JSON.stringify(moveProbe));
ok('...and appends it to the destination\'s', moveProbe.orderAdded, JSON.stringify(moveProbe));
ok('calling moveExLog again after the move destroys nothing (idempotent once the source is empty)',
   moveProbe.stillBothRows, JSON.stringify(moveProbe));

console.log('\n== plan editor "Guardar cambios": same exercise id on two days is not confused (plans/008 item 1) ==');
const peSaveProbe = call(`
  (function() {
    /* The same shape editPlan.onclick builds: a deep clone of the block,
       and an origin map filled by walking every day's exercises. The bug
       this guards against only shows up with the SAME exercise id on two
       different days, which migrate() allows on purpose. */
    const block = {
      id: 'B', name: 'Block', weeks: 8, deload: 0,
      days: [
        { id: 'd0', name: 'Day A', ex: [{ id: 'e1', n: 'Chest', sets: 3, reps: '10-15' }] },
        { id: 'd1', name: 'Day B', ex: [{ id: 'e1', n: 'Chest', sets: 3, reps: '10-15' }] },
      ],
    };
    const profile = {
      log: { B: {
        'w1-d0': { e1: [{ w: '50', r: '10', done: true }] },
        'w1-d1': { e1: [{ w: '60', r: '8', done: true }] },
      } },
      rir: { B: {} }, order: { B: {} },
    };

    const draft = JSON.parse(JSON.stringify(block));
    const originalDay = new Map();
    draft.days.forEach(day => day.ex.forEach(ex => originalDay.set(ex, day.id)));

    /* peSave's catch-up loop, run without touching anything in the sheet —
       the failure this reproduces happened on an unmodified save. */
    draft.days.forEach(day => {
      day.ex.forEach(ex => {
        const from = originalDay.get(ex);
        if (from && from !== day.id) {
          moveExLog(profile, 'B', from, day.id, ex.id);
          moveExRir(profile, 'B', from, day.id, ex.id);
          moveExOrder(profile, 'B', from, day.id, ex.id);
        }
      });
    });

    return JSON.parse(JSON.stringify(profile.log.B));
  })()
`);
ok('an unmodified save leaves day A\'s rows alone',
   peSaveProbe['w1-d0'] && peSaveProbe['w1-d0'].e1 && peSaveProbe['w1-d0'].e1.length === 1 && peSaveProbe['w1-d0'].e1[0].w === '50',
   JSON.stringify(peSaveProbe));
ok('...and day B\'s — the id-only map used to erase one of them',
   peSaveProbe['w1-d1'] && peSaveProbe['w1-d1'].e1 && peSaveProbe['w1-d1'].e1.length === 1 && peSaveProbe['w1-d1'].e1[0].w === '60',
   JSON.stringify(peSaveProbe));

console.log('\n== setup: the active profile is always people[0] (plans/008 item 5) ==');
const setupOrderProbe = call(`
  (function() {
    const before = state.activeProfile;
    state.activeProfile = 'mujer';
    openSetup(false);
    const keys = setupDraft.people.map(p => p.key);
    state.activeProfile = before;
    return keys;
  })()
`);
ok('the second profile, when active, is people[0] — insertion order alone used to put the first profile there, ' +
   'so turning on "Solo yo" while active as the second profile silently renamed and switched onto the first',
   setupOrderProbe[0] === 'mujer' && setupOrderProbe.indexOf('hombre') > 0,
   JSON.stringify(setupOrderProbe));

console.log('\n== plate bounds and fitPlates hard cap (plans/008 item 6) ==');
const platesProfile = {
  profiles: { hombre: { blocks: {}, blockOrder: [], log: {} } },
  activeProfile: 'hombre',
  prefs: { units: 'kg', plates: [0.0001, 20, 10] },
};
const migratedPlates = call('state = ' + JSON.stringify(platesProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
ok('a near-zero plate is filtered out by the PLATE_MIN/MAX bounds, not just p > 0',
   migratedPlates.prefs.plates.indexOf(0.0001) < 0 && migratedPlates.prefs.plates.indexOf(20) >= 0,
   JSON.stringify(migratedPlates.prefs.plates));
ok('fitPlates never grows past FIT_PLATES_MAX even fed a plate size migrate() would already reject',
   call('fitPlates(1000000, [0.0001]).plates.length') <= call('FIT_PLATES_MAX'));
ok('fitPlates reports a remainder that matches the plates actually returned, even when reconstruction hits FIT_PLATES_MAX',
   call('(function(){var f=fitPlates(60,[0.25]);return Math.abs(f.plates.reduce((a,b)=>a+b,0)+f.remainder-60)<1e-6;})()'),
   String(call('JSON.stringify(fitPlates(60,[0.25]))')));
ok('fitPlates picks the fewest plates for an exact fit, not just any feasible one',
   call('fitPlates(30, [20, 15, 5]).plates.length') === 2,
   String(call('JSON.stringify(fitPlates(30, [20, 15, 5]))')));

console.log('\n== unit-stamped rows: diagnostics and the review convert instead of blending kg/lb (plans/008 item 9) ==');
ok('convertWeight round-trips kg -> lb -> kg',
   Math.abs(call('convertWeight(convertWeight(100, "kg", "lb"), "lb", "kg")') - 100) < 1e-9);
ok('convertWeight is a no-op within the same unit', call('convertWeight(100, "kg", "kg")') === 100);
ok('rowWeight reads an unstamped row as kg', call('rowWeight({ w: "100" }, "kg")') === 100);
ok('rowWeight converts a row stamped lb when read as kg',
   Math.abs(call('rowWeight({ w: "220.462262185", u: "lb" }, "kg")') - 100) < 1e-6);
const diagUnitProbe = call(`
  (function() {
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const block = profile.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.rir = { [blockId]: {} };
    /* Week 1 logged in kg, week 2 in lb (a mid-block unit switch) — same
       real weight both times, 100 kg == 220.462... lb. */
    profile.log[blockId][slot(1, day.id)] = { [exId]: [{ w: '100', r: '5', done: true }] };
    profile.log[blockId][slot(2, day.id)] = { [exId]: [{ w: '220.462262185', r: '5', done: true, u: 'lb' }] };
    state.prefs.units = 'kg';
    const points = diagPoints(profile, exId, blockId);
    state.prefs.units = 'kg';
    return points.map(p => Math.round(p.weight * 100) / 100);
  })()
`);
ok('diagPoints converts a lb-stamped week back to kg instead of reading 220 kg on the trend line',
   JSON.stringify(diagUnitProbe) === JSON.stringify([100, 100]), JSON.stringify(diagUnitProbe));
const reviewUnitProbe = call(`
  (function() {
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const block = profile.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [exId]: [{ w: '100', r: '5', done: true }] };
    profile.log[blockId][slot(2, day.id)] = { [exId]: [{ w: '220.462262185', r: '5', done: true, u: 'lb' }] };
    state.prefs.units = 'kg';
    const byWeekRaw = blockTonnageByWeek(profile, block);
    const byWeekConverted = blockTonnageByWeek(profile, block, convertedSetVolume);
    state.prefs.units = 'kg';
    return { raw: byWeekRaw.slice(0, 2), converted: byWeekConverted.slice(0, 2) };
  })()
`);
ok('the raw setVolume() the session view uses is untouched — still blends the lb number in as if it were kg',
   Math.round(reviewUnitProbe.raw[1]) === Math.round(220.462262185 * 5), JSON.stringify(reviewUnitProbe));
ok('convertedSetVolume converts that same week to kg instead, so both weeks read as the same tonnage',
   Math.round(reviewUnitProbe.converted[0]) === Math.round(reviewUnitProbe.converted[1]), JSON.stringify(reviewUnitProbe));

console.log('\n== bestForExercise: one id, same answer as the whole-profile scan (plans/008 item 14) ==');
/* drawCard asks for one exercise's all-time best instead of every exercise's,
   which is only safe while the two agree exactly — including on which session
   they leave out, or a set would beat itself and every card would claim a
   record. */
const bestProbe = `
  (function() {
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const a = day.ex[0].id, b = day.ex[1].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [a]: [{ done: true, w: '60', r: '8' }],
                                              [b]: [{ done: true, w: '30', r: '8' }] };
    profile.log[blockId][slot(2, day.id)] = { [a]: [{ done: true, w: '80', r: '8' },
                                                    { done: false, w: '200', r: '8' },
                                                    { done: true, w: 'x', r: '8' }] };
    const here = slot(2, day.id);
    const all = bestByExercise(profile, blockId, here);
    const one = bestForExercise(profile, a, blockId, here);
    const noSkip = bestForExercise(profile, a, blockId, 'w9-dz');
    return {
      agreesWithSkip: one[a] === all[a],
      skipped: one[a],
      unskipped: noSkip[a],
      onlyOneKey: Object.keys(one).length,
      missingIsAbsent: (a + '|' + (a in bestForExercise(profile, 'nosuchexercise', blockId, here))),
    };
  })()
`;
const bestResult = call(bestProbe);
ok('bestForExercise matches bestByExercise for the id it was asked about',
   bestResult.agreesWithSkip, 'one=' + bestResult.skipped);
ok('it excludes the session being drawn, exactly as the full scan does',
   bestResult.skipped === 60, 'got ' + bestResult.skipped);
ok('and includes that session when it is not the one being skipped',
   bestResult.unskipped === 80, 'got ' + bestResult.unskipped);
ok('an unticked set and an unparseable weight are both ignored',
   bestResult.unskipped === 80);
ok('it reports the one id and nothing else', bestResult.onlyOneKey === 1);
ok('an exercise with no history is absent rather than zero',
   bestResult.missingIsAbsent.endsWith('|false'), bestResult.missingIsAbsent);

console.log('\n== pruneLog: browsing a week does not leave placeholder rows in storage (plans/008 item 14) ==');
/* entry() pads the drawn session's rows in place, so paging through a block
   used to persist a full set of blank rows for every week looked at. */
const pruneProbe = `
  (function() {
    state = defaultState();
    const profile = state.profiles[state.activeProfile];
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const ex = day.ex[0].id, ex2 = day.ex[1].id;
    const blank = () => ({ w: '', r: '', done: false });

    profile.log[blockId] = {};
    /* week 1: two real sets, then padding entry() added on the way past */
    profile.log[blockId][slot(1, day.id)] = {
      [ex]: [{ done: true, w: '60', r: '8' }, { w: '62,5', r: '', done: false }, blank(), blank()],
      [ex2]: [blank(), blank()],
    };
    /* week 2: looked at, never trained */
    profile.log[blockId][slot(2, day.id)] = { [ex]: [blank(), blank(), blank()] };
    /* week 3: a blank row sitting BEFORE a real one — a gap, not padding */
    profile.log[blockId][slot(3, day.id)] = { [ex]: [blank(), { done: true, w: '70', r: '5' }] };

    drawnSlot = null;
    pruneLog();
    const w1 = profile.log[blockId][slot(1, day.id)];
    const w3 = profile.log[blockId][slot(3, day.id)];
    return {
      trimmedPadding: w1[ex].length,
      keptTypedWeight: w1[ex][1] && w1[ex][1].w,
      droppedEmptyExercise: ex2 in w1,
      droppedEmptySlot: slot(2, day.id) in profile.log[blockId],
      keptGapBeforeRealRow: w3[ex].length,
    };
  })()
`;
const pruneResult = call(pruneProbe);
ok('trailing untouched rows are dropped', pruneResult.trimmedPadding === 2,
   'kept ' + pruneResult.trimmedPadding);
ok('a row with only a weight typed into it is not untouched',
   pruneResult.keptTypedWeight === '62,5', String(pruneResult.keptTypedWeight));
ok('an exercise left with nothing goes with them', pruneResult.droppedEmptyExercise === false);
ok('a week that was only ever looked at leaves no slot behind',
   pruneResult.droppedEmptySlot === false);
ok('a blank row between two real ones is a gap and stays put',
   pruneResult.keptGapBeforeRealRow === 2, 'kept ' + pruneResult.keptGapBeforeRealRow);

/* The session on screen is the exception: its padded rows are the objects the
   <input> handlers are holding, so cutting them out would send a weight typed
   into the last set nowhere. */
const pruneLiveProbe = `
  (function() {
    state = defaultState();
    const profile = state.profiles[state.activeProfile];
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const ex = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [ex]: [{ done: true, w: '60', r: '8' },
                                                     { w: '', r: '', done: false }] };
    profile.log[blockId][slot(2, day.id)] = { [ex]: [{ w: '', r: '', done: false }] };
    drawnSlot = { profile: state.activeProfile, block: blockId, key: slot(1, day.id) };
    pruneLog();
    return {
      liveKept: profile.log[blockId][slot(1, day.id)][ex].length,
      otherPruned: slot(2, day.id) in profile.log[blockId],
    };
  })()
`;
const pruneLiveResult = call(pruneLiveProbe);
ok('the session being drawn keeps its padding, handlers are holding those rows',
   pruneLiveResult.liveKept === 2, 'kept ' + pruneLiveResult.liveKept);
ok('every other session is still pruned', pruneLiveResult.otherPruned === false);

console.log('\n== seed plans match their published block files (plans/008 item 12) ==');
/* js/data.js:6-9 asks whoever edits the seed plans by hand to also
   regenerate blocks/hombre-bloque-1.json and blocks/mujer-bloque-1.json — a
   comment nothing checks. This turns it into an assertion: the two files
   are exports of exactly this data, and drift would ship a fresh install
   with a Bloque 1 "Importar JSON" cannot get back to. */
const readBlockFile = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks', name), 'utf8'));
const hombreBlockFile = readBlockFile('hombre-bloque-1.json');
const mujerBlockFile = readBlockFile('mujer-bloque-1.json');
ok('blocks/hombre-bloque-1.json days match DEFAULT_DAYS_TU',
   JSON.stringify(call('DEFAULT_DAYS_TU')) === JSON.stringify(hombreBlockFile.days));
ok('blocks/hombre-bloque-1.json phase matches DEFAULT_PHASE_TU',
   JSON.stringify(call('DEFAULT_PHASE_TU')) === JSON.stringify(hombreBlockFile.phase));
ok('blocks/hombre-bloque-1.json priority matches DEFAULT_PRIORITY_TU',
   JSON.stringify(call('DEFAULT_PRIORITY_TU')) === JSON.stringify(hombreBlockFile.priority));
ok('blocks/mujer-bloque-1.json days match DEFAULT_DAYS_PAREJA',
   JSON.stringify(call('DEFAULT_DAYS_PAREJA')) === JSON.stringify(mujerBlockFile.days));
ok('blocks/mujer-bloque-1.json phase matches DEFAULT_PHASE_PAREJA',
   JSON.stringify(call('DEFAULT_PHASE_PAREJA')) === JSON.stringify(mujerBlockFile.phase));
ok('blocks/mujer-bloque-1.json priority matches DEFAULT_PRIORITY_PAREJA',
   JSON.stringify(call('DEFAULT_PRIORITY_PAREJA')) === JSON.stringify(mujerBlockFile.priority));

console.log('\n== phaseRir: the number next to "RIR" wins, not the lowest digit anywhere (plans/008 item 17) ==');
ok('a week number ahead of the RIR phrase no longer wins',
   call('phaseRir({ phase: [{ r: "Semana 1: 2-3 RIR" }] }, 0)') === 2);
ok('a one-off number elsewhere no longer wins over the RIR range',
   call('phaseRir({ phase: [{ r: "Top set + 2 back-offs, 1 RIR" }] }, 0)') === 1);
ok('a plain range still reads correctly',
   call('phaseRir({ phase: [{ r: "2-3 RIR" }] }, 0)') === 2);
ok('no RIR phrase falls back to the lowest digit anywhere',
   call('phaseRir({ phase: [{ r: "Semana 3 de 5" }] }, 0)') === 3);
ok('no digits at all returns null',
   call('phaseRir({ phase: [{ r: "Deload" }] }, 0)') === null);

console.log('\n== buildHeatmapSVG: week count is calendar days, not milliseconds (plans/008 item 16) ==');
const heatWeeks = heat => {
  const m = heat.svg.match(/viewBox="0 0 (\d+)/);
  return Math.round((Number(m[1]) - 16) / 13);
};
ok('two Mondays exactly 14 days apart span 3 weeks (inclusive)',
   heatWeeks(call('buildHeatmapSVG({ "2026-01-05": 1, "2026-01-19": 1 })')) === 3);
ok('a single trained day is one week',
   heatWeeks(call('buildHeatmapSVG({ "2026-06-10": 1 })')) === 1);
ok('maxW comes back alongside the markup instead of round-tripping through a data attribute',
   call('buildHeatmapSVG({ "2026-06-10": 1 }).maxW') > 0);

console.log('\n== storage-failure paths (plans/008 item 18) ==');
{
  const origGetItem = call('localStorage.getItem');
  const origShowRecovery = call('showRecovery');
  call('__recoveryCalls = [];');
  app.showRecovery = (e, raw, mode) => { call('__recoveryCalls').push({ msg: e && e.message, raw, mode }); };
  app.localStorage.getItem = () => { throw new Error('getItem blocked'); };
  call('load()');
  ok('a thrown read goes to recovery instead of seeding a fresh device over it',
     call('__recoveryCalls.length') === 1 && call('__recoveryCalls[0].raw') === null,
     JSON.stringify(call('__recoveryCalls')));
  ok('a thrown read is tagged as a read failure, not the corrupt-data or draw-failure copy',
     call('__recoveryCalls[0].mode') === 'read',
     JSON.stringify(call('__recoveryCalls')));
  app.localStorage.getItem = origGetItem;
  app.showRecovery = origShowRecovery;
}

{
  /* frozen/ready reflect whatever the harness's inert DOM stub left them at
     (drawApp() cannot fully draw against `inert()` elements) — orthogonal to
     what this checks, so pin them to a normal, unfrozen state around it. */
  const savedFrozen = call('frozen'), savedReady = call('ready');
  call('frozen = false; ready = true; held = false; quotaToastShown = false;');
  const origSetItem = call('localStorage.setItem');
  const origToast = call('toast');
  call('__toastCalls = 0;');
  app.toast = () => { call('__toastCalls++;'); };
  app.localStorage.setItem = () => { throw new Error('quota exceeded'); };
  call('writeState(true)'); call('writeState(true)');
  ok('a failed save shows the toast once, not on every retry', call('__toastCalls') === 1);
  app.localStorage.setItem = origSetItem;
  app.toast = origToast;
  call('quotaToastShown = false; frozen = ' + savedFrozen + '; ready = ' + savedReady + ';');
}

console.log('\n== calculator correctness: exact plate fit, no duplicate warm-up rows (plans/008 item 19) ==');
ok('25/20/15/10 for a 30 target finds a combination that fits exactly, not the old greedy shortfall of 5',
   call('fitPlates(30, [25, 20, 15, 10]).remainder') === 0,
   String(call('JSON.stringify(fitPlates(30, [25, 20, 15, 10]))')));
ok('the plates reported for that fit really do sum to the target',
   call('fitPlates(30, [25, 20, 15, 10]).plates.reduce((a,b)=>a+b,0)') === 30);
ok('a target with no exact combination still reports the true shortfall',
   call('fitPlates(23, [20, 10, 5]).remainder') === 3,
   String(call('JSON.stringify(fitPlates(23, [20, 10, 5]))')));
ok('warmupRamp collapses three identical rounded steps into one (target 15, increment 10)',
   call('JSON.stringify(warmupRamp(15, 10, 0))') === '[10]',
   String(call('JSON.stringify(warmupRamp(15, 10, 0))')));
ok('warmupRamp keeps three distinct steps when they are actually distinct',
   call('warmupRamp(100, 2.5, 0).length') === 3);

console.log('\n== requestWakeLock: a rest skipped mid-request releases instead of holding the lock (plans/008 item 15) ==');
(async () => {
  let released = false;
  const fakeLock = { release: () => { released = true; return Promise.resolve(); } };
  app.navigator.wakeLock = { request: () => Promise.resolve(fakeLock) };
  await call('requestWakeLock()');
  ok('no rest in flight: the lock is released, not stored', released === true && call('wakeLock') == null);

  released = false;
  call('tId = 1');
  await call('requestWakeLock()');
  ok('a rest still running: the lock is kept', released === false && call('wakeLock') === fakeLock);
  call('tId = null; wakeLock = null;');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
