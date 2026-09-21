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

/* The same order as the <script> tags in index.html — theme-init.js first
   because it loads in <head>, app.js after the ten it wires and then calls
   load() from, and boot-guard.js last, after app.js, because it is the one
   script that has to run even when app.js could not.

   Hoisted out of loadApp() because the section below asserts index.html and
   sw.js agree with it; a second copy would be a fourth list to keep in step. */
const SHELL_SCRIPTS = [
  'js/theme-init.js', 'js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
  'js/profile-transfer.js', 'js/calculator.js', 'js/rest-timer.js',
  'js/chart.js', 'js/volume-sheet.js', 'js/qr-transfer.js',
  'js/app.js', 'js/boot-guard.js',
];

/* `omit` drops files from the load, which is how the no-op stubs in app.js
   get exercised: a returning user's service worker can serve an index.html
   whose script tag for a split-out file is missing from the cache, and the
   stubs are the only thing between that and a recovery screen. */
function loadApp(omit = []) {
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

  SHELL_SCRIPTS.filter(f => !omit.includes(f)).forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

/* Before loadApp() runs, so that a file missing from disk is reported as a
   failed assertion here rather than as an exception that takes the suite
   down before it can say which list is wrong.

   AGENTS.md asks for four things to move together when a js/ file is added:
   the <script> tag in index.html, the SHELL entry in sw.js, a guarded wire*()
   call, and the file's place in loadApp(). CI enforces exactly one of them
   (js/*.js ⊆ SHELL); the rest were prose, and this repo has shipped two
   stuck-loading crashes from getting them wrong. */
console.log('\n== the four script lists agree (AGENTS.md: index.html, sw.js SHELL, loadApp, js/) ==');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const indexScripts = [...indexHtml.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
/* Comments stripped first: SHELL carries a prose note, and a single
   apostrophe in it — "the worker's" — would otherwise read as the opening
   quote of a filename and swallow the rest of the list. */
const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(swSrc)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const shellFiles = [...shellBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
/* Not recursive: js/vendor/ holds bundled libraries that are deliberately
   not shell scripts and have no tag of their own. */
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
ok('index.html loads exactly the files loadApp() loads, in the same order',
   JSON.stringify(indexScripts) === JSON.stringify(SHELL_SCRIPTS), JSON.stringify(indexScripts));
ok('every index.html script is in sw.js SHELL',
   indexScripts.every(f => shellFiles.includes(f)),
   JSON.stringify(indexScripts.filter(f => !shellFiles.includes(f))));
ok('every js/*.js file is a script tag in index.html',
   jsFiles.every(f => indexScripts.includes(f)),
   JSON.stringify(jsFiles.filter(f => !indexScripts.includes(f))));
ok('every js/ entry in SHELL exists on disk',
   shellFiles.filter(f => f.startsWith('js/')).every(f => fs.existsSync(path.join(ROOT, f))),
   JSON.stringify(shellFiles.filter(f => f.startsWith('js/') && !fs.existsSync(path.join(ROOT, f)))));

/* WCAG 2.x contrast, computed from css/style.css's own hex values rather
   than eyeballed: sRGB -> linear -> relative luminance -> the ratio itself
   (ten lines, as plans/032 describes it). --soft's three backgrounds are
   bundled into one assertion per theme, which is why reverting light
   --soft alone (see this plan's Verify step) produces exactly one FAIL
   here, not three. Plan 033 fix round 1 widens the net: it made --signal
   a text colour, not just a fill, and gave --amber a second role
   (--amber-ink carries the text/border cases), and every failure that
   round found was invisible to this section because it only read the
   base :root blocks and only the pairs already in its own table. So it
   now also asserts --signal as text, --on-share on its --amber fill,
   --share-ink on the JUNTOS chip's --share-soft, and the four
   profile-scoped --on-signal/--signal pairs (light/dark x azul/verde),
   parsed straight out of the #app.profile-* rules rather than the plain
   :root blocks, where they were previously invisible to this section
   entirely. */
console.log('\n== css tokens keep WCAG contrast (plans/032, plans/033) ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
/* Hex or rgba(): the timer's --timer-dim/--timer-line and the --on-ink-*
   tokens are translucent, and a regex that only read hex dropped them out
   of this table silently — the one section whose job is to fail when a
   token drifts (plans/042). */
function tokenMap(blockSrc) {
  const map = {};
  for (const m of blockSrc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s*;/g)) map[m[1]] = m[2];
  return map;
}
function luminance(hex) {
  const chan = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
/* A translucent colour has no contrast of its own: it is composited over
   the surface it sits on first, and the ratio is taken of the result. */
function over(token, bgHex) {
  if (token[0] === '#') return token;
  const [r, g, b, a = 1] = /rgba?\(([^)]*)\)/.exec(token)[1].split(',').map(Number);
  const bg = [1, 3, 5].map(i => parseInt(bgHex.slice(i, i + 2), 16));
  return '#' + [r, g, b].map((v, i) => Math.round(a * v + (1 - a) * bg[i]).toString(16).padStart(2, '0')).join('');
}
function contrast(fg, bgHex) {
  const a = luminance(over(fg, bgHex)), b = luminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const lightTokens = tokenMap(/:root\s*\{([\s\S]*?)\}/.exec(cssSrc)[1]);
const darkTokens = tokenMap(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/.exec(cssSrc)[1]);
[['light', lightTokens], ['dark', darkTokens]].forEach(([label, t]) => {
  const softRatios = ['paper', 'card', 'sunk'].map(bg => contrast(t.soft, t[bg]));
  ok(label + ': --soft is >= 4.5:1 on --paper, --card and --sunk',
     softRatios.every(r => r >= 4.5), 'paper/card/sunk: ' + softRatios.map(r => r.toFixed(2)).join('/'));
  const amberInk = contrast(t['amber-ink'], t.card);
  ok(label + ': --amber-ink is >= 4.5:1 on --card', amberInk >= 4.5, amberInk.toFixed(2));
  const edge = contrast(t.edge, t.card);
  ok(label + ': --edge is >= 3:1 on --card', edge >= 3, edge.toFixed(2));
  const ink = contrast(t.ink, t.card);
  ok(label + ': --ink is >= 4.5:1 on --card', ink >= 4.5, ink.toFixed(2));
  const onSignal = contrast(t['on-signal'], t.signal);
  ok(label + ': --on-signal is >= 4.5:1 on --signal', onSignal >= 4.5, onSignal.toFixed(2));

  /* --signal reads as text (.ex-menu-btn:hover, .deload-check.good, .pe-log-tag,
     the primary button's outline state, …), not only as a fill, so it has
     to clear 4.5:1 everywhere it sits, not just against --card. */
  const signalRatios = ['card', 'paper', 'sunk', 'signal-soft'].map(bg => contrast(t.signal, t[bg]));
  ok(label + ': --signal is >= 4.5:1 on --card, --paper, --sunk and --signal-soft',
     signalRatios.every(r => r >= 4.5),
     'card/paper/sunk/signal-soft: ' + signalRatios.map(r => r.toFixed(2)).join('/'));
  const onShareAmber = contrast(t['on-share'], t.amber);
  ok(label + ': --on-share is >= 4.5:1 on --amber', onShareAmber >= 4.5, onShareAmber.toFixed(2));
  const shareInkSoft = contrast(t['share-ink'], t['share-soft']);
  ok(label + ': --share-ink is >= 4.5:1 on --share-soft', shareInkSoft >= 4.5, shareInkSoft.toFixed(2));

  /* The rest timer is its own dark surface in both themes (plans/037) and
     every line on it is text: the second line and the switch at 13px in
     --timer-dim, the label at 11px, the 52px/700 numeral in --signal and,
     once the rest is over, in --flare. The numeral is large text, so 3:1;
     everything else 4.5:1. */
  ok(label + ': the timer tokens are all present', ['timer-bg', 'timer-ink', 'timer-dim'].every(k => !!t[k]),
     ['timer-bg', 'timer-ink', 'timer-dim'].map(k => k + '=' + t[k]).join(' '));
  const timerInk = contrast(t['timer-ink'], t['timer-bg']);
  ok(label + ': --timer-ink is >= 4.5:1 on --timer-bg', timerInk >= 4.5, timerInk.toFixed(2));
  const timerDim = contrast(t['timer-dim'], t['timer-bg']);
  ok(label + ': --timer-dim, composited, is >= 4.5:1 on --timer-bg', timerDim >= 4.5, timerDim.toFixed(2));
  const timerVal = contrast(t.signal, t['timer-bg']), timerOver = contrast(t.flare, t['timer-bg']);
  ok(label + ': --signal and --flare are >= 3:1 on --timer-bg (the 52px numeral is large text)',
     timerVal >= 3 && timerOver >= 3, timerVal.toFixed(2) + '/' + timerOver.toFixed(2));
  /* --danger is text on --card (.sm.warn, .sheet-sec.danger) and on --paper. */
  const dangerRatios = ['card', 'paper'].map(bg => contrast(t.danger, t[bg]));
  ok(label + ': --danger is >= 4.5:1 on --card and --paper',
     dangerRatios.every(r => r >= 4.5), 'card/paper: ' + dangerRatios.map(r => r.toFixed(2)).join('/'));
});

/* The profile accents override --signal (and, for dark verde, --on-signal
   too) inside #app.profile-* rules that the plain :root blocks above never
   contain, so the loop above cannot see them — light azul alone hid the
   whole reason this round exists. Parsed straight out of the selectors
   rather than hand-copied, so a hex that drifts here fails loudly instead
   of quietly. */
function profileOverride(selectorPattern) {
  const re = new RegExp(selectorPattern.replace(/ /g, '\\s+') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(cssSrc);
  if (!m) throw new Error('profile rule not found: ' + selectorPattern);
  return tokenMap(m[1]);
}
[
  ['light azul', '#app\\.profile-hombre, #app\\.profile-azul', lightTokens],
  ['light verde', '#app\\.profile-mujer, #app\\.profile-verde', lightTokens],
  ['dark azul', ':root\\[data-theme="dark"\\] #app\\.profile-hombre,\\s*:root\\[data-theme="dark"\\] #app\\.profile-azul', darkTokens],
  ['dark verde', ':root\\[data-theme="dark"\\] #app\\.profile-mujer,\\s*:root\\[data-theme="dark"\\] #app\\.profile-verde', darkTokens],
].forEach(([label, pattern, base]) => {
  const override = profileOverride(pattern);
  const signal = override.signal;
  const onSignal = override['on-signal'] || base['on-signal'];
  const r = contrast(onSignal, signal);
  ok(label + ': --on-signal is >= 4.5:1 on --signal', r >= 4.5, onSignal + ' on ' + signal + ' = ' + r.toFixed(2));
});

const app = loadApp();
const call = expr => vm.runInContext(expr, app);
const throws = expr => { try { call(expr); return false; } catch (e) { return true; } };

console.log('\n== the harness ==');
ok('every source file loads in one shared scope', call('typeof migrate') === 'function');
ok('load() seeded a state object', call('!!state && !!state.profiles'));

/* js/app.js stubs the entry points of the split-out files it still names, so the
   app still boots when the worker serves an index.html whose script tag for
   one of them is not in the cache. Nothing exercised those stubs, because
   the harness always loaded all thirteen files — the defence against the
   third stuck-loading crash was itself untested. Each pass here is a
   precache hole survived. */
console.log('\n== a precache hole: app.js boots without each split file (AGENTS.md rule 1) ==');
[['js/rest-timer.js', ['startRest', 'stopRest', 'renderSoundBtn', 'askForNotifications', 'keepAliveStop']],
 ['js/chart.js', ['openChart']],
 /* js/qr-transfer.js needs no stub since sheets register their own
    teardown (plans/009 item 1) — nothing in app.js names closeQr now. The
    file still gets its precache-hole pass: the shell must load without it. */
 ['js/qr-transfer.js', []]].forEach(([file, stubs]) => {
  let partial = null, err = null;
  try { partial = loadApp([file]); } catch (e) { err = e; }
  ok('the shell loads without ' + file, !err && !!partial, err && err.message);
  if (!partial) return;
  const c = expr => vm.runInContext(expr, partial);
  stubs.forEach(name => ok(file + ' absent: ' + name + ' is a callable stub', c('typeof ' + name) === 'function'));
  ok(file + ' absent: load() still seeded state', c('!!state && !!state.profiles'));
});

/* A ratchet, not a target. Fixed sleeps are why the browser suite takes
   four minutes and why it flakes on a slow machine; plans/008 item 21 owns
   replacing them with waits on a condition. This only stops the number
   going up. Whoever removes some lowers the ceiling in the same commit. */
const smokeSrc = fs.readFileSync(path.join(ROOT, 'test/smoke.js'), 'utf8');
const sleeps = (smokeSrc.match(/waitForTimeout\(/g) || []).length;
ok('test/smoke.js does not gain fixed sleeps (plans/008 item 21: ' + sleeps + ' now; replace, do not add)',
   sleeps <= 208, String(sleeps));

/* js/theme-init.js runs in <head>, before app.js defines anything, so it has
   to spell the storage key out as a literal. Its own comment says a renamed
   STORAGE_KEY would silently bring back the flash of the wrong theme the
   file exists to prevent, "with nothing to catch the drift". This is that. */
console.log('\n== theme-init.js reads the same storage key as app.js ==');
const themeInitSrc = fs.readFileSync(path.join(ROOT, 'js/theme-init.js'), 'utf8');
ok('the literal in js/theme-init.js matches STORAGE_KEY',
   themeInitSrc.includes("getItem('" + call('STORAGE_KEY') + "')"),
   themeInitSrc.match(/getItem\([^)]*\)/)[0] + ' vs ' + call('STORAGE_KEY'));

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

/* A plain object answers obj['constructor'] with a function and
   obj['__proto__'] with Object.prototype — both truthy — so a backup that
   names one as its activeProfile used to pass the repair, getBlock() threw,
   and the recovery screen's own buttons then persisted the unopenable
   state (plans/040). */
['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'].forEach(k => {
  const fixed = call('state = ' + JSON.stringify({ profiles: { hombre: {} }, activeProfile: k }) +
    '; migrate(); state.activeProfile');
  ok('migrate() repairs an activeProfile of "' + k + '" onto a profile that exists (plans/040)',
     fixed === 'hombre', fixed);
});

const platesCap = call('state = ' + JSON.stringify({
  profiles: {}, prefs: { units: 'kg', plates: Array.from({ length: 400 }, (_, i) => 1 + (i % 40) * 0.5) },
}) + '; migrate(); state.prefs.plates.length + "/" + new Set(state.prefs.plates).size');
ok('migrate() de-duplicates and caps the plate list a backup carries (plans/040)',
   platesCap === '24/24', platesCap);

call('state = defaultState(); migrate();');
const slotFor = k => call('profileSlotFor(' + JSON.stringify(k) + ')');
ok('profileSlotFor lands a file on the key it names when that profile exists', slotFor('mujer') === 'mujer', slotFor('mujer'));
ok('...and on the active profile for a key nobody has', slotFor('ghost') === call('state.activeProfile'), slotFor('ghost'));
['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach(k => {
  ok('...and on the active profile for "' + k + '", never through the prototype (plans/040)',
     slotFor(k) === call('state.activeProfile'), slotFor(k));
});

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
   (entry/setNoteText/setEnergy/setOrder, plus the RIR box's own write onto
   the row it belongs to) — the shape a real week of
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
    /* What typing '1' into the last set's RIR box leaves on disk: the digit
       on that row and nothing anywhere else (plans/035, plans/036). */
    entry(profile, block.id, 1, day.id, ex1.id, ex1.sets)[ex1.sets - 1].rir = '1';
    /* The record is the row now, so the legacy map needs a session of its
       own here or "...RIR chips too" would be comparing two empty objects.
       A profile logged before plans/035 carries exactly this, and a restore
       still has to hand it back untouched. */
    profile.rir[block.id] = { [slot(2, day.id)]: { [ex2.id]: '2+' } };
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

/* JSON.parse hands back `{"toString": null}` without complaint, and String()
   or Number() on it throws a TypeError (toString is not callable, valueOf
   returns the object itself). Every field a normalizer coerces gets one
   here, through all three import doors: the pasted block, the QR log and
   the backup/profile file. Nothing may throw; an object reads as absent. */
console.log('\n== hostile objects in string and number fields ==');
const H = { toString: null };
const errorOf = expr => { try { call(expr); return null; } catch (e) { return e; } };
const hostileEx = {
  id: H, n: 'Ex', reps: '10-15', sets: H, rest: H, alt: H, cue: H, setup: H,
  inc: H, minRir: H, muscle: H, pattern: H, type: H,
};
const hostileBlock = {
  name: H, weeks: H, deload: H, priority: [H], phase: { 1: { r: H, t: H } },
  days: [{ id: 'd1', name: H, pair: H, ex: [Object.assign({}, hostileEx, { id: 'e1' }), hostileEx] }],
};
const hostileBlockErr = errorOf('normalizeImportedBlock(' + JSON.stringify(hostileBlock) + ')');
ok('normalizeImportedBlock does not throw on {"toString": null} fields', hostileBlockErr === null, hostileBlockErr && hostileBlockErr.message);
ok('...and an object name reads as absent', call('normalizeImportedBlock(' + JSON.stringify(hostileBlock) + ').name') === 'Bloque importado');
const hostileAddErr = errorOf('normalizeImportedBlock(' + JSON.stringify(
  { days: [{ name: 'D', ex: [{ n: 'Ex', reps: '10', add: H }] }] }) + ')');
ok('an object "add" is rejected with the import\'s own message, not a TypeError',
   !!hostileAddErr && hostileAddErr.name !== 'TypeError' && /add/.test(hostileAddErr.message),
   hostileAddErr && hostileAddErr.name + ': ' + hostileAddErr.message);

const hostileRow = { w: H, r: H, ts: H, rir: H, u: H, dk: H, done: true, d: [{ w: H, r: H }] };
const hostileLog = { 'w1-d1': { e1: [hostileRow, { w: '40', r: '8', ts: H, rir: H }] } };
/* Ids in the raw block that are objects too: importIdMaps keys a map by them. */
const hostileIdBlock = { name: 'B', days: [{ id: H, name: 'D', ex: [{ id: H, n: 'Ex', reps: '10' }] }] };
const hostileLogErr = errorOf(`(function() {
  const raw = ${JSON.stringify(hostileBlock)};
  normalizeImportedLog(${JSON.stringify(hostileLog)}, raw, normalizeImportedBlock(raw));
  const rawIds = ${JSON.stringify(hostileIdBlock)};
  normalizeImportedLog(${JSON.stringify(hostileLog)}, rawIds, normalizeImportedBlock(rawIds));
})()`);
ok('normalizeImportedLog does not throw on {"toString": null} fields', hostileLogErr === null, hostileLogErr && hostileLogErr.message);
const hostileLogOut = call(`(function() {
  const raw = ${JSON.stringify(hostileBlock)};
  return normalizeImportedLog(${JSON.stringify(hostileLog)}, raw, normalizeImportedBlock(raw));
})()`);
ok('...and the typed row next to the hostile one still lands',
   JSON.stringify(hostileLogOut['w1-d1'].e1[1]) === JSON.stringify({ w: '40', r: '8', done: false }),
   JSON.stringify(hostileLogOut));

const hostileProfile = {
  blocks: { b1: Object.assign({}, hostileBlock, { createdAt: H }) }, blockOrder: ['b1', H], activeBlock: H,
  log: { b1: hostileLog },
  rir: { b1: { 'w1-d1': { e1: H } } },
  obj: { b1: { 'w1-d1': { e1: { at: H, conf: H, kind: H, rir: H, sets: [{ w: H, r: H, m: H }] } } } },
  order: { b1: { 'w1-d1': [H, 'e1'] } },
  notes: { b1: { 'w1-d1': H } }, energy: { b1: { 'w1-d1': H } },
  variants: { e1: [{ n: H, since: H }] },
  label: H, theme: H,
};
const hostileProfileErr = errorOf('normalizeImportedProfile(' + JSON.stringify(hostileProfile) + ')');
ok('normalizeImportedProfile does not throw on {"toString": null} fields', hostileProfileErr === null, hostileProfileErr && hostileProfileErr.message);
ok('...and an object createdAt is replaced, not stored',
   call('typeof Object.values(normalizeImportedProfile(' + JSON.stringify(hostileProfile) + ').blocks)[0].createdAt') === 'string');
const hostileBadBlockErr = errorOf('normalizeImportedProfile(' + JSON.stringify(
  { blocks: { orphan: { name: H, days: [] } }, blockOrder: ['orphan'], log: {} }) + ')');
ok('a rejected block with an object name still gets the import\'s own message',
   !!hostileBadBlockErr && hostileBadBlockErr.name !== 'TypeError' && hostileBadBlockErr.message.indexOf('orphan') >= 0,
   hostileBadBlockErr && hostileBadBlockErr.name + ': ' + hostileBadBlockErr.message);

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
    r2.rir = '1';
    setOrder(profile, block.id, 1, d2.id, [src.id].concat(d2.ex.slice(0, 2).map(e => e.id)));
    const beforeOrder = JSON.stringify(profile.order);

    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const ab = after.blocks[after.blockOrder[0]];
    const ad0 = ab.days[0], ad2 = ab.days[2];
    const s0 = (after.log[ab.id] || {})[slot(1, ad0.id)] || {};
    const s2 = (after.log[ab.id] || {})[slot(1, ad2.id)] || {};
    /* Since plans/035 the RIR is on the row, so this is the same question
       asked of the new record: the value written on day B's set must come
       back on day B's set, not on day A's. */
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
      day2Rir: !!(s2[id2] && s2[id2][0] && s2[id2][0].rir === '1') &&
              !(s0[id0] && s0[id0][0] && 'rir' in s0[id0][0]),
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
ok("...and the second day's RIR with them, on its own set and not on the first day's",
   dupIdRoundTrip.day2Rir, dupIdRoundTrip.s2keys);
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

/* The cache now outlives a single card being swapped, and that is the whole
   of plans/027: drawCard keeps what drawApp built instead of resetting it.
   Asserted against the source because the thing being pinned is a lifetime,
   not a value — a later edit that puts the bare reset back would leave every
   assertion in this file green while every tick paid for brakeOn again. */
ok('drawCard reuses the render cache rather than resetting it on every tick',
   /function drawCard\(exId\) \{[\s\S]{0,1600}if \(!renderCache\) resetRenderCache\(\);/.test(
     fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));

/* And what that lifetime is worth, counted: brakeOn asks every exercise of
   every live day of the block for its history, so one call per draw rather
   than one per tick is the win. */
const stubbable = call('typeof brakeOn') === 'function';
const brakeCallProbe = call(`
  (function() {
    const profile = defaultState().profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const now = Date.now();
    /* Restored in the finally: everything after this section reads the real
       one, and a counting wrapper left behind would be invisible here and
       wrong everywhere else. */
    const real = brakeOn;
    let calls = 0;
    brakeOn = function() { calls++; return real.apply(null, arguments); };
    try {
      resetRenderCache();
      brakeCached(profile, block, 1, now);
      brakeCached(profile, block, 1, now);
      const twoReads = calls;
      resetRenderCache();
      brakeCached(profile, block, 1, now);
      return { twoReads: twoReads, afterReset: calls };
    } finally {
      brakeOn = real;
    }
  })()
`);
ok('two brakeCached reads inside one draw call brakeOn once',
   stubbable && brakeCallProbe.twoReads === 1, String(brakeCallProbe.twoReads));
ok('a resetRenderCache() in between makes the next brakeCached pay for brakeOn again',
   brakeCallProbe.afterReset === 2 && call('brakeOn.toString().indexOf("calls++")') < 0,
   String(brakeCallProbe.afterReset));

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

/* diagPoints groups the log keys by week in one pass now instead of
   re-filtering them once per week (plans/027). The order of the output is
   what the whole screen is fitted through, and the deload is what must stay
   out of it, so both are pinned here rather than left to the rewrite. */
const diagPointLabels = call(`
  (function () {
    state = defaultState(); migrate(); state.setupDone = true;
    const pr = state.profiles.hombre;
    const blockId = pr.blockOrder[0];
    const block = pr.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    pr.log[blockId] = {};
    [1, 2, 3, 4].forEach(w => {
      pr.log[blockId][slot(w, day.id)] = { [exId]: [
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
      ] };
    });
    block.weeks = 8; block.deload = 3;
    return { labels: diagPoints(pr, exId, blockId).map(p => p.label), name: block.name };
  })()
`);
ok('diagPoints returns the weeks in ascending order with the deload left out',
   JSON.stringify(diagPointLabels.labels) ===
   JSON.stringify([1, 2, 4].map(w => diagPointLabels.name + ' · S' + w)),
   JSON.stringify(diagPointLabels.labels));

/* The sheet is a draw of its own (plans/027). Since drawCard stopped emptying
   the render cache, the cache the last full draw left behind outlives every
   tick — harmless for the card, whose history entries stop at profile.week,
   but not here: diagLevelTrend asks for MAX_WEEKS + 1, so the sheet's entries
   include the week being trained. Open the Diagnóstico, close it, tick, reopen
   — without the resetRenderCache() at the top of diagRows the trend would be
   read from before the tick. The `change` half of the assertion is the one
   that pins that: `sessions` comes from diagPoints, which reads the log
   directly and would move either way. */
const sheetSeesTick = call(`
  (function () {
    state = defaultState(); migrate(); state.setupDone = true;
    const pr = state.profiles.hombre;
    const blockId = pr.blockOrder[0];
    const block = pr.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    const at = w => Date.now() - (6 - w) * 7 * 86400000;
    const session = (kg, ts) => [
      { w: kg, r: '10', done: true, ts: ts },
      { w: kg, r: '10', done: true, ts: ts },
      { w: kg, r: '10', done: true, ts: ts },
    ];
    pr.log[blockId] = {};
    for (let w = 1; w <= 4; w++) pr.log[blockId][slot(w, day.id)] = { [exId]: session('60', at(w)) };
    block.weeks = 8; block.deload = 0;
    pr.week = 5;
    /* Stands in for the last full draw, which is what fills the cache the
       sheet would otherwise inherit. */
    resetRenderCache();
    const before = diagRows(pr, block, 'block').find(r => r.id === exId);
    /* A tick on the week being trained, written the way the card writes it. */
    pr.log[blockId][slot(5, day.id)] = { [exId]: session('100', Date.now()) };
    const after = diagRows(pr, block, 'block').find(r => r.id === exId);
    return { beforeSessions: before.sessions, afterSessions: after.sessions,
             beforeChange: before.change, afterChange: after.change,
             beforeTrend: before.trend, afterTrend: after.trend };
  })()
`);
ok('the Diagnóstico reads a set ticked since the last full draw, not the cache the draw left',
   sheetSeesTick.afterSessions === sheetSeesTick.beforeSessions + 1 &&
   sheetSeesTick.afterChange > sheetSeesTick.beforeChange,
   JSON.stringify(sheetSeesTick));

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
ok('the volume-margin verdict delimits the imported muscle tag',
   (() => { const v = call('diagVerdict("up", { volLow: true, volTag: "Pecho «x»" })'); return v.lectura.indexOf('«Pecho x»') >= 0 && v.cambio.indexOf('«Pecho x»') >= 0; })());

/* On a deload week the rule returns a `descarga` target, which is `down` by
   design; the Diagnóstico must not read that as "the weight was picked
   wrong". Four identical sessions make the trend flat, which is the branch
   that consults estDown. */
const deloadVerdict = call(`
  (function () {
    state = defaultState(); migrate(); state.setupDone = true;
    const pr = state.profiles.hombre;
    const blockId = pr.blockOrder[0];
    const block = pr.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    pr.log[blockId] = {};
    for (let w = 1; w <= 4; w++) {
      pr.log[blockId][slot(w, day.id)] = { [exId]: [
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
      ] };
    }
    block.weeks = 8; block.deload = 5;
    pr.week = 5;
    resetRenderCache();
    const rows = diagRows(pr, block, 'block');
    const row = rows.find(x => x.id === exId) || rows[0];
    const est = targetNow(pr, block, day, day.ex[0], 5);
    return { kind: est && est.kind, dir: est && est.dir, lectura: row && row.lectura };
  })()
`);
ok('on the deload week the rule returns a descarga target that is down',
   deloadVerdict.kind === 'descarga' && deloadVerdict.dir === 'down', JSON.stringify(deloadVerdict));
ok('and the Diagnóstico does not read it as a mis-chosen weight',
   deloadVerdict.lectura && deloadVerdict.lectura.indexOf('Peso mal elegido') < 0, JSON.stringify(deloadVerdict));

/* The other side of the same gate: an ordinary `objetivo` target that comes
   down (the exercise's reps sit well under its rep range at the same
   weight, session after session) must still read as a mis-chosen weight.
   Four flat sessions so the trend reaches the same branch as above. */
const objetivoDownVerdict = call(`
  (function () {
    state = defaultState(); migrate(); state.setupDone = true;
    const pr = state.profiles.hombre;
    const blockId = pr.blockOrder[0];
    const block = pr.blocks[blockId];
    const day = block.days[0];
    day.ex[0].reps = '10–15';
    const exId = day.ex[0].id;
    pr.log[blockId] = {};
    for (let w = 1; w <= 4; w++) {
      pr.log[blockId][slot(w, day.id)] = { [exId]: [
        { w: '100', r: '4', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '100', r: '4', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '100', r: '4', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
      ] };
    }
    block.weeks = 8; block.deload = 0;
    pr.week = 5;
    resetRenderCache();
    const rows = diagRows(pr, block, 'block');
    const row = rows.find(x => x.id === exId) || rows[0];
    const est = targetNow(pr, block, day, day.ex[0], 5);
    return { kind: est && est.kind, dir: est && est.dir, trend: row && row.trend, lectura: row && row.lectura };
  })()
`);
ok('an ordinary objetivo target that comes down still reads as a mis-chosen weight',
   objetivoDownVerdict.kind === 'objetivo' && objetivoDownVerdict.dir === 'down' &&
   objetivoDownVerdict.trend === 'flat' &&
   objetivoDownVerdict.lectura && objetivoDownVerdict.lectura.indexOf('Peso mal elegido') === 0,
   JSON.stringify(objetivoDownVerdict));

console.log('\n== objetivo: los quince casos de la v3 ==');
/* The fifteen cases the rule was specified against, in the order the spec
   lists them. Every one of them reads MORE than one session — which is the
   whole change from v2 — so they belong here rather than in smoke.js: a
   browser adds nothing to arithmetic over six sessions, and these run on
   every commit for free.

   `sessions` is one entry per logged session, oldest first:
   `{ sets: [[weight, reps], …], rir: '0'|'1'|'2+'|undefined, day }` where
   `day` is days from an arbitrary Monday and defaults to one a week. The
   target is asked for the week after the last one, at `day + 7`, unless
   `opts.week` / `opts.now` say otherwise.

   `rirs: ['3', null, …]` is the plans/035 record — one value per set,
   written on the rows — and it is what the per-set cases below use. `rir`
   stays the legacy one-per-session chip in the parallel map, which is what
   every case written before that plan uses, and what the inheritance rule
   has to keep reading exactly as it always did. */
const targetProbe = `
  (function (sessions, opts) {
    opts = opts || {};
    const DAY = 86400000, T0 = Date.UTC(2026, 0, 5);
    const week = opts.week || sessions.length + 1;
    const phase = {};
    for (let i = 1; i <= week + 4; i++) phase[i] = { r: (opts.rirWeek != null ? opts.rirWeek : 2) + ' RIR' };
    /* Every week gets the same prescription unless a case overrides it, which
       is the only way to reach weekRir's prose fallback: a phase somebody
       wrote in their own words has no number in it at all. */
    if (opts.phase) for (const k in phase) phase[k] = opts.phase;
    const ex = { id: 'E', n: 'x', sets: opts.sets || 3, reps: opts.range || '10–15', inc: opts.inc || 2.5 };
    if (opts.add) ex.add = opts.add;
    if (opts.minRir) ex.minRir = opts.minRir;
    const block = { id: 'B', name: 'B', weeks: 16, deload: opts.deload || 0, phase: phase,
                    days: [{ id: 'D', name: 'D', ex: [ex] }] };
    const profile = { log: { B: {} }, rir: { B: {} }, obj: {}, variants: {},
                      blocks: { B: block }, blockOrder: ['B'] };
    let lastDay = 0;
    sessions.forEach(function (s, i) {
      const d = s.day != null ? s.day : i * 7;
      lastDay = d;
      profile.log.B['w' + (i + 1) + '-D'] = { E: s.sets.map(function (p, k) {
        const row = { w: String(p[0]), r: String(p[1]), done: true, ts: T0 + d * DAY };
        /* A third element is the unit the row was written in. The key is
           added only when there is one, because that is what the app writes:
           a row logged in the profile's own unit carries no u at all, and a
           literal u: undefined is a shape no restore ever produces. */
        if (p[2] === 'lb') row.u = 'lb';
        if (s.rirs && s.rirs[k] != null) row.rir = String(s.rirs[k]);
        return row;
      }) };
      if (s.rir) profile.rir.B['w' + (i + 1) + '-D'] = { E: s.rir };
    });
    const now = T0 + (opts.now != null ? opts.now : lastDay + 7) * DAY;
    /* Same block and exercise ids on every call and no draw in between, so
       the history cache has to be dropped or the second call reads the
       first call's log. */
    resetRenderCache();
    const t = targetFor(profile, block, block.days[0], ex, week, now, !!opts.brake);
    if (!t) return null;
    return {
      kind: t.kind, conf: t.conf, dir: t.dir, notes: t.notes.join(','),
      show: t.sets.map(function (x) {
        return String(Math.round(x.w * 100) / 100).replace('.', ',') + '×' + x.r + x.move;
      }).join(' · '),
      line: targetLine(t), says: targetNotes(t).join(' | '),
      phi: t.phi ? t.phi.map(function (v) { return v.toFixed(3); }).join(' ') : '',
      /* The rule's own workings, for the cases that have to assert on the
         arithmetic rather than on the card: the floor in repsAt hides a
         third of a rep, which is most of what the trend term is worth. */
      g: t.g, level: t.level, rirWeek: t.rirWeek, sessions: t.sessions,
    };
  })
`;
const target = (sessions, opts) => call(targetProbe)(sessions, opts);

/* T1 — the pec deck. The topped-out 39×15/15/15 cannot lower the level, so
   the target is still priced off the 52×12 two sessions earlier; set 1
   earned the next rung of a very coarse stack (39 → 45, `inc` 6) and sets
   2 and 3 cannot reach the range there, so they stay and chase reps. */
let t = target([
  { sets: [[45, 15], [45, 12], [45, 10], [39, 12]], rir: '0' },
  { sets: [[52, 12], [45, 12], [45, 10], [39, 12]], rir: '0' },
  { sets: [[39, 15], [39, 15], [39, 15]], rir: '1' },
], { range: '12–15', inc: 6, sets: 3, rirWeek: 1 });
ok('T1 a topped-out session does not lower the level, and the stack is climbed by its own rungs',
   t.show === '45×13↑ · 39×15 · 39×15' && t.conf === 'baja', JSON.stringify(t));

/* T2 — the one v2 froze solid: every set at the top of the range with the
   last one at 0 RIR was a veto, so 25 kg never moved again. There is no
   veto now; the RIR is already inside the capacity the step is priced on. */
const contractora = [
  { sets: [[25, 15], [25, 15], [25, 15], [25, 15]], rir: '1' },
  { sets: [[25, 20], [25, 20], [25, 20]], rir: '0' },
];
t = target(contractora, { range: '15–20', inc: 1, sets: 3, rirWeek: 1 });
ok('T2 the top of the range at 0 RIR no longer freezes the exercise',
   t.show === '26×17↑ · 26×17↑ · 26×17↑' && t.conf === 'baja' && t.notes.includes('moreRir'), JSON.stringify(t));
ok('   and the line reads the way the spec writes it',
   t.line === '↗ objetivo: 26×17 · 26×17 · 26×17', t.line);
ok('   with the RIR the week asks for said out loud',
   t.says.includes('Esta semana pide más RIR'), t.says);

/* T3/T4/T9 — the chest press, with a back-off week, a twenty-day layoff and
   the set `ex.add` brings in at week 5. */
const chest = [
  { sets: [[42.75, 11], [42.75, 10], [42.75, 9], [42.75, 8]], rir: '0', day: 0 },
  { sets: [[45, 11], [45, 10], [45, 9], [45, 8]], rir: '0', day: 7 },
  { sets: [[45, 12], [45, 10], [45, 9], [45, 8]], rir: '0', day: 14 },
];
const chestOpts = { range: '8–12', inc: 2.25, sets: 4, add: 5, rirWeek: 1 };
t = target(chest, Object.assign({ now: 34 }, chestOpts));
ok('T3 twenty days off repeats the last session rather than discounting it',
   t.kind === 'vuelta' && t.show === '45×12 · 45×10 · 45×9 · 45×8', JSON.stringify(t));
ok('   and says why', t.says.includes('Vuelta de parón'), t.says);

const chest4 = chest.concat([{ sets: [[45, 12], [45, 10], [45, 9], [45, 8]], rir: '0', day: 34 }]);
t = target(chest4, Object.assign({ now: 41 }, chestOpts));
ok('T4 five sets, one up, one down, and the added set priced off the decay',
   t.show === '47,25×9↑ · 45×9 · 45×8 · 42,75×9↓ · 42,75×8' && t.conf === 'media', JSON.stringify(t));
ok('   the line is the one the spec prints',
   t.line === '↗ objetivo: 47,25×9 · 45×9 · 45×8 · 42,75×9 · 42,75×8', t.line);
/* The number the spec states for this exercise, and the one thing in the
   rule that is measured rather than assumed. */
ok('   and the decay profile is 1 · 0,952 · 0,929 · 0,904',
   t.phi.indexOf('1.000 0.952 0.929 0.905') === 0, t.phi);
/* 45 × 0,6 is 27, and the 2,25 ladder from 45 lands on it exactly. */
t = target(chest4, Object.assign({ now: 41, week: 8, deload: 8 }, chestOpts));
ok('T9 a deload is half the sets at the bottom of the range, on the first rung under 60 %',
   t.kind === 'descarga' && t.show === '27×8 · 27×8 · 27×8', JSON.stringify(t));

/* T5 — the shoulder press, where the stack the log knows about (18 and 23)
   must not be read as "the next rung after 18 is 23": 23 is more than one
   and a half steps away, so the micro-plate wins. */
t = target([
  { sets: [[18, 12], [18, 12], [18, 12], [18, 11]], rir: '0' },
  { sets: [[23, 10], [23, 9], [18, 10], [18, 10]], rir: '0' },
  { sets: [[18, 12], [18, 12], [18, 12]], rir: '2+' },
], { range: '8–12', inc: 1, sets: 3, rirWeek: 1 });
ok('T5 the next rung is the micro-step, not the far heavier weight also in the history',
   t.show === '19×10↑ · 19×10↑ · 19×10↑' && t.conf === 'baja', JSON.stringify(t));

/* T6 — the session that named the v2 rule, and the clearest case for
   deciding per set: 32×15/15/12/12 was "mantener" as one weight, and is
   two sets up and two sets chasing reps as four. */
t = target([
  { sets: [[32, 10], [27, 10], [27, 10], [27, 10]], rir: '1' },
  { sets: [[32, 15], [32, 15], [32, 12], [32, 12]], rir: '1' },
], { range: '10–15', inc: 2.25, sets: 4, rirWeek: 2 });
ok('T6 the two sets that reached the top go up; the two that did not keep the weight',
   t.show === '34,25×10↑ · 34,25×10↑ · 32×11 · 32×11' && t.conf === 'baja', JSON.stringify(t));

/* T7 — the slack. Set 1 prices out at 11 reps on a 12–15 range, one under
   the bottom; the base it was read off is a floor (the set ended at the
   top), so one rep of slack lets it move. Without it the exercise is
   frozen exactly the way the old RIR-0 veto froze T2. */
t = target([
  { sets: [[27, 12], [27, 12], [27, 12], [27, 12]], rir: '0' },
  { sets: [[27, 15], [27, 15], [27, 13], [27, 12]], rir: '0' },
  { sets: [[27, 15], [27, 15], [27, 13]], rir: '1' },
], { range: '12–15', inc: 2.25, sets: 3, rirWeek: 1 });
ok('T7 one rep of slack on a censored base is what stops a topped-out set freezing',
   t.show === '29,25×12↑ · 29,25×12↑ · 27×15' && t.conf === 'baja', JSON.stringify(t));

/* T8 — a light exercise with no `inc` of its own: the default 2,5 step is
   a third of the weight, so nothing can go up and the answer is to say so
   rather than to prescribe a jump nobody can make. */
t = target([
  { sets: [[6.8, 20], [6.8, 20], [6.8, 18], [6.8, 16]], rir: '1' },
  { sets: [[6.8, 20], [6.8, 20], [6.8, 20], [6.8, 20]], rir: '1' },
  { sets: [[6.8, 20], [6.8, 20], [6.8, 20], [6.8, 20]], rir: '1' },
  { sets: [[6.8, 20], [6.8, 20], [6.8, 20], [6.8, 20]], rir: '1' },
], { range: '12–20', inc: 2.5, sets: 4, rirWeek: 1 });
ok('T8 a step too big for the range holds the weight and names the step',
   t.show === '6,8×20 · 6,8×20 · 6,8×20 · 6,8×20' && t.notes.includes('step'), JSON.stringify(t));
ok('   and the note gives the weight that would not fit',
   t.says.includes('9,3 kg') && t.says.includes('micro-carga'), t.says);

/* T10 — the same history as T2 with the brake on: nothing goes up and the
   expected gain is zero, so every set repeats what it already did. */
t = target(contractora, { range: '15–20', inc: 1, sets: 3, rirWeek: 1, brake: true });
ok('T10 the global brake stops every rise, including the ones already earned',
   t.show === '25×19 · 25×19 · 25×19' && t.conf === 'baja', JSON.stringify(t));

/* T11/T12 — one bad session is a bad session; two in a row is the level. */
const declining = [
  { sets: [[40, 10], [40, 9], [40, 8]], rir: '1' },
  { sets: [[40, 11], [40, 10], [40, 9]], rir: '1' },
  { sets: [[40, 8], [40, 8], [40, 7]], rir: '1' },
];
t = target(declining, { range: '8–12', inc: 2.5, sets: 3, rirWeek: 1 });
ok('T11 the first session under the level holds the weight without lowering it',
   t.show === '40×11 · 40×10 · 40×8' && t.conf === 'media' && t.notes.includes('hold'), JSON.stringify(t));
ok('   and says it is one session, not a verdict',
   t.says.includes('hoy no sube la carga'), t.says);
t = target(declining.concat([{ sets: [[40, 8], [40, 7], [40, 7]], rir: '1' }]),
           { range: '8–12', inc: 2.5, sets: 3, rirWeek: 1 });
ok('T12 the second one in a row moves the level down with it',
   t.show === '40×9 · 40×8 · 37,5×10↓' && t.conf === 'alta' && t.notes.includes('confirmed'), JSON.stringify(t));
ok('   and says the objetivo came down too',
   t.says.includes('el objetivo baja contigo'), t.says);

/* T13 — no chip anywhere. Every session is read as a floor, which is why
   the confidence is low and why the estimate stays on the safe side. */
t = target([
  { sets: [[50, 10], [50, 9], [50, 8]] },
  { sets: [[50, 11], [50, 10], [50, 9]] },
], { range: '8–12', inc: 2.5, sets: 3, rirWeek: 2 });
ok('T13 with no RIR marked every session is a minimum and the confidence says so',
   t.show === '50×10 · 50×8 · 47,5×10↓' && t.conf === 'baja' && t.notes.includes('moreRir'), JSON.stringify(t));
/* One rung down lands inside the range, so there is nothing to warn about:
   the 'floor' note is for the walk that ran out of rungs, not for any
   target that came down at all (plans/025). */
ok('   and a set that comes down one rung INTO the range carries no floor note',
   !t.notes.includes('floor'), JSON.stringify(t));

/* T14 */
ok('T14 no history at all is no line, not a guess',
   target([], { range: '8–12', inc: 2.5, sets: 3, rirWeek: 1 }) === null);

/* T15 — the brake itself. Three exercises whose latest session is a real
   decline inside the last seven days; two is not enough. */
const brakeProbe = `
  (function (caps, nEx) {
    const DAY = 86400000, T0 = Date.UTC(2026, 0, 5);
    const phase = {}; for (let i = 1; i <= 8; i++) phase[i] = { r: '2 RIR' };
    const ex = [];
    for (let e = 0; e < nEx; e++) ex.push({ id: 'E' + e, n: 'x' + e, sets: 3, reps: '8–20', inc: 2.5 });
    const block = { id: 'B', name: 'B', weeks: 8, deload: 0, phase: phase, days: [{ id: 'D', name: 'D', ex: ex }] };
    const profile = { log: { B: {} }, rir: { B: {} }, obj: {}, variants: {}, blocks: { B: block }, blockOrder: ['B'] };
    caps.forEach(function (C, i) {
      const rows = {};
      /* 10 reps at 1 RIR, so the set is neither past CENSOR_REPS nor at the
         top of the range: the weight is whatever makes the capacity C. */
      ex.forEach(function (e) {
        rows[e.id] = [{ w: String(C * 30 / 41), r: '10', done: true, ts: T0 + i * 3 * DAY }];
      });
      profile.log.B['w' + (i + 1) + '-D'] = rows;
      profile.rir.B['w' + (i + 1) + '-D'] = ex.reduce(function (o, e) { o[e.id] = '1'; return o; }, {});
    });
    resetRenderCache();
    return brakeOn(profile, block, caps.length + 1, T0 + (caps.length * 3 + 2) * DAY);
  })
`;
ok('T15 three exercises declining inside a week turn the brake on',
   call(brakeProbe)([60, 62, 55], 3) === true);
ok('   two do not', call(brakeProbe)([60, 62, 55], 2) === false);
ok('   and neither does a sequence that never really fell',
   call(brakeProbe)([60, 62, 62], 3) === false);

/* ---- the trend term itself (plans/026) ----
   The fifteen cases above cover the decisions and none of the arithmetic
   that feeds them: at 4f7e037 the whole suite still passed with theilSen
   stubbed to `return 0` and with MAX_SLOPE moved from 0,03 to 0,5. These
   three assert on `g` — the expected gain, js/app.js's `t.g` — because a
   third of a rep is what the trend is worth and Math.floor in repsAt eats
   exactly that before it reaches the card. */

/* T16 — a climb steeper than one rep a session: the trend is real and
   MAX_SLOPE binds. Two reps a session at 40 kg is 2,67 of capacity per
   session over a level of 57,33, i.e. 0,047 — clamped to 0,03. Every
   session is uncensored (12 reps is neither past CENSOR_REPS nor at the
   top of 6–15, and the chip is given), which `conf === 'alta'` witnesses. */
t = target([
  { sets: [[40, 4], [40, 4], [40, 4]], rir: '1' },
  { sets: [[40, 6], [40, 6], [40, 6]], rir: '1' },
  { sets: [[40, 8], [40, 8], [40, 8]], rir: '1' },
  { sets: [[40, 10], [40, 10], [40, 10]], rir: '1' },
  { sets: [[40, 12], [40, 12], [40, 12]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 3, rirWeek: 1 });
ok('T16 a steep climb reads as a trend and is clamped at MAX_SLOPE',
   t && Math.abs(t.g - 0.03) < 1e-9, JSON.stringify(t));

/* T17 — one rep a session is, by construction, exactly oneRep and tells
   the trend term nothing: C = w(1 + (r + ρ)/30), so a rep a session is a
   slope of w/30 and slope / level is 1 / (30 + r + ρ). This is why the
   fifteen cases could not see theilSen at all. */
t = target([
  { sets: [[40, 6], [40, 6]], rir: '1' },
  { sets: [[40, 7], [40, 7]], rir: '1' },
  { sets: [[40, 8], [40, 8]], rir: '1' },
  { sets: [[40, 9], [40, 9]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 2, rirWeek: 1 });
ok('T17 a one-rep-a-session climb is priced at exactly one more rep',
   t && Math.abs(t.g - 1 / (30 + 10 + 1)) < 1e-9, JSON.stringify(t));

/* T18 — a falling trend is discarded rather than extrapolated: the floor
   is still one more rep. The last session recovers to 54,67 against a best
   of 56, well inside DECLINE_DROP, so this is the trend arm and not the
   hold arm — which would reach g = 0 by another route entirely. */
t = target([
  { sets: [[40, 12], [40, 12]], rir: '1' },
  { sets: [[40, 11], [40, 11]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
  { sets: [[40, 9], [40, 9]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 2, rirWeek: 1 });
ok('T18 a falling trend never prices less than one more rep',
   t && Math.abs(t.g - 1 / (30 + 10 + 1)) < 1e-9 && !t.notes.includes('hold'),
   JSON.stringify(t));

/* The pieces the cases above lean on, asserted on their own so a failure
   says which one moved. */
ok('a censored session can never be read as a decline',
   call('declineAt([{C:60,cens:false},{C:62,cens:false},{C:50,cens:true}], 2)') === false);
ok('repsAt lands on the integer it should: 63 over 47,25 is 9 reps, not 8',
   call('repsAt(47.25, 63, 1)') === 9);
ok('the load ladder climbs by the rungs the log knows and falls back to the step',
   call('nextLoad([18, 23], 18, 1)') === 19 && call('nextLoad([39, 45, 52], 39, 6)') === 45 &&
   call('prevLoad([42.75, 45], 45, 2.25)') === 42.75);

/* ...and the rest of them (plans/026), so that a helper the cases only
   reach through six sessions of arithmetic can fail by name. */
ok('theilSen of nothing, or of one point, is a flat line', call('theilSen([])') === 0 && call('theilSen([[0, 5]])') === 0);
/* [0,1] and [0,2] share an x and are skipped; the two remaining pairs give
   slopes (3-1)/1 = 2 and (3-2)/1 = 1, whose median is 1,5. Two sets logged
   in the same session is exactly that shape, which is why it is not an
   Infinity waiting to be divided. */
ok('theilSen skips pairs with the same x rather than dividing by zero',
   call('theilSen([[0, 1], [0, 2], [1, 3]])') === 1.5);
/* Six pairwise slopes: 1, 1, 10, 1, 14,5, 28 → sorted 1, 1, 1, 10, 14,5, 28
   → even-length median (1 + 10) / 2 = 5,5. A least-squares line through the
   same points would be steered by the outlier; the median is not, which is
   the whole reason the rule uses this and not a regression. */
ok('theilSen is the median of the pairwise slopes, not a least-squares fit',
   call('theilSen([[0, 0], [1, 1], [2, 2], [3, 30]])') === 5.5);
ok('median of an odd and an even list', call('median([3, 1, 2])') === 2 && call('median([4, 1, 3, 2])') === 2.5);
ok('loadLadder dedupes to float tolerance and sorts',
   JSON.stringify(call('loadLadder([{ sets: [{ w: 45 }, { w: 40 }] }, { sets: [{ w: 45.0000000001 }, { w: 42.5 }] }])')) === '[40,42.5,45]');
ok('nextLoad takes the first rung within one and a half steps, else the step',
   call('nextLoad([40, 41, 45], 40, 2.5)') === 41 && call('nextLoad([40, 45], 40, 2.5)') === 42.5);
ok('prevLoad mirrors it', call('prevLoad([35, 39, 40], 40, 2.5)') === 39 && call('prevLoad([30, 40], 40, 2.5)') === 37.5);

/* ---- the arms of targetFor the fifteen never entered (plans/026) ----
   Every case above is a block with one day, a numbered phase, one segment
   and a set count that never changes, which leaves five branches of the
   rule reachable only from test/smoke.js or from nothing at all. */

/* A phase somebody wrote in their own words has no number in it, so the
   week cannot say what reserve it wants and the reserve the last session
   was left at stands in — which asks for no change rather than inventing
   one. `phaseRir` falls back to the lowest digit ANYWHERE in the text, so
   the prose here has to carry none. */
t = target([
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 11], [40, 9]], rir: '2+' },
], { range: '6–15', inc: 2.5, sets: 2, phase: { r: 'Semana de técnica' } });
ok('a phase with no number in it falls back to the reserve the last session was left at',
   t && t.rirWeek === 2, JSON.stringify(t));
t = target([
  { sets: [[40, 10], [40, 9]], rir: '0' },
  { sets: [[40, 10], [40, 9]], rir: '0' },
  { sets: [[40, 11], [40, 9]], rir: '0' },
], { range: '6–15', inc: 2.5, sets: 2, phase: { r: 'Semana de técnica' } });
ok('...including a zero, which is a reserve and not a missing one',
   t && t.rirWeek === 0, JSON.stringify(t));
t = target([
  { sets: [[40, 10], [40, 9]], rir: '0' },
  { sets: [[40, 10], [40, 9]], rir: '0' },
  { sets: [[40, 11], [40, 9]], rir: '0' },
], { range: '6–15', inc: 2.5, sets: 2, minRir: 1, phase: { r: 'Semana de técnica' } });
ok('...and ex.minRir still floors what the fallback came back with',
   t && t.rirWeek === 1, JSON.stringify(t));

/* A layoff restarts the segment the level is read off: three sessions at
   50 kg, twenty days away, three at 45. Measured against the whole run the
   last three would still be the 45 kg ones, so the level alone cannot tell
   the two apart — what can is that the run 50 → 45 reads as two declines
   in a row, i.e. a CONFIRMED loss of the level, and inside the segment
   there is no fall at all. */
t = target([
  { sets: [[50, 10]], rir: '1' },
  { sets: [[50, 10]], rir: '1' },
  { sets: [[50, 10]], rir: '1' },
  { sets: [[45, 10]], rir: '1', day: 34 },
  { sets: [[45, 10]], rir: '1', day: 41 },
  { sets: [[45, 10]], rir: '1', day: 48 },
], { range: '6–15', inc: 2.5, sets: 1, rirWeek: 1 });
ok('a layoff restarts the segment, so coming back at 45 is the level and not a decline',
   t && Math.abs(t.level - 45 * (1 + 11 / 30)) < 1e-6 && !t.notes.includes('confirmed'),
   JSON.stringify(t));

/* A second set that collapses from twelve reps to two is a ratio of 0,767,
   under PSI_MIN — and the floor is there because a drop that size is a
   mistyped row or a set done at a weight the rule could not see, not a
   measurement of what the second set is worth. */
t = target([
  { sets: [[40, 12], [40, 2]], rir: '1' },
  { sets: [[40, 12], [40, 2]], rir: '1' },
  { sets: [[40, 12], [40, 2]], rir: '1' },
  { sets: [[40, 12], [40, 2]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 2, rirWeek: 1 });
ok('a second set that collapses is floored at PSI_MIN rather than believed',
   t && t.phi === '1.000 0.800', JSON.stringify(t));

/* Four reps where the plan asks for ten, on a machine whose only logged
   rung is 100: the walk down invents rungs of 3 and stops after three of
   them, at 91, whether or not the bottom of the range is in reach yet. */
t = target([
  { sets: [[100, 4], [100, 3], [100, 3]] },
  { sets: [[100, 4], [100, 3], [100, 2]] },
], { range: '10–15', inc: 3, sets: 3, rirWeek: 1 });
ok('coming down stops after three rungs, whether or not the range is back in reach',
   t && t.show === '91×7↓ · 82×10↓ · 79×10↓', JSON.stringify(t));
/* H1 — the set that ran out of rungs used to say nothing about it: reps
   below the range under a header reading "3 × 10–15", with no note, while
   the mirror case (a step UP that does not fit) has had one since v3. The
   reps stay as computed — they are honest — and the note says why they sit
   under the range (plans/025). */
ok('H1 ...and the set that ran out of rungs is marked, not left to read as a miscount',
   t && t.notes.includes('floor') && t.dir === 'down', JSON.stringify(t));
ok('   and the note says so in words',
   t && t.says.includes('escalones'), t && t.says);

/* Back from a layoff the last session is repeated exactly — and the set
   the plan has gained since was never done at all, so it takes the last
   set's weight at the bottom of the range. */
t = target([
  { sets: [[40, 10], [35, 8]], rir: '1' },
  { sets: [[40, 10], [35, 8]], rir: '1' },
  { sets: [[40, 10], [35, 8]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 3, rirWeek: 1, now: 34 });
ok('a vuelta repeats the last session and gives a set gained since the last weight at the bottom of the range',
   t && t.kind === 'vuelta' && t.show === '40×10 · 35×8 · 35×6', JSON.stringify(t));

/* A rep range is the one field the rule cannot work around, and a plan
   that arrived as JSON can say anything at all in it. */
ok('a rep range written backwards, or with no numbers in it, is no target at all',
   target([{ sets: [[40, 10]], rir: '1' }, { sets: [[40, 10]], rir: '1' }], { range: '15–10' }) === null &&
   target([{ sets: [[40, 10]], rir: '1' }, { sets: [[40, 10]], rir: '1' }], { range: 'AMRAP' }) === null);

/* A row written in the other unit is converted for the capacity it proves,
   but the converted number was never a pin on this stack: it used to enter
   the ladder as a rung at 45,359237, the card read "objetivo: 45,36×10",
   and the tick wrote that placeholder into the log for good (plans/025). */
const convSets = call(`
  (function () {
    state = defaultState(); migrate();
    state.prefs.units = 'kg';
    const p = { log: { B: { 'w1-D': { E: [
                  { w: '100', r: '10', done: true, u: 'lb' },
                  { w: '45', r: '10', done: true },
                ] } } }, rir: { B: {} }, blocks: { B: { id: 'B', days: [] } } };
    const s = ruleSession(sessionsOf(p, { weeks: 'logged', lift: { id: 'E' }, blocks: ['B'] })[0], 10, 15);
    return { conv0: s.sets[0].conv, w0: Math.round(s.sets[0].w * 100) / 100,
             conv1: s.sets[1].conv, w1: s.sets[1].w };
  })()
`);
ok('the rule\'s session marks a row logged in the other unit as converted, weight and all',
   convSets.conv0 === true && convSets.w0 === 45.36, JSON.stringify(convSets));
ok('...and a row in the profile\'s own unit is not marked',
   convSets.conv1 === false && convSets.w1 === 45, JSON.stringify(convSets));
ok('loadLadder leaves the converted weight out and keeps the real rung',
   call("loadLadder([{ sets: [{ w: 45.359237, conv: true }, { w: 45, conv: false }] }]).join(',')") === '45');

/* G1 — end to end: one lb session behind two kg ones. Before this, the
   ladder carried 45,359237 and the next rung up from 45 was it. */
t = target([
  { sets: [[100, 10, 'lb'], [100, 10, 'lb'], [100, 10, 'lb']], rir: '1' },
  { sets: [[45, 15], [45, 15], [45, 15]], rir: '1' },
  { sets: [[45, 15], [45, 15], [45, 15]], rir: '1' },
], { range: '10–15', inc: 2.5, sets: 3, rirWeek: 1 });
ok('G1 a converted session behind the kg ones is never a rung the target can land on',
   t && t.show.indexOf('45,36') < 0 &&
   t.show.split(' · ').every(function (s) { return s.indexOf('47,5×') === 0 || s.indexOf('45×') === 0; }),
   JSON.stringify(t));

console.log('\n== el mismo ejercicio en dos días del mismo bloque (plans/026) ==');
/* The harness above is a one-day block by construction, so the day split in
   exHistory — the same machine pressed first on Monday and fourth on
   Thursday is not the same set — was reachable only from test/smoke.js.
   This asks exHistory directly, which costs nothing per run. */
const twoDayProbe = call(`
  (function () {
    const T0 = Date.UTC(2026, 0, 5), DAY = 86400000;
    const mk = function () { return { id: 'E', n: 'x', sets: 2, reps: '8–12', inc: 2.5 }; };
    const ex = mk();
    const row = function (w, d) { return [{ w: String(w), r: '10', done: true, ts: T0 + d * DAY }]; };
    const blockB = { id: 'B', name: 'B', weeks: 8, deload: 0, phase: {},
                     days: [{ id: 'D1', name: 'D1', ex: [mk()] }, { id: 'D2', name: 'D2', ex: [mk()] }] };
    const logB = function () {
      return { 'w1-D1': { E: row(40, 0) }, 'w1-D2': { E: row(41, 3) },
               'w2-D1': { E: row(42, 7) }, 'w2-D2': { E: row(43, 10) } };
    };
    const show = function (list) {
      return list.map(function (s) { return s.blockId + '/' + s.dayId + ':' + s.sets[0].w; }).join(' ');
    };

    const one = { log: { B: logB() }, rir: { B: {} }, obj: {}, variants: {},
                  blocks: { B: blockB }, blockOrder: ['B'] };
    resetRenderCache();
    const d1 = show(exHistory(one, blockB, ex, 'D1', 3));
    const d2 = show(exHistory(one, blockB, ex, 'D2', 3));

    /* The block before this one had the lift on a single day, and that
       day's number means nothing here: whoever wrote that plan numbered
       its days for themselves. Matching on it would throw the history
       away rather than separate it. */
    const blockA = { id: 'A', name: 'A', weeks: 8, deload: 0, phase: {},
                     days: [{ id: 'DA', name: 'DA', ex: [mk()] }] };
    const two = { log: { A: { 'w1-DA': { E: row(30, -30) } }, B: logB() },
                  rir: { A: {}, B: {} }, obj: {}, variants: {},
                  blocks: { A: blockA, B: blockB }, blockOrder: ['A', 'B'] };
    resetRenderCache();
    const priorD1 = show(exHistory(two, blockB, ex, 'D1', 3));
    const priorD2 = show(exHistory(two, blockB, ex, 'D2', 3));
    return { d1: d1, d2: d2, priorD1: priorD1, priorD2: priorD2 };
  })()
`);
ok('a lift the plan puts on two days reads only its own day inside the block being trained',
   twoDayProbe.d1 === 'B/D1:40 B/D1:42', JSON.stringify(twoDayProbe));
ok('...and the other day reads only the other day',
   twoDayProbe.d2 === 'B/D2:41 B/D2:43', JSON.stringify(twoDayProbe));
ok('...while an earlier block\'s single day counts for both, oldest first',
   twoDayProbe.priorD1 === 'A/DA:30 B/D1:40 B/D1:42' &&
   twoDayProbe.priorD2 === 'A/DA:30 B/D2:41 B/D2:43', JSON.stringify(twoDayProbe));

console.log('\n== el objetivo guardado, las variantes y minRir ==');

/* `ex.minRir` is the reserve a lift never goes under, whatever the phase
   text asks for — and it can only ever make the target easier, which is
   the direction it exists to be wrong in. */
let a = target([{ sets: [[40, 10], [40, 9], [40, 8]], rir: '1' },
                { sets: [[40, 11], [40, 10], [40, 9]], rir: '1' }],
               { range: '8–12', inc: 2.5, sets: 3, rirWeek: 0 });
let b = target([{ sets: [[40, 10], [40, 9], [40, 8]], rir: '1' },
                { sets: [[40, 11], [40, 10], [40, 9]], rir: '1' }],
               { range: '8–12', inc: 2.5, sets: 3, rirWeek: 0, minRir: 2 });
ok('minRir floors the week\'s RIR, so the target asks for fewer reps, never more',
   a.show !== b.show && b.notes.includes('moreRir'), a.show + '  vs  ' + b.show);
ok('and a block imported with minRir keeps it',
   call(`normalizeImportedBlock({ name: 'B', days: [{ ex: [{ n: 'x', reps: '8-12', minRir: 1 }] }] }).days[0].ex[0].minRir`) === 1);
ok('while a nonsense one is dropped rather than rejecting the block',
   call(`'minRir' in normalizeImportedBlock({ name: 'B', days: [{ ex: [{ n: 'x', reps: '8-12', minRir: 'mucho' }] }] }).days[0].ex[0]`) === false);

/* A deload halves the week the plan actually asks for, `ex.add` included:
   the target line prices ceil(n/2) sets and the card has to draw the same
   number of rows or the two contradict each other on screen. */
ok('setsFor halves the added set too on a deload week',
   call(`setsFor({ sets: 4, add: 5 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 3);
ok('and a hand-written "Descarga" phase halves its week as well',
   call(`setsFor({ sets: 4 }, 3, { deload: 0, weeks: 8, phase: { 3: { r: 'Descarga' } } })`) === 2 &&
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 3: { r: 'Descarga' } } }, 3)`) === true);

/* The objetivo that was shown is written once and never rewritten: the
   record is what was ASKED for, so a weight that came down mid-session has
   something to be compared against. */
const objRecord = call(`
  (function () {
    const p = { obj: {} };
    const t = { conf: 'media', sets: [{ w: 45, r: 9, move: '\\u2191' }, { w: 42.75, r: 8, move: '' }] };
    const first = recordTarget(p, 'B', 3, 'D', 'E', t);
    const again = recordTarget(p, 'B', 3, 'D', 'E', { conf: 'alta', sets: [{ w: 99, r: 1, move: '' }] });
    const rec = p.obj.B['w3-D'].E;
    return { first: first, again: again, v: rec.v, conf: rec.conf, w: rec.sets[0].w, m: rec.sets[0].m, n: rec.sets.length };
  })()
`);
ok('the target shown is recorded once, with its moves and its confidence',
   objRecord.first === true && objRecord.v === 3 && objRecord.conf === 'media' &&
   objRecord.w === 45 && objRecord.m === '↑' && objRecord.n === 2, JSON.stringify(objRecord));
ok('and a second draw of the same session does not overwrite it',
   objRecord.again === false, JSON.stringify(objRecord));

/* Browsing never writes: the record is made by the handler that starts the
   session, and only on the transition from "no session yet" to "session".
   Before plans/021 the draw did it, so every week logged before v3 got a
   rebuilt target — read off today's clock, so anything older than ten days
   was filed as a "vuelta de parón" — the first time anyone scrolled past. */
const startRecord = call(`
  (function () {
    const p = { week: 2, obj: {} };
    const block = { id: 'B' }, day = { id: 'D' }, ex = { id: 'E' };
    const t = { kind: 'objetivo', conf: 'alta', hold: false, brake: true,
                sets: [{ w: 40, r: 10, move: '' }] };
    const rows = [{ w: '', r: '', done: false }];
    const before = recordTargetOnStart(p, block, day, ex, rows, false, t);   // nothing typed yet
    rows[0].w = '40';
    const browsed = recordTargetOnStart(p, block, day, ex, rows, true, t);   // rows were already a session
    const started = recordTargetOnStart(p, block, day, ex, rows, false, t);  // the transition
    const again = recordTargetOnStart(p, block, day, ex, rows, false, t);
    const rec = p.obj.B['w2-D'].E;
    return { before: before, browsed: browsed, started: started, again: again,
             kind: rec.kind, brake: rec.brake, hold: rec.hold };
  })()
`);
ok('an untouched row records nothing', startRecord.before === false, JSON.stringify(startRecord));
ok('rows that were already a session record nothing (browsing a logged week)',
   startRecord.browsed === false, JSON.stringify(startRecord));
ok('the first row of a session records the target, with its kind and the brake',
   startRecord.started === true && startRecord.kind === 'objetivo' && startRecord.brake === true,
   JSON.stringify(startRecord));
ok('hold is stored only when true', startRecord.hold === false, JSON.stringify(startRecord));
ok('and a second start of the same session does not overwrite it',
   startRecord.again === false, JSON.stringify(startRecord));

/* A source-level guard, because the bug this plan fixed was not a wrong
   answer but a write in the wrong place: a draw that grows the call back
   would pass every assertion above. Two sites only — the definition and
   the one call inside recordTargetOnStart. */
ok('no draw path calls recordTarget — only recordTargetOnStart does',
   (fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').match(/recordTarget\(/g) || []).length === 2);

/* A rename is the only evidence there is that the lift changed, because the
   log never stored the name a session was done under. */
const variants = call(`
  (function () {
    const p = { variants: {} };
    recordVariant(p, 'lat1', 'Elevaciones laterales en polea', 'Elevaciones en Y en polea cruzada', Date.UTC(2026, 5, 1));
    recordVariant(p, 'lat1', 'Elevaciones en Y en polea cruzada', 'Pájaros en polea', Date.UTC(2026, 7, 3));
    recordVariant(p, 'lat1', 'Pájaros en polea', 'Pájaros en polea', Date.UTC(2026, 8, 9));
    return { list: p.variants.lat1, since: variantSince(p, 'lat1') };
  })()
`);
ok('the first rename records the name that was running before it, undated',
   variants.list.length === 3 && variants.list[0].since === '1970-01-01', JSON.stringify(variants.list));
ok('every rename after it carries the day it happened',
   variants.list[1].since === '2026-06-01' && variants.list[2].since === '2026-08-03', JSON.stringify(variants.list));
ok('a save that changed no name records nothing', variants.list.length === 3, JSON.stringify(variants.list));
ok('and the cut is the last one', variants.since === Date.parse('2026-08-03T00:00:00Z'), String(variants.since));

/* A rename is a different lift; a spelling fix is not. */
const renameEdits = call(`
  (function () {
    const p = { variants: {} };
    const a = recordVariant(p, 'E', 'Press banca', 'Press Banca', Date.UTC(2026, 8, 1));
    const b = recordVariant(p, 'E', 'Pajaros', 'Pájaros', Date.UTC(2026, 8, 1));
    const c = recordVariant(p, 'E', 'Press (inclinado)', 'Press inclinado', Date.UTC(2026, 8, 1));
    const d = recordVariant(p, 'E', 'Press banca', 'Press inclinado', Date.UTC(2026, 8, 1));
    return { a, b, c, d, n: (p.variants.E || []).length };
  })()
`);
ok('a case-only edit records no rename', renameEdits.a === false, JSON.stringify(renameEdits));
ok('an accent-only edit records no rename', renameEdits.b === false, JSON.stringify(renameEdits));
ok('a punctuation-only edit records no rename', renameEdits.c === false, JSON.stringify(renameEdits));
ok('a real rename still records, and returns true so the save can say so',
   renameEdits.d === true && renameEdits.n === 2, JSON.stringify(renameEdits));

ok('the plan-editor save names a rename\'s consequence in its status line',
   /renombrad/.test(fs.readFileSync(path.join(ROOT, 'js/block-editor.js'), 'utf8')));

/* What the cut is FOR: the loads before a rename belong to another lift. */
const cutHistory = call(`
  (function () {
    const DAY = 86400000, T0 = Date.UTC(2026, 0, 5);
    const phase = {}; for (let i = 1; i <= 6; i++) phase[i] = { r: '1 RIR' };
    const ex = { id: 'E', n: 'x', sets: 3, reps: '8–12', inc: 2.5 };
    const block = { id: 'B', name: 'B', weeks: 8, deload: 0, phase: phase, days: [{ id: 'D', name: 'D', ex: [ex] }] };
    const p = { log: { B: {} }, rir: { B: {} }, obj: {}, variants: {}, blocks: { B: block }, blockOrder: ['B'] };
    [0, 7, 14].forEach(function (d, i) {
      p.log.B['w' + (i + 1) + '-D'] = { E: [{ w: '40', r: '10', done: true, ts: T0 + d * DAY }] };
      p.rir.B['w' + (i + 1) + '-D'] = { E: '1' };
    });
    resetRenderCache();
    const before = exHistory(p, block, ex, 'D', 4).length;
    p.variants.E = [{ n: 'viejo', since: '1970-01-01' }, { n: 'nuevo', since: '2026-01-15' }];
    resetRenderCache();
    return { before: before, after: exHistory(p, block, ex, 'D', 4).length };
  })()
`);
ok('a variant change cuts the sessions logged before it out of the history',
   cutHistory.before === 3 && cutHistory.after === 1, JSON.stringify(cutHistory));

/* Both records are profile data, so both have to survive the three routes
   that carry a profile: "Cargar copia", "Importar perfil" and the QR. */
const recordsRoundTrip = call(`
  (function () {
    state = defaultState(); migrate();
    const p = JSON.parse(JSON.stringify(state.profiles.hombre));
    p.log['block-1'] = { 'w1-d0': { chestpress: [{ w: '60', r: '10', done: true }] } };
    p.obj = { 'block-1': {
      'w1-d0': { chestpress: { v: 3, at: 123, conf: 'alta', kind: 'descarga', hold: true, brake: false,
                               sets: [{ w: 60, r: 10, m: '\\u2191' }] } },
      'w2-d0': { chestpress: { v: 3, at: 123, conf: 'constructor', kind: 'anything',
                               sets: [{ w: 60, r: 10, m: '' }] } },
    } };
    p.variants = { chestpress: [{ n: 'Press viejo', since: '1970-01-01' }, { n: 'Press nuevo', since: '2026-03-04' }],
                   bogus: [{ n: 'x', since: 'cuando sea' }] };
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(p)));
    const rec = after.obj['block-1'] && after.obj['block-1']['w1-d0'] && after.obj['block-1']['w1-d0'].chestpress;
    const junk = after.obj['block-1'] && after.obj['block-1']['w2-d0'] && after.obj['block-1']['w2-d0'].chestpress;
    return { conf: rec && rec.conf, w: rec && rec.sets[0].w, m: rec && rec.sets[0].m,
             kind: rec && rec.kind, hold: rec && rec.hold, brake: rec && ('brake' in rec),
             junkKind: junk && ('kind' in junk), junkConf: junk && junk.conf,
             variant: after.variants.chestpress && after.variants.chestpress.length,
             since: after.variants.chestpress && after.variants.chestpress[1].since,
             bogus: !!after.variants.bogus };
  })()
`);
ok('a restored profile keeps the objetivo it was shown',
   recordsRoundTrip.conf === 'alta' && recordsRoundTrip.w === 60 && recordsRoundTrip.m === '↑', JSON.stringify(recordsRoundTrip));
ok('...and what kind of objetivo it was, with the false brake left off rather than stored',
   recordsRoundTrip.kind === 'descarga' && recordsRoundTrip.hold === true && recordsRoundTrip.brake === false,
   JSON.stringify(recordsRoundTrip));
/* A kind nobody wrote is dropped, not carried through: a reader tells a
   pre-plans/021 record from a v3 one by the absence of the field, so an
   invented value would read as a genuine descarga. */
ok('a kind and a confianza the validator does not know are dropped, not carried through',
   recordsRoundTrip.junkKind === false && recordsRoundTrip.junkConf === 'baja',
   JSON.stringify(recordsRoundTrip));
ok('and its variant history, with an undatable entry dropped rather than guessed at',
   recordsRoundTrip.variant === 2 && recordsRoundTrip.since === '2026-03-04' && recordsRoundTrip.bogus === false,
   JSON.stringify(recordsRoundTrip));

/* `variants` is keyed by exercise id with no block above it, so it was the
   one map the import's per-block re-keying never reached: an id the
   importer renamed left its rename history behind on the wrong lift, or on
   no lift at all (plans/025). */
const variantRekey = call(`
  (function () {
    const p = { blocks: { B: { name: 'Bloque', weeks: 4, deload: 0, days: [
                  { id: 'd0', name: 'Día', ex: [
                    { id: 'dup', n: 'Press', reps: '10-15', sets: 3 },
                    { id: 'dup', n: 'Remo', reps: '10-15', sets: 3 },
                  ] } ] } },
                blockOrder: ['B'],
                variants: { dup: [{ n: 'a', since: '1970-01-01' }, { n: 'b', since: '2026-01-01' }] } };
    const after = normalizeImportedProfile(p);
    const ex = after.blocks.B.days[0].ex;
    const own = k => Object.prototype.hasOwnProperty.call(after.variants, k);
    return { first: ex[0].id, second: ex[1].id, onFirst: own(ex[0].id), onSecond: own(ex[1].id) };
  })()
`);
ok('a duplicate exercise id is renamed on import and the variant history stays with the exercise that kept the id',
   variantRekey.first === 'dup' && variantRekey.second !== 'dup' &&
   variantRekey.onFirst === true && variantRekey.onSecond === false, JSON.stringify(variantRekey));

const variantRekeyBlocked = call(`
  (function () {
    const p = { blocks: { B: { name: 'Bloque', weeks: 4, deload: 0, days: [
                  { id: 'd0', name: 'Día', ex: [
                    { id: 'constructor', n: 'Press banca', reps: '10-15', sets: 3 },
                  ] } ] } },
                blockOrder: ['B'],
                variants: { constructor: [{ n: 'Press viejo', since: '1970-01-01' },
                                          { n: 'Press nuevo', since: '2026-01-01' }] } };
    const after = normalizeImportedProfile(p);
    const id = after.blocks.B.days[0].ex[0].id;
    const own = k => Object.prototype.hasOwnProperty.call(after.variants, k);
    return { id: id, onNewId: own(id) && after.variants[id].length, stillBlocked: own('constructor') };
  })()
`);
ok('a variant keyed by a blocked id follows the exercise to the id it was given, instead of being dropped',
   variantRekeyBlocked.id !== 'constructor' && variantRekeyBlocked.onNewId === 2 &&
   variantRekeyBlocked.stillBlocked === false, JSON.stringify(variantRekeyBlocked));

/* Every backup written before v3 has neither map. */
ok('a profile that carries neither map migrates to empty ones rather than throwing',
   call(`
     (function () {
       state = defaultState();
       delete state.profiles.hombre.obj; delete state.profiles.hombre.variants;
       migrate();
       const p = state.profiles.hombre;
       return typeof p.obj === 'object' && typeof p.variants === 'object';
     })()
   `) === true);
ok('and a profile file with neither restores the same way',
   call(`
     (function () {
       state = defaultState(); migrate();
       const p = JSON.parse(JSON.stringify(state.profiles.hombre));
       delete p.obj; delete p.variants;
       const after = normalizeImportedProfile(p);
       return typeof after.variants === 'object' && !Object.keys(after.variants).length;
     })()
   `) === true);

/* The one-off for the three lateral-raise slots: the names are recorded,
   and the date is the oldest session there is, so nothing is cut. */
const latSeed = call(`
  (function () {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const day = p.blocks['block-1'].days[0];
    const lat = day.ex.find(function (e) { return e.id === 'lat1'; });
    lat.n = 'Elevaciones en Y en polea cruzada';
    p.log['block-1'] = { 'w1-d0': { lat1: [{ w: '6.8', r: '20', done: true, ts: Date.UTC(2026, 2, 2) }] } };
    delete p.variants.lat1;
    migrate();
    return p.variants.lat1;
  })()
`);
ok('the lateral-raise rename is seeded with both names',
   latSeed.length === 2 && latSeed[0].n === 'Elevaciones laterales en polea', JSON.stringify(latSeed));
ok('dated at the oldest session it has, so it cuts nothing',
   latSeed[1].since === '2026-03-02', JSON.stringify(latSeed));

console.log('\n== RIR por serie: el registro vive en la fila (plans/035) ==');
/* The RIR used to be one value per exercise per session, in a parallel map.
   It is `r.rir` on the log row now, one digit per set, and the map is read
   as a fallback and never written.

   The load-bearing assertion of the whole change is not in this section: it
   is that every objetivo case above still expects the same numbers. A log
   with no per-set values has to read EXACTLY as it did, and the inheritance
   rule below is what makes that true — a set with nothing typed takes the
   reserve of the next set that has one, which is what the single chip did
   to every set of the session. */

ok('rirNumber reads a typed digit', call("rirNumber('3')") === 3);
ok('...and still reads the three legacy chips',
   call("[rirNumber('2+'), rirNumber('1'), rirNumber('0')].join(',')") === '2,1,0');
ok('...and refuses what is neither', call("rirNumber('x')") === null && call("rirNumber('')") === null);
ok('...including a digit past RIR_MAX', call("rirNumber('6')") === null);

const rirsOf = (rows, legacy) => call(
  'sessionRirs(' + JSON.stringify(rows) + ', ' + JSON.stringify(legacy == null ? null : legacy) +
  ').map(function (v) { return v == null ? "x" : v; }).join(",")');
ok('sessionRirs: a set with nothing typed takes the next set that has one',
   rirsOf([{}, {}, { rir: '1' }, {}]) === '1,1,1,x', rirsOf([{}, {}, { rir: '1' }, {}]));
ok('...a session with nothing typed anywhere is empty throughout',
   rirsOf([{}, {}, {}]) === 'x,x,x', rirsOf([{}, {}, {}]));
ok('...and a typed value reaches backwards only as far as the next one that has its own',
   rirsOf([{ rir: '3' }, {}, {}, { rir: '0' }]) === '3,0,0,0',
   rirsOf([{ rir: '3' }, {}, {}, { rir: '0' }]));
ok('...the legacy chip fills a session whose rows carry nothing, as if typed on the last set',
   rirsOf([{}, {}, {}], 2) === '2,2,2', rirsOf([{}, {}, {}], 2));
ok('...and is ignored the moment any row carries one of its own',
   rirsOf([{}, { rir: '0' }, {}], 2) === '0,0,x', rirsOf([{}, { rir: '0' }, {}], 2));

/* All that is left of the chip's writer (plans/036): the box writes its own
   row, and the only thing it cannot do for itself is stop the legacy map
   putting an old value back on the next load. The row sweep that went with
   the chip is pinned here by its absence — with a box per set, clearing the
   other rows would wipe the three boxes beside the one being typed in. */
const dropLegacyProbe = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true, rir: '3' },
                  { w: '60', r: '9', done: true, rir: '1' }];
    const p = { log: { B: { 'w1-D': { E: rows } } },
                rir: { B: { 'w1-D': { E: '2+', F: '0' } } } };
    dropLegacyRir(p, 'B', 1, 'D', 'E');
    const one = JSON.stringify(p.rir.B['w1-D']);
    const kept = rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    dropLegacyRir(p, 'B', 1, 'D', 'F');
    return { one: one, kept: kept, empty: JSON.stringify(p.rir.B) };
  })()
`);
ok('dropLegacyRir drops the exercise-session it is handed and no other',
   dropLegacyProbe.one === '{"F":"0"}', JSON.stringify(dropLegacyProbe));
ok('...and leaves every row where it is: the chip\'s sweep went with the chip',
   dropLegacyProbe.kept === '3,1', JSON.stringify(dropLegacyProbe));
ok('...and takes the slot with the last exercise out of it',
   dropLegacyProbe.empty === '{}', JSON.stringify(dropLegacyProbe));

/* Three edges of the fold and its fallback, one root (plans/039): two
   selectors for "the row the session's RIR sits on", and a fallback that
   trusted a row that was not a working set. */
const foldSkipsTyped = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true, rir: '3' },
                  { w: '60', r: '9', done: true },
                  { w: '60', r: '8', done: true }];
    const p = { log: { B: { 'w1-D': { E: rows } } },
                rir: { B: { 'w1-D': { E: '2+' } } } };
    foldRirMap(p, 'B');
    return rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
  })()
`);
ok('foldRirMap leaves a session alone when any of its sets already carries a value — the share round-trip stamps nothing (plans/039)',
   foldSkipsTyped === '3,x,x', foldSkipsTyped);

const foldOnce = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true },
                  { w: '60', r: '9', done: true },
                  { w: '60', r: '8', done: true }];
    const p = { log: { B: { 'w1-D': { E: rows } } },
                rir: { B: { 'w1-D': { E: '1' } } } };
    foldRirMap(p, 'B');
    const first = rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    rows.push({ w: '60', r: '7', done: true });
    foldRirMap(p, 'B');
    const second = rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    return first + ' | ' + second;
  })()
`);
ok('...and folds a legacy chip exactly once per session: a set ticked later does not inherit it from the map',
   foldOnce === 'x,x,1 | x,x,1,x', foldOnce);

const orphanRows = "[{ w: '60', r: '10', done: true }, { w: '60', r: '9', done: true }, " +
                   "{ w: '60', r: '8', done: true }, { w: '60', r: '8', done: false, rir: '0' }]";
const orphanReader = call(`
  (function () {
    const rows = ${orphanRows};
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: {} };
    const s = readSession(p, { id: 'B' }, 1, 'D', 'E', rows, undefined);
    return s.sets.map(function (x) { return x.rir == null ? 'x' : x.rir; }).join(',');
  })()
`);
ok('readSession never reads a reserve off a set that is not a working set: a RIR typed then un-ticked prices nothing (plans/039)',
   orphanReader === 'x,x,x', orphanReader);

const getRirProbe = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true, rir: '3' }, { w: '60', r: '9', done: true, rir: '1' }];
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: { B: { 'w1-D': { E: '2+' } } } };
    const fromRow = getRir(p, 'B', 1, 'D', 'E');
    delete rows[0].rir; delete rows[1].rir;
    const fromMap = getRir(p, 'B', 1, 'D', 'E');
    delete p.rir.B['w1-D'].E;
    return [fromRow, fromMap, getRir(p, 'B', 1, 'D', 'E')].join('|');
  })()
`);
ok('getRir reads the last working set that carries a value, the legacy map behind it, and nothing beyond that',
   getRirProbe === '1|2+|', getRirProbe);

const foldProbe = call(`
  (function () {
    const mk = function () {
      return { log: { B: { 'w1-D': { E: [{ w: '60', r: '10', done: true },
                                         { w: '60', r: '9', done: true },
                                         { w: '60', r: '', done: false }] } } },
               rir: { B: { 'w1-D': { E: '2+' } } } };
    };
    const shot = function (p) {
      return p.log.B['w1-D'].E.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    };
    const p = mk();
    foldRirMap(p, 'B');
    const once = shot(p), kept = p.rir.B['w1-D'].E;
    foldRirMap(p, 'B');
    const twice = shot(p);
    const q = mk();
    q.log.B['w1-D'].E[1].rir = '0';
    foldRirMap(q, 'B');
    return { once: once, kept: kept, twice: twice, own: shot(q) };
  })()
`);
ok('foldRirMap lands a 2+ chip on the last set done, as the digit it stands for',
   foldProbe.once === 'x,2,x', JSON.stringify(foldProbe));
ok('...and leaves the map entry where it is, as the fallback it still is',
   foldProbe.kept === '2+', JSON.stringify(foldProbe));
ok('...a second run changes nothing', foldProbe.twice === 'x,2,x', JSON.stringify(foldProbe));
ok('...and a row that already carries a value is never overwritten',
   foldProbe.own === 'x,0,x', JSON.stringify(foldProbe));

/* The two ways a reserve typed before anything is ticked could be recorded
   and then lost, both of which shipped past the unit suite and the browser
   suite because neither had ever written one (AGENTS.md's testing policy: a
   case goes in whenever a bug turns out to have been invisible from the
   outside; these are arithmetic and data repair, so they go here rather
   than in smoke.js — the visible round trip is pinned there). The box that
   writes it is the RIR box in the set row since plans/036; the two lines
   below are its handler's write, which is all the handler does to the
   log. */
const untouchedDay = call(`
  (function () {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    p.log['block-1'] = {};
    /* Exactly what opening a day does: pad the rows out, tick nothing. */
    const rows = entry(p, 'block-1', 1, day.id, 'chestpress', 3);
    rows[2].rir = '1';
    dropLegacyRir(p, 'block-1', 1, day.id, 'chestpress');
    const read = getRir(p, 'block-1', 1, day.id, 'chestpress');
    const used = rows.some(rowUsed);
    const shared = blockShareLog(p, block);
    const sentRir = ((shared[slot(1, day.id)] || {}).chestpress || []).some(function (r) { return r.rir === '1'; });
    drawnSlot = null;
    pruneLog();
    const survived = getRir(p, 'block-1', 1, day.id, 'chestpress');
    /* Read defensively: before this was fixed pruneLog above deleted the
       whole slot, and reaching into it threw rather than failing an
       assertion — which takes the suite down and hides every case after
       it. */
    const live = ((p.log['block-1'] || {})[slot(1, day.id)] || {}).chestpress;
    if (!Array.isArray(live)) {
      return { read: read, used: used, sentRir: sentRir, survived: survived,
               beside: 'the slot is gone', cleared: 'the slot is gone' };
    }
    /* A reserve typed into another set's box, on a set that WAS done: it
       has to leave the first one where it is — the chip's sweep is exactly
       what would have wiped it — and the session's own reading is still the
       last working set's. */
    live[0].w = '60'; live[0].r = '10'; live[0].done = true;
    live[0].rir = '0';
    dropLegacyRir(p, 'block-1', 1, day.id, 'chestpress');
    const beside = live.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',') +
                   '|' + getRir(p, 'block-1', 1, day.id, 'chestpress');
    delete live[0].rir; delete live[2].rir;
    return { read: read, used: used, sentRir: sentRir, survived: survived, beside: beside,
             cleared: getRir(p, 'block-1', 1, day.id, 'chestpress') };
  })()
`);
ok('an RIR typed on a day with nothing ticked writes a value the readers can see',
   untouchedDay.read === '1', JSON.stringify(untouchedDay));
ok('...the row it lands on counts as used, so pruneLog keeps it',
   untouchedDay.used === true && untouchedDay.survived === '1', JSON.stringify(untouchedDay));
ok('...and a share carries it', untouchedDay.sentRir === true, JSON.stringify(untouchedDay));
ok('...a second box keeps its own value, and the session still reads the last working set',
   untouchedDay.beside === '0,x,1|0', JSON.stringify(untouchedDay));
ok('...and emptying the boxes clears it', untouchedDay.cleared === '', JSON.stringify(untouchedDay));

/* Writing an RIR is starting the session, so the objetivo record has to be
   written on it exactly as it is on a weight or a rep — which is only true
   because rowUsed counts one. The order here is the RIR box's handler. */
const rirStarts = call(`
  (function () {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    const ex = day.ex[0];
    ex.reps = '8-12'; ex.sets = 3; delete ex.add;
    p.log['block-1'] = {}; p.obj = {};
    for (let w = 1; w <= 3; w++) {
      p.log['block-1'][slot(w, day.id)] = { chestpress: [
        { w: '40', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '40', r: '9', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 }] };
    }
    p.week = 4;
    resetRenderCache();
    const rows = entry(p, 'block-1', 4, day.id, ex.id, 3);
    const est = targetNow(p, block, day, ex, 4);
    const wasSession = rows.some(rowUsed);
    rows[0].rir = '1';
    dropLegacyRir(p, 'block-1', 4, day.id, ex.id);
    recordTargetOnStart(p, block, day, ex, rows, wasSession, est);
    return (est ? 'est' : 'no-est') + '|' + wasSession + '|' +
           !!(p.obj['block-1'] && p.obj['block-1'][slot(4, day.id)] && p.obj['block-1'][slot(4, day.id)][ex.id]);
  })()
`);
ok('typing an RIR starts the session, so the objetivo shown is recorded with it',
   rirStarts === 'est|false|true', rirStarts);

/* The legacy map is the fallback getRir reads and foldRirMap re-applies on
   every load, so emptying the box has to reach it too or "empty it to clear
   it" is false for every session logged before plans/035. */
const clearFolded = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true }, { w: '60', r: '9', done: true }];
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: { B: { 'w1-D': { E: '2+' } } } };
    foldRirMap(p, 'B');
    const folded = getRir(p, 'B', 1, 'D', 'E');
    /* Emptying the box the fold landed the old chip in. */
    delete rows[1].rir;
    dropLegacyRir(p, 'B', 1, 'D', 'E');
    const cleared = getRir(p, 'B', 1, 'D', 'E');
    foldRirMap(p, 'B');
    return [folded, cleared, getRir(p, 'B', 1, 'D', 'E'), JSON.stringify(p.rir.B)].join('|');
  })()
