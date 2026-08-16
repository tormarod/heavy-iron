const STORAGE_KEY = 'heavy-iron-v1';

let state = null;
let ready = false;
let tId = null, tEndAt = 0, tTotal = 0, tOverNotified = false;
let wakeLock = null;

const $ = id => document.getElementById(id);

/* Log rows are filed under a day's *id*, not its position, so days can be
   added, retired or reordered without the weeks logged under them moving
   with the shuffle. Legacy data was keyed by index ('w3-d1'), so migrate()
   below hands the old days the ids 'd0', 'd1', … — the keys come out
   identical and nothing has to be rewritten. */
const slot = (w, dayId) => 'w' + w + '-' + dayId;

let uidN = 0;
const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + (uidN++);

/* Retired days/exercises stay in the block with an `off` flag instead of
   being spliced out: the session only ever shows the live ones, but the
   plan keeps enough of the retired item to put it back exactly where it
   was, and its log is never touched. */
const dayList = block => block.days.filter(d => !d.off);
const exList = day => day.ex.filter(e => !e.off);

/* ---------- storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  if (!state.profiles) state = defaultState();
  migrate();
  ready = true;
  mark('Cargado');
  render();
}

function migrate() {
  Object.keys(state.profiles).forEach(pk => {
    const profile = state.profiles[pk];
    Object.keys(profile.blocks || {}).forEach(bk => {
      const block = profile.blocks[bk];
      if (!Array.isArray(block.days)) return;
      const used = new Set();
      block.days.forEach((day, i) => {
        let id = day.id;
        if (!id || used.has(id)) {
          id = 'd' + i;
          while (used.has(id)) id = uid('d');
        }
        day.id = id;
        used.add(id);
      });
    });
  });
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

/* The stored rows are the record and are never shortened: dropping a set
   in the plan editor hides the last row from the session, it does not
   delete what was logged in it. Put the set back — this week or next
   block — and the numbers are still there. entry() only pads and returns
   the slice the current plan asks for; the row objects it hands back are
   the stored ones, so editing them writes straight through. */
function rowsFor(profile, blockId, w, dayId, exId) {
  if (!profile.log[blockId]) profile.log[blockId] = {};
  const k = slot(w, dayId);
  if (!profile.log[blockId][k]) profile.log[blockId][k] = {};
  if (!profile.log[blockId][k][exId]) profile.log[blockId][k][exId] = [];
  return profile.log[blockId][k][exId];
}

function entry(profile, blockId, w, dayId, exId, n) {
  const a = rowsFor(profile, blockId, w, dayId, exId);
  while (a.length < n) a.push({ w: '', r: '', done: false });
  return a.slice(0, n);
}

const rowUsed = r => !!(r && (r.done || (r.w !== '' && r.w != null) || (r.r !== '' && r.r != null)));

/* Rows logged past what the current plan shows — kept, but out of sight. */
function parkedRows(profile, blockId, w, dayId, exId, n) {
  const a = profile.log[blockId] && profile.log[blockId][slot(w, dayId)] && profile.log[blockId][slot(w, dayId)][exId];
  return a && a.length > n ? a.slice(n).filter(rowUsed).length : 0;
}

function loggedSets(profile, blockId, dayId, exId) {
  let n = 0;
  for (let w = 1; w <= 8; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) n += s[exId].filter(rowUsed).length;
  }
  return n;
}

function loggedSetsDay(profile, blockId, day) {
  return day.ex.reduce((t, ex) => t + loggedSets(profile, blockId, day.id, ex.id), 0);
}

function purgeExLog(profile, blockId, dayId, exId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= 8; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= 8; w++) delete blk[slot(w, dayId)];
}

/* Everything logged anywhere in a block — the number that decides whether
   a block is disposable, so it is the number every "¿eliminar?" shows. */
function blockLoggedSets(profile, blockId) {
  const blk = profile.log[blockId];
  if (!blk) return 0;
  let n = 0;
  Object.keys(blk).forEach(k => {
    const s = blk[k];
    if (!s) return;
    Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
  });
  return n;
}

