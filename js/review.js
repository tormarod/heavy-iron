/* ---------- block review ----------
   "+ Nuevo bloque" used to just start the next one: no reckoning, no
   lesson carried forward. Eight weeks of evidence sat in the log and the
   block written on top of it was written from memory.

   This closes that loop, and the payoff was already built. The app can
   copy an AI prompt describing the block JSON format, and it can import
   the JSON that comes back. Bolt the review onto that prompt and the next
   block gets written against what actually happened — which muscle moved,
   which sessions you missed, where the volume really went — instead of
   against a guess.

   Every number here is one the app already computes for one of the other
   screens. The review invents nothing; it collects.

   Loaded before app.js, so — like block-editor.js and diagnostics.js —
   its DOM wiring waits inside wireReview() until app.js calls it. */

/* Long enough to explain a dip, short enough that the prompt does not turn
   into a diary. Newest first, since the end of the block is what the next
   one answers to. */
const REVIEW_MAX_NOTES = 8;

/* Worst first, like the Diagnóstico sheet, so a cap drops the exercises
   that are going well — the ones the next block has least to change. */
const REVIEW_MAX_EXERCISES = 40;

const reviewPct = v => (v > 0 ? '+' : v < 0 ? '−' : '') +
  String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + ' %';

/* "la semana 4" for a one-week deload span, "las semanas 4–5" for a longer
   one — how the review and the on-screen check both name a span
   (CONTEXT.md, "deload span"); d.deload/d.deloadEnd are its first and last
   week (deloadCheck, js/app.js). */
const deloadSpanLabel = d => d.deload === d.deloadEnd
  ? 'la semana ' + d.deload
  : 'las semanas ' + d.deload + '–' + d.deloadEnd;

/* reviewName lives in js/app.js — the prompt and the Diagnóstico use it too. */

/* The unit-converting volume rule is convertedSetVolume in js/app.js — an
   identical copy lived here until plans/011 made the two one. */

/* Everything worth saying about a block, gathered from the views that
   already say it: strength from the index, attendance from the
   timestamps, volume from the dashboard, and the deload check. */
