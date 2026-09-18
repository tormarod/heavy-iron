/* ---------- warm-up ramp & plate calculator ----------
   A standalone tool, not wired to any particular exercise or set: enter a
   working weight, get a warm-up ramp and — for barbell work — the plates
   for each side. Bar weight and the available plate set are settings
   (state.prefs.barWeight/.plates, defaulted in migrate() and editable from
   Ajustes) so this sheet only ever reads them.

   Split out of js/app.js as the first of the five seams that file's own
   section comments mark (plans/008 item 13). It is the smallest and the
   most self-contained: nothing else in the app calls into it, and the only
   things it calls out to are $/esc/num/units/state and openSheet/closeSheet,
   all of them at click time rather than at parse time.

   Loaded before app.js, so — like block-editor.js, diagnostics.js and
   review.js — its DOM wiring waits inside wireCalculator() until app.js
   calls it. */

/* 40/60/80% of the target, each rounded to the nearest loadable step and
   never below `floor` (the empty bar, on barra mode) — the actual target
   weight is a separate, unrounded fourth row, since a plate breakdown for
   *that* has to fit the number you asked for, not a rounded stand-in. */
/* Consecutive steps can round to the same loadable weight (target 15,
   increment 10 gives 10/10/10/15) — collapsing the duplicates rather than
   drawing three identical rows the lifter has to notice are the same.
   Each row carries its own label because of that: drawCalc used to pick
   labels positionally out of ['40%', '60%', '80%', 'Objetivo'], so a
   collapsed two-row ramp called the working weight "60%" and never showed
   "Objetivo" at all (plans/013). */
function warmupRamp(target, step, floor) {
  const rows = [0.4, 0.6, 0.8].map(p => ({ pct: Math.round(p * 100) + '%', weight: Math.max(floor || 0, roundToStep(target * p, step)) }));
  return rows.filter((r, i) => i === 0 || r.weight !== rows[i - 1].weight);
}

/* Belt-and-braces alongside the PLATE_MIN/MAX clamp in migrate(): a plate
   set never reaches here except through state.prefs, but nothing about this
   function itself guarantees that, so a stray near-zero value cannot blow
   up either path below. */
const FIT_PLATES_MAX = 200;

/* Plates are a small multiset with unlimited count per side, so this is
   unbounded coin-change, not a knapsack that needs backtracking: quantize to
   quarter-units (finer than any plate migrate() accepts) so the weights
   become a small integer problem, then fill a minimum-coins table bottom-up
   and read the largest reachable sum back off. Largest-first greedy used to
   report a shortfall a smaller combination would have covered — e.g. plates
   25/20/15/10 for a 30 target took 25 and reported "falta 5" although
   15 + 15 fits exactly — and, separately, could use more plates than
   necessary for a fit it did find. */
const FIT_PLATES_DP_CAP = 4000;  /* 1000 kg/lb per side in quarter-units — no real plate load gets close */

function fitPlates(perSide, plateSet) {
  const perSideClamped = Math.max(0, perSide);
  const QUARTER_UNITS = 4;
  const target = Math.round(perSideClamped * QUARTER_UNITS);
  const coins = Array.from(new Set((plateSet || []).filter(p => p > 0).map(p => Math.round(p * QUARTER_UNITS))))
    .filter(c => c > 0 && c <= FIT_PLATES_DP_CAP)
    .sort((a, b) => b - a);
  if (!coins.length || target <= 0) {
    const remainder0 = Math.round(perSideClamped * 100) / 100;
    return { plates: [], remainder: remainder0 > 0.01 ? remainder0 : 0 };
  }
  const cap = Math.min(target, FIT_PLATES_DP_CAP);
  /* count[s] holds the fewest coins that reach sum s, and via[s] one of the
     coins that achieves that count — a proper minimum-coins table, not just
     a feasibility one, so the breakdown shown is also the fewest plates
     rather than whichever largest-first pick happens to be feasible. -1
     means s cannot be made at all from these coins. */
  const count = new Int32Array(cap + 1).fill(-1);
  const via = new Int32Array(cap + 1).fill(-1);
  count[0] = 0;
  for (let s = 1; s <= cap; s++) {
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (c <= s && count[s - c] >= 0 && (count[s] < 0 || count[s - c] + 1 < count[s])) {
        count[s] = count[s - c] + 1;
        via[s] = c;
      }
    }
  }
  let best = 0;
  for (let s = cap; s > 0; s--) { if (count[s] >= 0) { best = s; break; } }
  const used = [];
  let s = best, reached = 0, guard = 0;
  while (s > 0 && guard++ < FIT_PLATES_MAX) { const c = via[s]; used.push(c / QUARTER_UNITS); reached += c; s -= c; }
  /* Derived from `reached` (the sum of plates actually pushed above), not
     from `best`: if the guard cap is ever hit mid-reconstruction, `used`
     stops short of `best` and the remainder must reflect that shortfall
     rather than silently claiming the untruncated fit. */
  const remainder = Math.round((perSideClamped - reached / QUARTER_UNITS) * 100) / 100;
  return { plates: used, remainder: remainder > 0.01 ? remainder : 0 };
}

