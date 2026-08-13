const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
let tId = null, tLeft = 0, tTotal = 0, tOver = false;

const $ = id => document.getElementById(id);
const slot = (w, d) => 'w' + w + '-d' + d;

/* ---------- storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  if (!state.profiles) state = defaultState();
  ready = true;
  mark('Cargado');
  render();
}

let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      mark('Guardado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      mark('No se ha podido guardar en este dispositivo', true);
    }
  }, 400);
}

function mark(msg, err) {
  const s = $('status');
  if (!s) return;
  s.textContent = msg;
  s.className = 'status' + (err ? ' err' : '');
}

/* ---------- state accessors ---------- */
function getProfile() { return state.profiles[state.activeProfile]; }
function getBlock() { const p = getProfile(); return p.blocks[p.activeBlock]; }

function setsFor(ex, w) {
  let n = ex.sets;
  if (ex.add && w >= ex.add) n += 1;
  if (w === 8) n = Math.max(2, Math.ceil(ex.sets / 2));
  return n;
}

function entry(profile, blockId, w, d, exId, n) {
  if (!profile.log[blockId]) profile.log[blockId] = {};
  const k = slot(w, d);
  if (!profile.log[blockId][k]) profile.log[blockId][k] = {};
  if (!profile.log[blockId][k][exId]) profile.log[blockId][k][exId] = [];
  const a = profile.log[blockId][k][exId];
  while (a.length < n) a.push({ w: '', r: '', done: false });
  return a.slice(0, n);
}

function lastTime(profile, blockId, d, exId, beforeWeek) {
  for (let w = beforeWeek - 1; w >= 1; w--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, d)];
    if (s && s[exId]) {
      const done = s[exId].filter(x => x.done && x.w !== '');
      if (done.length) return { week: w, sets: done };
    }
  }
  return null;
}

/* ---------- rest timer ---------- */
function startRest(sec, label) {
  if (!sec) return;
  clearInterval(tId);
  tLeft = sec; tTotal = sec; tOver = false;
  $('timer').classList.add('up');
  $('timer').classList.remove('over');
  $('tlbl').textContent = 'Descanso · ' + label;
  $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  tick();
  tId = setInterval(tick, 1000);
}

function tick() {
  const v = $('tval'), f = $('tfill');
  if (tLeft > 0) {
    tLeft--;
    v.textContent = Math.floor(tLeft / 60) + ':' + String(tLeft % 60).padStart(2, '0');
    f.style.width = (tLeft / tTotal * 100) + '%';
  } else {
    if (!tOver) {
      tOver = true;
      $('timer').classList.add('over');
      $('tlbl').textContent = 'Vamos';
      $('tmsg').textContent = 'Se acabó el descanso. Siguiente serie.';
      f.style.width = '100%';
      if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    }
    tLeft--;
    const over = Math.abs(tLeft);
    v.textContent = '+' + Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0');
    if (over > 180) stopRest();
  }
}

function stopRest() {
  clearInterval(tId); tId = null;
  $('timer').classList.remove('up', 'over');
}
$('tskip').onclick = stopRest;

/* ---------- profile / block bars ---------- */
function renderProfiles() {
  const host = $('profiles');
  host.innerHTML = '';
  Object.keys(state.profiles).forEach(key => {
    const p = state.profiles[key];
    const b = document.createElement('button');
    b.className = 'profile-btn' + (key === state.activeProfile ? ' on' : '');
    b.textContent = p.label;
    b.onclick = () => { state.activeProfile = key; stopRest(); render(); };
    host.appendChild(b);
  });
  $('app').className = 'profile-' + getProfile().theme;
}

function renderBlockBar() {
  const profile = getProfile();
  const host = $('blockbar');
  host.innerHTML = '';

  const select = document.createElement('select');
  profile.blockOrder.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = profile.blocks[id].name;
    if (id === profile.activeBlock) opt.selected = true;
    select.appendChild(opt);
  });
  select.onchange = () => { profile.activeBlock = select.value; profile.week = 1; profile.day = 0; stopRest(); save(); render(); };
  host.appendChild(select);

  const newBtn = document.createElement('button');
  newBtn.className = 'sm';
  newBtn.textContent = '+ Nuevo bloque';
  newBtn.onclick = newBlock;
  host.appendChild(newBtn);
}

