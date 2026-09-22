/* Headless assertions for the logic that does not need a browser.
 *
 *   node test/unit.js
 *
 * No server, no Chromium, no dependencies. The six source files are plain
 * <script> tags sharing one global scope (see index.html), so loading them
 * into a single node:vm context in the same order reproduces that scope
 * closely enough to call the pure functions directly. That context, the
 * document stubs it is built with and the script list are in
 * test/harness.js, beside bootApp(), which boots the shell for real so a
 * test can press a handler and read back what it did (plans/052).
 *
 * This does not replace test/smoke.js. Anything a user could observe — a
 * class on an element, a value surviving a reload, a sheet opening — belongs
 * there, in a real browser. What belongs here is arithmetic and data repair:
 * migrate(), the import validators, the statistics, and what a handler
 * writes. Those are expensive and imprecise to assert through a browser and
 * cheap to assert here.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const { inert, SHELL_SCRIPTS, loadApp, bootApp, BOOT_TIME } = require('./harness');

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

ok('sw.js reads the cache via fromCache, not bare caches.match',
   !swSrc.includes('caches.match('),
   'found bare caches.match( in sw.js');

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
/* Said out loud because it was assumed otherwise: `app` is not a running
   app. Its stub parses nothing, so load()'s first draw fell into the
   recovery screen, and everything below that uses it — most of this file —
   runs frozen, with no handler to call. A test that needs a real handler
   boots with bootApp() (test/harness.js) instead. */
ok('loadApp() does not boot: load()\'s first draw fell into recovery, so ready is false and frozen true',
   call('ready') === false && call('frozen') === true, 'ready ' + call('ready') + ', frozen ' + call('frozen'));

/* AGENTS.md's two split rules, checked against the code itself rather than
   against whichever states the draws below happen to walk. Rule 1: app.js,
   and the three files that predate the split (which the rules treat as
   app.js), read nothing that only a guarded file defines unless app.js
   stubs it or the read sits under a `typeof … === 'function'` test. Rule 2:
   a guarded file reads nothing that only another guarded file defines —
   stub or no stub. deloadCheck's unstubbed read of strengthByExercise
   broke rule 1 on every draw after a mid-block deload, and nothing here
   could see it: the section below only ever loaded three of the seven
   guarded files, and never drew. */
console.log('\n== the split rules hold in the source (AGENTS.md rules 1 and 2) ==');
const PRE_SPLIT = ['js/data.js', 'js/block-editor.js', 'js/profile-transfer.js'];
/* Every file split out since then: guarded by default, so a new one is
   checked here and drawn without below the day its script tag lands. */
const GUARDED_SPLIT = SHELL_SCRIPTS.filter(f =>
  !PRE_SPLIT.includes(f) && !['js/theme-init.js', 'js/app.js', 'js/boot-guard.js'].includes(f));

/* The source with its comments, strings and regex literals blanked to
   spaces, so a name the prose discusses, a Spanish sentence or a class in
   an innerHTML string ('tick') is not taken for a read. Template literals
   keep their ${…} code. Lengths and line breaks are kept, so an offset or
   a line number means the same thing in both. */
function codeOnly(src) {
  let i = 0, last = '';
  const blank = s => s.replace(/[^\n]/g, ' ');
  /* A slash starts a regex where an operand is expected, and divides
     after one: after a name, a number, `)` or `]`. */
  const regexHere = () => !last || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(last) ||
    /^(return|typeof|case|in|of|delete|void|throw|new|else|do|instanceof)$/.test(last);
  function code(inTemplate) {
    let out = '', depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (inTemplate && c === '}' && depth === 0) return out;
      let end = -1;
      if (c === '/' && d === '*') { end = src.indexOf('*/', i + 2); end = end < 0 ? src.length : end + 2; }
      else if (c === '/' && d === '/') { end = src.indexOf('\n', i); if (end < 0) end = src.length; }
      else if (c === '/' && regexHere()) {
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) {
          if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
          j++;
        }
        if (src[j] === '/') { j++; while (/[a-z]/.test(src[j] || '')) j++; end = j; last = 'x'; }
      }
      if (end >= 0) { out += blank(src.slice(i, end)); i = end; continue; }
      if (c === '\'' || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        out += c + blank(src.slice(i + 1, j)) + c; i = j + 1; last = 'x'; continue;
      }
      if (c === '`') {
        out += ' '; i++;
        while (i < src.length && src[i] !== '`') {
          if (src[i] === '\\') { out += blank(src.slice(i, i + 2)); i += 2; }
          else if (src[i] === '$' && src[i + 1] === '{') { out += '  '; i += 2; out += code(true) + ' '; i++; }
          else { out += src[i] === '\n' ? '\n' : ' '; i++; }
        }
        out += ' '; i++; last = 'x'; continue;
      }
      if (c === '{') depth++; else if (c === '}') depth--;
      out += c;
      if (/[\w$]/.test(c)) last = /[\w$]/.test(src[i - 1] || '') ? last + c : c;
      else if (!/\s/.test(c)) last = c;
      i++;
    }
    return out;
  }
  return code(false);
}

/* Each read of a name in `names` (name → the file that alone defines it)
   that the engine would evaluate as a global: not a property (`.tick`),
   not a `typeof` (which cannot throw), not inside a block that declares a
   local of the same name (app.js's `const tick`, the card's own button,
   is not rest-timer.js's tick()). `guarded` is whether a `typeof name ===
   'function'` test covers it: the rest of that statement, or the block
   its `if` opens. */
function guardedReads(src, own, names) {
  const code = codeOnly(src), out = [], locals = [], guards = [];
  const prune = (list, gone) => { for (let k = list.length - 1; k >= 0; k--) if (gone(list[k])) list.splice(k, 1); };
  const re = /[A-Za-z_$][\w$]*|\d[\w.]*|\n|\S/g;
  let depth = 0, line = 1, prev = '', m;
  while ((m = re.exec(code))) {
    const t = m[0];
    if (t === '\n') { line++; continue; }
    if (t === '{') {
      guards.forEach(g => { if (g.block == null && g.depth === depth) g.block = depth + 1; });
      depth++;
    } else if (t === '}') {
      depth--;
      prune(locals, l => l.depth > depth);
      prune(guards, g => g.block != null && g.block > depth);
    } else if (t === ';') {
      prune(guards, g => g.block == null && g.depth === depth);
    } else if (names.has(t) && names.get(t) !== own && prev !== '.') {
      if (prev === 'typeof') {
        if (/^\s*===\s*'function'/.test(src.slice(m.index + t.length))) guards.push({ name: t, depth, block: null });
      } else if (depth > 0 && /^(const|let|var|function)$/.test(prev)) {
        locals.push({ name: t, depth });
      } else if (!locals.some(l => l.name === t)) {
        out.push({ name: t, from: names.get(t), line, guarded: guards.some(g => g.name === t) });
      }
    }
    prev = t;
  }
  return out;
}

const shellSrc = {}, definedIn = {};
SHELL_SCRIPTS.forEach(f => {
  shellSrc[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* Top-level declarations start at column 0 in every shell file. */
  definedIn[f] = new Set([...codeOnly(shellSrc[f]).matchAll(
    /^(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm)]
    .map(m => m[1] || m[2]));
});
const onlyInGuarded = new Map();
GUARDED_SPLIT.forEach(f => definedIn[f].forEach(n => {
  if (!SHELL_SCRIPTS.some(g => g !== f && definedIn[g].has(n))) onlyInGuarded.set(n, f);
}));
const appStubs = [...shellSrc['js/app.js'].matchAll(/if \(typeof (\w+) !== 'function'\) globalThis\.\1 = /g)].map(m => m[1]);

/* The scanner on the cases it exists to tell apart, so a scanner that sees
   nothing cannot pass the two checks after it by default. */
{
  const fixture = new Map([['strengthByExercise', 'js/diagnostics.js'], ['openReview', 'js/review.js'], ['tick', 'js/rest-timer.js']]);
  const seen = guardedReads([
    "function a(p, b) { return strengthByExercise(p, b); }",
    "/* strengthByExercise */ const s = 'openReview'; const r = /tick/; const t = `${'tick'}`;",
    "function c() { if (x && typeof openReview === 'function') { openReview(); } openReview(); }",
    "if (typeof tick === 'function') tick(); tick();",
    "function d(row) { const tick = row.querySelector('.tick'); tick.onclick = 1; }",
  ].join('\n'), 'js/app.js', fixture).map(r => r.line + ':' + r.name + (r.guarded ? '+' : ''));
  ok('the scanner sees a bare read, a guarded one and an unguarded one after it; not a comment, string, regex, local or property',
     seen.join(' ') === '1:strengthByExercise 3:openReview+ 3:openReview 4:tick+ 4:tick', seen.join(' '));
}

const rule1 = [];
['js/app.js', ...PRE_SPLIT].forEach(f => guardedReads(shellSrc[f], f, onlyInGuarded).forEach(r => {
  if (!r.guarded && !appStubs.includes(r.name)) rule1.push(f + ':' + r.line + ' ' + r.name + ' (' + r.from + ')');
}));
ok('rule 1: app.js and the pre-split files read nothing only a guarded file defines, unless stubbed or under typeof',
   rule1.length === 0, rule1.join('; '));
ok('...and the check reaches the reads it lets through (a stubbed openChart, a typeof-guarded wireReview)',
   guardedReads(shellSrc['js/app.js'], 'js/app.js', onlyInGuarded)
     .filter(r => (r.name === 'openChart' && !r.guarded) || (r.name === 'wireReview' && r.guarded)).length >= 2);

const rule2 = [...new Set([].concat(...GUARDED_SPLIT.map(f =>
  guardedReads(shellSrc[f], f, onlyInGuarded).map(r => f + ' reads ' + r.name + ' from ' + r.from))))].sort();
ok('rule 2: no guarded file reads what only another guarded file defines',
   rule2.length === 0, rule2.join('; '));
/* Rule 2 had one standing breach, listed here by name until it moved: the
   block review builds on the Diagnóstico's rows, and these six were
   defined in js/diagnostics.js alone, so a hole that dropped that file and
   kept js/review.js left "+ Nuevo bloque → Ver la revisión" throwing. They
   live in app.js now, with everything they are built from — rule 2's own
   fix. Put back where they were, the check above would name each one
   again; this says it still can, on the review as it is written today. */
const ONCE_STANDING = ['DIAG_TRENDS', 'DIAG_WINDOW', 'diagPct', 'diagRows', 'freqRows', 'strengthRows'];
const standingAgain = [...new Set(guardedReads(shellSrc['js/review.js'], 'js/review.js',
  new Map([...onlyInGuarded, ...ONCE_STANDING.map(n => [n, 'js/diagnostics.js'])])).map(r => r.name))].sort();
ok('...and it still sees js/review.js read each of the six it once listed, were they js/diagnostics.js\'s alone again',
   JSON.stringify(standingAgain) === JSON.stringify(ONCE_STANDING.slice().sort()), standingAgain.join(', '));

/* The same rules, run. js/app.js stubs the entry points of the split files
   it still names, so the app still boots when a worker's precache is
   missing one of them (sw.js adds each shell file on its own and lets a
   miss go). Each file below is left out in turn and the shell is booted
   for real (bootApp, plans/052) and asked to do what it does on every open.
   First the two things a session cannot do without: load() draws, and a
   set ticked on the real card is written — the tick reaches further than
   the draw (the rest timer, a card redrawn on its own, the backup nag), and
   a shell that draws but cannot tick has still lost the set. Then the draw
   again, through a block whose deload sits mid-block, with sets ticked
   either side of it: every week, the days in rotation, and every card
   redrawn on its own the way a tick redraws it. The recovery screen
   swallows the throw it answers, so for the walk it is made to let the
   throw through, and a failure names the draw's own error. Each pass is a
   precache hole survived, and a file split out tomorrow is walked here the
   day its script tag lands. */
console.log('\n== a precache hole: the shell boots, ticks and draws without each guarded file (AGENTS.md rule 1) ==');
GUARDED_SPLIT.forEach(file => {
  let partial = null, err = null;
  try { partial = bootApp({ omit: [file] }); } catch (e) { err = e; }
  ok('the shell loads without ' + file, !err && !!partial, err && err.message);
  if (!partial) return;
  const c = partial.call;
  appStubs.filter(n => onlyInGuarded.get(n) === file)
    .forEach(name => ok(file + ' absent: ' + name + ' is a callable stub', c('typeof ' + name) === 'function'));
  /* render() answers a throw with the recovery screen, which sets `ready`
     false and `frozen` true, so the pair is the whole of the first draw's
     verdict. */
  const why = () => { try { c('drawApp()'); return 'drawApp() did not throw a second time'; } catch (e) { return e.message; } };
  ok(file + ' absent: load() drew — ready is true, frozen false', c('ready') === true && c('frozen') === false,
     c('ready') === true ? 'frozen ' + c('frozen') : why());
  /* Typed into the first card's first set and ticked, then read back from
     what save() wrote once its debounce ran out. `ready` after it says the
     card the tick redrew did not fall into recovery either. */
  let tick;
  try {
    const card = partial.card(0), set = card.set(0);
    partial.type(set.w, '60');
    partial.type(set.r, '8');
    set.tick.onclick();
    partial.clock.advance(1000);
    const saved = partial.saved(), p = saved.profiles[saved.activeProfile];
    tick = { row: p.log[p.activeBlock][c('slot(getProfile().week, currentDay().id)')][card.ex.id][0], ready: c('ready') };
  } catch (e) { tick = { err: e.message }; }
  ok(file + ' absent: a set ticked on the real card is written and saved, and the shell is still up',
     !!tick.row && tick.row.w === '60' && tick.row.r === '8' && tick.row.done === true && tick.ready === true,
     JSON.stringify(tick));
  const walk = JSON.parse(c(`(function () {
    const p = getProfile(), b = getBlock(), days = dayList(b);
    b.deload = Math.max(2, Math.floor(blockWeeks(b) / 2));
    [b.deload - 1, b.deload, b.deload + 1].forEach(w => days.forEach(day => {
      const bucket = (p.log[b.id] = p.log[b.id] || {})[slot(w, day.id)] = {};
      exList(day).forEach(ex => {
        bucket[ex.id] = [{ w: String(w === b.deload ? 30 : 40 + w), r: '8', done: true,
                           ts: Date.now() - (12 - w) * 7 * 864e5 }];
      });
    }));
    logChanged();
    showRecovery = e => { throw e; };
    const errs = [];
    let drawn = 0;
    for (let w = 1; w <= blockWeeks(b); w++) {
      p.week = w; p.day = (w - 1) % days.length;
      try {
        drawApp();
        dayCards.map(x => x.ex.id).forEach(id => drawCard(id));
        drawn++;
      } catch (e) { errs.push('semana ' + w + ': ' + e.message); }
    }
    p.week = b.deload + 1;
    let compared = false;
    try { compared = !!deloadCheck(p, b); } catch (e) { errs.push('deloadCheck: ' + e.message); }
    return JSON.stringify({ weeks: blockWeeks(b), deload: b.deload, drawn: drawn, compared: compared, errs: errs });
  })()`));
  ok(file + ' absent: every week of a block with a mid-block deload draws, and so does each card on its own',
     walk.errs.length === 0 && walk.drawn === walk.weeks, walk.errs.slice(0, 3).join(' | '));
  /* Without this the walk could pass by never reaching the comparison that
     threw — a default block that stops ticking the weeks either side of
     its deload would draw clean for the wrong reason. */
  ok(file + ' absent: ...including the week after the deload, compared against the week before it',
     walk.compared, JSON.stringify(walk));
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

/* The same hole one level down, in the block ids localStorage itself
   carries, which never pass through normalizeImportedProfile: a truthy
   `profile.blocks[id]` let an activeBlock of 'constructor' and a
   'toString' in blockOrder through migrate(), and getBlock() then handed
   the first draw Object.prototype.constructor instead of a block. Each pair
   is [activeBlock, the reserved entry in blockOrder]; the first is the one
   the second architecture review found. */
[['constructor', 'toString'], ['toString', 'constructor'], ['__proto__', '__proto__'],
 ['valueOf', 'hasOwnProperty'], ['hasOwnProperty', 'valueOf']].forEach(([active, listed]) => {
  const got = JSON.parse(call('state = ' + JSON.stringify({
    profiles: { hombre: { blocks: { b1: { name: 'Real', days: [] } }, blockOrder: [listed, 'b1'], activeBlock: active } },
    activeProfile: 'hombre',
  }) + '; migrate(); JSON.stringify({ active: getProfile().activeBlock, order: getProfile().blockOrder.map(String),' +
    ' block: typeof getBlock() === "object" ? getBlock().name : typeof getBlock() })'));
  ok('migrate() repairs an activeBlock of "' + active + '" onto a block the profile owns',
     got.active === 'b1' && got.block === 'Real', JSON.stringify(got));
  ok('...and drops "' + listed + '" from blockOrder, which keeps only the blocks the profile owns',
     JSON.stringify(got.order) === '["b1"]', JSON.stringify(got.order));
});

/* A block's `id` is the key it is filed under, and every write to the
   record goes through it (entry, setOrder, the plan editor's save), so a
   stored id that disagreed with the key used to be trusted: 'constructor'
   filed every logged set onto the global Object function, where no save
   ever finds it, and another block's key filed them under that block. */
const blockIds = call('state = ' + JSON.stringify({
  profiles: { hombre: {
    blocks: { b1: { id: 'constructor', name: 'A', days: [] }, b2: { id: 'b1', name: 'B', days: [] }, b3: { id: '__proto__', name: 'C', days: [] } },
    blockOrder: ['b1', 'b2', 'b3'], activeBlock: 'b1',
  } },
  activeProfile: 'hombre',
}) + '; migrate(); Object.keys(getProfile().blocks).map(k => k + "=" + getProfile().blocks[k].id).join(" ")');
ok('migrate() makes every block\'s id the key it is filed under, whatever the stored copy said',
   blockIds === 'b1=b1 b2=b2 b3=b3', blockIds);

/* ...which is only safe once no block is filed under a reserved name. A
   block that OWNS '__proto__' passes the own-key test, but its key is its
   id, and on the log that id was not an own key yet: the first set logged
   on it went onto Object.prototype, and nothing was saved. Written as JSON
   text because only JSON.parse makes '__proto__' an own key; an object
   literal sets the prototype instead. */
const ownDay = JSON.stringify([{ id: 'd0', name: 'D', ex: [{ id: 'e1', n: 'E', sets: 3, reps: '10' }] }]);
const ownReserved = '{"activeProfile":"hombre","profiles":{"hombre":{' +
  '"blocks":{"__proto__":{"name":"P","days":' + ownDay + '},"constructor":{"name":"C","days":' + ownDay + '}},' +
  '"blockOrder":["constructor","__proto__"],"activeBlock":"__proto__",' +
  '"log":{"constructor":{"w1-d0":{"e1":[{"w":"50","r":"10","done":true}]}}}}}}';
const renamed = JSON.parse(call('state = JSON.parse(' + JSON.stringify(ownReserved) + '); migrate(); (() => {' +
  ' const p = getProfile(), b = getBlock(), c = p.blocks[p.blockOrder[0]];' +
  ' entry(p, b.id, 2, "d0", "e1", 3)[0].w = "60";' +
  ' return JSON.stringify({' +
  '   keys: Object.keys(p.blocks).filter(k => safeKey(k) && p.blocks[k].id === k).length,' +
  '   order: p.blockOrder.map(id => p.blocks[id].name).join(), active: b.name,' +
  '   moved: JSON.stringify(Object.keys(p.log[c.id] || {})),' +
  '   saved: Object.prototype.hasOwnProperty.call(p.log, b.id) && Object.keys(p.log[b.id]).join(),' +
  '   leaked: Object.keys(Object.prototype).concat(Object.keys(Object)).join() }); })()'));
ok('migrate() re-keys a block that owns a reserved name, and blockOrder and activeBlock follow it',
   renamed.keys === 2 && renamed.order === 'C,P' && renamed.active === 'P', JSON.stringify(renamed));
ok('...its history moves with it', renamed.moved === '["w1-d0"]', renamed.moved);
ok('...and a set logged on it is saved under its own key, never onto the prototype',
   renamed.saved === 'w2-d0' && renamed.leaked === '', JSON.stringify(renamed));

/* A block that is not an object at all — null, a string, a list — is one no
   writer in the app produces, and the import refuses it
   (describeProfileProblem: 'el bloque … está corrupto'), but localStorage is
   not an import. migrate() set `id` on it on the way past and threw, so
   load() never got as far as a draw. Every part of the record filed by block
   carries an entry under each id here, so a drop that forgot the record
   leaves one behind and fails. */
const blockParts = call('RECORD_PARTS.filter(part => part.keyedBy !== "exercise").map(part => part.name)');
const migrateBlocks = blocks => {
  const ids = Object.keys(blocks);
  const profile = { blocks, blockOrder: ids.slice().reverse(), activeBlock: ids[ids.length - 1] };
  blockParts.forEach(name => { profile[name] = {}; ids.forEach(id => { profile[name][id] = { 'w1-d0': {} }; }); });
  try {
    return call('state = ' + JSON.stringify({ profiles: { hombre: profile }, activeProfile: 'hombre' }) +
      '; migrate(); JSON.parse(JSON.stringify(state.profiles.hombre))');
  } catch (e) { return { threw: e.message }; }
};
const leftUnder = (got, id) => blockParts.filter(name => got[name] && Object.prototype.hasOwnProperty.call(got[name], id));
[null, 'corrupto', []].forEach(bad => {
  const label = JSON.stringify(bad);
  const got = migrateBlocks({ b1: { name: 'A', days: [] }, b2: bad });
  ok('migrate() survives a block stored as ' + label + ', and keeps the real one beside it',
     !got.threw && JSON.stringify(Object.keys(got.blocks)) === '["b1"]' && got.blocks.b1.name === 'A',
     got.threw || JSON.stringify(got.blocks));
  if (got.threw) return;
  ok('...blockOrder and activeBlock name only the real block (' + label + ')',
     JSON.stringify(got.blockOrder) === '["b1"]' && got.activeBlock === 'b1',
     JSON.stringify({ order: got.blockOrder, active: got.activeBlock }));
  ok('...the record under the dropped id goes with it, and the real block keeps its own (' + label + ')',
     !leftUnder(got, 'b2').length && !!got.log.b1, 'left under b2: ' + leftUnder(got, 'b2').join());
});

/* Nothing left is the same as nothing there: the seed, as for a profile
   whose `blocks` is empty. The corrupt block here is filed under the seed's
   own id on purpose — its record has to be gone before the seed takes that
   id, or the seed block opens on sets nobody logged against its plan. */
const seeded = migrateBlocks({});
const allCorrupt = migrateBlocks({ 'block-1': null, b2: 'corrupto', b3: [] });
const planOf = got => got.threw || JSON.stringify({ order: got.blockOrder, active: got.activeBlock,
  days: got.blockOrder.map(id => got.blocks[id].days) });
ok('migrate() falls back to the seed when every block is corrupt, the way it does for an empty blocks',
   !allCorrupt.threw && planOf(allCorrupt) === planOf(seeded), planOf(allCorrupt).slice(0, 200));
ok('...and the seed block does not inherit what was filed under the corrupt block it replaced',
   !allCorrupt.threw && ['block-1', 'b2', 'b3'].every(id => !leftUnder(allCorrupt, id).length),
   allCorrupt.threw || JSON.stringify(blockParts.map(name => name + ':' + Object.keys(allCorrupt[name] || {}))));

const bareProfile = {
  profiles: { hombre: { blocks: {}, blockOrder: [], log: {} } },
  activeProfile: 'hombre',
};
const migratedBare = call('state = ' + JSON.stringify(bareProfile) + '; migrate(); JSON.parse(JSON.stringify(state));');
const p = migratedBare.profiles.hombre;
/* Every part of the profile's record, read off the table rather than
   listed here: this list used to stop at order, and missed obj and
   variants for as long as they existed. */
call('RECORD_PARTS.map(part => part.name)').forEach(name => {
  ok(name + ' is created when absent', typeof p[name] === 'object' && p[name] !== null, JSON.stringify(p[name]));
});

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

    /* Every part of the record, off the table: the hand-written list here
       stopped at order and never checked obj or variants. */
    const same = {};
    RECORD_PARTS.forEach(part => { same[part.name] = JSON.stringify(after[part.name]) === JSON.stringify(before[part.name]); });
    return { same, beforeLog: JSON.stringify(before.log), afterLog: JSON.stringify(after.log) };
  })()
`);
ok('a real week of logged sets round-trips through normalizeImportedProfile unchanged',
   populatedRoundTrip.same.log, populatedRoundTrip.beforeLog + ' vs ' + populatedRoundTrip.afterLog);
Object.keys(populatedRoundTrip.same).filter(name => name !== 'log').forEach(name => {
  ok('...' + name + ' too', populatedRoundTrip.same[name], JSON.stringify(populatedRoundTrip.same));
});

const validBlock = { name: 'B', weeks: 8, deload: 8, days: [{ name: 'D', ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] }] };
/* PROFILE_LIMITS.blocks is where the app's writers stop; a restore allows
   OWN_LIMITS.blocks, twice that, for a profile that got past it before they
   stopped (plans/010). Headroom, not an open door: one block past it still
   throws. */
const profileRefusal = n => {
  const p = { blocks: {}, blockOrder: [], log: {} };
  for (let i = 0; i < n; i++) { p.blocks['b' + i] = validBlock; p.blockOrder.push('b' + i); }
  try { call('normalizeImportedProfile(' + JSON.stringify(p) + ')'); return ''; } catch (e) { return e.message; }
};
const heldTo = call('PROFILE_LIMITS.blocks'), ownBlocks = call('OWN_LIMITS.blocks');
ok('a profile past PROFILE_LIMITS.blocks restores, up to OWN_LIMITS.blocks',
   ownBlocks > heldTo && profileRefusal(heldTo + 1) === '' && profileRefusal(ownBlocks) === '',
   heldTo + '/' + ownBlocks + ': ' + profileRefusal(heldTo + 1) + ' | ' + profileRefusal(ownBlocks));
ok('a profile with more than OWN_LIMITS.blocks blocks throws, naming the ceiling',
   profileRefusal(ownBlocks + 1).indexOf((ownBlocks + 1) + ' bloques: el máximo es ' + ownBlocks) >= 0,
   profileRefusal(ownBlocks + 1));

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
    RECORD_PARTS.forEach(part => { p[part.name] = {}; });
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
    /* Straight into the map, not through setOrder: that writes through the
       order part's rule now, which refuses a blocked id on the way in
       (plans/051). A file carries one anyway when it was written before
       migrate() refused the name, or edited by hand. */
    profile.order[block.id] = {};
    profile.order[block.id][slot(1, day.id)] = ['__proto__', day.ex[1].id, day.ex[2].id];

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

/* Only a hand-edited localStorage can put a prototype name into
   profile.order — every import re-keys it — but migrate()'s whole brief is
   to survive exactly that, and orderedEx used to push
   Object.prototype.toString into the session as if it were an exercise
   (plans/041). */
const orderProto = call(`
  (function () {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0];
    const plan = exList(day).map(function (e) { return e.id; });
    profile.order[block.id] = {};
    profile.order[block.id][slot(1, day.id)] = ['toString', plan[1], plan[0]];
    const drawn = orderedEx(profile, block, 1, day).map(function (e) { return e && typeof e === 'object' ? e.id : typeof e; });
    migrate();
    const kept = profile.order[block.id][slot(1, day.id)].join(',');
    return { drawn: drawn.join(','), kept: kept, want: plan[1] + ',' + plan[0], n: plan.length };
  })()
`);
ok('orderedEx never draws a prototype member as an exercise', !orderProto.drawn.split(',').includes('function') &&
   orderProto.drawn.split(',').length === orderProto.n, orderProto.drawn);
ok('...and migrate() drops the name from the recorded order, as it does from every exercise id',
   orderProto.kept === orderProto.want, orderProto.kept + ' vs ' + orderProto.want);

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

    /* The band left the render cache in plans/038 PR 6: it reads sessionsOf,
       so what it shows is the history cache's own set objects, the same ones
       across draws until something is logged. */
    resetRenderCache();
    const a = lastTime(profile, blockId, day.id, exId, 2);
    resetRenderCache();
    const b = lastTime(profile, blockId, day.id, exId, 2);
    const sameRef = a.sets[0] === b.sets[0];

    logChanged();
    const c = lastTime(profile, blockId, day.id, exId, 2);
    return { sameRef, differentAfterWrite: a.sets[0] !== c.sets[0] && c.sets[0].wLogged === '50' };
  })()
`;
const renderCacheResult = call(renderCacheProbe);
ok('lastTime reads the same cached sets on a second draw (resetRenderCache() in between)',
   renderCacheResult.sameRef);
ok('lastTime reads afresh once a write has emptied the history cache',
   renderCacheResult.differentAfterWrite);

/* plans/047: targetNow's and brakeCached's memos used to be keyed with no
   profile at all (target) or with no key at all (brake), so two profiles
   asking the same question — both default profiles share the id "block-1" —
   could read each other's answer. No resetRenderCache() here on purpose:
   the render cache is whatever the tests above already left it (non-null,
   the same way a real draw leaves it for drawCard), which is exactly the
   condition that used to leak one profile's answer into another's. */
const targetProfileIsolation = call(`
  (function () {
    state = defaultState(); migrate();
    const p1 = state.profiles.hombre, p2 = state.profiles.mujer;
    const blockId = p1.blockOrder[0];           /* 'block-1' for both profiles */
    const day1 = p1.blocks[blockId].days[0], day2 = p2.blocks[blockId].days[0];
    const exId = day1.ex[0].id;                 /* 'chestpress' on both */
    p1.log[blockId] = {};
    p1.log[blockId][slot(1, day1.id)] = { [exId]: [{ w: '40', r: '10', done: true, ts: Date.now() }] };
    p2.log[blockId] = {};
    p2.log[blockId][slot(1, day2.id)] = { [exId]: [{ w: '100', r: '10', done: true, ts: Date.now() }] };
    const t1 = targetNow(p1, p1.blocks[blockId], day1, day1.ex[0], 2);
    const t2 = targetNow(p2, p2.blocks[blockId], day2, day2.ex[0], 2);
    return { sameObject: t1 === t2, w1: t1 && t1.sets[0].w, w2: t2 && t2.sets[0].w };
  })()
`);
ok('targetNow keys its memo by profile: two profiles sharing block-1/day/exercise/week get their own answer',
   !targetProfileIsolation.sameObject && targetProfileIsolation.w1 != null &&
   targetProfileIsolation.w2 != null && targetProfileIsolation.w1 !== targetProfileIsolation.w2,
   JSON.stringify(targetProfileIsolation));

const brakeProfileIsolation = call(`
  (function () {
    state = defaultState(); migrate();
    const p1 = state.profiles.hombre, p2 = state.profiles.mujer;
    const b1 = p1.blocks[p1.blockOrder[0]], b2 = p2.blocks[p2.blockOrder[0]];
    /* Stubbed the way the brake-counting probe above stubs it: the value
       says which profile and week asked, so a stale slot answering for the
       wrong one is caught by the value itself rather than by a call count. */
    const real = brakeOn;
    brakeOn = function (profile, block, week) { return (profile === p1 ? 'p1-w' : 'p2-w') + week; };
    try {
      const r1 = brakeCached(p1, b1, 3, Date.now());
      const r2 = brakeCached(p2, b2, 5, Date.now());
      return { r1: r1, r2: r2 };
    } finally {
      brakeOn = real;
    }
  })()
`);
ok('brakeCached keys its memo by profile, block and week: a second profile/week does not read the first slot filled',
   brakeProfileIsolation.r1 === 'p1-w3' && brakeProfileIsolation.r2 === 'p2-w5',
   JSON.stringify(brakeProfileIsolation));

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

/* The order of a row's sessions is what the whole row is fitted through,
   and the deload is what must stay out of them, so both are pinned here
   rather than left to a rewrite: diagPoints' own walk once regrouped the
   log keys (plans/027), and since plans/056 the row reads the objetivo's
   sessions (liftHistory) and makes no choice of its own. */
const diagWeeks = call(`
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
    return {
      weeks: liftHistory(pr, block, day.ex[0], day.id, MAX_WEEKS + 1, blockId).sessions.map(s => s.week),
      sessions: diagRows(pr, block, 'block').find(r => r.id === exId).sessions,
    };
  })()
`);
ok('a Diagnóstico row reads the weeks in ascending order with the deload left out',
   JSON.stringify(diagWeeks.weeks) === '[1,2,4]' && diagWeeks.sessions === 3, JSON.stringify(diagWeeks));

/* The sheet's history entries include the week being trained
   (each row asks liftHistory for MAX_WEEKS + 1), and a tick does not redraw the
   day, so whatever cache the last draw left must not answer for them after
   one. Open the Diagnóstico, close it, tick, reopen. plans/027 pinned this
   through a resetRenderCache() at the top of diagRows; since plans/045 it is
   the tick's own save(), with the card's scope, that drops those entries,
   so the tick below goes through the same save() the card calls. Both
   halves of the assertion pin it since plans/056: `sessions` comes from the
   same cached history as `change`, where it used to come from a walk of
   its own that would have moved either way. */
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
    const before = diagRows(pr, block, 'block').find(r => r.id === exId);
    /* A tick on the week being trained, written the way the card writes it. */
    pr.log[blockId][slot(5, day.id)] = { [exId]: session('100', Date.now()) };
    save({ profile: pr, block: blockId, week: 5, day: day.id, lift: exId });
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

console.log('\n== the history fixture (plans/052) ==');
/* The one fixture builder for a training history: sessions in, a profile
   out. Everything below that used to hand-roll its own bare profile —
   the objetivo cases, the brake, the two-day split, the Diagnóstico, the
   session reader and the history cache — builds on this instead, so a
   fixture bug is one fix rather than six, and the shape of "a session"
   is written down once (plans/052).

   A block is { id, weeks, deload, phase, days: [{ id, ex: [{ id, n,
   sets, reps, … }] }] } — an exercise's other fields (inc, add, minRir)
   ride along unchanged, since the rule reads those straight off it. A
   session is { block, week, day, lift, sets, rir } where each set is
   [w, r] (ticked), [w, r, { …row fields }] — a per-set rir, a ts, a lb
   unit, anything a row can carry — or a raw row object, and `rir` is the
   legacy one-chip value, filed in the old parallel map. `profile` merges
   extra fields onto the profile itself once it is built (week, day, a
   label, the active block — whatever a case needs on file already);
   `install` also files it as state.profiles.hombre, the active one, for
   the cases that read it back through getProfile() rather than holding
   onto what this returns — which is also what would hand a spec-built
   history to bootApp's `state`, JSON-stringified, though nothing below
   needs to.

   Units are always spec.units || 'kg', and state is reset first — a
   profile of this call's own, not read back from whatever an earlier
   case left in state.prefs.units (plans/047). Defined in the app's own
   scope so every case below can call it. */
call(`
  function sessionFixture(spec) {
    state = defaultState(); migrate();
    state.prefs.units = spec.units || 'kg';
    const p = { blocks: {}, blockOrder: [], log: {}, rir: {}, obj: {}, variants: {} };
    (spec.blocks || []).forEach(b => {
      p.blocks[b.id] = { id: b.id, name: b.name || b.id, weeks: b.weeks || 8, deload: b.deload || 0,
                         phase: b.phase || {}, priority: [],
                         days: (b.days || []).map(d => ({ id: d.id, name: d.id,
                           ex: (d.ex || []).map(e => Object.assign(
                             { id: e.id, n: e.n || e.id, sets: e.sets || 3, reps: e.reps || '8-12' }, e)) })) };
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
    if (spec.profile) Object.assign(p, spec.profile);
    if (spec.install) { state.profiles.hombre = p; state.activeProfile = 'hombre'; }
    return p;
  }
`);

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
    let lastDay = 0;
    const sess = sessions.map(function (s, i) {
      const d = s.day != null ? s.day : i * 7;
      lastDay = d;
      return { block: 'B', week: i + 1, day: 'D', lift: 'E', rir: s.rir,
        sets: s.sets.map(function (p, k) {
          const fields = { ts: T0 + d * DAY };
          /* A third element is the unit the row was written in. The key is
             added only when there is one, because that is what the app writes:
             a row logged in the profile's own unit carries no u at all, and a
             literal u: undefined is a shape no restore ever produces. */
          if (p[2] === 'lb') fields.u = 'lb';
          if (s.rirs && s.rirs[k] != null) fields.rir = String(s.rirs[k]);
          return [p[0], p[1], fields];
        }) };
    });
    /* sessionFixture resets state and sets state.prefs.units itself
       (plans/047 and plans/052) — this profile never reads it any other
       way, so there is nothing to inherit from whichever earlier test
       last touched the setup sheet. */
    const profile = sessionFixture({ units: 'kg',
      blocks: [{ id: 'B', weeks: 16, deload: opts.deload || 0, phase: phase, days: [{ id: 'D', ex: [ex] }] }],
      sessions: sess });
    const block = profile.blocks.B, day = block.days[0], liveEx = day.ex[0];
    const now = T0 + (opts.now != null ? opts.now : lastDay + 7) * DAY;
    /* Calls targetFor directly, not targetNow, so this never touches
       renderCache at all — and the history cache below it needs no help
       either, because sessionFixture hands back a fresh profile every call
       and the history cache keys on profile identity (plans/045). */
    const t = targetFor(profile, block, day, liveEx, week, now, !!opts.brake);
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
    const sess = [];
    caps.forEach(function (C, i) {
      /* 10 reps at 1 RIR, so the set is neither past CENSOR_REPS nor at the
         top of the range: the weight is whatever makes the capacity C. */
      ex.forEach(function (e) {
        sess.push({ block: 'B', week: i + 1, day: 'D', lift: e.id, rir: '1',
                    sets: [[C * 30 / 41, 10, { ts: T0 + i * 3 * DAY }]] });
      });
    });
    const profile = sessionFixture({ units: 'kg',
      blocks: [{ id: 'B', weeks: 8, deload: 0, phase: phase, days: [{ id: 'D', ex: ex }] }],
      sessions: sess });
    /* Calls brakeOn directly, not brakeCached, so renderCache is never in
       the loop here. */
    return brakeOn(profile, profile.blocks.B, caps.length + 1, T0 + (caps.length * 3 + 2) * DAY);
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

/* A phase somebody wrote in their own words has no "RIR" in it, so the
   week cannot say what reserve it wants and the reserve the last session
   was left at stands in — which asks for no change rather than inventing
   one. `phaseRir` only reads a number immediately next to "RIR" (plans/058);
   any other digit in the prose, or no digit at all, reads the same: null. */
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

/* A phase label naming a week number and a rep scheme with no "RIR"
   beside it (plans/058 item 3) used to read as the lowest digit in the
   label — "Semana 6 · 10 reps" as 6 — and drive every card that week to
   the floor via moreRir/floor, silently. It now reads null, exactly like
   prose with no digit at all: same history, same sets, same reserve
   carried over from the last session.

   (The plan's other motivating example, "Descarga 60%", is not usable for
   this comparison: the word "Descarga" already marks the week a deload
   through DESCARGA_RE/deloadAt — plans/054, predating this plan — so
   targetFor takes the deload branch before weekRir/phaseRir are ever
   reached, whatever number follows. That path is unrelated to this fix;
   see the Maintenance notes.) */
t = target([
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 11], [40, 9]], rir: '2+' },
], { range: '6–15', inc: 2.5, sets: 2, phase: { r: 'Semana 6 · 10 reps' } });
ok('a week number and rep scheme with no "RIR" beside it falls back to the reserve the last session was left at, same as prose with no digits',
   t && t.rirWeek === 2, JSON.stringify(t));
