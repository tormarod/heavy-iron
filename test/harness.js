/* The harness test/unit.js runs the shell in: the document stubs, the script
 * list and the vm context that loads it. Its own file so that the suite
 * reads as tests rather than opening on scaffolding, and so that a second
 * way of loading the shell sits beside the first instead of somewhere in
 * the middle of six thousand lines of assertions (plans/052).
 *
 * Required by test/unit.js; not a test itself, and runs nothing on load.
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
  focus() {}, select() {},
  get innerHTML() { return ''; }, set innerHTML(v) {},
  get textContent() { return ''; }, set textContent(v) {},
  get value() { return ''; }, set value(v) {},
});

/* What a draw needs from a document, and no more. The card builder writes
   each set row as innerHTML and reads its three inputs straight back with
   querySelectorAll, names the exercise with a text node, and a single-card
   redraw swaps the old card out through its parent. The stub above parses
   nothing, so that destructuring binds undefined and load()'s first draw
   falls into recovery: the suite at large runs with `ready` false and never
   draws, which is fine for arithmetic. The precache-hole section has to
   draw — a draw is where a symbol that never loaded costs the most — so it
   asks for this instead. Still not a DOM: every element is inert, every
   query hands back more of them, and nothing a draw writes reads back. */
const drawable = () => Object.assign(inert(), {
  parentNode: {}, replaceWith() {},
  querySelector() { return drawable(); },
  querySelectorAll() { return [drawable(), drawable(), drawable()]; },
});

/* The same order as the <script> tags in index.html — theme-init.js first
   because it loads in <head>, app.js after the ten it wires and then calls
   load() from, and boot-guard.js last, after app.js, because it is the one
   script that has to run even when app.js could not.

   Hoisted out of loadApp() because test/unit.js's first section asserts
   index.html and sw.js agree with it; a second copy would be a fourth list
   to keep in step. */
const SHELL_SCRIPTS = [
  'js/theme-init.js', 'js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
  'js/profile-transfer.js', 'js/calculator.js', 'js/rest-timer.js',
  'js/chart.js', 'js/volume-sheet.js', 'js/qr-transfer.js',
  'js/app.js', 'js/boot-guard.js',
];

/* `omit` drops files from the load, which is how the no-op stubs in app.js
   get exercised: a returning user's service worker can serve an index.html
   whose script tag for a split-out file is missing from the cache, and the
   stubs are the only thing between that and a recovery screen. `drawing`
   swaps in the document above that load()'s first draw can get through. */
function loadApp(omit = [], { drawing = false } = {}) {
  const store = {};
  const el = drawing ? drawable : inert;
  const ctx = vm.createContext({
    document: {
      getElementById: () => el(), createElement: () => el(),
      ...(drawing ? { createTextNode: () => el() } : {}),
      querySelector: () => el(), querySelectorAll: () => [],
      addEventListener() {}, documentElement: el(), body: el(), head: el(),
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

module.exports = { inert, drawable, SHELL_SCRIPTS, loadApp };
