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
let diagView = 'trend';   /* 'trend' per exercise | 'freq' | 'index' per muscle */

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

/* ---------- frequency, from the timestamps already on every row ----------
   Every ticked set carries `r.ts` and nothing read it except one line in
   the session footer. It answers the question that otherwise eats a whole
   block: at three days a week, one skipped session quietly moves chest
   from every ~3,5 days to every ~7, and a lift that stalls on that spacing
   has an attendance record behind it, not a programming problem.

   Which is why this lives in the same sheet as the trend rather than a
   screen of its own — a stall and a nine-day gap have to be read together
   or the wrong thing gets changed. */

/* Local calendar day, not UTC: a set ticked at 23:30 belongs to the day you
   trained, and toISOString() would file half your evening sessions under
   tomorrow. */
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Every exercise the block has ever carried, retired ones included, mapped
   to its muscle. Retired exercises are excluded from the *plan* side below
   — they are not scheduled any more — but the sessions they were logged in
   still happened, and dropping them would invent gaps that were not there. */
function muscleOfBlock(block) {
  const map = {};
  (block.days || []).forEach(day => {
    (day.ex || []).forEach(ex => { map[ex.id] = muscleTag(ex); });
  });
  return map;
}

/* The sessions in which a muscle was actually trained, as one local day
   each, oldest first. A session is a logged day-slot with at least one
   ticked set of an exercise tagged to that muscle; its date is the first
   set ticked in it, which is when you were in the gym. */
function muscleSessions(profile, block, upToWeek) {
  const muscleOf = muscleOfBlock(block);
  const blk = profile.log[block.id] || {};
  const out = {};
  Object.keys(blk).forEach(k => {
    const m = /^w(\d+)-(.+)$/.exec(k);
    if (!m) return;
    const w = +m[1];
    if (w < 1 || w > upToWeek) return;
    const slot = blk[k] || {};
    const firstTs = {};
    Object.keys(slot).forEach(exId => {
      const tag = muscleOf[exId];
      if (!tag) return;
      const rows = slot[exId];
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (!r || !r.done || !(r.ts > 0)) return;
        if (!firstTs[tag] || r.ts < firstTs[tag]) firstTs[tag] = r.ts;
      });
    });
    Object.keys(firstTs).forEach(tag => {
      if (!out[tag]) out[tag] = [];
      out[tag].push(firstTs[tag]);
    });
  });
  Object.keys(out).forEach(tag => out[tag].sort((a, b) => a - b));
  return out;
}

/* Median gap in days between consecutive sessions. Median because one
   holiday in the middle of a block would drag a mean past every threshold
   and label an otherwise well-attended muscle an attendance problem. */
function medianGapDays(stamps) {
  if (!stamps || stamps.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) gaps.push((stamps[i] - stamps[i - 1]) / 86400000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/* How often the plan says to train each muscle: the live days that carry at
   least one exercise for it. Retired exercises are not counted — the plan
   as it stands is what adherence is measured against. */
function plannedMuscleDays(block) {
  const out = {};
  blockTagsFor('muscle', block).forEach(t => { out[t] = 0; });
  dayList(block).forEach(day => {
    const tags = {};
    exList(day).forEach(ex => { tags[muscleTag(ex)] = 1; });
    Object.keys(tags).forEach(t => { out[t] = (out[t] || 0) + 1; });
  });
  return out;
}

/* One row per muscle: how often the plan asks for it, how often you
   actually got there, and the spacing that came out of it. Sorted by the
   thing worth acting on — the widest gaps first. */
function freqRows(profile, block, upToWeek) {
  const planned = plannedMuscleDays(block);
  const sessions = muscleSessions(profile, block, upToWeek);
  const rows = Object.keys(planned).map(tag => {
    const stamps = sessions[tag] || [];
    const plannedTotal = planned[tag] * upToWeek;
    return {
      tag: tag,
      perWeek: planned[tag],
      planned: plannedTotal,
      done: stamps.length,
      adherence: plannedTotal ? stamps.length / plannedTotal : null,
      gap: medianGapDays(stamps),
      priority: isPriority(block, tag),
      last: stamps.length ? stamps[stamps.length - 1] : 0,
    };
  });
  /* Worst attendance first, and "never got there at all" is the worst of
     all — sorting by gap alone would file a muscle with zero sessions
     below one you trained every week, since it has no gaps to measure. */
  return rows.sort((a, b) =>
    (a.adherence == null ? 1 : a.adherence) - (b.adherence == null ? 1 : b.adherence) ||
    (b.gap == null ? -1 : b.gap) - (a.gap == null ? -1 : a.gap) ||
    a.tag.localeCompare(b.tag, 'es'));
}

/* Every day of the block with something ticked on it, and how much — the
   input for the calendar strip below. */
function trainedDays(profile, block) {
  const blk = profile.log[block.id] || {};
  const days = {};
  Object.keys(blk).forEach(k => {
    const slot = blk[k] || {};
    Object.keys(slot).forEach(exId => {
      const rows = slot[exId];
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (!r || !r.done || !(r.ts > 0)) return;
        const key = dayKey(r.ts);
        days[key] = (days[key] || 0) + 1;
      });
    });
  });
  return days;
}