function lastTime(profile, blockId, dayId, exId, beforeWeek) {
  for (let w = beforeWeek - 1; w >= 1; w--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) {
      const done = s[exId].filter(x => x.done && x.w !== '');
      if (done.length) return { week: w, sets: done };
    }
  }
  return null;
}

/* ---------- rest timer ----------
   The countdown is driven off a wall-clock end time (tEndAt), not a
   decrementing counter, so it self-corrects instantly when the phone
   was locked/backgrounded and setInterval got throttled or paused —
   the moment you look at the screen again it shows the real elapsed
   time instead of whatever it happened to freeze at. The Wake Lock
   request below tries to stop the screen from locking in the first
   place while a rest period is running, on browsers that support it. */
function startRest(sec, label) {
  if (!sec) return;
  clearInterval(tId);
  tEndAt = Date.now() + sec * 1000;
  tTotal = sec; tOverNotified = false;
  $('timer').classList.add('up');
  $('timer').classList.remove('over');
  $('tlbl').textContent = 'Descanso · ' + label;
  $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  tick();
  tId = setInterval(tick, 1000);
  requestWakeLock();
}

function tick() {
  const v = $('tval'), f = $('tfill');
  const left = Math.round((tEndAt - Date.now()) / 1000);
  if (left > 0) {
    v.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    f.style.width = (left / tTotal * 100) + '%';
  } else {
    if (!tOverNotified) {
      tOverNotified = true;
      $('timer').classList.add('over');
      $('tlbl').textContent = 'Vamos';
      $('tmsg').textContent = 'Se acabó el descanso. Siguiente serie.';
      f.style.width = '100%';
      if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    }
    const over = Math.abs(left);
    v.textContent = '+' + Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0');
    if (over > 180) stopRest();
  }
}

function stopRest() {
  clearInterval(tId); tId = null;
  $('timer').classList.remove('up', 'over');
  releaseWakeLock();
}
$('tskip').onclick = stopRest;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not supported, or permission denied — countdown still self-corrects on tick */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tId) {
    tick();
    requestWakeLock();
  }
});

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

