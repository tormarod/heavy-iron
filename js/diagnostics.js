/* ---------- Diagnóstico ----------
   Twenty-two exercises, each with its own chart behind its own button.
   Nobody opens twenty-two charts, and the diagnosis was never in any one of
   them anyway — it is in the comparison, and nothing was making it.

   This screen fits a line through the estimated 1RM of every exercise in
   the current plan at once and sorts them worst first, then crosses each
   trend with the signals the log already carries — the RIR chip, the
   rep-decay flag, forced drops, the timestamps on every ticked row, and the
   target weight from targetEstimate(). A stall on its own says nothing. A
   stall next to "RIR 2+ every week" and a stall next to "0 RIR and a forced
   drop" point at opposite fixes, which is exactly why guessing at it goes
   wrong.

   Nothing here asks for a single new input. Everything it reads is already
   being typed, or already derived from what is.

   Loaded before app.js, so — like block-editor.js — every line of DOM
   wiring waits inside wireDiagnostics() until app.js has called it. */

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

const DIAG_TRENDS = {
  down: { label: 'bajando', plural: 'bajando', rank: 0 },
  flat: { label: 'plano', plural: 'planos', rank: 1 },
  up: { label: 'subiendo', plural: 'subiendo', rank: 2 },
  none: { label: 'sin datos', plural: 'sin datos', rank: 3 },
};

let diagScope = 'block';  /* 'block' | 'all' */

/* Every session this exercise was logged in, oldest first, as one e1RM
   point each. Modelled on collectHistoryAll(), but it keeps what the charts
   have no use for and the diagnosis does: which rows the point came from
   (for rep decay and forced drops), the RIR chip filed against it, and the
   timestamp, so a gap between sessions can be told from a gap in progress.

   Sets above EST_MAX_REPS reps are dropped rather than plotted: Epley
   drifts badly up there, and one 20-rep back-off set would otherwise fake a
   trend that never happened. */
function diagPoints(profile, exId, onlyBlockId) {
  const out = [];
  profile.blockOrder.forEach(bId => {
    if (onlyBlockId && bId !== onlyBlockId) return;
    const block = profile.blocks[bId];
    const blk = profile.log[bId];
    if (!block || !blk) return;
    for (let w = 1; w <= blockWeeks(block); w++) {
      Object.keys(blk).forEach(k => {
        const m = /^w(\d+)-(.+)$/.exec(k);
        if (!m || +m[1] !== w) return;
        const rows = blk[k][exId];
        if (!Array.isArray(rows)) return;
        const done = rows.filter(r => r && r.done && hasReps(r) && num(r.w) > 0 && num(r.r) <= EST_MAX_REPS);
        if (!done.length) return;
        let best = done[0];
        done.forEach(r => { if (est1RM(num(r.w), num(r.r)) > est1RM(num(best.w), num(best.r))) best = r; });
        out.push({
          label: block.name + ' · S' + w,
          e1rm: est1RM(num(best.w), num(best.r)),
          weight: num(best.w),
          reps: num(best.r),
          ts: rows.reduce((t, r) => (r && r.done && r.ts > t ? r.ts : t), 0),
          rir: getRir(profile, bId, w, m[2], exId),
          rows: rows.filter(r => r && r.done),
        });
      });
    }
  });
  return out;
}

/* Least squares over the window, expressed as a fraction of the exercise's
   own mean e1RM so the number is comparable between a lateral raise and a
   leg press. */
function diagSlope(points) {
  const n = points.length;
  const mx = (n - 1) / 2;
  const my = points.reduce((t, p) => t + p.e1rm, 0) / n;
  let cov = 0, varx = 0;
  points.forEach((p, i) => { cov += (i - mx) * (p.e1rm - my); varx += (i - mx) * (i - mx); });
  const slope = varx ? cov / varx : 0;
  return my ? slope / my : 0;
}

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
   fatigue problem even if the RIR chip also said 2+ three weeks ago. */
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
    return { lectura: 'Estancado, sin una señal clara en el registro',
             cambio: 'Marca el RIR unas semanas: sin eso no se puede distinguir fatiga de falta de intensidad.' };
  }
  if (trend === 'up') {
    /* The one row of the matrix that needs the volume side: growing on
       fewer sets than the range asks for is not a problem, it is unused
       margin — and the muscle you said the block was for is where to
       spend it. */
    if (sig.volLow) {
      return { lectura: 'Funciona, y con margen: ' + sig.volTag + ' se queda por debajo de la franja de series' +
                 (sig.volPriority ? ', siendo prioritario' : ''),
               cambio: 'Va bien con pocas series. Si quieres más, añádeselas a ' + sig.volTag + ' antes que a nada.' };
    }
    return { lectura: 'Funciona', cambio: 'No toques nada.' };
  }
  return { lectura: 'Aún no hay suficientes sesiones',
           cambio: 'Hacen falta ' + DIAG_MIN_SESSIONS + ' sesiones con peso y reps anotados.' };
}

