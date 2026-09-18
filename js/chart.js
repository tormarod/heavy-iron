/* ---------- progress chart ----------
   One exercise over time, as an SVG line plus the table underneath it:
   this block's sessions, or every block the profile has ever run, read
   either as the weight on the bar or as an estimated 1RM.

   Split out of js/app.js as the third of the five seams that file's own
   section comments mark (plans/008 item 13). What stayed behind is the
   arithmetic that is not the chart's alone: est1RM and hasReps are read by
   targetEstimate here and by js/diagnostics.js, which draws its own trend
   from them. bestSet came along, because nothing but the chart has ever
   asked which set of a session "wins".

   The one thing app.js asks of this file is openChart, from the "Progreso ↗"
   button on every card — stubbed to a no-op there, so a shell that predates
   this file loses the button rather than throwing inside a card.

   Loaded before app.js, so — like the other split files — its DOM wiring
   waits inside wireChart() until app.js calls it. */

/* Which logged set of a group "wins" depends on what's being charted: the
   heaviest weight for the weight series, but the highest estimated 1RM for
   the 1RM series — a heavier single at fewer reps can out-rank a lighter
   set done for many reps, which is the point of showing this at all.

   Every weight is read through rowWeight(), not num(r.w): this chart fits
   one line through many sessions, so a block trained partly in kg and
   partly in lb — a mid-block unit switch, or a profile restored from a
   partner who lifts in the other unit — would otherwise draw a 2.2× step
   that never happened, under an axis that already says units(). The session
   card is exempt on purpose; see the comment by rowWeight in app.js. */
function bestSet(done, metric) {
  if (metric === 'e1rm') {
    const withReps = done.filter(hasReps);
    if (!withReps.length) return null;
    let best = withReps[0];
    withReps.forEach(r => { if (est1RM(rowWeight(r), num(r.r)) > est1RM(rowWeight(best), num(best.r))) best = r; });
    return best;
  }
  let best = done[0];
  done.forEach(r => { if (rowWeight(r) > rowWeight(best)) best = r; });
  return best;
}

function collectHistory(profile, blockId, dayId, exId, weeks, metric) {
  const points = [];
  for (let w = 1; w <= (weeks || MAX_WEEKS); w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    const rows = s && s[exId];
    if (!rows) continue;
    const done = rows.filter(r => r && r.done && r.w !== '' && r.w != null && !isNaN(rowWeight(r)));
    if (!done.length) continue;
    const best = bestSet(done, metric);
    if (!best) continue;
    points.push({ week: w, weight: rowWeight(best), reps: best.r });
  }
  return points;
}

/* The same lift wherever the block plans it, in the order it was trained:
   week by week, and inside a week in day order. The same points
   collectHistory returns plus the day each came from — which the chart
   needs for its labels now that one week can hold more than one. */
function collectHistoryDays(profile, block, ex, weeks, metric) {
  const points = [];
  const blk = profile.log[block.id];
  if (!blk) return points;
  const slots = liftSlots(block, ex);
  for (let w = 1; w <= (weeks || MAX_WEEKS); w++) {
    slots.forEach(s => {
      const bucket = blk[slot(w, s.dayId)];
      const rows = bucket && bucket[s.exId];
      if (!Array.isArray(rows)) return;
      const done = rows.filter(r => r && r.done && r.w !== '' && r.w != null && !isNaN(rowWeight(r)));
      if (!done.length) return;
      const best = bestSet(done, metric);
      if (!best) return;
      points.push({ week: w, dayId: s.dayId, weight: rowWeight(best), reps: best.r });
    });
  }
  return points;
}

/* The same exercise across every block the profile has ever run, oldest
   first. Blocks key their logs separately, so this walks each block's slots
   looking for the exercise id rather than a day — the same exercise can sit
   on a different day in a later block and it is still the same lift. */