const tPercent = t;
t = target([
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 10], [40, 9]], rir: '2+' },
  { sets: [[40, 11], [40, 9]], rir: '2+' },
], { range: '6–15', inc: 2.5, sets: 2, phase: { r: '2 RIR' } });
ok('...and prescribes exactly what the same history under an explicit "2 RIR" phase would, never a lower weight',
   tPercent && t && tPercent.show === t.show, JSON.stringify([tPercent, t]));

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
    const exSpec = { id: 'E', n: 'x', sets: 2, reps: '8–12', inc: 2.5 };
    const row = function (w, d) { return [w, 10, { ts: T0 + d * DAY }]; };
    const sessB = [
      { block: 'B', week: 1, day: 'D1', lift: 'E', sets: [row(40, 0)] },
      { block: 'B', week: 1, day: 'D2', lift: 'E', sets: [row(41, 3)] },
      { block: 'B', week: 2, day: 'D1', lift: 'E', sets: [row(42, 7)] },
      { block: 'B', week: 2, day: 'D2', lift: 'E', sets: [row(43, 10)] },
    ];
    const show = function (list) {
      return list.map(function (s) { return s.blockId + '/' + s.dayId + ':' + s.sets[0].w; }).join(' ');
    };

    const one = sessionFixture({ blocks: [{ id: 'B', weeks: 8, deload: 0, phase: {},
                                            days: [{ id: 'D1', ex: [exSpec] }, { id: 'D2', ex: [exSpec] }] }],
                                 sessions: sessB });
    const ex = one.blocks.B.days[0].ex[0];
    const d1 = show(exHistory(one, one.blocks.B, ex, 'D1', 3));
    const d2 = show(exHistory(one, one.blocks.B, ex, 'D2', 3));

    /* The block before this one had the lift on a single day, and that
       day's number means nothing here: whoever wrote that plan numbered
       its days for themselves. Matching on it would throw the history
       away rather than separate it. */
    const blockA = { id: 'A', weeks: 8, deload: 0, phase: {}, days: [{ id: 'DA', ex: [exSpec] }] };
    const blockB = { id: 'B', weeks: 8, deload: 0, phase: {},
                     days: [{ id: 'D1', ex: [exSpec] }, { id: 'D2', ex: [exSpec] }] };
    const two = sessionFixture({ blocks: [blockA, blockB],
      sessions: [{ block: 'A', week: 1, day: 'DA', lift: 'E', sets: [row(30, -30)] }].concat(sessB) });
    const exTwo = two.blocks.B.days[0].ex[0];
    const priorD1 = show(exHistory(two, two.blocks.B, exTwo, 'D1', 3));
    const priorD2 = show(exHistory(two, two.blocks.B, exTwo, 'D2', 3));
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
ok('a one-set exercise stays at one set on the deload week — the floor of two never exceeds the week\'s own count (plans/041)',
   call(`setsFor({ sets: 1 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 1 &&
   call(`setsFor({ sets: 2 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 2 &&
   call(`setsFor({ sets: 3 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 2,
   [1, 2, 3].map(n => call(`setsFor({ sets: ${n} }, 8, { deload: 8, weeks: 8, phase: {} })`)).join(','));

console.log('\n== deloadWeeks: the field union the phase text, one list every reader but the editor asks (plans/054) ==');
ok('deloadWeeks: the field alone',
   call(`deloadWeeks({ deload: 4, weeks: 8, phase: {} }).join(',')`) === '4');
ok('deloadWeeks: the phase text alone',
   call(`deloadWeeks({ deload: 0, weeks: 8, phase: { 3: { r: 'Descarga', t: '' } } }).join(',')`) === '3');
ok('deloadWeeks: the field and a phase-text week both landing on the same week is one week, not two',
   call(`deloadWeeks({ deload: 4, weeks: 8, phase: { 4: { r: 'Descarga', t: '' } } }).join(',')`) === '4');
ok('deloadWeeks: the field and an adjacent phase-text week are two consecutive weeks, both listed',
   call(`deloadWeeks({ deload: 4, weeks: 8, phase: { 5: { r: 'Descarga', t: '' } } }).join(',')`) === '4,5');
ok('deloadWeeks: "Semana de descarga" and "descarga activa" both count, sorted by week',
   call(`deloadWeeks({ deload: 0, weeks: 8, phase: { 5: { r: 'descarga activa' }, 2: { r: 'Semana de descarga' } } }).join(',')`) === '2,5');
ok('deloadWeeks: a week beyond the block\'s current length is left out, field or phase text',
   call(`deloadWeeks({ deload: 6, weeks: 4, phase: { 6: { r: 'Descarga' } } }).join(',')`) === '');

/* Decision 3: "sin"/"no" right before "descarga" (whitespace in between,
   case-insensitive) says there is no deload here, and must not flip the
   week into one — but nothing short of that literal phrase may. */
ok('deloadWeeks: "sin descarga" and "no descarga" do not count, whatever the case or the spacing',
   call(`deloadWeeks({ deload: 0, weeks: 8, phase: {
     2: { r: 'sin descarga' }, 3: { r: 'No Descarga' }, 4: { r: 'SIN   DESCARGA' }, 5: { r: 'Sin descarga, apretar' },
   } }).join(',')`) === '');
ok('...and the same two directions hold for deloadAt, which is deloadWeeks\' own membership test',
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 3: { r: 'Sin descarga, apretar' } } }, 3)`) === false &&
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 3: { r: 'Descarga activa' } } }, 3)`) === true);
ok('the default phase texts (js/data.js) still resolve "Descarga" as a deload week, unchanged by the negation rule',
   call(`deloadAt({ deload: 0, weeks: 8, phase: DEFAULT_PHASE_TU }, 8)`) === true &&
   call(`deloadAt({ deload: 0, weeks: 8, phase: DEFAULT_PHASE_PAREJA }, 8)`) === true &&
   call(`deloadWeeks({ deload: 0, weeks: 8, phase: DEFAULT_PHASE_TU }).join(',')`) === '8' &&
   call(`deloadWeeks({ deload: 0, weeks: 8, phase: DEFAULT_PHASE_PAREJA }).join(',')`) === '8');

/* deloadSpans is the grouping deloadCheck and drawDeloadCheck share —
   tested directly so a failure below points at the grouping or at the
   before/after arithmetic, not at both at once. */
ok('deloadSpans groups consecutive deload weeks into one span; a week on its own is its own span',
   call(`JSON.stringify(deloadSpans({ deload: 4, weeks: 10, phase: { 5: { r: 'Descarga' }, 8: { r: 'Descarga' } } }))`) ===
   '[{"start":4,"end":5},{"start":8,"end":8}]');
ok('deloadSpans on a block with no deload at all is empty',
   call(`JSON.stringify(deloadSpans({ deload: 0, weeks: 8, phase: {} }))`) === '[]');

console.log('\n== plans/054 decision 5, visible change 1: a phase-text deload reads as a deload everywhere the field did ==');
ok('deloadAt: a phase-text-only deload (no field) is a deload on its own week and nowhere else — what feeds the DL chip and the banner',
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 5: { r: 'Descarga' } } }, 5)`) === true &&
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 5: { r: 'Descarga' } } }, 4)`) === false &&
   call(`deloadAt({ deload: 0, weeks: 8, phase: { 5: { r: 'Descarga' } } }, 6)`) === false);
ok('setsFor halves a phase-text-only deload week the same as a field one',
   call(`setsFor({ sets: 4 }, 5, { deload: 0, weeks: 8, phase: { 5: { r: 'Descarga' } } })`) === 2);
ok('volumeWeeksInPlay excludes a phase-text deload too, not only the field',
   call(`volumeWeeksInPlay('plan', { deload: 0, weeks: 5, phase: { 3: { r: 'Descarga' } } }, [10, 10, 10, 10, 10]).join(',')`) === '0,1,3,4');

console.log('\n== plans/054 decision 5, visible change 2: "sin descarga" no longer halves sets ==');
ok('setsFor does not halve a week whose goal says "sin descarga"',
   call(`setsFor({ sets: 4 }, 3, { deload: 0, weeks: 8, phase: { 3: { r: 'Sin descarga, apretar' } } })`) === 4);
ok('...nor does volumeWeeksInPlay exclude it from the typical',
   call(`volumeWeeksInPlay('plan', { deload: 0, weeks: 3, phase: { 2: { r: 'Sin descarga' } } }, [10, 10, 10]).join(',')`) === '0,1,2');

/* volumeTotals('log', …) moved onto sessionsOf (plans/057), one query per
   exercise the plan still shows — so unlike blockTonnageByWeek, a retired
   exercise's sets stay out of it, the same as the 'plan' side right next to
   it in the toggle. */
console.log('\n== volumeTotals(\'log\', …) reads sessionsOf: exactly the week\'s ticked sets, and a retired exercise still does not count (plans/057) ==');
const volumeTotalsProbe = call(`
  (function() {
    const block = {
      id: 'vt', weeks: 2,
      days: [{ id: 'd0', ex: [{ id: 'live', muscle: 'Pecho', sets: 3 }, { id: 'dead', muscle: 'Pecho', sets: 3, off: 1 }] }],
    };
    const profile = { blocks: { vt: block }, log: { vt: {
      'w1-d0': { live: [{ done: true, w: '60', r: '8' }, { done: true, w: '60', r: '8' }, { w: '60', r: '8' }],
                 dead: [{ done: true, w: '99', r: '1' }] },
    } } };
    return volumeTotals('log', profile, block, 1, 'muscle');
  })()
`);
ok('volumeTotals(\'log\') counts exactly the week\'s ticked sets of a still-planned exercise, not a retired one\'s',
   volumeTotalsProbe.Pecho === 2, JSON.stringify(volumeTotalsProbe));

/* landingNote moved onto sessionsOf too (plans/057), same dayList/exList
   scope as volumeTotals just above — smoke already covers the message
   itself (test/smoke.js, "landing on an untrained week"), so this pins the
   one thing that check cannot see: a retired exercise's earlier sets must
   not excuse a week the still-planned exercise has nothing in. */
console.log('\n== landingNote reads sessionsOf: a retired exercise\'s old sets are not the history the note points at (plans/057) ==');
const landingNoteProbe = call(`
  (function() {
    const block = {
      id: 'ln', weeks: 3,
      days: [{ id: 'd0', ex: [{ id: 'live', sets: 3 }, { id: 'dead', sets: 3, off: 1 }] }],
    };
    const profile = {
      week: 2, activeBlock: 'ln', blocks: { ln: block },
      log: { ln: { 'w1-d0': { dead: [{ w: '60', r: '8', done: true }] } } },
    };
    return landingNote(profile);
  })()
`);
ok('a retired exercise\'s earlier sets do not count as history for a live exercise with nothing logged',
   landingNoteProbe === '', landingNoteProbe);

console.log('\n== decision 1 (plans/054): deloadWeek is read nowhere but app.js\'s own deloadWeeks and the editor\'s field ==');
{
  /* The scanner on a case it exists to tell apart, so it cannot pass the
     real check below by never having looked: a mention inside a comment or
     a string is not a read, a local of the same name shadowing the global
     is not scanned for by this narrow check (unlike rule 1/2's
     guardedReads above, which decision 1 does not ask for), and two real
     calls are counted as two. */
  const fixture = codeOnly("/* deloadWeek(x) mentioned here */ const s = 'deloadWeek(nope)'; deloadWeek(1); if (x) deloadWeek(2);");
  const seen = (fixture.match(/\bdeloadWeek\s*\(/g) || []).length;
  ok('the deloadWeek( scanner ignores a comment and a string, and counts two real calls',
     seen === 2, seen + ': ' + JSON.stringify(fixture));
}
/* deloadWeek(block) stays only as: app.js's own deloadWeeks (which folds
   the field into the union), and the editor's field accessor —
   renderDeloadOptions and peWeeks.oninput, both in js/block-editor.js. Any
   other read is one of the seven that plans/054 moved onto deloadWeeks or
   deloadAt, or a new one just like them. */
/* In SHELL_SCRIPTS order (block-editor.js before app.js), so the two
   JSON.stringify calls below agree on key order too. */
const DELOAD_WEEK_ALLOWED = { 'js/block-editor.js': 2, 'js/app.js': 1 };
const deloadWeekReads = {};
SHELL_SCRIPTS.forEach(f => {
  const n = (codeOnly(shellSrc[f]).match(/\bdeloadWeek\s*\(/g) || []).length;
  if (n) deloadWeekReads[f] = n;
});
ok('deloadWeek( is called only in app.js\'s own deloadWeeks and the editor\'s two field reads — nowhere else in js/',
   JSON.stringify(deloadWeekReads) === JSON.stringify(DELOAD_WEEK_ALLOWED),
   JSON.stringify(deloadWeekReads));

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
    const before = exHistory(p, block, ex, 'D', 4).length;
    p.variants.E = [{ n: 'viejo', since: '1970-01-01' }, { n: 'nuevo', since: '2026-01-15' }];
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
   writes it is the RIR box in the set row since plans/036, and it writes
   through writeRows (plans/048): what each writeRows below is handed is
   that box's own write, which is all the box does to the log. `est` is
   null because the record is the next case's business, not this one's. */
const untouchedDay = call(`
  (function () {
    state = defaultState(); migrate();
    const p = state.profiles.hombre;
    const block = p.blocks['block-1'];
    const day = block.days[0];
    p.log['block-1'] = {};
    /* Exactly what opening a day does: pad the rows out, tick nothing. */
    const rows = entry(p, 'block-1', 1, day.id, 'chestpress', 3);
    const card = { profile: p, block: block, day: day, rows: rows, est: null,
                   ex: day.ex.filter(function (e) { return e.id === 'chestpress'; })[0],
                   here: { profile: p, block: 'block-1', week: 1, day: day.id, lift: 'chestpress' } };
    writeRows(card, function () {
      rows[2].rir = '1';
      dropLegacyRir(p, 'block-1', 1, day.id, 'chestpress');
    });
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
    writeRows(card, function () {
      live[0].rir = '0';
      dropLegacyRir(p, 'block-1', 1, day.id, 'chestpress');
    });
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
   because rowUsed counts one. Through writeRows, as the RIR box writes,
   with the objetivo the card would show. */
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
    const rows = entry(p, 'block-1', 4, day.id, ex.id, 3);
    const est = targetNow(p, block, day, ex, 4);
    const wasSession = rows.some(rowUsed);
    writeRows({ profile: p, block: block, day: day, ex: ex, rows: rows, est: est,
                here: { profile: p, block: 'block-1', week: 4, day: day.id, lift: ex.id } }, function () {
      rows[0].rir = '1';
      dropLegacyRir(p, 'block-1', 4, day.id, ex.id);
    });
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

const decayFirst = call(`decayLine([{ w: '60', r: '', done: true }, { w: '60', r: '12', done: true, rir: '3' },
                                    { w: '60', r: '9', done: true }, { w: '60', r: '8', done: true }])`);
ok('the decay line quotes the RIR of the set the drop was measured FROM — the first set with reps, not row 0 (plans/041)',
   decayFirst.includes('RIR 3') && call(`repDecay([{ r: '' }, { r: '12' }, { r: '9' }, { r: '8' }])`) === 4, decayFirst);

/* The Diagnóstico's three effort signals, read end to end through diagRows:
   three flat sessions of one exercise, and the verdict the signals pick. */
const diagProbe = call(`
  (function (sessions, useMap) {
    const DAY = 86400000, start = Date.now() - 28 * DAY;
    /* A flat '2 RIR' every week, same as brakeProbe above: the weight
       never moves and every logged rep count sits inside the 8-12 range,
       so which reserve the week nominally asks for cannot tip est.dir to
       'down' and steal the verdict from the signal each case is pinning. */
    const phase = {}; for (let i = 1; i <= sessions.length + 4; i++) phase[i] = { r: '2 RIR' };
    const sess = sessions.map(function (rows, i) {
      const last = rows[rows.length - 1][1];
      return { block: 'block-1', week: i + 1, day: 'd0', lift: 'e0',
        rir: (useMap && last != null) ? String(last) : undefined,
        sets: rows.map(function (x) {
          const fields = { ts: start + i * 7 * DAY };
          if (!useMap && x[1] != null) fields.rir = String(x[1]);
          return [40, x[0], fields];
        }) };
    });
    const p = sessionFixture({
      blocks: [{ id: 'block-1', phase: phase, days: [{ id: 'd0', ex: [{ id: 'e0', sets: 3, reps: '8-12' }] }] }],
      sessions: sess, profile: { week: sessions.length + 1, day: 0 } });
    const block = p.blocks['block-1'];
    const row = diagRows(p, block, 'block').find(function (r) { return r.id === 'e0'; });
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

/* Per set, reduced by the median — the session's typical reserve
   (plans/044). A log typed the old way, one value on the last set, still
   reads through the inheritance rule as it always did (the two legacy-chip
   cases above pin that); these pin what the per-set record can say that
   one number could not. */
/* Reps held at the top of the range on purpose: a set at the bottom of the
   range at 0 RIR can make the objetivo come down a rung, and the "Peso mal
   elegido" row is checked before either signal — these cases are about
   the signals, not the rule. */
const pacedSess = () => [[12, '3'], [12, '1'], [12, '0']];
ok('a session paced 3 → 1 → 0 is not fatigue: its typical set had a rep in reserve',
   diagProbe(three(pacedSess()), false) ===
     'flat | Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
   diagProbe(three(pacedSess()), false));
const groundSess = () => [[12, '0'], [11, '0'], [11, '0']];
ok('...a session ground out at 0 on every set still is',
   diagProbe(three(groundSess()), false) === 'flat | Fatiga, no falta de esfuerzo',
   diagProbe(three(groundSess()), false));
const heldSess = () => [[12, '3'], [12, '3'], [11, '0']];
ok('...and a session held back on most sets reads as lacking intensity whatever the last set did',
   diagProbe(three(heldSess()), false) === 'flat | Falta intensidad — RIR 2+ repetido',
   diagProbe(three(heldSess()), false));
const dsr = a => call('diagSessionRir(' + JSON.stringify(a) + ')');
ok('diagSessionRir is the median of the typed sets, null when none is typed',
   dsr([3, 2, 1, 0]) === 1.5 && dsr([3, 3, 3, 0]) === 3 && dsr([0, 0, 1]) === 0 &&
   dsr([null, null]) === null && dsr([]) === null,
   [dsr([3, 2, 1, 0]), dsr([3, 3, 3, 0]), dsr([0, 0, 1]), dsr([null, null]), dsr([])].join(','));

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

/* A slot key is slot(week, dayId), so notes and energy carry a day id just
   as the log does. normalizeImportedBlock renames a day id safeKey refuses,
   one it has already used, and one past 60 characters; the notes and energy
   used to be copied across under the old key, which no day answers to any
   more, so that day's note and energy were gone after the restore. */
const renamedDayProbe = call(`
  (function() {
    const long = 'd'.repeat(70);
    const block = { name: 'B', weeks: 8, deload: 0, days: [
      { id: '__proto__', name: 'A', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] },
      { id: long, name: 'B', ex: [{ id: 'e1', n: 'Ex', sets: 3, reps: '10-15' }] },
    ] };
    const p = JSON.parse(JSON.stringify({
      blocks: { b1: block }, blockOrder: ['b1'], activeBlock: 'b1',
      notes: { b1: { 'w2-__proto__': 'rodilla', ['w3-' + long]: 'dormí poco', ['w99-' + long]: 'fuera', 'nope': 'x' } },
      energy: { b1: { 'w2-__proto__': 'baja', ['w3-' + long]: 'alta', ['w0-' + long]: 'alta' } },
    }));
    const after = normalizeImportedProfile(p);
    const days = after.blocks.b1.days;
    const notes = after.notes.b1 || {}, energy = after.energy.b1 || {};
    return {
      renamed: days[0].id !== '__proto__' && days[1].id !== long,
      note0: notes[slot(2, days[0].id)] === 'rodilla',
      note1: notes[slot(3, days[1].id)] === 'dormí poco',
      energy0: energy[slot(2, days[0].id)] === 'baja',
      energy1: energy[slot(3, days[1].id)] === 'alta',
      noteKeys: Object.keys(notes), energyKeys: Object.keys(energy),
    };
  })()
`);
ok('a restored day whose id was renamed keeps its session note', renamedDayProbe.renamed && renamedDayProbe.note0 && renamedDayProbe.note1, JSON.stringify(renamedDayProbe));
ok('...and its energy', renamedDayProbe.renamed && renamedDayProbe.energy0 && renamedDayProbe.energy1, JSON.stringify(renamedDayProbe));
ok('...and a key that is no slot, or a week outside 1..MAX_WEEKS, is dropped rather than carried',
   renamedDayProbe.noteKeys.length === 2 && renamedDayProbe.energyKeys.length === 2, JSON.stringify(renamedDayProbe));

console.log('\n== moveExerciseRecord merges rather than overwrites (plans/008 items 1, 3) ==');
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
    moveExerciseRecord(profile, 'B', 'd1', 'd0', 'e1');
    const mergedRows = profile.log.B['w1-d0'].e1;
    const sourceLogGone = !profile.log.B['w1-d1'] || !profile.log.B['w1-d1'].e1;
    const rirKeptTheDestinations = profile.rir.B['w1-d0'].e1 === '1';
    const orderRemoved = profile.order.B['w1-d1'].indexOf('e1') < 0;
    const orderAdded = profile.order.B['w1-d0'].indexOf('e1') >= 0;

    /* Calling it again must be a no-op, not a second overwrite — the
       source has nothing left under this id after the first move. */
    moveExerciseRecord(profile, 'B', 'd1', 'd0', 'e1');
    const stillBothRows = profile.log.B['w1-d0'].e1.length === 2;

    return { mergedRows: JSON.stringify(mergedRows), sourceLogGone, rirKeptTheDestinations, orderRemoved, orderAdded, stillBothRows };
  })()
`);
ok('moveExerciseRecord concatenates the destination day\'s own rows with the moved ones, in order',
   JSON.parse(moveProbe.mergedRows).length === 2 &&
   JSON.parse(moveProbe.mergedRows)[0].w === '50' && JSON.parse(moveProbe.mergedRows)[1].w === '60',
   moveProbe.mergedRows);
ok('...and empties the source rather than leaving a stale copy', moveProbe.sourceLogGone, JSON.stringify(moveProbe));
ok('...never overwrites an RIR chip the destination already has',
   moveProbe.rirKeptTheDestinations, JSON.stringify(moveProbe));
ok('...drops the id from the source day\'s recorded order', moveProbe.orderRemoved, JSON.stringify(moveProbe));
ok('...and appends it to the destination\'s', moveProbe.orderAdded, JSON.stringify(moveProbe));
ok('calling moveExerciseRecord again after the move destroys nothing (idempotent once the source is empty)',
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
    moveExerciseRecord(p, 'B', 'D', 'D2', 'E');
    return {
      moved: p.obj.B['w2-D2'] && p.obj.B['w2-D2'].E ? p.obj.B['w2-D2'].E.conf : null,
      sourceGone: !p.obj.B['w2-D'] || p.obj.B['w2-D'].E === undefined,
      destinationKept: p.obj.B['w3-D2'].E.conf,
      sourceGoneWeek3: !p.obj.B['w3-D'] || p.obj.B['w3-D'].E === undefined,
    };
  })()
`);
ok('moveExerciseRecord files the objetivo record under the destination day and empties the source',
   moveObjProbe.moved === 'alta' && moveObjProbe.sourceGone, JSON.stringify(moveObjProbe));
ok('...and never overwrites a record the destination day already has',
   moveObjProbe.destinationKept === 'media' && moveObjProbe.sourceGoneWeek3, JSON.stringify(moveObjProbe));

/* `obj` is the second map keyed by exercise under the slot, and it was added
   after both sweeps were written: "borrar registro" used to leave the
   objetivo record standing over rows that no longer exist (plans/025). */
ok('purging one lift drops the objetivo record with the rows and the chip', call(`
  (function () {
    const p = { log: { B: { 'w2-D': { E: [{ w: '40', r: '10', done: true }] } } },
                rir: { B: { 'w2-D': { E: '1' } } }, obj: { B: { 'w2-D': { E: { v: 3, sets: [] } } } } };
    purgeRecord(p, 'B', { day: 'D', exercise: 'E' });
    return !p.log.B['w2-D'] || p.log.B['w2-D'].E === undefined ? (p.obj.B['w2-D'] === undefined || p.obj.B['w2-D'].E === undefined) : false;
  })()
