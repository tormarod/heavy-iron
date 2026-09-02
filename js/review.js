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

const reviewPct = v => (v > 0 ? '+' : v < 0 ? '−' : '') +
  String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + ' %';

/* Everything worth saying about a block, gathered from the views that
   already say it: strength from the index, attendance from the
   timestamps, volume from the dashboard, and the deload check. */
function buildBlockReview(profile, block) {
  const weeks = blockWeeks(block);
  const upTo = Math.min(Math.max(profile.week, 1), weeks);
  const tonnage = blockTonnageByWeek(profile, block);
  const weeksLogged = tonnage.filter(v => v > 0).length;

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
    const m = /^w(\d+)-(.+)$/.exec(k);
    if (!m) return;
    const tag = getEnergy(profile, block.id, +m[1], m[2]);
    if (!energy[tag]) return;
    const slotRows = blk[k] || {};
    let kg = 0;
    Object.keys(slotRows).forEach(exId => {
      const rows = slotRows[exId];
      if (Array.isArray(rows)) kg += rows.reduce((t, r) => t + setVolume(r), 0);
    });
    if (kg > 0) energy[tag].push(kg);
  });
  const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);

  const notes = [];
  const noteBlk = profile.notes[block.id] || {};
  Object.keys(noteBlk).forEach(k => {
    const m = /^w(\d+)-(.+)$/.exec(k);
    if (!m) return;
    const day = (block.days || []).find(d => d.id === m[2]);
    notes.push({ week: +m[1], day: day ? day.name : m[2], text: noteBlk[k] });
  });
  notes.sort((a, b) => b.week - a.week || a.day.localeCompare(b.day, 'es'));

  return {
    name: block.name,
    weeks: weeks,
    upTo: upTo,
    weeksLogged: weeksLogged,
    tonnage: tonnage.reduce((t, v) => t + v, 0),
    sets: blockDoneSets(profile, block.id),
    priority: blockPriority(block),
    muscles: muscles,
    deload: deloadCheck(profile, block),
    energy: {
      baja: { n: energy.baja.length, kg: mean(energy.baja) },
      normal: { n: energy.normal.length, kg: mean(energy.normal) },
      alta: { n: energy.alta.length, kg: mean(energy.alta) },
    },
    notes: notes,
  };
}

/* The brief, as plain text. This is the deliverable — the screen below is
   only there so you can read it before you send it. Written for whatever
   is going to read it next, which is a language model being asked to write
   the following block, so it states the numbers and leaves the conclusions
   to whoever is holding them. */
function reviewText(r) {
  const L = [];
  L.push('## Cómo fue el bloque anterior ("' + r.name + '")');
  L.push('');
  L.push('- Semanas del bloque: ' + r.weeks + '. Registradas: ' + r.weeksLogged + '. Llegué hasta la semana ' + r.upTo + '.');
  L.push('- Series marcadas como hechas: ' + r.sets + '. Peso movido: ' + Math.round(r.tonnage) + ' ' + units() + '.');
  if (r.priority.length) L.push('- Músculos que marqué como prioritarios: ' + r.priority.join(', ') + '.');
  if (r.deload) {
    L.push('- Descarga en la semana ' + r.deload.deload + ': la semana ' + r.deload.after +
      ' quedó ' + reviewPct(r.deload.change) + ' respecto a la semana ' + r.deload.before +
      ' (sobre ' + r.deload.n + ' ejercicios comparables).');
  }
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
    L.push('- ' + m.tag + (m.priority ? ' (PRIORITARIO)' : '') + ': ' + bits.join(' · ') + '.');
  });
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
      L.push('- Semana ' + n.week + ', ' + n.day + ': ' + n.text);
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

  if (r.deload) {
    const d = document.createElement('p');
    d.className = 'rev-deload' + (r.deload.change >= 1 ? ' good' : r.deload.change <= -1 ? ' bad' : '');
    d.textContent = 'Descarga en la semana ' + r.deload.deload + ': la semana ' + r.deload.after +
      ' quedó ' + reviewPct(r.deload.change) + ' respecto a la semana ' + r.deload.before + '.';
    host.appendChild(d);
  }

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
  $('reviewClose').onclick = closeReview;
  $('reviewSheet').addEventListener('click', e => { if (e.target.id === 'reviewSheet') closeReview(); });

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
      const prompt = await buildAiPrompt();
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
}