`);
ok('emptying the box on a session logged before plans/035 clears it, and the next load does not put it back',
   clearFolded === '2|||{}', clearFolded);

const exSess = call(`
  (function (rirs, chip) {
    const rows = [10, 9, 9, 8].map(function (n, i) {
      const row = { w: '60', r: String(n), done: true };
      if (rirs[i] != null) row.rir = String(rirs[i]);
      return row;
    });
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: {}, blocks: { B: { id: 'B', days: [] } } };
    if (chip) { p.rir.B = { 'w1-D': { E: chip } }; }
    const s = ruleSession(sessionsOf(p, { weeks: 'logged', lift: { id: 'E' }, blocks: ['B'] })[0], 8, 15);
    return { rho: s.sets.map(function (x) { return x.rho; }).join(','),
             cens: s.sets.map(function (x) { return x.cens ? 'c' : '.'; }).join(''),
             rir: s.rir, sessionRho: s.rho };
  })
`);
const paced4 = exSess(['3', '2', '1', '0']);
ok('the rule\'s session prices every set at its own reserve', paced4.rho === '3,2,1,0', JSON.stringify(paced4));
ok('...and censors the sets held at two or more in reserve rather than the whole session',
   paced4.cens === 'cc..', JSON.stringify(paced4));
ok('...while the session itself still reads as its last set',
   paced4.rir === '0' && paced4.sessionRho === 0, JSON.stringify(paced4));
const lastOnly = exSess([null, null, null, '1']);
ok('a session whose only value is on the last set prices every set at it — the old chip, exactly',
   lastOnly.rho === '1,1,1,1' && lastOnly.cens === '....', JSON.stringify(lastOnly));
const legacyChip = exSess([null, null, null, null], '1');
ok('...and the legacy chip in the map reads identically',
   legacyChip.rho === lastOnly.rho && legacyChip.cens === lastOnly.cens, JSON.stringify(legacyChip));
const nothing = exSess([null, null, null, null]);
ok('a session with nothing recorded is every set at zero and every set a floor',
   nothing.rho === '0,0,0,0' && nothing.cens === 'cccc' && nothing.rir === null, JSON.stringify(nothing));

/* The session the whole change is about: 60 kg for 10, 9, 8, 8 reps, paced
   3 → 2 → 1 → 0 down the four sets. Read at the one chip the lifter tapped
   for the last set, every set was priced as if it had gone to failure. */
const pacedOpts = { range: '10–15', inc: 2.5, sets: 4, rirWeek: 2 };
const pacedRows = [[60, 10], [60, 9], [60, 8], [60, 8]];
const pacedT = target([{ sets: pacedRows, rirs: ['3', '2', '1', '0'] }], pacedOpts);
const chipT = target([{ sets: pacedRows, rir: '0' }], pacedOpts);
ok('a session paced down its sets reads its first set at what that set proved, not at the last set’s reserve',
   pacedT.level === 86 && chipT.level === 80, JSON.stringify({ paced: pacedT.level, chip: chipT.level }));
ok('...so the first set is asked for the reps it earned instead of a back-off',
   pacedT.show.indexOf('60×12 · 60×10') === 0 && chipT.show.indexOf('57,5×10↓') === 0,
   pacedT.show + '  vs  ' + chipT.show);
ok('...the between-set decay is measured on capacities that are comparable, so it reports the reserve really spent',
   pacedT.phi === '1.000 0.974 0.927 0.903' && chipT.phi === '1.000 0.975 0.950 0.950',
   pacedT.phi + '  vs  ' + chipT.phi);
ok('...and the level rises further than that decay costs, so the last set is asked for more rather than less',
   pacedT.show.slice(-6) === '55×11↓' && chipT.show.slice(-5) === '55×10',
   pacedT.show + '  vs  ' + chipT.show);

/* Three identical sets, 60×10, the first held at 3 in reserve and the rest
   taken to 0 — under a brake, so the trend term is zero and what is left is
   nothing but the reserves. It pins per-set CAPACITY pricing, not the
   same-weight floor: the floor cannot be reached (see its own comment in
   targetFor), and this case does not move if it is reverted to rhoLast.
   What it does measure is that the first set is priced at what a set
   stopped three reps early actually proved, so it is asked for 11 rather
   than the 8 one chip for the whole session produced. */
const heldOpts = { range: '8–12', inc: 2.5, sets: 3, rirWeek: 2, brake: true };
const heldT = target([{ sets: [[60, 10], [60, 10], [60, 10]], rirs: ['3', '0', '0'] }], heldOpts);
const heldChipT = target([{ sets: [[60, 10], [60, 10], [60, 10]], rir: '0' }], heldOpts);
ok('a first set held at 3 in reserve is priced at what it proved, so a stricter week still asks it for more reps, not fewer',
   heldT.show === '60×11 · 60×8 · 60×8' && heldChipT.show === '60×8 · 60×8 · 60×8',
   heldT.show + '  vs  ' + heldChipT.show);

/* oneRep is the FIRST set's rep-equivalent, so it is priced at the first
   set's reserve: 1/(30 + 10 + 3). Reading the last set's instead — what the
   code did while one chip was all there was — gives 1/(30 + 10 + 0), which
   is the number this assertion refuses. */
const oneRepT = target([{ sets: [[60, 10], [60, 10]], rirs: ['3', '0'] }],
                       { range: '8–12', inc: 2.5, sets: 2, rirWeek: 2 });
ok('the expected gain is the first set’s rep-equivalent, not the last set’s',
   Math.abs(oneRepT.g - 1 / 43) < 1e-12 && Math.abs(oneRepT.g - 1 / 40) > 1e-6, String(oneRepT.g));

const levelProbe = call(`
  (function (rir) {
    const p = { log: { B: { 'w1-D': { E: [{ w: '60', r: '10', done: true, rir: rir },
                                          { w: '60', r: '10', done: true, rir: '0' }] } } }, rir: {},
                blocks: { B: { id: 'B', days: [] } } };
    const lv = levelOf(capSeq([ruleSession(sessionsOf(p, { weeks: 'logged', lift: { id: 'E' }, blocks: ['B'] })[0], 8, 15)]));
    return lv.cens + '|' + lv.level;
  })