function newBlock() {
  const profile = getProfile();
  const current = getBlock();
  const n = profile.blockOrder.length + 1;
  const name = prompt('Nombre del nuevo bloque:', 'Bloque ' + n);
  if (!name) return;
  const id = 'block-' + Date.now();
  const clone = JSON.parse(JSON.stringify(current));
  clone.id = id;
  clone.name = name;
  clone.createdAt = new Date().toISOString();
  profile.blocks[id] = clone;
  profile.blockOrder.push(id);
  profile.activeBlock = id;
  profile.week = 1; profile.day = 0;
  save(); render();
  mark('Bloque creado a partir de "' + current.name + '" — edítalo con "Editar plan"');
}

/* ---------- nav ---------- */
function renderNav() {
  const profile = getProfile();
  const block = getBlock();

  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;

  $('weeks').innerHTML = '';
  for (let w = 1; w <= 8; w++) {
    const b = document.createElement('button');
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (w === 8 ? ' deload' : '');
    b.textContent = w === 8 ? 'DL' : w;
    const has = [0, 1, 2].some(d => {
      const s = profile.log[block.id] && profile.log[block.id][slot(w, d)];
      return s && Object.values(s).some(a => a.some(x => x.done));
    });
    if (has) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; stopRest(); render(); };
    $('weeks').appendChild(b);
  }

  $('days').innerHTML = '';
  block.days.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'day' + (i === profile.day ? ' on' : '');
    b.innerHTML = '<span class="day-n">Día ' + (i + 1) + '</span><span class="day-t"></span>';
    b.querySelector('.day-t').textContent = d.name;
    b.onclick = () => { profile.day = i; stopRest(); render(); };
    $('days').appendChild(b);
  });
}