function collectHistoryAll(profile, exId, metric) {
  const out = [];
  profile.blockOrder.forEach(bId => {
    const block = profile.blocks[bId];
    const blk = profile.log[bId];
    if (!block || !blk) return;
    /* Every week actually logged, not just the ones inside the block's
       current length: bestByExercise (the RECORD badge) already counts a
       shortened block's stranded weeks, and this chart disagreeing with it
       hid the very sets that would explain a badge with no history to show
       for it — see plans/008 item 20. One pass groups the keys by week so
       the full key set isn't walked again per distinct week just to get the
       output ordered. */
    const byWeek = new Map();
    Object.keys(blk).forEach(k => {
      const s = parseSlot(k);
      if (!s) return;
      if (!byWeek.has(s.week)) byWeek.set(s.week, []);
      byWeek.get(s.week).push(k);
    });
    Array.from(byWeek.keys()).sort((a, b) => a - b).forEach(w => {
      byWeek.get(w).forEach(k => {
        const rows = blk[k][exId];
        if (!Array.isArray(rows)) return;
        const done = rows.filter(r => r && r.done && r.w !== '' && r.w != null && !isNaN(rowWeight(r)));
        if (!done.length) return;
        const best = bestSet(done, metric);
        if (!best) return;
        out.push({ label: block.name + ' · S' + w, weight: rowWeight(best), reps: best.r });
      });
    });
  });
  return out;
}

/* `series` is [{ i, weight, reps }] with i a 1-based position, and `ticks`
   is the label for each position — weeks when looking at one block, one per
   logged session when looking across all of them. */