`);
ok('a first set typed at 1 in reserve is a reading, and the level can move on it',
   levelProbe('1') === 'false|82', levelProbe('1'));
ok('...typed at 2 it stays a floor', levelProbe('2') === 'true|84', levelProbe('2'));
const sixSessions = n => Array.from({ length: 6 }, () => ({ sets: [[60, 10], [60, 9], [60, 8]], rirs: [n, null, '0'] }));
ok('and the confidence chip is what typing the first set buys: it climbs from baja to alta',
   target(sixSessions('1'), { range: '8–12', inc: 2.5, sets: 3, rirWeek: 2 }).conf === 'alta' &&
   target(sixSessions('2'), { range: '8–12', inc: 2.5, sets: 3, rirWeek: 2 }).conf === 'baja');

const recProbe = call(`
  (function () {
    const p = { obj: {} };
    recordTarget(p, 'B', 1, 'D', 'E', { conf: 'alta', kind: 'objetivo', rirWeek: 2, sets: [{ w: 60, r: 10, move: '' }] });
    recordTarget(p, 'B', 1, 'D', 'F', { conf: 'baja', kind: 'descarga', sets: [{ w: 40, r: 10, move: '' }] });
    const sl = p.obj.B['w1-D'];
    return [sl.E.rir, sl.F.rir === null ? 'null' : String(sl.F.rir)].join('|');
  })()