/* ---------- main render ---------- */
function render() {
  if (!ready) return;
  const profile = getProfile();
  const block = getBlock();

  renderProfiles();
  renderBlockBar();
  renderNav();

  const ph = block.phase[profile.week] || { r: '', t: '' };
  const dl = profile.week === 8;
  $('banner').innerHTML = '';
  const bannerDiv = document.createElement('div');
  bannerDiv.className = 'banner' + (dl ? ' deload' : '');
  bannerDiv.innerHTML =
    '<div><div class="banner-l">Objetivo semana ' + profile.week + '</div>' +
    '<div class="banner-v"></div></div><div class="banner-r"></div>';
  bannerDiv.querySelector('.banner-v').textContent = ph.r;
  bannerDiv.querySelector('.banner-r').textContent = ph.t;
  $('banner').appendChild(bannerDiv);

  const day = block.days[profile.day];
  $('pair').textContent = day.pair || '';
  $('pair').style.display = day.pair ? 'flex' : 'none';

  const list = $('list');
  list.innerHTML = '';
  let total = 0, doneN = 0;

  day.ex.forEach((ex, i) => {
    const n = setsFor(ex, profile.week);
    const rows = entry(profile, block.id, profile.week, profile.day, ex.id, n);
    profile.log[block.id][slot(profile.week, profile.day)][ex.id] = rows;
    const allDone = rows.every(r => r.done);
    total += n; doneN += rows.filter(r => r.done).length;

    const card = document.createElement('div');
    card.className = 'ex' + (allDone ? ' complete' : '') + (ex.share ? ' shared' : '');

    const prev = lastTime(profile, block.id, profile.day, ex.id, profile.week);
    const prevTxt = prev
      ? '<div class="last"><span class="tag">Sem. ' + prev.week + '</span><span><b>' +
        prev.sets.map(s => s.w + '×' + (s.r || '?')).join('</b> · <b>') + '</b></span></div>'
      : '';

    card.innerHTML =
      '<div class="ex-head">' +
        '<div class="ex-num">' + (i + 1) + '</div>' +
        '<div class="ex-body">' +
          '<div class="ex-name"></div>' +
          (ex.alt ? '<div class="ex-alt"></div>' : '') +
          (ex.cue ? '<div class="ex-cue"></div>' : '') +
        '</div>' +
        '<div><div class="ex-target">' + n + ' × ' + ex.reps + '</div>' +
        '<div class="ex-rest">' + (ex.rest ? 'desc. ' + (ex.rest >= 60 ? (ex.rest / 60).toFixed(ex.rest % 60 ? 1 : 0).replace('.0', '') + ' min' : ex.rest + 's') : 'superserie →') + '</div>' +
        '<button class="ex-chart-btn" type="button">Progreso ↗</button></div>' +
      '</div>' + prevTxt +
      '<div class="sets"></div>';

    const nameEl = card.querySelector('.ex-name');
    nameEl.appendChild(document.createTextNode(ex.n));
    if (ex.share) { const s = document.createElement('span'); s.className = 'badge together'; s.textContent = 'JUNTOS'; nameEl.appendChild(s); }
    else { const s = document.createElement('span'); s.className = 'badge solo'; s.textContent = 'SOLO'; nameEl.appendChild(s); }
    if (ex.ss) { const s = document.createElement('span'); s.className = 'ss'; s.textContent = 'SS'; nameEl.appendChild(s); }
    if (ex.alt) card.querySelector('.ex-alt').textContent = ex.alt;
    if (ex.cue) card.querySelector('.ex-cue').textContent = ex.cue;

    card.querySelector('.ex-chart-btn').onclick = () => openChart(ex, profile.day);

    const box = card.querySelector('.sets');
    rows.forEach((r, si) => {
      const row = document.createElement('div');
      row.className = 'set-row' + (r.done ? ' done' : '');
      row.innerHTML =
        '<div class="set-n">' + (si + 1) + '</div>' +
        '<div class="fld"><input type="number" inputmode="decimal" step="0.5" placeholder="—"><u>kg</u></div>' +
        '<div class="fld"><input type="number" inputmode="numeric" placeholder="—"><u>rep</u></div>' +
        '<div class="tick' + (r.done ? ' on' : '') + '">✓</div>';

      const [wIn, rIn] = row.querySelectorAll('input');
      wIn.value = r.w; rIn.value = r.r;
      wIn.oninput = e => { r.w = e.target.value; save(); };
      rIn.oninput = e => { r.r = e.target.value; save(); };

      row.querySelector('.tick').onclick = () => {
        r.done = !r.done;
        if (r.done && ex.rest) startRest(ex.rest, ex.n + ' · serie ' + (si + 1));
        if (r.done && !ex.rest) stopRest();
        save(); render();
      };
      box.appendChild(row);
    });

    list.appendChild(card);
  });

  $('barfill').style.width = total ? (doneN / total * 100) + '%' : '0%';
  $('note').textContent = doneN === total
    ? 'Sesión completa — ' + total + ' series registradas. Siguiente: ' + block.days[(profile.day + 1) % block.days.length].name + (profile.day === block.days.length - 1 ? ', semana ' + (profile.week + 1) : '') + '.'
    : doneN + ' de ' + total + ' series hechas. Llega al tope del rango en todas las series y sube el peso el próximo día.';
}

/* ---------- day/data actions ---------- */
$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock();
  const src = profile.log[block.id] && profile.log[block.id][slot(profile.week - 1, profile.day)];
  if (profile.week === 1 || !src) { mark('No hay nada registrado en la semana ' + (profile.week - 1) + ' para este día'); return; }
  block.days[profile.day].ex.forEach(ex => {
    const from = src[ex.id]; if (!from) return;
    const to = entry(profile, block.id, profile.week, profile.day, ex.id, setsFor(ex, profile.week));
    to.forEach((r, i) => { if (!r.done) r.w = (from[i] || from[from.length - 1] || {}).w || ''; });
    profile.log[block.id][slot(profile.week, profile.day)][ex.id] = to;
  });
  save(); render();
  mark('Pesos copiados de la semana ' + (profile.week - 1) + ' — supéralos');
};