/* A calendar, because the shape of the gaps is the point and a list of
   numbers hides it: one column per week, Monday at the top, shaded by how
   many sets were ticked that day. Capped to the most recent weeks so a
   profile with a year of history still fits on a phone. */
const HEAT_MAX_WEEKS = 18;

function buildHeatmapSVG(days) {
  const keys = Object.keys(days).sort();
  if (!keys.length) return '';
  const parse = k => { const p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const last = parse(keys[keys.length - 1]);
  let first = parse(keys[0]);
  /* Start the grid on the Monday of the first trained week. */
  const back = (first.getDay() + 6) % 7;
  first = new Date(first.getFullYear(), first.getMonth(), first.getDate() - back);
  let weeks = Math.floor((last - first) / (7 * 86400000)) + 1;
  if (weeks > HEAT_MAX_WEEKS) {
    first = new Date(first.getFullYear(), first.getMonth(), first.getDate() + (weeks - HEAT_MAX_WEEKS) * 7);
    weeks = HEAT_MAX_WEEKS;
  }
  const max = Math.max(1, ...keys.map(k => days[k]));

  const cell = 11, gap = 2, padL = 16, padT = 2;
  const W = padL + weeks * (cell + gap), H = padT + 7 * (cell + gap);
  const labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;max-width:' +
    (W * 1.6) + 'px" role="img" aria-label="Días entrenados">';
  labels.forEach((l, r) => {
    if (r % 2) return;  /* every other row, or they collide at this size */
    svg += '<text x="0" y="' + (padT + r * (cell + gap) + cell - 1) + '" font-size="7.5" fill="var(--soft)" ' +
      'font-family="IBM Plex Mono, monospace">' + l + '</text>';
  });
  for (let c = 0; c < weeks; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + c * 7 + r);
      const n = days[dayKey(d.getTime())] || 0;
      const x = padL + c * (cell + gap), y = padT + r * (cell + gap);
      const fill = n ? 'var(--signal)' : 'var(--sunk)';
      const op = n ? (0.35 + 0.65 * (n / max)) : 1;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell +
        '" rx="2" fill="' + fill + '" opacity="' + (Math.round(op * 100) / 100) + '"/>';
    }
  }
  svg += '</svg>';
  return svg;
}

/* ---------- strength index per muscle ----------
   A per-exercise chart fragments every time you change a machine, and over
   a year of blocks you will. "Pecho +8 % en 8 semanas" is the sentence
   actually being looked for, and it is much closer to "my chest grew" than
   any single machine's number.

   Two decisions make it survive a swap:

   1. It indexes to a baseline week rather than plotting kilos. Different
      exercises carry wildly different absolute loads, and a leg press
      would drown an extension in any average of raw weight.
   2. Each week is compared to the baseline over the exercises present in
      BOTH — matched pairs. Averaging whatever was logged that week instead
      would turn every swapped machine into a cliff, which is exactly the
      artefact this view exists to remove.

   The average is of each exercise's own ratio, not a ratio of averages: an
   exercise counts once regardless of what it loads, which is the same
   reason the index is a ratio in the first place. */