`);
ok('recordTarget keeps the week’s RIR the reps were solved for, and none for a descarga that was solved for no reserve',
   recProbe === '2|null', recProbe);
const objRir = call(`
  (function () {
    const rawBlock = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };
    const normalized = normalizeImportedBlock(rawBlock);
    const run = function (v) {
      const raw = { 'w1-d0': { e1: { v: 3, at: 1, conf: 'media', rir: v, sets: [{ w: 45, r: 9, m: '' }] } } };
      const kept = normalizeImportedObj(raw, rawBlock, normalized)['w1-' + normalized.days[0].id][normalized.days[0].ex[0].id];
      return 'rir' in kept ? String(kept.rir) : 'x';
    };
    return [run(3), run('x'), run(9), run(2.5)].join(',');
  })()
`);
ok('normalizeImportedObj keeps an integer inside the range and drops everything else, like kind',
   objRir === '3,x,x,x', objRir);

const line = rows => call('decayLine(' + JSON.stringify(rows) + ')');
ok('decayLine says the first set went to failure when that is what was typed',
   line([{ r: '12', rir: '0' }, { r: '8' }]) === '⚠ caída de 4 reps: primera serie a 0 RIR — las de después se vacían',
   line([{ r: '12', rir: '0' }, { r: '8' }]));
ok('...makes no such claim at 1 in reserve',
   line([{ r: '12', rir: '1' }, { r: '8' }]) === '⚠ caída de 4 reps: primera serie a 1 RIR — las de después se vacían',
   line([{ r: '12', rir: '1' }, { r: '8' }]));
ok('...points at the rests when the first set was typed holgada',
   line([{ r: '12', rir: '3' }, { r: '8' }]) === '⚠ caída de 4 reps con la primera serie holgada (RIR 3): ¿descansos cortos?',
   line([{ r: '12', rir: '3' }, { r: '8' }]));
ok('...and still asks the question when nothing was typed',
   line([{ r: '12' }, { r: '8' }]) === '⚠ caída de 4 reps: ¿primera serie al fallo?',
   line([{ r: '12' }, { r: '8' }]));
ok('...and says nothing at all without a drop worth naming',
   line([{ r: '12' }, { r: '11' }]) === '', line([{ r: '12' }, { r: '11' }]));

/* The Diagnóstico's three effort signals, read end to end through diagRows:
   three flat sessions of one exercise, and the verdict the signals pick. */
const diagProbe = call(`
  (function (sessions, useMap) {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    const ex = day.ex[0];
    ex.reps = '8-12'; ex.sets = 3; delete ex.add;
    const DAY = 86400000, start = Date.now() - 28 * DAY;
    p.log['block-1'] = {}; p.rir['block-1'] = {};
    sessions.forEach(function (rows, i) {
      const bucket = {};
      bucket[ex.id] = rows.map(function (x) {
        const row = { w: '40', r: String(x[0]), done: true, ts: start + i * 7 * DAY };
        if (!useMap && x[1] != null) row.rir = String(x[1]);
        return row;
      });
      p.log['block-1'][slot(i + 1, day.id)] = bucket;
      const last = rows[rows.length - 1][1];
      if (useMap && last != null) {
        const m = {}; m[ex.id] = String(last);
        p.rir['block-1'][slot(i + 1, day.id)] = m;
      }
    });
    p.week = sessions.length + 1; p.day = 0;
    resetRenderCache();
    const row = diagRows(p, block, 'block').find(function (r) { return r.id === ex.id; });
    return row.trend + ' | ' + row.lectura;
  })
