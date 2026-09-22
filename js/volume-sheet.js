/* ---------- volume dashboard, the sheet ----------
   Draws what js/app.js's volume arithmetic counts: this week's hard sets per
   tag as bars, or the whole block as small-multiple trends with the 10–20
   band shaded behind them, over either the plan or the log.

   Split out of js/app.js as the fourth of the five seams that file's own
   section comments mark (plans/008 item 13), and split at the seam inside
   the seam: only the drawing came. blockTagsFor, volumeTotals,
   blockTonnageByWeek and volumeTrendRows stayed behind, because
   js/block-editor.js, the Diagnóstico and js/review.js all read them —
   they are the app's shared volume vocabulary, not this screen's private
   workings, and a screen going missing must not take the block review's
   numbers with it.

   Nothing calls into this file: the only way in is the "Volumen" button,
   which it wires itself. Like the calculator, it needs no stub in app.js.

   Loaded before app.js, so — like the other split files — its DOM wiring
   waits inside wireVolumeSheet() until app.js calls it. */

/* Small multiples rather than one chart with ten lines on it. On a 375px
   phone a dozen superimposed muscles is spaghetti nobody reads, and the
   band — the whole point of drawing this — can only be shaded legibly
   behind one series at a time. Each row is the same line chart as the
   progress sheet, shrunk, with the band behind it and the current week
   marked. */
function buildTrendSVG(series, weeks, currentWeek, banded, dl) {
  const W = 300, H = 46, padX = 2, padT = 4, padB = 4;
  const plotH = H - padT - padB;
  const max = Math.max(VOL_BAND_HIGH * (banded ? 1 : 0), 1, ...series);
  const x = i => padX + (weeks < 2 ? (W - padX * 2) / 2 : (i / (weeks - 1)) * (W - padX * 2));
  const y = v => padT + plotH - (v / max) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="u-svg-fluid" role="img" aria-hidden="true">';
  if (banded) {
    const top = y(Math.min(VOL_BAND_HIGH, max)), bottom = y(VOL_BAND_LOW);
    svg += '<rect x="0" y="' + top + '" width="' + W + '" height="' + Math.max(0, bottom - top) +
      '" fill="var(--signal)" opacity="0.10"/>';
    svg += '<line x1="0" y1="' + y(VOL_MAINTENANCE) + '" x2="' + W + '" y2="' + y(VOL_MAINTENANCE) +
      '" stroke="var(--soft)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>';
  }
  if (dl >= 1 && dl <= weeks) {
    svg += '<line x1="' + x(dl - 1) + '" y1="' + padT + '" x2="' + x(dl - 1) + '" y2="' + (padT + plotH) +
      '" stroke="var(--line)" stroke-width="1"/>';
  }
  const pts = series.map((v, i) => x(i) + ',' + y(v)).join(' ');
  svg += '<polyline points="' + pts + '" fill="none" stroke="var(--signal)" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>';
  series.forEach((v, i) => {
    const here = i + 1 === currentWeek;
    svg += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (here ? 3.5 : 2) +
      '" fill="' + (here ? 'var(--ink)' : 'var(--signal)') + '"/>';
  });
  svg += '</svg>';
  return svg;
}

/* Horizontal sibling of buildChartSVG: one bar per row, same monospace
   labels and accent colour so it reads as the same chart family. */
function buildBarSVG(rows) {
  const W = 600, rowH = 26, padT = 6, padB = 6, labelW = 122, valueW = 34;
  const barMaxW = W - labelW - valueW;
  const H = rows.length * rowH + padT + padB;
  const max = Math.max(1, ...rows.map(r => r.value));
  const barH = 14;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="u-svg-fluid" role="img">';
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    const barY = y + (rowH - barH) / 2;
    const w = r.value > 0 ? Math.max(2, (r.value / max) * barMaxW) : 0;
    svg += '<text x="0" y="' + (y + rowH / 2 + 4) + '" font-size="11" fill="var(--ink)" font-family="JetBrains Mono, monospace">' + esc(r.label) + '</text>';
    svg += '<rect x="' + labelW + '" y="' + barY + '" width="' + barMaxW + '" height="' + barH + '" fill="var(--sunk)" rx="2"/>';
    if (w > 0) svg += '<rect x="' + labelW + '" y="' + barY + '" width="' + w + '" height="' + barH + '" fill="var(--signal)" rx="2"/>';
    svg += '<text x="' + (labelW + barMaxW + 6) + '" y="' + (y + rowH / 2 + 4) + '" font-size="11" fill="var(--soft)" font-family="JetBrains Mono, monospace">' + r.value + '</text>';
  });
  svg += '</svg>';
  return svg;
}

