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

   `done` is a session's `sets` (js/app.js, "sessions: the one reading of
   the log") rather than raw rows since plans/038 PR 5: a set's `w` is
   already what rowWeight(row) used to compute — readSession builds it with
   rowWeight itself — so the comparisons below are unchanged, and a set's
   `r` is a plain number that hasReps/est1RM read exactly as they always
   read a row's `.r`. Nothing here converts units again; that is still done
   once, inside readSession, for the same reason the old comment gave: a
   block trained partly in kg and partly in lb — a mid-block unit switch, or
   a profile restored from a partner who lifts in the other unit — would
   otherwise draw a 2.2× step that never happened, under an axis that
   already says units(). The session card is exempt on purpose; see the
   comment by rowWeight in app.js. */
function bestSet(done, metric) {
  if (metric === 'e1rm') {
    const withReps = done.filter(hasReps);
    if (!withReps.length) return null;
    let best = withReps[0];
    withReps.forEach(s => { if (est1RM(s.w, s.r) > est1RM(best.w, best.r)) best = s; });
    return best;
  }
  let best = done[0];
  done.forEach(s => { if (s.w > best.w) best = s; });
  return best;
}

/* The filter every raw-row reader used to write by hand — done && w !== ''
   && w != null && !isNaN(rowWeight(r)) — translated onto a session set: a
   session already carries only ticked sets, `wLogged` is the same raw
   string the row's own `w` was (readSession stringifies it, '' for a
   missing one), and `w` is that same rowWeight() reading, so this keeps
   exactly the sets the old filter kept. */
const chartableSets = sets => sets.filter(s => s.wLogged !== '' && !isNaN(s.w));

/* One block, one day, one exercise id — sessionsOf's narrowest query. Every
   production caller (drawChart) passes `weeks` as blockWeeks(block), but
   this function's own callers in test/ pass an arbitrary bound instead, so
   'plan' (which stops at the block's *current* length) is not always the
   same question: a week logged past that length is still inside `weeks`
   when a caller asks for more of them. Reading 'logged' (stranded weeks
   included) and then applying the same upper bound the old `for (w = 1; w
   <= (weeks || MAX_WEEKS); w++)` loop enforced reproduces every caller
   exactly, whichever bound it passed — MAX_WEEKS (js/app.js) is the same
   ceiling the old loop fell back to when no bound was given at all. */
function collectHistory(profile, blockId, dayId, exId, weeks, metric) {
  const cap = weeks || MAX_WEEKS;
  const sessions = sessionsOf(profile, { weeks: 'logged', lift: { id: exId }, day: dayId, blocks: [blockId] });
  const points = [];
  sessions.forEach(sess => {
    if (sess.week > cap) return;
    const done = chartableSets(sess.sets);
    if (!done.length) return;
    const best = bestSet(done, metric);
    if (!best) return;
    points.push({ week: sess.week, weight: best.w, reps: best.rLogged });
  });
  return points;
}

/* The same lift wherever the block plans it, in the order it was trained:
   week by week, and inside a week in day order. The same points
   collectHistory returns plus the day each came from — which the chart
   needs for its labels now that one week can hold more than one.

   `lift: { like: ex }` asks sessionsOf to match the way liftSlots always
   has — id, then name, within this block (js/app.js) — the exact function
   this file called directly before plans/038 PR 5, so the set of (week,
   day) sessions and their order (week, then the day's position in the
   block — sessionsOf sorts on the same block.days index liftSlots walks)
   is unchanged. The week bound is the same MAX_WEEKS-fallback reasoning as
   collectHistory above. */
function collectHistoryDays(profile, block, ex, weeks, metric) {
  const cap = weeks || MAX_WEEKS;
  const sessions = sessionsOf(profile, { weeks: 'logged', lift: { like: ex }, blocks: [block.id] });
  const points = [];
  sessions.forEach(sess => {
    if (sess.week > cap) return;
    const done = chartableSets(sess.sets);
    if (!done.length) return;
    const best = bestSet(done, metric);
    if (!best) return;
    points.push({ week: sess.week, dayId: sess.day, weight: best.w, reps: best.rLogged });
  });
  return points;
}

/* The same exercise across every block the profile has ever run, oldest
   first. Blocks key their logs separately, so this walks each block's slots
   looking for the exercise id rather than a day — the same exercise can sit
   on a different day in a later block and it is still the same lift. */
function collectHistoryAll(profile, exId, metric) {
  const out = [];
  /* Every week actually logged, not just the ones inside a block's current
     length: bestForExercise (the RECORD badge) already counts a shortened
     block's stranded weeks, and this chart disagreeing with it hid the very
     sets that would explain a badge with no history to show for it — see
     plans/008 item 20. sessionsOf's own `weeks: 'logged'` is that same
     question.

     The order is sessionsOf's own now (plans/038 PR 5) — block order, then
     week, then the day's position in the block's plan — the same order the
     objetivo and the Diagnóstico already read sessions in (plan decision
     10), rather than the log object's own key order this file used to
     re-derive by hand. The one case that can print differently from before
     is a lift split across two days of one week whose slots were logged
     out of the plan's day order: it now lists in plan order. */
  profile.blockOrder.forEach(bId => {
    const block = profile.blocks[bId];
    if (!block) return;
    sessionsOf(profile, { weeks: 'logged', lift: { id: exId }, blocks: [bId] }).forEach(sess => {
      const done = chartableSets(sess.sets);
      if (!done.length) return;
      const best = bestSet(done, metric);
      if (!best) return;
      out.push({ label: block.name + ' · S' + sess.week, weight: best.w, reps: best.rLogged });
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
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="var(--soft)" font-family="JetBrains Mono, monospace">' + esc(label) + '</text>';
    }
  });

  svg += '<text x="4" y="' + (y(max - pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="JetBrains Mono, monospace">' + Math.round(max - pad) + '</text>';
  svg += '<text x="4" y="' + (y(min + pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="JetBrains Mono, monospace">' + Math.round(min + pad) + '</text>';

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