/* One row per exercise of the live plan. The verdict is computed over the
   window; the signals are read off the most recent sessions, since what you
   change on Monday answers to how last Monday went. */
function diagRows(profile, block) {
  const rows = [];
  const seen = new Set();
  /* Volume as actually logged, not as prescribed: "you have room to add
     sets" is a claim about the sets you did. Computed once for the whole
     block and looked up per exercise by its muscle tag. */
  const volByTag = {};
  volumeTrendRows('log', profile, block, 'muscle').forEach(r => { volByTag[r.label] = r; });
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      if (seen.has(ex.id)) return;
      seen.add(ex.id);
      const all = diagPoints(profile, ex.id, diagScope === 'all' ? '' : block.id);
      const points = all.slice(-DIAG_WINDOW);
      const est = targetEstimate(profile, block, day, ex, profile.week);
      const last = points[points.length - 1];
      const recent = points.slice(-3);
      const sig = {
        easy: recent.filter(p => p.rir === '2+').length >= 2,
        failure: !!last && (last.rir === '0' || forcedDrop(last.rows)),
        decay: !!last && repDecay(last.rows) >= 3,
        estDown: !!est && est.kind === 'down',
        gap: diagMedianGap(points),
      };
      const vol = volByTag[muscleTag(ex)];
      if (vol && vol.label !== UNCLASSIFIED_LABEL) {
        sig.volTag = vol.label;
        sig.volPriority = vol.priority;
        sig.volLow = vol.zone === 'under' || vol.zone === 'maint';
      }
      let trend = 'none', pct = 0, change = null;
      if (points.length >= DIAG_MIN_SESSIONS) {
        pct = diagSlope(points);
        trend = pct >= DIAG_FLAT ? 'up' : pct <= -DIAG_FLAT ? 'down' : 'flat';
        const first = points[0].e1rm;
        if (first > 0) change = (last.e1rm - first) / first;
      }
      rows.push(Object.assign({
        id: ex.id, name: ex.n, day: day.name, sessions: points.length,
        trend: trend, pct: pct, change: change, est: est,
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

function drawDiag() {
  const profile = getProfile(), block = getBlock();

  $('diagScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === diagScope ? 'true' : 'false');
    b.onclick = () => { diagScope = b.dataset.scope; drawDiag(); };
  });

  const rows = diagRows(profile, block);
  const counted = rows.filter(r => r.trend !== 'none');
  const tally = ['down', 'flat', 'up', 'none']
    .map(t => ({ t: t, n: rows.filter(r => r.trend === t).length }))
    .filter(x => x.n > 0)
    .map(x => x.n + ' ' + (x.n === 1 ? DIAG_TRENDS[x.t].label : DIAG_TRENDS[x.t].plural))
    .join(' · ');

  $('diagSub').textContent = (diagScope === 'all'
    ? 'Todos los bloques — pendiente del 1RM estimado en las últimas ' + DIAG_WINDOW + ' sesiones de cada ejercicio del plan actual.'
    : block.name + ' — pendiente del 1RM estimado en las últimas ' + DIAG_WINDOW + ' sesiones de cada ejercicio.') +
    (counted.length ? ' ' + tally + '.' : '');

  const host = $('diagHost');
  host.innerHTML = '';
  if (!counted.length) {
    host.innerHTML = '<p class="chart-empty">Aún no hay ningún ejercicio con ' + DIAG_MIN_SESSIONS +
      ' sesiones registradas con peso y repeticiones. Sigue anotando: esto se llena solo.</p>';
    return;
  }

  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'diag-row ' + r.trend;
    /* Two exercises can share a name (the same lateral raise on two days),
       so the row carries the id it was computed from. */
    el.dataset.ex = r.id;
    el.innerHTML =
      '<div class="diag-head">' +
        '<span class="diag-name"></span>' +
        '<span class="diag-chip"></span>' +
      '</div>' +
      '<div class="diag-num"></div>' +
      '<div class="diag-read"></div>' +
      '<div class="diag-do"></div>';
    el.querySelector('.diag-name').textContent = r.name;
    el.querySelector('.diag-chip').textContent = DIAG_TRENDS[r.trend].label;
    el.querySelector('.diag-num').textContent = r.trend === 'none'
      ? (r.sessions === 0 ? 'sin sesiones registradas'
        : r.sessions === 1 ? '1 sesión registrada' : r.sessions + ' sesiones registradas')
      : diagPct(r.change) + ' en ' + r.sessions + ' sesiones · ' + diagPct(r.pct) + ' por sesión';
    el.querySelector('.diag-read').textContent = r.lectura;
    el.querySelector('.diag-do').textContent = r.cambio;
    host.appendChild(el);
  });
}

function openDiag() {
  drawDiag();
  openSheet('diagSheet');
}

function wireDiagnostics() {
  $('diagBtn').onclick = openDiag;
  $('diagClose').onclick = () => closeSheet('diagSheet');
  $('diagSheet').addEventListener('click', e => { if (e.target.id === 'diagSheet') closeSheet('diagSheet'); });
}