/* The kilos strip above the bars. It answers a different question from
   the chart below it — "how much have I actually shifted in this block",
   not "where did this week's sets go" — so it sits in its own boxed row and
   ignores both toggles: tonnage only ever comes from what was ticked done,
   there is no plan-side number to compare it against. */
function drawVolumeTonnage(profile, block, week) {
  /* Every week of the block added together, so this is a cross-session
     reader like the review and diagnostics — not like the card, which shows
     one session's numbers as typed. Hence convertedSetVolume: without it a
     block trained partly in lb would be summed in two units and printed
     through fmtKg as if it were all one. */
  const byWeek = blockTonnageByWeek(profile, block, convertedSetVolume);
  const total = byWeek.reduce((t, v) => t + v, 0);
  const thisWeek = byWeek[week - 1] || 0;
  const logged = byWeek.filter(v => v > 0).length;
  const host = $('volumeTonnage');
  if (!total) {
    host.innerHTML = '<p class="vol-kg-empty">Aún no has movido ningún kilo en este bloque.</p>';
    return;
  }
  /* Early in a block the two figures are the same number twice, which reads
     as a bug rather than as a total. One tile until they diverge. */
  if (total === thisWeek) {
    host.innerHTML = '<div><b>' + esc(fmtKg(total)) + '</b><span>movidos en el bloque, todo en la semana ' + week + '</span></div>';
    return;
  }
  host.innerHTML =
    '<div><b>' + esc(fmtKg(total)) + '</b><span>movidos en el bloque · ' +
      (logged === 1 ? '1 semana registrada' : logged + ' semanas registradas') + '</span></div>' +
    '<div><b>' + esc(fmtKg(thisWeek)) + '</b><span>' +
      (thisWeek ? 'esta semana (semana ' + week + ')' : 'aún nada esta semana (semana ' + week + ')') + '</span></div>';
}

let volumeScope = 'plan';  /* 'plan' | 'log' */
let volumeDim = 'muscle';  /* key into VOLUME_DIMENSIONS */
let volumeSpan = 'week';   /* 'week' = this week's bars | 'block' = the trend */

function openVolume() {
  drawVolume();
  openSheet('volumeSheet');
}

function drawVolume() {
  const profile = getProfile(), block = getBlock();
  const week = profile.week;
  $('volumeScope').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.scope === volumeScope ? 'true' : 'false');
    b.onclick = () => { volumeScope = b.dataset.scope; drawVolume(); };
  });
  $('volumeDim').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.dim === volumeDim ? 'true' : 'false');
    b.onclick = () => { volumeDim = b.dataset.dim; drawVolume(); };
  });
  $('volumeSpan').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.span === volumeSpan ? 'true' : 'false');
    b.onclick = () => { volumeSpan = b.dataset.span; drawVolume(); };
  });

  drawVolumeTonnage(profile, block, week);

  const dimLabel = VOLUME_DIMENSIONS[volumeDim].label.toLowerCase();
  const isLog = volumeScope === 'log';
  if (volumeSpan === 'block') { drawVolumeTrend(profile, block, week, isLog, dimLabel); return; }

  const totals = volumeTotals(isLog ? 'log' : 'plan', profile, block, week, volumeDim);
  $('volumeSub').textContent = block.name + ' — semana ' + week + ' — ' +
    (isLog ? 'series marcadas como hechas esta semana, por ' + dimLabel + '.'
           : 'series que pide el plan esta semana, por ' + dimLabel + ' (ya cuenta la descarga y las series añadidas).');

  const rows = volumeRows(totals);
  const host = $('volumeHost');
  if (!rows.some(r => r.value > 0)) {
    host.innerHTML = '<p class="chart-empty">' +
      (isLog ? 'Aún no hay ninguna serie marcada como hecha esta semana.' : 'Este bloque no tiene series programadas esta semana.') +
      '</p>';
    return;
  }
  let html = buildBarSVG(rows);
  html += '<table class="chart-table"><thead><tr><th>' + esc(VOLUME_DIMENSIONS[volumeDim].label) + '</th><th>Series</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + esc(r.label) + '</td><td>' + r.value + '</td></tr>'; });
  html += '</tbody></table>';
  host.innerHTML = html;
}