function blockDate(block) {
  if (!block.createdAt) return '';
  const d = new Date(block.createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}

/* Importing the same file twice (or copying a block without renaming it)
   leaves several blocks called exactly the same, and a picker full of
   identical rows is how you delete the wrong one. Same-named blocks get
   their position and creation date appended; a unique name is left alone. */
function blockPickerLabel(profile, id) {
  const name = profile.blocks[id].name || 'Bloque';
  const twins = profile.blockOrder.filter(x => (profile.blocks[x].name || 'Bloque') === name);
  if (twins.length < 2) return name;
  const d = blockDate(profile.blocks[id]);
  return name + ' (' + (twins.indexOf(id) + 1) + ')' + (d ? ' · ' + d : '');
}

function renderBlockBar() {
  const profile = getProfile();
  const host = $('blockbar');
  host.innerHTML = '';

  const select = document.createElement('select');
  profile.blockOrder.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = blockPickerLabel(profile, id);
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

  const importBtn = document.createElement('button');
  importBtn.className = 'sm';
  importBtn.textContent = 'Importar JSON';
  importBtn.onclick = openImportSheet;
  host.appendChild(importBtn);

  const manageBtn = document.createElement('button');
  manageBtn.className = 'sm';
  manageBtn.textContent = 'Gestionar';
  manageBtn.onclick = openBlockManager;
  host.appendChild(manageBtn);
}

/* ---------- deleting blocks ----------
   The one rule: deleting somebody else's block must not move you. Only
   when the block you are actually training disappears do week/day reset
   and the app land somewhere else — on the newest block left, which is
   the one you are most likely training next. A profile is never left
   without a block. */
function deleteBlocks(profile, ids) {
  const drop = new Set(ids.filter(id => profile.blocks[id]));
  if (!drop.size) return 0;
  const keep = profile.blockOrder.filter(id => !drop.has(id));
  if (!keep.length) return 0;

  drop.forEach(id => { delete profile.blocks[id]; delete profile.log[id]; });
  profile.blockOrder = keep;
  if (drop.has(profile.activeBlock)) {
    profile.activeBlock = keep[keep.length - 1];
    profile.week = 1; profile.day = 0;
    stopRest();
  }
  save(); render();
  return drop.size;
}

function openBlockManager() {
  $('blocksSheet').classList.add('up');
  renderBlockManager();
}

function renderBlockManager() {
  const profile = getProfile();
  const host = $('blockList');
  host.innerHTML = '';
  const only = profile.blockOrder.length <= 1;

  profile.blockOrder.forEach(id => {
    const block = profile.blocks[id];
    const active = id === profile.activeBlock;
    const sets = blockLoggedSets(profile, id);
    const date = blockDate(block);

    const row = document.createElement('div');
    row.className = 'blk-row' + (active ? ' on' : '');
    row.innerHTML =
      '<span class="blk-l"><b></b><i></i></span>' +
      '<span class="pe-tools"><button type="button" class="pe-icon-btn danger blk-del">Eliminar</button></span>';
    row.querySelector('b').textContent = block.name + (active ? ' · actual' : '');
    row.querySelector('i').textContent =
      [date, dayList(block).length + (dayList(block).length === 1 ? ' día' : ' días'),
       sets ? setsLabel(sets) : 'sin registro'].filter(Boolean).join(' · ');

    const del = row.querySelector('.blk-del');
    del.disabled = only;
    del.onclick = () => {
      const what = '¿Eliminar "' + block.name + '"' + (date ? ' (' + date + ')' : '') + '?\n\n';
      const cost = sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ';
      const rest = active
        ? 'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.'
        : 'El bloque actual, "' + profile.blocks[profile.activeBlock].name + '", se queda exactamente como está.';
      if (!confirm(what + cost + rest + '\n\nNo se puede deshacer.')) return;
      deleteBlocks(profile, [id]);
      renderBlockManager();
      mark('Bloque eliminado');
    };

    host.appendChild(row);
  });
}

$('blkKeepCurrent').onclick = () => {
  const profile = getProfile();
  const others = profile.blockOrder.filter(id => id !== profile.activeBlock);
  if (!others.length) { alert('"' + getBlock().name + '" ya es el único bloque de ' + profile.label + '.'); return; }
  const sets = others.reduce((t, id) => t + blockLoggedSets(profile, id), 0);
  const names = others.map(id => '· ' + blockPickerLabel(profile, id)).join('\n');
  const msg =
    '¿Eliminar los otros ' + others.length + ' bloques de ' + profile.label + '?\n\n' + names + '\n\n' +
    (sets ? 'Se borran ' + setsLabel(sets) + ' en total. ' : 'No tienen nada registrado. ') +
    '"' + getBlock().name + '" y todo su registro se quedan como están.\n\nNo se puede deshacer.';
  if (!confirm(msg)) return;
  const n = deleteBlocks(profile, others);
  renderBlockManager();
  mark(n + (n === 1 ? ' bloque eliminado' : ' bloques eliminados') + ' — el bloque actual intacto');
};

$('blkClose').onclick = () => $('blocksSheet').classList.remove('up');
$('blocksSheet').addEventListener('click', e => { if (e.target.id === 'blocksSheet') $('blocksSheet').classList.remove('up'); });

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
  /* Retired days/exercises exist to guard the old block's history, and the
     new block has none — copy the plan as it is actually trained. */
  clone.days = dayList(clone).map(d => { d.ex = exList(d); return d; });
  profile.blocks[id] = clone;
  profile.blockOrder.push(id);
  profile.activeBlock = id;
  profile.week = 1; profile.day = 0;
  save(); render();
  mark('Bloque creado a partir de "' + current.name + '" — edítalo con "Editar plan"');
}

/* ---------- import block from JSON ----------
   Lets an external agent (or you, by hand) hand over a block as plain
   JSON — either pasted in, or committed to blocks/ in this repo and
   picked from the list, fetched read-only via raw.githubusercontent.com
   (no token, no write access). See README for the expected JSON shape. */
const GITHUB_BLOCKS_BASE = 'https://raw.githubusercontent.com/tormarod/heavy-iron/main/blocks';

