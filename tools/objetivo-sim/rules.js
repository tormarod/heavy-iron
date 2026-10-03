/* The rules the simulator compares, all with one signature:
   (ctx) → { kind, sets: [{ w, r }] }, or null when there is no history.

     actual       targetFor itself, unchanged
     actualFixed  targetFor with its two input bugs patched from outside:
                  an empty RIR box read as the week's own RIR instead of as
                  failure, and the deload week not read as a layoff
     todas        textbook double progression, the plan's own week-2/3 text
     primera      one weight, the first set alone decides the step
     rango        one weight, the step comes when the next rung keeps every
                  set inside the range

   The three new ones prescribe ONE weight per exercise, read nothing but
   the log and the plan (no RIR), and never ask a set for fewer reps at the
   same weight than its best there. */
const app = require('./app.js');

/* ---- actual ---- */
const actual = ctx => app.target(ctx.spec, ctx.block, ctx.week, ctx.now);
function actualFixed(ctx) {
  const sessions = ctx.spec.sessions.map(s => ({ ...s, sets: s.sets.map(x =>
    x.rir != null ? x : { ...x, rir: app.weekRir(ctx.phase, ctx.ex, s.week) }) }));
  const hard = sessions.filter(s => !s.deload), lastAny = sessions[sessions.length - 1];
  const now = lastAny && lastAny.deload && hard.length ? hard[hard.length - 1].ts + 7 * 86400000 : ctx.now;
  return app.target({ ...ctx.spec, sessions }, ctx.block, ctx.week, now);
}

/* ---- shared by the new ones ---- */
const hardOf = ctx => ctx.spec.sessions.filter(s => !s.deload);
const same = (a, b) => Math.abs(a - b) < 1e-6;
/* Same effort, another weight: Epley solved for the reps at W2 of a set
   that did r at W1. Needs no RIR — it assumes the set is taken as hard as
   it was last time. */
const repsAtSameEffort = (r, W1, W2) => Math.floor(30 * ((W1 / W2) * (1 + r / 30) - 1) + 1e-9);
/* The weights already logged are the stack (the app's own loadLadder). */
function nextRung(hist, W, inc) {
  const seen = new Set();
  hist.forEach(h => h.sets.forEach(x => seen.add(x.w)));
  const up = [...seen].filter(v => v > W + 1e-6 && v <= W + 1.5 * inc + 1e-6).sort((a, b) => a - b);
  return up.length ? up[0] : W + inc;
}
/* The deload as the app prescribes it: half the sets, bottom of the range,
   ~60 % of the working weight. */
function deload(ctx, hist) {
  const inc = ctx.ex.inc, W = hist[hist.length - 1].sets[0].w;
  const w = Math.max(inc, Math.floor(W * 0.6 / inc) * inc);
  return { kind: 'descarga', sets: Array.from({ length: ctx.n }, () => ({ w, r: ctx.lo })) };
}
/* The run of sessions at one weight, ending at `end`. */
function runAt(hist, end) {
  const W = hist[end].sets[0].w, run = [];
  let i = end;
  for (; i >= 0 && same(hist[i].sets[0].w, W); i--) run.push(hist[i]);
  return { W, run, prevEnd: i };
}
function perSetBest(run, W, n) {
  return Array.from({ length: n }, (_, k) => {
    const rs = run.map(h => h.sets[k] && same(h.sets[k].w, W) ? h.sets[k].r : null).filter(v => v != null);
    return rs.length ? Math.max.apply(null, rs) : null;
  });
}
/* Each set's best at the current weight. A bad day cannot lower it; only a
   new weight starts it again — and a first session at a new weight that
   falls short of what the step promised (the old weight's best, priced at
   the new one) does not lower the ask either. A set the plan has just
   added (ex.add) has no history: it is asked for two under the set before. */
function bestAtWeight(hist, n, hi) {
  const { W, run, prevEnd } = runAt(hist, hist.length - 1);
  const own = perSetBest(run, W, n);
  let promise = null;
  if (prevEnd >= 0) {
    const p = runAt(hist, prevEnd);
    if (p.W < W) promise = perSetBest(p.run, p.W, n).map(b => b == null ? null : Math.min(hi, repsAtSameEffort(b, p.W, W)));
  }
  const best = [], fresh = [];
  own.forEach((b, k) => {
    if (b != null) { best.push(promise && promise[k] != null ? Math.max(b, promise[k] - 1) : b); fresh.push(false); }
    else { best.push(best.length ? Math.max(1, best[best.length - 1] - 2) : run[0].sets[0].r); fresh.push(true); }
  });
  return { W, best, fresh, run };
}
/* Same weight: one more rep than each set's best, never past the top of the
   range — except a set already there, which keeps climbing when `climb`
   says so rather than being asked for nothing new. */
function moreReps(W, best, fresh, hi, climb) {
  return best.map((b, k) => fresh[k] ? { w: W, r: b }
    : { w: W, r: Math.max(b, Math.min(climb && b >= hi ? Infinity : hi, b + 1)) });
}
const stepUp = (W, W2, best) => best.map(b => ({ w: W2, r: Math.max(1, repsAtSameEffort(b, W, W2)) }));

/* ---- todas: every set at the top, then up ---- */
function todas(ctx) {
  const hist = hardOf(ctx);
  if (!hist.length) return null;
  if (ctx.deload) return deload(ctx, hist);
  const { W, best, fresh } = bestAtWeight(hist, ctx.n, ctx.hi);
  if (hist[hist.length - 1].sets.every(s => s.r >= ctx.hi)) {
    const W2 = nextRung(hist, W, ctx.ex.inc);
    return { kind: 'up', sets: stepUp(W, W2, best).map(s => ({ w: s.w, r: Math.min(ctx.hi, s.r) })) };
  }
  return { kind: 'reps', sets: moreReps(W, best, fresh, ctx.hi, false) };
}

/* ---- primera / rango ----
   Both step when the first set has reached the top and the next rung still
   keeps it inside the range at the same effort. `rango` also asks that ONE
   session showed every set staying in the range at the new weight; without
   that, a lucky day steps the weight up and strands the back sets under
   the range, and nothing ever brings it back (the ratchet `primera` shows
   on a lifter who has stopped improving). */
function firstLeads(ctx, everySet) {
  const hist = hardOf(ctx);
  if (!hist.length) return null;
  if (ctx.deload) return deload(ctx, hist);
  const { W, best, fresh, run } = bestAtWeight(hist, ctx.n, ctx.hi);
  const W2 = nextRung(hist, W, ctx.ex.inc);
  const fits = best[0] >= ctx.hi && repsAtSameEffort(best[0], W, W2) >= ctx.lo;
  const shown = run.some(h => h.sets[0].r >= ctx.hi && h.sets.every(x => repsAtSameEffort(x.r, W, W2) >= ctx.lo));
  if (fits && (!everySet || shown)) return { kind: 'up', sets: stepUp(W, W2, best) };
  return { kind: 'reps', sets: moreReps(W, best, fresh, ctx.hi, true) };
}
const primera = ctx => firstLeads(ctx, false);
const rango = ctx => firstLeads(ctx, true);

module.exports = { actual, actualFixed, todas, primera, rango, repsAtSameEffort };
