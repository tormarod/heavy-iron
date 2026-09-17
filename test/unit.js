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

  /* The same order as the <script> tags in index.html — app.js last, because
     it is the one that wires the others and then calls load(). */
  ['js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
   'js/profile-transfer.js', 'js/app.js'].forEach(f => {
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

/* The weight that cannot reach the range at this week's RIR. */
e = estimate([[12, 11, 10, 10]], { rir: ['0'] });
ok('sets inside the range at 0 RIR that would fall under it at 2 RIR mean the weight is too heavy',
   e.kind === 'down' && e.note === 'predUnder' && e.weight === 30 && e.reps === '10', JSON.stringify(e));
ok('and the note prices the current weight at this week\'s RIR', e.notes.includes('~8 reps'), e.notes);
e = estimate([[16, 16, 16, 16]], { rir: ['0'], range: '16–20', w: 12, inc: 1 });
ok('past the Epley ceiling that case says sin estimar rather than guessing', e.kind === 'skip', JSON.stringify(e));

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