const GENERIC_IMPORT_PHASE = {
  1: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  2: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  3: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  4: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  5: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  6: { r: '0–1 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  7: { r: '0–1 RIR', t: 'La semana más dura. Última serie de cada máquina al fallo.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function normalizeImportedBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El JSON no es un objeto válido.');
  const name = (raw.name && String(raw.name).trim()) || 'Bloque importado';
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error('Falta "days" (al menos un día de entrenamiento).');

  const usedIds = new Set();
  const usedDayIds = new Set();
  const days = raw.days.map((day, di) => {
    if (!day || typeof day !== 'object') throw new Error('El día ' + (di + 1) + ' no es válido.');
    const dayName = (day.name && String(day.name).trim()) || ('Día ' + (di + 1));
    if (!Array.isArray(day.ex) || !day.ex.length) throw new Error('El día "' + dayName + '" necesita al menos un ejercicio.');
    const ex = day.ex.map((e, ei) => {
      if (!e || typeof e !== 'object') throw new Error('Un ejercicio del día "' + dayName + '" no es válido.');
      const n = e.n && String(e.n).trim();
      if (!n) throw new Error('Falta el nombre de un ejercicio en "' + dayName + '".');
      const reps = e.reps != null && String(e.reps).trim();
      if (!reps) throw new Error('Falta el rango de repeticiones en "' + n + '".');
      const baseId = e.id ? String(e.id).trim() : (slugify(n) || ('ex-' + di + '-' + ei));
      let uniqueId = baseId, suffix = 2;
      while (usedIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
      usedIds.add(uniqueId);
      const out = {
        id: uniqueId, n, reps,
        sets: Number.isFinite(+e.sets) && +e.sets > 0 ? Math.round(+e.sets) : 3,
        rest: Number.isFinite(+e.rest) && +e.rest >= 0 ? Math.round(+e.rest) : 90,
      };
      if (e.alt) out.alt = String(e.alt);
      if (e.cue) out.cue = String(e.cue);
      if (e.add != null && Number.isFinite(+e.add) && +e.add >= 1) out.add = Math.round(+e.add);
      if (e.share) out.share = 1;
      if (e.ss) out.ss = 1;
      return out;
    });
    let dayId = day.id ? String(day.id).trim() : ('d' + di);
    while (!dayId || usedDayIds.has(dayId)) dayId = uid('d');
    usedDayIds.add(dayId);
    const out = { id: dayId, name: dayName, ex };
    if (day.pair) out.pair = String(day.pair);
    return out;
  });

  let phase = GENERIC_IMPORT_PHASE;
  if (raw.phase && typeof raw.phase === 'object') {
    phase = {};
    for (let w = 1; w <= 8; w++) {
      const p = raw.phase[w] || raw.phase[String(w)];
      phase[w] = (p && p.r && p.t) ? { r: String(p.r), t: String(p.t) } : GENERIC_IMPORT_PHASE[w];
    }
  }

  return { name, days, phase };
}

function applyImportedBlock(raw, sourceLabel) {
  let normalized;
  try {
    normalized = normalizeImportedBlock(raw);
  } catch (e) {
    $('importError').textContent = e.message;
    return;
  }
  const profile = getProfile();
  const id = 'block-' + Date.now();
  profile.blocks[id] = { id, name: normalized.name, createdAt: new Date().toISOString(), days: normalized.days, phase: normalized.phase };
  profile.blockOrder.push(id);
  profile.activeBlock = id;
  profile.week = 1; profile.day = 0;
  save(); render();
  $('importSheet').classList.remove('up');
  mark('Bloque "' + normalized.name + '" importado' + (sourceLabel ? ' (' + sourceLabel + ')' : '') + ' en ' + profile.label);
}

async function loadRepoBlockList() {
  const host = $('importRepoList');
  host.textContent = 'Cargando…';
  try {
    const res = await fetch(GITHUB_BLOCKS_BASE + '/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) { host.textContent = 'No hay bloques publicados todavía en blocks/.'; return; }
    host.innerHTML = '';
    list.forEach(item => {
      const label = (item && (item.label || item.file)) || 'bloque';
      const row = document.createElement('div');
      row.className = 'import-item';
      row.innerHTML = '<span></span><button type="button" class="sm">Importar</button>';
      row.querySelector('span').textContent = label;
      row.querySelector('button').onclick = async () => {
        $('importError').textContent = '';
        try {
          const r = await fetch(GITHUB_BLOCKS_BASE + '/' + item.file, { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyImportedBlock(await r.json(), label);
        } catch (e) {
          $('importError').textContent = 'No se pudo cargar "' + label + '": ' + e.message;
        }
      };
      host.appendChild(row);
    });
  } catch (e) {
    host.textContent = 'No se pudo conectar con GitHub ahora mismo. Puedes pegar el JSON a mano abajo.';
  }
}

function openImportSheet() {
  $('importBlob').value = '';
  $('importError').textContent = '';
  $('importSheet').classList.add('up');
  loadRepoBlockList();
}

$('importFromText').onclick = () => {
  $('importError').textContent = '';
  let raw;
  try { raw = JSON.parse($('importBlob').value); } catch (e) { $('importError').textContent = 'Eso no es JSON válido.'; return; }
  applyImportedBlock(raw, 'texto pegado');
};
$('importClose').onclick = () => $('importSheet').classList.remove('up');
$('importSheet').addEventListener('click', e => { if (e.target.id === 'importSheet') $('importSheet').classList.remove('up'); });

/* ---------- nav ---------- */
function renderNav() {
  const profile = getProfile();
  const block = getBlock();
  const days = dayList(block);

  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;

  $('weeks').innerHTML = '';
  for (let w = 1; w <= 8; w++) {
    const b = document.createElement('button');
    b.className = 'wk' + (w === profile.week ? ' on' : '') + (w === 8 ? ' deload' : '');
    b.textContent = w === 8 ? 'DL' : w;
    const has = days.some(d => {
      const s = profile.log[block.id] && profile.log[block.id][slot(w, d.id)];
      return s && Object.values(s).some(a => a.some(x => x.done));
    });
    if (has) { const dot = document.createElement('span'); dot.className = 'dot'; b.appendChild(dot); }
    b.onclick = () => { profile.week = w; stopRest(); render(); };
    $('weeks').appendChild(b);
  }

  $('days').innerHTML = '';
  days.forEach((d, i) => {
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

  /* A block always keeps one live day: retiring every day would leave the
     session with nothing to draw, so the first one comes back. */
  if (!dayList(block).length && block.days.length) delete block.days[0].off;
  const days = dayList(block);
  if (!(profile.day >= 0) || profile.day > days.length - 1) profile.day = 0;

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

  const day = days[profile.day];
  $('pair').textContent = day.pair || '';
  $('pair').style.display = day.pair ? 'flex' : 'none';

  const list = $('list');
  list.innerHTML = '';
  let total = 0, doneN = 0;

  exList(day).forEach((ex, i) => {
    const n = setsFor(ex, profile.week);
    const rows = entry(profile, block.id, profile.week, day.id, ex.id, n);
    const parked = parkedRows(profile, block.id, profile.week, day.id, ex.id, n);
    const allDone = rows.every(r => r.done);
    total += n; doneN += rows.filter(r => r.done).length;

    const card = document.createElement('div');
    card.className = 'ex' + (allDone ? ' complete' : '') + (ex.share ? ' shared' : '');

    const prev = lastTime(profile, block.id, day.id, ex.id, profile.week);
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
      '<div class="sets"></div>' +
      (parked ? '<div class="ex-parked"></div>' : '');

    if (parked) {
      card.querySelector('.ex-parked').textContent = parked === 1
        ? 'Hay 1 serie registrada por encima de las que pide el plan. Se guarda: sube las series de este ejercicio para volver a verla.'
        : 'Hay ' + parked + ' series registradas por encima de las que pide el plan. Se guardan: sube las series de este ejercicio para volver a verlas.';
    }

    const nameEl = card.querySelector('.ex-name');
    nameEl.appendChild(document.createTextNode(ex.n));
    if (ex.share) { const s = document.createElement('span'); s.className = 'badge together'; s.textContent = 'JUNTOS'; nameEl.appendChild(s); }
    else { const s = document.createElement('span'); s.className = 'badge solo'; s.textContent = 'SOLO'; nameEl.appendChild(s); }
    if (ex.ss) { const s = document.createElement('span'); s.className = 'ss'; s.textContent = 'SS'; nameEl.appendChild(s); }
    if (ex.alt) card.querySelector('.ex-alt').textContent = ex.alt;
    if (ex.cue) card.querySelector('.ex-cue').textContent = ex.cue;

    card.querySelector('.ex-chart-btn').onclick = () => openChart(ex, day.id);

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
    ? 'Sesión completa — ' + total + ' series registradas. Siguiente: ' + days[(profile.day + 1) % days.length].name + (profile.day === days.length - 1 ? ', semana ' + (profile.week + 1) : '') + '.'
    : doneN + ' de ' + total + ' series hechas. Llega al tope del rango en todas las series y sube el peso el próximo día.';
}

/* ---------- day/data actions ---------- */
function currentDay() {
  const days = dayList(getBlock());
  return days[Math.min(getProfile().day, days.length - 1)];
}

$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  const src = profile.log[block.id] && profile.log[block.id][slot(profile.week - 1, day.id)];
  if (profile.week === 1 || !src) { mark('No hay nada registrado en la semana ' + (profile.week - 1) + ' para este día'); return; }
  exList(day).forEach(ex => {
    const from = src[ex.id]; if (!from) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week));
    to.forEach((r, i) => { if (!r.done) r.w = (from[i] || from[from.length - 1] || {}).w || ''; });
  });
  save(); render();
  mark('Pesos copiados de la semana ' + (profile.week - 1) + ' — supéralos');
};

$('clearDay').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  if (!confirm('¿Borrar todas las series de ' + day.name + ', semana ' + profile.week + '?')) return;
  if (profile.log[block.id]) delete profile.log[block.id][slot(profile.week, day.id)];
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

/* ---------- plan editor ----------
   Everything here edits a *draft* copy of the block; nothing reaches the
   real block (or the log) until "Guardar cambios". Structural edits are
   built so the logged sets survive them: exercises and days keep their
   ids when moved or renamed, dropping a set only hides the row, and
   removing something that has history retires it instead of deleting it.
   Erasing logged sets for good takes a second, explicit click in
   "Retirados". */
let draftBlock = null;
let draftPurge = [];

$('editPlan').onclick = () => {
  draftBlock = JSON.parse(JSON.stringify(getBlock()));
  draftPurge = [];
  $('peBlockName').value = draftBlock.name;
  renderPlanEditor();
  $('planSheet').classList.add('up');
};

function newExercise() {
  return { id: uid('ex'), n: '', alt: '', cue: '', sets: 3, reps: '10–15', rest: 90, share: 0, ss: 0 };
}

/* Swap with the nearest live neighbour, leaving retired items parked
   where they are. */
function moveLive(arr, item, dir) {
  const i = arr.indexOf(item);
  let j = i + dir;
  while (j >= 0 && j < arr.length && arr[j].off) j += dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  arr[i] = arr[j];
  arr[j] = item;
}

function setsLabel(n) { return n + (n === 1 ? ' serie registrada' : ' series registradas'); }

function renderPlanEditor() {
  const host = $('peDays');
  const profile = getProfile();
  host.innerHTML = '';

  const live = dayList(draftBlock);
  live.forEach((day, pos) => host.appendChild(buildDayBox(profile, day, pos, live.length)));

  const addDay = document.createElement('button');
  addDay.type = 'button';
  addDay.className = 'pe-add-ex';
  addDay.textContent = '+ Añadir día';
  addDay.onclick = () => {
    draftBlock.days.push({ id: uid('d'), name: 'Día ' + (live.length + 1), ex: [newExercise()] });
    renderPlanEditor();
  };
  host.appendChild(addDay);

  renderRetired(host, profile);
}

function buildDayBox(profile, day, pos, liveCount) {
  const box = document.createElement('div');
  box.className = 'pe-day';
  box.innerHTML =
    '<div class="pe-bar">' +
      '<span class="pe-bar-n">Día ' + (pos + 1) + '</span>' +
      '<span class="pe-log-tag"></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn d-up" title="Subir día">↑</button>' +
        '<button type="button" class="pe-icon-btn d-down" title="Bajar día">↓</button>' +
        '<button type="button" class="pe-icon-btn danger d-del">Quitar día</button>' +
      '</span>' +
    '</div>' +
    '<div class="pe-day-head">' +
      '<input type="text" class="pe-day-name" placeholder="Nombre del día">' +
      '<textarea class="pe-day-pair" placeholder="Nota de pareja para este día (opcional)"></textarea>' +
    '</div><div class="pe-exlist"></div>';

  const logged = loggedSetsDay(profile, draftBlock.id, day);
  if (logged) box.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  box.querySelector('.pe-day-name').value = day.name;
  box.querySelector('.pe-day-name').oninput = e => { day.name = e.target.value; };
  box.querySelector('.pe-day-pair').value = day.pair || '';
  box.querySelector('.pe-day-pair').oninput = e => { day.pair = e.target.value; };

  const up = box.querySelector('.d-up'), down = box.querySelector('.d-down'), del = box.querySelector('.d-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(draftBlock.days, day, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(draftBlock.days, day, 1); renderPlanEditor(); };
  del.onclick = () => {
    if (logged) {
      if (!confirm('"' + day.name + '" tiene ' + setsLabel(logged) + ' en este bloque.\n\nSe retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.')) return;
      day.off = 1;
    } else {
      if (!confirm('¿Quitar "' + day.name + '" del bloque? No tiene nada registrado.')) return;
      draftBlock.days.splice(draftBlock.days.indexOf(day), 1);
    }
    renderPlanEditor();
  };

  const exlist = box.querySelector('.pe-exlist');
  const liveEx = exList(day);
  liveEx.forEach((ex, i) => exlist.appendChild(buildExRow(profile, day, ex, i, liveEx.length)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pe-add-ex';
  addBtn.textContent = '+ Añadir ejercicio';
  addBtn.onclick = () => { day.ex.push(newExercise()); renderPlanEditor(); };
  box.appendChild(addBtn);
  return box;
}

function renderRetired(host, profile) {
  const items = [];
  draftBlock.days.forEach(day => {
    if (day.off) { items.push({ day }); return; }
    day.ex.forEach(ex => { if (ex.off) items.push({ day, ex }); });
  });
  if (!items.length) return;

  const box = document.createElement('div');
  box.className = 'pe-retired';
  box.innerHTML =
    '<div class="pe-bar"><span class="pe-bar-n">Retirados</span></div>' +
    '<p class="pe-retired-d">Fuera del plan, con su registro intacto. Al restaurarlos vuelven con todo lo que tenían anotado.</p>';

  items.forEach(it => {
    const isDay = !it.ex;
    const logged = isDay ? loggedSetsDay(profile, draftBlock.id, it.day)
                         : loggedSets(profile, draftBlock.id, it.day.id, it.ex.id);
    const row = document.createElement('div');
    row.className = 'pe-arch';
    row.innerHTML =
      '<span class="pe-arch-l"><b></b><i></i></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn a-back">Restaurar</button>' +
        '<button type="button" class="pe-icon-btn danger a-del">' + (logged ? 'Borrar registro' : 'Borrar') + '</button>' +
      '</span>';
    row.querySelector('b').textContent = isDay ? ('Día · ' + it.day.name) : (it.ex.n || 'Ejercicio sin nombre');
    row.querySelector('i').textContent = (isDay ? '' : it.day.name + ' · ') + (logged ? setsLabel(logged) : 'sin registro');
    row.querySelector('.a-back').onclick = () => {
      if (isDay) delete it.day.off; else delete it.ex.off;
      renderPlanEditor();
    };
    row.querySelector('.a-del').onclick = () => {
      const what = isDay ? ('el día "' + it.day.name + '"') : ('"' + (it.ex.n || 'este ejercicio') + '"');
      const msg = logged
        ? '¿Borrar ' + what + ' y sus ' + setsLabel(logged) + ' definitivamente? No se puede deshacer.'
        : '¿Borrar ' + what + ' del bloque? No tiene nada registrado.';
      if (!confirm(msg)) return;
      if (isDay) {
        draftBlock.days.splice(draftBlock.days.indexOf(it.day), 1);
        draftPurge.push({ dayId: it.day.id });
      } else {
        it.day.ex.splice(it.day.ex.indexOf(it.ex), 1);
        draftPurge.push({ dayId: it.day.id, exId: it.ex.id });
      }
      renderPlanEditor();
    };
    box.appendChild(row);
  });

  host.appendChild(box);
}

function buildExRow(profile, day, ex, pos, liveCount) {
  const row = document.createElement('div');
  row.className = 'pe-ex';
  row.innerHTML =
    '<div class="pe-bar">' +
      '<span class="pe-bar-n">' + (pos + 1) + '</span>' +
      '<span class="pe-log-tag"></span>' +
      '<span class="pe-tools">' +
        '<button type="button" class="pe-icon-btn e-up" title="Subir ejercicio">↑</button>' +
        '<button type="button" class="pe-icon-btn e-down" title="Bajar ejercicio">↓</button>' +
        '<button type="button" class="pe-icon-btn danger e-del">Quitar</button>' +
      '</span>' +
    '</div>' +
    '<div class="pe-row">' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Ejercicio</span><input type="text" class="f-n"></div>' +
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

  const logged = loggedSets(profile, draftBlock.id, day.id, ex.id);
  if (logged) row.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  const up = row.querySelector('.e-up'), down = row.querySelector('.e-down'), del = row.querySelector('.e-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(day.ex, ex, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(day.ex, ex, 1); renderPlanEditor(); };
  del.onclick = () => {
    if (logged) {
      if (!confirm('"' + (ex.n || 'Este ejercicio') + '" tiene ' + setsLabel(logged) + ' en este bloque.\n\nSe retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.')) return;
      ex.off = 1;
    } else {
      day.ex.splice(day.ex.indexOf(ex), 1);
    }
    renderPlanEditor();
  };

  return row;
}

$('peSave').onclick = () => {
  draftBlock.name = $('peBlockName').value.trim() || draftBlock.name;
  const days = dayList(draftBlock);
  if (!days.length) { alert('El bloque necesita al menos un día.'); return; }
  days.forEach((day, i) => { if (!String(day.name || '').trim()) day.name = 'Día ' + (i + 1); });
  for (const day of days) {
    const ex = exList(day);
    if (!ex.length) { alert('Cada día necesita al menos un ejercicio — revisa "' + day.name + '".'); return; }
    for (const e of ex) {
      if (!String(e.n || '').trim()) { alert('Todos los ejercicios necesitan un nombre.'); return; }
      if (!e.reps || !String(e.reps).trim()) { alert('Falta el rango de repeticiones en "' + (e.n || 'un ejercicio') + '".'); return; }
    }
  }
  const profile = getProfile();
  /* The only path that erases logged sets, and only the ones explicitly
     confirmed in "Retirados". */
  draftPurge.forEach(p => {
    if (p.exId) purgeExLog(profile, draftBlock.id, p.dayId, p.exId);
    else purgeDayLog(profile, draftBlock.id, p.dayId);
  });
  profile.blocks[draftBlock.id] = draftBlock;
  draftBlock = null; draftPurge = [];
  save(); render();
  $('planSheet').classList.remove('up');
  mark('Plan actualizado — el registro se mantiene');
};

function closePlanEditor() {
  $('planSheet').classList.remove('up');
  draftBlock = null;
  draftPurge = [];
}

$('peClose').onclick = closePlanEditor;
$('planSheet').addEventListener('click', e => { if (e.target.id === 'planSheet') closePlanEditor(); });

$('peDeleteBlock').onclick = () => {
  const profile = getProfile();
  if (profile.blockOrder.length <= 1) { alert('No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
  const id = draftBlock.id;
  const sets = blockLoggedSets(profile, id);
  const msg = '¿Eliminar "' + draftBlock.name + '"?\n\n' +
    (sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ') +
    'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.\n\nNo se puede deshacer.';
  if (!confirm(msg)) return;
  closePlanEditor();
  deleteBlocks(profile, [id]);
  mark('Bloque eliminado');
};

/* ---------- progress chart ---------- */
function collectHistory(profile, blockId, dayId, exId) {
  const points = [];
  for (let w = 1; w <= 8; w++) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
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

function openChart(ex, dayId) {
  const profile = getProfile(), block = getBlock();
  const points = collectHistory(profile, block.id, dayId, ex.id);
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
  migrate();
  save(); render();
  $('sheet').classList.remove('up');
  mark('Registro restaurado');
}

load();