$('clearDay').onclick = () => {
  const profile = getProfile(), block = getBlock();
  const dayName = block.days[profile.day].name;
  if (!confirm('¿Borrar todas las series de ' + dayName + ', semana ' + profile.week + '?')) return;
  if (profile.log[block.id]) delete profile.log[block.id][slot(profile.week, profile.day)];
  save(); render();
  mark('Día borrado');
};

$('wipe').onclick = () => {
  const profile = getProfile();
  if (!confirm('¿Borrar TODO el registro de ' + profile.label + ' (todos los bloques y semanas)? El plan de ejercicios no se borra. No se puede deshacer.')) return;
  profile.log = {};
  save(); render();
  mark('Registro de ' + profile.label + ' borrado');
};

/* ---------- plan editor ---------- */
let draftBlock = null;

$('editPlan').onclick = () => {
  draftBlock = JSON.parse(JSON.stringify(getBlock()));
  $('peBlockName').value = draftBlock.name;
  renderPlanEditor();
  $('planSheet').classList.add('up');
};

function renderPlanEditor() {
  const host = $('peDays');
  host.innerHTML = '';
  draftBlock.days.forEach((day, di) => {
    const box = document.createElement('div');
    box.className = 'pe-day';
    box.innerHTML =
      '<div class="pe-day-head">' +
        '<input type="text" class="pe-day-name" placeholder="Nombre del día">' +
        '<textarea class="pe-day-pair" placeholder="Nota de pareja para este día (opcional)"></textarea>' +
      '</div><div class="pe-exlist"></div>';
    box.querySelector('.pe-day-name').value = day.name;
    box.querySelector('.pe-day-name').oninput = e => { day.name = e.target.value; };
    box.querySelector('.pe-day-pair').value = day.pair || '';
    box.querySelector('.pe-day-pair').oninput = e => { day.pair = e.target.value; };

    const exlist = box.querySelector('.pe-exlist');
    day.ex.forEach((ex, ei) => exlist.appendChild(buildExRow(day, ei)));

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pe-add-ex';
    addBtn.textContent = '+ Añadir ejercicio';
    addBtn.onclick = () => {
      day.ex.push({ id: 'ex-' + Date.now(), n: '', alt: '', cue: '', sets: 3, reps: '10–15', rest: 90, share: 0, ss: 0 });
      renderPlanEditor();
    };
    box.appendChild(addBtn);
    host.appendChild(box);
  });
}