/* Best estimated 1RM per exercise per week of this block, as
   { exId: [w1, w2, …] } with null for a week it was not logged. A muscle
   trained on two days in the same week keeps the better of the two — the
   week's best, same rule the progress chart uses within a session. */
function strengthByExercise(profile, block) {
  const muscleOf = muscleOfBlock(block);
  const weeks = blockWeeks(block);
  const blk = profile.log[block.id] || {};
  const out = {};
  Object.keys(blk).forEach(k => {
    const m = /^w(\d+)-(.+)$/.exec(k);
    if (!m) return;
    const w = +m[1];
    if (w < 1 || w > weeks) return;
    const slot = blk[k] || {};
    Object.keys(slot).forEach(exId => {
      if (!muscleOf[exId]) return;
      const rows = slot[exId];
      if (!Array.isArray(rows)) return;
      /* Same rep ceiling as the trend: past it Epley is inventing a number
         rather than reading one, and one 20-rep back-off set would move a
         muscle's whole index. */
      const done = rows.filter(r => r && r.done && hasReps(r) && num(r.w) > 0 && num(r.r) <= EST_MAX_REPS);
      if (!done.length) return;
      let best = 0;
      done.forEach(r => { const v = est1RM(num(r.w), num(r.r)); if (v > best) best = v; });
      if (!out[exId]) out[exId] = new Array(weeks).fill(null);
      if (out[exId][w - 1] == null || best > out[exId][w - 1]) out[exId][w - 1] = best;
    });
  });
  return out;
}

/* One indexed series per muscle. The baseline is the first week that muscle
   has anything logged in — usually week 1, but a log that starts late gets
   a baseline it can actually use instead of an empty chart. */
function strengthRows(profile, block) {
  const muscleOf = muscleOfBlock(block);
  const byEx = strengthByExercise(profile, block);
  const weeks = blockWeeks(block);
  const byMuscle = {};
  Object.keys(byEx).forEach(exId => {
    const tag = muscleOf[exId];
    if (!byMuscle[tag]) byMuscle[tag] = [];
    byMuscle[tag].push(byEx[exId]);
  });

  return Object.keys(byMuscle).map(tag => {
    const series = byMuscle[tag];
    let base = -1;
    for (let w = 0; w < weeks && base < 0; w++) {
      if (series.some(s => s[w] != null)) base = w;
    }
    const index = new Array(weeks).fill(null);
    const matched = new Array(weeks).fill(0);
    if (base >= 0) {
      for (let w = base; w < weeks; w++) {
        const ratios = [];
        series.forEach(s => {
          if (s[base] != null && s[w] != null && s[base] > 0) ratios.push(s[w] / s[base]);
        });
        if (!ratios.length) continue;
        index[w] = 100 * ratios.reduce((t, v) => t + v, 0) / ratios.length;
        matched[w] = ratios.length;
      }
    }
    let lastWeek = -1;
    for (let w = weeks - 1; w >= 0 && lastWeek < 0; w--) if (index[w] != null) lastWeek = w;
    return {
      tag: tag,
      index: index,
      matched: matched,
      base: base,
      lastWeek: lastWeek,
      exercises: series.length,
      change: lastWeek > base ? index[lastWeek] - 100 : null,
      priority: isPriority(block, tag),
    };
  }).sort((a, b) =>
    (a.change == null ? 1 : 0) - (b.change == null ? 1 : 0) ||
    (a.change || 0) - (b.change || 0) ||
    a.tag.localeCompare(b.tag, 'es'));
}

/* Same visual family as the volume trend: a line across the block's weeks,
   with the baseline drawn as the reference it is. Gaps are gaps — a week
   with no matched pair breaks the line rather than being interpolated
   through, because pretending to know is the one thing this view is for
   not doing. */