`);
const decaySess = (first, last) => [[12, first], [10, null], [8, last]];
const easySess = last => [[12, null], [11, null], [11, last]];
const three = f => [f, f, f];
ok('easy counts a typed 3 exactly as the old 2+ chip did',
   diagProbe(three(easySess('3')), false) === 'flat | Falta intensidad — RIR 2+ repetido' &&
   diagProbe(three(easySess('2+')), true) === 'flat | Falta intensidad — RIR 2+ repetido',
   diagProbe(three(easySess('3')), false));
ok('failure fires on a 0 typed on the row and on the legacy chip alike',
   diagProbe([easySess(null), easySess(null), easySess('0')], false) === 'flat | Fatiga, no falta de esfuerzo' &&
   diagProbe([easySess(null), easySess(null), easySess('0')], true) === 'flat | Fatiga, no falta de esfuerzo',
   diagProbe([easySess(null), easySess(null), easySess('0')], false));
ok('decay no longer blames a first set the lifter typed at 2 in reserve',
   diagProbe(three(decaySess('2', '1')), false) ===
     'flat | Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
   diagProbe(three(decaySess('2', '1')), false));
ok('...and still fires when the first set was typed at 0',
   diagProbe(three(decaySess('0', '1')), false) === 'flat | Primera serie al fallo — las de después se vacían',
   diagProbe(three(decaySess('0', '1')), false));
ok('...or when nothing was typed at all, which is every session logged before this',
   diagProbe(three(decaySess(null, null)), false) === 'flat | Primera serie al fallo — las de después se vacían',
   diagProbe(three(decaySess(null, null)), false));

const logRir = call(`
  (function () {
    const rawBlock = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };
    const normalized = normalizeImportedBlock(rawBlock);
    const dayId = normalized.days[0].id, exId = normalized.days[0].ex[0].id;
    const raw = { 'w1-d0': { e1: [{ w: '60', r: '10', done: true, rir: '4' },
                                  { w: '60', r: '10', done: true, rir: '2+' },
                                  { w: '60', r: '10', done: true, rir: '7' },
                                  { w: '60', r: '10', done: true, rir: 7 },
                                  { w: '60', r: '10', done: true, rir: '' }] } };
    const out = normalizeImportedLog(raw, rawBlock, normalized)['w1-' + dayId][exId];
    return out.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
  })()
`);
ok('normalizeImportedLog keeps one digit on the row and drops a chip, a digit past the cap and an empty value',
   logRir === '4,x,x,x,x', logRir);

const rirCsvProbe = call(`
  (function () {
    state = defaultState(); migrate();
    Object.keys(state.profiles).forEach(function (k) { if (k !== 'hombre') delete state.profiles[k]; });
    state.activeProfile = 'hombre';
    const p = state.profiles.hombre;
    p.label = 'H';
    const block = p.blocks['block-1'];
    block.name = 'B';
    p.blockOrder = ['block-1'];
    const day = block.days[0];
    const ex = day.ex[0];
    ex.n = 'Press';
    p.log['block-1'] = {}; p.rir['block-1'] = {};
    const w1 = {}; w1[ex.id] = [{ w: '60', r: '10', done: true, rir: '3' },
                                { w: '60', r: '9', done: true },
                                { w: '60', r: '8', done: true }];
    p.log['block-1'][slot(1, day.id)] = w1;
    /* A session from before plans/035: the chip in the map, folded on load
       onto the last set and nowhere else. */
    const w2 = {}; w2[ex.id] = [{ w: '55', r: '10', done: true }, { w: '55', r: '9', done: true }];
    p.log['block-1'][slot(2, day.id)] = w2;
    const m = {}; m[ex.id] = '2+';
    p.rir['block-1'][slot(2, day.id)] = m;
    foldRirMap(p, 'block-1');
    const lines = buildCsv().split('\\r\\n');
    const col = function (i) { return lines[i].split(',')[12]; };
    return { head: lines[0].split(',')[12],
             week1: [col(1), col(2), col(3)].join(','),
             week2: [col(4), col(5)].join(',') };
  })()
`);
ok('the CSV column is still called rir', rirCsvProbe.head === 'rir', JSON.stringify(rirCsvProbe));
ok('...and holds each set’s own typed value, blank where nothing was typed',
   rirCsvProbe.week1 === '3,,', JSON.stringify(rirCsvProbe));
ok('...while a folded legacy chip shows on the session’s last row only',
   rirCsvProbe.week2 === ',2', JSON.stringify(rirCsvProbe));

const shareProbe = call(`
  (function (rirs) {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    const ex = day.ex[0];
    p.log['block-1'] = {}; p.rir['block-1'] = {};
    const bucket = {}; bucket[ex.id] = rirs.map(function (v, i) {
      const row = { w: '60', r: String(10 - i), done: true };
      if (v != null) row.rir = v;
      return row;
    });
    p.log['block-1'][slot(1, day.id)] = bucket;
    const plan = blockSharePlan(block);
    const log = blockShareLog(p, block);
    const chips = blockShareRir(p, block);
    const normalized = normalizeImportedBlock(plan);
    const back = normalizeImportedLog(log, plan, normalized);
    const rows = back[slot(1, normalized.days[0].id)][normalized.days[0].ex[0].id];
    return { back: rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(','),
             chip: chips[slot(1, day.id)][ex.id] };
  })
`);
const shared = shareProbe(['3', null, '1']);
ok('a share carries each set’s own value on the row, through the validator on the other side',
   shared.back === '3,x,1', JSON.stringify(shared));
ok('...and the legacy map it still sends is derived from those rows, for a phone that reads nothing else',
   shared.chip === '1' && shareProbe(['1', null, '3']).chip === '2+',
   JSON.stringify(shared) + ' / ' + JSON.stringify(shareProbe(['1', null, '3'])));

/* `u` is the row's unit stamp (stampRowUnit), and both field lists that
   rebuild a row left it out, so a 100 lb set restored from a backup, a
   loaded profile or a QR share came back as 100 kg. Only the exact 'lb'
   survives — kg is the absence of the stamp, so anything else is dropped
   rather than kept as a value rowUnit would read as kg anyway. */
const unitProbe = call(`
  (function () {
    const rawBlock = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };
    const normalized = normalizeImportedBlock(rawBlock);
    const dayId = normalized.days[0].id, exId = normalized.days[0].ex[0].id;
    const raw = { 'w1-d0': { e1: [{ w: '100', r: '10', done: true, u: 'lb' },
                                  { w: '100', r: '10', done: true },
                                  { w: '100', r: '10', done: true, u: 'kg' },
                                  { w: '100', r: '10', done: true, u: 'LB' },
                                  { w: '100', r: '10', done: true, u: { lb: 1 } }] } };
    const imported = normalizeImportedLog(raw, rawBlock, normalized)['w1-' + dayId][exId]
      .map(function (r) { return 'u' in r ? r.u : 'x'; }).join(',');

    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    const ex = day.ex[0];
    p.log['block-1'] = {};
    const bucket = {}; bucket[ex.id] = [{ w: '100', r: '10', done: true, u: 'lb' }, { w: '60', r: '10', done: true }];
    p.log['block-1'][slot(1, day.id)] = bucket;
    const plan = blockSharePlan(block);
    const sn = normalizeImportedBlock(plan);
    const shared = normalizeImportedLog(blockShareLog(p, block), plan, sn)[slot(1, sn.days[0].id)][sn.days[0].ex[0].id]
      .map(function (r) { return rowUnit(r); }).join(',');

    const restored = normalizeImportedProfile(JSON.parse(JSON.stringify(p)))
      .log['block-1'][slot(1, day.id)][ex.id].map(function (r) { return rowUnit(r); }).join(',');
    return { imported: imported, shared: shared, restored: restored };
  })()
`);
ok('normalizeImportedLog keeps an lb stamp and drops every other value of u',
   unitProbe.imported === 'lb,x,x,x,x', JSON.stringify(unitProbe));
ok('...a QR share carries it through blockShareLog to the other side',
   unitProbe.shared === 'lb,kg', JSON.stringify(unitProbe));
ok('...and a restored backup or loaded profile keeps a 100 lb set in lb',
   unitProbe.restored === 'lb,kg', JSON.stringify(unitProbe));

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
/* The id fallbacks slug the *name*, and a name can slug straight to a
   reserved word. No map broke — they are prototype-less or write own
   properties — but recordVariant and the import's variants block both
   safeKey the id and drop it, so a lift called "Constructor" could never
   carry a rename cut (plans/025). */
const slugConstructorBlock = Object.assign({}, minimalBlock, {
  days: [{ name: 'Día 1', ex: [{ n: 'Constructor', sets: 3, reps: '10-15' }] }],
});
ok('an exercise whose name slugs to a reserved word gets the positional id, not "constructor"',
   call('normalizeImportedBlock(' + JSON.stringify(slugConstructorBlock) + ').days[0].ex[0].id') === 'ex-0-0');

const migrateSlugProbe = call(`
  (function () {
    state = defaultState();
    state.profiles.hombre.blocks = { B: { id: 'B', name: 'Bloque', weeks: 8, deload: 0,
      days: [{ id: 'd0', name: 'Día 1', ex: [{ n: 'Prototype', sets: 3, reps: '10-15' }] }] } };
    state.profiles.hombre.blockOrder = ['B'];
    state.profiles.hombre.activeBlock = 'B';
    migrate();
    return state.profiles.hombre.blocks.B.days[0].ex[0].id;
  })()
`);
ok('migrate() gives the same positional id to an id-less exercise whose name slugs to a reserved word',
   migrateSlugProbe === 'ex-0-0', String(migrateSlugProbe));

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

console.log('\n== normalizeImportedObj: the rule\'s own record, re-keyed like its twins (plans/026) ==');
/* The one v3 function that takes untrusted bytes, and the only one of the
   four normalizeImported* twins with no test of its own. A record of what
   the rule put on the screen is not evidence about anything, so nothing in
   it is trusted past its own shape — which is exactly the kind of code
   that rots quietly. Built like logProbe above: one raw block, normalized,
   then one slot at a time through the validator. */
const objProbe = call(`
  (function() {
    const rawBlock = { name: 'B', weeks: 8, deload: 0, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] }] };
    const normalized = normalizeImportedBlock(rawBlock);
    const dayId = normalized.days[0].id, exId = normalized.days[0].ex[0].id;

    const run = function (key, id, rec) {
      const raw = {}; raw[key] = {}; raw[key][id] = rec;
      return normalizeImportedObj(raw, rawBlock, normalized);
    };
    const rec = function (over) {
      const r = { v: 3, at: 1, conf: 'media', sets: [{ w: 45, r: 9, m: '↑' }] };
      for (const k in over) r[k] = over[k];
      return r;
    };
    const kept = function (out) { const k = 'w1-' + dayId; return (out[k] && out[k][exId]) || null; };
    const empty = function (out) { return Object.keys(out).length === 0; };

    const good = kept(run('w1-' + dayId, exId, rec()));
    /* Everything wrong at once, because each field is clamped on its own
       and a record only has to be rejected whole when its sets are. */
    const bad = kept(run('w1-' + dayId, exId,
      rec({ at: 'yesterday', conf: 'nonsense', sets: [{ w: 99999, r: -5, m: 'x' }] })));
    /* The fields plans/021 added, and the inherited-name hole its
       membership test closed. */
    const inherited = kept(run('w1-' + dayId, exId, rec({ conf: 'constructor' })));
    const deload = kept(run('w1-' + dayId, exId, rec({ kind: 'descarga' })));
    const madeUpKind = kept(run('w1-' + dayId, exId, rec({ kind: 'x' })));
    const held = kept(run('w1-' + dayId, exId, rec({ hold: true })));
    const truthyHold = kept(run('w1-' + dayId, exId, rec({ hold: 'yes' })));
    return {
      confInherited: !!inherited && inherited.conf === 'baja',
      kindKept: !!deload && deload.kind === 'descarga',
      kindDropped: !!madeUpKind && !('kind' in madeUpKind),
      holdKept: !!held && held.hold === true,
      holdDropped: !!truthyHold && !('hold' in truthyHold),
      roundTrip: !!good && good.sets[0].w === 45 && good.sets[0].r === 9 &&
                 good.sets[0].m === '↑' && good.conf === 'media' && good.at === 1 && good.v === 3,
      weekZero: empty(run('w0-' + dayId, exId, rec())),
      weekPastCap: empty(run('w17-' + dayId, exId, rec())),
      unknownDay: empty(run('w1-no-such-day', exId, rec())),
      unknownEx: empty(run('w1-' + dayId, 'no-such-ex', rec())),
      setsNotAnArray: empty(run('w1-' + dayId, exId, rec({ sets: 'nope' }))),
      setsEmpty: empty(run('w1-' + dayId, exId, rec({ sets: [] }))),
      clampedW: !!bad && bad.sets[0].w === 9999,
      clampedR: !!bad && bad.sets[0].r === 0,
      droppedMove: !!bad && bad.sets[0].m === '',
      confFallback: !!bad && bad.conf === 'baja',
      atFallback: !!bad && bad.at === 0,
    };
  })()
`);
ok('normalizeImportedObj keeps a well-formed record whole', objProbe.roundTrip, JSON.stringify(objProbe));
ok('a week of 0 is no week', objProbe.weekZero, JSON.stringify(objProbe));
ok('a week past MAX_WEEKS is dropped rather than filed above the cap', objProbe.weekPastCap, JSON.stringify(objProbe));
ok('a day id this block does not have is dropped', objProbe.unknownDay, JSON.stringify(objProbe));
ok('an exercise id that day does not have is dropped', objProbe.unknownEx, JSON.stringify(objProbe));
ok('a record whose sets are not an array is dropped, not coerced', objProbe.setsNotAnArray, JSON.stringify(objProbe));
ok('...and neither is a record with no sets left in it kept', objProbe.setsEmpty, JSON.stringify(objProbe));
ok('a weight past the cap clamps instead of rejecting the record', objProbe.clampedW, JSON.stringify(objProbe));
ok('a negative rep count clamps to zero', objProbe.clampedR, JSON.stringify(objProbe));
ok('a move marker that is neither arrow becomes no marker', objProbe.droppedMove, JSON.stringify(objProbe));
ok('a confidence normalizeImportedObj does not recognise reads as "baja"', objProbe.confFallback, JSON.stringify(objProbe));
ok('a timestamp that is not a number reads as 0', objProbe.atFallback, JSON.stringify(objProbe));
/* These five were deferred by plans/026 to whichever plan introduced
   TARGET_CONF_OPTIONS, because until then `conf` was a truthy lookup on a
   plain object literal and 'constructor' passed it. plans/021 landed the
   membership test and the kind/hold fields, so they are here. */
ok('a confianza inherited from Object.prototype is not a confianza', objProbe.confInherited, JSON.stringify(objProbe));
ok('a kind the rule can produce round-trips', objProbe.kindKept, JSON.stringify(objProbe));
ok('a kind it cannot is dropped, leaving the record looking pre-v3 rather than mislabelled',
   objProbe.kindDropped, JSON.stringify(objProbe));
ok('hold round-trips when it is exactly true', objProbe.holdKept, JSON.stringify(objProbe));
ok('...and a merely truthy hold is dropped rather than coerced', objProbe.holdDropped, JSON.stringify(objProbe));

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

/* "Enviar a otra sesión" used to move the log, the chips and the order but
   leave the objetivo record filed under the day the lift no longer trains,
   so the next session wrote a second record beside it (plans/025). */
const moveObjProbe = call(`
  (function () {
    const p = { obj: { B: {
      'w2-D': { E: { v: 3, conf: 'alta', sets: [{ w: 40 }] } },
      'w3-D': { E: { v: 3, conf: 'baja', sets: [{ w: 42 }] } },
      'w3-D2': { E: { v: 3, conf: 'media', sets: [{ w: 99 }] } },
    } } };
    moveExObj(p, 'B', 'D', 'D2', 'E');
    return {
      moved: p.obj.B['w2-D2'] && p.obj.B['w2-D2'].E ? p.obj.B['w2-D2'].E.conf : null,
      sourceGone: !p.obj.B['w2-D'] || p.obj.B['w2-D'].E === undefined,
      destinationKept: p.obj.B['w3-D2'].E.conf,
      sourceGoneWeek3: !p.obj.B['w3-D'] || p.obj.B['w3-D'].E === undefined,
    };
  })()
`);
ok('moveExObj files the objetivo record under the destination day and empties the source',
   moveObjProbe.moved === 'alta' && moveObjProbe.sourceGone, JSON.stringify(moveObjProbe));
ok('...and never overwrites a record the destination day already has',
   moveObjProbe.destinationKept === 'media' && moveObjProbe.sourceGoneWeek3, JSON.stringify(moveObjProbe));

/* `obj` is the second map keyed by exercise under the slot, and it was added
   after both sweeps were written: "borrar registro" used to leave the
   objetivo record standing over rows that no longer exist (plans/025). */
ok('purgeExLog drops the objetivo record with the rows and the chip', call(`
  (function () {
    const p = { log: { B: { 'w2-D': { E: [{ w: '40', r: '10', done: true }] } } },
                rir: { B: { 'w2-D': { E: '1' } } }, obj: { B: { 'w2-D': { E: { v: 3, sets: [] } } } } };
    purgeExLog(p, 'B', 'D', 'E');
    return !p.log.B['w2-D'] || p.log.B['w2-D'].E === undefined ? (p.obj.B['w2-D'] === undefined || p.obj.B['w2-D'].E === undefined) : false;
  })()
`) === true);

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
ok('convertedSetVolume converts that same week to kg instead — both weeks read as the 500 kg actually lifted',
   Math.abs(reviewUnitProbe.converted[0] - 500) < 1e-6 && Math.abs(reviewUnitProbe.converted[1] - 500) < 1e-6,
   JSON.stringify(reviewUnitProbe));
ok('convertedSetVolume reads a single lb-stamped set as the kilos it really moved',
   Math.abs(call(`(function(){ state.prefs.units = 'kg'; return convertedSetVolume({ w: '220.462262185', r: '5', done: true, u: 'lb' }); })()`) - 500) < 1e-6);

/* The chart is the third cross-session reader and the one that says "en kg"
   on its own axis, so it converts too (plans/011). Same fixture as above: a
   block whose second week was logged after a unit switch, at the identical
   real weight. Raw, it would draw a 2,2x step that never happened. */
const chartUnitProbe = call(`
  (function() {
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [exId]: [{ w: '100', r: '5', done: true }] };
    profile.log[blockId][slot(2, day.id)] = { [exId]: [{ w: '220.462262185', r: '5', done: true, u: 'lb' }] };
    state.prefs.units = 'kg';
    const points = collectHistory(profile, blockId, day.id, exId, 8, 'weight');
    const all = collectHistoryAll(profile, exId, 'weight');
    state.prefs.units = 'kg';
    const round = ps => ps.map(p => Math.round(p.weight * 100) / 100);
    return { block: round(points), all: round(all) };
  })()
`);
ok('collectHistory converts the lb-stamped week instead of stepping the line 2,2x',
   JSON.stringify(chartUnitProbe.block) === JSON.stringify([100, 100]), JSON.stringify(chartUnitProbe));
ok('"todos los bloques" converts too — it is the same line over a longer history',
   JSON.stringify(chartUnitProbe.all) === JSON.stringify([100, 100]), JSON.stringify(chartUnitProbe));

console.log('\n== the CSV is safe to open in a spreadsheet and says which unit each row is in (plans/011) ==');
ok('csvCell prefixes a leading = so a name out of an imported file cannot be a formula',
   call(`csvCell('=SUM(A1)')`) === "'=SUM(A1)", String(call(`csvCell('=SUM(A1)')`)));
ok('csvCell prefixes a leading - too, which opens a formula just as well',
   call(`csvCell('-5')`) === "'-5", String(call(`csvCell('-5')`)));
ok('csvCell leaves a logged number alone — none of them start with an operator',
   call(`csvCell('60')`) === '60', String(call(`csvCell('60')`)));
ok('csvCell still quotes a cell holding a separator',
   call(`csvCell('a;b')`) === '"a;b"', String(call(`csvCell('a;b')`)));

/* Header and row are written in two different places, so asserting the
   header alone would not catch the two drifting apart by a column. */
const csvProbe = call(`
  (function() {
    const prev = state;
    state = defaultState();
    migrate();
    const profile = state.profiles.hombre;
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [exId]: [{ w: '220.462262185', r: '5', done: true, u: 'lb' }] };
    setNoteText(profile, blockId, 1, day.id, '=dormí 5 h; lleno');
    setEnergy(profile, blockId, 1, day.id, 'baja');
    const csv = buildCsv();
    state = prev;
    state.prefs.units = 'kg';
    return csv;
  })()