function buildExRow(day, ei) {
  const ex = day.ex[ei];
  const row = document.createElement('div');
  row.className = 'pe-ex';
  row.innerHTML =
    '<div class="pe-row">' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Ejercicio</span><input type="text" class="f-n"></div>' +
      '<button type="button" class="pe-ex-del">Eliminar</button>' +
    '</div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Alternativa</span><input type="text" class="f-alt"></div></div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Nota / cue</span><input type="text" class="f-cue"></div></div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">Series</span><input type="number" min="1" class="f-sets"></div>' +
      '<div style="flex:1;min-width:70px;"><span class="pe-field-lbl">Reps</span><input type="text" class="f-reps"></div>' +
      '<div><span class="pe-field-lbl">Descanso (s)</span><input type="number" min="0" step="5" class="f-rest"></div>' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="8" class="f-add"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<label class="pe-check"><input type="checkbox" class="f-share"> Compartido (JUNTOS)</label>' +
      '<label class="pe-check"><input type="checkbox" class="f-ss"> Superserie (SS)</label>' +
    '</div>';

  row.querySelector('.f-n').value = ex.n;
  row.querySelector('.f-n').oninput = e => ex.n = e.target.value;
  row.querySelector('.f-alt').value = ex.alt || '';
  row.querySelector('.f-alt').oninput = e => ex.alt = e.target.value;
  row.querySelector('.f-cue').value = ex.cue || '';
  row.querySelector('.f-cue').oninput = e => ex.cue = e.target.value;
  row.querySelector('.f-sets').value = ex.sets;
  row.querySelector('.f-sets').oninput = e => ex.sets = parseInt(e.target.value, 10) || 1;
  row.querySelector('.f-reps').value = ex.reps;
  row.querySelector('.f-reps').oninput = e => ex.reps = e.target.value;
  row.querySelector('.f-rest').value = ex.rest || 0;
  row.querySelector('.f-rest').oninput = e => ex.rest = parseInt(e.target.value, 10) || 0;
  row.querySelector('.f-add').value = ex.add || '';
  row.querySelector('.f-add').oninput = e => { const v = parseInt(e.target.value, 10); if (v) ex.add = v; else delete ex.add; };
  row.querySelector('.f-share').checked = !!ex.share;
  row.querySelector('.f-share').onchange = e => { if (e.target.checked) ex.share = 1; else delete ex.share; };
  row.querySelector('.f-ss').checked = !!ex.ss;
  row.querySelector('.f-ss').onchange = e => { if (e.target.checked) ex.ss = 1; else delete ex.ss; };
  row.querySelector('.pe-ex-del').onclick = () => { day.ex.splice(ei, 1); renderPlanEditor(); };

  return row;
}

$('peSave').onclick = () => {
  draftBlock.name = $('peBlockName').value.trim() || draftBlock.name;
  for (const day of draftBlock.days) {
    if (!day.ex.length) { alert('Cada día necesita al menos un ejercicio.'); return; }
    for (const ex of day.ex) {
      if (!ex.n.trim()) { alert('Todos los ejercicios necesitan un nombre.'); return; }
      if (!ex.reps || !String(ex.reps).trim()) { alert('Falta el rango de repeticiones en "' + (ex.n || 'un ejercicio') + '".'); return; }
    }
  }
  const profile = getProfile();
  profile.blocks[draftBlock.id] = draftBlock;
  save(); render();
  $('planSheet').classList.remove('up');
  mark('Plan actualizado');
};

$('peClose').onclick = () => { $('planSheet').classList.remove('up'); draftBlock = null; };
$('planSheet').addEventListener('click', e => { if (e.target.id === 'planSheet') { $('planSheet').classList.remove('up'); draftBlock = null; } });

$('peDeleteBlock').onclick = () => {
  const profile = getProfile();
  if (profile.blockOrder.length <= 1) { alert('No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
  if (!confirm('¿Eliminar "' + draftBlock.name + '" y todo su registro? No se puede deshacer.')) return;
  profile.blockOrder = profile.blockOrder.filter(id => id !== draftBlock.id);
  delete profile.blocks[draftBlock.id];
  delete profile.log[draftBlock.id];
  profile.activeBlock = profile.blockOrder[0];
  profile.week = 1; profile.day = 0;
  save(); render();
  $('planSheet').classList.remove('up');
  mark('Bloque eliminado');
};

/* ---------- progress chart ---------- */
function collectHistory(profile, blockId, dayIdx, exId) {
  const points = [];
  for (let w = 1; w <= 8; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayIdx)];
    const rows = s && s[exId];
    if (!rows) continue;
    const done = rows.filter(r => r.done && r.w !== '' && r.w != null && !isNaN(parseFloat(r.w)));
    if (!done.length) continue;
    let best = done[0];
    done.forEach(r => { if (parseFloat(r.w) > parseFloat(best.w)) best = r; });
    points.push({ week: w, weight: parseFloat(best.w), reps: best.r });
  }
  return points;
}