function buildBlockReview(profile, block) {
  const weeks = blockWeeks(block);
  const upTo = Math.min(Math.max(profile.week, 1), weeks);
  const tonnage = blockTonnageByWeek(profile, block);
  const weeksLogged = tonnage.filter(v => v > 0).length;

  /* Bounded to the block's own weeks, exactly like tonnage just above —
     blockDoneSets (js/app.js) is a raw storage count and would add in a
     stranded week's sets (CONTEXT.md, "stranded week"), which are real but
     belong to a week this block no longer claims. Left in, the count and
     the tonnage beside it would silently disagree about which weeks the
     block even has (plans/050). Screens about the block hide a stranded
     week everywhere else; this is one more of them. */
  let doneSets = 0;
  forEachSlot(profile.log, block.id, (k, w, d, slotRows) => {
    if (w < 1 || w > weeks) return;
    const s = slotRows || {};
    Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) doneSets += s[exId].filter(r => r && r.done).length; });
  });

  const strength = strengthRows(profile, block);
  const freq = freqRows(profile, block, upTo);
  const planVol = volumeTrendRows('plan', profile, block, 'muscle');
  const logVol = volumeTrendRows('log', profile, block, 'muscle');
  const planBy = {}, logBy = {};
  planVol.forEach(r => { planBy[r.label] = r; });
  logVol.forEach(r => { logBy[r.label] = r; });

  /* One row per muscle, with every view's answer for it side by side —
     which is the whole point: "chest went nowhere" and "chest got 6 sets a
     week and you made half the sessions" are different conclusions. */
  const muscles = [];
  const seen = {};
  [strength, freq].forEach(list => list.forEach(r => {
    const tag = r.tag;
    if (seen[tag]) return;
    seen[tag] = 1;
    const st = strength.find(x => x.tag === tag);
    const fq = freq.find(x => x.tag === tag);
    muscles.push({
      tag: tag,
      priority: isPriority(block, tag),
      change: st ? st.change : null,
      exercises: st ? (st.lastWeek >= 0 ? st.matched[st.lastWeek] : 0) : 0,
      done: fq ? fq.done : 0,
      planned: fq ? fq.planned : 0,
      gap: fq ? fq.gap : null,
      planSets: planBy[tag] ? planBy[tag].typical : null,
      logSets: logBy[tag] ? logBy[tag].typical : null,
      zone: planBy[tag] ? planBy[tag].zone : '',
    });
  }));
  muscles.sort((a, b) =>
    (b.priority ? 1 : 0) - (a.priority ? 1 : 0) ||
    (a.change == null ? 1 : 0) - (b.change == null ? 1 : 0) ||
    (a.change || 0) - (b.change || 0) ||
    a.tag.localeCompare(b.tag, 'es'));

  /* Energy read back as context, never as a series: how much you moved on
     the days you said you arrived flat, against the rest. An optional
     input can support a comparison of two groups; it cannot support a
     line through the days you skipped tapping it. */
  const energy = { baja: [], normal: [], alta: [] };
  const blk = profile.log[block.id] || {};
  Object.keys(blk).forEach(k => {
    const s = parseSlot(k);
    if (!s) return;
    const tag = getEnergy(profile, block.id, s.week, s.dayId);
    if (!energy[tag]) return;
    const slotRows = blk[k] || {};
    let kg = 0;
    Object.keys(slotRows).forEach(exId => {
      const rows = slotRows[exId];
      if (Array.isArray(rows)) kg += rows.reduce((t, r) => t + convertedSetVolume(r), 0);
    });
    if (kg > 0) energy[tag].push(kg);
  });
  const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);

  const notes = [];
  const noteBlk = profile.notes[block.id] || {};
  Object.keys(noteBlk).forEach(k => {
    const s = parseSlot(k);
    if (!s) return;
    const day = (block.days || []).find(d => d.id === s.dayId);
    notes.push({ week: s.week, day: day ? day.name : s.dayId, text: noteBlk[k] });
  });
  notes.sort((a, b) => b.week - a.week || a.day.localeCompare(b.day, 'es'));

  /* The Diagnóstico sheet's own rows, scoped to this block whatever that
     sheet's toggle says. The verdict text is what the reader needs; `est`
     is a live object with functions behind it and stays out. */
  const exercises = diagRows(profile, block, 'block').map(x => {
    /* Sets, not sessions, since plans/035 made the RIR a per-set value —
       and read off the rows rather than through getRir, because "apuntado"
       means written down: the inheritance rule that fills the gaps is the
       objetivo's business, not the reader's. `n` is every working set of
       the exercise in the block, so the tally says how much of it the
       numbers cover instead of leaving "2+ en 6" to be read as all of it.
       So each set's `rirOwn`, never the session's `rir`, and the legacy
       map stays unread, as it always has here.

       The block's own weeks ('plan'), deload included — the tally says
       what was written down in the block, not a trend — and only the row's
       own day: the rows the review lists are the plan's, and each count
       sits beside its own. A lift the plan puts on two days is a row per
       day since plans/056, and a count summed over both days, printed on
       each of its two lines, would describe neither. */
    const rir = { n: 0 };
    RIR_OPTIONS.forEach(k => { rir[k] = 0; });
    sessionsOf(profile, { weeks: 'plan', blocks: [block.id], lift: { id: x.id }, day: x.dayId }).forEach(s => {
      s.sets.forEach(set => {
        if (!set.worked) return;
        rir.n++;
        const v = set.rirOwn;
        if (v == null) return;
        rir[v >= 2 ? '2+' : String(v)]++;
      });
    });
    return { name: x.name, day: x.day, trend: x.trend, trendLabel: DIAG_TRENDS[x.trend].label,
             pct: x.pct, sessions: x.sessions, lectura: x.lectura, cambio: x.cambio, rir: rir };
  });

  return {
    name: block.name,
    weeks: weeks,
    upTo: upTo,
    weeksLogged: weeksLogged,
    tonnage: tonnage.reduce((t, v) => t + v, 0),
    sets: doneSets,
    priority: blockPriority(block),
    muscles: muscles,
    /* One entry per deload span the block has evidence either side of
       (deloadCheck, js/app.js) — usually zero or one, but a block with more
       than one deload carries every one of them here. */
    deloads: deloadCheck(profile, block),
    energy: {
      baja: { n: energy.baja.length, kg: mean(energy.baja) },
      normal: { n: energy.normal.length, kg: mean(energy.normal) },
      alta: { n: energy.alta.length, kg: mean(energy.alta) },
    },
    notes: notes,
    exercises: exercises,
  };
}