`);
const csvLines = csvProbe.split('\r\n');
ok('the CSV header names the weight column and puts the unit beside it',
   csvLines[0].indexOf(',peso,unidad,') >= 0, csvLines[0]);
ok('a lb-stamped set exports the number as typed with its own unit next to it',
   csvLines.some(l => l.indexOf(',220.462262185,lb,') >= 0),
   csvLines.slice(1, 3).join(' | '));
ok('the CSV header ends with the session note and the energy chip',
   /,nota,energia$/.test(csvLines[0]), csvLines[0]);
ok('a session\'s note and energy repeat on its rows, formula-guarded and quoted',
   csvLines.some(l => /,"'=dormí 5 h; lleno",baja$/.test(l)), csvLines.slice(1, 3).join(' | '));
ok('and lastNote walks back to the most recent earlier note on the same day',
   JSON.stringify(call(`
     (function() {
       const pr = state.profiles.hombre;
       const blockId = pr.blockOrder[0];
       const day = pr.blocks[blockId].days[0];
       setNoteText(pr, blockId, 2, day.id, 'semana dos');
       setNoteText(pr, blockId, 4, day.id, 'semana cuatro');
       return [lastNote(pr, blockId, day.id, 5), lastNote(pr, blockId, day.id, 3), lastNote(pr, blockId, day.id, 1)];
     })()
   `)) === JSON.stringify([{ week: 4, text: 'semana cuatro' }, { week: 2, text: 'semana dos' }, null]));

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
    const a = day.ex[0].id, b = day.ex[1].id, c = day.ex[2].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [a]: [{ done: true, w: '60', r: '8' },
                                                    { done: true, w: '50', r: '20' }],   /* > EST_MAX_REPS: must not win (50×20 would price 83) */
                                              [b]: [{ done: true, w: '30', r: '8' }],
                                              [c]: [{ done: true, w: '30', r: '20' }] }; /* only a high-rep set: weight yes, estimate no */
    profile.log[blockId][slot(2, day.id)] = { [a]: [{ done: true, w: '80', r: '8' },
                                                    { done: false, w: '200', r: '8' },
                                                    { done: true, w: 'x', r: '8' }] };
    const here = slot(2, day.id);
    const all = bestByExercise(profile, blockId, here);
    const one = bestForExercise(profile, a, blockId, here);
    const noSkip = bestForExercise(profile, a, blockId, 'w9-dz');
    return {
      agreesWithSkip: one[a].w === all[a].w && one[a].e === all[a].e,
      skipped: one[a].w,
      skippedE: one[a].e,
      unskipped: noSkip[a].w,
      unskippedE: noSkip[a].e,
      highRepOnly: all[c] && { w: all[c].w, e: all[c].e },
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
ok('the same walk carries the best estimated 1RM, Epley over the set with reps — and a 20-rep set cannot win it',
   Math.abs(bestResult.skippedE - 60 * (1 + 8 / 30)) < 1e-9, 'got ' + bestResult.skippedE);
ok('an exercise logged only past EST_MAX_REPS has a best weight and no estimate',
   bestResult.highRepOnly && bestResult.highRepOnly.w === 30 && bestResult.highRepOnly.e === null,
   JSON.stringify(bestResult.highRepOnly));
ok('and the estimate follows the drawn session in when it is not skipped',
   Math.abs(bestResult.unskippedE - 80 * (1 + 8 / 30)) < 1e-9, 'got ' + bestResult.unskippedE);

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

console.log('\n== the PR gate recognises gh pr create wherever it hides (plans/029) ==');
{
  const gate = fs.readFileSync(path.join(ROOT, 'tools/smoke-gate.sh'), 'utf8');
  // Anchored on the literal and the string it is tested against, not on the
  // statement around it: what matters is that this regex still decides whether
  // a command opens a pull request. Pinning `if (…) return;` as well made the
  // whole section vanish the first time the surrounding function changed shape
  // (it grew a second return value when the gate learned to find the worktree),
  // and a section that stops running is worse than one that fails.
  const m = /(\/\(\^\|\[[^\]]*\]\|\\n\)\\s\*gh\\s\+pr\\s\+create\\b\/)\.test\(cmd\)/.exec(gate);
  ok('the gate still decides on the command with the plan\'s regex', !!m, gate.slice(0, 0));
  if (m) {
    const re = eval(m[1]);   // the literal, as JS
    const gated = ['gh pr create --title x', 'git push -u origin HEAD && gh pr create --fill', 'cd /repo; gh pr create',
                   'bash -c "gh pr create --title x"', "sh -c 'gh pr create'", 'eval "gh pr create"', 'echo hi\ngh pr create'];
    const passed = ['ghx pr create', 'gh prune', 'echo done'];
    gated.forEach(c => ok('gated: ' + JSON.stringify(c), re.test(c)));
    passed.forEach(c => ok('not gated: ' + JSON.stringify(c), !re.test(c)));
  }
}

console.log('\n== docs cross-links resolve (README.md, docs/guide.md, AGENTS.md, plans/README.md) ==');
{
  // GitHub's own slugger drops punctuation character by character rather than
  // collapsing what is left, so "Data & privacy" loses only the "&" and keeps
  // both spaces around where it was — "data--privacy", not "data-privacy".
  // A `\s+` here would collapse that back down to one hyphen and fail a link
  // that resolves on GitHub today.
  const slug = h => h.toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
  const headings = file => (fs.readFileSync(path.join(ROOT, file), 'utf8').match(/^#{1,6} .+$/gm) || [])
    .map(h => slug(h.replace(/^#+ /, '')));
  const docs = ['README.md', 'docs/guide.md', 'AGENTS.md', 'plans/README.md'];
  docs.forEach(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const links = [...src.matchAll(/\]\(([^)\s]+)\)/g)].map(x => x[1]).filter(l => !/^(https?:|mailto:)/.test(l));
    links.forEach(link => {
      const [rel, anchor] = link.split('#');
      const target = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
      const exists = fs.existsSync(path.join(ROOT, target));
      ok(file + ' → ' + link + ' exists', exists);
      if (exists && anchor && /\.md$/.test(target)) ok(file + ' → #' + anchor + ' is a heading', headings(target).includes(anchor), headings(target).join(' | '));
    });
  });
}

/* blocks/index.json is what "Importar JSON" offers, and the only thing that
   checked it was a person noticing the list was short. A file dropped into
   blocks/ without an entry is invisible; an entry pointing at a missing or
   invalid file is a dead row in the sheet. The round-trip is the sharper
   half: a published block that normalizeImportedBlock rewrites is one a
   user cannot import back to what the file says. */
console.log('\n== blocks/index.json is a contract: every entry exists, validates, and round-trips ==');
const blockIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks/index.json'), 'utf8'));
ok('index.json is a non-empty array', Array.isArray(blockIndex) && blockIndex.length > 0);
const blockDir = fs.readdirSync(path.join(ROOT, 'blocks')).filter(f => f.endsWith('.json') && f !== 'index.json');
ok('every .json in blocks/ (except index.json) is listed in index.json',
   blockDir.every(f => blockIndex.some(e => e.file === f)),
   JSON.stringify(blockDir.filter(f => !blockIndex.some(e => e.file === f))));
blockIndex.forEach(entry => {
  /* js/block-editor.js:369-373 is the importer's filename guard; an entry it
     would reject is a row nobody can click. */
  ok(entry.file + ': filename is one the importer accepts',
     /^[A-Za-z0-9._-]+\.json$/.test(entry.file) && !entry.file.includes('..'));
  ok(entry.file + ': has a label', typeof entry.label === 'string' && entry.label.trim().length > 0);
  ok(entry.file + ': exists', fs.existsSync(path.join(ROOT, 'blocks', entry.file)));
  let raw = null, normalized = null, err = null;
  try { raw = readBlockFile(entry.file); normalized = call('normalizeImportedBlock(' + JSON.stringify(raw) + ')'); }
  catch (e) { err = e; }
  ok(entry.file + ': passes normalizeImportedBlock', !err, err && err.message);
  if (!normalized) return;
  ok(entry.file + ': normalizing changes no exercise name',
     JSON.stringify(normalized.days.map(d => d.ex.map(e => e.n)))
     === JSON.stringify(raw.days.map(d => d.ex.map(e => e.n))));
  /* Stated ids only. The two seed blocks spell out all 22; ejemplo-plantilla
     states none on purpose — it is the minimal-schema example, and deriving
     an id from the name is the importer doing its job, not drift. What would
     be drift is an id the file *does* state coming back different, so that
     is what this compares. The count is in the name so a reader can see the
     assertion is vacuous for the template rather than silently weak. */
  const allEx = raw.days.flatMap(d => d.ex);
  const statedIds = allEx.map(e => e.id).filter(id => id !== undefined);
  const keptIds = raw.days
    .flatMap((d, i) => d.ex.map((e, j) => (e.id === undefined ? undefined : normalized.days[i].ex[j].id)))
    .filter(id => id !== undefined);
  ok(entry.file + ': normalizing rewrites no exercise id the file states ('
       + statedIds.length + '/' + allEx.length + ' stated)',
     JSON.stringify(statedIds) === JSON.stringify(keptIds));
});

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

console.log('\n== flushPending lands the debounce and leaves a two-tab conflict alone (plans/024) ==');
{
  const savedFrozen = call('frozen'), savedReady = call('ready');
  call('frozen = false; ready = true; held = false; __writes = 0;');
  const origSetItem = call('localStorage.setItem');
  app.localStorage.setItem = () => { call('__writes++;'); };

  call('save(); flushPending();');
  ok('a pending debounce is landed by flushPending', call('__writes') === 1 && call('saveT') === null, String(call('__writes')));

  call('__writes = 0; held = true; flushPending();');
  ok('with a conflict open and no timer, flushPending writes nothing and leaves held set',
     call('__writes') === 0 && call('held') === true);

  call('__writes = 0; held = true; flushSave();');
  ok('flushSave still forces through a conflict (the page-exit contract)',
     call('__writes') === 1 && call('held') === false);

  app.localStorage.setItem = origSetItem;
  call('held = false; frozen = ' + savedFrozen + '; ready = ' + savedReady + ';');
}

{
  const ptSrc = fs.readFileSync(path.join(ROOT, 'js/profile-transfer.js'), 'utf8');
  const qrSrc = fs.readFileSync(path.join(ROOT, 'js/qr-transfer.js'), 'utf8');
  ok('restoreFromText and loadProfileFromText both open with flushPending',
     (ptSrc.match(/flushPending\(\)/g) || []).length === 2);
  ok('applyQrPayload opens with flushPending', (qrSrc.match(/flushPending\(\)/g) || []).length === 1);
  ok('no import path calls the forcing flushSave before its rejection messages',
     !/async function loadProfileFromText[\s\S]{0,200}flushSave\(\)/.test(ptSrc) &&
     !/async function applyQrPayload[\s\S]{0,200}flushSave\(\)/.test(qrSrc));
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
   call('JSON.stringify(warmupRamp(15, 10, 0).map(r => r.weight))') === '[10]',
   String(call('JSON.stringify(warmupRamp(15, 10, 0))')));
ok('warmupRamp keeps three distinct steps when they are actually distinct',
   call('warmupRamp(100, 2.5, 0).length') === 3);
/* The label travels with the row, so the surviving row of a collapsed ramp
   is still the 40% step and not whatever the old positional labels array
   happened to hold at that index (plans/013). */
ok('the row that survives a collapse keeps its own label',
   call('warmupRamp(15, 10, 0)[0].pct') === '40%',
   String(call('JSON.stringify(warmupRamp(15, 10, 0))')));
ok('an uncollapsed ramp labels its three rows 40/60/80',
   call('JSON.stringify(warmupRamp(100, 2.5, 0).map(r => r.pct))') === '["40%","60%","80%"]',
   String(call('JSON.stringify(warmupRamp(100, 2.5, 0).map(r => r.pct))')));

console.log('\n== input boundary: unsafe tags, editor clamps, setup aliasing (plans/012) ==');
{
  /* A freeform tag is a plain-object key in three places downstream
     (byMuscle in diagnostics, totals on the volume sheet, muscleOf itself),
     and "__proto__" reads the inherited Object.prototype as "already
     there" — truthy, not an array — so the init is skipped and the next
     .push throws, after the sheet's host was already cleared: an empty
     Diagnóstico with no message. Typeable in the editor's Músculo box, so
     this is not only an import problem. */
  call('state = defaultState(); migrate();');
  call('__p012 = state.profiles.hombre; __b012 = __p012.blocks[__p012.activeBlock];');
  call('__b012.days[0].ex[0].muscle = "__proto__";');
  call('__p012.log[__b012.id] = { [slot(1, __b012.days[0].id)]: '
     + '{ [__b012.days[0].ex[0].id]: [{ done: 1, w: 100, r: 5, u: "kg", ts: 1758000000000 }] } };');

  let strengthErr = null;
  try { call('strengthRows(__p012, __b012)'); } catch (e) { strengthErr = e.message; }
  ok('a "__proto__" muscle tag does not throw out of strengthRows', strengthErr === null, strengthErr);

  /* freqRows reaches the same buckets by a different road and only
     misfiles today; asserted so it stays that way. */
  let freqErr = null;
  try { call('freqRows(__p012, __b012, 1)'); } catch (e) { freqErr = e.message; }
  ok('a "__proto__" muscle tag does not throw out of freqRows', freqErr === null, freqErr);

  ok('muscleTag refuses an unsafe key and falls back to "Sin clasificar"',
     call('muscleTag({ muscle: "__proto__" })') === call('UNCLASSIFIED_LABEL'),
     JSON.stringify(call('muscleTag({ muscle: "__proto__" })')));
  ok('patternTag refuses an unsafe key in either of its two sources',
     call('patternTag({ pattern: "__proto__", type: "constructor" })') === call('UNCLASSIFIED_LABEL'),
     JSON.stringify(call('patternTag({ pattern: "__proto__", type: "constructor" })')));
  ok('typeTag refuses an unsafe key',
     call('typeTag({ type: "prototype" })') === call('UNCLASSIFIED_LABEL'),
     JSON.stringify(call('typeTag({ type: "prototype" })')));
  ok('cleanPriority drops an unsafe key and keeps the real muscle',
     call('JSON.stringify(cleanPriority(["__proto__", "Pecho"]))') === '["Pecho"]',
     call('JSON.stringify(cleanPriority(["__proto__", "Pecho"]))'));

  /* Stored data is cleaned too, on both routes in: an empty result already
     means "absent" on each of these sites. */
  ok('migrate() drops an unsafe muscle tag rather than storing it',
     call('state = defaultState(); state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle = "__proto__";'
        + ' migrate(); state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle') === undefined,
     JSON.stringify(call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle')));
  const unsafeTagBlock = {
    name: 'T', weeks: 8, deload: 8,
    days: [{ name: 'D', ex: [{ n: 'E', sets: 3, reps: '10-15', muscle: '__proto__', pattern: 'constructor', type: 'prototype' }] }],
  };
  ok('normalizeImportedBlock strips unsafe muscle/pattern/type instead of storing them',
     call('JSON.stringify(normalizeImportedBlock(' + JSON.stringify(unsafeTagBlock)
        + ').days[0].ex[0]).indexOf("__proto__")') < 0
     && call('normalizeImportedBlock(' + JSON.stringify(unsafeTagBlock) + ').days[0].ex[0].pattern') === undefined
     && call('normalizeImportedBlock(' + JSON.stringify(unsafeTagBlock) + ').days[0].ex[0].type') === undefined,
     call('JSON.stringify(normalizeImportedBlock(' + JSON.stringify(unsafeTagBlock) + ').days[0].ex[0])'));
}

{
  /* migrate() clamps these on the *next* load, but the session draws from
     the draft as saved: 5000 in Series is 5000 set rows built on the spot,
     a same-device hang until a forced reload. syncDraftFromForm is the
     save gate both "Guardar cambios" and the export button go through.
     (The inert DOM stub returns '' for every field, so the draft's weeks
     comes back as 1 here — the `add` bound is still the block's own.) */
  call('state = defaultState(); migrate();');
  call('peDraftBlock = JSON.parse(JSON.stringify(state.profiles.hombre.blocks["block-1"]));');
  call('peDraftBlock.days[0].ex[0].sets = 5000;');
  call('peDraftBlock.days[0].ex[0].rest = 99999;');
  call('peDraftBlock.days[0].ex[0].add = 40;');
  ok('syncDraftFromForm accepts the draft', call('syncDraftFromForm()') === null,
     String(call('syncDraftFromForm()')));
  ok('...and clamps sets to the same 12 migrate() uses',
     call('peDraftBlock.days[0].ex[0].sets') === 12,
     String(call('peDraftBlock.days[0].ex[0].sets')));
  ok('...and clamps rest to the same 900 migrate() uses',
     call('peDraftBlock.days[0].ex[0].rest') === 900,
     String(call('peDraftBlock.days[0].ex[0].rest')));
  ok('...and clamps "+1 serie desde" to the weeks the block actually has',
     call('peDraftBlock.days[0].ex[0].add') <= call('peDraftBlock.weeks'),
     'add=' + call('peDraftBlock.days[0].ex[0].add') + ' weeks=' + call('peDraftBlock.weeks'));
  /* A cleared box has to stay cleared. clampInt('') is 0 raised to its low
     bound, so an `add` clamped from 1 would come back as week 1 and could
     never be removed again — clamped from 0 and deleted when falsy. */
  call('peDraftBlock.days[0].ex[0].add = 0; syncDraftFromForm();');
  ok('a zeroed "+1 serie desde" is removed, not clamped up to week 1',
     call('peDraftBlock.days[0].ex[0].add') === undefined,
     String(call('peDraftBlock.days[0].ex[0].add')));
  call('peDraftBlock = null;');
}

{
  /* The setup handler calls blockFromNormalized once per profile with the
     same normalized object, so a by-reference `days` made an inline
     machine-setting edit on one person's card write into the other's plan
     until the next reload broke the aliasing. */
  const ejemplo = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks/ejemplo-plantilla.json'), 'utf8'));
  call('__n012 = normalizeImportedBlock(' + JSON.stringify(ejemplo) + ');');
  call('__a012 = blockFromNormalized(__n012); __c012 = blockFromNormalized(__n012);');
  ok('two blocks from one normalized import do not share days',
     call('__a012.days !== __c012.days'));
  ok('...nor phase', call('__a012.phase !== __c012.phase'));
  call('__a012.days[0].ex[0].setup = "x";');
  ok('...so an inline edit on one profile leaves the other untouched',
     call('__c012.days[0].ex[0].setup') !== 'x',
     JSON.stringify(call('__c012.days[0].ex[0].setup')));
}

console.log('\n== safeKey refuses every inherited Object.prototype name, not three of them ==');
{
  /* The deny-list was `__proto__`/`constructor`/`prototype`, which left
     nine names that break identically: anything on Object.prototype reads
     back truthy off a fresh {}, so `if (!m[k]) m[k] = []` skips the init
     and the .push that follows throws. plans/012 routed the freeform tags
     through safeKey but left safeKey itself alone, so a Músculo of
     "toString" still blanked Diagnóstico after its host was cleared — the
     same symptom, one name over. Derived from the chain now, so the list
     cannot fall behind the language. */
  const inherited = Object.getOwnPropertyNames(Object.prototype);
  const kept = inherited.filter(n => call('safeKey(' + JSON.stringify(n) + ')') !== '');
  ok('safeKey blocks every own name of Object.prototype', kept.length === 0, JSON.stringify(kept));
  ok('...which is more than the three it used to name',
     inherited.length > 3 && inherited.indexOf('toString') >= 0, String(inherited.length));
  /* `'prototype' in {}` is false — it belongs to functions, not to
     Object.prototype — so the chain test alone would quietly stop blocking
     a name the callers were written against. It stays enumerated. */
  ok('safeKey still blocks prototype, which the chain test cannot see',
     call("safeKey('prototype')") === '' && call("('prototype' in {})") === false);
  ok('safeKey leaves an ordinary tag alone', call("safeKey('Pecho')") === 'Pecho');
  ok('safeKey leaves an ordinary id alone', call("safeKey('squat')") === 'squat');
  /* The contract every caller reads: '' means absent, and anything else is
     handed back unchanged so the caller's own `||` fallback still fires. */
  ok('safeKey hands a missing id straight back, as before',
     call('safeKey(undefined)') === undefined && call('safeKey("")') === '');

  /* The reported crash, one name over from the one plans/012 fixed. */
  call('state = defaultState(); migrate();');
  call('__pSK = state.profiles.hombre; __bSK = __pSK.blocks[__pSK.activeBlock];');
  call('__bSK.days[0].ex[0].muscle = "toString";');
  call('__pSK.log[__bSK.id] = { [slot(1, __bSK.days[0].id)]: '
     + '{ [__bSK.days[0].ex[0].id]: [{ done: 1, w: 100, r: 5, u: "kg", ts: 1758000000000 }] } };');
  let skErr = null;
  try { call('strengthRows(__pSK, __bSK)'); } catch (e) { skErr = e.message; }
  ok('a "toString" muscle tag does not throw out of strengthRows', skErr === null, skErr);
  let skFreqErr = null;
  try { call('freqRows(__pSK, __bSK, 1)'); } catch (e) { skFreqErr = e.message; }
  ok('a "toString" muscle tag does not throw out of freqRows', skFreqErr === null, skFreqErr);
  ok('...and the tag falls back to "Sin clasificar" rather than being kept',
     call('muscleTag({ muscle: "valueOf" })') === call('UNCLASSIFIED_LABEL'),
     JSON.stringify(call('muscleTag({ muscle: "valueOf" })')));
  ok('cleanPriority drops an inherited name and keeps the real muscle',
     call('JSON.stringify(cleanPriority(["hasOwnProperty", "Pecho"]))') === '["Pecho"]',
     call('JSON.stringify(cleanPriority(["hasOwnProperty", "Pecho"]))'));
  ok('migrate() drops a "toString" muscle tag rather than storing it',
     call('state = defaultState(); state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle = "toString";'
        + ' migrate(); state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle') === undefined,
     JSON.stringify(call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].muscle')));

  /* Ids go through the same helper (migrate(), normalizeImportedBlock), so
     the widening has to hold there too: an id kept as "toString" is a log
     key that reads back as a function. */
  const inheritedIdBlock = {
    name: 'T', weeks: 8, deload: 8,
    days: [{ id: 'valueOf', name: 'D', ex: [{ id: 'toString', n: 'E', sets: 3, reps: '10-15' }] }],
  };
  const normalizedIds = JSON.parse(call('JSON.stringify(normalizeImportedBlock('
    + JSON.stringify(inheritedIdBlock) + '))'));
  ok('normalizeImportedBlock refuses a day id of "valueOf"',
     normalizedIds.days[0].id !== 'valueOf', normalizedIds.days[0].id);
  ok('normalizeImportedBlock refuses an exercise id of "toString"',
     normalizedIds.days[0].ex[0].id !== 'toString', normalizedIds.days[0].ex[0].id);
  ok('...and gives each a usable generated id instead',
     !!normalizedIds.days[0].id && !!normalizedIds.days[0].ex[0].id,
     JSON.stringify([normalizedIds.days[0].id, normalizedIds.days[0].ex[0].id]));

  /* The same two ids on the other road in — already-stored data, repaired
     on load rather than validated on import. An empty safeKey() falls into
     the existing "no id or a duplicate" branch, so the day gets 'd<i>' and
     the exercise a slug of its name; neither keeps the inherited name. */
  call('state = defaultState();'
     + ' state.profiles.hombre.blocks["block-1"].days[0].id = "toString";'
     + ' state.profiles.hombre.blocks["block-1"].days[0].ex[0].id = "valueOf";'
     + ' migrate();');
  ok('migrate() refuses a stored day id of "toString"',
     call('state.profiles.hombre.blocks["block-1"].days[0].id') !== 'toString',
     String(call('state.profiles.hombre.blocks["block-1"].days[0].id')));
  ok('migrate() refuses a stored exercise id of "valueOf"',
     call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].id') !== 'valueOf',
     String(call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].id')));
  ok('...and both come back with a usable id rather than an empty one',
     !!call('state.profiles.hombre.blocks["block-1"].days[0].id')
     && !!call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].id'),
     JSON.stringify([call('state.profiles.hombre.blocks["block-1"].days[0].id'),
                     call('state.profiles.hombre.blocks["block-1"].days[0].ex[0].id')]));
  call('__pSK = null; __bSK = null;');
}

console.log('\n== the dialogs tell the truth about undo (plans/013) ==');
{
  /* Five confirm dialogs said "No se puede deshacer." and then took an undo
     snapshot, so the people most likely to want the toast were the ones
     told not to look for it. The one that still says it deletes a retired
     exercise's log, which really has no snapshot behind it — so the count
     is the assertion, not the absence. */
  ok('UNDO_PROMISE is the single wording the snapshot dialogs share',
     typeof call('UNDO_PROMISE') === 'string' && call('UNDO_PROMISE').length > 0,
     String(call('UNDO_PROMISE')));

  const claims = ['js/app.js', 'js/block-editor.js', 'js/profile-transfer.js', 'js/qr-transfer.js', 'js/review.js']
    /* The closing quote is part of the needle: it finds the claim where it
       ends a string a dialog shows, and not where a comment quotes it. */
    .map(rel => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').split("No se puede deshacer.'").length - 1])
    .filter(([, n]) => n > 0);
  ok('exactly one dialog still claims there is no undo, and it is the one without a snapshot',
     claims.length === 1 && claims[0][0] === 'js/block-editor.js' && claims[0][1] === 1,
     JSON.stringify(claims));
}

console.log('\n== Escape reaches every sheet (plans/013, plans/009 item 1) ==');
{
  /* reviewSheet and diagSheet were in the markup and opened by openSheet()
     but missing from the hand-kept SHEET_IDS array, so Escape did nothing on
     them — the gap the accessibility work was recorded as having closed.
     There is no array to forget any more: each sheet registers itself from
     its own wire*(), and this checks the registry that registration builds
     against index.html, in both directions. */
  const registered = call('Object.keys(sheets)');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const markup = Array.from(html.matchAll(/<div class="sheet" id="(\w+)"/g), m => m[1]);

  ok('the index.html scan found the sheets it is meant to check', markup.length >= 10, String(markup.length));
  /* askSheet is the confirm dialog's own; the Escape handler answers for it
     before it ever looks at the stack. */
  const missing = markup.filter(id => id !== 'askSheet' && registered.indexOf(id) === -1);
  ok('every sheet in index.html except askSheet calls registerSheet()', missing.length === 0, missing.join(', '));
  const stray = registered.filter(id => markup.indexOf(id) === -1);
  ok('and registerSheet() names no sheet that is not in the markup', stray.length === 0, stray.join(', '));

  /* Which sheet Escape closes used to depend on the order of SHEET_IDS —
     a hand-kept guess at which sheet can open over which. The stack knows
     the real order, and it has to survive an out-of-order close: the outer
     sheet can be closed first while the inner one is still up. */
  const nest = call(`(function () {
    const base = sheetStack.length;
    openSheet('blocksSheet'); openSheet('reviewSheet');
    const top = sheetStack[sheetStack.length - 1].id;
    closeSheet('blocksSheet');
    const left = sheetStack.slice(base).map(s => s.id).join(',');
    closeSheet('reviewSheet');
    return top + '|' + left + '|' + (sheetStack.length - base);
  })()`);
  ok('the stack closes the sheet opened last, and an out-of-order close takes only its own entry',
     nest === 'reviewSheet|reviewSheet|0', nest);

  /* The point of the registry, beyond the list: a teardown that is not a
     bare closeSheet reaches Escape without app.js naming the split file's
     function. Losing closeReview would strand "+ Nuevo bloque", which waits
     on the resume callback it runs. */
  ok('the sheets with teardown carry it on their registration',
     ['planSheet', 'setupSheet', 'qrSheet', 'reviewSheet']
       .every(id => call(`typeof sheets['${id}'].onClose`) === 'function'),
     JSON.stringify(registered.map(id => id + ':' + call(`typeof sheets['${id}'].onClose`))));
  /* AGENTS.md rule (a): a symbol app.js reads stays in app.js or is stubbed
     there. plans/013 added `else if (top === 'reviewSheet') closeReview()`,
     which read js/review.js with no stub — a precache hole away from the
     stuck-loading screen. Registration is what removed the read. */
  /* Block comments stripped first: both names are still discussed there,
     and what must be gone is a reference the engine would evaluate. */
  const appCode = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('app.js reads neither closeReview nor closeQr any more (AGENTS.md rule (a))',
     !/\bcloseReview\b/.test(appCode) && !/\bcloseQr\b/.test(appCode));
}

console.log('\n== the log key has one reader as well as one builder (plans/009 item 4) ==');
{
  ok('parseSlot is the mirror of slot()', (() => {
    const k = call(`slot(3, 'd1')`);
    const s = call(`parseSlot('${k}')`);
    return k === 'w3-d1' && s.week === 3 && s.dayId === 'd1';
  })());
  /* Day ids are uid()-shaped and carry hyphens of their own, so the dayId
     half has to be greedy to the end of the key, not up to the next dash. */
  ok('a day id with hyphens in it survives the round trip',
     call(`parseSlot(slot(12, 'day-abc-1')).dayId`) === 'day-abc-1');
  ok('a key that is not a slot reads as null, rather than as week NaN',
     call(`parseSlot('notes')`) === null && call(`parseSlot('w-d1')`) === null);

  /* The filter is what the purge walks use, and the w17 entry is the whole
     point: the 1..MAX_WEEKS sweeps could not see it. */
  const visited = call(`(function () {
    const map = { b1: { 'w1-d1': 1, 'w2-d1': 2, 'w2-d2': 3, 'w17-d1': 4, notes: 5 } };
    const out = [];
    forEachSlot(map, 'b1', (k, w, d, v) => out.push(k + '=' + v), { dayId: 'd1' });
    return out.sort().join(' ');
  })()`);
  ok('forEachSlot visits every week the day actually has, including one past MAX_WEEKS',
     visited === 'w1-d1=1 w17-d1=4 w2-d1=2', visited);

  const oneWeek = call(`(function () {
    const map = { b1: { 'w1-d1': 1, 'w2-d1': 2, 'w2-d2': 3 } };
    const out = [];
    forEachSlot(map, 'b1', k => out.push(k), { dayId: 'd1', week: 2 });
    return out.join(' ');
  })()`);
  ok('...and narrows to one week when asked', oneWeek === 'w2-d1', oneWeek);

  /* purgeSessionMeta's onlyWeek is optional, and the sweep this replaced read
     it with a plain truthiness check. A null that narrowed to nothing would
     purge nothing, silently. */
  const nullWeek = call(`(function () {
    const map = { b1: { 'w1-d1': 1, 'w2-d1': 2, 'w2-d2': 3 } };
    const out = [];
    forEachSlot(map, 'b1', k => out.push(k), { dayId: 'd1', week: null });
    return out.sort().join(' ');
  })()`);
  ok('a null week means every week, as the walk it replaced did', nullWeek === 'w1-d1 w2-d1', nullWeek);

  ok('a block with no entries is not an error', call(`(function () {
    let n = 0;
    forEachSlot({}, 'nope', () => n++);
    forEachSlot(undefined, 'b1', () => n++);
    return n;
  })()`) === 0);

  /* The whole point of the pair is that the shape is written down once. A
     reader that goes back to running the regex by hand is the drift this
     catches — there were eleven of them across four files. Comments are
     stripped first, because they still quote the regex to explain it. */
  const handRolled = ['js/app.js', 'js/chart.js', 'js/diagnostics.js', 'js/review.js']
    .map(rel => [rel, (fs.readFileSync(path.join(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').match(/\/\^w\(/g) || []).length])
    .filter(([rel, n]) => n > (rel === 'js/app.js' ? 1 : 0));
  ok('parseSlot() is the only place that runs the slot regex',
     handRolled.length === 0, JSON.stringify(handRolled));

  /* Object.keys() is a snapshot, which is what lets every purge below delete
     the key it was just handed. */
  ok('fn may delete the key it is given', call(`(function () {
    const blk = { 'w1-d1': 1, 'w2-d1': 2 };
    forEachSlot({ b1: blk }, 'b1', k => delete blk[k], { dayId: 'd1' });
    return Object.keys(blk).length;
  })()`) === 0);
}

console.log('\n== commit() is both halves, and installBlockData refuses a bad id (plans/009 item 5) ==');
{
  /* A blanket rename of the fifteen `save(); render();` sites rewrote this
     function's own body into `function commit() { commit(); }` — infinite
     recursion the suite could not see, because nothing here called it.
     Now something does. */
  const halves = call(`(function () {
    const realSave = save, realRender = render;
    let saved = 0, drawn = 0;
    try {
      globalThis.save = function () { saved++; };
      globalThis.render = function () { drawn++; };
      commit();
    } finally { globalThis.save = realSave; globalThis.render = realRender; }
    return saved + ',' + drawn;
  })()`);
  ok('commit() persists and redraws, once each', halves === '1,1', halves);

  /* The log row comes out carrying the RIR the map brought with it: a block
     that arrives from a phone on an older shell sends the legacy map beside
     the log (blockShareRir), and installBlockData folds it onto the rows the
     same way a load does. The map itself is left where it is. */
  const installed = call(`(function () {
    const p = { log: {}, rir: {}, order: {} };
    const done = installBlockData(p, 'b1', { log: { 'w1-d1': { e1: [{ w: 1 }] } }, rir: { 'w1-d1': { e1: 2 } } });
    return [done, JSON.stringify(p.log.b1), JSON.stringify(p.rir.b1), JSON.stringify(p.order)].join('|');
  })()`);
  ok('installBlockData files the maps it was given, folds the RIR onto the rows, and leaves the rest alone',
     installed === 'true|{"w1-d1":{"e1":[{"w":1,"rir":"2"}]}}|{"w1-d1":{"e1":2}}|{}', installed);

  /* plans/008 item 2's class of key: a block id is a key on five maps, and a
     hand-edited file can carry a name Object.prototype already answers for. */
  const proto = call(`(function () {
    const done = installBlockData({ log: {}, rir: {} }, '__proto__', { log: { 'w1-d1': {} } });
    return done + '|' + ({}).hasOwnProperty('w1-d1');
  })()`);
  ok('installBlockData refuses __proto__ as a block id, and writes nothing at all',
     proto === 'false|false', proto);
}

console.log('\n== "borrar registro" reaches a week past the cap (plans/009 item 4) ==');
{
  /* A block shortened, or a backup hand-edited, can hold a week above
     MAX_WEEKS. The old sweeps rebuilt keys w1..w16 and looked each one up,
     so anything filed above the cap was silently left behind — a deleted
     day's rows came back if the block was ever lengthened again. */
  const left = call(`(function () {
    const p = { log: { b1: { 'w1-d1': { e1: [{}] }, 'w17-d1': { e1: [{}] }, 'w3-d2': { e1: [{}] } } },
                rir: { b1: { 'w17-d1': { e1: 2 } } },
                notes: { b1: { 'w17-d1': 'x' } },
                energy: { b1: {} }, order: { b1: { 'w17-d1': ['e1'] } } };
    purgeDayLog(p, 'b1', 'd1');
    return [Object.keys(p.log.b1).join(','), Object.keys(p.rir.b1).length,
            Object.keys(p.notes.b1).length, Object.keys(p.order.b1).length].join('|');
  })()`);
  ok('purgeDayLog takes the w17 rows, the chips, the note and the order with it, and leaves the other day alone',
     left === 'w3-d2|0|0|0', left);

  const ex = call(`(function () {
    const p = { log: { b1: { 'w17-d1': { e1: [{}], e2: [{}] } } },
                rir: { b1: { 'w17-d1': { e1: 2, e2: 3 } } } };
    purgeExLog(p, 'b1', 'd1', 'e1');
    return Object.keys(p.log.b1['w17-d1']).join(',') + '|' + Object.keys(p.rir.b1['w17-d1']).join(',');
  })()`);
  ok('purgeExLog reaches the same week, and takes only its own exercise', ex === 'e2|e2', ex);

  const moved = call(`(function () {
    const p = { log: { b1: { 'w17-d1': { e1: [{ w: 1 }] } } } };
    moveExLog(p, 'b1', 'd1', 'd2', 'e1');
    return JSON.stringify(p.log.b1);
  })()`);
  ok('moveExLog carries a week past the cap across to the other day',
     moved === '{"w17-d2":{"e1":[{"w":1}]}}', moved);

  /* moveExOrder's two halves are independent: the destination day can have a
     recorded order in a week the source day has no entry for at all, and the
     exercise still has to join it. Walking only the source's weeks would
     miss that, which is why it walks the weeks either day has. */
  const order = call(`(function () {
    const p = { order: { b1: { 'w1-d1': ['e1', 'e2'], 'w1-d2': ['e9'], 'w17-d2': ['e9'] } } };
    moveExOrder(p, 'b1', 'd1', 'd2', 'e1');
    return JSON.stringify(p.order.b1);
  })()`);
  ok('moveExOrder drops the id from the source order and appends it to the destination, in every week either has',
     order === '{"w1-d1":["e2"],"w1-d2":["e9","e1"],"w17-d2":["e9","e1"]}', order);
}

console.log('\n== sessionsOf: the one reading of the log (plans/038) ==');
{
  /* The fixture builder: sessions in, a profile out, so these cases say
     what was lifted instead of spelling the storage shape. A block is
     { id, weeks, deload, phase, days: [{ id, ex: [{ id, n, sets }] }] };
     a session is { block, week, day, lift, sets, rir } where each set is
     [w, r] (ticked), [w, r, { …row fields }] or a raw row object, and
     `rir` is the legacy one-chip value, filed in the old map. Defined in
     the app's own scope so every case below can call it. */
  call(`
    function sessionFixture(spec) {
      state = defaultState(); migrate();
      state.prefs.units = spec.units || 'kg';
      const p = { blocks: {}, blockOrder: [], log: {}, rir: {}, obj: {}, variants: {} };
      (spec.blocks || []).forEach(b => {
        p.blocks[b.id] = { id: b.id, name: b.name || b.id, weeks: b.weeks || 8, deload: b.deload || 0,
                           phase: b.phase || {}, priority: [],
                           days: (b.days || []).map(d => ({ id: d.id, name: d.id,
                             ex: (d.ex || []).map(e => ({ id: e.id, n: e.n || e.id, sets: e.sets || 3, reps: e.reps || '8-12' })) })) };
        p.blockOrder.push(b.id);
      });
      (spec.sessions || []).forEach(s => {
        const k = slot(s.week, s.day);
        const blk = p.log[s.block] = p.log[s.block] || {};
        const bucket = blk[k] = blk[k] || {};
        bucket[s.lift] = s.sets.map(x => Array.isArray(x)
          ? Object.assign({ w: String(x[0]), r: String(x[1]), done: true }, x[2] || {})
          : x);
        if (s.rir != null) {
          const rb = p.rir[s.block] = p.rir[s.block] || {};
          (rb[k] = rb[k] || {})[s.lift] = s.rir;
        }
      });
      return p;
    }
  `);
  /* The plan every case below shares unless it says otherwise: two blocks,
     two days each, a press on both days of A (so day position matters)
     and the same press under a different id, by name, in B. */
  const PLAN = `[
    { id: 'A', weeks: 4, days: [
      { id: 'd1', ex: [{ id: 'sq', n: 'Sentadilla' }, { id: 'bp', n: 'Press banca' }] },
      { id: 'd2', ex: [{ id: 'bp', n: 'Press banca' }] } ] },
    { id: 'B', weeks: 4, days: [
      { id: 'x1', ex: [{ id: 'bp2', n: 'Press banca' }] } ] },
  ]`;
  const q = (sessions, query, extra) => JSON.parse(call(`(function () {
    const p = sessionFixture(Object.assign({ blocks: ${PLAN}, sessions: ${sessions} }, ${extra || '{}'}));
    return JSON.stringify(sessionsOf(p, ${query}));
  })()`));
  const where = list => list.map(s => s.block + s.week + s.day + ':' + s.lift).join(' ');

  ok('a query that does not say which weeks it means is refused, not defaulted',
     throws(`sessionsOf(sessionFixture({ blocks: ${PLAN} }), { lift: { id: 'bp' } })`));

  const byId = q(`[
    { block: 'B', week: 1, day: 'x1', lift: 'bp2', sets: [[60, 8]] },
    { block: 'A', week: 2, day: 'd2', lift: 'bp', sets: [[57.5, 8]] },
    { block: 'A', week: 2, day: 'd1', lift: 'bp', sets: [[57.5, 10]] },
    { block: 'A', week: 1, day: 'd2', lift: 'bp', sets: [[55, 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  ok('by id: every session of that id, oldest first — week, then the day\'s place in the block — and nothing under another id',
     where(byId) === 'A1d2:bp A2d1:bp A2d2:bp', where(byId));

  const like = q(`[
    { block: 'B', week: 1, day: 'x1', lift: 'bp2', sets: [[60, 8]] },
    { block: 'A', week: 1, day: 'd1', lift: 'sq', sets: [[100, 5]] },
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8]] },
  ]`, `{ weeks: 'plan', lift: { like: { id: 'bp', n: 'Press banca' } } }`);
  ok('by likeness: the same lift under another id in a later block, in block order, and not the squat beside it',
     where(like) === 'A1d1:bp B1x1:bp2', where(like));

  const oneDay = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8]] },
    { block: 'A', week: 1, day: 'd2', lift: 'bp', sets: [[55, 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' }, day: 'd2' }`);
  ok('a day narrows it to that day', where(oneDay) === 'A1d2:bp', where(oneDay));

  const every = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8]] },
    { block: 'A', week: 1, day: 'd1', lift: 'gone', sets: [[20, 12]] },
    { block: 'A', week: 1, day: 'd1', lift: 'sq', sets: [[100, 5]] },
  ]`, `{ weeks: 'plan' }`);
  ok('no lift: every lift, in the day\'s plan order, a lift the plan no longer has last',
     where(every) === 'A1d1:sq A1d1:bp A1d1:gone', where(every));

  const untouched = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [{ w: '55', r: '8', done: false }] },
    { block: 'A', week: 2, day: 'd1', lift: 'bp', sets: [{ w: '55', r: '8', done: false }, [57.5, 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  ok('only ticked sets: a slot with none is no session, and an unticked set is left out of one that has',
     where(untouched) === 'A2d1:bp' && untouched[0].sets.length === 1 && untouched[0].sets[0].wLogged === '57.5',
     JSON.stringify(untouched));

  const stranded = `[
    { block: 'A', week: 4, day: 'd1', lift: 'bp', sets: [[55, 8]] },
    { block: 'A', week: 6, day: 'd1', lift: 'bp', sets: [[60, 8]] },
  ]`;
  const plan = q(stranded, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  const logged = q(stranded, `{ weeks: 'logged', lift: { id: 'bp' } }`);
  ok("weeks: 'plan' hides a stranded week, 'logged' counts it",
     where(plan) === 'A4d1:bp' && where(logged) === 'A4d1:bp A6d1:bp', where(plan) + ' / ' + where(logged));

  const deloads = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, deload: 4,
                                          phase: { 3: { r: 'Descarga', t: '' } },
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [1, 2, 3, 4].map(w => ({ block: 'A', week: w, day: 'd1', lift: 'bp', sets: [[50, 8]] })) });
    return JSON.stringify([sessionsOf(p, { weeks: 'plan', lift: { id: 'bp' }, skipDeload: true }),
                           sessionsOf(p, { weeks: 'plan', lift: { id: 'bp' } })]);
  })()`));
  ok('skipDeload leaves out the deload week and a week the phase text calls "Descarga"; without it both stay',
     deloads[0].map(s => s.week).join(',') === '1,2' && deloads[1].length === 4,
     JSON.stringify(deloads.map(l => l.map(s => s.week))));

  const before = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8]] },
    { block: 'A', week: 2, day: 'd1', lift: 'bp', sets: [[57.5, 8]] },
    { block: 'A', week: 3, day: 'd1', lift: 'bp', sets: [[60, 8]] },
    { block: 'B', week: 1, day: 'x1', lift: 'bp2', sets: [[60, 8]] },
  ]`, `{ weeks: 'logged', lift: { like: { id: 'bp', n: 'Press banca' } }, before: { block: 'A', week: 3 } }`);
  ok('before: nothing at or after that week, and no later block',
     where(before) === 'A1d1:bp A2d1:bp', where(before));

  const chosen = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8]] },
    { block: 'B', week: 1, day: 'x1', lift: 'bp2', sets: [[60, 8]] },
  ]`, `{ weeks: 'plan', blocks: ['B'] }`);
  ok('blocks: only the blocks named', where(chosen) === 'B1x1:bp2', where(chosen));

  const units = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[100, 8, { u: 'lb' }], ['22,5', 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  const s0 = units[0].sets[0], s1 = units[0].sets[1];
  ok('a set logged in lb comes back converted in w, and exactly as typed in wLogged and unit',
     Math.round(s0.w * 100) / 100 === 45.36 && s0.wLogged === '100' && s0.unit === 'lb', JSON.stringify(s0));
  ok('...and a Spanish decimal comma is read as a decimal, not as the end of the number',
     s1.w === 22.5 && s1.wLogged === '22,5' && s1.unit === 'kg' && s1.r === 8, JSON.stringify(s1));

  const repsComma = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[80, '8,5']] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  const rc0 = repsComma[0].sets[0];
  ok('reps carry the same two-field shape as weight: a comma-decimal is a number in r and exactly as typed in rLogged',
     rc0.r === 8.5 && rc0.rLogged === '8,5', JSON.stringify(rc0));

  const worked = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8], [55, ''], ['', 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  ok('worked: ticked with a weight and a rep count, and nothing else is',
     worked[0].sets.map(s => s.worked).join(',') === 'true,false,false', JSON.stringify(worked[0].sets));
  /* Asked inside the app's scope: JSON carries NaN out of the VM as null,
     and null is exactly what an empty box must not read as — it is 0 to
     any arithmetic that forgets to check. */
  ok('...and an empty box reads as NaN, not as zero',
     call(`(function () {
       const p = sessionFixture({ blocks: ${PLAN}, sessions: [
         { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, ''], ['', 8]] }] });
       const s = sessionsOf(p, { weeks: 'plan', lift: { id: 'bp' } })[0].sets;
       return Number.isNaN(s[0].r) && Number.isNaN(s[1].w);
     })()`) === true);

  /* The reserve on a working set is the rule's reading, byte for byte:
     compare against the reading exSession had before the rule moved onto
     this reader (plans/038 PR 3) — sessionRirs over the working rows, the
     legacy chip as the fallback — spelled out here from the raw rows, so
     the comparison does not go through sessionsOf on both sides. Since
     plans/039 the fallback is the legacy map and only the map (legacyRir):
     a padding row's typed value is no longer read by the rule, so the
     reference side spells that out too. Over the cases that exercise
     inheritance, the legacy chip, and a padding row carrying a value typed
     before anything was ticked; ruleSession has to hand the rule the same
     numbers. */
  const rirCases = [
    `[[60, 8, { rir: '3' }], [60, 8, { rir: '2' }], [60, 8, { rir: '1' }], [60, 8, { rir: '0' }]]`,
    `[[60, 8], [60, 8, { rir: '2' }], [60, 8]]`,
    `[[60, 8], [60, 8], [60, 8]]`,
    `[[60, 8], [60, 8], { w: '', r: '', done: false, rir: '1' }]`,
    `[[60, 8], ['', 8, { rir: '4' }], [60, 8]]`,
  ];
  const legacies = [null, "'2+'", "'0'"];
  let rirSame = true, rirWhy = '';
  rirCases.forEach(sets => legacies.forEach(legacy => {
    const got = JSON.parse(call(`(function () {
      const p = sessionFixture({ blocks: ${PLAN}, sessions: [
        { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: ${sets}, rir: ${legacy} }] });
      const s = sessionsOf(p, { weeks: 'plan', lift: { id: 'bp' } })[0];
      const work = p.log.A[slot(1, 'd1')].bp.filter(r => r && r.done && rowWeight(r) > 0 && num(r.r) > 0);
      const rule = sessionRirs(work, rirNumber(legacyRir(p, 'A', 1, 'd1', 'bp')));
      const e = ruleSession(s, 8, 12);
      return JSON.stringify({ mine: s.sets.filter(x => x.worked).map(x => x.rir),
                              rule: rule, projected: e ? e.sets.map(x => x.rir) : [],
                              other: s.sets.filter(x => !x.worked).map(x => x.rir) });
    })()`));
    if (JSON.stringify(got.mine) !== JSON.stringify(got.rule) ||
        JSON.stringify(got.projected) !== JSON.stringify(got.rule)) { rirSame = false; rirWhy += sets + ' ' + legacy + ' → ' + JSON.stringify(got) + '; '; }
    if (sets.indexOf("['', 8, { rir: '4' }]") >= 0 && got.other[0] !== 4) { rirSame = false; rirWhy += 'non-working set lost its own rir; '; }
  }));
  ok('a working set\'s rir is exactly what exSession read — per set, inherited, the legacy chip as fallback — and a non-working set keeps its own',
     rirSame, rirWhy);

  /* The review counts what was written down, so it needs the record
     beside the reading: nothing inherited, no legacy chip. */
  const own = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[60, 8], [60, 8, { rir: '2' }], [60, 8]], rir: '0' },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  ok('rirOwn is only what was typed on the set, where rir is the inherited reading',
     own[0].sets.map(s => s.rirOwn).join(',') === ',2,' && own[0].sets.map(s => s.rir).join(',') === '2,2,',
     JSON.stringify(own[0].sets.map(s => [s.rir, s.rirOwn])));

  const extra = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8], [55, 8], [55, 8], [55, 8]] },
    { block: 'A', week: 1, day: 'd1', lift: 'gone', sets: [[20, 12], [20, 12], [20, 12], [20, 12]] },
  ]`, `{ weeks: 'plan' }`);
  ok('extra: a set past the plan\'s count is flagged, and a lift the plan no longer has has none',
     extra[0].sets.map(s => s.extra).join(',') === 'false,false,false,true' &&
       extra[1].sets.every(s => !s.extra), JSON.stringify(extra.map(s => s.sets.map(x => x.extra))));

  const extraDeload = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, deload: 4, days: [{ id: 'd1', ex: [{ id: 'bp', sets: 4 }] }] }],
      sessions: [{ block: 'A', week: 4, day: 'd1', lift: 'bp', sets: [[40, 8], [40, 8], [40, 8]] }] });
    return JSON.stringify(sessionsOf(p, { weeks: 'plan', lift: { id: 'bp' } })[0].sets.map(s => s.extra));
  })()`));
  ok('...counted against the week\'s own set count, which a deload halves',
     extraDeload.join(',') === 'false,false,true', JSON.stringify(extraDeload));

  const dated = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[55, 8, { ts: 1000 }], [55, 8, { ts: 2000 }], [55, 8, { ts: 900000 }], [55, 8]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  ok('the session date is the median of the ticked sets\' times — a set ticked days later does not move it — and each set keeps its own',
     dated[0].ts === 2000 && dated[0].sets.map(s => s.ts).join(',') === '1000,2000,900000,0', JSON.stringify(dated[0]));

  const drops = q(`[
    { block: 'A', week: 1, day: 'd1', lift: 'bp', sets: [[100, 8, { u: 'lb', dk: 'forced', d: [{ w: '80', r: '6' }, { w: '', r: '' }] }]] },
  ]`, `{ weeks: 'plan', lift: { id: 'bp' } }`);
  const d0 = drops[0].sets[0];
  ok('drops: the ones with something in them, converted like their set, with the kind',
     d0.drops.length === 1 && Math.round(d0.drops[0].w * 100) / 100 === 36.29 && d0.drops[0].wLogged === '80' &&
       d0.drops[0].r === 6 && d0.dropKind === 'forced', JSON.stringify(d0));

  ok('a block missing from the profile, or with nothing logged, is passed over rather than thrown on (sessionsOf)',
     call(`(function () {
       const p = sessionFixture({ blocks: ${PLAN} });
       return sessionsOf(p, { weeks: 'logged', blocks: ['A', 'nope'] }).length;
     })()`) === 0);
}