let calcDraft = { mode: 'bar', target: '', inc: '' };

function openCalc() {
  if (!(num(calcDraft.inc) > 0)) calcDraft.inc = String(DEFAULT_STACK_INC[units()]);
  drawCalc();
  openSheet('calcSheet');
}

function drawCalc() {
  const u = units();
  $('calcTargetU').textContent = u;
  $('calcIncU').textContent = u;
  $('calcMode').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === calcDraft.mode ? 'true' : 'false');
    b.onclick = () => { calcDraft.mode = b.dataset.mode; drawCalc(); };
  });
  const isBar = calcDraft.mode === 'bar';
  $('calcIncField').style.display = isBar ? 'none' : '';
  if ($('calcTarget').value !== calcDraft.target) $('calcTarget').value = calcDraft.target;
  if ($('calcInc').value !== calcDraft.inc) $('calcInc').value = calcDraft.inc;

  const barWeight = state.prefs.barWeight;
  const plates = state.prefs.plates;
  $('calcBarHint').style.display = isBar ? '' : 'none';
  $('calcBarHint').textContent = isBar
    ? 'Barra de ' + barWeight + ' ' + u + ', discos de ' + plates.join('/') + ' ' + u + ' — cámbialo en Ajustes.'
    : '';

  const target = num(calcDraft.target);
  const out = $('calcOut');
  if (!(target > 0)) { out.innerHTML = ''; return; }

  if (isBar && target < barWeight) {
    out.innerHTML = '<p class="chart-empty">El peso objetivo es menor que la barra (' + barWeight + ' ' + esc(u) + ').</p>';
    return;
  }

  let rows;
  if (isBar) {
    const smallest = plates.length ? Math.min(...plates) : DEFAULT_PLATES[u][0];
    const step = smallest * 2;
    const weights = warmupRamp(target, step, barWeight).concat([{ pct: 'Objetivo', weight: target }]);
    rows = weights.map(row => {
      const perSide = (row.weight - barWeight) / 2;
      const fit = fitPlates(perSide, plates);
      const plateTxt = fit.plates.length ? fit.plates.join(' + ') : '(vacía)';
      const remTxt = fit.remainder ? ' · falta ' + fit.remainder + ' ' + u : '';
      return '<tr><td>' + row.pct + '</td><td>' + (Math.round(row.weight * 100) / 100) + ' ' + esc(u) + '</td><td>' + esc(plateTxt + remTxt) + '</td></tr>';
    });
    out.innerHTML = '<table class="chart-table"><thead><tr><th>Paso</th><th>Peso total</th><th>Por lado</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  } else {
    const inc = num(calcDraft.inc) > 0 ? num(calcDraft.inc) : DEFAULT_STACK_INC[u];
    const weights = warmupRamp(target, inc, 0).concat([{ pct: 'Objetivo', weight: target }]);
    rows = weights.map(row => '<tr><td>' + row.pct + '</td><td>' + (Math.round(row.weight * 100) / 100) + ' ' + esc(u) + '</td></tr>');
    out.innerHTML = '<table class="chart-table"><thead><tr><th>Paso</th><th>Peso</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
}

/* Every line here needs $(), which js/app.js defines — and js/app.js is the
   last script on the page. See the call site at the foot of that file. */
function wireCalculator() {
  $('calcTarget').addEventListener('input', e => { calcDraft.target = e.target.value; drawCalc(); });
  $('calcInc').addEventListener('input', e => { calcDraft.inc = e.target.value; drawCalc(); });
  $('calcBtn').onclick = openCalc;
  $('calcClose').onclick = () => closeSheet('calcSheet');
  $('calcSheet').addEventListener('click', e => { if (e.target.id === 'calcSheet') closeSheet('calcSheet'); });
}