`) === true);

console.log('\n== plan editor "Guardar cambios": same exercise id on two days is not confused (plans/008 item 1) ==');
/* "Editar plan" and "Guardar cambios" themselves, pressed on a booted app,
   and the log read back from what save() wrote. This used to copy
   peSave's catch-up loop and run the copy, which could only ever test the
   copy (plans/052). The bug it guards against only shows up with the SAME
   exercise id on two different days, which migrate() allows on purpose,
   and it happened on a save that changed nothing. The profile stands on
   week 2 so that neither session under test is the one on screen: the draw
   pads that one out to the plan's three sets. */
const peSaveBoot = bootApp({ state: {
  activeProfile: 'hombre',
  profiles: { hombre: {
    label: 'Hombre', activeBlock: 'B', blockOrder: ['B'], week: 2, day: 0,
    blocks: { B: {
      id: 'B', name: 'Block', weeks: 8, deload: 0,
      days: [
        { id: 'd0', name: 'Day A', ex: [{ id: 'e1', n: 'Chest', sets: 3, reps: '10-15' }] },
        { id: 'd1', name: 'Day B', ex: [{ id: 'e1', n: 'Chest', sets: 3, reps: '10-15' }] },
      ],
    } },
    log: { B: {
      'w1-d0': { e1: [{ w: '50', r: '10', done: true }] },
      'w1-d1': { e1: [{ w: '60', r: '8', done: true }] },
    } },
  } },
} });
/* Both rows staying where they are is also what a save that never ran
   looks like, so the first assertion is that it did: the handler clears
   the draft "Editar plan" opened only on its way out, after the block is
   written back and committed. Not awaited — with nothing in the draft to
   complain about it runs to its end before it hands back its promise — and
   a throw is read off the draft rather than left to take the suite down.
   load()'s own write-back is let land first, so what storage holds after
   is what "Guardar cambios" wrote. */
peSaveBoot.clock.advance(1000);
let peSaveRan = '';
try {
  peSaveBoot.$('editPlan').onclick();
  peSaveRan = peSaveBoot.call('peDraft') ? 'the draft is still open' : '"Editar plan" opened no draft';
  peSaveBoot.$('peSave').onclick().catch(() => {});
  if (peSaveBoot.call('peDraft === null && !askResolve')) peSaveRan = '';
  peSaveBoot.clock.advance(1000);
} catch (e) { peSaveRan = e.message; }
const peSaveProbe = (peSaveBoot.saved() || { profiles: { hombre: { log: {} } } }).profiles.hombre.log.B || {};
ok('"Guardar cambios" ran to its end on the real button: the draft it opened is closed', !peSaveRan,
   peSaveRan + (peSaveBoot.call('askResolve') ? ' — asked: ' + peSaveBoot.$('askBody').textContent : ''));
ok('an unmodified save leaves day A\'s rows alone',
   peSaveProbe['w1-d0'] && peSaveProbe['w1-d0'].e1 && peSaveProbe['w1-d0'].e1.length === 1 && peSaveProbe['w1-d0'].e1[0].w === '50',
   JSON.stringify(peSaveProbe));
ok('...and day B\'s — the id-only map used to erase one of them',
   peSaveProbe['w1-d1'] && peSaveProbe['w1-d1'].e1 && peSaveProbe['w1-d1'].e1.length === 1 && peSaveProbe['w1-d1'].e1[0].w === '60',
   JSON.stringify(peSaveProbe));

/* plans/053. "Borrar registro" used to file the erasure under the day the
   item sat on in the draft, while the dialog in front of it counted the
   sets where they actually sit: under the day the exercise started on,
   until the save moves them. After an "Enviar a…" the two are different
   days, and the save purged the one where nothing was. These drive the
   draft the way the editor does (openPlanDraft is "Editar plan",
   moveExToDay is "Enviar a…", eraseFromDraft is a confirmed "Borrar
   registro") and read the dialog's count from the functions the dialog
   calls, so "what was promised" and "what went" are measured the same way. */
console.log('\n== the plan draft: saving erases exactly what "Borrar registro" counted (plans/053) ==');
{
  const tryCall = expr => { try { return call(expr); } catch (e) { return { threw: String(e && e.message || e) }; } };
  /* Three days, every part of the record filed on two of them. `sameId`
     puts the id e1 on days A and B, which migrate() allows on purpose. An
     unused row pads x's second week: purged with its lift, never counted. */
  const FIXTURE = `
    const done = w => ({ w: String(w), r: '10', done: true });
    const lift = (id, n) => ({ id: id, n: n, sets: 2, reps: '8-10', rest: 90 });
    const fixture = sameId => {
      const a = sameId ? 'e1' : 'x', b = sameId ? 'e1' : 'y';
      const block = { id: 'B', name: 'Bloque', weeks: 4, deload: 0, phase: {}, days: [
        { id: 'dA', name: 'A', ex: [lift(a, 'Press'), lift('w', 'Remo')] },
        { id: 'dB', name: 'B', ex: [lift(b, sameId ? 'Press' : 'Curl'), lift('v', 'Fondos')] },
        { id: 'dC', name: 'C', ex: [lift('z', 'Sentadilla'), lift('u', 'Zancada')] },
      ] };
      const obj = w => ({ v: 3, at: 1, conf: 'media', sets: [{ w: w, r: 10, m: '' }] });
      return {
        label: 'Yo', blocks: { B: block }, blockOrder: ['B'], activeBlock: 'B', week: 1, day: 0,
        log: { B: {
          'w1-dA': { [a]: [done(50)], w: [done(30)] },
          'w2-dA': { [a]: [done(52), { w: '', r: '', done: false }] },
          'w1-dB': { [b]: [done(60), done(62)], v: [done(20)] },
          'w1-dC': { z: [done(80)], u: [done(40)] },
        } },
        rir: { B: { 'w1-dA': { [a]: '1' }, 'w1-dB': { [b]: '2+' } } },
        obj: { B: { 'w1-dA': { [a]: obj(50) }, 'w1-dB': { [b]: obj(60) } } },
        order: { B: { 'w1-dA': ['w', a], 'w1-dB': ['v', b] } },
        notes: { B: { 'w1-dA': 'A, semana 1', 'w1-dB': 'B, semana 1' } },
        energy: { B: { 'w1-dA': 'normal', 'w1-dB': 'alta' } },
        variants: {},
      };
    };
    /* Every part of the block's record filed by slot, one line per value:
       "part day exId slot value" ("-" for a part about the whole session). */
    const flat = p => {
      const out = [];
      RECORD_PARTS.forEach(part => {
        if (part.keyedBy === 'exercise') return;
        forEachSlot(p[part.name], 'B', (key, w, day, v) => {
          if (part.keyedBy === 'slot') { out.push([part.name, day, '-', key, JSON.stringify(v)].join(' ')); return; }
          Object.keys(v || {}).forEach(id => out.push([part.name, day, id, key, JSON.stringify(v[id])].join(' ')));
        });
      });
      return out.sort();
    };
    const field = (line, i) => line.split(' ')[i];
    /* What the confirm dialog says, read the way the "Retirados" row reads it. */
    const dialogCount = (p, draft, it) => {
      peDraft = draft;
      try { return it.ex ? draftExLogged(p, it.ex, it.day.id) : draftDayLogged(p, it.day); } finally { peDraft = null; }
    };
  `;

  const bug1 = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(false);
    const before = flat(p), setsBefore = blockLoggedSets(p, 'B');
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB] = draft.block.days, x = dA.ex[0];
    moveExToDay(x, dA, dB);
    x.off = 1;
    const counted = dialogCount(p, draft, { day: dB, ex: x });
    eraseFromDraft(draft, { day: dB, ex: x });
    applyPlanDraft(p, draft);
    const after = flat(p);
    return {
      counted: counted, erased: setsBefore - blockLoggedSets(p, 'B'),
      left: after.filter(l => field(l, 2) === 'x'),
      untouched: JSON.stringify(after) === JSON.stringify(before.filter(l => field(l, 2) !== 'x')),
    };
  })()`);
  ok('bug 1: an exercise sent to another day and then erased leaves no set anywhere in the record, erases what the dialog counted and touches nothing else',
     !bug1.threw && bug1.left.length === 0 && bug1.untouched && bug1.counted === 2 && bug1.erased === 2, JSON.stringify(bug1));

  const bug2 = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(false);
    const before = flat(p), setsBefore = blockLoggedSets(p, 'B');
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB] = draft.block.days;
    moveExToDay(dA.ex[0], dA, dB);
    dB.off = 1;
    const counted = dialogCount(p, draft, { day: dB });
    eraseFromDraft(draft, { day: dB });
    applyPlanDraft(p, draft);
    const after = flat(p);
    return {
      counted: counted, erased: setsBefore - blockLoggedSets(p, 'B'),
      left: after.filter(l => field(l, 2) === 'x' || field(l, 1) === 'dB'),
      untouched: JSON.stringify(after) === JSON.stringify(before.filter(l => field(l, 2) !== 'x' && field(l, 1) !== 'dB')),
    };
  })()`);
  ok('bug 2: erasing a day that received an exercise takes that exercise\'s sets and the day\'s own slots, what the dialog counted, and nothing else',
     !bug2.threw && bug2.left.length === 0 && bug2.untouched && bug2.counted === 5 && bug2.erased === 5, JSON.stringify(bug2));

  /* The other way round, and the reason an erased day's own slots are
     cleared only after the moves: y leaves day B for A, then B is erased.
     The dialog counts what B still holds; y's sets go to A with it. */
  const leftFirst = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(false);
    const setsBefore = blockLoggedSets(p, 'B');
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB] = draft.block.days;
    moveExToDay(dB.ex[0], dB, dA);
    dB.off = 1;
    const counted = dialogCount(p, draft, { day: dB });
    eraseFromDraft(draft, { day: dB });
    applyPlanDraft(p, draft);
    const rows = [];
    forEachSlot(p.log, 'B', (k, w, d, s) => Object.keys(s || {}).forEach(id => (s[id] || []).forEach(r => { if (rowUsed(r)) rows.push(d + ':' + id + ':' + r.w); })));
    return {
      counted: counted, erased: setsBefore - blockLoggedSets(p, 'B'), rows: rows.sort(),
      chip: ((p.rir.B || {})['w1-dA'] || {}).y || null, dayB: flat(p).filter(l => field(l, 1) === 'dB'),
    };
  })()`);
  ok('an exercise sent away from a day that is then erased keeps its sets, on the day it went to: only what the day still held goes',
     !leftFirst.threw && leftFirst.counted === 1 && leftFirst.erased === 1 && leftFirst.chip === '2+' && leftFirst.dayB.length === 0 &&
     JSON.stringify(leftFirst.rows) === JSON.stringify(['dA:w:30', 'dA:x:50', 'dA:x:52', 'dA:y:60', 'dA:y:62', 'dC:u:40', 'dC:z:80']),
     JSON.stringify(leftFirst));

  /* Decision 3's edge: the same id on days A and B, and B's copy erased.
     Whichever way the other copy's record is caught up — not at all, moved
     to a third day, or moved onto the very day being purged — A's copy
     keeps both its sets, on the day it ends up on, and only B's two go. */
  [
    ['nothing moved', '', 'dA'],
    ['A\'s copy sent to a third day', 'moveExToDay(ea, dA, dC);', 'dC'],
    ['A\'s copy sent onto B', 'moveExToDay(ea, dA, dB);', 'dB'],
    ['B\'s copy sent to a third day before it was erased', 'moveExToDay(eb, dB, dC); at = dC;', 'dA'],
  ].forEach(([how, moves, lands]) => {
    const r = tryCall(`(function () {
      ${FIXTURE}
      const p = fixture(true);
      const setsBefore = blockLoggedSets(p, 'B');
      const draft = openPlanDraft(p, p.blocks.B);
      const [dA, dB, dC] = draft.block.days, ea = dA.ex[0], eb = dB.ex[0];
      let at = dB;
      ${moves}
      eb.off = 1;
      const counted = dialogCount(p, draft, { day: at, ex: eb });
      eraseFromDraft(draft, { day: at, ex: eb });
      applyPlanDraft(p, draft);
      const rows = [];
      forEachSlot(p.log, 'B', (k, w, d, s) => ((s && s.e1) || []).forEach(r => { if (rowUsed(r)) rows.push(d + ':' + r.w); }));
      const landed = p.blocks.B.days.find(d => d.id === '${lands}');
      return {
        counted: counted, erased: setsBefore - blockLoggedSets(p, 'B'), rows: rows.sort(),
        kept: !!landed && landed.ex.some(e => e.id === 'e1' && !e.off),
      };
    })()`);
    ok('the same id on two days, ' + how + ': erasing B\'s copy leaves A\'s copy and its sets intact',
       !r.threw && r.kept && JSON.stringify(r.rows) === JSON.stringify([lands + ':50', lands + ':52']) &&
       r.counted === 2 && r.erased === 2, JSON.stringify(r));
  });

  /* The same edge reached through a day: A's copy goes to C, C is erased,
     and B's copy has meanwhile been sent onto A — the very day C's erasure
     reaches back to for A's copy's sets. B's copy keeps its two. */
  const heldBack = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(true);
    const setsBefore = blockLoggedSets(p, 'B');
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB, dC] = draft.block.days, ea = dA.ex[0], eb = dB.ex[0];
    moveExToDay(ea, dA, dC);
    moveExToDay(eb, dB, dA);
    dC.off = 1;
    const counted = dialogCount(p, draft, { day: dC });
    eraseFromDraft(draft, { day: dC });
    applyPlanDraft(p, draft);
    const rows = [];
    forEachSlot(p.log, 'B', (k, w, d, s) => ((s && s.e1) || []).forEach(r => { if (rowUsed(r)) rows.push(d + ':' + r.w); }));
    return {
      counted: counted, erased: setsBefore - blockLoggedSets(p, 'B'), rows: rows.sort(),
      kept: p.blocks.B.days.find(d => d.id === 'dA').ex.some(e => e === eb && !e.off),
    };
  })()`);
  ok('the same id on two days, a day erased while holding A\'s copy after B\'s copy was sent onto A: B\'s copy keeps its sets',
     !heldBack.threw && heldBack.kept && JSON.stringify(heldBack.rows) === JSON.stringify(['dA:60', 'dA:62']) &&
     heldBack.counted === 4 && heldBack.erased === 4, JSON.stringify(heldBack));

  /* The copies moved round, nothing erased: A's copy to C, then B's onto
     A. The save lifts every moving copy's record onto a day of its own
     before it puts any down, so B's does not land in A's sessions on A and
     leave with them (plans/053's second follow-up). The days it lifts
     through are ones nothing is filed under: the record here already holds
     a session of e1 under each day spareDayIds would have handed out, and
     those stay as they were. */
  const crowded = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(true);
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB, dC] = draft.block.days;
    moveExToDay(dA.ex[0], dA, dC);
    moveExToDay(dB.ex[0], dB, dA);
    const taken = spareDayIds(p, draft, 2);
    taken.forEach((d, i) => { p.log.B[slot(3, d)] = { e1: [done(90 + i)] }; });
    applyPlanDraft(p, draft);
    const rows = [];
    forEachSlot(p.log, 'B', (k, w, d, s) => ((s && s.e1) || []).forEach(r => {
      if (rowUsed(r)) rows.push(w + ':' + (taken.indexOf(d) >= 0 ? 'taken' + taken.indexOf(d) : d) + ':' + r.w);
    }));
    const at = (part, d) => ((p[part].B || {})[slot(1, d)] || {}).e1;
    return { rows: rows.sort(), chips: [at('rir', 'dA'), at('rir', 'dC')], records: [at('obj', 'dA'), at('obj', 'dC')].map(r => r && r.sets[0].w) };
  })()`);
  ok('the same id on two days, A\'s copy sent to C and then B\'s onto A: each copy\'s sets, chip and objetivo record land where it went, and sessions filed under the days the save would lift them through stay put',
     !crowded.threw && JSON.stringify(crowded.rows) === JSON.stringify(['1:dA:60', '1:dA:62', '1:dC:50', '2:dC:52', '3:taken0:90', '3:taken1:91']) &&
     JSON.stringify(crowded.chips) === JSON.stringify(['2+', '1']) && JSON.stringify(crowded.records) === JSON.stringify([60, 50]),
     JSON.stringify(crowded));

  /* Nor is a spare day ever a day of the draft, even one nothing is filed
     under: a record lifted onto a day that a copy of the same lift is then
     put down on takes that copy along when it is put down itself. D here
     has nothing logged and the name spareDayIds would hand out second,
     and it comes before C. A's copy goes to D and B's to C, so B's would
     wait on D, A's be merged into it there, and both go on to C, A's chip
     and objetivo record dropped. One copy sent to D would not show it: a
     record lifted onto the day it is going to is put down from that day
     onto itself, which is no move. */
  const namedLikeSpare = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(true);
    const spare = spareDayIds(p, openPlanDraft(p, p.blocks.B), 2)[1];
    p.blocks.B.days.splice(2, 0, { id: spare, name: 'D', ex: [lift('k', 'Curl')] });
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB, dD, dC] = draft.block.days;
    moveExToDay(dA.ex[0], dA, dD);
    moveExToDay(dB.ex[0], dB, dC);
    applyPlanDraft(p, draft);
    const rows = [];
    forEachSlot(p.log, 'B', (k, w, d, s) => ((s && s.e1) || []).forEach(r => { if (rowUsed(r)) rows.push(w + ':' + (d === spare ? 'D' : d) + ':' + r.w); }));
    const at = (part, d) => ((p[part].B || {})[slot(1, d)] || {}).e1;
    return { rows: rows.sort(), chips: [at('rir', spare), at('rir', 'dC')], records: [at('obj', spare), at('obj', 'dC')].map(r => r && r.sets[0].w) };
  })()`);
  ok('...and a copy sent to a day with nothing logged, named the way a spare day would have been, keeps its sets, chip and objetivo record there, and the other copy keeps its own',
     !namedLikeSpare.threw && JSON.stringify(namedLikeSpare.rows) === JSON.stringify(['1:D:50', '1:dC:60', '1:dC:62', '2:D:52']) &&
     JSON.stringify(namedLikeSpare.chips) === JSON.stringify(['1', '2+']) && JSON.stringify(namedLikeSpare.records) === JSON.stringify([50, 60]),
     JSON.stringify(namedLikeSpare));

  /* The point of lifting everything first: the same moves file the record
     the same way whichever order the plan lists the days in. A's copy to
     C and B's onto A, as above, and two lifts crossing between B and C.
     Moved one at a time in the plan's order, B's copy reached A before
     A's had left when A came first, and after it when the days were the
     other way round. */
  const anyOrder = tryCall(`(function () {
    ${FIXTURE}
    const save = reversed => {
      const p = fixture(true);
      if (reversed) p.blocks.B.days.reverse();
      const draft = openPlanDraft(p, p.blocks.B);
      const [dA, dB, dC] = ['dA', 'dB', 'dC'].map(id => draft.block.days.find(d => d.id === id));
      const [eb, v] = dB.ex, [z] = dC.ex;
      moveExToDay(dA.ex[0], dA, dC);
      moveExToDay(eb, dB, dA);
      moveExToDay(v, dB, dC);
      moveExToDay(z, dC, dB);
      applyPlanDraft(p, draft);
      return flat(p);
    };
    const listed = save(false), reversed = save(true);
    /* e1's sessions as "slot: the weights of its used rows". */
    const e1 = listed.filter(l => field(l, 0) === 'log' && field(l, 2) === 'e1')
      .map(l => field(l, 3) + ': ' + JSON.parse(l.split(' ').slice(4).join(' ')).filter(rowUsed).map(r => r.w).join(' '));
    return { same: JSON.stringify(listed) === JSON.stringify(reversed), e1: e1,
             differ: listed.filter(l => reversed.indexOf(l) < 0).concat(reversed.filter(l => listed.indexOf(l) < 0)) };
  })()`);
  ok('the same moves file the record the same way whichever order the plan lists the days in, each copy\'s sets on the day it went to',
     !anyOrder.threw && anyOrder.same && JSON.stringify(anyOrder.e1) === JSON.stringify(['w1-dA: 60 62', 'w1-dC: 50', 'w2-dC: 52']),
     JSON.stringify(anyOrder));

  /* Bug 3. Another tab's write is adopted by replacing the profile objects
     (the 'storage' handler in js/app.js), and a draft cut from the old one
     used to be saved straight over it. */
  const bug3 = tryCall(`(function () {
    ${FIXTURE}
    const p = fixture(false);
    const draft = openPlanDraft(p, p.blocks.B);
    const [dA, dB] = draft.block.days;
    dA.ex[0].n = 'Press inclinado';
    moveExToDay(dA.ex[0], dA, dB);
    const y = dB.ex[0];
    y.off = 1;
    eraseFromDraft(draft, { day: dB, ex: y });
    const adopted = JSON.parse(JSON.stringify(p));
    adopted.log.B['w3-dA'] = { w: [done(35)] };
    const was = JSON.stringify(adopted), mine = JSON.stringify(p);
    const result = applyPlanDraft(adopted, draft);
    return { result: result, adopted: JSON.stringify(adopted) === was, original: JSON.stringify(p) === mine };
  })()`);
  ok('bug 3: a draft cut from a profile another tab has since replaced is refused, and nothing changes',
     !bug3.threw && bug3.result === null && bug3.adopted && bug3.original, JSON.stringify(bug3));
}

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
    /* The row's two readings of it: the level the trend is fitted on, and
       the kilos per set of the work axis. */
    const hist = liftHistory(profile, block, day.ex[0], day.id, MAX_WEEKS + 1, blockId);
    const out = hist.rule.map(s => Math.round(s.sets[0].w * 100) / 100)
      .concat(diagPoints(hist.sessions).map(p => Math.round(p.vol / p.sets * 100) / 100));
    state.prefs.units = 'kg';
    return out;
  })()
`);
ok('the Diagnóstico converts a lb-stamped week back to kg instead of reading 220 kg on the trend line',
   JSON.stringify(diagUnitProbe) === JSON.stringify([100, 100, 500, 500]), JSON.stringify(diagUnitProbe));
ok('setVolume, the session view\'s own reading, is untouched — still blends the lb number in as if it were kg',
   Math.round(call(`setVolume({ w: '220.462262185', r: '5', done: true, u: 'lb' })`)) === Math.round(220.462262185 * 5));
/* blockTonnageByWeek lost its raw mode along with the walk that used to
   feed it stored rows (plans/057): it always converts now, the one mode an
   app caller ever asked for (decision 4) — asked for exactly that way. */
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
    const byWeek = blockTonnageByWeek(profile, block);
    state.prefs.units = 'kg';
    return byWeek.slice(0, 2);
  })()
`);
ok('blockTonnageByWeek converts that same week to kg instead — both weeks read as the 500 kg actually lifted',
   Math.abs(reviewUnitProbe[0] - 500) < 1e-6 && Math.abs(reviewUnitProbe[1] - 500) < 1e-6,
   JSON.stringify(reviewUnitProbe));
ok('convertedSetVolume reads a single lb-stamped set as the kilos it really moved',
   Math.abs(call(`(function(){ state.prefs.units = 'kg'; return convertedSetVolume({ w: '220.462262185', r: '5', done: true, u: 'lb' }); })()`) - 500) < 1e-6);

/* sessionVolume sums a session's own sets (readSession) rather than a
   slot's stored rows, so the walks that move onto sessionsOf (plans/057)
   need it to be convertedSetVolume term for term — proven here over random
   rows rather than trusted from the one arithmetic reading above, since a
   session's `w` and its drops are already a separate conversion
   (rowWeight/convertWeight) that could in principle drift from
   convertedSetVolume's own. */
console.log('\n== sessionVolume matches convertedSetVolume over the same rows, term for term (plans/057) ==');
const sessionVolumeProbe = call(`
  (function() {
    const rnd = (lo, hi) => Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
    /* Mostly a real number, sometimes empty (nothing typed), sometimes
       garbage (num() reads either as NaN) — the same three shapes a stored
       weight or rep count actually comes in. */
    const field = () => {
      const r = Math.random();
      return r < 0.15 ? '' : r < 0.25 ? 'nope' : String(rnd(1, 200));
    };
    let maxDiff = 0;
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(Math.random() * 4);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const row = { done: Math.random() < 0.9, w: field(), r: field() };
        if (Math.random() < 0.5) row.u = 'lb';
        const dropN = Math.floor(Math.random() * 3);
        if (dropN) row.d = Array.from({ length: dropN }, () => ({ w: field(), r: field() }));
        rows.push(row);
      }
      /* profile/block/day are stand-ins readSession never reads for volume:
         only the RIR fallback and the extra-set flag touch them, and
         sessionVolume reads neither. */
      const sess = readSession({ rir: {} }, { id: 'b' }, 1, 'd', 'e', rows, undefined);
      const viaSession = sess ? sessionVolume(sess.sets) : 0;
      const viaRows = rows.reduce((t, r) => t + convertedSetVolume(r), 0);
      maxDiff = Math.max(maxDiff, Math.abs(viaSession - viaRows));
    }
    return maxDiff;
  })()
`);
ok('sessionVolume matches convertedSetVolume over 200 random trials, drops/lb/empty/NaN included',
   sessionVolumeProbe < 1e-6, String(sessionVolumeProbe));

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
    const points = collectHistory(profile, blockId, day.id, exId, 'weight');
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

/* A set carries one unit stamp for itself and its drops, and every write
   used to put the unit on screen on the whole row: 100 kg logged, the
   preference switched to lb, only a drop typed — and the set read as 100 lb
   from then on. stampForWrite converts the rest of the row into the unit it
   is stamping instead. The handlers are closures in buildExCard, so the
   rule is pinned here as the function they all call. `typeof` first so the
   probe reports a missing rule as a failure rather than taking the suite
   down with a ReferenceError. */
console.log('\n== a write in the other unit converts the set rather than relabelling it ==');
const stampProbe = call(`
  (function() {
    if (typeof stampForWrite !== 'function') return { missing: true };
    const prev = state.prefs.units;
    /* A drop typed after a switch to lb, over a 100 kg set. */
    const a = { w: '100', r: '5', done: true, d: [{ w: '', r: '' }] };
    state.prefs.units = 'lb';
    a.d[0].w = '150';
    const movedA = stampForWrite(a, a.d[0]);
    /* The reverse: the set's weight typed in kg over drops written in lb. */
    const b = { w: '', r: '', done: false, u: 'lb', d: [{ w: '110', r: '8' }, { w: '', r: '' }] };
    state.prefs.units = 'kg';
    b.w = '60';
    const movedB = stampForWrite(b, b);
    /* Same unit: nothing is touched, and as typed stays as typed. */
    const c = { w: '22.5', r: '', d: [{ w: '20', r: '' }] };
    const movedC = stampForWrite(c, c);
    state.prefs.units = prev;
    return {
      a: { w: a.w, u: a.u, d: a.d[0].w, moved: movedA, kg: Math.round(rowWeight(a, 'kg') * 100) / 100 },
      b: { w: b.w, u: b.u === undefined ? 'kg' : b.u, d: b.d.map(x => x.w), moved: movedB, used: b.d.map(dropUsed) },
      c: { w: c.w, d: c.d[0].w, u: c.u === undefined ? 'kg' : c.u, moved: movedC },
    };
  })()
`);
ok('a drop typed in lb over a 100 kg set converts the set to 220,46 lb instead of calling it 100 lb',
   !stampProbe.missing && stampProbe.a.w === '220,46' && stampProbe.a.u === 'lb' && stampProbe.a.d === '150' &&
   stampProbe.a.moved === true && stampProbe.a.kg === 100, JSON.stringify(stampProbe));
ok('the set typed in kg over lb drops converts the drops, and an empty drop stays empty for rowUsed/pruneLog',
   !stampProbe.missing && stampProbe.b.w === '60' && stampProbe.b.u === 'kg' && stampProbe.b.moved === true &&
   JSON.stringify(stampProbe.b.d) === JSON.stringify(['49,9', '']) &&
   JSON.stringify(stampProbe.b.used) === JSON.stringify([true, false]), JSON.stringify(stampProbe));
ok('a write in the row’s own unit rewrites nothing',
   !stampProbe.missing && stampProbe.c.w === '22.5' && stampProbe.c.d === '20' && stampProbe.c.u === 'kg' &&
   stampProbe.c.moved === false, JSON.stringify(stampProbe));

/* The greyed weight a tick adopts. priorWeight handed back last week's
   string as typed, the card showed it under the current unit's heading,
   and the tick stamped it with that unit: 100 kg last week became 100 lb. */
const priorProbe = call(`
  (function() {
    const prev = state.prefs.units;
    const profile = defaultState().profiles.hombre;
    const blockId = profile.blockOrder[0];
    const day = profile.blocks[blockId].days[0];
    const exId = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [exId]: [{ w: '100', r: '5', done: true }, { w: '22,5', r: '5', done: true, u: 'lb' }] };
    state.prefs.units = 'lb';
    const inLb = [priorWeight(profile, blockId, 2, day.id, exId, 0), priorWeight(profile, blockId, 2, day.id, exId, 1)];
    state.prefs.units = 'kg';
    const inKg = [priorWeight(profile, blockId, 2, day.id, exId, 0), priorWeight(profile, blockId, 2, day.id, exId, 1)];
    state.prefs.units = prev;
    return { inLb: inLb, inKg: inKg };
  })()
`);
ok('last week’s 100 kg is offered as 220,46 after a switch to lb, so a tick adopts the real weight',
   priorProbe.inLb[0] === '220,46', JSON.stringify(priorProbe));
ok('...a weight already in the unit on screen is offered exactly as typed',
   priorProbe.inLb[1] === '22,5' && priorProbe.inKg[0] === '100', JSON.stringify(priorProbe));
ok('...and it converts the other way too (22,5 lb read in kg)',
   priorProbe.inKg[1] === '10,21', JSON.stringify(priorProbe));

console.log('\n== one way to write a set, and what a card decides, outside the card (plans/048) ==');
/* writeRows is the order every write to a set follows, and the card's
   handlers are closures over it, so it is pinned here as the function
   they all call: fixture rows, a hand-built objetivo, and save() watched
   rather than run, because which claim comes first is half the contract —
   the record's 'view' claim is only true once the slot's has been made.
   `typeof` first in every probe below, as in the stamp probe above, so a
   missing function fails its cases instead of taking the suite down. */
const writeProbe = call(`
  (function () {
    if (typeof writeRows !== 'function') return { missing: true };
    const p = { week: 2, obj: {} };
    const block = { id: 'B' }, day = { id: 'D' }, ex = { id: 'E' };
    const est = { kind: 'objetivo', conf: 'alta', hold: false, brake: false, rirWeek: 2,
                  sets: [{ w: 40, r: 10, move: '' }, { w: 42.5, r: 9, move: '\\u2191' }] };
    const card = (rows, week) => ({ profile: p, block: block, day: day, ex: ex, rows: rows, est: est,
                                    here: { profile: p, block: 'B', week: week, day: 'D', lift: 'E' } });
    const rec = w => (p.obj.B && p.obj.B[slot(w, 'D')] && p.obj.B[slot(w, 'D')].E) || null;
    const realSave = save, claims = [];
    save = function (s) { claims.push(s === 'view' ? 'view' : s && s.lift === 'E' ? 'slot' : 'all'); };
    try {
      const out = {};
      /* Week 2 as a draw leaves it, padded and empty; a box typed into and
         emptied again. */
      const rows = [{ w: '', r: '', done: false }, { w: '', r: '', done: false }];
      out.emptied = { started: writeRows(card(rows, 2), () => { rows[1].w = ''; }), rec: !!rec(2), claims: claims.splice(0) };
      out.first = { started: writeRows(card(rows, 2), () => { rows[0].w = '40'; }), claims: claims.splice(0) };
      out.first.rec = rec(2) && rec(2).sets.map(x => x.w).join('/');
      /* The record taken away, so a second write that wrote it again would
         show. Guarded: with no record kept above there is none to take. */
      if (rec(2)) delete p.obj.B[slot(2, 'D')].E;
      out.second = { started: writeRows(card(rows, 2), () => { rows[0].r = '10'; }), rec: !!rec(2), claims: claims.splice(0) };
      /* A week logged before there were records, browsed to and corrected:
         a record written here would be the draw-time write back by another
         route, stamped with today's clock. */
      p.week = 1;
      const old = [{ w: '38', r: '10', done: true }, { w: '38', r: '9', done: true }];
      out.browsed = { started: writeRows(card(old, 1), () => { old[1].r = '10'; }), rec: !!rec(1), claims: claims.splice(0) };
      p.week = 3;
      const fresh = [{ w: '', r: '', done: false }];
      out.rir = { started: writeRows(card(fresh, 3), () => { fresh[0].rir = '2'; }), rec: !!rec(3), claims: claims.splice(0) };
      return out;
    } finally { save = realSave; }
  })()
`);
ok('writeRows: a write that leaves every set empty starts nothing and keeps no record',
   !writeProbe.missing && writeProbe.emptied.started === false && writeProbe.emptied.rec === false &&
   writeProbe.emptied.claims.join() === 'slot', JSON.stringify(writeProbe));
ok('...the first value starts the session and keeps the objetivo on screen, the slot saved before the record',
   !writeProbe.missing && writeProbe.first.started === true && writeProbe.first.rec === '40/42.5' &&
   writeProbe.first.claims.join() === 'slot,view', JSON.stringify(writeProbe));
ok('...a second value is the same session: no start, and the record is not written again',
   !writeProbe.missing && writeProbe.second.started === false && writeProbe.second.rec === false &&
   writeProbe.second.claims.join() === 'slot', JSON.stringify(writeProbe));
ok('...a week logged before, browsed to and corrected, is no start and gets no record',
   !writeProbe.missing && writeProbe.browsed.started === false && writeProbe.browsed.rec === false &&
   writeProbe.browsed.claims.join() === 'slot', JSON.stringify(writeProbe));
ok('...and a reserve typed first starts the session like any other value',
   !writeProbe.missing && writeProbe.rir.started === true && writeProbe.rir.rec === true &&
   writeProbe.rir.claims.join() === 'slot,view', JSON.stringify(writeProbe));

/* The tick's contract, which lived only in the smoke suite while it was a
   closure: an empty weight box takes the greyed weight, the RIR box never
   takes its placeholder (plans/035 Step H.4), and the weight taken is a
   write in the unit on screen, so the rest of the set is converted rather
   than relabelled (stampForWrite). */
const tickProbe = call(`
  (function () {
    if (typeof tickRow !== 'function') return { missing: true };
    const prev = state.prefs.units;
    const now = 1726000000000;
    const copy = r => JSON.parse(JSON.stringify(r));
    state.prefs.units = 'kg';
    const a = { w: '', r: '', done: false };
    const adoptedA = tickRow(a, '47,25', now);
    const tickedA = copy(a);
    const unticked = tickRow(a, '47,25', now + 60000);
    const b = { w: '50', r: '8', done: false, rir: '1' };
    const adoptedB = tickRow(b, '47,25', now);
    const e = { w: '', r: '10', done: false };
    const adoptedE = tickRow(e, '', now);
    state.prefs.units = 'lb';
    const c = { w: '', r: '', done: false, d: [{ w: '100', r: '5' }] };
    const adoptedC = tickRow(c, '220', now);
    state.prefs.units = prev;
    return { adoptedA: adoptedA, tickedA: tickedA, unticked: unticked, untickedA: copy(a),
             adoptedB: adoptedB, b: b, adoptedE: adoptedE, e: e, adoptedC: adoptedC, c: c };
  })()
`);
ok('tickRow: an empty weight box takes the greyed weight, marks the set done at the tick\'s time, and says what it took',
   !tickProbe.missing && tickProbe.adoptedA === '47,25' &&
   JSON.stringify(tickProbe.tickedA) === '{"w":"47,25","r":"","done":true,"ts":1726000000000}', JSON.stringify(tickProbe));
ok('...and never the RIR: a blank reserve stays blank, a typed one stays as it was',
   !tickProbe.missing && !('rir' in tickProbe.tickedA) && tickProbe.b.rir === '1', JSON.stringify(tickProbe));
ok('...a weight already typed is kept, and with no hint there is nothing to take',
   !tickProbe.missing && tickProbe.adoptedB === '' && tickProbe.b.w === '50' && tickProbe.b.done === true &&
   tickProbe.adoptedE === '' && tickProbe.e.w === '' && tickProbe.e.done === true, JSON.stringify(tickProbe));
ok('...unticking keeps the weight and the time the set was done at',
   !tickProbe.missing && tickProbe.unticked === '' && tickProbe.untickedA.done === false &&
   tickProbe.untickedA.w === '47,25' && tickProbe.untickedA.ts === 1726000000000, JSON.stringify(tickProbe));
ok('...and a weight taken after a switch to lb converts the set\'s kg drop instead of relabelling it',
   !tickProbe.missing && tickProbe.adoptedC === '220' && tickProbe.c.w === '220' && tickProbe.c.u === 'lb' &&
   tickProbe.c.d[0].w === '220,46', JSON.stringify(tickProbe));

/* Which hint each set gets and what it says it came from, the set to do
   next, and the rest timer's line: one answer that the boxes and
   "Siguiente" both read. Three sets, the first already ticked. */
const hintProbe = call(`
  (function () {
    if (typeof setHints !== 'function') return { missing: true };
    const prev = state.prefs.units;
    state.prefs.units = 'kg';
    const rows = [{ w: '', r: '', done: true }, { w: '', r: '', done: false }, { w: '', r: '', done: false }];
    /* The objetivo prices two of the three sets, and asks no reps of the second. */
    const est = { sets: [{ w: 47.25, r: 10, move: '' }, { w: 45, r: null, move: '' }] };
    const prior = { block: { name: 'Bloque 1' }, week: 7, sets: [{ wLogged: '100', unit: 'lb' }] };
    const out = {
      est: setHints(rows, est, ['50', '', '52,5'], prior, '8–12'),
      own: setHints(rows, null, ['50', '', ''], prior, '8–12'),
      none: setHints(rows, null, ['', '', ''], null, ''),
    };
    state.prefs.units = prev;
    return out;
  })()
`);
const hintOf = s => s && s.placeholder ? [s.hint, s.from, s.placeholder.w, s.placeholder.r].join(' | ') : JSON.stringify(s);
ok('setHints: the objetivo wins, with its own reps, and the rep box falls back to the plan\'s range without them',
   !hintProbe.missing &&
   hintOf(hintProbe.est.sets[0]) === '47,25 | lo que pide el objetivo de esta semana | 47,25 | 10' &&
   hintOf(hintProbe.est.sets[1]) === '45 | lo que pide el objetivo de esta semana | 45 | 8–12',
   JSON.stringify(hintProbe));
ok('...then your own last week, for a set the objetivo did not price or with no objetivo at all',
   !hintProbe.missing &&
   hintOf(hintProbe.est.sets[2]) === '52,5 | lo de la semana anterior | 52,5 | 8–12' &&
   hintOf(hintProbe.own.sets[0]) === '50 | lo de la semana anterior | 50 | 8–12', JSON.stringify(hintProbe));
ok('...then the block before, in the unit on screen, named with its week, its last set for a set it did not have',
   !hintProbe.missing &&
   hintOf(hintProbe.own.sets[1]) === '45,36 | lo de "Bloque 1", semana 7 | 45,36 | 8–12' &&
   hintOf(hintProbe.own.sets[2]) === hintOf(hintProbe.own.sets[1]), JSON.stringify(hintProbe));
ok('...and with none of the three, both boxes say — and a tick has nothing to take',
   !hintProbe.missing && hintProbe.none.sets.every(s => hintOf(s) === ' |  | — | —'), JSON.stringify(hintProbe));
ok('"Siguiente" prices the next set with what its box shows, and the last set says it was the last',
   !hintProbe.missing &&
   hintProbe.est.next.join(' / ') === 'Siguiente: serie 2 · 45 kg × 8–12 / Siguiente: serie 3 · 52,5 kg × 8–12 / Última serie hecha' &&
   hintProbe.own.next[0] === 'Siguiente: serie 2 · 45,36 kg × 8–12' &&
   hintProbe.none.next.join(' / ') === 'Siguiente: serie 2 / Siguiente: serie 3 / Última serie hecha',
   JSON.stringify(hintProbe));
ok('the set to do next is the first not ticked, and it is marked only against an objetivo',
   !hintProbe.missing && hintProbe.est.nextAt === 1 && hintProbe.own.nextAt === -1 && hintProbe.none.nextAt === -1,
   JSON.stringify(hintProbe));

/* The two badges of each set, against the bar from before this session:
   heaviest weight, best estimated 1RM. 'P' is the weight record, 'E' the
   1RM one. */
const flagProbe = call(`
  (function () {
    if (typeof recordFlags !== 'function') return { missing: true };
    const set = (w, r, done) => ({ w: w, r: r, done: done });
    const read = fl => fl.map(f => (f.pr ? 'P' : '.') + (f.prE ? 'E' : '.')).join(' ');
    return {
      bar: read(recordFlags({ w: 60, e: est1RM(60, 10) }, [
        set('72,5', '10', true),  /* heavier, and a better estimate as well */
        set('60', '12', true),    /* the same weight for more reps */
        set('60', '10', true),    /* the bar exactly, on both counts */
        set('55', '16', true),    /* a better "estimate" past EST_MAX_REPS */
        set('70', '5', false),    /* not ticked */
        set('', '10', true),      /* no weight */
      ])),
      first: read(recordFlags(undefined, [set('40', '10', true), set('x', '10', true)])),
      noEstimate: read(recordFlags({ w: 60, e: null }, [set('60', '12', true)])),
    };
  })()
`);
ok('recordFlags: a heavier ticked set is a record, and its weight badge wins over the 1RM one',
   !flagProbe.missing && flagProbe.bar.split(' ')[0] === 'P.', JSON.stringify(flagProbe));
ok('...the same weight for more reps is a new estimated 1RM',
   !flagProbe.missing && flagProbe.bar.split(' ')[1] === '.E', JSON.stringify(flagProbe));
ok('...matching the bar beats it on neither count, and nor does a set past EST_MAX_REPS, an unticked one or one with no weight',
   !flagProbe.missing && flagProbe.bar === 'P. .E .. .. .. ..', JSON.stringify(flagProbe));
ok('...and the first weighed set of a lift is a record but never a 1RM one: there is no estimate to beat',
   !flagProbe.missing && flagProbe.first === 'P. ..' && flagProbe.noEstimate === '..', JSON.stringify(flagProbe));

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

console.log('\n== bestForExercise: the record bar, one exercise at a time (plans/008 item 14, plans/038 PR 6) ==');
/* Every card asks for its own exercise's all-time best (the whole-profile
   scan it used to be checked against went in plans/038 PR 6), and it has to
   leave out exactly the session being drawn, or a set would beat itself and
   every card would claim a record. */
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
    const one = bestForExercise(profile, a, blockId, here);
    const noSkip = bestForExercise(profile, a, blockId, 'w9-dz');
    const highRep = bestForExercise(profile, c, blockId, here);
    return {
      skipped: one[a].w,
      skippedE: one[a].e,
      unskipped: noSkip[a].w,
      unskippedE: noSkip[a].e,
      highRepOnly: highRep[c] && { w: highRep[c].w, e: highRep[c].e },
      onlyOneKey: Object.keys(one).length,
      missingIsAbsent: (a + '|' + (a in bestForExercise(profile, 'nosuchexercise', blockId, here))),
    };
  })()
`;
const bestResult = call(bestProbe);
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