function buildChartSVG(points) {
  const W = 600, H = 220, padL = 40, padR = 16, padT = 16, padB = 28;
  const weights = points.map(p => p.weight);
  let min = Math.min(...weights), max = Math.max(...weights);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = w => padL + ((w - 1) / 7) * (W - padL - padR);
  const y = v => H - padB - ((v - min) / (max - min)) * (H - padT - padB);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;">';

  // gridlines + x labels for weeks 1-8
  for (let w = 1; w <= 8; w++) {
    svg += '<line x1="' + x(w) + '" y1="' + padT + '" x2="' + x(w) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>';
    svg += '<text x="' + x(w) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="var(--soft)" font-family="IBM Plex Mono, monospace">S' + w + '</text>';
  }
  // y labels
  svg += '<text x="4" y="' + (y(max - pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(max - pad) + '</text>';
  svg += '<text x="4" y="' + (y(min + pad) + 4) + '" font-size="10" fill="var(--soft)" font-family="IBM Plex Mono, monospace">' + Math.round(min + pad) + '</text>';

  if (points.length) {
    const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.week) + ' ' + y(p.weight)).join(' ');
    svg += '<path d="' + path + '" fill="none" stroke="var(--signal)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    points.forEach(p => {
      svg += '<circle cx="' + x(p.week) + '" cy="' + y(p.weight) + '" r="4" fill="var(--signal)"/>';
    });
  }
  svg += '</svg>';
  return svg;
}

function openChart(ex, dayIdx) {
  const profile = getProfile(), block = getBlock();
  const points = collectHistory(profile, block.id, dayIdx, ex.id);
  $('chartTitle').textContent = ex.n;
  $('chartSub').textContent = block.name + ' — mejor peso registrado por semana (× repeticiones de esa serie).';
  const host = $('chartHost');
  if (!points.length) {
    host.innerHTML = '<p style="font-size:12px;color:var(--soft);padding:20px 4px;">Aún no hay series completadas con peso para este ejercicio en este bloque.</p>';
  } else {
    let html = buildChartSVG(points);
    html += '<table class="chart-table"><thead><tr><th>Semana</th><th>Peso</th><th>Reps</th></tr></thead><tbody>';
    points.forEach(p => { html += '<tr><td>Semana ' + p.week + '</td><td>' + p.weight + ' kg</td><td>' + (p.reps || '—') + '</td></tr>'; });
    html += '</tbody></table>';
    host.innerHTML = html;
  }
  $('chartSheet').classList.add('up');
}

$('chartClose').onclick = () => $('chartSheet').classList.remove('up');
$('chartSheet').addEventListener('click', e => { if (e.target.id === 'chartSheet') $('chartSheet').classList.remove('up'); });

/* ---------- backup / restore ---------- */
$('backup').onclick = () => {
  $('blob').value = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state });
  $('sheet').classList.add('up');
};
$('bClose').onclick = () => $('sheet').classList.remove('up');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').classList.remove('up'); });

$('bDownload').onclick = () => {
  const payload = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'heavy-iron-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mark('Copia descargada');
};

$('bUploadBtn').onclick = () => $('bUpload').click();
$('bUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => restoreFromText(reader.result);
  reader.readAsText(file);
  e.target.value = '';
});

$('bCopy').onclick = async () => {
  const ta = $('blob');
  ta.focus(); ta.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ta.value);
    else if (!document.execCommand('copy')) throw new Error();
    mark('Copiado al portapapeles');
  } catch (e) {
    mark('No se pudo copiar — selecciona el texto y cópialo a mano', true);
  }
};

$('bRestore').onclick = () => restoreFromText($('blob').value);

function restoreFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch (e) { mark('Ese texto no es una copia válida', true); return; }
  const data = parsed && parsed.data ? parsed.data : parsed;
  const ok = data && typeof data === 'object' && data.profiles &&
    data.profiles.hombre && data.profiles.mujer;
  if (!ok) { mark('Ese archivo/texto no es una copia válida de Heavy Iron', true); return; }
  if (!confirm('¿Reemplazar TODO tu registro (los dos perfiles) con esta copia? Se sobrescribirá lo que tengas ahora.')) return;
  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  save(); render();
  $('sheet').classList.remove('up');
  mark('Registro restaurado');
}

load();