function buildIndexSVG(index, weeks, currentWeek) {
  const W = 300, H = 46, padX = 2, padT = 5, padB = 5;
  const plotH = H - padT - padB;
  const vals = index.filter(v => v != null);
  const lo = Math.min(100, ...vals), hi = Math.max(100, ...vals);
  /* Never let a flat line fill the box: a ±1 % wobble drawn edge to edge
     reads as a transformation. */
  const span = Math.max(hi - lo, 8);
  const mid = (hi + lo) / 2;
  const top = mid + span / 2, bottom = mid - span / 2;
  const x = i => padX + (weeks < 2 ? (W - padX * 2) / 2 : (i / (weeks - 1)) * (W - padX * 2));
  const y = v => padT + plotH - ((v - bottom) / (top - bottom)) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img" aria-hidden="true">';
  svg += '<line x1="0" y1="' + y(100) + '" x2="' + W + '" y2="' + y(100) +
    '" stroke="var(--soft)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>';
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      svg += '<polyline points="' + run.join(' ') + '" fill="none" stroke="var(--signal)" ' +
        'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    run = [];
  };
  index.forEach((v, i) => {
    if (v == null) { flush(); return; }
    run.push(x(i) + ',' + y(v));
  });
  flush();
  index.forEach((v, i) => {
    if (v == null) return;
    const here = i + 1 === currentWeek;
    svg += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (here ? 3.5 : 2) +
      '" fill="' + (here ? 'var(--ink)' : 'var(--signal)') + '"/>';
  });
  svg += '</svg>';
  return svg;
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
        trend: trend, pct: pct, change: change, est: est, gap: sig.gap,
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

const fmtDays = d => {
  const n = Math.round(d * 10) / 10;
  return String(n).replace('.', ',') + (n === 1 ? ' día' : ' días');
};

/* The plan's own spacing, for the muscle rows: 7 days over the number of
   sessions a week asks for. Two sessions a week is every 3,5 days. */
const plannedGap = perWeek => (perWeek > 0 ? 7 / perWeek : null);

function drawDiagIndex(profile, block) {
  const weeks = blockWeeks(block), week = profile.week;
  const rows = strengthRows(profile, block);
  const host = $('diagHost');

  $('diagSub').textContent = block.name + ' — fuerza por músculo, con la primera semana registrada de cada uno como 100. ' +
    'Cada semana se compara con esa base solo sobre los ejercicios presentes en las dos, así que cambiar de máquina no rompe la línea.';

  host.innerHTML = '';
  const moved = rows.filter(r => r.change != null);
  if (!moved.length) {
    host.innerHTML = '<p class="chart-empty">Hacen falta al menos dos semanas con el mismo ejercicio registrado para poder comparar. ' +
      'Sigue anotando: esto se llena solo.</p>';
    return;
  }

  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'idx-row' + (r.change == null ? ' none' : r.change > 0.5 ? ' up' : r.change < -0.5 ? ' down' : ' flat');
    el.dataset.tag = r.tag;
    el.innerHTML =
      '<div class="idx-head"><span class="idx-name"></span><span class="idx-n"></span></div>' +
      '<div class="idx-meta"></div>' +
      '<div class="idx-chart"></div>';
    const name = el.querySelector('.idx-name');
    name.textContent = r.tag;
    if (r.priority) {
      const b = document.createElement('span');
      b.className = 'vol-pri';
      b.textContent = 'PRIORITARIO';
      name.appendChild(b);
    }
    el.querySelector('.idx-n').textContent = r.change == null
      ? 'sin comparación'
      : diagPct(r.change / 100) + ' desde la semana ' + (r.base + 1);
    /* How many exercises the endpoint actually rests on. When it is fewer
       than the muscle has, the missing ones are the swaps this view is
       deliberately not counting — say so rather than let the number look
       broader than it is. */
    const n = r.lastWeek >= 0 ? r.matched[r.lastWeek] : 0;
    el.querySelector('.idx-meta').textContent = r.change == null
      ? (r.exercises === 1 ? '1 ejercicio, una sola semana' : r.exercises + ' ejercicios, una sola semana')
      : 'sobre ' + (n === 1 ? '1 ejercicio' : n + ' ejercicios') +
        (n < r.exercises ? ' de ' + r.exercises + ' (el resto no está en las dos semanas)' : '') +
        ' · semana ' + (r.base + 1) + ' → ' + (r.lastWeek + 1);
    el.querySelector('.idx-chart').innerHTML = buildIndexSVG(r.index, weeks, week);
    host.appendChild(el);
  });
}