/* The brief, as plain text. This is the deliverable — the screen below is
   only there so you can read it before you send it. Written for whatever
   is going to read it next, which is a language model being asked to write
   the following block, so it states the numbers and leaves the conclusions
   to whoever is holding them. */
function reviewText(r) {
  const L = [];
  L.push('## Cómo fue el bloque anterior (' + reviewName(r.name) + ')');
  L.push('');
  L.push('- Semanas del bloque: ' + r.weeks + '. Registradas: ' + r.weeksLogged + '. Llegué hasta la semana ' + r.upTo + '.');
  L.push('- Series marcadas como hechas: ' + r.sets + '. Peso movido: ' + Math.round(r.tonnage) + ' ' + units() + '.');
  if (r.priority.length) L.push('- Músculos que marqué como prioritarios: ' + r.priority.map(reviewName).join(', ') + '.');
  /* One bullet per span — almost always zero or one, exactly today's line;
     a block with more than one deload gets one line each, in week order. */
  r.deloads.forEach(d => {
    L.push('- Descarga en ' + deloadSpanLabel(d) + ': la semana ' + d.after +
      ' quedó ' + reviewPct(d.change) + ' respecto a la semana ' + d.before +
      ' (sobre ' + d.n + ' ejercicios comparables).');
  });
  L.push('');
  L.push('### Por músculo');
  L.push('');
  L.push('Fuerza = cambio del 1RM estimado desde la primera semana registrada, comparando solo ejercicios presentes en las dos semanas.');
  L.push('');
  r.muscles.forEach(m => {
    const bits = [];
    bits.push(m.change == null
      ? 'fuerza: sin comparación posible'
      : 'fuerza ' + reviewPct(m.change) + ' (sobre ' + m.exercises + (m.exercises === 1 ? ' ejercicio' : ' ejercicios') + ')');
    bits.push('sesiones ' + m.done + '/' + m.planned);
    if (m.gap != null) bits.push('cada ' + (Math.round(m.gap * 10) / 10).toString().replace('.', ',') + ' días');
    if (m.planSets != null) {
      bits.push('series/semana: ' + (Math.round((m.logSets || 0) * 10) / 10).toString().replace('.', ',') +
        ' hechas de ' + (Math.round(m.planSets * 10) / 10).toString().replace('.', ',') + ' previstas');
    }
    L.push('- ' + reviewName(m.tag) + (m.priority ? ' (PRIORITARIO)' : '') + ': ' + bits.join(' · ') + '.');
  });
  if (r.exercises && r.exercises.length) {
    L.push('');
    L.push('### Por ejercicio');
    L.push('');
    L.push('Tendencia = pendiente del 1RM estimado por sesión, sobre las últimas ' + DIAG_WINDOW +
      ' sesiones de este bloque. La lectura y el cambio cruzan esa tendencia con el RIR apuntado por serie, las caídas de reps y las bajadas forzadas.');
    L.push('');
    r.exercises.slice(0, REVIEW_MAX_EXERCISES).forEach(x => {
      const bits = [];
      bits.push(x.trend === 'none'
        ? 'sin tendencia (' + x.sessions + (x.sessions === 1 ? ' sesión' : ' sesiones') + ')'
        : 'tendencia ' + x.trendLabel + ' ' + diagPct(x.pct) + ' por sesión sobre ' + x.sessions + ' sesiones');
      /* "series" on the first bucket only, so the list reads as one
         sentence rather than as three; the total is what gives the numbers
         a scale. */
      const counted = RIR_OPTIONS.filter(k => x.rir[k]).map((k, i) =>
        k + ' en ' + x.rir[k] + (i ? '' : (x.rir[k] === 1 ? ' serie' : ' series')));
      bits.push('RIR apuntado: ' +
        (counted.length ? counted.join(', ') + ' (de ' + x.rir.n + ')' : 'ninguno'));
      L.push('- ' + reviewName(x.name) + ' (' + reviewName(x.day) + '): ' + bits.join(' · ') + '. ' + x.lectura + '. Cambio: ' + x.cambio);
    });
  }
  const e = r.energy;
  if (e.baja.n || e.alta.n) {
    L.push('');
    L.push('### Energía al empezar');
    L.push('');
    ENERGY_OPTIONS.forEach(k => {
      if (!e[k].n) return;
      L.push('- ' + k + ': ' + e[k].n + (e[k].n === 1 ? ' sesión' : ' sesiones') +
        ', media de ' + Math.round(e[k].kg) + ' ' + units() + ' movidos.');
    });
  }
  if (r.notes.length) {
    L.push('');
    L.push('### Notas de sesión');
    L.push('');
    r.notes.slice(0, REVIEW_MAX_NOTES).forEach(n => {
      L.push('- Semana ' + n.week + ', ' + reviewName(n.day) + ': ' + reviewName(n.text));
    });
  }
  L.push('');
  L.push('Ten esto en cuenta al escribir el bloque siguiente: sube donde haya margen, ' +
    'arregla el volumen de los músculos prioritarios que se quedaron cortos, y no des por buena ' +
    'una falta de progreso en un músculo al que llegué a la mitad de las sesiones previstas.');
  return L.join('\n');
}