console.log('\n== the row codec: every field a set carries, sent, accepted and exported from one list (plans/038) ==');
{
  const fields = JSON.parse(call(`JSON.stringify(ROW_FIELDS.map(f => ({ key: f.key, col: f.col,
    fns: ['send', 'accept', 'cell'].every(n => typeof f[n] === 'function') })))`));
  const keys = fields.map(f => f.key);
  ok('every field says how it is sent, accepted and exported, and names its CSV column',
     fields.every(f => f.fns && typeof f.col === 'string' && f.col), JSON.stringify(fields));

  /* The guard the old "mirrored" comment could not be: every field the
     code writes onto a logged set — `r.x = …` or `delete r.x` — has to be
     one the codec knows, or it would be lost on the first share, restore
     or export. `r` is the name every writer in the repo gives a row (the
     DOM's rows are `row`). Comments stripped first: they discuss fields. */
  const written = new Set();
  fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).forEach(f => {
    const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/\br\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) written.add(m[1]);
    for (const m of code.matchAll(/\bdelete\s+r\.([A-Za-z_$][\w$]*)/g)) written.add(m[1]);
  });
  const unknown = [...written].filter(k => !keys.includes(k));
  ok('every row field the code writes is in the codec, so none can be dropped on share, restore or export',
     written.size >= 6 && unknown.length === 0, 'written: ' + [...written].join(',') + ' unknown: ' + unknown.join(','));

  /* One row with every field set, through the camera and back. Checked
     field by field against the codec's own list, so a field added to the
     list without a sample here fails too rather than passing untested. */
  const trip = JSON.parse(call(`(function () {
    state = defaultState(); migrate(); state.prefs.units = 'lb';
    const full = { w: '100', u: 'lb', r: '8', done: true, ts: 1726000000000, rir: '2',
                   d: [{ w: '80', r: '6' }, { w: '', r: '' }], dk: 'forced' };
    const sent = rowToShare(full);
    const back = rowFromImport(JSON.parse(JSON.stringify(sent)));
    return JSON.stringify({ sent: sent, back: back, again: rowToShare(back) });
  })()`));
  const missing = keys.filter(k => !(k in trip.back));
  ok('a set with every field set comes back from a share with every field',
     missing.length === 0, 'missing: ' + missing.join(',') + ' ' + JSON.stringify(trip));
  ok('...unchanged, and sending it again sends the same thing',
     JSON.stringify(trip.back) === JSON.stringify(trip.sent) && JSON.stringify(trip.again) === JSON.stringify(trip.sent),
     JSON.stringify(trip));
  ok('...with the half-typed drop left behind', trip.sent.d.length === 1, JSON.stringify(trip.sent.d));

  const hostile = JSON.parse(call(`JSON.stringify([
    rowFromImport({ w: '60', r: '8', done: 1, u: 'LB', rir: '2+', dk: 'forced', ts: -5 }),
    rowFromImport({ w: '60', r: '8', done: true, d: [{ w: '40', r: '8' }], dk: 'nonsense' }),
    rowFromImport(['60', '8']),
    rowFromImport({ w: { kg: 60 }, r: 12345678901234567890 }),
  ])`));
  ok('accepted on its own terms: no unit but the exact lb, no chip as a row RIR, no dk without drops, no bad date',
     JSON.stringify(hostile[0]) === '{"w":"60","r":"8","done":true}', JSON.stringify(hostile[0]));
  ok('...an unknown drop kind is a plain drop', hostile[1].dk === 'drop' && hostile[1].d.length === 1, JSON.stringify(hostile[1]));
  ok('...and a row that is not an object is an empty one', JSON.stringify(hostile[2]) === '{"w":"","r":"","done":false}',
     JSON.stringify(hostile[2]));
  ok('...and a value that is not text becomes bounded text',
     typeof hostile[3].w === 'string' && typeof hostile[3].r === 'string' && hostile[3].r.length <= call('LOG_LIMITS.val'),
     JSON.stringify(hostile[3]));

  /* The CSV header is a promise to whoever opens the file in a
     spreadsheet: building it from the codec must not move a column. */
  const header = call(`buildCsv().split('\\r\\n')[0].replace(/^\\uFEFF/, '')`);
  ok('the CSV header is the one it always was, with the set\'s columns from the codec',
     header === 'perfil,bloque,semana,dia,ejercicio,orden,serie,peso,unidad,reps,hecha,fecha,rir,bajadas,tipo_bajada,nota,energia',
     header);
}