function drawDiagFreq(profile, block) {
  const week = profile.week;
  const rows = freqRows(profile, block, week);
  const host = $('diagHost');

  $('diagSub').textContent = block.name + ' — cada cuánto entrenas de verdad cada músculo, ' +
    'de las fechas que ya lleva cada serie marcada. Hasta la semana ' + week + ' incluida, que aún está en curso.';

  host.innerHTML = '';
  const trained = trainedDays(profile, block);
  const heat = buildHeatmapSVG(trained);
  if (heat) {
    const cal = document.createElement('div');
    cal.className = 'freq-cal';
    cal.innerHTML = '<div class="freq-cal-t"></div><div class="freq-cal-g">' + heat + '</div>';
    const dayCount = Object.keys(trained).length;
    cal.querySelector('.freq-cal-t').textContent = dayCount === 1
      ? '1 día entrenado en este bloque'
      : dayCount + ' días entrenados en este bloque';
    host.appendChild(cal);
  }

  if (!rows.some(r => r.done > 0)) {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = 'Aún no hay ninguna serie marcada como hecha con fecha en este bloque. ' +
      'Las fechas se guardan solas al marcar una serie.';
    host.appendChild(p);
    return;
  }

  rows.forEach(r => {
    const target = plannedGap(r.perWeek);
    /* "Behind" means the real spacing is meaningfully wider than the one
       the plan asks for — half a day of slack, so a session moved from
       Monday to Tuesday doesn't read as a lapse. */
    const behind = r.gap != null && target != null && r.gap > target + 0.5;
    const el = document.createElement('div');
    el.className = 'freq-row' + (behind ? ' behind' : '');
    el.dataset.tag = r.tag;
    el.innerHTML =
      '<div class="freq-head"><span class="freq-name"></span><span class="freq-gap"></span></div>' +
      '<div class="freq-meta"></div>';
    const name = el.querySelector('.freq-name');
    name.textContent = r.tag;
    if (r.priority) {
      const b = document.createElement('span');
      b.className = 'vol-pri';
      b.textContent = 'PRIORITARIO';
      name.appendChild(b);
    }
    el.querySelector('.freq-gap').textContent = r.gap == null
      ? (r.done === 1 ? 'una sola sesión' : 'sin sesiones')
      : 'cada ' + fmtDays(r.gap);
    el.querySelector('.freq-meta').textContent =
      r.done + ' de ' + r.planned + ' sesiones' +
      (r.adherence == null ? '' : ' (' + Math.round(r.adherence * 100) + ' %)') +
      (target == null ? '' : ' · previsto cada ' + fmtDays(target)) +
      /* The amber is the fast read; this is the same thing in words, for
         anyone the colour doesn't reach. */
      (behind ? ' · más espaciado de lo previsto' : '');
    host.appendChild(el);
  });
}

function drawDiag() {
  const profile = getProfile(), block = getBlock();

  $('diagView').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.view === diagView ? 'true' : 'false');
    b.onclick = () => { diagView = b.dataset.view; drawDiag(); };
  });
  $('diagScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === diagScope ? 'true' : 'false');
    b.onclick = () => { diagScope = b.dataset.scope; drawDiag(); };
  });
  /* Adherence is measured against a plan and the index against a baseline
     week, and only the current block has either — so the across-blocks
     toggle has nothing to switch on those two. */
  $('diagScope').style.display = diagView === 'trend' ? '' : 'none';
  if (diagView === 'freq') { drawDiagFreq(profile, block); return; }
  if (diagView === 'index') { drawDiagIndex(profile, block); return; }

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
      : diagPct(r.change) + ' en ' + r.sessions + ' sesiones · ' + diagPct(r.pct) + ' por sesión' +
        (r.gap == null ? '' : ' · cada ' + fmtDays(r.gap));
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