/* The bar is two questions split at the week being drawn (plans/038 PR 6):
   the history before it survives a tick in the history cache, bar and all,
   and the rest of the block is read again — so a tick in the drawn session
   still cannot beat itself, and a later session of the block still counts. */
const bestSplit = call(`
  (function() {
    const profile = defaultState().profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const blockId = block.id, day = block.days[0], a = day.ex[0].id;
    profile.log[blockId] = {};
    profile.log[blockId][slot(1, day.id)] = { [a]: [{ done: true, w: '60', r: '8' }] };
    const here = slot(2, day.id);
    const at = w => ({ profile: profile, block: blockId, week: w, day: day.id, lift: a });
    const headBar = () => historyDerived(sessionsOf(profile, { weeks: 'logged', lift: { id: a }, before: { block: blockId, week: 2 } })).get('best');
    const bar0 = bestForExercise(profile, a, blockId, here)[a].w;
    const kept = headBar();
    profile.log[blockId][here] = { [a]: [{ done: true, w: '90', r: '8' }] };
    logChanged(at(2));
    const bar1 = bestForExercise(profile, a, blockId, here)[a].w;
    const keptAfterTick = headBar() === kept;
    profile.log[blockId][slot(3, day.id)] = { [a]: [{ done: true, w: '70', r: '8' }] };
    logChanged(at(3));
    const bar2 = bestForExercise(profile, a, blockId, here)[a].w;
    profile.log[blockId][slot(blockWeeks(block) + 2, day.id)] = { [a]: [{ done: true, w: '75', r: '8' }] };
    logChanged();
    const bar3 = bestForExercise(profile, a, blockId, here)[a].w;
    return { bar0, bar1, keptAfterTick, bar2, bar3 };
  })()
`);
ok('a tick in the drawn session neither beats the bar nor drops the history before that week',
   bestSplit.bar0 === 60 && bestSplit.bar1 === 60 && bestSplit.keptAfterTick, JSON.stringify(bestSplit));
ok('a later session of the same block raises the bar, and so does a stranded week',
   bestSplit.bar2 === 70 && bestSplit.bar3 === 75, JSON.stringify(bestSplit));

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
    drawnSlot = null;   /* left set, this makes every later pruneLog probe quieter than it should be (plans/042) */
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

console.log('\n== sessionOnScreen: the key drawApp compares draw to draw (plans/049) ==');
/* The pure helper behind "the draw notices" (plans/049 decision 2): drawApp
   calls stopRest() when this key differs from the one it got last time.
   Probed directly against a bare state rather than through a draw, the way
   the pruneLog probes above use defaultState() rather than the DOM. */
const sessionKeyProbe = `
  (function() {
    state = defaultState();
    migrate();  /* assigns day ids ('d0', 'd1', …) — a fresh block has none */
    const profile = state.profiles[state.activeProfile];
    const blockId = profile.activeBlock;
    const base = sessionOnScreen(state);
    const sameAgain = sessionOnScreen(state) === base;

    profile.week = 2;
    const afterWeek = sessionOnScreen(state);
    profile.week = 1;

    profile.day = 1;
    const afterDay = sessionOnScreen(state);
    profile.day = 0;

    /* A second block with the same days: only its id is meant to matter. */
    profile.blocks['block-2'] = { id: 'block-2', days: profile.blocks[blockId].days };
    profile.activeBlock = 'block-2';
    const afterBlock = sessionOnScreen(state);
    profile.activeBlock = blockId;
    delete profile.blocks['block-2'];

    state.activeProfile = 'mujer';
    const afterProfile = sessionOnScreen(state);
    state.activeProfile = 'hombre';

    const backToBase = sessionOnScreen(state);

    return { base, sameAgain, afterWeek, afterDay, afterBlock, afterProfile, backToBase };
  })()
`;
const sk = call(sessionKeyProbe);
ok('a redraw of the same session returns the same key', sk.sameAgain, JSON.stringify(sk));
ok('the week changing changes the key', sk.afterWeek !== sk.base, JSON.stringify(sk));
ok('the day changing changes the key', sk.afterDay !== sk.base, JSON.stringify(sk));
ok('the active block changing changes the key', sk.afterBlock !== sk.base, JSON.stringify(sk));
ok('the active profile changing changes the key', sk.afterProfile !== sk.base, JSON.stringify(sk));
ok('going back to the same session returns the original key', sk.backToBase === sk.base, JSON.stringify(sk));

console.log('\n== the footer names the next session, and a block ends at its own last week ==');
/* The last day of an eight-week block used to say "Siguiente: …, semana
   9": the wrap to the next week never asked how many weeks the block had.
   Probed against a bare state like sessionOnScreen above, and shortened to
   five weeks so a hard-coded 8 could not pass for blockWeeks. */
const nextProbe = call(`
  (function () {
    if (typeof nextSessionLine !== 'function') return { missing: true };
    const saved = state;
    state = defaultState();
    migrate();
    const profile = state.profiles[state.activeProfile];
    const block = profile.blocks[profile.activeBlock];
    block.weeks = 5;
    const days = dayList(block);
    const last = days.length - 1;
    const at = (w, d) => { profile.week = w; profile.day = d; return nextSessionLine(profile, block, days); };
    const out = { names: days.map(d => d.name), weeks: blockWeeks(block) };
    out.midWeek = at(2, 0);
    out.lastDay = at(4, last);
    out.lastWeek = at(5, last);
    out.lastWeekMidDay = at(5, 0);

    /* A block after this one, the way "+ Nuevo bloque" leaves it: pushed
       onto blockOrder. Its first live day is named, a retired one is not. */
    const next = JSON.parse(JSON.stringify(block));
    next.id = 'block-next';
    next.name = 'Bloque 2';
    next.days[0].off = true;
    profile.blocks[next.id] = next;
    profile.blockOrder.push(next.id);
    out.nextFirst = dayList(next)[0].name;
    out.intoNext = at(5, last);
    out.beforeEnd = at(4, last);
    /* The block being trained is the later one: nothing comes after it. */
    profile.activeBlock = next.id;
    profile.week = 5;
    profile.day = dayList(next).length - 1;
    out.fromNewest = nextSessionLine(profile, next, dayList(next));
    state = saved;
    return out;
  })()
`);
if (nextProbe.missing) ok('nextSessionLine exists', false);
else {
  const n = nextProbe.names;
  ok('mid-week, the next day of the same week', nextProbe.midWeek === 'Siguiente: ' + n[1] + '.', nextProbe.midWeek);
  ok('the last day of a week wraps to the first day of the next',
     nextProbe.lastDay === 'Siguiente: ' + n[0] + ', semana 5.', nextProbe.lastDay);
  ok('the last day of the last week names no week past the block',
     !/semana 6/.test(nextProbe.lastWeek) && nextProbe.lastWeek === 'Fin del bloque: crea el siguiente con "+ Nuevo bloque", en Plan.',
     nextProbe.lastWeek);
  ok('the last week still moves day to day before its last day',
     nextProbe.lastWeekMidDay === 'Siguiente: ' + n[1] + '.', nextProbe.lastWeekMidDay);
  ok('with a later block in blockOrder, its first live day, week 1',
     nextProbe.intoNext === 'Fin del bloque. Siguiente: ' + nextProbe.nextFirst + ', semana 1 de "Bloque 2".', nextProbe.intoNext);
  ok('a later block does not change a week that is not the last',
     nextProbe.beforeEnd === 'Siguiente: ' + n[0] + ', semana 5.', nextProbe.beforeEnd);
  ok('the newest block ends with "+ Nuevo bloque", not a wrap to an older one',
     /^Fin del bloque: crea el siguiente/.test(nextProbe.fromNewest), nextProbe.fromNewest);
}

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
  let linksChecked = 0;
  docs.forEach(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const links = [...src.matchAll(/\]\(([^)\s]+)\)/g)].map(x => x[1]).filter(l => !/^(https?:|mailto:)/.test(l));
    linksChecked += links.length;
    links.forEach(link => {
      const [rel, anchor] = link.split('#');
      const target = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
      const exists = fs.existsSync(path.join(ROOT, target));
      ok(file + ' → ' + link + ' exists', exists);
      if (exists && anchor && /\.md$/.test(target)) ok(file + ' → #' + anchor + ' is a heading', headings(target).includes(anchor), headings(target).join(' | '));
    });
  });
  /* A floor under the loop above: if the link regex stops matching, it runs
     zero times and this section is green having checked nothing. One
     assertion for the four docs rather than one each, because AGENTS.md
     names files in backticks and carries no markdown link at all, so a
     per-file floor cannot hold there (plans/042). */
  ok('the docs cross-link loop had links to check', linksChecked > 0, String(linksChecked));
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

console.log('\n== phaseRir: the number next to "RIR" wins, not the lowest digit anywhere (plans/008 item 17, plans/058 item 3) ==');
ok('a week number ahead of the RIR phrase no longer wins',
   call('phaseRir({ phase: [{ r: "Semana 1: 2-3 RIR" }] }, 0)') === 2);
ok('a one-off number elsewhere no longer wins over the RIR range',
   call('phaseRir({ phase: [{ r: "Top set + 2 back-offs, 1 RIR" }] }, 0)') === 1);
ok('a plain range still reads correctly',
   call('phaseRir({ phase: [{ r: "2-3 RIR" }] }, 0)') === 2);
ok('no RIR phrase: a week number no longer falls back to the lowest digit anywhere (plans/058)',
   call('phaseRir({ phase: [{ r: "Semana 3 de 5" }] }, 0)') === null);
ok('no digits at all returns null',
   call('phaseRir({ phase: [{ r: "Deload" }] }, 0)') === null);
ok('a percentage with no RIR reads as null, not the percentage',
   call('phaseRir({ phase: [{ r: "Descarga 60%" }] }, 0)') === null);
ok('a week number and a rep scheme with no RIR read as null',
   call('phaseRir({ phase: [{ r: "Semana 6 · 10 reps" }] }, 0)') === null);
ok('a number next to RIR above RIR_MAX is not a prescription',
   call('phaseRir({ phase: [{ r: "60 RIR" }] }, 0)') === null);
ok('0 RIR is a real prescription, not falsy-null',
   call('phaseRir({ phase: [{ r: "0 RIR" }] }, 0)') === 0);
ok('5 RIR is at RIR_MAX and still counts',
   call('phaseRir({ phase: [{ r: "5 RIR" }] }, 0)') === 5);

/* A fuzz rather than a fixed table: phaseRir takes free text a human typed,
   so the invariant that matters is the shape of every possible answer, not
   a handful of hand-picked ones. Labels are built from the same vocabulary
   real phase text uses — digits, dashes, "RIR", "Semana", "%" and a few
   Spanish words — glued together with and without spaces so both "2-3 RIR"
   and stray digit-word runs like "60Descarga" get exercised. The seed is
   fixed so a failure reproduces; it is not read for anything else. */
const phaseRirFuzzProbe = `
  (function() {
    let seed = 20260922;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
    const words = ['Semana', 'de', 'tecnica', 'Descarga', 'Top', 'set', 'back-offs',
      'reps', 'fase', 'RIR', '%', '-', '–', 'proxima', 'bloque'];
    const failures = [];
    for (let i = 0; i < 2000; i++) {
      const tokenCount = 1 + Math.floor(rnd() * 6);
      const tokens = [];
      for (let j = 0; j < tokenCount; j++) {
        tokens.push(rnd() < 0.35 ? String(Math.floor(rnd() * 100)) : pick(words));
      }
      const label = tokens.join(rnd() < 0.5 ? ' ' : '');
      const block = { phase: [{ r: label }] };
      const v = phaseRir(block, 0);
      if (!(v === null || (Number.isInteger(v) && v >= 0 && v <= RIR_MAX)))
        failures.push({ label: label, v: v, kind: 'phaseRir' });
      const minRir = Math.floor(rnd() * 6), lastRho = Math.floor(rnd() * 6);
      const wv = weekRir(block, { minRir: minRir }, 0, lastRho);
      if (!(wv <= RIR_MAX))
        failures.push({ label: label, wv: wv, minRir: minRir, lastRho: lastRho, kind: 'weekRir' });
    }
    return { checked: 2000, failCount: failures.length, sample: failures.slice(0, 3) };
  })()
`;
const phaseRirFuzz = call(phaseRirFuzzProbe);
ok('2,000 random phase labels: phaseRir is always null or an integer in [0, RIR_MAX], and weekRir (minRir, lastRho in [0, 5]) never exceeds it',
   phaseRirFuzz.failCount === 0, JSON.stringify(phaseRirFuzz));

/* trainedDays had no test of its own (plans/057): it fed the calendar
   straight off a raw walk of the whole log, no week bound at all — wider
   even than the bug decision 3 names for the review's energy comparison,
   since that one at least stopped at the block's own weeks by hand
   elsewhere on the same screen (doneSets, js/review.js). */
console.log('\n== trainedDays reads sessionsOf: a stranded week never reaches the calendar (plans/057) ==');
const trainedDaysProbe = call(`
  (function() {
    state = defaultState(); migrate();
    const pr = state.profiles.hombre;
    const block = pr.blocks[pr.blockOrder[0]];   /* 8 weeks */
    const day = block.days[0], ex = day.ex[0];
    pr.log[block.id] = {};
    pr.log[block.id][slot(1, day.id)] = { [ex.id]: [{ w: '60', r: '8', done: true, ts: Date.UTC(2026, 0, 5, 12) }] };
    /* Week 9 is past this block's own 8 weeks — stranded on purpose. */
    pr.log[block.id][slot(9, day.id)] = { [ex.id]: [{ w: '999', r: '1', done: true, ts: Date.UTC(2026, 2, 2, 12) }] };
    return trainedDays(pr, block);
  })()
`);
ok('a stranded week\'s ticked day never reaches the calendar',
   Object.keys(trainedDaysProbe).length === 1 && Object.values(trainedDaysProbe)[0] === 1,
   JSON.stringify(trainedDaysProbe));

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
  call('peDraft = openPlanDraft(state.profiles.hombre, state.profiles.hombre.blocks["block-1"]);');
  call('peDraft.block.days[0].ex[0].sets = 5000;');
  call('peDraft.block.days[0].ex[0].rest = 99999;');
  call('peDraft.block.days[0].ex[0].add = 40;');
  ok('syncDraftFromForm accepts the draft', call('syncDraftFromForm()') === null,
     String(call('syncDraftFromForm()')));
  ok('...and clamps sets to the same 12 migrate() uses',
     call('peDraft.block.days[0].ex[0].sets') === 12,
     String(call('peDraft.block.days[0].ex[0].sets')));
  ok('...and clamps rest to the same 900 migrate() uses',
     call('peDraft.block.days[0].ex[0].rest') === 900,
     String(call('peDraft.block.days[0].ex[0].rest')));
  ok('...and clamps "+1 serie desde" to the weeks the block actually has',
     call('peDraft.block.days[0].ex[0].add') <= call('peDraft.block.weeks'),
     'add=' + call('peDraft.block.days[0].ex[0].add') + ' weeks=' + call('peDraft.block.weeks'));
  /* A cleared box has to stay cleared. clampInt('') is 0 raised to its low
     bound, so an `add` clamped from 1 would come back as week 1 and could
     never be removed again — clamped from 0 and deleted when falsy. */
  call('peDraft.block.days[0].ex[0].add = 0; syncDraftFromForm();');
  ok('a zeroed "+1 serie desde" is removed, not clamped up to week 1',
     call('peDraft.block.days[0].ex[0].add') === undefined,
     String(call('peDraft.block.days[0].ex[0].add')));
  call('peDraft = null;');
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

  /* purgeRecord's week is optional, and the sweep this replaced read
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
  /* Every part filed by block, off the table: the hand-written fixture
     this replaced had no objetivo record in it. */
  const left = call(`(function () {
    const p = {};
    RECORD_PARTS.filter(part => part.keyedBy !== 'exercise').forEach(part => {
      const v = () => part.keyedBy === 'slot' ? (part.name === 'order' ? ['e1'] : 'x') : { e1: [{}] };
      p[part.name] = { b1: { 'w1-d1': v(), 'w17-d1': v(), 'w3-d2': v() } };
    });
    purgeRecord(p, 'b1', { day: 'd1' });
    return Object.keys(p).map(name => name + ':' + Object.keys(p[name].b1).join(','));
  })()`);
  ok('purging a day takes the w17 entry from every part filed by block, and leaves the other day alone',
     left.length > 0 && left.every(s => /:w3-d2$/.test(s)), JSON.stringify(left));

  const ex = call(`(function () {
    const p = { log: { b1: { 'w17-d1': { e1: [{}], e2: [{}] } } },
                rir: { b1: { 'w17-d1': { e1: 2, e2: 3 } } } };
    purgeRecord(p, 'b1', { day: 'd1', exercise: 'e1' });
    return Object.keys(p.log.b1['w17-d1']).join(',') + '|' + Object.keys(p.rir.b1['w17-d1']).join(',');
  })()`);
  ok('purging one lift reaches the same week, and takes only its own exercise', ex === 'e2|e2', ex);

  /* The editor's purge confirmation quotes these counts, and the purges above
     delete every week the day has. A count that stopped at MAX_WEEKS told
     the user fewer sets would go than actually went. */
  const counted = call(`(function () {
    const p = { log: { b1: { 'w1-d1': { e1: [{ done: true }] }, 'w17-d1': { e1: [{ done: true }, {}], e2: [{ w: 50 }] },
                             'w17-d2': { e1: [{ done: true }] } } } };
    const e1 = { id: 'e1' }, e2 = { id: 'e2' };
    peDraft = openPlanDraft(p, { id: 'b1', days: [] });
    try {
      return draftExLogged(p, e1, 'd1') + '|' + draftDayLogged(p, { id: 'd1', ex: [e1, e2] });
    } finally { peDraft = null; }
  })()`);
  ok("the purge confirmation counts the used rows filed under w17, and not the other day's",
     counted === '2|3', counted);

  const moved = call(`(function () {
    const p = { log: { b1: { 'w17-d1': { e1: [{ w: 1 }] } } } };
    moveExerciseRecord(p, 'b1', 'd1', 'd2', 'e1');
    return JSON.stringify(p.log.b1);
  })()`);
  ok('moveExerciseRecord carries a week past the cap across to the other day',
     moved === '{"w17-d2":{"e1":[{"w":1}]}}', moved);

  /* The session order's move has two independent halves: the destination day can have a
     recorded order in a week the source day has no entry for at all, and the
     exercise still has to join it. Walking only the source's weeks would
     miss that, which is why it walks the weeks either day has. */
  const order = call(`(function () {
    const p = { order: { b1: { 'w1-d1': ['e1', 'e2'], 'w1-d2': ['e9'], 'w17-d2': ['e9'] } } };
    moveExerciseRecord(p, 'b1', 'd1', 'd2', 'e1');
    return JSON.stringify(p.order.b1);
  })()`);
  ok('moving a lift drops its id from the source order and appends it to the destination, in every week either has',
     order === '{"w1-d1":["e2"],"w1-d2":["e9","e1"],"w17-d2":["e9","e1"]}', order);
}

console.log('\n== RECORD_PARTS: one table for the profile\'s record (plans/046) ==');
{
  /* The list used to be written out by hand at every purge, move, install
     and repair, and each copy left a different map out. The guard is what
     keeps the table the WHOLE list: a migrated profile, after a week of
     use through the app's own writers, may carry nothing but the table's
     parts and the fields below, which are the profile's settings and plan,
     not its record. A new key on a profile fails here until it is either
     declared in RECORD_PARTS or added to NON_RECORD_FIELDS on purpose. It
     is the app's own list, the one a restore keeps (plans/051), so the two
     cannot drift apart. A real object, not the source text, so it cannot
     be fooled by how a write is spelled. */
  const NON_RECORD = call('NON_RECORD_FIELDS');
  const guard = call(`(function () {
    state = defaultState();
    migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0], ex = day.ex[0];
    const row = entry(profile, block.id, 1, day.id, ex.id, ex.sets)[0];
    row.w = '40'; row.r = '10'; row.done = true;
    setNoteText(profile, block.id, 1, day.id, 'Bien');
    setEnergy(profile, block.id, 1, day.id, 'alta');
    setOrder(profile, block.id, 1, day.id, day.ex.map(e => e.id).reverse());
    recordVariant(profile, ex.id, ex.n, ex.n + ' en máquina', Date.now());
    migrate();
    return {
      parts: RECORD_PARTS.map(part => part.name),
      keys: Object.keys(state.profiles).map(k => Object.keys(state.profiles[k])),
    };
  })()`);
  const allowed = guard.parts.concat(NON_RECORD);
  const stray = [].concat(...guard.keys).filter(k => allowed.indexOf(k) < 0);
  const missing = guard.keys.map(keys => allowed.filter(k => keys.indexOf(k) < 0));
  ok('a migrated profile holds the table\'s parts and its non-record fields, and nothing else',
     stray.length === 0, 'not in RECORD_PARTS and not a known field: ' + JSON.stringify(stray));
  ok('...and every one of them, on every profile', missing.every(m => m.length === 0), JSON.stringify(missing));

  const shape = call(`(function () {
    const bad = [];
    const names = new Set();
    RECORD_PARTS.forEach(part => {
      if (names.has(part.name)) bad.push(part.name + ': listed twice');
      names.add(part.name);
      if (['slot+exercise', 'slot', 'exercise'].indexOf(part.keyedBy) < 0) bad.push(part.name + ': keyedBy ' + part.keyedBy);
      if ((part.keyedBy === 'slot+exercise') !== (part.merge != null)) bad.push(part.name + ': merge is for parts keyed by exercise under the slot');
      if (part.merge != null && ['concat', 'keep-destination'].indexOf(part.merge) < 0) bad.push(part.name + ': merge ' + part.merge);
      if (part.keyedBy === 'exercise' && part.travelsWithBlock) bad.push(part.name + ': not filed by block, cannot travel with one');
    });
    return bad;
  })()`);
  ok('every entry says how it is keyed, and a merge rule exactly where a move has two values to merge',
     shape.length === 0, JSON.stringify(shape));

  /* Every case below builds its fixture from the table and checks every
     part, so an eighth part is covered without editing this section. Block
     b1 has day d1 in weeks 1, 2 and 17 (past MAX_WEEKS), and day d2 in
     week 1; block b2 has one slot that nothing below may touch. Under the
     slot, e1 and e2; the destination d2 already has its own e1. */
  const FIXTURE = `
    const destV = part => part.merge === 'concat' ? [{ w: 'dest' }] : 'dest';
    const srcV = (part, ex, w) => part.merge === 'concat' ? [{ w: ex + '@' + w }] : ex + '@' + w;
    const slotV = part => part.name === 'order' ? ['e2', 'e1'] : 'x';
    const fixture = () => {
      const p = {};
      RECORD_PARTS.forEach(part => {
        if (part.keyedBy === 'exercise') { p[part.name] = { e1: [{ n: 'Antes', since: '2026-01-01' }] }; return; }
        const b1 = {};
        [1, 2, 17].forEach(w => {
          b1[slot(w, 'd1')] = part.keyedBy === 'slot' ? slotV(part) : { e1: srcV(part, 'e1', w), e2: srcV(part, 'e2', w) };
        });
        b1[slot(1, 'd2')] = part.keyedBy === 'slot' ? slotV(part) : { e1: destV(part) };
        p[part.name] = { b1: b1, b2: { [slot(1, 'd1')]: part.keyedBy === 'slot' ? slotV(part) : { e1: srcV(part, 'e1', 1) } } };
      });
      return p;
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const byBlock = part => part.keyedBy !== 'exercise';
  `;
  const check = body => call(`(function () { ${FIXTURE} const bad = []; ${body} return bad; })()`);

  const wiped = check(`
    const p = fixture(), before = fixture();
    purgeRecord(p);
    RECORD_PARTS.forEach(part => {
      if (byBlock(part) && !same(p[part.name], {})) bad.push(part.name + ' survived a wipe');
      if (!byBlock(part) && !same(p[part.name], before[part.name])) bad.push(part.name + ' was reached by a wipe');
    });`);
  ok('purgeRecord(profile) empties every part filed by block, and leaves the variants (plans/046 decision 7)',
     wiped.length === 0, JSON.stringify(wiped));

  const dropped = check(`
    const p = fixture(), before = fixture();
    purgeRecord(p, 'b1');
    RECORD_PARTS.forEach(part => {
      if (!byBlock(part)) { if (!same(p[part.name], before[part.name])) bad.push(part.name + ' was reached'); return; }
      if (Object.prototype.hasOwnProperty.call(p[part.name], 'b1')) bad.push(part.name + ' kept the block');
      if (!same(p[part.name].b2, before[part.name].b2)) bad.push(part.name + ' lost another block');
    });`);
  ok('purgeRecord(profile, block) drops the block from every part filed by block, and nothing else',
     dropped.length === 0, JSON.stringify(dropped));

  const day = check(`
    const p = fixture(), before = fixture();
    purgeRecord(p, 'b1', { day: 'd1' });
    RECORD_PARTS.forEach(part => {
      if (!byBlock(part)) { if (!same(p[part.name], before[part.name])) bad.push(part.name + ' was reached'); return; }
      if (!same(Object.keys(p[part.name].b1), [slot(1, 'd2')])) bad.push(part.name + ' left ' + Object.keys(p[part.name].b1));
      if (!same(p[part.name].b2, before[part.name].b2)) bad.push(part.name + ' lost another block');
    });`);
  ok('purgeRecord(profile, block, { day }) takes every week of that day, w17 included, from every part filed by block',
     day.length === 0, JSON.stringify(day));

  const week = check(`
    const p = fixture(), before = fixture();
    purgeRecord(p, 'b1', { day: 'd1', week: 2 });
    RECORD_PARTS.forEach(part => {
      if (!byBlock(part)) { if (!same(p[part.name], before[part.name])) bad.push(part.name + ' was reached'); return; }
      const want = Object.keys(before[part.name].b1).filter(k => k !== slot(2, 'd1'));
      if (!same(Object.keys(p[part.name].b1), want)) bad.push(part.name + ' left ' + Object.keys(p[part.name].b1));
      if (!same(p[part.name].b2, before[part.name].b2)) bad.push(part.name + ' lost another block');
    });`);
  ok('purgeRecord(profile, block, { day, week }) takes that one slot and no other (clearDay)',
     week.length === 0, JSON.stringify(week));

  const lift = check(`
    const p = fixture(), before = fixture();
    purgeRecord(p, 'b1', { day: 'd1', exercise: 'e1' });
    RECORD_PARTS.forEach(part => {
      if (part.keyedBy !== 'slot+exercise') {
        if (!same(p[part.name], before[part.name])) bad.push(part.name + ' is not keyed by exercise under the slot, but changed');
        return;
      }
      [1, 2, 17].forEach(w => {
        const s = p[part.name].b1[slot(w, 'd1')];
        if (!s || s.e1 !== undefined) bad.push(part.name + ' kept e1 in week ' + w);
        if (!s || !same(s.e2, before[part.name].b1[slot(w, 'd1')].e2)) bad.push(part.name + ' lost e2 in week ' + w);
      });
      if (!same(p[part.name].b1[slot(1, 'd2')], before[part.name].b1[slot(1, 'd2')])) bad.push(part.name + ' reached another day');
      if (!same(p[part.name].b2, before[part.name].b2)) bad.push(part.name + ' lost another block');
    });`);
  ok('purgeRecord(profile, block, { day, exercise }) takes that lift from every part keyed by it, in every week, and leaves the session order its id (plans/046 decision 6)',
     lift.length === 0, JSON.stringify(lift));

  const moved = check(`
    const p = fixture(), before = fixture();
    moveExerciseRecord(p, 'b1', 'd1', 'd2', 'e1');
    RECORD_PARTS.forEach(part => {
      if (part.move) return;   /* its own move; the order's is asserted above */
      if (part.keyedBy !== 'slot+exercise') {
        if (!same(p[part.name], before[part.name])) bad.push(part.name + ' is not keyed by exercise under the slot, but changed');
        return;
      }
      const b1 = p[part.name].b1;
      [1, 2, 17].forEach(w => {
        const from = b1[slot(w, 'd1')];
        if (from && from.e1 !== undefined) bad.push(part.name + ' left e1 on the source day in week ' + w);
        if (!from || !same(from.e2, srcV(part, 'e2', w))) bad.push(part.name + ' moved e2 in week ' + w);
      });
      [2, 17].forEach(w => {
        if (!b1[slot(w, 'd2')] || !same(b1[slot(w, 'd2')].e1, srcV(part, 'e1', w))) bad.push(part.name + ' did not file e1 under d2 in week ' + w);
      });
      const merged = b1[slot(1, 'd2')].e1;
      const want = part.merge === 'concat' ? destV(part).concat(srcV(part, 'e1', 1)) : destV(part);
      if (!same(merged, want)) bad.push(part.name + ' merged into the destination as ' + JSON.stringify(merged));
      if (!same(p[part.name].b2, before[part.name].b2)) bad.push(part.name + ' reached another block');
    });`);
  ok('moveExerciseRecord carries the lift across in every part keyed by it, merging by each part\'s rule, and leaves the rest',
     moved.length === 0, JSON.stringify(moved));

  /* applyPlanDraft lifts every copy "Enviar a…" moved onto a day of its own
     before it puts any down (plans/053's second follow-up), so a part's
     move has to compose: from the source to a day nothing is filed under,
     then on to the destination, ends where the one move does. The session
     order is the part with a move of its own, and three more slots give it
     what the fixture leaves out: a destination order without the id in a
     week the source's has it, a destination order in a week the source has
     none, and a source order the move empties. The other parts get the
     same slots. */
  const composed = check(`
    const build = () => {
      const p = fixture();
      RECORD_PARTS.forEach(part => {
        if (!byBlock(part)) return;
        const put = (w, day, ids) => {
          p[part.name].b1[slot(w, day)] = part.name === 'order' ? ids : part.keyedBy === 'slot' ? slotV(part)
            : ids.reduce((o, id) => Object.assign(o, { [id]: srcV(part, id, w) }), {});
        };
        put(2, 'd2', ['e3']);
        put(3, 'd2', ['e3']);
        put(4, 'd1', ['e1']);
      });
      return p;
    };
    const sorted = v => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val))
      ? Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
    const direct = build(), through = build();
    moveExerciseRecord(direct, 'b1', 'd1', 'd2', 'e1');
    moveExerciseRecord(through, 'b1', 'd1', 'de-paso', 'e1');
    moveExerciseRecord(through, 'b1', 'de-paso', 'd2', 'e1');
    RECORD_PARTS.forEach(part => {
      if (sorted(through[part.name]) !== sorted(direct[part.name])) {
        bad.push(part.name + ' ended as ' + sorted(through[part.name]) + ', the one move as ' + sorted(direct[part.name]));
      }
      if (byBlock(part)) forEachSlot(through[part.name], 'b1', (k, w, d) => { if (d === 'de-paso') bad.push(part.name + ' left ' + k); });
    });`);
  ok('moveExerciseRecord through a day nothing is filed under ends where the one move does, in every part, and leaves nothing on that day',
     composed.length === 0, JSON.stringify(composed));

  /* A move from a day to that same day is no move, and has to leave the
     record exactly as it was. It used to empty it: the source slot is the
     destination slot, so the log's rows were added to themselves and then
     deleted with the source, the legacy chip and the objetivo record were
     deleted outright, and the session order took the id out and put it
     back last, or dropped a week's order that held that id alone. The
     fixture's orders have e1 last already, so this moves every lift of
     both days, and gives d1 a week 3 whose order is e1 alone. */
  const stayed = check(`
    const build = () => {
      const p = fixture();
      RECORD_PARTS.forEach(part => {
        if (byBlock(part)) p[part.name].b1[slot(3, 'd1')] = part.name === 'order' ? ['e1'] : part.keyedBy === 'slot' ? slotV(part) : { e1: srcV(part, 'e1', 3) };
      });
      return p;
    };
    const p = build(), before = build();
    ['d1', 'd2'].forEach(d => ['e1', 'e2'].forEach(ex => moveExerciseRecord(p, 'b1', d, d, ex)));
    RECORD_PARTS.forEach(part => {
      if (!same(p[part.name], before[part.name])) bad.push(part.name + ' became ' + JSON.stringify(byBlock(part) ? p[part.name].b1 : p[part.name]));
    });`);
  ok('moveExerciseRecord from a day to the same day leaves every part exactly as it was, the session order included',
     stayed.length === 0, JSON.stringify(stayed));

  const installed = check(`
    const src = fixture(), p = {}, data = {};
    RECORD_PARTS.forEach(part => { if (byBlock(part)) data[part.name] = src[part.name].b1; });
    installBlockData(p, 'nuevo', data);
    RECORD_PARTS.forEach(part => {
      const filed = !!(p[part.name] && p[part.name].nuevo);
      if (filed !== !!part.travelsWithBlock) bad.push(part.name + (filed ? ' was filed' : ' was not filed'));
    });`);
  ok('installBlockData files exactly the parts that travel with a block, whatever it is handed',
     installed.length === 0, JSON.stringify(installed));

  const ensured = check(`
    const p = { blocks: {}, log: 'not-an-object', rir: null };
    ensureRecord(p);
    RECORD_PARTS.forEach(part => {
      if (!p[part.name] || typeof p[part.name] !== 'object') bad.push(part.name + ' is ' + JSON.stringify(p[part.name]));
    });`);
  ok('ensureRecord gives every part an object, missing or malformed', ensured.length === 0, JSON.stringify(ensured));
}

