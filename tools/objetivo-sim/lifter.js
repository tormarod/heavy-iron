/* A simulated lifter trains one exercise through consecutive 8-week blocks.
   Before every session a rule says what to do; the lifter does what their
   true strength that day allows, the session is logged, and the next
   target is computed from the log. Every number the lifter is built from
   is named below with where it comes from. */
const app = require('./app.js');

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* The shipped "Hombre — Bloque 1" phase text, verbatim; weekRir reads it
   exactly as the app does (2–3 → 2, 1–2 → 1, 0–1 → 0). */
const PHASE = {
  1: { r: '3 RIR' }, 2: { r: '2–3 RIR' }, 3: { r: '2 RIR' }, 4: { r: '1–2 RIR' },
  5: { r: '1–2 RIR' }, 6: { r: '1 RIR' }, 7: { r: '0–1 RIR' }, 8: { r: 'Descarga' },
};
const WEEKS = 8, DELOAD = 8;

/* Fatigue between consecutive sets: the decay docs/guide.md measured on the
   real chest-press log (1 · 0,952 · 0,929 · 0,904), as a drop per set. It
   was measured on sets taken near failure, so a previous set stopped
   further from failure costs proportionally less (never under 40 %). */
const DROP = [0, 1 - 0.952, 1 - 0.929 / 0.952, 1 - 0.904 / 0.929, 1 - 0.904 / 0.929];

/* Exercises as the shipped plan writes them. `step` is what the machine
   really allows and `E0` the lifter's starting 1RM-equivalent. inc equals
   the step so that a first step up is not a configuration artefact. */
const EXERCISES = {
  chestpress: { ex: { id: 'chestpress', n: 'Press de pecho', sets: 4, add: 5, inc: 2.5, reps: '6–10' }, step: 2.5, E0: 80 },
  lateral:    { ex: { id: 'lat1', n: 'Elevaciones laterales', sets: 4, inc: 1, reps: '12–20' }, step: 1, E0: 16 },
  pecdeck:    { ex: { id: 'pecdeck', n: 'Contractora', sets: 4, inc: 5, reps: '12–15' }, step: 5, E0: 75 },
  hack:       { ex: { id: 'hacksquat', n: 'Sentadilla hack', sets: 3, inc: 5, minRir: 1, reps: '8–12' }, step: 5, E0: 160 },
};

const range = ex => { const m = /(\d+)\D+(\d+)/.exec(ex.reps); return [+m[1], +m[2]]; };
const setsFor = (ex, week) => {
  let n = ex.sets; if (ex.add && week >= ex.add) n++;
  if (week === DELOAD) n = Math.min(n, Math.max(2, Math.ceil(n / 2)));
  return n;
};
const onStack = (w, step) => Math.max(step, Math.round(w / step + 1e-9) * step);

/* `gain` per week, `sd` the day-to-day spread of strength (2-4 % is the
   usual range for a trained lifter's daily 1RM), `behave` what the lifter
   does with the number, `logRir` what goes in the RIR box, `curve` the
   true reps-to-failure curve (Epley is what the app assumes; Brzycki is a
   deliberately different truth). */
function makeLifter(o) {
  const r = rng(o.seed);
  return { ...o, today: (E, t) => E * Math.pow(1 + o.gain, t) * (1 + o.sd * gauss(r)) };
}
function maxReps(curve, w, cap) {
  const v = curve === 'brzycki' ? 37 - 36 * w / cap : 30 * (cap / w - 1);
  return Math.max(0, Math.floor(v + 1e-9));
}

/*   target  does the number and stops; fails short if it cannot
     hybrid  at least the number, and on to the week's RIR if there is more
     rir     ignores the number and trains to the week's RIR
     capped  the number, but never past the week's RIR */
function doSet(L, w, cap, tReps, q) {
  const m = maxReps(L.curve, w, cap);
  let reps;
  if (L.behave === 'target') reps = Math.min(tReps, m);
  else if (L.behave === 'rir') reps = m - q;
  else if (L.behave === 'capped') reps = Math.min(tReps, m - q);
  else reps = Math.min(m, Math.max(tReps, m - q));
  reps = Math.max(1, reps);
  const trueRir = Math.max(0, m - reps);
  const rir = L.logRir === 'honest' ? Math.min(5, trueRir) : L.logRir === 'under' ? Math.min(5, Math.max(0, trueRir - 1)) : null;
  return { w, r: reps, rir, trueRir };
}

function run(rule, exKey, L, nBlocks) {
  const X = EXERCISES[exKey], ex = X.ex, [lo, hi] = range(ex);
  const blocks = [];
  for (let b = 1; b <= nBlocks; b++) blocks.push({ id: 'B' + b, weeks: WEEKS, deload: DELOAD, phase: PHASE });
  const sessions = [], trace = [];
  const T0 = Date.UTC(2026, 0, 5), DAY = 86400000;
  let t = 0;
  for (let b = 1; b <= nBlocks; b++) {
    for (let week = 1; week <= WEEKS; week++, t++) {
      const ts = T0 + t * 7 * DAY;
      const q = app.weekRir(PHASE, ex, week), n = setsFor(ex, week);
      const ctx = { ex, lo, hi, n, week, block: 'B' + b, q, deload: week === DELOAD, phase: PHASE,
                    spec: { ex, blocks, sessions }, now: ts };
      const tgt = rule(ctx);
      const E = L.today(X.E0, t);
      /* No history yet: the lifter picks the weight that puts the middle of
         the range at the week's RIR, the way week 1 asks. */
      const plan = tgt ? tgt.sets : Array.from({ length: n }, () =>
        ({ w: onStack(E / (1 + ((lo + hi) / 2 + q) / 30), X.step), r: Math.round((lo + hi) / 2) }));
      const done = [];
      let cap = E, prevRir = 0;
      for (let k = 0; k < n; k++) {
        const p = plan[k] || plan[plan.length - 1], w = onStack(p.w, X.step);
        if (k > 0) cap *= 1 - DROP[Math.min(k, DROP.length - 1)] * Math.max(0.4, 1 - 0.15 * Math.min(prevRir, 4));
        const d = week === DELOAD ? { w, r: p.r, rir: null, trueRir: maxReps(L.curve, w, cap) - p.r } : doSet(L, w, cap, p.r, q);
        done.push(d);
        prevRir = week === DELOAD ? 4 : d.trueRir;
      }
      sessions.push({ block: 'B' + b, week, ts, deload: week === DELOAD, sets: done.map(d => ({ w: d.w, r: d.r, rir: d.rir })) });
      trace.push({ block: b, week, q, E, tgt, plan, done, deload: week === DELOAD });
    }
  }
  return { trace, lo, hi, step: X.step };
}

