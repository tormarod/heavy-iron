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
     plan         the plan's own text, with no Epley anywhere: one weight,
                  +1 rep per set up to the top, and when every set reached
                  the top last time, the next rung with the bottom of the
                  range as the ask

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
/* A session's working weight: the one most of its sets were done at, the
   heavier on a tie. Not simply the first set's — a calibration week that
   tries one heavy set and backs off for the rest (40 · 30 · 30) was
   trained at 30. */
function workW(s) {
  const n = new Map();
  s.sets.forEach(x => n.set(x.w, (n.get(x.w) || 0) + 1));
  let W = s.sets[0].w;
  n.forEach((c, w) => { if (c > n.get(W) || (c === n.get(W) && w > W)) W = w; });
  return W;
}
/* The run of sessions at one working weight, ending at `end`. */
function runAt(hist, end) {
  const W = workW(hist[end]), run = [];
  let i = end;
  for (; i >= 0 && same(workW(hist[i]), W); i--) run.push(hist[i]);
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
   the new one) does not lower the ask either. A set with no history at
   this weight — one the plan has just added (ex.add), or one that was
   backed off to a lighter weight — is asked for the bottom of the range. */
function bestAtWeight(hist, n, lo, hi, promised) {
  const price = promised || ((b, W1, W2) => Math.min(hi, repsAtSameEffort(b, W1, W2)));
  const { W, run, prevEnd } = runAt(hist, hist.length - 1);
  const own = perSetBest(run, W, n);
  let promise = null;
  if (prevEnd >= 0) {
    const p = runAt(hist, prevEnd);
    if (p.W < W) promise = perSetBest(p.run, p.W, n).map(b => b == null ? null : price(b, p.W, W));
  }
  const best = [], fresh = [];
  own.forEach((b, k) => {
    if (b != null) { best.push(promise && promise[k] != null ? Math.max(b, promise[k] - 1) : b); fresh.push(false); }
    else { best.push(lo); fresh.push(true); }
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
  const { W, best, fresh } = bestAtWeight(hist, ctx.n, ctx.lo, ctx.hi);
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
  const { W, best, fresh, run } = bestAtWeight(hist, ctx.n, ctx.lo, ctx.hi);
  const W2 = nextRung(hist, W, ctx.ex.inc);
  const fits = best[0] >= ctx.hi && repsAtSameEffort(best[0], W, W2) >= ctx.lo;
  const shown = run.some(h => h.sets[0].r >= ctx.hi && h.sets.every(x => repsAtSameEffort(x.r, W, W2) >= ctx.lo));
  if (fits && (!everySet || shown)) return { kind: 'up', sets: stepUp(W, W2, best) };
  return { kind: 'reps', sets: moreReps(W, best, fresh, ctx.hi, true) };
}
const primera = ctx => firstLeads(ctx, false);
const rango = ctx => firstLeads(ctx, true);

/* ---- plan: double progression with no model at all ----
   On a real log (one lifter, 23 load increases) Epley under-read the reps
   at the new weight by a median of six, and a step cost the first set one
   or two reps whatever its size, from +9 % to +56 %. A rule that prices
   steps with it refuses steps the lifter makes easily. So this one prices
   nothing: the reps decide when to go up, and after a step each set is
   asked for two reps under what it did, never under the bottom of the
   range — on that log, two under was met on 70 % of the sets after a
   step, one under on 58 %, the bottom of the range on 97 %. The first
   session at the new weight then sets the baseline the next asks climb
   from. Sets at the top hold there (the plan says "corta a 12 reps")
   while the others catch up. */
function plan(ctx) {
  const hist = hardOf(ctx);
  if (!hist.length) return null;
  if (ctx.deload) return deload(ctx, hist);
  const twoUnder = b => Math.max(ctx.lo, Math.min(ctx.hi, b) - 2);
  const { W, best, fresh } = bestAtWeight(hist, ctx.n, ctx.lo, ctx.hi, twoUnder);
  const last = hist[hist.length - 1];
  const all = last.sets.length >= ctx.n && last.sets.slice(0, ctx.n).every(x => x.w >= W - 1e-6 && x.r >= ctx.hi);
  if (all) {
    const W2 = nextRung(hist, W, ctx.ex.inc);
    return { kind: 'up', sets: best.map(b => ({ w: W2, r: twoUnder(b) })) };
  }
  return { kind: 'reps', sets: moreReps(W, best, fresh, ctx.hi, false) };
}

module.exports = { actual, actualFixed, todas, primera, rango, plan, repsAtSameEffort };