let reviewCache = null;
/* Set when the review was opened mid-flow by "+ Nuevo bloque": closing the
   sheet resumes creating the block instead of leaving you on a dead end. */
let reviewAfterClose = null;

function drawReview() {
  const profile = getProfile(), block = getBlock();
  const r = buildBlockReview(profile, block);
  reviewCache = r;

  $('reviewSub').textContent = r.name + ' — ' + r.weeks + (r.weeks === 1 ? ' semana' : ' semanas') + ', ' +
    r.weeksLogged + ' con registro, ' + setsLabel(r.sets) + ', ' + fmtKg(r.tonnage) + ' movidos.';

  const host = $('reviewHost');
  host.innerHTML = '';
  if (!r.sets) {
    host.innerHTML = '<p class="chart-empty">Este bloque no tiene ninguna serie marcada como hecha, ' +
      'así que no hay nada que repasar todavía.</p>';
    setNote($('reviewStatus'), '', false);
    return;
  }

  /* One line per span, same as reviewText — usually the one line this
     always drew. */
  r.deloads.forEach(dl => {
    const d = document.createElement('p');
    d.className = 'rev-deload' + (dl.change >= 1 ? ' good' : dl.change <= -1 ? ' bad' : '');
    d.textContent = 'Descarga en ' + deloadSpanLabel(dl) + ': la semana ' + dl.after +
      ' quedó ' + reviewPct(dl.change) + ' respecto a la semana ' + dl.before + '.';
    host.appendChild(d);
  });

  r.muscles.forEach(m => {
    const el = document.createElement('div');
    el.className = 'rev-row' + (m.priority ? ' priority' : '');
    el.dataset.tag = m.tag;
    el.innerHTML = '<div class="rev-head"><span class="rev-name"></span><span class="rev-n"></span></div>' +
      '<div class="rev-meta"></div>';
    const name = el.querySelector('.rev-name');
    name.textContent = m.tag;
    if (m.priority) {
      const b = document.createElement('span');
      b.className = 'vol-pri';
      b.textContent = 'PRIORITARIO';
      name.appendChild(b);
    }
    el.querySelector('.rev-n').textContent = m.change == null ? 'sin comparación' : reviewPct(m.change);
    el.querySelector('.rev-meta').textContent =
      m.done + '/' + m.planned + ' sesiones' +
      (m.gap == null ? '' : ' · cada ' + (Math.round(m.gap * 10) / 10).toString().replace('.', ',') + ' días') +
      (m.planSets == null ? '' : ' · ' + (Math.round((m.logSets || 0) * 10) / 10).toString().replace('.', ',') +
        ' de ' + (Math.round(m.planSets * 10) / 10).toString().replace('.', ',') + ' series/semana');
    host.appendChild(el);
  });

  if (r.notes.length) {
    const box = document.createElement('div');
    box.className = 'rev-notes';
    const t = document.createElement('div');
    t.className = 'rev-notes-t';
    t.textContent = r.notes.length === 1 ? '1 nota de sesión' : r.notes.length + ' notas de sesión';
    box.appendChild(t);
    r.notes.slice(0, REVIEW_MAX_NOTES).forEach(n => {
      const p = document.createElement('p');
      p.className = 'rev-note';
      p.textContent = 'S' + n.week + ' · ' + n.day + ' — ' + n.text;
      box.appendChild(p);
    });
    host.appendChild(box);
  }
  setNote($('reviewStatus'), '', false);
}