function buildChartSVG(series, ticks) {
  const W = 600, H = 220, padL = 40, padR = 16, padT = 16, padB = 28;
  const n = Math.max(1, ticks.length);
  const weights = series.map(p => p.weight);
  let min = Math.min(...weights), max = Math.max(...weights);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = i => padL + (n > 1 ? (i - 1) / (n - 1) : 0.5) * (W - padL - padR);
  const y = v => H - padB - ((v - min) / (max - min)) * (H - padT - padB);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="u-svg-fluid" role="img">';

  /* Sixteen weeks — or a season's worth of sessions across every block —
     would turn the axis into a picket fence, so labels thin out as the
     series grows. The gridlines stay: they are what shows the gaps. */
  const every = Math.ceil(n / 8);
  ticks.forEach((label, idx) => {
    const i = idx + 1;
    svg += '<line x1="' + x(i) + '" y1="' + padT + '" x2="' + x(i) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>';
    if (idx % every === 0 || i === n) {
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + esc(label) + '</text>';
    }
  });

  svg += '<text x="4" y="' + (y(max - pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(max - pad) + '</text>';
  svg += '<text x="4" y="' + (y(min + pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(min + pad) + '</text>';

  if (series.length) {
    /* Points the caller marks `muted` (an estimate built from too many reps
       to trust) are dropped from the line entirely rather than plotted as
       if they were as reliable as the rest — they still get a marker, just
       a hollow one, so the data isn't hidden either. */
    const reliable = series.filter(p => !p.muted);
    if (reliable.length) {
      const path = reliable.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.i) + ' ' + y(p.weight)).join(' ');
      svg += '<path d="' + path + '" fill="none" stroke="var(--signal)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    series.forEach(p => {
      svg += p.muted
        ? '<circle cx="' + x(p.i) + '" cy="' + y(p.weight) + '" r="4" fill="var(--card)" stroke="var(--soft)" stroke-width="1.5" stroke-dasharray="2,2"/>'
        : '<circle cx="' + x(p.i) + '" cy="' + y(p.weight) + '" r="4" fill="var(--signal)"/>';
    });
  }
  svg += '</svg>';
  return svg;
}

let chartFor = null;          /* { ex, dayId } — kept so the toggle can redraw */
let chartScope = 'block';     /* 'block' | 'all' */
let chartMetric = 'weight';   /* 'weight' | 'e1rm' */

/* A logged set feeds the 1RM series only if it has usable reps; beyond 12
   reps Epley's estimate is unreliable rather than merely imprecise, so
   those points are flagged instead of plotted at full confidence. */
const e1rmValue = p => (p.reps !== '' && p.reps != null && !isNaN(num(p.reps)) && num(p.reps) > 0)
  ? Math.round(est1RM(p.weight, num(p.reps)) * 10) / 10 : null;
const isHighRep = p => p.reps !== '' && p.reps != null && !isNaN(num(p.reps)) && num(p.reps) > 12;

function openChart(ex, dayId) {
  chartFor = { ex, dayId };
  drawChart();
  openSheet('chartSheet');
}

function drawChart() {
  if (!chartFor) return;
  const { ex, dayId } = chartFor;
  const profile = getProfile(), block = getBlock();
  const host = $('chartHost');

  $('chartTitle').textContent = ex.n;
  $('chartScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === chartScope ? 'true' : 'false');
    b.onclick = () => { chartScope = b.dataset.scope; drawChart(); };
  });
  $('chartMetric').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.metric === chartMetric ? 'true' : 'false');
    b.onclick = () => { chartMetric = b.dataset.metric; drawChart(); };
  });

  const isE1rm = chartMetric === 'e1rm';
  const valueCol = isE1rm ? '1RM est.' : 'Peso';
  /* The 1RM series plots est1RM(weight, reps) per point; unreliable
     (>12-rep) points are kept in the table but dropped from the chart's
     line and marked so they don't read as trustworthy. */
  const toSeriesPoint = p => {
    if (!isE1rm) return { weight: p.weight, muted: false, display: p.weight, reliable: true };
    const v = e1rmValue(p);
    return { weight: v == null ? p.weight : v, muted: v == null || isHighRep(p), display: v, reliable: v != null && !isHighRep(p) };
  };
  const rowCell = (p, sp) => sp.display == null ? '—' : (sp.reliable ? '' : '≈ ') + sp.display + ' ' + esc(units());

  if (chartScope === 'all') {
    const points = collectHistoryAll(profile, ex.id, chartMetric);
    $('chartSub').textContent = 'Todos los bloques de ' + profile.label +
      ' — ' + (isE1rm ? '1RM estimado (Epley) de cada sesión registrada, en ' + units() + '.' :
        'mejor peso de cada sesión registrada, en ' + units() + ' (× repeticiones de esa serie).');
    if (!points.length) {
      host.innerHTML = '<p class="chart-empty">Aún no hay series completadas con peso para este ejercicio en ningún bloque.</p>';
      return;
    }
    const series = points.map((p, i) => Object.assign({ i: i + 1, reps: p.reps }, toSeriesPoint(p)));
    let html = buildChartSVG(series, points.map(p => p.label));
    html += '<table class="chart-table"><thead><tr><th>Sesión</th><th>' + valueCol + '</th><th>Reps</th></tr></thead><tbody>';
    points.forEach((p, i) => {
      const sp = series[i];
      html += '<tr' + (sp.reliable ? '' : ' class="unreliable"') + '><td>' + esc(p.label) + '</td><td>' + rowCell(p, sp) + '</td><td>' + esc(p.reps || '—') + '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
    return;
  }

  const weeks = blockWeeks(block);
  /* One point per week is the right axis for a lift that lives on one day.
     Plan the same lift on two days and a week holds two sessions, which a
     week axis has nowhere to put — so it becomes one point per session,
     the shape the "todos los bloques" view has always used. Both sessions
     on one line is the whole point: this is where you see that Thursday
     has been trailing Monday for a month. */
  const multi = liftSlots(block, ex).length > 1;
  const points = multi
    ? collectHistoryDays(profile, block, ex, weeks, chartMetric)
    : collectHistory(profile, block.id, dayId, ex.id, weeks, chartMetric);
  const per = multi ? 'de cada sesión registrada' : 'por semana';
  $('chartSub').textContent = block.name + ' — ' + (isE1rm ? '1RM estimado (Epley) ' + per + ', en ' + units() + '.' :
    'mejor peso registrado ' + per + ', en ' + units() + ' (× repeticiones de esa serie).');
  if (!points.length) {
    host.innerHTML = '<p class="chart-empty">Aún no hay series completadas con peso para este ejercicio en este bloque.</p>';
    return;
  }
  const label = p => multi ? 'S' + p.week + ' · ' + dayTag(block, p.dayId) : 'Semana ' + p.week;
  const ticks = [];
  if (multi) points.forEach(p => ticks.push(label(p)));
  else for (let w = 1; w <= weeks; w++) ticks.push('S' + w);
  const series = points.map((p, i) => Object.assign({ i: multi ? i + 1 : p.week, reps: p.reps }, toSeriesPoint(p)));
  let html = buildChartSVG(series, ticks);
  html += '<table class="chart-table"><thead><tr><th>' + (multi ? 'Sesión' : 'Semana') + '</th><th>' + valueCol + '</th><th>Reps</th></tr></thead><tbody>';
  points.forEach((p, i) => {
    const sp = series[i];
    html += '<tr' + (sp.reliable ? '' : ' class="unreliable"') + '><td>' + esc(label(p)) + '</td><td>' + rowCell(p, sp) + '</td><td>' + esc(p.reps || '—') + '</td></tr>';
  });
  html += '</tbody></table>';
  host.innerHTML = html;
}


/* Every line here needs $(), which js/app.js defines — and js/app.js is the
   last script on the page. See the call site at the foot of that file. */
function wireChart() {
  registerSheet('chartSheet', { closeBtn: 'chartClose' });
}