/* Two families of score, as percentages.
   "Weird" is what the objetivo was asked to stop doing, per session:
     repsDown   a set asked for fewer reps at the same weight than it did
                last time, or than it was asked last time
     weightDown a set asked to go lighter (the deload aside)
     stale      an ask that asks nothing new
     split      more than one weight in one session
   "Useful" is whether following it trains well:
     hit        sets that met the number
     beat       sessions that beat the one before (more weight, or more
                reps on a set and fewer on none)
     effort     sets 0-3 reps from failure; junk sets 5+ from it
     inRange    sets inside the rep range; near within two reps of it
     rirOk      sets within one rep of the week's prescribed RIR
     perStep    sessions per load increase
     loadGain   first set's weight, last hard week vs first, against what
                true strength did over the same weeks */
function score(res) {
  const { trace, lo, hi, step } = res;
  const c = { sessions: 0, repsDown: 0, weightDown: 0, stale: 0, split: 0, weird: 0, setN: 0, tgtSets: 0, hit: 0,
              effort: 0, junk: 0, inRange: 0, near: 0, rirOk: 0, beat: 0, steps: 0, pairs: 0 };
  const same = (a, b) => Math.abs(a - b) < 1e-6;
  let prev = null;
  trace.forEach(x => {
    if (x.deload) return;
    if (prev && x.tgt && x.tgt.kind !== 'descarga') {
      c.sessions++;
      const ts = x.tgt.sets.map(p => ({ w: onStack(p.w, step), r: p.r }));
      const pp = prev.plan.map(p => ({ w: onStack(p.w, step), r: p.r }));
      let rd = false, wd = false;
      ts.forEach((p, k) => {
        const L = prev.done[k], P = prev.tgt ? pp[k] : null;
        if ((L && same(p.w, L.w) && p.r < L.r) || (P && same(p.w, P.w) && p.r < P.r)) rd = true;
        if (L && p.w < L.w - 1e-6) wd = true;
      });
      const met = prev.tgt && prev.done.every((d, k) => d.r >= pp[k].r);
      const nothing = ts.every((p, k) => prev.done[k] && same(p.w, prev.done[k].w) && p.r <= prev.done[k].r);
      const again = prev.tgt && ts.length === pp.length && ts.every((p, k) => same(p.w, pp[k].w) && p.r === pp[k].r);
      const st = nothing || (met && again), sp = new Set(ts.map(p => p.w)).size > 1;
      c.repsDown += rd; c.weightDown += wd; c.stale += st; c.split += sp; c.weird += rd || wd || st || sp;
    }
    x.done.forEach((d, k) => {
      c.setN++;
      const p = x.plan[k] || x.plan[x.plan.length - 1];
      if (x.tgt) { c.tgtSets++; if (d.r >= p.r) c.hit++; }
      if (d.trueRir <= 3) c.effort++;
      if (d.trueRir >= 5) c.junk++;
      if (d.r >= lo && d.r <= hi) c.inRange++;
      if (d.r >= lo - 2 && d.r <= hi + 2) c.near++;
      if (Math.abs(d.trueRir - x.q) <= 1) c.rirOk++;
    });
    if (prev) {
      c.pairs++;
      if (x.done[0].w > prev.done[0].w + 1e-6) { c.beat++; c.steps++; }
      else if (same(x.done[0].w, prev.done[0].w) && x.done.some((d, k) => prev.done[k] && d.r > prev.done[k].r)
               && !x.done.some((d, k) => prev.done[k] && d.r < prev.done[k].r)) c.beat++;
    }
    prev = x;
  });
  const hard = trace.filter(x => !x.deload), first = hard[0], last = hard[hard.length - 1];
  const pct = v => Math.round(1000 * v) / 10;
  return {
    weird: pct(c.weird / c.sessions), repsDown: pct(c.repsDown / c.sessions), weightDown: pct(c.weightDown / c.sessions),
    stale: pct(c.stale / c.sessions), split: pct(c.split / c.sessions),
    hit: pct(c.hit / c.tgtSets), beat: pct(c.beat / c.pairs), effort: pct(c.effort / c.setN), junk: pct(c.junk / c.setN),
    inRange: pct(c.inRange / c.setN), near: pct(c.near / c.setN), rirOk: pct(c.rirOk / c.setN),
    perStep: Math.round(10 * c.pairs / Math.max(1, c.steps)) / 10,
    loadGain: pct(last.done[0].w / first.done[0].w - 1), strengthGain: pct(last.E / first.E - 1),
  };
}

module.exports = { run, score, makeLifter, onStack, EXERCISES, PHASE };