function openReview(afterClose) {
  reviewAfterClose = typeof afterClose === 'function' ? afterClose : null;
  $('reviewBlob').value = '';
  drawReview();
  openSheet('reviewSheet');
}

function closeReview() {
  closeSheet('reviewSheet');
  const next = reviewAfterClose;
  reviewAfterClose = null;
  if (next) next();
}

function wireReview() {
  registerSheet('reviewSheet', { closeBtn: 'reviewClose', onClose: closeReview });

  /* "Revisión del bloque" in the bar's "Progreso" hub. Until plans/037 this
     was a button js/block-editor.js built by hand with no id, so #reviewBtn
     is new to the shell while this file is precached in every deployed one:
     a precache hole can pair the two, and an unguarded read would throw
     here — taking every wire*() call after it in app.js's tail, and load(),
     with it. AGENTS.md's precache-hole rule applies to ids as to symbols. */
  const b = $('reviewBtn');
  if (b) b.onclick = () => openReview();

  $('reviewCopy').onclick = async () => {
    if (!reviewCache) return;
    try {
      await copyText(reviewText(reviewCache));
      setNote($('reviewStatus'), 'Revisión copiada', false);
    } catch (e) {
      setNote($('reviewStatus'), 'No se pudo copiar: ' + e.message, true);
    }
  };

  /* The one that closes the loop: the same prompt the import sheet hands
     out, with the evidence stapled to it, so the block that comes back is
     written against this block instead of against nothing. */
  $('reviewPrompt').onclick = async () => {
    if (!reviewCache) return;
    setNote($('reviewStatus'), '', false);
    try {
      const prompt = await buildAiPrompt({ withBlock: true });
      await copyText(prompt + '\n\n' + reviewText(reviewCache));
      setNote($('reviewStatus'), 'Prompt copiado con la revisión — pégaselo a tu IA y pega aquí el JSON que te devuelva', false);
    } catch (e) {
      setNote($('reviewStatus'), 'No se pudo copiar el prompt: ' + e.message, true);
    }
  };

  $('reviewDownload').onclick = () => {
    if (!reviewCache) return;
    const name = 'heavy-iron-revision-' + (slugify(reviewCache.name) || 'bloque') + '-' +
      new Date().toISOString().slice(0, 10) + '.txt';
    downloadFile(name, reviewText(reviewCache), 'text/plain;charset=utf-8');
    setNote($('reviewStatus'), 'Revisión descargada', false);
  };

  /* The return leg of the loop the prompt button opens. The JSON the AI
     hands back lands here, on the sheet where the prompt was copied,
     instead of a trip through "Importar JSON" — the same validator and
     the same installer as that sheet, so arriving here is not a way to
     get a looser import. applyImportedBlock is not reused on purpose: it
     reports into the import sheet's own note and closes that sheet,
     neither of which is up. */
  $('reviewImport').onclick = () => {
    setNote($('reviewStatus'), '', false);
    let raw;
    try { raw = JSON.parse($('reviewBlob').value); } catch (e) { setNote($('reviewStatus'), 'Eso no es JSON válido.', true); return; }
    /* The same ceiling as "Importar JSON", checked at the same point and
       said in the same words (blocksFullNote, js/block-editor.js). */
    const full = blocksFullNote(getProfile());
    if (full) { setNote($('reviewStatus'), full, true); return; }
    let normalized;
    try { normalized = normalizeImportedBlock(raw); } catch (e) { setNote($('reviewStatus'), e.message, true); return; }
    /* Opened from "+ Nuevo bloque", closing this sheet resumes creating a
       block by copying the old plan. The block just pasted IS the next
       block, so that continuation is dropped before the sheet closes —
       or the user is asked to name a second, empty one on top of it. */
    reviewAfterClose = null;
    installImportedBlock(normalized);
    $('reviewBlob').value = '';
    closeReview();
    flushSave();
    mark('Bloque "' + normalized.name + '" importado desde la revisión en ' + getProfile().label);
  };
}