console.log('\n== a restore keeps what the app reads, and nothing else (plans/051) ==');
{
  /* Nothing whitelisted the keys of a restored profile or of a backup's top
     level, so whatever else a file carried went into storage untouched, and
     out again in every backup after. Built as JSON text and parsed, not as
     an object literal: a literal '__proto__' key sets the prototype instead
     of making a property, which would test nothing, and JSON.parse is how
     these keys really arrive. */
  const EXTRA = '"__proto__":{"polluted":true},"constructor":"x","hasOwnProperty":1,"units":"lb","foo":[1,2],';
  const profile = call(`(function () {
    state = defaultState(); migrate();
    const p = normalizeImportedProfile(JSON.parse('{' + ${JSON.stringify(EXTRA)} + JSON.stringify(state.profiles.hombre).slice(1)));
    const allowed = RECORD_PARTS.map(part => part.name).concat(NON_RECORD_FIELDS);
    return {
      stray: Object.keys(p).filter(k => allowed.indexOf(k) < 0),
      missing: allowed.filter(k => !Object.prototype.hasOwnProperty.call(p, k)),
      proto: Object.getPrototypeOf(p) === Object.prototype && !('polluted' in p),
    };
  })()`);
  ok('a restored profile keeps none of the extra keys a file carried, "__proto__" and "constructor" included',
     profile.stray.length === 0, JSON.stringify(profile.stray));
  ok('...and its prototype is still the plain one', profile.proto === true);
  ok('...while every part of the record and every field beside it is still there',
     profile.missing.length === 0, JSON.stringify(profile.missing));

  const backup = call(`(function () {
    state = defaultState(); migrate();
    const data = normalizeImportedBackup(JSON.parse('{' + ${JSON.stringify(EXTRA + '"saved":"2026-01-01","app":"heavy-iron-v1",')} + JSON.stringify(state).slice(1)));
    return {
      stray: Object.keys(data).filter(k => BACKUP_FIELDS.indexOf(k) < 0),
      missing: Object.keys(state).filter(k => !Object.prototype.hasOwnProperty.call(data, k)),
      proto: Object.getPrototypeOf(data) === Object.prototype && !('polluted' in data),
    };
  })()`);
  ok("a restored backup's top level keeps none of the extra keys a file carried", backup.stray.length === 0, JSON.stringify(backup.stray));
  ok('...and its prototype is still the plain one', backup.proto === true);
  ok('...and keeps every field of the state it was taken from', backup.missing.length === 0, JSON.stringify(backup.missing));

  /* The other half, and the STOP condition plans/051 carried: nothing the
     app itself writes may be dropped by that (plans/010). A state used
     through the app's own writers, every key of it and of each profile
     compared before and after a restore; and its top level holds nothing
     BACKUP_FIELDS leaves out, so a new top-level field fails here, the way
     a new profile field fails the guard above, instead of vanishing on the
     next restore. */
  const own = call(`(function () {
    state = defaultState(); migrate();
    state.mode = 'solo'; state.setupDone = true; state.prefs.units = 'lb';
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0], ex = day.ex[0];
    const row = entry(profile, block.id, 1, day.id, ex.id, ex.sets)[0];
    row.w = '40'; row.r = '10'; row.done = true; row.ts = Date.now(); row.rir = '2';
    setNoteText(profile, block.id, 1, day.id, 'Bien');
    setEnergy(profile, block.id, 1, day.id, 'alta');
    setOrder(profile, block.id, 1, day.id, day.ex.map(e => e.id).reverse());
    recordTarget(profile, block.id, 1, day.id, ex.id, { conf: 'alta', kind: 'objetivo', hold: true, brake: true, rirWeek: 2, sets: [{ w: 40, r: 10, move: '↑' }] });
    recordVariant(profile, ex.id, ex.n, ex.n + ' en máquina', Date.now());
    migrate();
    const before = JSON.parse(JSON.stringify(state));
    const after = normalizeImportedBackup(JSON.parse(JSON.stringify(state)));
    const lost = Object.keys(before).filter(k => !Object.prototype.hasOwnProperty.call(after, k));
    Object.keys(before.profiles).forEach(pk => Object.keys(before.profiles[pk]).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(after.profiles[pk], k)) lost.push(pk + '.' + k);
    }));
    return { lost: lost, stray: Object.keys(before).filter(k => BACKUP_FIELDS.indexOf(k) < 0) };
  })()`);
  ok('a restore drops nothing the app itself writes, on a profile or at the top level', own.lost.length === 0, JSON.stringify(own.lost));
  ok('the state the app writes holds nothing BACKUP_FIELDS leaves out', own.stray.length === 0, JSON.stringify(own.stray));
}

console.log('\n== RECORD_PARTS: each part says how it is accepted (plans/051) ==');
{
  /* The import named every part by hand and failed three times the same
     way, a part handled differently or not at all. It loops over the table
     now, so the table has to say for every part how a value from outside
     is taken in. */
  const noAccept = call(`RECORD_PARTS.filter(part => typeof part.accept !== 'function').map(part => part.name)`);
  ok('every part of the record has an accept', noAccept.length === 0, JSON.stringify(noAccept));

  /* And what it takes in unchanged is what the app itself wrote: one value
     for every part, each through the app's own writer. The legacy chips go
     in by hand, the way a profile logged before plans/035 carries them,
     since nothing has written one since. A part added to the table with no
     sample here fails on purpose rather than passing on an empty map.
     Compared with keys sorted, because the objetivo record's accept
     rebuilds each record in its own field order. The session order
     includes the one-id order "Enviar a otra sesión" leaves behind, which
     the import used to drop (plans/051, decision 2). */
  const perPart = call(`(function () {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0];
    const a = exList(day)[0], b = exList(day)[1];
    const row = entry(profile, block.id, 1, day.id, a.id, a.sets)[0];
    row.w = '42,5'; row.r = '10'; row.done = true; row.ts = Date.UTC(2026, 0, 5); row.rir = '2';
    profile.rir[block.id] = { [slot(2, day.id)]: { [b.id]: '2+' } };
    setNoteText(profile, block.id, 1, day.id, 'Buena sesión');
    setEnergy(profile, block.id, 1, day.id, 'alta');
    moveSessionEx(profile, block, 1, day, b.id, -1);
    recordTarget(profile, block.id, 1, day.id, a.id, { conf: 'media', kind: 'objetivo', hold: true, brake: true, rirWeek: 2,
      sets: [{ w: 42.5, r: 10, move: '↑' }, { w: 40, r: 9, move: '' }] });
    recordVariant(profile, a.id, a.n, a.n + ' en máquina', Date.UTC(2026, 0, 12));

    /* A day of two lifts with an order recorded, then one of them sent to
       the other day the way peSave files it: the plan moves first, then
       moveExerciseRecord, and the order left behind holds one id. */
    const nb = emptyBlock();
    const x = Object.assign(newExercise(), { n: 'Press' }), y = Object.assign(newExercise(), { n: 'Remo' });
    nb.days = [{ id: 'd0', name: 'A', ex: [x, y] }, { id: 'd1', name: 'B', ex: [Object.assign(newExercise(), { n: 'Curl' })] }];
    profile.blocks[nb.id] = nb; profile.blockOrder.push(nb.id);
    migrate();
    const da = nb.days[0], db = nb.days[1];
    entry(profile, nb.id, 1, da.id, x.id, 1)[0].w = '50';
    moveSessionEx(profile, nb, 1, da, y.id, -1);
    da.ex.splice(da.ex.indexOf(x), 1); db.ex.push(x);
    moveExerciseRecord(profile, nb.id, da.id, db.id, x.id);
    migrate();

    const before = JSON.parse(JSON.stringify(profile));
    const after = normalizeImportedProfile(JSON.parse(JSON.stringify(profile)));
    const sorted = v => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val))
      ? Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
    const samples = part => Object.keys(before[part.name]).reduce((n, k) =>
      n + (part.keyedBy === 'exercise' ? 1 : Object.keys(before[part.name][k] || {}).length), 0);
    return {
      parts: RECORD_PARTS.map(part => ({ name: part.name, samples: samples(part),
        same: sorted(after[part.name]) === sorted(before[part.name]),
        before: sorted(before[part.name]).slice(0, 300), after: sorted(after[part.name]).slice(0, 300) })),
      oneId: JSON.stringify(before.order[nb.id] && before.order[nb.id][slot(1, da.id)]),
      want: JSON.stringify([y.id]),
    };
  })()`);
  ok('the fixture carries the one-id order the move leaves behind', perPart.oneId === perPart.want, perPart.oneId);
  perPart.parts.forEach(r => {
    ok('what the app wrote into ' + r.name + ' comes back from normalizeImportedProfile unchanged',
       r.samples > 0 && r.same, r.samples ? r.before + ' vs ' + r.after : 'no own-data sample for this part in the fixture');
  });

  /* The order rule, once (decision 2), read by the import, migrate()'s
     repair and setOrder alike: the cap comes before the ids are resolved,
     one id is still an order, and an id is kept once and only if it is a
     usable key. */
  const rule = call(`(function () {
    const order = recordPart('order');
    const p = { order: {} };
    setOrder(p, 'b', 1, 'd', ['a', 'a', '__proto__', 5, 'b']);
    const q = { order: { b: { 'w1-d': ['a', 'constructor', 'a'], 'w2-d': ['a'], 'w3-d': 'a' } }, variants: {} };
    recordPart('order').repair(q);
    return {
      oneId: JSON.stringify(order.clean(['a'])),
      capFirst: order.clean(Array(ORDER_LIMIT).fill('ghost').concat(['a', 'b']), id => (id === 'ghost' ? '' : id)) === undefined,
      nothing: order.clean([]) === undefined && order.clean('ab') === undefined,
      written: JSON.stringify(p.order.b),
      repaired: JSON.stringify(q.order.b),
    };
  })()`);
  ok('one id is still an order', rule.oneId === '["a"]', rule.oneId);
  ok('the cap comes before the ids are resolved, so junk past it cannot push a real id in', rule.capFirst === true);
  ok('an empty list, or no list, is no order', rule.nothing === true);
  ok('setOrder writes through the rule: each id once, and only a usable key', rule.written === '{"w1-d":["a","b"]}', rule.written);
  ok("migrate()'s repair reads the same rule", rule.repaired === '{"w1-d":["a"],"w2-d":["a"]}', rule.repaired);
}

console.log('\n== sessionsOf: the one reading of the log (plans/038) ==');
{
  /* sessionFixture (above, "the history fixture") builds the plan every
     case below shares unless it says otherwise: two blocks, two days
     each, a press on both days of A (so day position matters) and the
     same press under a different id, by name, in B. */
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

console.log('\n== deloadCheck: one comparison per deload span (plans/054 decision 2) ==');
{
  /* Every set logged at 1 rep: est1RM(w, 1) = w * 31/30 for any w, so the
     ratio between two weeks' best e1RM is exactly the ratio of the raw
     weights typed in — the arithmetic below can be checked by eye instead
     of through Epley's constant. sessionFixture is the one defined inside
     the sessionsOf section above; it is a global of the app's own vm
     context by the time that section ran, not a Node-side local, so it is
     still there to call. */
  const spanSingle = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, deload: 4,
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [
        { block: 'A', week: 3, day: 'd1', lift: 'bp', sets: [[100, 1]] },
        { block: 'A', week: 5, day: 'd1', lift: 'bp', sets: [[105, 1]] },
      ] });
    return JSON.stringify(deloadCheck(p, p.blocks.A));
  })()`));
  ok('a single field deload is one span, with today\'s own before/after/n/change',
     spanSingle.length === 1 && spanSingle[0].before === 3 && spanSingle[0].after === 5 &&
     spanSingle[0].deload === 4 && spanSingle[0].deloadEnd === 4 && spanSingle[0].n === 1 &&
     Math.round(spanSingle[0].change * 100) / 100 === 5,
     JSON.stringify(spanSingle));

  const spanTwo = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 10, deload: 4, phase: { 8: { r: 'Descarga' } },
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [
        { block: 'A', week: 3, day: 'd1', lift: 'bp', sets: [[100, 1]] },
        { block: 'A', week: 5, day: 'd1', lift: 'bp', sets: [[110, 1]] },
        { block: 'A', week: 7, day: 'd1', lift: 'bp', sets: [[80, 1]] },
        { block: 'A', week: 9, day: 'd1', lift: 'bp', sets: [[84, 1]] },
      ] });
    return JSON.stringify(deloadCheck(p, p.blocks.A));
  })()`));
  ok('two separate deload weeks (field at 4, phase text at 8) are two spans, each compared on its own',
     spanTwo.length === 2 &&
     spanTwo[0].deload === 4 && spanTwo[0].before === 3 && spanTwo[0].after === 5 && Math.round(spanTwo[0].change) === 10 &&
     spanTwo[1].deload === 8 && spanTwo[1].before === 7 && spanTwo[1].after === 9 && Math.round(spanTwo[1].change) === 5,
     JSON.stringify(spanTwo));

  const spanRange = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, deload: 4, phase: { 5: { r: 'Descarga' } },
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [
        { block: 'A', week: 3, day: 'd1', lift: 'bp', sets: [[100, 1]] },
        { block: 'A', week: 6, day: 'd1', lift: 'bp', sets: [[90, 1]] },
      ] });
    return JSON.stringify(deloadCheck(p, p.blocks.A));
  })()`));
  ok('a two-week span (field at 4, phase text at 5) compares the week before it with the week after it',
     spanRange.length === 1 && spanRange[0].deload === 4 && spanRange[0].deloadEnd === 5 &&
     spanRange[0].before === 3 && spanRange[0].after === 6 && Math.round(spanRange[0].change) === -10,
     JSON.stringify(spanRange));

  const spanStart = call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, deload: 1,
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [{ block: 'A', week: 2, day: 'd1', lift: 'bp', sets: [[100, 1]] }] });
    return deloadCheck(p, p.blocks.A).length;
  })()`);
  ok('a deload on the block\'s first week has no week before it — no check',
     spanStart === 0, String(spanStart));

  const spanEnd = call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 6, deload: 6,
                                          days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [{ block: 'A', week: 5, day: 'd1', lift: 'bp', sets: [[100, 1]] }] });
    return deloadCheck(p, p.blocks.A).length;
  })()`);
  ok('a deload on the block\'s last week has no week after it — no check',
     spanEnd === 0, String(spanEnd));
}

console.log('\n== the history cache: one read per question, dropped by the write (plans/045) ==');
{
  /* Every case builds its own profile and files it as the active one, so
     snapshotForUndo, undoLast and getProfile see it. render() is stubbed
     for the section: commit() is half of what is being pinned, and the
     inert DOM cannot draw (see the writeState case above). Each read
     before the change is what fills the cache the change must empty. */
  call(`
    function cacheFixture() {
      const t0 = Date.now() - 30 * 86400000;
      const sets = (kg, wk) => [[kg, 10, { ts: t0 + wk * 7 * 86400000 }], [kg, 10, { ts: t0 + wk * 7 * 86400000 }]];
      const sessions = [];
      [1, 2, 3].forEach(w => {
        sessions.push({ block: 'A', week: w, day: 'd1', lift: 'sq', sets: sets(100, w) });
        sessions.push({ block: 'A', week: w, day: 'd1', lift: 'bp', sets: sets(60, w) });
      });
      return sessionFixture({ blocks: [
        { id: 'A', weeks: 8, days: [
          { id: 'd1', ex: [{ id: 'sq', n: 'Sentadilla' }, { id: 'bp', n: 'Press banca', sets: 2 }] },
          { id: 'd2', ex: [{ id: 'row', n: 'Remo' }] } ] },
      ], sessions: sessions,
         profile: { label: 'Él', theme: 'azul', notes: {}, energy: {}, order: {},
                    activeBlock: 'A', week: 4, day: 0 },
         install: true });
    }
    /* What the card's own boxes hand to save(): this lift, this slot. */
    function cardScope(p, week, day, lift) { return { profile: p, block: 'A', week: week, day: day, lift: lift }; }
    var __realRender = render;
    render = function () {};
  `);
  const Q = `{ weeks: 'logged', lift: { id: 'bp' } }`;
  try {
    const warm = JSON.parse(call(`(function () {
      const p = cacheFixture(), b = p.blocks.A, ex = b.days[0].ex[1];
      return JSON.stringify({
        sessions: sessionsOf(p, ${Q}) === sessionsOf(p, ${Q}),
        rule: exHistory(p, b, ex, 'd1', 4) === exHistory(p, b, ex, 'd1', 4),
        /* The same question with a new cut-off is a slice of a read already
           held, not a second walk: the sessions in it are the same objects. */
        slice: sessionsOf(p, { weeks: 'logged', lift: { id: 'bp' }, before: { block: 'A', week: 3 } })[0] ===
               sessionsOf(p, { weeks: 'logged', lift: { id: 'bp' }, before: { block: 'A', week: 4 } })[0],
      });
    })()`));
    ok('the same question twice, nothing logged in between, is answered with the same arrays (sessionsOf, exHistory, a new cut-off)',
       warm.sessions && warm.rule && warm.slice, JSON.stringify(warm));

    /* exHistory used to leave an `ord` on each session; a reader that wrote
       onto what it was handed now would be writing onto every later
       reader's answer. Sloppy-mode scripts drop those writes silently, so
       each one is tried and the next reader's answer compared with a
       fresh walk of the same log. */
    const poison = JSON.parse(call(`(function () {
      const p = cacheFixture(), b = p.blocks.A, ex = b.days[0].ex[1];
      const a = sessionsOf(p, ${Q});
      const h = exHistory(p, b, ex, 'd1', 4);
      const tries = [
        () => { a[0].sets[0].w = 999; }, () => { a[0].week = 99; }, () => { a.push({ sets: [] }); },
        () => { a[0].sets.push({}); }, () => { a[0].sets[0].drops.push({ w: 1 }); }, () => { a.length = 0; },
        () => { h[0].sets[0].w = 999; }, () => { h.pop(); }, () => { h[0].ord = [0]; },
      ];
      tries.forEach(f => { try { f(); } catch (e) { /* strict callers throw: fine */ } });
      const again = JSON.stringify(sessionsOf(p, ${Q})), againRule = JSON.stringify(exHistory(p, b, ex, 'd1', 4));
      logChanged();
      return JSON.stringify({
        same: again === JSON.stringify(sessionsOf(p, ${Q})),
        sameRule: againRule === JSON.stringify(exHistory(p, b, ex, 'd1', 4)),
        w: (JSON.parse(again)[0] || { sets: [{}] }).sets[0].w, n: JSON.parse(again).length,
        frozen: Object.isFrozen(a) && Object.isFrozen(a[0]) && Object.isFrozen(a[0].sets[0]) && Object.isFrozen(a[0].sets[0].drops) &&
                Object.isFrozen(h) && Object.isFrozen(h[0].sets[0]),
      });
    })()`));
    ok('a caller writing onto a cached answer cannot change the next caller\'s (sessions and exHistory are frozen all the way down)',
       poison.same && poison.sameRule && poison.w === 60 && poison.n === 3 && poison.frozen, JSON.stringify(poison));

    /* The card's tick: a row of the week being trained ticked, and the same
       save() the tick handler calls, with the card's scope. Everything
       reading that week sees it at once — including the objetivo held in
       the draw's render cache, which drawCard keeps — and what stops before
       it (every other card, the brake) is kept, not re-read. */
    const tick = JSON.parse(call(`(function () {
      const p = cacheFixture(), b = p.blocks.A, d1 = b.days[0], bp = d1.ex[1], sq = d1.ex[0];
      const n0 = sessionsOf(p, ${Q}).length;
      const sqHist = exHistory(p, b, sq, 'd1', 4);
      const bpBefore = exHistory(p, b, bp, 'd1', 4);
      const t0 = targetNow(p, b, d1, bp, 5);
      const rows = entry(p, 'A', 4, 'd1', 'bp', 2);
      rows[0].w = '62,5'; rows[0].r = '10'; rows[0].ts = Date.now(); rows[0].done = true;
      save(cardScope(p, 4, 'd1', 'bp'));
      const after = sessionsOf(p, ${Q});
      const t1 = targetNow(p, b, d1, bp, 5);
      return JSON.stringify({
        n0: n0, n1: after.length, last: after[after.length - 1].week,
        rule: exHistory(p, b, bp, 'd1', 5).length,
        target: [t0.sessions, t1.sessions],
        keptOther: exHistory(p, b, sq, 'd1', 4) === sqHist,
        keptBefore: exHistory(p, b, bp, 'd1', 4) === bpBefore,
      });
    })()`));
    ok('a ticked set is read by the very next sessionsOf, exHistory and targetNow (the draw\'s objetivo too)',
       tick.n1 === tick.n0 + 1 && tick.last === 4 && tick.rule === 4 && tick.target[0] === 3 && tick.target[1] === 4,
       JSON.stringify(tick));
    ok('...and the tick keeps what cannot see it: another lift\'s history and this lift\'s history before the week',
       tick.keptOther && tick.keptBefore, JSON.stringify(tick));

    /* Typing into a ticked set, and a reserve typed on an earlier week —
       the card of week 2, reached by the week selector — which a question
       cut off at week 4 can see, so it goes. */
    const typed = JSON.parse(call(`(function () {
      const p = cacheFixture(), b = p.blocks.A, bp = b.days[0].ex[1];
      p.rir.A = { [slot(2, 'd1')]: { bp: '3' } };
      logChanged();
      const w0 = sessionsOf(p, ${Q})[2].sets[0].w;
      const rir0 = exHistory(p, b, bp, 'd1', 4)[1].sets.map(s => s.rir);
      const rows3 = entry(p, 'A', 3, 'd1', 'bp', 2);
      rows3[0].w = '65';
      save(cardScope(p, 3, 'd1', 'bp'));
      const w1 = sessionsOf(p, ${Q})[2].sets[0].w;
      const rows2 = entry(p, 'A', 2, 'd1', 'bp', 2);
      rows2[1].rir = '0';
      dropLegacyRir(p, 'A', 2, 'd1', 'bp');
      save(cardScope(p, 2, 'd1', 'bp'));
      return JSON.stringify({ w: [w0, w1], rir: [rir0, exHistory(p, b, bp, 'd1', 4)[1].sets.map(s => s.rir)] });
    })()`));
    ok('a typed weight and a typed RIR (legacy map dropped beside it) are read at once, on any week the question reaches',
       typed.w[0] === 60 && typed.w[1] === 65 &&
       JSON.stringify(typed.rir) === JSON.stringify([[3, 3], [0, 0]]), JSON.stringify(typed));

    /* Every other write goes through commit() or a bare save(), which claim
       nothing and so drop everything. One case per kind of write the audit
       in plans/045 lists, each through the app's own helper. */
    const broad = JSON.parse(call(`(function () {
      const out = {};
      const read = (p, q) => JSON.stringify(sessionsOf(p, q || ${Q}).map(s => [s.week, s.day, s.sets.map(x => [x.w, x.extra])]));
      let p = cacheFixture(); let before = read(p);
      p.log.A[slot(4, 'd1')] = { bp: [{ w: '70', r: '8', done: true, ts: Date.now() }] };  /* copyPrev + a tick, as one broad write */
      commit(); out.write = before !== read(p) && sessionsOf(p, ${Q}).length === 4;
      p = cacheFixture(); before = read(p);
      purgeRecord(p, 'A', { day: 'd1', week: 3 });  /* clearDay */
      commit(); out.clearDay = sessionsOf(p, ${Q}).length === 2;
      p = cacheFixture(); read(p);
      purgeRecord(p, 'A', { day: 'd1', exercise: 'bp' }); commit(); out.purge = sessionsOf(p, ${Q}).length === 0;
      p = cacheFixture(); read(p);
      moveExerciseRecord(p, 'A', 'd1', 'd2', 'bp'); commit(); out.move = sessionsOf(p, ${Q}).every(s => s.day === 'd2');
      p = cacheFixture(); read(p);
      /* The plan editor lands a clone of the block: one set fewer makes the
         second logged set an extra one. */
      const clone = JSON.parse(JSON.stringify(p.blocks.A)); clone.days[0].ex[1].sets = 1;
      p.blocks.A = clone; commit(); out.sets = sessionsOf(p, ${Q})[0].sets.map(x => x.extra).join() === 'false,true';
      p = cacheFixture(); read(p, { weeks: 'logged', lift: { id: 'bp' }, skipDeload: true });
      p.blocks.A.deload = 2; commit();
      out.deload = sessionsOf(p, { weeks: 'logged', lift: { id: 'bp' }, skipDeload: true }).map(s => s.week).join() === '1,3';
      p = cacheFixture(); read(p);
      p.blocks.B = { id: 'B', name: 'B', weeks: 4, deload: 0, phase: {}, days: [{ id: 'x', name: 'x', ex: [{ id: 'bp', n: 'Press banca', sets: 2 }] }] };
      p.blockOrder.push('B'); p.log.B = { [slot(1, 'x')]: { bp: [{ w: '50', r: '10', done: true }] } };
      /* No save yet: a block added to blockOrder is a new question, not a stale answer. */
      out.newBlock = sessionsOf(p, ${Q}).length === 4;
      deleteBlocks(p, ['B']); out.deleteBlock = sessionsOf(p, ${Q}).length === 3;
      p = cacheFixture(); read(p);
      purgeRecord(p); commit(); out.wipe = sessionsOf(p, ${Q}).length === 0;
      return JSON.stringify(out);
    })()`));
    ok('every broad write is read at once: a written slot, clearDay, purge, move, the plan\'s set count, the deload week, a new and a deleted block, wipe',
       Object.keys(broad).length === 9 && Object.values(broad).every(Boolean), JSON.stringify(broad));

    const swapped = JSON.parse(call(`(function () {
      const out = {};
      let p = cacheFixture();
      const kg = sessionsOf(p, ${Q})[0].sets[0].w;
      /* A unit switch converts every w, and is read without any save. */
      state.prefs.units = 'lb';
      out.units = Math.abs(sessionsOf(p, ${Q})[0].sets[0].w - kg * LB_PER_KG) < 1e-9;
      state.prefs.units = 'kg';
      out.back = sessionsOf(p, ${Q})[0].sets[0].w === kg;
      /* A restore or a profile import files new objects: a new profile is
         a new cache, whatever the old one held. */
      const incoming = JSON.parse(JSON.stringify(p));
      incoming.log.A[slot(1, 'd1')].bp[0].w = '61';
      state.profiles.hombre = incoming;
      out.restore = sessionsOf(getProfile(), ${Q})[0].sets[0].w === 61;
      /* Undo puts back a snapshot of the whole state. */
      p = cacheFixture(); sessionsOf(p, ${Q});
      snapshotForUndo('x');
      purgeRecord(p, 'A', { day: 'd1', exercise: 'bp' }); commit();
      out.purged = sessionsOf(getProfile(), ${Q}).length === 0;
      undoLast();
      out.undo = sessionsOf(getProfile(), ${Q}).length === 3;
      /* A rename cuts the objetivo's history with no save of its own; the
         projection is keyed on the cut. */
      p = cacheFixture(); const b = p.blocks.A, bp = b.days[0].ex[1];
      const h0 = exHistory(p, b, bp, 'd1', 4).length;
      recordVariant(p, 'bp', 'Press banca', 'Press inclinado', Date.now());
      out.variant = h0 === 3 && exHistory(p, b, bp, 'd1', 4).length === 0;
      return JSON.stringify(out);
    })()`));
    ok('a unit switch, a restored or imported profile, undo and a rename are read at once, with no save in between for the first two',
       Object.keys(swapped).length === 6 && Object.values(swapped).every(Boolean), JSON.stringify(swapped));

    const views = JSON.parse(call(`(function () {
      const p = cacheFixture();
      const a = sessionsOf(p, ${Q});
      p.week = 5; save('view');
      const kept = sessionsOf(p, ${Q}) === a;
      p.day = 1; commit('view');
      return JSON.stringify({ kept: kept, keptCommit: sessionsOf(p, ${Q}) === a });
    })()`));
    ok('a change of week or day (save/commit with "view") keeps every answer', views.kept && views.keptCommit, JSON.stringify(views));
  } finally {
    call('render = __realRender;');
  }

  /* A 'view' claim is the one way to say a write reached nothing a session
     reads, and a wrong one is a stale objetivo that nothing else would
     catch. So the list of them is pinned: a new one fails here until it
     is added below, in the same diff that adds it, where a reviewer sees
     it. The scoped saves are pinned the same way, and counted by what they
     are — save() or commit() handed anything but 'view' or nothing — not by
     what the scope is called: this used to look for the literal
     `save(here)`, so a scope under any other name slipped past it. Only a
     card hands save() a slot: writeRows for every write that can start a
     session (plans/048), buildExCard itself for the three that cannot.
     commit's own save(scope) is on the list because it is the same text;
     it passes its caller's claim on and makes none. */
  const claims = [];
  SHELL_SCRIPTS.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let fn = '';
    src.split('\n').forEach(line => {
      const m = /^(?:async )?function (\w+)/.exec(line) || /^\$\('(\w+)'\)\.addEventListener/.exec(line);
      if (m) fn = m[1];
      const n = (line.match(/\b(?:save|commit)\('view'\)/g) || []).length;
      for (let i = 0; i < n; i++) claims.push(f + ':' + fn);
      /* A call, not the two definitions. */
      const s = (line.match(/(?<!function )\b(?:save|commit)\((?!'view'\)|\))/g) || []).length;
      for (let i = 0; i < s; i++) claims.push(f + ':' + fn + ':scoped');
    });
  });
  const expected = [
    'js/block-editor.js:renderBlockBar',
    'js/app.js:renderProfiles',
    'js/app.js:renderNav', 'js/app.js:renderNav', 'js/app.js:renderNav', 'js/app.js:renderNav',
    'js/app.js:days',
    'js/app.js:commit:scoped',
    'js/app.js:buildExCard',
    ...Array(3).fill('js/app.js:buildExCard:scoped'),
    'js/app.js:openExMenu',
    'js/app.js:drawOrderNote', 'js/app.js:drawEnergy', 'js/app.js:drawSessionNote',
    'js/app.js:writeRows:scoped',
    'js/app.js:recordTargetOnStart',
  ];
  ok('the writes that claim to reach no session, or one slot, are exactly the ones plans/045 audited',
     JSON.stringify(claims) === JSON.stringify(expected), JSON.stringify(claims));
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

console.log('\n== EX_FIELDS: what a plan exercise may hold, in one table (plans/055) ==');
{
  const fields = JSON.parse(call(`JSON.stringify(EX_FIELDS.map(f => ({ key: f.key, max: f.max, ownMax: f.ownMax,
    accept: typeof f.accept === 'function', repair: typeof f.repair === 'function', prompt: typeof f.prompt === 'function' })))`));
  const keys = fields.map(f => f.key);
  ok('every field but the id says how it is accepted and how migrate() repairs it; the id is identity, left to the code that files the exercise',
     fields.length === 17 && fields.every(f => (f.key === 'id' ? !f.accept && !f.repair : f.accept && f.repair)), JSON.stringify(fields));
  const promptOrder = JSON.parse(call('JSON.stringify(EX_PROMPT_ORDER)'));
  const prompted = fields.filter(f => f.prompt).map(f => f.key);
  ok('EX_PROMPT_ORDER names every field with a prompt line exactly once, and nothing else',
     promptOrder.length === prompted.length && new Set(promptOrder).size === promptOrder.length &&
     prompted.every(k => promptOrder.includes(k)), JSON.stringify({ promptOrder, prompted }));

  /* Decision 6, the row codec's guard for an exercise: every field the
     code writes onto one — `ex.x = …` or `delete …ex.x` — has to be one the
     table declares, or migrate() would never repair it and a restore would
     drop it. `ex` is the name every writer in the repo gives an exercise
     (the plan editor's save gate was the one that did not, and was renamed
     for this). The importer writes through acceptExercise, so its output
     is checked by running it with every field set, on both paths, and so
     is newExercise()'s literal. Comments, strings and regex literals are
     blanked first (codeOnly): they discuss fields. */
  const written = new Set();
  fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).forEach(f => {
    const code = codeOnly(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
    for (const m of code.matchAll(/\bex\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) written.add(m[1]);
    for (const m of code.matchAll(/\bdelete\s+(?:[\w$]+\.)*ex\.([A-Za-z_$][\w$]*)/g)) written.add(m[1]);
  });
  const unknown = [...written].filter(k => !keys.includes(k));
  ok('every exercise field the code writes is in EX_FIELDS, so migrate() repairs it and a restore keeps it',
     written.size >= 12 && unknown.length === 0, 'written: ' + [...written].join(',') + ' unknown: ' + unknown.join(','));
  const made = JSON.parse(call(`JSON.stringify((function () {
    const every = { id: 'e', n: 'Ex', reps: '8', sets: 3, rest: 60, alt: 'a', cue: 'c', setup: 's', add: 2,
                    inc: 2.5, minRir: 1, share: 1, ss: 1, muscle: 'm', pattern: 'p', type: 't', off: 1, extra: 'x' };
    const raw = { name: 'B', days: [{ name: 'D', ex: [every] }] };
    return {
      own: Object.keys(normalizeImportedBlock(raw, { own: true }).days[0].ex[0]),
      paste: Object.keys(normalizeImportedBlock(raw).days[0].ex[0]),
      fresh: Object.keys(newExercise()),
    };
  })())`));
  ok('what the importer writes on an exercise is the table, in it and nothing else: a restore keeps every field, a paste all but `off`',
     JSON.stringify(made.own.slice().sort()) === JSON.stringify(keys.slice().sort()) &&
     JSON.stringify(made.paste.slice().sort()) === JSON.stringify(keys.filter(k => k !== 'off').sort()),
     JSON.stringify(made));
  ok('...in the key order an imported exercise has always had',
     made.own.join() === 'id,n,reps,sets,rest,alt,cue,setup,add,inc,minRir,share,ss,muscle,pattern,type,off', made.own.join());
  ok('...and newExercise() writes nothing the table does not declare',
     made.fresh.every(k => keys.includes(k)), made.fresh.join());

  /* Decision 3: the own path takes text past the importers' lengths, up
     to OWN_TEXT_LIMIT, in every field the plan editor never capped, since
     text saved before it stopped there can be any length; a paste keeps
     IMPORT_LIMITS, and the fields the app always held to one length keep
     it on every path. The text has single spaces and no blank ends, so
     txt() has nothing else to change and the lengths say it all. */
  const lens = JSON.parse(call(`JSON.stringify((function () {
    const at = n => 'palabra '.repeat(Math.ceil(n / 8) + 1).slice(0, n).replace(/ $/, 'x');
    const L = IMPORT_LIMITS, B = OWN_TEXT_LIMIT;
    const raw = { name: at(90), weeks: 8, days: [{ id: 'd', name: at(90), pair: at(L.pair + 1), ex: [
      { id: 'e', n: at(147), alt: at(L.alt + 1), cue: at(450), reps: at(L.reps + 9),
        setup: at(SETUP_LIMIT + 50), muscle: at(MUSCLE_LIMIT + 5) },
      { id: 'f', n: at(B), alt: at(B), cue: at(B + 1), reps: at(B) },
    ] }] };
    const len = b => [b.name.length, b.days[0].name.length, b.days[0].pair.length].concat(...b.days[0].ex.map(e =>
      [e.n.length, e.alt.length, e.cue.length, e.reps.length, e.setup ? e.setup.length : 0, e.muscle ? e.muscle.length : 0]));
    const own = normalizeImportedBlock(JSON.parse(JSON.stringify(raw)), { own: true });
    return { own: len(own), paste: len(normalizeImportedBlock(JSON.parse(JSON.stringify(raw)))),
             whole: own.days[0].ex[0].cue === raw.days[0].ex[0].cue && own.name === raw.name };
  })())`));
  ok('a restore keeps a name, alternative, cue, rep range, day name, pair note and block name past the paste limits, whole',
     lens.own.join() === '90,90,1001,147,201,450,49,200,40,2000,2000,2000,2000,0,0' && lens.whole, lens.own.join());
  ok('...a paste still cuts each of them to IMPORT_LIMITS',
     lens.paste.join() === '80,80,1000,120,200,400,40,200,40,120,200,400,40,0,0', lens.paste.join());

  /* Decision 4: migrate() repairs every field from the table, including
     the ones it used to skip — `add` (a whole number of weeks, held to the
     block, dropped otherwise), the text (cut at the own bound, anything
     not text read the way a restore reads it) and the flags (1 or absent).
     What the app's own writers put there comes through untouched: the
     name typed with double spaces and a blank end, below, is not
     rewritten. */
  const repaired = JSON.parse(call(`JSON.stringify((function () {
    const s = defaultState(), b = s.profiles.hombre.blocks['block-1'], ex = b.days[0].ex;
    b.weeks = 8;
    Object.assign(ex[0], { add: 2.5, share: true, ss: 0 });
    Object.assign(ex[1], { add: '3', off: 'sí' });
    Object.assign(ex[2], { add: 20 });
    Object.assign(ex[3], { add: { toString: null }, n: 'x'.repeat(OWN_TEXT_LIMIT + 500), alt: 7, cue: { toString: null }, reps: '' });
    Object.assign(ex[4], { n: '  Press  de banca ', alt: null, cue: false, reps: 12, off: 0 });
    delete ex[5].n; delete ex[5].reps;
    state = s; migrate();
    return state.profiles.hombre.blocks['block-1'].days[0].ex.slice(0, 6);
  })())`));
  const [r0, r1, r2, r3, r4, r5] = repaired;
  ok('migrate() drops an `add` that is not a whole number of weeks, reads "3" as 3, and holds 20 to the block\'s 8',
     !('add' in r0) && r1.add === 3 && r2.add === 8 && !('add' in r3), JSON.stringify([r0.add, r1.add, r2.add, r3.add]));
  ok('...stores a flag as 1 or not at all',
     r0.share === 1 && !('ss' in r0) && r1.off === 1 && !('off' in r4), JSON.stringify([r0.share, r0.ss, r1.off, r4.off]));
  ok('...cuts a name at OWN_TEXT_LIMIT and reads a value that is not text the way a restore does',
     r3.n.length === call('OWN_TEXT_LIMIT') && r3.alt === '7' && r3.cue === '' && r3.reps === '10–15' &&
     !('alt' in r4) && !('cue' in r4) && r4.reps === '12', JSON.stringify([r3.n.length, r3.alt, r3.cue, r3.reps, r4.alt, r4.cue, r4.reps]));
  ok('...gives an exercise with no name a blank one, the box the editor shows, and a missing range the default',
     r5.n === '' && r5.reps === '10–15', JSON.stringify([r5.n, r5.reps]));
  ok('...and never rewrites text the app\'s own writers could have put there',
     r4.n === '  Press  de banca ', JSON.stringify(r4.n));

  /* Decision 7: one rule for the plate list, read the same by the load and
     by "Guardar" in Ajustes (pressed through bootApp further down). */
  ok('cleanPlates reads a comma decimal, keeps the unit\'s bounds, each size once, in the order given',
     call('JSON.stringify(cleanPlates(["20", "0,25", "20", "x", "0.1", "51", 10], "kg"))') === '[20,0.25,10]',
     call('JSON.stringify(cleanPlates(["20", "0,25", "20", "x", "0.1", "51", 10], "kg"))'));
  ok('...and migrate() falls back to the unit\'s defaults when nothing is left of a list',
     call('state = ' + JSON.stringify({ profiles: {}, prefs: { units: 'lb', plates: ['x', 0, 500] } }) +
          '; migrate(); JSON.stringify(state.prefs.plates) === JSON.stringify(DEFAULT_PLATES.lb)'));
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
    /* A row's sessions are the objetivo's since plans/056, deloadAt and all. */
    const weeks = liftHistory(p, block, block.days[0].ex[0], 'd1', MAX_WEEKS + 1, 'A').sessions.map(s => s.week);
    /* Week 4 dropped for the index: with nothing after it, the deload is
       the last week logged, which is exactly where it must not be read. */
    delete p.log.A[slot(4, 'd1')];
    return JSON.stringify({
      weeks: weeks,
      series: strengthByExercise(p, block).bp.map(v => v != null),
      rows: strengthRows(p, block).map(r => ({ base: r.base, last: r.lastWeek })),
    });
  })()`));
  ok('a Diagnóstico row leaves out a week the phase text calls "Descarga", not only the block\'s deload week',
     handDeload.weeks.join('|') === '1|2|4', JSON.stringify(handDeload.weeks));
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
     different reading of it: a point's ts is the LATEST tick, not the
     session date (which is the median). Its RIR is per set since
     plans/044 — the legacy chip spread over every working set by the
     inheritance rule, which is what the one chip always meant. */
  const kept = JSON.parse(call(`(function () {
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, days: [{ id: 'd1', ex: [{ id: 'bp' }] }] }],
      sessions: [{ block: 'A', week: 1, day: 'd1', lift: 'bp', rir: '2+',
                   sets: [[50, 8, { ts: 1000 }], [50, 8, { ts: 2000 }], [50, 8, { ts: 900000 }]] }] });
    const pt = diagPoints(liftHistory(p, p.blocks.A, p.blocks.A.days[0].ex[0], 'd1', MAX_WEEKS + 1, 'A').sessions)[0];
    return JSON.stringify({ ts: pt.ts, rirs: pt.rirs, ticked: pt.ticked.length });
  })()`));
  ok('a point still carries the latest tick as its ts, and the legacy chip spread over every set',
     kept.ts === 900000 && kept.rirs.join(',') === '2,2,2' && kept.ticked === 3, JSON.stringify(kept));
}