console.log('\n== the Diagnóstico on sessionsOf: the deload is deloadAt (plans/038 PR 4) ==');
{
  /* The one visible change of the move: the Diagnóstico used to skip only
     `w === deloadWeek(block)`, so a week written as "Descarga" in the
     phase text by hand, with the block's deload field never set, was
     fitted into the trend and could be the baseline or the end of the
     strength index. Four weeks, rising, with week 3 the hand-written
     deload and no deload field at all. */
  const handDeload = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, deload: 0,
                                          phase: { 3: { r: 'Descarga', t: '' } },
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [1, 2, 3, 4].map(w => ({ block: 'A', week: w, day: 'd1', lift: 'bp',
                                         sets: [[w === 3 ? 30 : 50 + w, 8], [w === 3 ? 30 : 50 + w, 8]] })) });
    const block = p.blocks.A;
    const points = diagPoints(p, 'bp', 'A').map(x => x.label);
    /* Week 4 dropped for the index: with nothing after it, the deload is
       the last week logged, which is exactly where it must not be read. */
    delete p.log.A[slot(4, 'd1')];
    return JSON.stringify({
      points: points,
      series: strengthByExercise(p, block).bp.map(v => v != null),
      rows: strengthRows(p, block).map(r => ({ base: r.base, last: r.lastWeek })),
    });
  })()`));
  ok('diagPoints leaves out a week the phase text calls "Descarga", not only the block\'s deload week',
     handDeload.points.join('|') === 'A · S1|A · S2|A · S4', JSON.stringify(handDeload.points));
  ok('...and the strength index will not end its comparison on it, while the chart keeps its sets',
     handDeload.rows.length === 1 && handDeload.rows[0].base === 0 && handDeload.rows[0].last === 1 &&
       handDeload.series.join(',') === 'true,true,true,false', JSON.stringify(handDeload));
  const lastOnDeload = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 3, deload: 0,
                                          phase: { 1: { r: 'descarga', t: '' }, 3: { r: 'Semana de descarga', t: '' } },
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [1, 2, 3].map(w => ({ block: 'A', week: w, day: 'd1', lift: 'bp', sets: [[50, 8]] })) });
    return JSON.stringify(strengthRows(p, p.blocks.A).map(r => ({ base: r.base, last: r.lastWeek })));
  })()`));
  ok('...nor start it there: a hand-written deload in the first week is not the baseline',
     lastOnDeload.length === 1 && lastOnDeload[0].base === 1 && lastOnDeload[0].last === 1, JSON.stringify(lastOnDeload));

  /* What the move had to keep, pinned because the session carries a
     different reading of both: a point's ts is the LATEST tick (the
     session date is the median), and its rir is getRir's string, the
     legacy chip as it was stored — not the last working set's number. */
  const kept = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [{ block: 'A', week: 1, day: 'd1', lift: 'bp', rir: '2+',
                   sets: [[50, 8, { ts: 1000 }], [50, 8, { ts: 2000 }], [50, 8, { ts: 900000 }]] }] });
    const pt = diagPoints(p, 'bp', 'A')[0];
    return JSON.stringify({ ts: pt.ts, rir: pt.rir, rows: pt.rows.length });
  })()`));
  ok('a point still carries the latest tick as its ts and the legacy chip as the string it was stored as',
     kept.ts === 900000 && kept.rir === '2+' && kept.rows === 3, JSON.stringify(kept));
}

console.log('\n== the CSV: every set ever logged, the hidden ones too (plans/038) ==');
{
  /* One small profile: two days, a retired exercise with a set on it, a
     reordered week, a note, an energy chip, an unticked set and a drop.
     `more` adds what the app hides — the file must carry it. */
  call(`
    function csvFixture(more) {
      state = defaultState(); migrate();
      state.prefs.units = 'kg';
      Object.keys(state.profiles).forEach(k => { if (k !== 'hombre') delete state.profiles[k]; });
      state.activeProfile = 'hombre';
      const p = state.profiles.hombre;
      p.label = 'H';
      p.blocks = { A: { id: 'A', name: 'Fuerza', weeks: 2, deload: 0, phase: {}, priority: [], days: [
        { id: 'd1', name: 'Empuje', ex: [{ id: 'bp', n: 'Press banca', sets: 2, reps: '6-8' },
                                         { id: 'ohp', n: 'Press militar', sets: 2, reps: '8-10' },
                                         { id: 'dip', n: 'Fondos', sets: 2, reps: '8-12', off: true }] },
        { id: 'd2', name: 'Pierna', ex: [{ id: 'sq', n: 'Sentadilla', sets: 2, reps: '5-6' }] } ] } };
      p.blockOrder = ['A'];
      p.log = { A: {} }; p.rir = { A: {} }; p.notes = { A: {} }; p.energy = { A: {} }; p.order = { A: {} };
      p.log.A[slot(1, 'd1')] = {
        bp: [{ w: '60', r: '8', done: true, ts: 1700000000000, rir: '2' }, { w: '60', r: '7', done: true, ts: 1700000100000 }],
        ohp: [{ w: '40', r: '10', done: true }, { w: '', r: '', done: false }],
        dip: [{ w: '10', r: '12', done: true, u: 'lb' }] };
      p.log.A[slot(2, 'd1')] = {
        bp: [{ w: '62,5', r: '8', done: true, d: [{ w: '45', r: '5' }], dk: 'forced' }, { w: '62,5', r: '6', done: false }] };
      p.log.A[slot(1, 'd2')] = { sq: [{ w: '100', r: '5', done: true }] };
      p.order.A[slot(2, 'd1')] = ['ohp', 'bp'];
      p.notes.A[slot(1, 'd1')] = 'dormí mal';
      p.energy.A[slot(2, 'd1')] = 'alta';
      if (more) more(p);
      return buildCsv();
    }
  `);
  const HEAD = '﻿perfil,bloque,semana,dia,ejercicio,orden,serie,peso,unidad,reps,hecha,fecha,rir,bajadas,tipo_bajada,nota,energia';
  const PLAN_ROWS = [
    'H,Fuerza,1,Empuje,Press banca,1,1,60,kg,8,si,2023-11-14,2,,,dormí mal,',
    'H,Fuerza,1,Empuje,Press banca,1,2,60,kg,7,si,2023-11-14,,,,dormí mal,',
    'H,Fuerza,2,Empuje,Press banca,2,1,"62,5",kg,8,si,,,45x5,Forzado,,alta',
    'H,Fuerza,2,Empuje,Press banca,2,2,"62,5",kg,6,no,,,,,,alta',
    'H,Fuerza,1,Empuje,Press militar,2,1,40,kg,10,si,,,,,dormí mal,',
    'H,Fuerza,1,Empuje,Fondos,,1,10,lb,12,si,,,,,dormí mal,',
    'H,Fuerza,1,Pierna,Sentadilla,1,1,100,kg,5,si,,,,,,',
  ];
  /* Written by the walk over the plan this replaced, byte for byte: with
     nothing stranded or removed, the file is the one it always was. */
  const same = call('csvFixture()');
  ok('with nothing hidden, the CSV is byte for byte the one the plan walk wrote',
     same === [HEAD].concat(PLAN_ROWS).join('\r\n'), JSON.stringify(same));

  const more = call(`csvFixture(p => {
    p.log.A[slot(3, 'd1')] = { bp: [{ w: '65', r: '5', done: true }] };
    p.log.A[slot(1, 'd1')].gone = [{ w: '20', r: '15', done: true }];
    p.log.A[slot(2, 'd1')].sq = [{ w: '90', r: '6', done: false }];
    p.log.A[slot(1, 'd9')] = { zz: [{ w: '5', r: '20', done: true }] };
  })`).split('\r\n');
  ok('a stranded week\'s set is exported, after the block\'s own weeks of that exercise, with its day\'s order',
     more[5] === 'H,Fuerza,3,Empuje,Press banca,1,1,65,kg,5,si,,,,,,', more.slice(1, 7).join(' | '));
  ok('a set of an exercise removed from the plan is exported with an empty orden, after the day\'s planned ones, under its raw id',
     more[8] === 'H,Fuerza,1,Empuje,gone,,1,20,kg,15,si,,,,,dormí mal,', more.slice(6, 10).join(' | '));
  ok('...under the name the plan still has for that id on another day, if it has one',
     more[9] === 'H,Fuerza,2,Empuje,Sentadilla,,1,90,kg,6,no,,,,,,alta', more.slice(8, 11).join(' | '));
  ok('...and a day taken out of the plan goes by its id, after the plan\'s days',
     more[11] === 'H,Fuerza,1,d9,zz,,1,5,kg,20,si,,,,,,' && more.length === 12, more.slice(9).join(' | '));
  ok('...while every row the plan walk wrote is still there, in the same order',
     JSON.stringify(more.filter(l => PLAN_ROWS.indexOf(l) >= 0)) === JSON.stringify(PLAN_ROWS), more.join(' | '));
}

(async () => {
  console.log('\n== requestWakeLock: one rest, one lock — skipped mid-request, doubled up, or re-acquired (plans/008 item 15, plans/013) ==');
  /* A real WakeLockSentinel carries its own .released flag, and the guard
     added in plans/013 reads it — so the fake has to carry one as well. */
  const makeLock = () => ({ released: false, release() { this.released = true; return Promise.resolve(); } });
  let requests = 0, nextLock = makeLock();
  app.navigator.wakeLock = { request: () => { requests++; return Promise.resolve(nextLock); } };

  let fakeLock = nextLock;
  await call('requestWakeLock()');
  ok('no rest in flight: the lock is released, not stored', fakeLock.released === true && call('wakeLock') == null);

  nextLock = fakeLock = makeLock();
  call('tId = 1');
  await call('requestWakeLock()');
  ok('a rest still running: the lock is kept', fakeLock.released === false && call('wakeLock') === fakeLock);

  /* plans/013: a second rest started while one was live used to request a
     second lock and overwrite the variable. The first reference went on the
     floor, so "saltar" released only the one it could see and the screen
     stayed on for the rest of the session. */
  const held = fakeLock, before = requests;
  nextLock = makeLock();
  await call('requestWakeLock()');
  ok('a lock already held: no second request, and the first one is still the one stored',
     requests === before && call('wakeLock') === held && held.released === false,
     'requests ' + requests + ', was ' + before);

  /* ...but a sentinel the browser released while the tab was hidden is not a
     held lock any more. The visibilitychange handler has to be able to get a
     fresh one, which is why the guard tests .released and not bare truth. */
  held.released = true;
  const fresh = nextLock;
  await call('requestWakeLock()');
  ok('a lock the browser already released is replaced rather than treated as held',
     requests === before + 1 && call('wakeLock') === fresh,
     'requests ' + requests + ', was ' + before);

  /* Both taps clear that guard before either request resolves, so the guard
     alone cannot cover this one: the lock that lands second is released by
     the call that asked for it. */
  call('wakeLock = null');
  const first = makeLock(), second = makeLock(), queue = [first, second];
  app.navigator.wakeLock = { request: () => { requests++; return Promise.resolve(queue.shift()); } };
  await Promise.all([call('requestWakeLock()'), call('requestWakeLock()')]);
  ok('two rests started in the same tick end up holding exactly one lock',
     call('wakeLock') === first && first.released === false && second.released === true,
     JSON.stringify({ heldIsFirst: call('wakeLock') === first, first: first.released, second: second.released }));
  call('tId = null; wakeLock = null;');

  console.log('\n== buildQrPayload leaves the backup nag alone (plans/013) ==');
  call('state = defaultState(); migrate(); state.prefs.sessionsSinceBackup = 5;');
  /* Building the payload is not sending it: drawQrShow can still refuse the
     result as too many frames for a camera, and picking "perfil" in the
     segmented control redraws through here every time. The counter is reset
     where the frames go on screen, which needs a DOM — so what is asserted
     here is that this half no longer touches it. */
  const qrPayload = await call('buildQrPayload("profile", getProfile(), getBlock())');
  ok('choosing "perfil" does not reset the sessions-since-backup counter',
     call('state.prefs.sessionsSinceBackup') === 5,
     String(call('state.prefs.sessionsSinceBackup')));
  ok('...and the payload it builds is still the whole profile',
     qrPayload.kind === 'profile' && !!qrPayload.profile && qrPayload.key === call('state.activeProfile'),
     JSON.stringify({ kind: qrPayload.kind, key: qrPayload.key, hasProfile: !!qrPayload.profile }));

  console.log('\n== the round-trip text carries the app\'s own context (plans/016) ==');
  call('state = defaultState(); migrate(); state.setupDone = true; state.prefs.units = "kg";');
  call('getBlock().name = "Bloque «raro» 2"; getBlock().priority = ["Pecho «x»", "Espalda"];');
  const ownPrompt = await call('buildAiPrompt({ withBlock: true })');
  const ownPlan = call('JSON.stringify(blockSharePlan(getBlock()))');
  ok('with the app set up, the prompt carries the current block as JSON',
     ownPrompt.indexOf('Mi bloque actual') >= 0 && ownPrompt.indexOf(ownPlan) >= 0,
     ownPrompt.slice(-200));
  ok('and the shipped example is left out', ownPrompt.indexOf('Ejemplo de referencia') < 0);
  ok('it names the unit and the id field',
     ownPrompt.indexOf('Peso en kg') >= 0 && ownPrompt.indexOf('"id": string opcional') >= 0 && ownPrompt.indexOf('"inc": número opcional (en kg)') >= 0);
  ok('and says a phase week needs both keys', ownPrompt.indexOf('"r" y "t" juntos') >= 0);
  ok('it still asks for what only the user knows', ownPrompt.indexOf('[tu nivel') >= 0);
  ok('the block name in the prompt is delimited and its own delimiters stripped',
     ownPrompt.indexOf('Mi bloque actual, «Bloque raro 2», tiene') >= 0, ownPrompt.slice(0, 600));
  ok('and so is every priority tag',
     ownPrompt.indexOf('Músculos prioritarios: «Pecho x», «Espalda».') >= 0, ownPrompt.slice(0, 600));
  const firstRunPrompt = await call('buildAiPrompt({ withBlock: false })');
  ok('on a first run the prompt has no block of its own in it',
     firstRunPrompt.indexOf('Mi bloque actual') < 0 && firstRunPrompt.indexOf('Mi contexto: [tu nivel') >= 0);

  /* Three sessions of one exercise is the minimum diagRows needs for a
     verdict; the RIR gives the histogram something to count. Written into
     the legacy map and then folded onto the rows, exactly as a profile
     logged before plans/035 arrives on load — so this fixture exercises
     both the fold and the per-set tally that reads the rows. */
  call(`
    (function() {
      const pr = state.profiles.hombre;
      const blockId = pr.blockOrder[0];
      const day = pr.blocks[blockId].days[0];
      const exId = day.ex[0].id;
      pr.log[blockId] = {};
      pr.rir[blockId] = {};
      for (let w = 1; w <= 4; w++) {
        pr.log[blockId][slot(w, day.id)] = { [exId]: [{ w: String(60 + w * 2.5), r: '8', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 }] };
      }
      pr.rir[blockId][slot(2, day.id)] = { [exId]: '0' };
      pr.rir[blockId][slot(3, day.id)] = { [exId]: '0' };
      pr.rir[blockId][slot(4, day.id)] = { [exId]: '1' };
      foldRirMap(pr, blockId);
      pr.notes[blockId] = { [slot(2, day.id)]: 'nota «rara»' };
      day.ex[0].n = 'Press «raro» de banca';
      pr.week = 5;
      resetRenderCache();
    })()
  `);
  const review = call('reviewText(buildBlockReview(getProfile(), getBlock()))');
  ok('the review lists the exercises under the muscles', review.indexOf('### Por ejercicio') >= 0, review.slice(0, 400));
  ok('with the name delimited and the delimiters stripped from it',
     review.indexOf('- «Press raro de banca» (') >= 0, (review.match(/- «Press.*/) || [''])[0]);
  ok('a trend and a reading for an exercise with enough sessions',
     /«Press raro de banca».*tendencia (subiendo|plano|bajando) [+−]?[\d,]+ % por sesión sobre 4 sesiones/.test(review),
     (review.match(/- «Press.*/) || [''])[0]);
  ok('and the RIR written down, as a histogram over sets with the block total behind it',
     review.indexOf('RIR apuntado: 1 en 1 serie, 0 en 2 (de 4)') >= 0,
     (review.match(/RIR apuntado[^.]*/) || [''])[0]);
  ok('muscle tags are delimited too', /^- «Pecho»/m.test(review), (review.match(/^- «.*/m) || [''])[0]);
  ok('the review heading delimits the block name',
     review.indexOf('## Cómo fue el bloque anterior («Bloque raro 2»)') >= 0, review.slice(0, 200));
  ok('and the priority line delimits each tag',
     review.indexOf('prioritarios: «Pecho x», «Espalda».') >= 0, (review.match(/prioritarios.*/) || [''])[0]);
  ok('the session note is delimited',
     review.indexOf(': «nota rara»') >= 0, (review.match(/Semana.*nota.*/) || [''])[0]);
  call('getBlock().name = "Bloque 1"; getBlock().priority = ["Pecho", "Espalda", "Hombro"];');

  /* The review must not inherit the Diagnóstico sheet's toggle. */
  call(`
    (function() {
      const pr = state.profiles.hombre;
      const b1 = pr.blocks[pr.blockOrder[0]];
      const b2 = JSON.parse(JSON.stringify(b1));
      b2.id = 'block-2'; b2.name = 'Bloque 2';
      pr.blocks[b2.id] = b2; pr.blockOrder.push(b2.id); pr.activeBlock = b2.id;
      const day = b2.days[0]; const exId = day.ex[0].id;
      pr.log[b2.id] = {};
      for (let w = 1; w <= 2; w++) {
        pr.log[b2.id][slot(w, day.id)] = { [exId]: [{ w: '80', r: '8', done: true, ts: Date.now() - (3 - w) * 7 * 86400000 }] };
      }
      pr.week = 3;
      diagScope = 'all';
      resetRenderCache();
    })()
  `);
  const scoped = call('diagRows(getProfile(), getBlock(), "block").find(r => r.id === getBlock().days[0].ex[0].id).sessions');
  call('resetRenderCache()');
  const global = call('diagRows(getProfile(), getBlock()).find(r => r.id === getBlock().days[0].ex[0].id).sessions');
  /* `global` is the two blocks' sessions together (4 + 2), capped by
     DIAG_WINDOW; asserted as "more than the scoped count" rather than as 6
     so a change to that window cannot fail a test about scope. */
  ok('diagRows scoped to the block counts only its own sessions while the sheet is on "Todos los bloques"',
     scoped === 2 && global > scoped, JSON.stringify({ scoped: scoped, global: global }));
  call('diagScope = "block"');

  console.log('\n== priorBlockSets: the block before this one, last logged week, deload skipped (plans/018) ==');
  const priorProbe = call(`
    (function() {
      state = defaultState(); migrate();
      const pr = state.profiles.hombre;
      const b1 = pr.blocks[pr.blockOrder[0]];      /* 8 weeks, deload on 8 */
      const day = b1.days[0];
      const ex = day.ex[0];
      pr.log[b1.id] = {};
      pr.log[b1.id][slot(6, day.id)] = { [ex.id]: [{ w: '60', r: '8', done: true }, { w: '60', r: '8', done: true }] };
      pr.log[b1.id][slot(7, day.id)] = { [ex.id]: [{ w: '65', r: '8', done: true }, { w: '65', r: '7', done: true }] };
      pr.log[b1.id][slot(8, day.id)] = { [ex.id]: [{ w: '40', r: '8', done: true }] };   /* the deload */
      /* A second block, a copy with the same ids — what "+ Nuevo bloque" makes. */
      const b2 = JSON.parse(JSON.stringify(b1)); b2.id = 'block-2'; b2.name = 'Bloque 2';
      pr.blocks[b2.id] = b2; pr.blockOrder.push(b2.id); pr.activeBlock = b2.id;
      /* A third, arrived as JSON: fresh ids, same name. */
      const b3 = JSON.parse(JSON.stringify(b1)); b3.id = 'block-3'; b3.name = 'Bloque 3';
      b3.days.forEach(d => d.ex.forEach(e => { e.id = 'imp-' + e.id; }));
      pr.blocks[b3.id] = b3; pr.blockOrder.push(b3.id);
      resetRenderCache();
      const fromCopy = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      const fromJson = priorBlockSets(pr, b3, b3.days[0].ex[0]);
      const unknown = priorBlockSets(pr, b2, { id: 'nope', n: 'Nada de esto' });
      const first = priorBlockSets(pr, b1, ex);
      /* Only the deload logged: nothing usable. */
      delete pr.log[b1.id][slot(6, day.id)]; delete pr.log[b1.id][slot(7, day.id)];
      const onlyDeload = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      return {
        copy: fromCopy && { block: fromCopy.block.id, week: fromCopy.week, w: fromCopy.sets.map(s => s.w).join('/') },
        json: fromJson && { block: fromJson.block.id, week: fromJson.week },
        unknown: unknown, first: first, onlyDeload: onlyDeload,
      };
    })()
  `);
  ok('a copied block reads the previous block\'s last non-deload week',
     priorProbe.copy && priorProbe.copy.block === 'block-1' && priorProbe.copy.week === 7 && priorProbe.copy.w === '65/65',
     JSON.stringify(priorProbe.copy));
  ok('a block that arrived as JSON with its own ids still finds the lift by name',
     priorProbe.json && priorProbe.json.block === 'block-1' && priorProbe.json.week === 7, JSON.stringify(priorProbe.json));
  ok('a lift the earlier blocks never planned gets nothing', priorProbe.unknown === null);
  ok('the first block of a profile has nothing before it', priorProbe.first === null);
  ok('a previous block whose only logged week is the deload is not used', priorProbe.onlyDeload === null);

  /* The band and the rule used to disagree about what a deload week is: the
     band tested the `deload` field alone, the rule (exHistory) tests
     deloadAt, which also reads a phase text saying "Descarga". A block
     whose deload was written in by hand showed its ~60 % weights in the
     week-1 hint while the objetivo ignored them (plans/025). */
  const priorPhaseDeload = call(`
    (function() {
      state = defaultState(); migrate();
      const pr = state.profiles.hombre;
      const b1 = pr.blocks[pr.blockOrder[0]];
      /* No deload field at all — only the phase text says so. */
      b1.deload = 0;
      b1.phase[8] = { r: 'Descarga', t: 'Semana suave' };
      const day = b1.days[0], ex = day.ex[0];
      pr.log[b1.id] = {};
      pr.log[b1.id][slot(7, day.id)] = { [ex.id]: [{ w: '65', r: '8', done: true }] };
      pr.log[b1.id][slot(8, day.id)] = { [ex.id]: [{ w: '40', r: '8', done: true }] };
      const b2 = JSON.parse(JSON.stringify(b1)); b2.id = 'block-2'; b2.name = 'Bloque 2';
      pr.blocks[b2.id] = b2; pr.blockOrder.push(b2.id); pr.activeBlock = b2.id;
      resetRenderCache();
      const hint = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      return hint && { week: hint.week, w: hint.sets.map(s => s.w).join('/') };
    })()
  `);
  ok('a deload written only into the phase text is skipped by the hint band too, same as by the rule',
     priorPhaseDeload && priorPhaseDeload.week === 7 && priorPhaseDeload.w === '65',
     JSON.stringify(priorPhaseDeload));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
