/* ---------- Diagnóstico ----------
   Twenty-two exercises, each with its own chart behind its own button.
   Nobody opens twenty-two charts, and the diagnosis was never in any one of
   them anyway — it is in the comparison, and nothing was making it.

   This screen fits a line through the estimated 1RM of every exercise in
   the current plan at once and sorts them worst first, then crosses each
   trend with the signals the log already carries — the RIR written on
   each set, the rep-decay flag, forced drops, the timestamps on every
   ticked row, the kilos each session moved, and the target weight from
   targetFor().
   A stall on its own says nothing. A stall next to "RIR 2+ every week" and
   a stall next to "0 RIR and a forced drop" point at opposite fixes, which
   is exactly why guessing at it goes wrong.

   The estimated 1RM comes off the BEST set of a session and nothing else,
   which is the right number for "am I getting stronger" and blind to half
   of what a session is — so a second line is fitted through kilos per set,
   and the two are read together. 45×12/8/6 and 45×12/12/11 are the same
   point on the first line and 135 kilos apart on the second.

   Nothing here asks for a single new input. Everything it reads is already
   being typed, or already derived from what is.

   What it shows is worked out in js/app.js ("the Diagnóstico's rows"
   there): the thresholds, the points, the verdict matrix and the rows of
   all three views. The block review builds on them, and a symbol another
   split file reads stays in app.js (AGENTS.md rule 2). This file draws —
   the sheet and its two toggles, the calendar and the index chart.

   Loaded before app.js, so — like block-editor.js — every line of DOM
   wiring waits inside wireDiagnostics() until app.js has called it. */

let diagScope = 'block';  /* 'block' | 'all' */
let diagView = 'trend';   /* 'trend' per exercise | 'freq' | 'index' per muscle */

/* The unit-converting volume rule is convertedSetVolume in js/app.js — an
   identical copy lived here until plans/011 made the two one. */

/* Local calendar day, not UTC: a set ticked at 23:30 belongs to the day you
   trained, and toISOString() would file half your evening sessions under
   tomorrow. */
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Every day of the block with something ticked on it, and how much — the
   input for the calendar strip below. sessionsOf's own weeks:'plan' now,
   not a raw walk of the whole log (plans/057): a week logged after the
   block was shortened below it (a stranded week, CONTEXT.md) used to shade
   a day into the calendar all the same. Every lift, retired exercises
   included — they were still trained — same as blockTonnageByWeek right
   beside it in this sheet. */
function trainedDays(profile, block) {
  const days = {};
  sessionsOf(profile, { weeks: 'plan', blocks: [block.id] }).forEach(sess => {
    sess.sets.forEach(s => {
      if (!(s.ts > 0)) return;
      const key = dayKey(s.ts);
      days[key] = (days[key] || 0) + 1;
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
  if (!keys.length) return { svg: '', maxW: 0 };
  const parse = k => { const p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const last = parse(keys[keys.length - 1]);
  let first = parse(keys[0]);
  /* Start the grid on the Monday of the first trained week. */
  const back = (first.getDay() + 6) % 7;
  first = new Date(first.getFullYear(), first.getMonth(), first.getDate() - back);
  /* Date.UTC rather than (last - first) in local time: a plain millisecond
     difference measures 23h/25h across a DST change, so a week can be
     dropped or gained at the boundary. Calendar days are DST-safe. */
  const dayCount = Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
    Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000);
  let weeks = Math.floor(dayCount / 7) + 1;
  if (weeks > HEAT_MAX_WEEKS) {
    first = new Date(first.getFullYear(), first.getMonth(), first.getDate() + (weeks - HEAT_MAX_WEEKS) * 7);
    weeks = HEAT_MAX_WEEKS;
  }
  const max = Math.max(1, ...keys.map(k => days[k]));

  const cell = 11, gap = 2, padL = 16, padT = 2;
  const W = padL + weeks * (cell + gap), H = padT + 7 * (cell + gap);
  const labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  /* The per-week max-width depends on `weeks`, computed above from the data
     — a `style=""` attribute can't survive dropping the CSP's
     'unsafe-inline' for styles, so it comes back to the caller (drawDiagFreq)
     as `maxW` alongside the markup, for it to apply as a real CSSOM property,
     which the CSP does not restrict either way (plans/008 item 22). Returned
     rather than round-tripped through a data attribute, so a second caller
     can't silently drop the sizing with no error anywhere. */
  const maxW = W * 1.6;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="u-svg-fluid" role="img" aria-label="Días entrenados">';
  labels.forEach((l, r) => {
    if (r % 2) return;  /* every other row, or they collide at this size */
    svg += '<text x="0" y="' + (padT + r * (cell + gap) + cell - 1) + '" font-size="7.5" fill="var(--soft)" ' +
      'font-family="JetBrains Mono, monospace">' + l + '</text>';
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
  return { svg, maxW };
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

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="u-svg-fluid" role="img" aria-hidden="true">';
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
  if (heat.svg) {
    const cal = document.createElement('div');
    cal.className = 'freq-cal';
    cal.innerHTML = '<div class="freq-cal-t"></div><div class="freq-cal-g">' + heat.svg + '</div>';
    const heatSvg = cal.querySelector('svg');
    if (heatSvg) heatSvg.style.maxWidth = heat.maxW + 'px';
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

  /* #diagView is newer than this file, so a precache hole can serve this
     copy against a sheet that has no view switch (AGENTS.md's
     precache-hole rule). The sheet below still draws. */
  const view = $('diagView');
  if (view) view.querySelectorAll('.seg-btn').forEach(b => {
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

  const rows = diagRows(profile, block, diagScope);
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
       so the row carries the id it was computed from — and the day, since
       one lift planned on two days is two rows. */
    el.dataset.ex = r.id;
    el.dataset.day = r.dayId;
    el.innerHTML =
      '<div class="diag-head">' +
        '<span class="diag-name"></span>' +
        '<span class="diag-chip"></span>' +
      '</div>' +
      '<div class="diag-num"></div>' +
      '<div class="diag-read"></div>' +
      '<div class="diag-do"></div>';
    /* The row's label names the day of a lift planned on two (plans/056).
       A precache hole can pair this file with an app.js whose rows have no
       label yet, and a row with no name is worse than one without its day. */
    el.querySelector('.diag-name').textContent = r.label || r.name;
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
  registerSheet('diagSheet', { closeBtn: 'diagClose' });
}