console.log('\n== one history per Diagnóstico row: the row reads the sessions the objetivo reads (plans/056) ==');
{
  /* A row's trend read the objetivo's own history (exHistory) while its
     count, its three-session gate, its gap, its three signals and its work
     axis read a second choice of sessions: the block's own weeks only, both
     days of a lift the plan splits, every block in the list, and everything
     since before a rename. The second architecture review found the two
     disagreeing in public, and the block review's AI document copying it.
     Each case below was written to fail against the two histories. Day ids
     are the days' names here: sessionFixture names a day after its id. */
  const split = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 30 * DAY;
    const three = (kg, ts) => [0, 1, 2].map(() => [kg, 10, { rir: '1', ts: ts }]);
    const sessions = [];
    for (let w = 1; w <= 4; w++) {
      const mon = start + (w - 1) * 7 * DAY, thu = mon + 3 * DAY;
      sessions.push({ block: 'A', week: w, day: 'Empuje', lift: 'bp', sets: three(60 + 2.5 * (w - 1), mon) });
      sessions.push({ block: 'A', week: w, day: 'Empuje', lift: 'ohp', sets: three(40, mon) });
      sessions.push({ block: 'A', week: w, day: 'Pierna', lift: 'bp', sets: three(60 - 4 * (w - 1), thu) });
    }
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, days: [
      { id: 'Empuje', ex: [{ id: 'bp', n: 'Press banca' }, { id: 'ohp', n: 'Press militar' }] },
      { id: 'Pierna', ex: [{ id: 'bp', n: 'Press banca' }] } ] }], sessions: sessions });
    Object.assign(p, { week: 5, notes: {}, energy: {} });
    const block = p.blocks.A;
    const rows = diagRows(p, block, 'block');
    return JSON.stringify({
      rows: rows.filter(r => r.id === 'bp')
        .map(r => ({ label: r.label, day: r.day, sessions: r.sessions, trend: r.trend, lectura: r.lectura })),
      plain: rows.filter(r => r.id === 'ohp').map(r => r.label),
      trends: block.days.map(d => exHistory(p, block, d.ex[0], d.id, MAX_WEEKS + 1, 'A').length),
      lines: reviewText(buildBlockReview(p, block)).split('\\n').filter(l => l.indexOf('- «Press banca»') === 0),
    });
  })()`));
  /* The review's case, verbatim: climbing on Empuje, falling on Pierna,
     every week. It read "Funciona" over six sessions, and the trend behind
     that was fitted on the four Empuje ones. */
  ok('a lift the plan puts on two days is two rows, each tagged with its day',
     split.rows.length === 2 &&
       split.rows.map(r => r.label).sort().join(' | ') === 'Press banca · Empuje | Press banca · Pierna',
     JSON.stringify(split.rows));
  ok('...while a lift on one day keeps its plain name', split.plain.join() === 'Press militar', JSON.stringify(split.plain));
  const upRow = split.rows.find(r => r.day === 'Empuje') || {}, downRow = split.rows.find(r => r.day === 'Pierna') || {};
  ok('...each counting the sessions of its own day, the ones its trend is fitted on',
     split.trends.join(',') === '4,4' && upRow.sessions === 4 && downRow.sessions === 4, JSON.stringify(split));
  ok('...so climbing on one day and falling on the other no longer reads "Funciona" over six sessions',
     upRow.trend === 'up' && downRow.trend === 'down' && downRow.lectura !== 'Funciona' &&
       !split.rows.some(r => r.sessions === 6), JSON.stringify(split.rows));
  const lineOf = day => split.lines.find(l => l.indexOf('(«' + day + '»)') > 0) || '';
  ok('the block review\'s AI document lists both rows, each with its own day, count and RIR tally',
     split.lines.length === 2 &&
       ['Empuje', 'Pierna'].every(d => lineOf(d).indexOf('sobre 4 sesiones') > 0 &&
                                       lineOf(d).indexOf('RIR apuntado: 1 en 12 series (de 12)') > 0) &&
       lineOf('Empuje').indexOf('tendencia subiendo') > 0 && lineOf('Pierna').indexOf('tendencia bajando') > 0,
     JSON.stringify(split.lines));

  /* The signals read the same sessions as the count: the weight came off to
     finish the last set of the last Empuje session, and that is Empuje's
     news. Read over both days, the last session was a clean Pierna one. */
  const splitSignal = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 20 * DAY;
    const sessions = [];
    for (let w = 1; w <= 3; w++) ['Empuje', 'Pierna'].forEach((day, i) => {
      const ts = start + ((w - 1) * 7 + 3 * i) * DAY;
      const sets = [0, 1, 2].map(() => [40, 12, { ts: ts }]);
      if (w === 3 && day === 'Empuje') Object.assign(sets[2][2], { dk: 'forced', d: [{ w: '30', r: '4' }] });
      sessions.push({ block: 'A', week: w, day: day, lift: 'bp', sets: sets });
    });
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, days: [
      { id: 'Empuje', ex: [{ id: 'bp', n: 'Press banca' }] },
      { id: 'Pierna', ex: [{ id: 'bp', n: 'Press banca' }] } ] }], sessions: sessions });
    p.week = 4;
    const byDay = {};
    diagRows(p, p.blocks.A, 'block').filter(r => r.id === 'bp').forEach(r => { byDay[r.day] = r.trend + ' | ' + r.lectura; });
    return JSON.stringify(byDay);
  })()`));
  ok('a forced drop on one day\'s last session is read on that day\'s row, and only there',
     splitSignal.Empuje === 'flat | Fatiga, no falta de esfuerzo' &&
       splitSignal.Pierna === 'flat | Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
     JSON.stringify(splitSignal));

  /* The review's other case: six sessions, renamed on the day of the fourth,
     so the objetivo has read three since. */
  const renamed = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 45 * DAY;
    const ts = i => start + i * 7 * DAY;
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, days: [{ id: 'Espalda', ex: [{ id: 'row', n: 'Remo con barra' }] }] }],
      sessions: [0, 1, 2, 3, 4, 5].map(i => ({ block: 'A', week: i + 1, day: 'Espalda', lift: 'row',
        sets: [0, 1, 2].map(() => [50 + i, 10, { ts: ts(i) }]) })) });
    Object.assign(p, { week: 7, notes: {}, energy: {} });
    p.variants.row = [{ n: 'Remo en máquina', since: '1970-01-01' }, { n: 'Remo con barra', since: isoDay(ts(3)) }];
    const block = p.blocks.A;
    return JSON.stringify({
      sessions: diagRows(p, block, 'block').find(r => r.id === 'row').sessions,
      trend: exHistory(p, block, block.days[0].ex[0], 'Espalda', MAX_WEEKS + 1, 'A').length,
      line: reviewText(buildBlockReview(p, block)).split('\\n').find(l => l.indexOf('- «Remo con barra»') === 0) || '',
    });
  })()`));
  ok('a renamed lift counts its sessions from the rename, the ones its trend is fitted on',
     renamed.trend === 3 && renamed.sessions === 3, JSON.stringify(renamed));
  ok('...and the AI document quotes that count', renamed.line.indexOf('sobre 3 sesiones') > 0, renamed.line);

  /* A block shortened to four weeks after six were logged: the objetivo
     still reads weeks 5 and 6 (CONTEXT.md, "stranded week"), and the last
     of them ran out of reps. */
  const stranded = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 42 * DAY;
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 4, days: [{ id: 'Pierna', ex: [{ id: 'sq', n: 'Sentadilla' }] }] }],
      sessions: [1, 2, 3, 4, 5, 6].map(w => ({ block: 'A', week: w, day: 'Pierna', lift: 'sq',
        sets: (w === 6 ? [12, 9, 8] : [12, 12, 12]).map(r => [40, r, { ts: start + (w - 1) * 7 * DAY }]) })) });
    Object.assign(p, { week: 4, notes: {}, energy: {} });
    const block = p.blocks.A;
    const rows = ['block', 'all'].map(s => diagRows(p, block, s).find(r => r.id === 'sq'));
    return JSON.stringify({
      sessions: rows.map(r => r.sessions), lectura: rows[0].lectura,
      trend: exHistory(p, block, block.days[0].ex[0], 'Pierna', MAX_WEEKS + 1, 'A').length,
      line: reviewText(buildBlockReview(p, block)).split('\\n').find(l => l.indexOf('- «Sentadilla»') === 0) || '',
    });
  })()`));
  ok('weeks stranded above a shortened block count on the row, in both scopes, as they do for the objetivo',
     stranded.trend === 6 && stranded.sessions.join(',') === '6,6', JSON.stringify(stranded));
  ok('...and the signals read them: the row\'s last session is the stranded one that ran out of reps',
     stranded.lectura === 'Primera serie al fallo — las de después se vacían', stranded.lectura);
  ok('...and the AI document quotes that count', stranded.line.indexOf('sobre 6 sesiones') > 0, stranded.line);

  /* Two more readings the second history had of its own, beyond the
     review's three: it dropped a session whose every set ran past
     EST_MAX_REPS, which the level has always read (as a floor), and it
     read every block in the list on "Todos los bloques", where the trend
     stops at the block on screen. */
  const highReps = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 30 * DAY;
    const p = sessionFixture({ blocks: [{ id: 'A', weeks: 8, days: [
      { id: 'Pierna', ex: [{ id: 'calf', n: 'Gemelo de pie', reps: '15-20' }] }] }],
      sessions: [1, 2, 3, 4].map(w => ({ block: 'A', week: w, day: 'Pierna', lift: 'calf',
        sets: [0, 1, 2].map(() => [60 + 5 * w, 18, { ts: start + (w - 1) * 7 * DAY }]) })) });
    p.week = 5;
    const block = p.blocks.A;
    const row = diagRows(p, block, 'block').find(r => r.id === 'calf');
    return JSON.stringify({ sessions: row.sessions, trend: row.trend,
      history: exHistory(p, block, block.days[0].ex[0], 'Pierna', MAX_WEEKS + 1, 'A').length });
  })()`));
  ok('a lift trained past fifteen reps is judged on the sessions its trend reads, not left without any',
     highReps.history === 4 && highReps.sessions === 4 && highReps.trend === 'up', JSON.stringify(highReps));
  const later = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 60 * DAY;
    const plan = id => ({ id: id, weeks: 4, days: [{ id: 'Empuje', ex: [{ id: 'bp', n: 'Press banca' }] }] });
    const sessions = [];
    ['A', 'B'].forEach((b, bi) => [1, 2, 3].forEach(w => sessions.push({ block: b, week: w, day: 'Empuje', lift: 'bp',
      sets: [0, 1, 2].map(() => [60 + bi * 10 + w, 10, { ts: start + (bi * 4 + w - 1) * 7 * DAY }]) })));
    const p = sessionFixture({ blocks: [plan('A'), plan('B')], sessions: sessions });
    p.week = 4;
    return JSON.stringify({ sessions: diagRows(p, p.blocks.A, 'all').find(r => r.id === 'bp').sessions,
      history: exHistory(p, p.blocks.A, p.blocks.A.days[0].ex[0], 'Empuje', MAX_WEEKS + 1, '').length });
  })()`));
  ok('"Todos los bloques" on an earlier block counts the blocks up to it, as its trend does — not the one after',
     later.history === 3 && later.sessions === 3, JSON.stringify(later));

  /* Every row of a profile with all of the above at once — a split lift, a
     rename, stranded weeks, a lift past fifteen reps, a block after the one
     on screen — in both scopes: its count and its gap are the trend's own
     sessions, found here from exHistory's answer and the stored rows
     directly rather than through anything the row is built from. */
  const everyRow = JSON.parse(call(`(function () {
    const DAY = 864e5, start = Date.now() - 150 * DAY;
    const plan = id => ({ id: id, weeks: 6, days: [
      { id: 'Empuje', ex: [{ id: 'bp', n: 'Press banca' }, { id: 'ohp', n: 'Press militar' }] },
      { id: 'Pierna', ex: [{ id: 'sq', n: 'Sentadilla' }, { id: 'bp', n: 'Press banca' },
                           { id: 'calf', n: 'Gemelo', reps: '15-20' }] } ] });
    const sessions = [];
    let t = 0;
    ['A', 'B', 'C'].forEach(b => {
      for (let w = 1; w <= (b === 'A' ? 6 : 4); w++) ['Empuje', 'Pierna'].forEach(day => {
        t += 2 + (w % 3);
        (day === 'Empuje' ? ['bp', 'ohp'] : ['sq', 'bp', 'calf']).forEach((lift, k) => sessions.push({
          block: b, week: w, day: day, lift: lift,
          sets: [0, 1, 2].map(i => [50 + w + k, lift === 'calf' ? 17 : 10 - i, { ts: start + t * DAY + i * 60000 }]) }));
      });
    });
    const p = sessionFixture({ blocks: [plan('A'), plan('B'), plan('C')], sessions: sessions });
    p.blocks.A.weeks = 4;
    p.week = 4;
    /* Renamed a week into B: its last three sessions are the new variant. */
    p.variants.ohp = [{ n: 'Press militar con barra', since: '1970-01-01' }, { n: 'Press militar', since: isoDay(start + 44 * DAY) }];
    const block = p.blocks.B;
    const out = [];
    ['block', 'all'].forEach(scope => diagRows(p, block, scope).forEach(r => {
      const day = block.days.find(d => d.name === r.day);
      const ex = day.ex.find(e => e.id === r.id);
      const hist = exHistory(p, block, ex, day.id, MAX_WEEKS + 1, scope === 'all' ? '' : block.id).slice(-DIAG_WINDOW);
      const stamps = hist.map(s => ({ ts: p.log[s.blockId][slot(s.week, s.dayId)][r.id]
        .reduce((m, x) => (x && x.done && +x.ts > m ? +x.ts : m), 0) }));
      out.push({ scope: scope, row: r.id + ' · ' + r.day, sessions: r.sessions, gap: r.gap,
                 want: { sessions: hist.length, gap: diagMedianGap(stamps) } });
    }));
    return JSON.stringify(out);
  })()`));
  const off = everyRow.filter(x => x.sessions !== x.want.sessions || x.gap !== x.want.gap);
  ok('every row\'s count and gap come from the sessions its trend is fitted on, in both scopes',
     everyRow.length === 10 && off.length === 0, everyRow.length + ' rows; ' + JSON.stringify(off.slice(0, 3)));
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
  /* One turn of the event loop: every promise the app has settled by now
     has run what it was waiting on. */
  const settle = () => new Promise(r => setImmediate(r));

  /* Most of this file calls the app's functions on `app`, which never
     booted, so what a person presses is out of its reach. Each test here
     boots the shell (bootApp, plans/052), presses the app's own button —
     the card's tick, "Rellenar", "Borrar este día" — and reads back what it
     did to the data: the rows, the profile's record, and what save()
     wrote, read the way the next open reads it, by booting again from it.
     What a person would see stays in test/smoke.js. */
  console.log('\n== bootApp(): the shell booted for real, and its own handlers (plans/052) ==');
  const firstRun = bootApp();
  ok('a first run boots: load() draws the day, so ready is true and frozen false',
     firstRun.call('ready') === true && firstRun.call('frozen') === false,
     'ready ' + firstRun.call('ready') + ', frozen ' + firstRun.call('frozen'));
  ok('...with a card for every exercise of the day, which loadApp()\'s document never gets as far as',
     firstRun.call('dayCards.length') > 0 && firstRun.call('dayCards.length') === firstRun.call('exList(currentDay()).length'),
     firstRun.call('dayCards.length') + ' cards');
  const unsaved = firstRun.saved();
  firstRun.clock.advance(1000);
  ok('...and load()\'s write-back reaches storage when save()\'s debounce runs out on the fake clock, and not before',
     unsaved === null && !!firstRun.saved() && firstRun.saved().setupDone === false,
     JSON.stringify({ before: unsaved, after: !!firstRun.saved() }));

  /* What a phone holds once the app has been opened and set up: the first
     run's own write-back, with setup done. Every boot below starts from a
     copy, so none of them sees another's writes. */
  const SEED = JSON.stringify(Object.assign(firstRun.saved(), { setupDone: true }));
  /* The seed with the first day of the active block logged in week 1 —
     every exercise, every planned set, ticked a week before the boot — and
     the profile moved to `at`. One session behind it is all the objetivo
     needs to answer for week 2. `edit` is handed the profile and the block
     for anything else a test wants on file before the boot.

     A seventh history builder, and deliberately not sessionFixture
     (plans/052): this section's whole point is a fresh boot's migrate()
     seeing exactly what a real save() writes, so the seed has to be one —
     firstRun's own, not a hand-assembled guess at the shape — and it reads
     the active block's days and exercises off SEED itself rather than
     declaring them, so it stays true to defaultState() instead of a
     second, hand-copied plan that could quietly drift from it.
     sessionFixture's `install` does leave state in a shape bootApp()
     could seed, for a case that wants a synthetic history rather than the
     real default block; nothing below needs that. */
  const seeded = (at, edit) => {
    const s = JSON.parse(SEED), p = s.profiles[s.activeProfile], b = p.blocks[p.activeBlock];
    const day = b.days[0], filed = {};
    day.ex.forEach((ex, i) => {
      filed[ex.id] = Array.from({ length: ex.sets }, (_, k) =>
        ({ w: String(40 + 5 * i), r: '10', done: true, ts: BOOT_TIME - 7 * 864e5 + k * 60000 }));
    });
    p.log = { [b.id]: { ['w1-' + day.id]: filed } };
    Object.assign(p, at);
    if (edit) edit(p, b);
    return s;
  };
  /* Booted, with load()'s own write-back already landed: otherwise that
     pending save would carry whatever a press changed to storage, and a
     press that saves nothing would pass for one that does. */
  const settled = state => {
    const boot = bootApp({ state });
    boot.clock.advance(1000);
    return boot;
  };
  /* The next open of the app, from whatever save() left in storage: a
     save that never landed opens as a first run, which no test below
     mistakes for its own data. */
  const reopen = boot => bootApp({ state: boot.saved() || undefined });

  /* One tick on the real card: the first set of the day's first exercise,
     nothing typed into it, so that everything below is the tick's own
     doing — a box typed into first is a write of its own, which starts the
     session and schedules the save before the tick is pressed. With a
     session behind it the card was drawn with an objetivo, so the empty
     weight box was showing the objetivo's weight for that set, and the tick
     takes it; the rep and RIR boxes it leaves as they were, since a count
     nobody reported is not a measurement. Pinned until now as tickRow and
     setHints each on its own (plans/048). */
  {
    const boot = settled(seeded({ week: 2, day: 0 }));
    const want = JSON.parse(boot.call(`JSON.stringify((function () {
      const p = getProfile(), day = currentDay(), t = targetNow(p, getBlock(), day, exList(day)[0], p.week);
      return t ? { w: loadText(t.sets[0].w), sets: t.sets.map(x => x.w) } : { w: 'no objetivo', sets: null };
    })())`));
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const p = getProfile(), b = getBlock(), k = slot(p.week, currentDay().id), id = exList(currentDay())[0].id;
      const rec = ((p.obj[b.id] || {})[k] || {})[id];
      return { row: (((p.log[b.id] || {})[k] || {})[id] || [])[0] || null, record: rec ? rec.sets.map(x => x.w) : null };
    })())`));
    const at = boot.clock.now;
    let err = '', resting = false;
    try {
      boot.card(0).set(0).tick.onclick();
      resting = boot.call('tId') !== null;
    } catch (e) { err = e.message; }
    const got = read(boot);
    ok('a tick on the real card writes its set: done, at the clock\'s time, with the objetivo\'s weight its empty box showed — and no reps or RIR',
       !err && !!got.row && got.row.w === want.w && got.row.done === true && got.row.ts === at && got.row.r === '' && !('rir' in got.row),
       err || JSON.stringify({ want: want.w, row: got.row }));
    ok('...and, as the session\'s first write, files the objetivo that was on screen as its record',
       !!want.sets && JSON.stringify(got.record) === JSON.stringify(want.sets), JSON.stringify({ want: want.sets, record: got.record }));
    boot.clock.advance(1000);
    const back = read(reopen(boot));
    ok('...and save() writes both, as the next open reads them',
       JSON.stringify(back) === JSON.stringify(got), JSON.stringify(back));
    boot.clock.advance((boot.card(0).ex.rest + 185) * 1000);
    ok('the tick started the real rest timer on the fake clock, and it stops itself three minutes over: no timer is left to hold Node open',
       resting && boot.call('tId') === null && boot.clock.pending() === 0,
       'started ' + resting + ', running ' + (boot.call('tId') !== null) + ', timers left ' + boot.clock.pending());
  }

  /* "Rellenar con el objetivo" (#copyPrev) on a week with a session behind
     it: each set box of every exercise on the day gets the objetivo's
     weight for that set, nothing is ticked, and — since writing them starts
     the session, with no tick — the objetivo each exercise got is filed as
     its record. The expectation is the rule's own answer (targetNow), asked
     before the press: the button has no rule of its own, which is its
     whole point. */
  {
    const boot = settled(seeded({ week: 2, day: 0 }));
    const want = JSON.parse(boot.call(`JSON.stringify(exList(currentDay()).map(ex => {
      const p = getProfile(), t = targetNow(p, getBlock(), currentDay(), ex, p.week);
      return t ? t.sets.map(x => loadText(x.w)) : null;
    }))`));
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const p = getProfile(), b = getBlock(), k = slot(p.week, currentDay().id);
      const rows = (p.log[b.id] || {})[k] || {}, recs = (p.obj[b.id] || {})[k] || {};
      return exList(currentDay()).map(ex => ({
        w: rows[ex.id] ? rows[ex.id].map(r => r.w) : null,
        done: !!rows[ex.id] && rows[ex.id].some(r => r.done),
        record: recs[ex.id] ? recs[ex.id].sets.map(x => loadText(x.w)) : null,
      }));
    })())`));
    let err = '';
    try { boot.$('copyPrev').onclick(); } catch (e) { err = e.message; }
    const got = read(boot);
    ok('"Rellenar" writes each exercise\'s objetivo into its set boxes, set by set, and ticks nothing',
       !err && want.length > 0 && want.every(w => !!w) &&
       JSON.stringify(got.map(g => g.w)) === JSON.stringify(want) && got.every(g => !g.done),
       err || JSON.stringify({ want, got: got.map(g => g.w) }));
    ok('...and files the objetivo each exercise got as its session\'s record, since writing them started the session',
       JSON.stringify(got.map(g => g.record)) === JSON.stringify(want), JSON.stringify(got.map(g => g.record)));
    boot.clock.advance(1000);
    const back = read(reopen(boot));
    ok('...and save() writes both, as the next open reads them', JSON.stringify(back) === JSON.stringify(got), JSON.stringify(back));
  }

  /* "Borrar este día" (#clearDay) on a logged day, its question answered
     both ways, then "Deshacer" on the toast it leaves. The day is week 1's
     first, with a session note and an energy filed beside its sets, and the
     week's second day has a set of its own: the one thing the button must
     not reach. */
  {
    const boot = settled(seeded({ week: 1, day: 0 }, (p, b) => {
      const d0 = b.days[0].id, d1 = b.days[1].id;
      p.log[b.id]['w1-' + d1] = { [b.days[1].ex[0].id]: [{ w: '100', r: '8', done: true, ts: BOOT_TIME - 6 * 864e5 }] };
      p.notes = { [b.id]: { ['w1-' + d0]: 'rodilla izquierda en la hack' } };
      p.energy = { [b.id]: { ['w1-' + d0]: 'alta' } };
    }));
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const p = getProfile(), b = getBlock(), days = dayList(b);
      const used = d => Object.values((p.log[b.id] || {})[slot(1, d.id)] || {}).reduce((n, rows) => n + rows.filter(rowUsed).length, 0);
      return { day: used(days[0]), other: used(days[1]), note: getNote(p, b.id, 1, days[0].id), energy: getEnergy(p, b.id, 1, days[0].id) };
    })())`));
    /* The dialog is up by the time the press hands back its promise; the
       button answering it is pressed, and the press is awaited. */
    const press = async answer => {
      const out = { asked: false, err: '' };
      try {
        const pressing = boot.$('clearDay').onclick();
        out.asked = boot.call('!!askResolve') && boot.$('askT').textContent === '¿Borrar este día?';
        boot.$(answer).onclick();
        await pressing;
      } catch (e) { out.err = e.message; }
      return out;
    };
    const before = read(boot);
    const kept = await press('askCancel');
    ok('"Borrar este día" asks first, and "Cancelar" leaves the day as it was',
       kept.asked && !kept.err && JSON.stringify(read(boot)) === JSON.stringify(before), JSON.stringify({ kept, now: read(boot) }));
    const gone = await press('askOk');
    const cleared = read(boot);
    ok('..."Borrar" takes the day\'s sets, its note and its energy, and leaves the other day\'s set alone',
       gone.asked && !gone.err && before.day > 0 && !!before.note && !!before.energy &&
       cleared.day === 0 && cleared.note === '' && cleared.energy === '' && cleared.other === before.other,
       JSON.stringify({ gone, before, cleared }));
    boot.clock.advance(1000);
    const back = read(reopen(boot));
    ok('...and save() writes the day gone, as the next open reads it', JSON.stringify(back) === JSON.stringify(cleared), JSON.stringify(back));
    let undoErr = '';
    try { boot.$('toastAct').onclick(); } catch (e) { undoErr = e.message; }
    ok('"Deshacer" on the toast it leaves brings all of it back', !undoErr && JSON.stringify(read(boot)) === JSON.stringify(before),
       undoErr || JSON.stringify(read(boot)));
  }

  /* The first day's week-1 sessions filed as weeks 1 to 3, a week apart and
     the last a week before the boot: three sessions of every lift that day,
     enough for the Diagnóstico to fit a trend — which is what gives its rows,
     and the review built on them, something to say. */
  const threeWeeks = (p, b) => {
    const day = b.days[0].id, week1 = p.log[b.id]['w1-' + day];
    [1, 2, 3].forEach(w => {
      const filed = {};
      Object.keys(week1).forEach(id => { filed[id] = week1[id].map(r => Object.assign({}, r, { ts: r.ts - (3 - w) * 7 * 864e5 })); });
      p.log[b.id]['w' + w + '-' + day] = filed;
    });
  };

  /* The Diagnóstico's scope toggle, pressed on the real sheet. diagRows
     takes its scope from the caller, so that the block review cannot
     inherit the toggle, which leaves the sheet to hand over its own. The
     block before this one and this one hold the same three weeks. The
     buttons carry the data-scope index.html gives them. */
  {
    const boot = settled(seeded({ week: 4, day: 0 }, (p, b) => {
      threeWeeks(p, b);
      const next = JSON.parse(JSON.stringify(b));
      next.id = 'block-2'; next.name = 'Bloque 2';
      p.blocks[next.id] = next; p.blockOrder.push(next.id); p.activeBlock = next.id;
      p.log[next.id] = JSON.parse(JSON.stringify(p.log[b.id]));
    }));
    const exId = boot.call('getBlock().days[0].ex[0].id');
    /* The session count on the row the sheet drew for the lift. */
    const drawn = () => boot.$('diagHost').children.filter(el => el.dataset.ex === exId)
      .map(el => +((/(\d+) sesi/.exec(el.querySelector('.diag-num').textContent) || [])[1]));
    const seen = {};
    let err = '';
    try {
      boot.$('diagBtn').onclick();
      seen.opened = drawn();
      const [here, every] = boot.$('diagScope').querySelectorAll('.seg-btn');
      here.dataset.scope = 'block';
      every.dataset.scope = 'all';
      every.onclick();
      seen.every = drawn();
      here.onclick();
      seen.here = drawn();
    } catch (e) { err = e.message; }
    /* "More than three" across both blocks rather than six, for the reason
       the unbooted scope test gives: a change to DIAG_WINDOW is not a
       change of scope. */
    ok('the Diagnóstico opens on this block\'s sessions, "Todos los bloques" counts both blocks\' and "Este bloque" goes back: the sheet hands diagRows its own toggle',
       !err && seen.opened.join() === '3' && seen.here.join() === '3' && seen.every.length === 1 && seen.every[0] > 3,
       err || JSON.stringify(seen));
  }

  /* "+ Nuevo bloque" with each guarded file left out. Every hole has to end
     where a whole shell does, with the block made: through the review when
     js/review.js is there, straight to the name when it is not (newBlock's
     typeof test). The review is built on the Diagnóstico's rows, which live
     in app.js (AGENTS.md rule 2), so it opens without js/diagnostics.js too
     — where, until they moved, it threw "strengthRows is not defined" and
     no block was made. And it has to say what a whole shell's review says,
     word for word: one that opened and said less would be the
     plausible-looking empty answer rule 2 is there to rule out. Three weeks
     are logged so that every part of it has something to say. */
  console.log('\n== a precache hole: "+ Nuevo bloque" → "Ver la revisión" still makes the block, and the review says what a whole shell\'s does (AGENTS.md rules 1 and 2) ==');
  const reviewState = () => seeded({ week: 4, day: 0 }, threeWeeks);
  const wholeReview = bootApp({ state: reviewState() }).call('reviewText(buildBlockReview(getProfile(), getBlock()))');
  ok('the whole shell\'s review, the one each hole is held to, has a trend per lift, a strength change and sessions per muscle to say',
     /tendencia (subiendo|plano|bajando) /.test(wholeReview) && /fuerza [+−]?[\d,]+ %/.test(wholeReview) &&
     /sesiones [1-9]\d*\/\d+/.test(wholeReview), wholeReview.slice(0, 800));
  /* The first line two reviews part at, for a failure to show. */
  const parting = (a, b) => {
    const x = a.split('\n'), y = b.split('\n'), i = x.findIndex((l, k) => l !== y[k]);
    return i < 0 ? x.length + ' lines against ' + y.length : 'line ' + (i + 1) + ': ' + x[i] + ' | whole shell: ' + y[i];
  };

  /* The plan editor's own controls on a booted app (plans/053). Its rows
     are built from innerHTML, and the fake document answers each selector
     on a row with the element the editor bound its handler on, so these
     are the real "Enviar a…", "Quitar", "Borrar registro" and "Guardar
     cambios", found by the exercise's name in their box. */
  console.log('\n== "Editar plan" on a booted app: send, retire, erase, save (plans/053) ==');
  const planEditor = boot => {
    const host = boot.$('peDays');
    const days = () => host.children.filter(c => c.className === 'pe-day');
    return {
      row: (day, name) => days()[day].querySelector('.pe-exlist').children.find(r => r.querySelector('.f-n').value === name),
      retired: name => {
        const box = host.children.find(c => c.className === 'pe-retired');
        return box ? box.children.find(r => r.querySelector('b').textContent === name) : undefined;
      },
    };
  };
  /* A press that asks: what the dialog said, then its answer, then the
     press run to its end. A press that should not ask and does is
     answered too, so a dialog nobody expected cannot leave the suite
     waiting on it; what it said is handed back to fail on. */
  const pressAnswering = async (boot, press, answer) => {
    const pressing = press();
    const asked = boot.call('!!askResolve') ? { title: boot.$('askT').textContent, body: boot.$('askBody').textContent } : null;
    if (asked) boot.$(answer).onclick();
    await pressing;
    return asked;
  };

  /* Bug 1 through the real controls: the first exercise of day 1, logged
     in week 1, is sent to day 2, retired there and erased. Its sets sit
     under day 1 until the save, which is where the dialog counted them and
     where the save has to erase them; the old one purged day 2, where
     there was nothing, and every set stayed. */
  {
    const boot = settled(seeded({ week: 2, day: 0 }));
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const p = getProfile(), b = getBlock(), used = {};
      forEachSlot(p.log, b.id, (k, w, d, s) => Object.keys(s || {}).forEach(id => {
        const n = (Array.isArray(s[id]) ? s[id] : []).filter(rowUsed).length;
        if (n) used[k + ' ' + id] = n;
      }));
      return { used: used, plan: b.days.map(d => d.ex.map(e => e.id)) };
    })())`));
    const x = JSON.parse(boot.call('JSON.stringify((({ id, n }) => ({ id, n }))(getBlock().days[0].ex[0]))'));
    const setsOf = (used, own) => Object.keys(used).filter(k => (k.split(' ')[1] === x.id) === own).reduce((t, k) => t + used[k], 0);
    const without = used => JSON.stringify(Object.keys(used).filter(k => k.split(' ')[1] !== x.id).sort().map(k => k + ' ' + used[k]));
    const before = read(boot);
    let err = '', retiring = null, erasing = null, saving = 'not pressed', closed = false;
    try {
      const ed = planEditor(boot);
      boot.$('editPlan').onclick();
      const send = ed.row(0, x.n).querySelector('.pe-move-sel');
      send.value = boot.call('getBlock().days[1].id');
      send.onchange();
      retiring = await pressAnswering(boot, () => ed.row(1, x.n).querySelector('.e-del').onclick(), 'askOk');
      erasing = await pressAnswering(boot, () => ed.retired(x.n).querySelector('.a-del').onclick(), 'askOk');
      saving = await pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk');
      closed = boot.call('peDraft === null') && !boot.$('planSheet').classList.contains('up');
    } catch (e) { err = e.message; }
    const after = read(boot);
    const promised = erasing ? Number((/ y sus (\d+) series? registradas?\./.exec(erasing.body) || [])[1]) : NaN;
    ok('"Enviar a…", "Quitar" and "Borrar registro" on the real editor, then "Guardar cambios": the exercise\'s sets are gone, as many as the dialog said',
       !err && saving === null && !!retiring && closed && promised > 0 && promised === setsOf(before.used, true) &&
       setsOf(after.used, true) === 0 && after.plan.every(d => d.indexOf(x.id) < 0),
       err || JSON.stringify({ retiring, erasing, saving, closed, promised, before: setsOf(before.used, true), after: setsOf(after.used, true), plan: after.plan }));
    ok('...and every other set is where it was', without(after.used) === without(before.used), without(after.used));
    boot.clock.advance(1000);
    const back = read(reopen(boot));
    ok('...and save() writes it that way, as the next open reads it', JSON.stringify(back) === JSON.stringify(after), JSON.stringify(back));
    let undoErr = '';
    try { boot.$('toastAct').onclick(); } catch (e) { undoErr = e.message; }
    ok('"Deshacer" on the toast the save leaves brings the sets and the exercise back',
       !undoErr && JSON.stringify(read(boot)) === JSON.stringify(before), undoErr || JSON.stringify(read(boot)));
  }

  /* Bug 3 through the real button: the editor is open with a rename in
     its draft when another tab's write arrives — one more set, written to
     the storage both tabs share, and the 'storage' event this tab gets
     for it. With nothing pending here the handler adopts it by replacing
     the profile objects, so the draft was cut from one that is gone. */
  {
    const boot = settled(seeded({ week: 2, day: 0 }));
    const key = boot.call('STORAGE_KEY');
    const first = boot.call('getBlock().days[0].ex[0].n');
    let err = '', adopted = false, asked = null, open = false;
    const theirs = boot.saved();
    const tp = theirs.profiles[theirs.activeProfile], tb = tp.blocks[tp.activeBlock], other = tb.days[1];
    tp.log[tb.id]['w1-' + other.id] = { [other.ex[0].id]: [{ w: '70', r: '8', done: true, ts: BOOT_TIME - 3 * 864e5 }] };
    const raw = JSON.stringify(theirs);
    try {
      boot.$('editPlan').onclick();
      const mine = boot.call('getProfile()');
      boot.type(planEditor(boot).row(0, first).querySelector('.f-n'), first + ' (otra máquina)');
      boot.store[key] = raw;
      boot.fire(boot.ctx.window, 'storage', { key: key, newValue: raw });
      adopted = boot.call('getProfile()') !== mine;
      asked = await pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk');
      open = boot.$('planSheet').classList.contains('up') && boot.call('peDraft !== null');
    } catch (e) { err = e.message; }
    boot.clock.advance(1000);
    ok('"Guardar cambios" on a draft cut before another tab\'s write was adopted refuses, says so, and leaves the sheet open',
       !err && adopted && !!asked && asked.title === 'No se ha guardado' &&
       asked.body === 'Los datos cambiaron en otra pestaña: vuelve a abrir el editor.' && open,
       err || JSON.stringify({ adopted, asked, open }));
    ok('...and writes nothing: the other tab\'s data stays as it wrote it, the rename is not saved, and there is no undo to offer',
       boot.store[key] === raw && boot.call('getBlock().days[0].ex[0].n') === first && boot.call('undoSnapshot === null'),
       JSON.stringify({ stored: boot.store[key] === raw, name: boot.call('getBlock().days[0].ex[0].n'), undo: boot.call('undoSnapshot === null') }));
  }

  /* "Enviar a…" onto a day that already holds the same id. One lift on two
     days shares its id on purpose, but a day holds it once: the record is
     filed by slot and id, so two copies on one day are one record. The save
     used to fold the sent copy's sets into the other copy's sessions, and
     the next open's migrate() renamed the second copy, which started over
     with no history (plans/053's follow-up). Press banca is on Monday and
     Thursday, logged on both; the profile stands on week 3, so neither
     logged session is the one the draw pads out. */
  console.log('\n== "Enviar a…" never puts a second copy of an exercise on one day (plans/053\'s follow-up) ==');
  {
    const lift = (id, n) => ({ id: id, n: n, sets: 2, reps: '8-10', rest: 90 });
    const done = (w, daysAgo) => ({ w: String(w), r: '10', done: true, ts: BOOT_TIME - daysAgo * 864e5 });
    const twoDays = () => ({
      setupDone: true, activeProfile: 'hombre',
      profiles: { hombre: {
        label: 'Hombre', activeBlock: 'B', blockOrder: ['B'], week: 3, day: 0,
        blocks: { B: { id: 'B', name: 'Bloque', weeks: 4, deload: 0, days: [
          { id: 'dA', name: 'Lunes', ex: [lift('press', 'Press banca'), lift('remo', 'Remo')] },
          { id: 'dB', name: 'Jueves', ex: [lift('press', 'Press banca'), lift('curl', 'Curl')] },
          { id: 'dC', name: 'Sábado', ex: [lift('sent', 'Sentadilla')] },
        ] } },
        log: { B: {
          'w1-dA': { press: [done(50, 15), done(50, 15)], remo: [done(40, 15)] },
          'w1-dB': { press: [done(60, 12), done(60, 12)], curl: [done(15, 12)] },
          'w2-dA': { press: [done(52, 8)] },
        } },
      } },
    });
    /* The plan as day: ids, and every slot's used rows as "slot id count". */
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const b = getBlock(), used = [];
      forEachSlot(getProfile().log, b.id, (k, w, d, s) => Object.keys(s || {}).forEach(id => {
        const n = (Array.isArray(s[id]) ? s[id] : []).filter(rowUsed).length;
        if (n) used.push(k + ' ' + id + ' ' + n);
      }));
      return { plan: b.days.map(d => d.id + ': ' + d.ex.map(e => e.id + (e.off ? ' (off)' : '')).join(', ')), used: used.sort() };
    })())`));
    const offered = sel => sel.children.filter(o => o.value).map(o => o.textContent + (o.disabled ? ' — disabled' : ''));

    {
      const boot = settled(twoDays());
      const before = read(boot);
      let err = '', options = null, draft = '', saving = 'not pressed';
      try {
        const ed = planEditor(boot);
        boot.$('editPlan').onclick();
        const send = ed.row(0, 'Press banca').querySelector('.pe-move-sel');
        options = offered(send);
        /* Chosen anyway, past the disabled option: the handler asks the
           same question the option did. */
        send.value = 'dB';
        send.onchange();
        draft = boot.call('JSON.stringify(peDraft.block.days.map(d => d.ex.map(e => e.id)))');
        saving = await pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk');
      } catch (e) { err = e.message; }
      const after = read(boot);
      ok('"Enviar a…" offers a day that already holds the exercise disabled, and says why',
         !err && JSON.stringify(options) === JSON.stringify(['Jueves (ya lo tiene) — disabled', 'Sábado']), err || JSON.stringify(options));
      ok('...and its handler refuses too: the exercise stays on its own day',
         draft === JSON.stringify([['press', 'remo'], ['press', 'curl'], ['sent']]), draft);
      ok('...so "Guardar cambios" leaves every set on the day it was logged on, none folded into the other copy\'s sessions',
         saving === null && JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ saving, after }));
      boot.clock.advance(1000);
      const back = read(reopen(boot));
      ok('...and the next open finds each day\'s copy under the one id, with its own sets: a second copy on Thursday came back renamed, with none',
         JSON.stringify(back) === JSON.stringify(before), JSON.stringify(back));
    }

    /* A retired copy is still in its day, and migrate() renames a second
       copy beside it all the same; "Restaurar" would put both in the
       session. */
    {
      const boot = settled(twoDays());
      let err = '', retiring = null, options = null;
      try {
        const ed = planEditor(boot);
        boot.$('editPlan').onclick();
        retiring = await pressAnswering(boot, () => ed.row(1, 'Press banca').querySelector('.e-del').onclick(), 'askOk');
        options = offered(ed.row(0, 'Press banca').querySelector('.pe-move-sel'));
      } catch (e) { err = e.message; }
      ok('a copy retired from that day still counts: the day is offered disabled, marked as holding it retired',
         !err && !!retiring && JSON.stringify(options) === JSON.stringify(['Jueves (lo tiene retirado) — disabled', 'Sábado']),
         err || JSON.stringify({ retiring, options }));
    }

    /* What stays open: erase Thursday's copy in "Retirados" and Monday's
       can take its place. Plan 053's promise holds on the way: the save
       erases the sets the dialog counted, Thursday's own, before Monday's
       arrive under the same id. */
    {
      const boot = settled(twoDays());
      let err = '', erasing = null, options = null, saving = 'not pressed';
      try {
        const ed = planEditor(boot);
        boot.$('editPlan').onclick();
        await pressAnswering(boot, () => ed.row(1, 'Press banca').querySelector('.e-del').onclick(), 'askOk');
        erasing = await pressAnswering(boot, () => ed.retired('Press banca').querySelector('.a-del').onclick(), 'askOk');
        const send = ed.row(0, 'Press banca').querySelector('.pe-move-sel');
        options = offered(send);
        send.value = 'dB';
        send.onchange();
        saving = await pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk');
      } catch (e) { err = e.message; }
      const after = read(boot);
      const promised = erasing ? Number((/ y sus (\d+) series? registradas?\./.exec(erasing.body) || [])[1]) : NaN;
      ok('once Thursday\'s copy is erased in "Retirados", Thursday is offered again and Monday\'s copy goes there',
         !err && JSON.stringify(options) === JSON.stringify(['Jueves', 'Sábado']) &&
         JSON.stringify(after.plan) === JSON.stringify(['dA: remo', 'dB: curl, press', 'dC: sent']),
         err || JSON.stringify({ options, plan: after.plan }));
      ok('...and the save erases the 2 sets the dialog promised, Thursday\'s own, and files Monday\'s 3 under Thursday (plans/053)',
         saving === null && promised === 2 &&
         JSON.stringify(after.used) === JSON.stringify(['w1-dA remo 1', 'w1-dB curl 1', 'w1-dB press 2', 'w2-dB press 1']),
         JSON.stringify({ saving, promised, used: after.used }));
      boot.clock.advance(1000);
      const back = read(reopen(boot));
      ok('...which the next open reads the same way, the one copy keeping its id', JSON.stringify(back) === JSON.stringify(after), JSON.stringify(back));
    }
  }

  /* One lift on two days, and "Enviar a…" moving the copies round. The
     record is filed by day and id, and the save used to catch it up one
     copy at a time, in the plan's order of days: a copy sent onto a day
     whose own copy had not left yet was merged into that copy's sessions
     there, and the two then left together. Both copies' sets came out on
     one day, two sessions a week folded into one, and one of the two
     objetivo records was dropped. Every send here is one the check above
     lets through: each lands on a day the other copy has already left.
     Press banca is on Monday and Thursday: Monday's copy has three sets
     (two in week 1, one in week 2), Thursday's two, and each the objetivo
     record its week 1 kept. The profile stands on week 3, so no logged
     session is the one the draw pads out. */
  console.log('\n== "Enviar a…" moving one lift\'s copies round: each copy\'s record goes where that copy went (plans/053\'s second follow-up) ==');
  {
    const lift = (id, n) => ({ id: id, n: n, sets: 2, reps: '8-10', rest: 90 });
    const done = (w, daysAgo) => ({ w: String(w), r: '10', done: true, ts: BOOT_TIME - daysAgo * 864e5 });
    const target = (w, daysAgo) => ({ v: 3, at: BOOT_TIME - daysAgo * 864e5, conf: 'media', sets: [{ w: w, r: 10, m: '' }] });
    const twoDays = () => ({
      setupDone: true, activeProfile: 'hombre',
      profiles: { hombre: {
        label: 'Hombre', activeBlock: 'B', blockOrder: ['B'], week: 3, day: 0,
        blocks: { B: { id: 'B', name: 'Bloque', weeks: 4, deload: 0, days: [
          { id: 'dA', name: 'Lunes', ex: [lift('press', 'Press banca'), lift('remo', 'Remo')] },
          { id: 'dB', name: 'Jueves', ex: [lift('press', 'Press banca'), lift('curl', 'Curl')] },
          { id: 'dC', name: 'Sábado', ex: [lift('sent', 'Sentadilla')] },
        ] } },
        log: { B: {
          'w1-dA': { press: [done(50, 15), done(50, 15)], remo: [done(40, 15)] },
          'w1-dB': { press: [done(60, 12), done(60, 12)], curl: [done(15, 12)] },
          'w2-dA': { press: [done(52, 8)] },
        } },
        obj: { B: { 'w1-dA': { press: target(50, 15) }, 'w1-dB': { press: target(60, 12) } } },
      } },
    });
    /* The plan as day: ids; every slot's used rows as [week, day, id, their
       weights]; every objetivo record as [week, day, id, its first set's
       weight]. */
    const read = booted => JSON.parse(booted.call(`JSON.stringify((function () {
      const p = getProfile(), b = getBlock(), used = [], records = [];
      forEachSlot(p.log, b.id, (k, w, d, s) => Object.keys(s || {}).forEach(id => {
        const ws = (Array.isArray(s[id]) ? s[id] : []).filter(rowUsed).map(r => r.w);
        if (ws.length) used.push([w, d, id, ws.join(' ')]);
      }));
      forEachSlot(p.obj, b.id, (k, w, d, s) => Object.keys(s || {}).forEach(id => records.push([w, d, id, s[id].sets[0].w])));
      return { plan: b.days.map(d => d.id + ': ' + d.ex.map(e => e.id).join(', ')), used: used.sort(), records: records.sort() };
    })())`));
    const AT = { dA: 0, dB: 1, dC: 2 }, NAME = { dA: 'Lunes', dB: 'Jueves', dC: 'Sábado' };
    /* Each send is [the day the copy is on now, the day it goes to], through
       the row's own "Enviar a…". `lands` is the day each copy ends on, by
       the day it started on. */
    for (const [how, sends, lands] of [
      ['Monday\'s copy sent to Sábado, then Thursday\'s to Lunes', [['dA', 'dC'], ['dB', 'dA']], { dA: 'dC', dB: 'dA' }],
      ['Thursday\'s copy sent to Sábado, then Monday\'s to Jueves', [['dB', 'dC'], ['dA', 'dB']], { dA: 'dB', dB: 'dC' }],
      ['the two swapped through Sábado: Monday\'s there, Thursday\'s to Lunes, then Monday\'s on to Jueves',
       [['dA', 'dC'], ['dB', 'dA'], ['dC', 'dB']], { dA: 'dB', dB: 'dA' }],
    ]) {
      const boot = settled(twoDays());
      const before = read(boot);
      /* The record as it has to read after the save: each copy's entries
         under the day it went to, everything else where it was. */
      const moved = list => list.map(([w, d, id, v]) => [w, id === 'press' ? lands[d] : d, id, v]).sort();
      const counted = {};
      let err = '', saving = 'not pressed';
      try {
        const ed = planEditor(boot);
        boot.$('editPlan').onclick();
        sends.forEach(([on, to]) => {
          const send = ed.row(AT[on], 'Press banca').querySelector('.pe-move-sel');
          send.value = to;
          send.onchange();
        });
        /* What the editor says each copy has, on the row it now sits on. */
        Object.keys(lands).forEach(start => {
          const tag = ed.row(AT[lands[start]], 'Press banca').querySelector('.pe-log-tag').textContent;
          counted[start] = Number((/^(\d+) series? registradas?$/.exec(tag) || [])[1]);
        });
        saving = await pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk');
      } catch (e) { err = e.message; }
      const after = read(boot);
      const copies = Object.keys(lands).map(start => {
        const own = moved(before.used.filter(([w, d, id]) => id === 'press' && d === start));
        const got = after.used.filter(([w, d, id]) => id === 'press' && d === lands[start]);
        return { start: start, counted: counted[start], landed: got.reduce((n, e) => n + e[3].split(' ').length, 0),
                 own: JSON.stringify(got) === JSON.stringify(own) };
      });
      const [mon, thu] = copies;
      ok(how + ': Monday\'s ' + mon.counted + ' sets land on ' + NAME[lands.dA] + ' and Thursday\'s ' + thu.counted + ' on ' + NAME[lands.dB] +
         ', as many as each copy\'s row counted in the editor, and none folded into the other copy\'s sessions',
         !err && saving === null && copies.every(c => c.own && c.landed > 0 && c.landed === c.counted),
         err || JSON.stringify({ saving, copies, used: after.used }));
      ok('...every other set stays where it was, and each copy\'s objetivo record goes with its sets',
         JSON.stringify(after.used) === JSON.stringify(moved(before.used)) &&
         JSON.stringify(after.records) === JSON.stringify(moved(before.records)),
         JSON.stringify({ used: after.used, records: after.records }));
      boot.clock.advance(1000);
      const back = read(reopen(boot));
      ok('...and the next open reads it the same way', JSON.stringify(back) === JSON.stringify(after), JSON.stringify(back));
    }
  }

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

  /* The bug the stock-take found: blockLoggedSets/blockDoneSets walk every
     stored set, retired or not, but blockShareLog — what the send sheet is
     actually about to hand over — leaves a retired day or exercise out
     (plans/025). A block with sets parked under either used to show more
     on the sender than the payload, or the receiver, ever had. One set
     stays live; one is under a retired exercise on the same day, one under
     a whole retired day — both logged and done, so a fix that merely
     swapped rowUsed for done would not have caught this. */
  console.log('\n== the send sheet counts what the payload carries, not the raw storage (plans/050) ==');
  const shareCountProbe = call(`
    (function() {
      state = defaultState(); migrate();
      const pr = state.profiles.hombre;
      const block = pr.blocks['block-1'];
      const liveDay = block.days[0], retiredDay = block.days[1];
      const liveEx = liveDay.ex[0], retiredEx = liveDay.ex[1];
      pr.log['block-1'] = {};
      pr.log['block-1'][slot(1, liveDay.id)] = {
        [liveEx.id]: [{ w: '60', r: '8', done: true }],
        [retiredEx.id]: [{ w: '20', r: '10', done: true }],
      };
      pr.log['block-1'][slot(1, retiredDay.id)] = {
        [retiredDay.ex[0].id]: [{ w: '40', r: '6', done: true }],
      };
      retiredEx.off = 1;
      retiredDay.off = 1;
      const payload = blockShareLog(pr, block);
      const result = {
        payloadUsed: countSets(payload), payloadDone: countSets(payload, true),
        rawUsed: blockLoggedSets(pr, block.id), rawDone: blockDoneSets(pr, block.id),
      };
      retiredEx.off = 0;
      retiredDay.off = 0;
      return result;
    })()
  `);
  ok('the payload leaves out sets under a retired day and a retired exercise, unlike the raw block counters',
     shareCountProbe.payloadUsed === 1 && shareCountProbe.payloadDone === 1 &&
     shareCountProbe.rawUsed === 3 && shareCountProbe.rawDone === 3,
     JSON.stringify(shareCountProbe));

  console.log('\n== the QR "blocklog" payload carries the parts that travel with a block (plans/051) ==');
  /* The share still builds its parts by hand, on purpose: the payload's
     keys are a contract with phones on older shells, and blockShareRir
     reads the log rather than its own part. So nothing ties them to
     RECORD_PARTS but this: what the plan-and-log payload adds to the
     plan-only one has to be exactly the parts marked travelsWithBlock,
     the ones installBlockData files on the phone that scans it. */
  const planOnly = await call('buildQrPayload("block", getProfile(), getBlock())');
  const withLog = await call('buildQrPayload("blocklog", getProfile(), getBlock())');
  const carried = Object.keys(withLog).filter(k => !(k in planOnly)).sort();
  const travels = call('RECORD_PARTS.filter(part => part.travelsWithBlock).map(part => part.name)').slice().sort();
  ok('what "blocklog" adds to "block" is exactly the parts with travelsWithBlock',
     JSON.stringify(carried) === JSON.stringify(travels), JSON.stringify(carried) + ' vs ' + JSON.stringify(travels));

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
    })()
  `);
  const sessionsIn = scope => call('diagRows(getProfile(), getBlock()' + scope + ').find(r => r.id === getBlock().days[0].ex[0].id).sessions');
  const scoped = sessionsIn(', "block"'), global = sessionsIn(', "all"'), unsaid = sessionsIn('');
  const reviewed = call('buildBlockReview(getProfile(), getBlock()).exercises.find(x => x.name === getBlock().days[0].ex[0].n).sessions');
  /* `global` is the two blocks' sessions together (4 + 2), capped by
     DIAG_WINDOW; asserted as "more than the scoped count" rather than as 6
     so a change to that window cannot fail a test about scope. */
  ok('diagRows scoped to the block counts only its own sessions while the sheet is on "Todos los bloques"',
     scoped === 2 && global > scoped, JSON.stringify({ scoped: scoped, global: global }));
  /* diagRows never reads the toggle: the sheet hands over its own (the
     booted test of it is with the other handlers, above), so a caller that
     names no scope cannot inherit it either. */
  ok('...and the review\'s own row, and a diagRows call that names no scope, count the block\'s whatever the sheet was left on',
     reviewed === scoped && unsaid === scoped, JSON.stringify({ reviewed: reviewed, unsaid: unsaid }));
  call('diagScope = "block"');

  console.log('\n== plans/054 decision 5, visible change 3: the prompt names every deload week ==');
  {
    /* Fresh state, so this cannot inherit whatever the block above left the
       shared profile in — this only cares about the deload clause at the
       end of the block-context sentence. */
    call('state = defaultState(); migrate(); state.setupDone = true;');
    call('getBlock().deload = 0; getBlock().phase = {};');
    const noDeloadPrompt = await call('buildAiPrompt({ withBlock: true })');
    ok('the prompt says "sin descarga" when the block has none',
       noDeloadPrompt.indexOf(', sin descarga.') >= 0, noDeloadPrompt.slice(0, 400));

    call('getBlock().deload = 4;');
    const oneDeloadPrompt = await call('buildAiPrompt({ withBlock: true })');
    ok('...and names the single deload week, singular',
       oneDeloadPrompt.indexOf(', con descarga en la semana 4.') >= 0, oneDeloadPrompt.slice(0, 400));

    call('getBlock().phase[8] = { r: "Descarga", t: "" };');
    const twoDeloadPrompt = await call('buildAiPrompt({ withBlock: true })');
    ok('...and every deload week once a phase-text one joins the field, "las semanas 4 y 8"',
       twoDeloadPrompt.indexOf(', con descarga en las semanas 4 y 8.') >= 0, twoDeloadPrompt.slice(0, 400));
  }

  console.log('\n== plans/054 decision 2: the review carries every span, one bullet each ==');
  {
    call('state = defaultState(); migrate();');
    call(`
      (function () {
        const pr = state.profiles.hombre;
        const b = pr.blocks[pr.blockOrder[0]];
        /* A two-week span (field at 4, phase text at 5) and a one-week span
           (phase text at 9), each with a logged week on both sides. A fresh
           phase object, not merged onto the shipped default's own — that
           default already says "Descarga" at week 8, which would fuse into
           the week-9 span and eat the very case this is testing. */
        b.weeks = 12; b.deload = 4;
        b.phase = { 5: { r: 'Descarga', t: '' }, 9: { r: 'Descarga', t: '' } };
        const day = b.days[0], exId = day.ex[0].id;
        pr.log[b.id] = {};
        const one = (w, wt) => { pr.log[b.id][slot(w, day.id)] = { [exId]: [{ w: String(wt), r: '1', done: true }] }; };
        one(3, 100); one(6, 90);    /* span 4-5: 100 -> 90 kg, -10 % */
        one(8, 80); one(10, 88);    /* span 9: 80 -> 88 kg, +10 % */
        pr.week = 12;
      })()
    `);
    const spanReview = JSON.parse(call('JSON.stringify(buildBlockReview(getProfile(), getBlock()).deloads)'));
    ok('buildBlockReview carries one entry per span, in week order, each with its own before/after',
       spanReview.length === 2 &&
       spanReview[0].deload === 4 && spanReview[0].deloadEnd === 5 && spanReview[0].before === 3 && spanReview[0].after === 6 &&
       spanReview[1].deload === 9 && spanReview[1].deloadEnd === 9 && spanReview[1].before === 8 && spanReview[1].after === 10,
       JSON.stringify(spanReview));
    const spanReviewText = call('reviewText(buildBlockReview(getProfile(), getBlock()))');
    ok('reviewText lists a multi-week span as "las semanas N–M" and a one-week one as "la semana N", one bullet each',
       spanReviewText.indexOf('- Descarga en las semanas 4–5: la semana 6 quedó') >= 0 &&
       spanReviewText.indexOf('- Descarga en la semana 9: la semana 10 quedó') >= 0,
       (spanReviewText.match(/- Descarga.*/g) || []).join(' | '));
  }

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
      const fromCopy = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      const fromJson = priorBlockSets(pr, b3, b3.days[0].ex[0]);
      const unknown = priorBlockSets(pr, b2, { id: 'nope', n: 'Nada de esto' });
      const first = priorBlockSets(pr, b1, ex);
      /* Only the deload logged: nothing usable. */
      delete pr.log[b1.id][slot(6, day.id)]; delete pr.log[b1.id][slot(7, day.id)];
      /* What the app's save() would say after such a write: the band reads
         the history cache, which only a write that says so empties. */
      logChanged();
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
      const hint = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      return hint && { week: hint.week, w: hint.sets.map(s => s.w).join('/') };
    })()
  `);
  ok('a deload written only into the phase text is skipped by the hint band too, same as by the rule',
     priorPhaseDeload && priorPhaseDeload.week === 7 && priorPhaseDeload.w === '65',
     JSON.stringify(priorPhaseDeload));

  /* plans/010's promise — a backup or profile file the app itself wrote
     always restores, exactly as it was — broken by a limit the app never
     held itself to. normalizeImportedBlock refuses a block of more than
     IMPORT_LIMITS.days days, or a day of more than IMPORT_LIMITS.ex
     exercises, on the restore path too, and counts the retired ones; the
     plan editor let a block grow past both. So a block restructured a few
     times — two days retired with their history, new ones added — reached
     a 15th day, and "Cargar copia" answered the app's own download with
     "Demasiados días (15): el máximo es 14".

     Built with the writes the editor makes, on the deep copy "Editar plan"
     opens: "Retirar" on two days and an exercise that have sets (an item
     with none is deleted, not retired), "+ Añadir día" and "+ Añadir
     ejercicio" one past the limit, names filled in because the save gate
     refuses a blank one, and the copy put back the way "Guardar cambios"
     puts it. The editor stops at the limit now (the next section), so this
     is the block already sitting in someone's storage, and it has to come
     back all the same — from the backup, and from the profile file. Driven
     through restoreFromText and loadProfileFromText themselves, with their
     confirmation answered yes, since the refusal is the whole bug. */
  console.log('\n== a block the plan editor grew past IMPORT_LIMITS comes back from its own backup (plans/010) ==');
  {
    const marks = [];
    const realMark = app.mark;
    app.mark = (msg, err) => { marks.push({ msg: String(msg), err: !!err }); };
    call(`
      state = defaultState(); migrate();
      (function () {
        const profile = getProfile(), block = getBlock();
        const logOne = (day, ex, w) => {
          const row = entry(profile, block.id, 1, day.id, ex.id, ex.sets)[0];
          row.w = w; row.r = '10'; row.done = true;
        };
        logOne(block.days[0], block.days[0].ex[1], '30');
        logOne(block.days[1], block.days[1].ex[0], '50');
        logOne(block.days[2], block.days[2].ex[0], '70');
        commit();

        const draft = JSON.parse(JSON.stringify(block));
        draft.days[1].off = 1;
        draft.days[2].off = 1;
        draft.days[0].ex[1].off = 1;
        while (draft.days.length <= IMPORT_LIMITS.days) {
          draft.days.push({ id: uid('d'), name: 'Día ' + (dayList(draft).length + 1), ex: [newExercise()] });
        }
        while (draft.days[0].ex.length <= IMPORT_LIMITS.ex) draft.days[0].ex.push(newExercise());
        draft.days.forEach(d => d.ex.forEach((e, i) => { if (!e.n) e.n = d.name + ' · ' + (i + 1); }));
        profile.blocks[draft.id] = draft;
        commit();
      })();
      __grown = JSON.parse(JSON.stringify(getProfile()));
      __grownBackup = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
      __grownFile = profileExportPayload(state.activeProfile);
      true;
    `);
    const grown = call('({ days: __grown.blocks[__grown.activeBlock].days.length, ex: __grown.blocks[__grown.activeBlock].days[0].ex.length })');
    ok('the fixture really is one day and one exercise past IMPORT_LIMITS, retired ones included',
       grown.days === call('IMPORT_LIMITS.days') + 1 && grown.ex === call('IMPORT_LIMITS.ex') + 1, JSON.stringify(grown));

    /* Back to a different state first, so nothing below can pass by reading
       the one the fixture was built in. Every part of the record is
       compared, off the table, the way the populated round trip above
       does it; the block by containment (restoreGaps), since the restore
       drops the blank optionals newExercise() ships. */
    const comeBack = () => call(`(function () {
      const before = __grown, after = getProfile();
      const bb = before.blocks[before.activeBlock], ab = after.blocks[after.activeBlock];
      if (!ab) return { gaps: ['no block'], parts: [] };
      return {
        gaps: restoreGaps(bb, ab, 'block', []).slice(0, 6),
        parts: RECORD_PARTS.map(part => part.name)
          .filter(name => JSON.stringify(after[name]) !== JSON.stringify(before[name])),
        retired: ab.days.filter(d => d.off).length + '+' + ab.days[0].ex.filter(e => e.off).length,
      };
    })()`);

    call('state = defaultState(); migrate();');
    marks.length = 0;
    const restoring = call('restoreFromText(__grownBackup)');
    call('closeAsk(true)');
    await restoring;
    const refusedBackup = marks.filter(m => m.err).map(m => m.msg);
    ok('"Cargar copia" takes back the app\'s own backup of that block', refusedBackup.length === 0, refusedBackup.join(' | '));
    const fromBackup = comeBack();
    ok('...with every day and exercise, the retired ones still retired',
       fromBackup.gaps.length === 0 && fromBackup.retired === '2+1', JSON.stringify(fromBackup));
    ok('...and every part of the record unchanged', fromBackup.parts.length === 0, JSON.stringify(fromBackup.parts));

    call('state = defaultState(); migrate();');
    marks.length = 0;
    const loading = call('loadProfileFromText(__grownFile)');
    call('closeAsk(true)');
    await loading;
    const refusedFile = marks.filter(m => m.err).map(m => m.msg);
    ok('"Importar perfil" takes back the same profile\'s own file', refusedFile.length === 0, refusedFile.join(' | '));
    const fromFile = comeBack();
    ok('...exactly as it was', fromFile.gaps.length === 0 && fromFile.parts.length === 0 && fromFile.retired === '2+1',
       JSON.stringify(fromFile));

    app.mark = realMark;
    call('__grown = __grownBackup = __grownFile = null;');

    /* Headroom, not an open door. Past OWN_LIMITS the own path still
       refuses, and a paste is still held to IMPORT_LIMITS: the fifteen
       days that restore above are turned away by "Importar JSON". */
    const ceilings = call(`(function () {
      const days = n => ({ name: 'B', days: Array.from({ length: n }, (_, i) => ({ name: 'D' + i, ex: [{ n: 'Ex', reps: '10' }] })) });
      const exercises = n => ({ name: 'B', days: [{ name: 'D', ex: Array.from({ length: n }, (_, i) => ({ n: 'Ex' + i, reps: '10' })) }] });
      const refusal = (raw, opts) => { try { normalizeImportedBlock(raw, opts); return ''; } catch (e) { return e.message; } };
      const own = { own: true };
      return {
        pastedDays: refusal(days(IMPORT_LIMITS.days + 1)), pastedEx: refusal(exercises(IMPORT_LIMITS.ex + 1)),
        ownDays: refusal(days(OWN_LIMITS.days), own), ownEx: refusal(exercises(OWN_LIMITS.ex), own),
        ownDaysPast: refusal(days(OWN_LIMITS.days + 1), own), ownExPast: refusal(exercises(OWN_LIMITS.ex + 1), own),
        most: OWN_LIMITS.days + '/' + OWN_LIMITS.ex,
      };
    })()`);
    ok('a pasted block is still held to IMPORT_LIMITS, days and exercises alike',
       !!ceilings.pastedDays && !!ceilings.pastedEx, JSON.stringify(ceilings));
    ok('own data is taken up to OWN_LIMITS', !ceilings.ownDays && !ceilings.ownEx, JSON.stringify(ceilings));
    ok('...and refused past it, naming the ceiling it was held to',
       ceilings.ownDaysPast.indexOf('el máximo es ' + ceilings.most.split('/')[0]) >= 0 &&
       ceilings.ownExPast.indexOf('el máximo es ' + ceilings.most.split('/')[1]) >= 0, JSON.stringify(ceilings));

    /* reKeyImportedSlots stops reading at LOG_LIMITS.slots keys. Sized off
       IMPORT_LIMITS.days it was 224, so a fifteen-day block that got past
       the day check would still have lost its last sixteen sessions, every
       one a week of a day it really has, with no message at all. */
    const slotsKept = call(`(function () {
      const days = Array.from({ length: IMPORT_LIMITS.days + 1 }, (_, i) => ({ id: 'd' + i, name: 'D' + i, ex: [{ id: 'e', n: 'Ex', reps: '10' }] }));
      const log = {};
      for (let w = 1; w <= MAX_WEEKS; w++) days.forEach(d => { log[slot(w, d.id)] = { e: [{ w: String(w), r: '8', done: true }] }; });
      const p = { blocks: { b: { name: 'B', weeks: MAX_WEEKS, deload: 0, days } }, blockOrder: ['b'], activeBlock: 'b', log: { b: log } };
      let restored = -1, refused = '';
      try { restored = Object.keys(normalizeImportedProfile(JSON.parse(JSON.stringify(p))).log.b || {}).length; }
      catch (e) { refused = e.message; }
      return { logged: Object.keys(log).length, restored, refused, fourteenDays: MAX_WEEKS * IMPORT_LIMITS.days };
    })()`);
    ok('...keeping every session such a block logged, past the slots fourteen days can fill',
       slotsKept.restored === slotsKept.logged && slotsKept.logged > slotsKept.fourteenDays, JSON.stringify(slotsKept));

    /* One level up from PROFILE_LIMITS.blocks: nothing bounded how many
       profiles a backup walks. Counted before any is read — the getter
       below would see a read — and set above the most a phone could have
       ended up with by the app's own hand: two, plus the phantom plans/040
       closed, one per name Object.prototype carries. */
    const profileCap = call(`(function () {
      let reads = 0;
      const many = { profiles: {} };
      for (let i = 0; i <= PROFILE_LIMITS.profiles; i++) {
        const p = defaultState().profiles.hombre;
        const blocks = p.blocks;
        Object.defineProperty(p, 'blocks', { get() { reads++; return blocks; }, enumerable: true });
        many.profiles['p' + i] = p;
      }
      return {
        many: describeBackupProblem(many), reads,
        own: describeBackupProblem(defaultState()),
        phantoms: 2 + Object.getOwnPropertyNames(Object.prototype).filter(n => n !== '__proto__').length,
        cap: PROFILE_LIMITS.profiles,
      };
    })()`);
    ok('a backup with more profiles than PROFILE_LIMITS.profiles is refused, before any profile is read',
       !!profileCap.many && profileCap.many.indexOf(String(profileCap.cap + 1)) >= 0 && profileCap.reads === 0,
       JSON.stringify(profileCap));
    ok('...while the app\'s own two-profile backup passes', profileCap.own === null, JSON.stringify(profileCap));
    ok('...and the ceiling sits above two plus the pre-plans/040 phantoms, so no phone\'s own backup meets it',
       profileCap.cap >= profileCap.phantoms, JSON.stringify(profileCap));
  }

  /* The other half, and the reason the block above is old data rather than
     new: the editor stops where the importers stop, counting retired days
     and exercises the way normalizeImportedBlock does. Driven through
     renderPlanEditor with the elements it creates recorded — inert()
     copied into plain data properties, so what the editor writes on them
     reads back — which makes it the real "+ Añadir día" and its real
     handler under test, not a copy of the rule. */
  console.log('\n== the plan editor stops where the importers stop (plans/010) ==');
  {
    const made = [];
    const realCreate = app.document.createElement;
    app.document.createElement = tag => {
      const el = Object.assign({ tagName: String(tag).toUpperCase() }, inert());
      made.push(el);
      return el;
    };
    const draw = () => { made.length = 0; call('renderPlanEditor()'); };
    const buttons = label => made.filter(el => el.tagName === 'BUTTON' && el.textContent === label);
    const notes = () => made.filter(el => el.tagName === 'P' && el.className === 'setup-hint').map(el => el.textContent);
    const days = () => call('peDraft.block.days.length');

    /* What "Editar plan" opens: a deep copy of the block, one day retired
       with a set on it. */
    call(`state = defaultState(); migrate();
      (function () {
        const block = getBlock(), day = block.days[1], ex = day.ex[0];
        const row = entry(getProfile(), block.id, 1, day.id, ex.id, ex.sets)[0];
        row.w = '50'; row.r = '10'; row.done = true;
      })();
      peDraft = openPlanDraft(getProfile(), getBlock());
      peDraft.block.days[1].off = 1;`);
    const limit = call('IMPORT_LIMITS.days');

    let guard = 0;
    for (draw(); days() < limit && guard++ < 50; draw()) {
      const add = buttons('+ Añadir día')[0];
      if (!add || add.disabled) break;
      add.onclick();
    }
    ok('"+ Añadir día" adds days up to IMPORT_LIMITS.days, the retired one among them', days() === limit, String(days()));
    const addDay = buttons('+ Añadir día')[0];
    ok('...and is disabled there', !!addDay && addDay.disabled === true, JSON.stringify(addDay && addDay.disabled));
    addDay.onclick();
    ok('...its handler refuses too, should anything still reach it', days() === limit, String(days()));
    const dayNote = notes().find(t => t.indexOf('Este bloque') === 0) || '';
    ok('...with the reason underneath, the retired day counted and what to do about it',
       dayNote.indexOf('14 días, contando el retirado; el máximo es 14.') >= 0 && dayNote.indexOf('"Retirados"') >= 0 &&
       dayNote.indexOf('"+ Nuevo bloque"') >= 0, dayNote);

    /* Day 1 is retired, so the first live day's button is the first one. */
    call('while (peDraft.block.days[0].ex.length < IMPORT_LIMITS.ex) peDraft.block.days[0].ex.push(newExercise());');
    draw();
    const addEx = buttons('+ Añadir ejercicio');
    ok('"+ Añadir ejercicio" is disabled on a day at IMPORT_LIMITS.ex, and only there',
       addEx.length > 1 && addEx[0].disabled === true && addEx.slice(1).every(b => !b.disabled),
       JSON.stringify(addEx.map(b => b.disabled)));
    const exBefore = call('peDraft.block.days[0].ex.length');
    addEx[0].onclick();
    ok('...and its handler refuses', call('peDraft.block.days[0].ex.length') === exBefore, String(call('peDraft.block.days[0].ex.length')));
    ok('...with its own line: nothing retired in that day, so just the ceiling',
       notes().indexOf('Este día ya tiene 40 ejercicios; el máximo es 40.') >= 0, JSON.stringify(notes()));

    /* "Enviar a…" is the other road into a day. */
    const fullId = call('peDraft.block.days[0].id');
    const toFull = made.filter(el => el.tagName === 'OPTION' && el.value === fullId);
    const toOthers = made.filter(el => el.tagName === 'OPTION' && el.value && el.value !== fullId);
    ok('"Enviar a…" offers the full day disabled, and marked so', toFull.length > 0 &&
       toFull.every(o => o.disabled === true && / \(completo\)$/.test(o.textContent)), JSON.stringify(toFull.map(o => [o.disabled, o.textContent])));
    ok('...and every other day as before', toOthers.length > 0 && toOthers.every(o => !o.disabled),
       JSON.stringify(toOthers.slice(0, 3).map(o => [o.disabled, o.textContent])));

    /* A block saved over the limit before it existed: it opens, it says
       where it stands, and it cannot grow. */
    call('peDraft.block.days.push({ id: uid("d"), name: "Extra", ex: [newExercise()] });');
    draw();
    ok('a block already past the limit opens with "+ Añadir día" disabled and says how far past it is',
       buttons('+ Añadir día')[0].disabled === true &&
       notes().some(t => t.indexOf('Este bloque ya tiene 15 días, contando el retirado; el máximo es 14.') === 0),
       JSON.stringify(notes()));

    app.document.createElement = realCreate;
    call('peDraft = null;');
  }

  /* The text half of the same promise (plans/055). The editor capped none
     of its text boxes, so a name, a cue or a day's name could be typed
     longer than the importers take, and "Cargar copia" cut it: 147
     characters came back as 120. A restore takes text up to
     OWN_TEXT_LIMIT now, so what was typed before still comes back whole,
     and each box stops at its field's IMPORT_LIMITS length (EX_FIELDS'
     `max`), so what is typed from now on fits every door. Pressed on a
     booted app: a backup read back through restoreFromText with its
     confirmation answered yes, and then the real boxes' input handlers and
     "Guardar cambios". */
  const words = n => 'palabra '.repeat(Math.ceil(n / 8) + 1).slice(0, n).replace(/ $/, 'x');
  console.log('\n== a backup gives back the text the plan editor let you type (plans/055) ==');
  {
    const L = JSON.parse(call('JSON.stringify(IMPORT_LIMITS)'));
    /* Text of every length the editor let through before, on the phone that
       wrote it, and a backup of it read back on another. The cue past
       OWN_TEXT_LIMIT is the one thing cut, on the load before the backup
       was ever taken (migrate(), decision 4) — and cut with no blank at the
       cut, since the restore's txt() trims one, as it always has. */
    const long = { block: words(90), day: words(90), pair: words(L.pair + 1), n: words(147), alt: words(L.alt + 1),
                   cue: words(450), reps: words(L.reps + 1), n2: words(2000), cue2: 'x'.repeat(2600) };
    const writer = settled(seeded({ week: 1, day: 0 }, (p, b) => {
      b.name = long.block; b.days[0].name = long.day; b.days[0].pair = long.pair;
      Object.assign(b.days[0].ex[0], { n: long.n, alt: long.alt, cue: long.cue, reps: long.reps });
      Object.assign(b.days[0].ex[1], { n: long.n2, cue: long.cue2 });
    }));
    const texts = s => {
      const p = s.profiles[s.activeProfile], b = p.blocks[p.activeBlock], d = b.days[0];
      return { block: b.name, day: d.name, pair: d.pair, n: d.ex[0].n, alt: d.ex[0].alt, cue: d.ex[0].cue, reps: d.ex[0].reps,
               n2: d.ex[1].n, cue2: d.ex[1].cue };
    };
    const stored = texts(writer.saved());
    const backup = writer.call('JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2)');
    const reader = settled(JSON.parse(SEED));
    reader.ctx.__backup = backup;
    const restoring = reader.call('restoreFromText(__backup)');
    reader.call('closeAsk(true)');
    await restoring;
    reader.clock.advance(1000);
    const back = texts(reader.saved());
    const cut = Object.keys(back).filter(k => back[k] !== stored[k]);
    ok('storage held the typed text whole, the cue past OWN_TEXT_LIMIT cut to it on load',
       stored.n === long.n && stored.day === long.day && stored.cue2.length === call('OWN_TEXT_LIMIT'),
       JSON.stringify({ n: stored.n.length, day: stored.day.length, cue2: stored.cue2.length }));
    ok('"Cargar copia" gives every one of those texts back exactly — 147 characters used to come back as 120',
       cut.length === 0, cut.map(k => k + ': ' + stored[k].length + ' -> ' + (back[k] || '').length).join(' | '));
  }

  console.log('\n== the plan editor stops each text box at the importers\' length (plans/055) ==');
  {
    /* A cue typed before the editor capped anything: longer than a paste
       takes, and never touched below. */
    const oldCue = words(479);
    const boot = settled(seeded({ week: 1, day: 0 }, (p, b) => { b.days[0].ex[1].cue = oldCue; }));
    boot.$('editPlan').onclick();
    const dayBox = boot.$('peDays').children[0];
    const row = i => dayBox.querySelector('.pe-exlist').children[i];
    const caps = JSON.parse(boot.call('JSON.stringify(EX_FIELDS.filter(f => f.max).map(f => [f.key, f.max]))'));
    const rowHtml = row(0).innerHTML;
    const uncapped = caps.filter(([key, max]) => !new RegExp('class="f-' + key + '"[^>]*maxlength="' + max + '"').test(rowHtml));
    ok('every text box of an exercise carries its field\'s maxlength from EX_FIELDS',
       caps.length === 8 && uncapped.length === 0, JSON.stringify({ caps, uncapped }));
    const L = JSON.parse(boot.call('JSON.stringify(IMPORT_LIMITS)'));
    ok('...a day\'s name and pair note theirs from IMPORT_LIMITS, and the block\'s name its own',
       /class="pe-day-name"[^>]*maxlength="80"/.test(dayBox.innerHTML) && /class="pe-day-pair"[^>]*maxlength="1000"/.test(dayBox.innerHTML) &&
       boot.$('peBlockName').getAttribute('maxlength') === String(L.name), dayBox.innerHTML.slice(0, 400));

    const nameBox = row(0).querySelector('.f-n');
    boot.type(nameBox, 'x'.repeat(L.exName + 30));
    ok('a paste past the cap is cut at it, in the box and in the draft alike',
       nameBox.value.length === L.exName && boot.call('peDraft.block.days[0].ex[0].n.length') === L.exName,
       nameBox.value.length + ' / ' + boot.call('peDraft.block.days[0].ex[0].n.length'));
    boot.type(row(0).querySelector('.f-alt'), ' o con barra  ');
    ok('...while text inside it is kept exactly as typed', boot.call('peDraft.block.days[0].ex[0].alt') === ' o con barra  ',
       JSON.stringify(boot.call('peDraft.block.days[0].ex[0].alt')));
    boot.type(dayBox.querySelector('.pe-day-name'), 'D'.repeat(L.name + 20));
    boot.type(dayBox.querySelector('.pe-day-pair'), 'P'.repeat(L.pair + 20));
    boot.type(boot.$('peBlockName'), 'B'.repeat(L.name + 20));
    boot.$('peSave').onclick().catch(() => {});
    boot.clock.advance(1000);
    const saved = (() => {
      const s = boot.saved(), p = s && s.profiles[s.activeProfile], b = p && p.blocks[p.activeBlock];
      return b ? { name: b.name.length, day: b.days[0].name.length, pair: b.days[0].pair.length,
                   n: b.days[0].ex[0].n.length, oldCue: b.days[0].ex[1].cue === oldCue } : null;
    })();
    ok('"Guardar cambios" writes what the boxes held, each cut at its cap, and leaves the old cue nobody touched whole',
       !!saved && saved.name === L.name && saved.day === L.name && saved.pair === L.pair && saved.n === L.exName && saved.oldCue,
       JSON.stringify(saved));
  }

  /* Decision 5 of plans/055: the prompt's field list is generated from
     EX_FIELDS and says exactly what it said when it was written out by
     hand. These are those lines as js/block-editor.js had them at 8142e33,
     over the same constants — so a limit that moves still moves the
     prompt, and a word that moves fails here. In both units, since one
     line names it. */
  console.log('\n== the AI prompt\'s field list comes from EX_FIELDS, byte for byte what it was (plans/055) ==');
  {
    const handWritten = `[
      '        {',
      '          "n": string OBLIGATORIO — nombre del ejercicio (máx ' + L.exName + ' car.),',
      '          "id": string opcional (máx 60 car.) — identificador estable del ejercicio. Si abajo te paso mi bloque actual, conserva el id de cada ejercicio que mantengas, para que su historial siga unido; un ejercicio nuevo puede ir sin id. El mismo ejercicio en dos días lleva el mismo nombre (no repitas el id en dos días: se renombraría),',
      '          "reps": string OBLIGATORIO — rango de reps, p.ej. "8-12" (máx ' + L.reps + ' car.),',
      '          "sets": número opcional 1-12 (por defecto 3),',
      '          "rest": número opcional — segundos de descanso 0-900 (por defecto 90; usa 0 si el ejercicio va encadenado en superserie),',
      '          "add": número entero opcional 1-weeks — desde esa semana se añade una serie extra (progresión de series; tiene que ser un entero o se rechaza todo el bloque),',
      '          "inc": número opcional (en ' + units() + '), admite decimales, ' + INC_MIN + '-' + INC_MAX + ' — el escalón de peso más pequeño que se puede cargar en ese ejercicio: lo que sube el objetivo cuando una serie llega al tope del rango, y el paso que se usa mientras no haya pesos registrados de los que leer la pila real de la máquina. Si falta, se usa el incremento por defecto de los ajustes. Pon uno realista por ejercicio (mancuernas y poleas suelen subir de 1-2,5 en 2,5; prensas y hacks, de 5 en 5),',
      '          "minRir": número entero opcional 0-5 — el RIR mínimo de ese ejercicio: nunca se le pide menos reserva que esta, aunque la semana pida menos. Ponlo (1) en los ejercicios que no se llevan al fallo — sentadilla, peso muerto rumano, hip thrust pesado — y déjalo fuera en máquinas y aislamiento,',
      '          "alt": string opcional — alternativa (máx ' + L.alt + ' car.),',
      '          "cue": string opcional — indicación técnica, para todas las series (máx ' + L.cue + ' car.),',
      '          "setup": string opcional — ajustes de la máquina (altura de asiento, posición del respaldo…), no técnica (máx ' + SETUP_LIMIT + ' car.),',
      '          "muscle": string opcional — músculo principal, libre, p.ej. Pecho/Espalda/Hombro/Bíceps/Tríceps/Cuádriceps/Isquios/Glúteo/Gemelos/Core (máx ' + MUSCLE_LIMIT + ' car.),',
      '          "pattern": string opcional — patrón de movimiento, libre, p.ej. Empuje horizontal/Empuje vertical/Tirón horizontal/Tirón vertical/Rodilla dominante/Cadera dominante (máx ' + PATTERN_LIMIT + ' car.),',
      '          "type": string opcional — tipo de ejercicio, libre, p.ej. Compuesto/Aislamiento (máx ' + TYPE_LIMIT + ' car.),',
      '          "share": 1 opcional — marca el ejercicio como estación compartida en pareja ("JUNTOS"),',
      '          "ss": 1 opcional — marca el ejercicio como parte de una superserie ("SS")',
      '        }',
    ].join('\\n')`;
    for (const u of ['kg', 'lb']) {
      call('state = defaultState(); migrate(); state.setupDone = true; state.prefs.units = "' + u + '"; L = IMPORT_LIMITS;');
      const want = call(handWritten);
      const prompt = await call('buildAiPrompt({ withBlock: true })');
      ok('the prompt describes every exercise field in the words and order it always did (' + u + ')',
         prompt.indexOf('      "ex": [ // obligatorio, 1-' + call('IMPORT_LIMITS.ex') + ' ejercicios\n' + want + '\n      ]\n') >= 0,
         want.slice(0, 120) + ' … not found in … ' + prompt.slice(prompt.indexOf('"ex"'), prompt.indexOf('"ex"') + 300));
    }
    call('delete globalThis.L;');
  }

  /* Decision 7 of plans/055: "Guardar" in Ajustes reads the plate list
     through cleanPlates, the rule migrate() reads a stored one with, so a
     list typed there and the same list loaded from a backup cannot come out
     different. Pressed on a booted app. */
  console.log('\n== "Guardar" in Ajustes keeps the plates migrate() would (plans/055) ==');
  {
    /* The box is a comma-separated list, so its decimals are written with a
       point; num() reads a comma decimal, which only a stored list holds. */
    const typedList = '25, 20, 20, 0.25, x, 100, 1.25';
    const boot = settled(JSON.parse(SEED));
    boot.call('openSetup(false); setupDraft.platesText = ' + JSON.stringify(typedList) + ';');
    boot.$('setupSave').onclick();
    const typedPlates = boot.call('JSON.stringify(state.prefs.plates)');
    const loaded = boot.call('state = JSON.parse(JSON.stringify(state)); state.prefs.plates = ' + JSON.stringify(typedList) +
      '.split(","); migrate(); JSON.stringify(state.prefs.plates)');
    ok('the same list comes out of Ajustes and out of a load: each size once, the unit\'s bounds kept, junk left out',
       typedPlates === '[25,20,0.25,1.25]' && loaded === typedPlates, typedPlates + ' / ' + loaded);
  }

  /* plans/010's promise, one level up from the block. A restore reads every
     profile back through normalizeImportedProfile, which refused a profile
     of more than PROFILE_LIMITS.blocks blocks, and nothing the app did to
     add a block ever stopped there: "+ Nuevo bloque" and every import (an
     "Importar JSON" paste, a blocks/ pick, a QR block, the review's JSON
     take-back) filed one more with no ceiling. Somebody iterating on an
     AI-written plan, pasting each attempt, could reach a 41st block, and
     then "Cargar copia" answered the app's own download with 'el perfil
     "hombre" tiene 41 bloques: el máximo es 40'.

     Built through those writers themselves, "+ Nuevo bloque" once and then
     one paste per attempt through applyImportedBlock, with the ceiling they
     stop at now lifted for the build. That is the app as it was, and a
     profile it grew that way has to come back all the same; the next
     section is the ceiling. A new block's id is 'block-' + Date.now(),
     which a loop this tight repeats, so the clock moves a millisecond per
     read while the fixture is built. Then it is backed up the way
     "Descargar copia" and "Exportar" write it and read back through
     restoreFromText and loadProfileFromText, their confirmation answered
     yes, since the refusal is the whole bug. */
  console.log('\n== a profile the app grew past PROFILE_LIMITS.blocks comes back from its own backup (plans/010) ==');
  {
    const marks = [];
    const realMark = app.mark;
    app.mark = (msg, err) => { marks.push({ msg: String(msg), err: !!err }); };

    call(`state = defaultState(); migrate();
      __cap = PROFILE_LIMITS.blocks; PROFILE_LIMITS.blocks = Infinity;
      __now = Date.now; __tick = __now.call(Date); Date.now = () => ++__tick;
      true;`);
    const creating = call('newBlock()');
    await settle();
    call('closeAsk("Bloque 2")');
    await creating;
    call(`(function () {
      const attempt = i => ({ name: 'Intento ' + i, weeks: 6, deload: 6, days: [
        { name: 'Torso', ex: [{ n: 'Press banca', reps: '6-8', sets: 4, muscle: 'pecho' }, { n: 'Remo con barra', reps: '8-10' }] },
        { name: 'Pierna', ex: [{ n: 'Sentadilla', reps: '5', sets: 5, rest: 180 }] },
      ] });
      for (let i = 1; getProfile().blockOrder.length <= __cap && i <= __cap + 5; i++) applyImportedBlock(attempt(i), 'texto pegado');
      /* History at both ends: the block the profile started with, and the
         attempt the last paste made active. */
      const profile = getProfile();
      const logOne = (blockId, w, weight) => {
        const block = profile.blocks[blockId], day = block.days[0], ex = day.ex[0];
        const row = entry(profile, blockId, w, day.id, ex.id, ex.sets)[0];
        row.w = weight; row.r = '8'; row.done = true;
      };
      logOne(profile.blockOrder[0], 1, '60');
      logOne(profile.activeBlock, 1, '80');
      logOne(profile.activeBlock, 2, '82.5');
      commit();
    })();
      PROFILE_LIMITS.blocks = __cap; Date.now = __now;
      __grown = JSON.parse(JSON.stringify(getProfile()));
      __grownBackup = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
      __grownFile = profileExportPayload(state.activeProfile);
      true;`);
    const grown = call(`({ blocks: __grown.blockOrder.length, distinct: new Set(__grown.blockOrder).size,
      filed: Object.keys(__grown.blocks).length, cap: PROFILE_LIMITS.blocks,
      copied: __grown.blockOrder.filter(id => __grown.blocks[id].name === 'Bloque 2').length,
      pasted: __grown.blockOrder.filter(id => /^Intento /.test(__grown.blocks[id].name)).length })`);
    ok('the fixture really is one block past PROFILE_LIMITS.blocks, made by "+ Nuevo bloque" and by pasting',
       grown.blocks === grown.cap + 1 && grown.distinct === grown.blocks && grown.filed === grown.blocks &&
       grown.copied === 1 && grown.pasted === grown.cap - 1, JSON.stringify(grown));

    /* Back to a different state first, so nothing below can pass by reading
       the one the fixture was built in. The blocks are compared by
       containment (restoreGaps), since a restore drops the blank optionals
       a block can carry; the order, the active block and every part of the
       record exactly. */
    const comeBack = () => call(`(function () {
      const before = __grown, after = getProfile();
      return {
        blocks: Object.keys(after.blocks).length,
        order: JSON.stringify(after.blockOrder) === JSON.stringify(before.blockOrder),
        active: after.activeBlock === before.activeBlock,
        gaps: before.blockOrder.reduce((out, id) => restoreGaps(before.blocks[id], after.blocks[id], id, out), []).slice(0, 6),
        parts: RECORD_PARTS.map(part => part.name)
          .filter(name => JSON.stringify(after[name]) !== JSON.stringify(before[name])),
      };
    })()`);

    call('state = defaultState(); migrate();');
    marks.length = 0;
    const restoring = call('restoreFromText(__grownBackup)');
    call('closeAsk(true)');
    await restoring;
    const refusedBackup = marks.filter(m => m.err).map(m => m.msg);
    ok('"Cargar copia" takes back the app\'s own backup of that profile', refusedBackup.length === 0, refusedBackup.join(' | '));
    const fromBackup = comeBack();
    ok('...with every block, in the same order and the same one active',
       fromBackup.blocks === grown.blocks && fromBackup.order && fromBackup.active && fromBackup.gaps.length === 0,
       JSON.stringify(fromBackup));
    ok('...and every part of the record unchanged', fromBackup.parts.length === 0, JSON.stringify(fromBackup.parts));

    call('state = defaultState(); migrate();');
    marks.length = 0;
    const loading = call('loadProfileFromText(__grownFile)');
    call('closeAsk(true)');
    await loading;
    const refusedFile = marks.filter(m => m.err).map(m => m.msg);
    ok('"Cargar un perfil" takes back the same profile\'s own file', refusedFile.length === 0, refusedFile.join(' | '));
    const fromFile = comeBack();
    ok('...exactly as it was', fromFile.blocks === grown.blocks && fromFile.order && fromFile.active &&
       fromFile.gaps.length === 0 && fromFile.parts.length === 0, JSON.stringify(fromFile));

    app.mark = realMark;
    call('__grown = __grownBackup = __grownFile = null;');
  }

  /* The other half, and the reason the profile above is old data rather
     than new: every road that adds a block stops at PROFILE_LIMITS.blocks,
     counted the way normalizeImportedProfile counts, and says where room is
     made. Driven through the writers themselves: newBlock, applyImportedBlock
     (a paste and a blocks/ pick both go through it), applyQrPayload and the
     review's own "Importar" handler, each answered the way a user who wants
     the block would answer it. Their messages are recorded off mark,
     setNote and openAsk, so what is under test is the refusal each screen
     shows, not a copy of the rule. */
  console.log('\n== "+ Nuevo bloque" and every import stop at PROFILE_LIMITS.blocks (plans/010) ==');
  {
    const marks = [], notes = [], asked = [];
    let managed = 0;
    const real = { mark: app.mark, setNote: app.setNote, openAsk: app.openAsk, openBlockManager: app.openBlockManager };
    app.mark = (msg, err) => { marks.push({ msg: String(msg), err: !!err }); };
    app.setNote = (el, text, err) => { notes.push({ text: String(text), err: !!err }); };
    app.openAsk = opts => {
      asked.push({ title: opts.title, body: opts.body || '', okLabel: opts.okLabel, text: !!opts.textInput });
      return real.openAsk(opts);
    };
    app.openBlockManager = () => { managed++; };
    const count = () => call('Object.keys(getProfile().blocks).length');
    const cap = call('PROFILE_LIMITS.blocks');
    const attempt = JSON.stringify({ name: 'Intento', days: [{ name: 'D', ex: [{ n: 'Press banca', reps: '8' }] }] });
    const reason = n => n + ' bloques; el máximo es ' + cap;
    /* Whatever dialog is up, answered the way someone who wants the block
       answers it: a name for the name prompt, yes to anything else. */
    const answerYes = () => {
      const last = asked[asked.length - 1];
      call(last && last.text ? 'closeAsk("Otro bloque")' : 'closeAsk(true)');
    };

    call(`state = defaultState(); migrate();
      __now = Date.now; __tick = __now.call(Date); Date.now = () => ++__tick;
      for (let i = 0; getProfile().blockOrder.length < PROFILE_LIMITS.blocks - 1 && i < PROFILE_LIMITS.blocks; i++) {
        applyImportedBlock(${attempt}, 'texto pegado');
      }
      true;`);
    ok('the fixture sits one block under the limit', count() === cap - 1, String(count()));

    asked.length = 0;
    const filling = call('newBlock()');
    await settle();
    answerYes();
    await filling;
    ok('"+ Nuevo bloque" still makes the block that reaches it', count() === cap && asked.length === 1 && asked[0].text,
       count() + ' ' + JSON.stringify(asked));

    asked.length = 0; managed = 0;
    const refusing = call('newBlock()');
    await settle();
    const told = asked.slice();
    answerYes();
    await refusing;
    ok('"+ Nuevo bloque" at the limit makes nothing', count() === cap, String(count()));
    ok('...asks for no name, and says why instead',
       told.length === 1 && !told[0].text && told[0].body.indexOf(reason(cap)) >= 0, JSON.stringify(told));
    ok('...pointing at "Gestionar bloques", which its button opens',
       told.length === 1 && told[0].body.indexOf('"Gestionar bloques"') >= 0 && told[0].okLabel === 'Gestionar bloques' && managed === 1,
       JSON.stringify(told) + ' · opened ' + managed);

    /* The three roads below are each run inside a try. Were one of them
       missing its own check, installImportedBlock would still refuse, by
       throwing: that has to read as the screen saying nothing, a failed
       assertion here, not an exception that takes the rest of the suite
       down with it. */
    notes.length = 0;
    const pasteThrew = call(`(function () {
      try { applyImportedBlock(${attempt}, 'texto pegado'); return ''; } catch (e) { return e.message; }
    })()`);
    const pasted = notes.filter(n => n.err).map(n => n.text);
    ok('a paste in "Importar JSON" adds nothing at the limit, nor does a blocks/ pick (the same function)',
       count() === cap, String(count()));
    ok('...and the sheet says why, pointing at "Gestionar bloques"',
       !pasteThrew && pasted.length === 1 && pasted[0].indexOf(reason(cap)) >= 0 && pasted[0].indexOf('"Gestionar bloques"') >= 0,
       JSON.stringify({ notes, threw: pasteThrew }));

    marks.length = 0; asked.length = 0;
    const scanned = call(`applyQrPayload({ kind: 'block', block: ${attempt} })`);
    await settle();
    const confirmed = asked.length;
    if (confirmed) answerYes();
    let scanThrew = '';
    try { await scanned; } catch (e) { scanThrew = String(e && e.message); }
    const scannedWhy = marks.filter(m => m.err).map(m => m.msg);
    ok('a block scanned by QR adds nothing at the limit', count() === cap, String(count()));
    ok('...turned away before "¿Añadir…?" is asked, with the same reason',
       !scanThrew && confirmed === 0 && scannedWhy.length === 1 && scannedWhy[0].indexOf(reason(cap)) >= 0 &&
       scannedWhy[0].indexOf('"Gestionar bloques"') >= 0, JSON.stringify({ confirmed, scannedWhy, threw: scanThrew }));

    /* The review's "Importar" is an onclick wired once, at load, onto an
       element this harness hands out fresh on every lookup — so it is wired
       again onto elements that keep what is written to them, and those stay
       in place while it runs, since it looks its box up again on the click. */
    const els = {};
    const realGet = app.document.getElementById;
    app.document.getElementById = id => els[id] || (els[id] = Object.assign({ id }, inert()));
    call('wireReview()');
    notes.length = 0;
    app.document.getElementById('reviewBlob').value = attempt;
    let reviewThrew = '';
    try { els.reviewImport.onclick(); } catch (e) { reviewThrew = String(e && e.message); }
    app.document.getElementById = realGet;
    const reviewed = notes.filter(n => n.err).map(n => n.text);
    ok('the JSON pasted back into the block review adds nothing at the limit', count() === cap, String(count()));
    ok('...and the review says why, pointing at "Gestionar bloques"',
       !reviewThrew && reviewed.length === 1 && reviewed[0].indexOf(reason(cap)) >= 0 && reviewed[0].indexOf('"Gestionar bloques"') >= 0,
       JSON.stringify({ notes, threw: reviewThrew }));

    const direct = call(`(function () {
      try { installImportedBlock(normalizeImportedBlock(${attempt})); return ''; } catch (e) { return e.message; }
    })()`);
    ok('installImportedBlock refuses too, should a new road to it forget to ask first',
       count() === cap && direct.indexOf(reason(cap)) >= 0, count() + ' ' + JSON.stringify(direct));

    call(`__full = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
      state = defaultState(); migrate(); true;`);
    marks.length = 0;
    const restoring = call('restoreFromText(__full)');
    call('closeAsk(true)');
    await restoring;
    const refused = marks.filter(m => m.err).map(m => m.msg);
    ok('the profile the writers filled to the limit restores from its own backup',
       refused.length === 0 && count() === cap, count() + ' ' + refused.join(' | '));

    /* One saved past the limit before any of this: it trains and restores
       (the section above), it cannot grow, and the reason counts what it
       really has rather than claiming it is at the limit. */
    call(`(function () {
      const profile = getProfile(), clone = JSON.parse(JSON.stringify(getBlock()));
      clone.id = 'block-antes'; clone.name = 'De antes';
      profile.blocks[clone.id] = clone; profile.blockOrder.push(clone.id);
      commit();
    })()`);
    asked.length = 0;
    const past = call('newBlock()');
    await settle();
    const pastTold = asked.slice();
    answerYes();
    await past;
    ok('a profile already past the limit does not grow either, and says how far past it is',
       count() === cap + 1 && pastTold.length === 1 && pastTold[0].body.indexOf(reason(cap + 1)) >= 0,
       count() + ' ' + JSON.stringify(pastTold));

    Object.assign(app, real);
    call('Date.now = __now; __full = null; if (askResolve) closeAsk(false);');
  }

  /* blockDoneSets, a raw storage count, used to answer buildBlockReview's
     "sets" field — so a week logged after the block was shortened (a
     stranded week, CONTEXT.md) counted here while blockTonnageByWeek,
     right beside it, already stopped at the block's own weeks. The two
     numbers on the review disagreed about which weeks they covered. */
  console.log('\n== buildBlockReview counts done sets over the block\'s own weeks, matching tonnage (plans/050) ==');
  const strandedReviewProbe = call(`
    (function() {
      state = defaultState(); migrate();
      const pr = state.profiles.hombre;
      const block = pr.blocks[pr.blockOrder[0]];   /* 8 weeks */
      const day = block.days[0], ex = day.ex[0];
      pr.log[block.id] = {};
      pr.log[block.id][slot(1, day.id)] = { [ex.id]: [{ w: '60', r: '8', done: true }] };
      pr.log[block.id][slot(2, day.id)] = { [ex.id]: [{ w: '62.5', r: '8', done: true }, { w: '62.5', r: '7', done: true }] };
      /* Tagged 'alta' on both its in-bounds slot and the stranded one below
         (plans/057): the energy comparison used to walk profile.log raw,
         with no bound to match doneSets'/tonnage's — a stranded week's kilos
         landed in the same bucket as this one. */
      pr.energy[block.id] = { [slot(1, day.id)]: 'alta' };
      pr.week = 2;
      const inBounds = buildBlockReview(pr, block);
      /* Week 9 is past this block's own 8 weeks — stranded on purpose. */
      pr.log[block.id][slot(9, day.id)] = {
        [ex.id]: [{ w: '999', r: '1', done: true }, { w: '999', r: '1', done: true }, { w: '999', r: '1', done: true }],
      };
      pr.energy[block.id][slot(9, day.id)] = 'alta';
      logChanged();
      const withStranded = buildBlockReview(pr, block);
      return {
        sets: inBounds.sets, tonnage: inBounds.tonnage, energyAlta: inBounds.energy.alta,
        setsWithStranded: withStranded.sets, tonnageWithStranded: withStranded.tonnage,
        weeksLoggedWithStranded: withStranded.weeksLogged, energyAltaWithStranded: withStranded.energy.alta,
      };
    })()
  `);
  ok('a stranded week\'s sets are not in the review\'s count',
     strandedReviewProbe.sets === 3 && strandedReviewProbe.setsWithStranded === 3,
     JSON.stringify(strandedReviewProbe));
  ok('the tonnage and the count still agree on which weeks they cover, stranded week or not',
     strandedReviewProbe.tonnageWithStranded === strandedReviewProbe.tonnage &&
     strandedReviewProbe.weeksLoggedWithStranded === 2,
     JSON.stringify(strandedReviewProbe));
  ok('a stranded week tagged with the same energy is not in that bucket\'s mean either (plans/057)',
     strandedReviewProbe.energyAlta.n === 1 &&
     strandedReviewProbe.energyAltaWithStranded.n === 1 &&
     strandedReviewProbe.energyAltaWithStranded.kg === strandedReviewProbe.energyAlta.kg,
     JSON.stringify(strandedReviewProbe));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