/* The block-long view. Same numbers as the bars above, read across the
   weeks instead of at one of them — plus, on the muscle dimension, the
   band that says whether they are enough. */
function drawVolumeTrend(profile, block, week, isLog, dimLabel) {
  const banded = volumeDim === 'muscle';
  const rows = volumeTrendRows(isLog ? 'log' : 'plan', profile, block, volumeDim);
  const weeks = blockWeeks(block), dl = deloadWeek(block);
  const host = $('volumeHost');

  $('volumeSub').textContent = block.name + ' — las ' + weeks + ' semanas del bloque, por ' + dimLabel + ' — ' +
    (isLog ? 'series marcadas como hechas cada semana.'
           : 'series que pide el plan cada semana (ya cuenta la descarga y las series añadidas).') +
    (banded ? ' La franja es 10–20 series por músculo y semana; la línea de puntos, 6 (mantenimiento).' : '');

  if (!rows.some(r => r.total > 0)) {
    host.innerHTML = '<p class="chart-empty">' +
      (isLog ? 'Aún no hay ninguna serie marcada como hecha en este bloque.' : 'Este bloque no tiene series programadas.') +
      '</p>';
    return;
  }

  /* The loud one, and the reason the flag exists: a muscle you said was
     the point of this block getting less than one you didn't. */
  const flagged = rows.filter(r => r.flagged);
  const over = rows.filter(r => !r.priority && r.zone === 'over');
  host.innerHTML = '';
  if (flagged.length) {
    const warn = document.createElement('p');
    warn.className = 'vol-warn';
    warn.textContent = (flagged.length === 1
      ? flagged[0].label + ' es prioritario y se queda por debajo de la franja'
      : flagged.map(r => r.label).join(', ') + ' son prioritarios y se quedan por debajo de la franja') +
      (over.length ? ', mientras ' + over.map(r => r.label).join(', ') + ' va por encima.' : '.') +
      ' Ahí tienes las series que te faltan.';
    host.appendChild(warn);
  }

  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'vol-trend' + (r.flagged ? ' flagged' : '') + (r.priority ? ' priority' : '');
    el.dataset.tag = r.label;
    el.innerHTML =
      '<div class="vol-trend-head"><span class="vol-trend-name"></span><span class="vol-trend-n"></span></div>' +
      '<div class="vol-trend-chart"></div>';
    const name = el.querySelector('.vol-trend-name');
    name.textContent = r.label;
    if (r.priority) {
      const b = document.createElement('span');
      b.className = 'vol-pri';
      b.textContent = 'PRIORITARIO';
      name.appendChild(b);
    }
    const typical = Math.round(r.typical * 10) / 10;
    el.querySelector('.vol-trend-n').textContent = r.typical == null
      ? 'sin semanas que contar'
      : String(typical).replace('.', ',') + (typical === 1 ? ' serie/semana' : ' series/semana') +
        (VOL_ZONE[r.zone] ? ' · ' + VOL_ZONE[r.zone] : '');
    el.querySelector('.vol-trend-chart').innerHTML = buildTrendSVG(r.series, weeks, week, banded, dl);
    host.appendChild(el);
  });
}


/* Every line here needs $(), which js/app.js defines — and js/app.js is the
   last script on the page. See the call site at the foot of that file. */
function wireVolumeSheet() {
  $('volumeBtn').onclick = openVolume;
  registerSheet('volumeSheet', { closeBtn: 'volumeClose' });
}
