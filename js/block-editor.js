/* ---------- block picker / manager ---------- */
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
  newBtn.onclick = () => newBlock();
  host.appendChild(newBtn);

  const reviewBtn = document.createElement('button');
  reviewBtn.className = 'sm';
  reviewBtn.textContent = 'Revisión';
  reviewBtn.onclick = openReview;
  host.appendChild(reviewBtn);

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

  snapshotForUndo(drop.size === 1 ? 'Bloque eliminado.' : drop.size + ' bloques eliminados.');

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
  openSheet('blocksSheet');
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
    del.onclick = async () => {
      const cost = sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ';
      const rest = active
        ? 'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede.'
        : 'El bloque actual, "' + profile.blocks[profile.activeBlock].name + '", se queda exactamente como está.';
      const okd = await ask({
        title: '¿Eliminar "' + block.name + '"' + (date ? ' (' + date + ')' : '') + '?',
        body: cost + rest + ' No se puede deshacer.',
        okLabel: 'Eliminar', danger: true,
      });
      if (!okd) return;
      deleteBlocks(profile, [id]);
      renderBlockManager();
      mark('Bloque eliminado');
    };

    host.appendChild(row);
  });
}



async function newBlock(skipReview) {
  const profile = getProfile();
  const current = getBlock();
  /* The moment the last block is worth reading is the moment you start the
     next one — which is exactly when the app used to say nothing at all.
     Asked before the name, so choosing to read it costs nothing you have
     already typed, and the flow picks up where it left off when the review
     closes rather than dead-ending on a sheet. Offered, never forced. */
  const doneSets = blockDoneSets(profile, current.id);
  if (!skipReview && doneSets > 0) {
    const look = await ask({
      title: '¿Repasas "' + current.name + '" antes?',
      body: 'Llevas ' + setsLabel(doneSets) + ' en él. La revisión resume qué músculo se movió, a cuántas sesiones llegaste y cómo quedó el volumen — y se copia como prompt para que tu IA escriba el siguiente bloque contra eso.',
      okLabel: 'Ver la revisión', cancelLabel: 'Crear sin repasar',
    });
    if (look) { openReview(() => newBlock(true)); return; }
  }
  const n = profile.blockOrder.length + 1;
  const name = await askText({
    title: 'Nuevo bloque',
    body: 'Se crea copiando el plan de "' + current.name + '". Su registro se queda donde está.',
    value: 'Bloque ' + n,
    placeholder: 'Nombre del bloque',
  });
  if (!name || !name.trim()) return;
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
   (no token, no write access). See README for the expected JSON shape.
   `genericPhase`/`DELOAD_PHASE`/`GENERIC_RAMP`/`IMPORT_LIMITS`/`txt`/`slugify`
   stay in app.js — they're used well outside block-import too
   (migrate/emptyBlock, the QR log limits, muscle/pattern tags) and app.js
   loads after this file, so calling them from here at call-time (never at
   parse-time — nothing below runs until a user action fires) is safe. */

/* Imported blocks come from outside the app — a file in the repo, a paste
   from a chat, an agent's output — so nothing in them is taken on trust.
   Every string is trimmed to a length that still fits on the card, every
   number is clamped to something a human could train, and the block as a
   whole has a ceiling: a "block" with 40 000 exercises is not a training
   plan, it is a way to hang the phone. Anything the app then draws is
   escaped on the way out (see `esc`), so this is a second line, not the
   only one. */
function normalizeImportedBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El JSON no es un objeto válido.');
  const name = txt(raw.name, IMPORT_LIMITS.name) || 'Bloque importado';
  /* Both optional: a block that says nothing is the eight-week, deload-on-8
     shape every block had before length was configurable. */
  const weeks = clampInt(raw.weeks, 1, MAX_WEEKS, 8);
  let deload = raw.deload == null ? (weeks === 8 ? 8 : 0) : clampInt(raw.deload, 0, MAX_WEEKS, 0);
  if (deload > weeks) deload = 0;
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error('Falta "days" (al menos un día de entrenamiento).');
  if (raw.days.length > IMPORT_LIMITS.days) throw new Error('Demasiados días (' + raw.days.length + '): el máximo es ' + IMPORT_LIMITS.days + '.');

  const usedIds = new Set();
  const usedDayIds = new Set();
  const days = raw.days.map((day, di) => {
    if (!day || typeof day !== 'object') throw new Error('El día ' + (di + 1) + ' no es válido.');
    const dayName = txt(day.name, IMPORT_LIMITS.name) || ('Día ' + (di + 1));
    if (!Array.isArray(day.ex) || !day.ex.length) throw new Error('El día "' + dayName + '" necesita al menos un ejercicio.');
    if (day.ex.length > IMPORT_LIMITS.ex) throw new Error('El día "' + dayName + '" tiene ' + day.ex.length + ' ejercicios: el máximo es ' + IMPORT_LIMITS.ex + '.');
    const ex = day.ex.map((e, ei) => {
      if (!e || typeof e !== 'object') throw new Error('Un ejercicio del día "' + dayName + '" no es válido.');
      const n = txt(e.n, IMPORT_LIMITS.exName);
      if (!n) throw new Error('Falta el nombre de un ejercicio en "' + dayName + '".');
      const reps = txt(e.reps, IMPORT_LIMITS.reps);
      if (!reps) throw new Error('Falta el rango de repeticiones en "' + n + '".');
      const baseId = txt(e.id, 60) || (slugify(n) || ('ex-' + di + '-' + ei));
      let uniqueId = baseId, suffix = 2;
      while (usedIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
      usedIds.add(uniqueId);
      const out = {
        id: uniqueId, n, reps,
        sets: clampInt(e.sets, 1, 12, 3),
        rest: clampInt(e.rest, 0, 900, 90),
      };
      if (e.alt) out.alt = txt(e.alt, IMPORT_LIMITS.alt);
      if (e.cue) out.cue = txt(e.cue, IMPORT_LIMITS.cue);
      if (e.setup) out.setup = txt(e.setup, SETUP_LIMIT);
      /* clampInt would silently round a fractional "add" — 2.3 becoming 2 —
         and a program quietly rewritten under someone's feet is worse than
         a rejected import they can fix and retry. Rejected loudly instead,
         same as a missing name or rep range. `inc` is exempt: it is
         genuinely a decimal (a weight step), so it goes through clampNum,
         which is built for that, not this guard. */
      if (e.add != null) {
        const av = +e.add;
        if (!Number.isFinite(av) || !Number.isInteger(av) || av < 1) {
          throw new Error('El incremento de series ("add") de "' + n + '" tiene que ser un número entero de al menos 1 (llegó ' + JSON.stringify(e.add) + ').');
        }
        out.add = clampInt(av, 1, weeks, 1);
      }
      if (e.inc != null) { const v = clampNum(e.inc, INC_MIN, INC_MAX, 0, INC_STEP); if (v > 0) out.inc = v; }
      if (e.share) out.share = 1;
      if (e.ss) out.ss = 1;
      /* Freeform, same as everywhere else it's set — whoever built this
         block (an agent, a person, another app's export) defines their own
         muscle/pattern/type taxonomy. Only trimmed and length-capped; a
         blank or missing value is left absent rather than rejecting the
         whole import. */
      if (e.muscle != null) { const m = txt(e.muscle, MUSCLE_LIMIT); if (m) out.muscle = m; }
      if (e.pattern != null) { const p = txt(e.pattern, PATTERN_LIMIT); if (p) out.pattern = p; }
      if (e.type != null) { const t = txt(e.type, TYPE_LIMIT); if (t) out.type = t; }
      return out;
    });
    let dayId = txt(day.id, 60);
    while (!dayId || usedDayIds.has(dayId)) dayId = uid('d');
    usedDayIds.add(dayId);
    const out = { id: dayId, name: dayName, ex };
    if (day.pair) out.pair = txt(day.pair, IMPORT_LIMITS.pair);
    return out;
  });

  let phase = genericPhase(weeks, deload);
  if (raw.phase && typeof raw.phase === 'object') {
    const generic = phase;
    phase = {};
    for (let w = 1; w <= weeks; w++) {
      const p = raw.phase[w] || raw.phase[String(w)];
      phase[w] = (p && p.r && p.t)
        ? { r: txt(p.r, IMPORT_LIMITS.phaseR), t: txt(p.t, IMPORT_LIMITS.phaseT) }
        : generic[w];
    }
  }

  /* Same freeform treatment as the muscle tags it points at: cleaned and
     capped, never validated against the plan — a name with no exercises
     under it just never gets flagged. */
  const priority = cleanPriority(raw.priority);

  return { name, weeks, deload, days, phase, priority };
}

/* A fresh block object from an already-validated import. Shared by every
   place a normalized block gets filed away — adding it to a profile that
   already has blocks, and installing it as the very first one during setup
   — so they can't drift on what fields a block actually needs. */
function blockFromNormalized(normalized) {
  const block = {
    id: 'block-' + Date.now(),
    name: normalized.name, createdAt: new Date().toISOString(),
    weeks: normalized.weeks, deload: normalized.deload,
    days: normalized.days, phase: normalized.phase,
  };
  /* Absent unless there is one, same as on any other block. */
  if (normalized.priority && normalized.priority.length) block.priority = normalized.priority.slice();
  return block;
}

/* Filing an already-validated block into the current profile. Split out from
   the sheet below it because a block can now also arrive from a camera (see
   the QR section), and both routes have to land it identically: as a *new*
   block, never on top of an existing one, so an import can't cost you a log.
   `log`/`rir`/`order` are optional and already normalized — a QR that
   carried progress with the plan hands them in here, keyed by this block's
   own ids. */
function installImportedBlock(normalized, log, rir, order) {
  const profile = getProfile();
  const block = blockFromNormalized(normalized);
  profile.blocks[block.id] = block;
  profile.blockOrder.push(block.id);
  profile.activeBlock = block.id;
  profile.week = 1; profile.day = 0;
  if (log) profile.log[block.id] = log;
  if (rir) profile.rir[block.id] = rir;
  if (order) profile.order[block.id] = order;
  save(); render();
  return block.id;
}

function applyImportedBlock(raw, sourceLabel) {
  let normalized;
  try {
    normalized = normalizeImportedBlock(raw);
  } catch (e) {
    setNote($('importError'), e.message, true);
    return;
  }
  installImportedBlock(normalized);
  closeSheet('importSheet');
  flushSave();
  mark('Bloque "' + normalized.name + '" importado' + (sourceLabel ? ' (' + sourceLabel + ')' : '') + ' en ' + getProfile().label);
}

async function loadRepoBlockList() {
  const host = $('importRepoList');
  host.textContent = 'Cargando…';
  try {
    const res = await fetch(blocksBase() + '/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) { host.textContent = 'No hay bloques publicados todavía en blocks/.'; return; }
    host.innerHTML = '';
    list.slice(0, 60).forEach(item => {
      if (!item || typeof item !== 'object' || !item.file) return;
      /* The file name is pasted into a URL, so it may only ever name a file
         sitting in blocks/ — no directory hops, no absolute URLs. */
      const file = String(item.file);
      if (!/^[A-Za-z0-9._-]+\.json$/.test(file) || file.indexOf('..') >= 0) return;
      const label = txt(item.label, 120) || file;
      const row = document.createElement('div');
      row.className = 'import-item';
      row.innerHTML = '<span></span><button type="button" class="sm">Importar</button>';
      row.querySelector('span').textContent = label;
      row.querySelector('button').onclick = async () => {
        setNote($('importError'), '', false);
        try {
          const r = await fetch(blocksBase() + '/' + encodeURIComponent(file), { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyImportedBlock(await r.json(), label);
        } catch (e) {
          setNote($('importError'), 'No se pudo cargar "' + label + '": ' + e.message, true);
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
  setNote($('importError'), '', false);
  openSheet('importSheet');
  loadRepoBlockList();
}


/* Builds a self-contained prompt for a third party's AI agent, describing
   the block JSON shape from the same limits the importer itself enforces
   (IMPORT_LIMITS, MUSCLE_LIMIT, PATTERN_LIMIT, TYPE_LIMIT, MAX_WEEKS) so it can't quietly drift out of
   sync with what normalizeImportedBlock actually accepts. The worked
   example is fetched from blocks/ejemplo-plantilla.json — the same file the
   download button offers — rather than duplicated inline, for the same
   reason. Works with no network too: the example is just left out. */
async function buildAiPrompt() {
  const L = IMPORT_LIMITS;
  const lines = [
    'Genera un bloque de entrenamiento como JSON para la app "Heavy Iron". Responde solo con el JSON, sin texto ni comentarios alrededor.',
    '',
    'Formato exacto:',
    '{',
    '  "name": string opcional (máx ' + L.name + ' car., por defecto "Bloque importado"),',
    '  "weeks": número opcional 1-' + MAX_WEEKS + ' (por defecto 8),',
    '  "deload": número opcional — semana de descarga (0 = sin descarga; por defecto 8 si weeks=8, si no, ninguna),',
    '  "days": [ // obligatorio, 1-' + L.days + ' días',
    '    {',
    '      "name": string opcional (máx ' + L.name + ' car., por defecto "Día N"),',
    '      "pair": string opcional (máx ' + L.pair + ' car.) — nota para una sesión conjunta de pareja ese día,',
    '      "ex": [ // obligatorio, 1-' + L.ex + ' ejercicios',
    '        {',
    '          "n": string OBLIGATORIO — nombre del ejercicio (máx ' + L.exName + ' car.),',
    '          "reps": string OBLIGATORIO — rango de reps, p.ej. "8-12" (máx ' + L.reps + ' car.),',
    '          "sets": número opcional 1-12 (por defecto 3),',
    '          "rest": número opcional — segundos de descanso 0-900 (por defecto 90; usa 0 si el ejercicio va encadenado en superserie),',
    '          "add": número entero opcional 1-weeks — desde esa semana se añade una serie extra (progresión de series; tiene que ser un entero o se rechaza todo el bloque),',
    '          "inc": número opcional, admite decimales, ' + INC_MIN + '-' + INC_MAX + ' — el escalón de peso más pequeño que se puede cargar en ese ejercicio: cuánto añade "copiar semana anterior" al llegar al tope del rango en todas las series, y a qué se redondea el objetivo de peso de cada semana. Si falta, se usa el incremento por defecto de los ajustes. Pon uno realista por ejercicio (mancuernas y poleas suelen subir de 1-2,5 en 2,5; prensas y hacks, de 5 en 5),',
    '          "alt": string opcional — alternativa (máx ' + L.alt + ' car.),',
    '          "cue": string opcional — indicación técnica, para todas las series (máx ' + L.cue + ' car.),',
    '          "setup": string opcional — ajustes de la máquina (altura de asiento, posición del respaldo…), no técnica (máx ' + SETUP_LIMIT + ' car.),',
    '          "muscle": string opcional — músculo principal, libre, p.ej. Pecho/Espalda/Hombro/Bíceps/Tríceps/Cuádriceps/Isquios/Glúteo/Gemelos/Core (máx ' + MUSCLE_LIMIT + ' car.),',
    '          "pattern": string opcional — patrón de movimiento, libre, p.ej. Empuje horizontal/Empuje vertical/Tirón horizontal/Tirón vertical/Rodilla dominante/Cadera dominante (máx ' + PATTERN_LIMIT + ' car.),',
    '          "type": string opcional — tipo de ejercicio, libre, p.ej. Compuesto/Aislamiento (máx ' + TYPE_LIMIT + ' car.),',
    '          "share": 1 opcional — marca el ejercicio como estación compartida en pareja ("JUNTOS"),',
    '          "ss": 1 opcional — marca el ejercicio como parte de una superserie ("SS")',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "priority": [ // opcional — músculos prioritarios del bloque, con los mismos nombres que uses en "muscle" (máx ' + PRIORITY_MAX + ')',
    '    "Pecho", "Hombro"',
    '  ],',
    '  "phase": { // opcional — objetivo de cada semana, clave = número de semana',
    '    "1": { "r": string corto, p.ej. RIR objetivo (máx ' + L.phaseR + ' car.), "t": texto del objetivo de esa semana (máx ' + L.phaseT + ' car.) }',
    '  }',
    '}',
  ];

  let example = '';
  try {
    const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
    if (r.ok) example = JSON.stringify(JSON.parse(await r.text()));
  } catch (e) { /* offline: the prompt still works without the embedded example */ }
  if (example) lines.push('', 'Ejemplo de referencia (formato válido, contenido de muestra):', example);

  lines.push(
    '',
    'Ahora genera un bloque para mí según mis objetivos. Mi contexto: [tu nivel, cuántos días a la semana, material del gimnasio disponible, qué músculos priorizar, si entrenas solo o en pareja, y cuántas semanas quieres el bloque].',
    '',
    'Responde solo con el JSON.',
  );
  return lines.join('\n');
}

/* Shared by the import sheet and the setup screen's own copy of these two
   buttons (see openSetup/renderSetup below) — the work is identical, only
   which note element gets the result differs. */
async function downloadBlockTemplate(noteEl) {
  setNote(noteEl, '', false);
  try {
    const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    downloadFile('heavy-iron-bloque-ejemplo.json', await r.text(), 'application/json');
    setNote(noteEl, 'Plantilla descargada', false);
  } catch (e) {
    setNote(noteEl, 'No se pudo descargar la plantilla ahora mismo: ' + e.message, true);
  }
}

async function copyBlockPrompt(noteEl) {
  setNote(noteEl, '', false);
  try {
    await copyText(await buildAiPrompt());
    setNote(noteEl, 'Prompt copiado — pégaselo a tu IA junto con tus objetivos', false);
  } catch (e) {
    setNote(noteEl, 'No se pudo copiar el prompt: ' + e.message, true);
  }
}


/* ---------- plan editor ----------
   Everything here edits a *draft* copy of the block; nothing reaches the
   real block (or the log) until "Guardar cambios". Structural edits are
   built so the logged sets survive them: exercises and days keep their
   ids when moved or renamed, dropping a set only hides the row, and
   removing something that has history retires it instead of deleting it.
   Erasing logged sets for good takes a second, explicit click in
   "Retirados". */
let peDraftBlock = null;
let peDraftPurge = [];
/* exId -> the session it lived in when the editor was opened. The real log
   is still filed under that session until "Guardar cambios", so anything
   that reads "how much history does this exercise have" while the sheet is
   open has to look there, not at wherever the draft has moved it to. */
let peDraftOriginalDay = {};


/* Logged-set counts for the editor: keyed off the exercise's original
   session (see peDraftOriginalDay) so a pending "send to another session"
   move doesn't make its history look gone before the draft is saved. */
function draftExLogged(profile, exId, currentDayId) {
  return loggedSets(profile, peDraftBlock.id, peDraftOriginalDay[exId] || currentDayId, exId);
}
function draftDayLogged(profile, day) {
  return day.ex.reduce((t, ex) => t + draftExLogged(profile, ex.id, day.id), 0);
}

/* Move an exercise to another session, keeping its id (and so its log)
   intact. The real log entries only move once the draft is saved — see
   the migration in peSave. */
function moveExToDay(ex, fromDay, toDay) {
  fromDay.ex.splice(fromDay.ex.indexOf(ex), 1);
  toDay.ex.push(ex);
}

/* The deload list only offers weeks the block actually has, so shortening a
   block cannot leave the deload pointing off the end of it. */
function renderDeloadOptions() {
  const weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(peDraftBlock));
  const sel = $('peDeload');
  const current = deloadWeek(peDraftBlock);
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '0';
  none.textContent = 'Sin descarga';
  sel.appendChild(none);
  for (let w = 1; w <= weeks; w++) {
    const o = document.createElement('option');
    o.value = String(w);
    o.textContent = 'Semana ' + w;
    sel.appendChild(o);
  }
  sel.value = String(current >= 1 && current <= weeks ? current : 0);
}


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

/* The priority muscles of this block, as chips you tap rather than a field
   you type into: the taxonomy is freeform, but the useful answers are the
   muscle names already in the plan, and a typo would silently mark nothing.
   A stored name whose exercises have since been retired still gets a chip,
   so it can be un-marked rather than being stuck in the block invisibly. */
function renderPriorityChips() {
  const host = $('pePriority');
  const tags = blockTagsFor('muscle', peDraftBlock).filter(t => t !== UNCLASSIFIED_LABEL);
  blockPriority(peDraftBlock).forEach(t => { if (tags.indexOf(t) < 0) tags.push(t); });
  tags.sort((a, b) => a.localeCompare(b, 'es'));

  host.innerHTML = '';
  tags.forEach(tag => {
    const on = isPriority(peDraftBlock, tag);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pri-chip' + (on ? ' on' : '');
    b.textContent = tag;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', tag + (on ? ' — prioritario, quitar' : ' — marcar como prioritario'));
    b.onclick = () => {
      const next = blockPriority(peDraftBlock).slice();
      const at = next.indexOf(tag);
      if (at >= 0) next.splice(at, 1); else next.push(tag);
      const clean = cleanPriority(next);
      if (clean.length) peDraftBlock.priority = clean; else delete peDraftBlock.priority;
      renderPriorityChips();
    };
    host.appendChild(b);
  });

  $('pePriorityHint').textContent = tags.length
    ? 'Los que marques se vigilan en "Volumen muscular → Todo el bloque": si un músculo prioritario se queda por debajo de la franja de 10–20 series por semana, lo avisa.'
    : 'Ningún ejercicio de este bloque tiene músculo asignado todavía. Ponles uno abajo y aparecerán aquí.';
}

function renderPlanEditor() {
  const host = $('peDays');
  const profile = getProfile();
  host.innerHTML = '';

  renderPriorityChips();

  const live = dayList(peDraftBlock);
  live.forEach((day, pos) => host.appendChild(buildDayBox(profile, day, pos, live.length)));

  const addDay = document.createElement('button');
  addDay.type = 'button';
  addDay.className = 'pe-add-ex';
  addDay.textContent = '+ Añadir día';
  addDay.onclick = () => {
    peDraftBlock.days.push({ id: uid('d'), name: 'Día ' + (live.length + 1), ex: [newExercise()] });
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

  const logged = draftDayLogged(profile, day);
  if (logged) box.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  box.querySelector('.pe-day-name').value = day.name;
  box.querySelector('.pe-day-name').oninput = e => { day.name = e.target.value; };
  box.querySelector('.pe-day-pair').value = day.pair || '';
  box.querySelector('.pe-day-pair').oninput = e => { day.pair = e.target.value; };

  const up = box.querySelector('.d-up'), down = box.querySelector('.d-down'), del = box.querySelector('.d-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(peDraftBlock.days, day, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(peDraftBlock.days, day, 1); renderPlanEditor(); };
  del.onclick = async () => {
    if (logged) {
      const okd = await ask({
        title: 'Retirar "' + day.name + '"',
        body: 'Tiene ' + setsLabel(logged) + ' en este bloque. Se retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.',
        okLabel: 'Retirar',
      });
      if (!okd) return;
      day.off = 1;
    } else {
      const okd = await ask({
        title: '¿Quitar "' + day.name + '" del bloque?',
        body: 'No tiene nada registrado.',
        okLabel: 'Quitar', danger: true,
      });
      if (!okd) return;
      peDraftBlock.days.splice(peDraftBlock.days.indexOf(day), 1);
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
  peDraftBlock.days.forEach(day => {
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
    const logged = isDay ? draftDayLogged(profile, it.day)
                         : draftExLogged(profile, it.ex.id, it.day.id);
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
    row.querySelector('.a-del').onclick = async () => {
      const what = isDay ? ('el día "' + it.day.name + '"') : ('"' + (it.ex.n || 'este ejercicio') + '"');
      const okd = await ask({
        title: logged ? '¿Borrar el registro para siempre?' : '¿Borrar del bloque?',
        body: logged
          ? 'Se borra ' + what + ' y sus ' + setsLabel(logged) + '. No se puede deshacer.'
          : 'Se borra ' + what + '. No tiene nada registrado.',
        okLabel: 'Borrar', danger: true,
      });
      if (!okd) return;
      if (isDay) {
        peDraftBlock.days.splice(peDraftBlock.days.indexOf(it.day), 1);
        peDraftPurge.push({ dayId: it.day.id });
      } else {
        it.day.ex.splice(it.day.ex.indexOf(it.ex), 1);
        peDraftPurge.push({ dayId: it.day.id, exId: it.ex.id });
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
        '<select class="pe-move-sel" title="Enviar a otra sesión"></select>' +
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
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Ajustes de máquina (asiento, respaldo…)</span><input type="text" class="f-setup" maxlength="' + SETUP_LIMIT + '"></div></div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">Series</span><input type="number" min="1" class="f-sets"></div>' +
      '<div style="flex:1;min-width:70px;"><span class="pe-field-lbl">Reps</span><input type="text" class="f-reps"></div>' +
      '<div><span class="pe-field-lbl">Descanso (s)</span><input type="number" min="0" step="5" class="f-rest"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="8" class="f-add"></div>' +
      '<div><span class="pe-field-lbl">Incremento de peso (' + esc(units()) + ')</span><input type="number" min="' + INC_MIN + '" max="' + INC_MAX + '" step="' + INC_STEP + '" class="f-inc"></div>' +
    '</div>' +
    '<div class="pe-row"><div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Músculo</span>' +
      '<input type="text" class="f-muscle" list="muscleSuggestions" placeholder="Sin clasificar" maxlength="' + MUSCLE_LIMIT + '"></div></div>' +
    '<div class="pe-row">' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Patrón</span>' +
        '<input type="text" class="f-pattern" list="patternSuggestions" placeholder="Sin clasificar" maxlength="' + PATTERN_LIMIT + '"></div>' +
      '<div style="flex:1;min-width:140px;"><span class="pe-field-lbl">Tipo</span>' +
        '<input type="text" class="f-type" list="typeSuggestions" placeholder="Sin clasificar" maxlength="' + TYPE_LIMIT + '"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<label class="pe-check pe-check-share"><input type="checkbox" class="f-share"> Compartido (JUNTOS)</label>' +
      '<label class="pe-check"><input type="checkbox" class="f-ss"> Superserie (SS)</label>' +
    '</div>';

  row.querySelector('.f-n').value = ex.n;
  row.querySelector('.f-n').oninput = e => ex.n = e.target.value;
  row.querySelector('.f-alt').value = ex.alt || '';
  row.querySelector('.f-alt').oninput = e => ex.alt = e.target.value;
  row.querySelector('.f-cue').value = ex.cue || '';
  row.querySelector('.f-cue').oninput = e => ex.cue = e.target.value;
  row.querySelector('.f-setup').value = ex.setup || '';
  row.querySelector('.f-setup').oninput = e => { const v = e.target.value; if (v) ex.setup = v; else delete ex.setup; };
  row.querySelector('.f-sets').value = ex.sets;
  row.querySelector('.f-sets').oninput = e => ex.sets = parseInt(e.target.value, 10) || 1;
  row.querySelector('.f-reps').value = ex.reps;
  row.querySelector('.f-reps').oninput = e => ex.reps = e.target.value;
  row.querySelector('.f-rest').value = ex.rest || 0;
  row.querySelector('.f-rest').oninput = e => ex.rest = parseInt(e.target.value, 10) || 0;
  row.querySelector('.f-add').value = ex.add || '';
  row.querySelector('.f-add').oninput = e => { const v = parseInt(e.target.value, 10); if (v) ex.add = v; else delete ex.add; };
  row.querySelector('.f-inc').value = ex.inc || '';
  /* Decimals, not just integers — clampNum is what makes that safe: 2.3 kg
     is a real plate increment, not a typo to round away like clampInt would
     (see the "add" import guard below for the bug that taught us that). */
  row.querySelector('.f-inc').oninput = e => {
    const v = e.target.value;
    if (v === '') { delete ex.inc; return; }
    ex.inc = clampNum(v, INC_MIN, INC_MAX, INC_MIN, INC_STEP);
  };
  row.querySelector('.f-muscle').value = ex.muscle || '';
  /* Freeform text with a suggestion list (see the shared #muscleSuggestions
     datalist), not a fixed set — type any tag, or clear it to fall back to
     "Sin clasificar". An empty/whitespace value is never stored, the same
     convention share/ss use for their default state. */
  row.querySelector('.f-muscle').oninput = e => { const v = e.target.value.trim(); if (v) ex.muscle = v; else delete ex.muscle; };
  row.querySelector('.f-pattern').value = ex.pattern || '';
  row.querySelector('.f-pattern').oninput = e => { const v = e.target.value.trim(); if (v) ex.pattern = v; else delete ex.pattern; };
  row.querySelector('.f-type').value = ex.type || '';
  row.querySelector('.f-type').oninput = e => { const v = e.target.value.trim(); if (v) ex.type = v; else delete ex.type; };
  row.querySelector('.f-share').checked = !!ex.share;
  row.querySelector('.f-share').onchange = e => { if (e.target.checked) ex.share = 1; else delete ex.share; };
  row.querySelector('.f-ss').checked = !!ex.ss;
  row.querySelector('.f-ss').onchange = e => { if (e.target.checked) ex.ss = 1; else delete ex.ss; };

  const logged = draftExLogged(profile, ex.id, day.id);
  if (logged) row.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  const moveSel = row.querySelector('.pe-move-sel');
  const otherDays = dayList(peDraftBlock).filter(d => d !== day);
  if (otherDays.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Enviar a…';
    moveSel.appendChild(placeholder);
    otherDays.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      moveSel.appendChild(o);
    });
    moveSel.onchange = () => {
      const target = otherDays.find(d => d.id === moveSel.value);
      if (!target) return;
      moveExToDay(ex, day, target);
      renderPlanEditor();
      mark('"' + (ex.n || 'Ejercicio') + '" enviado a ' + target.name + ' — el registro se conserva');
    };
  } else {
    moveSel.style.display = 'none';
  }

  const up = row.querySelector('.e-up'), down = row.querySelector('.e-down'), del = row.querySelector('.e-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(day.ex, ex, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(day.ex, ex, 1); renderPlanEditor(); };
  del.onclick = async () => {
    if (logged) {
      const okd = await ask({
        title: 'Retirar "' + (ex.n || 'este ejercicio') + '"',
        body: 'Tiene ' + setsLabel(logged) + ' en este bloque. Se retira del plan y deja de aparecer en la sesión, pero su registro se conserva y puedes devolverlo desde "Retirados", al final de esta pantalla.',
        okLabel: 'Retirar',
      });
      if (!okd) return;
      ex.off = 1;
    } else {
      day.ex.splice(day.ex.indexOf(ex), 1);
    }
    renderPlanEditor();
  };

  return row;
}

/* Pulls the form fields (name/weeks/deload) into peDraftBlock, regenerates
   the phase banner for whatever weeks that leaves it with, and defaults
   blank day names — the same shape-up that used to live inline in
   "Guardar cambios". Shared with the export button below: exporting reads
   peDraftBlock too, so it needs to see the fields as currently typed, not as
   they were when the sheet was opened, and shouldn't ship a plan missing a
   name or a set of reps any more than a save should write one. Returns an
   error message, or null once peDraftBlock is ready to use. */
function syncDraftFromForm() {
  peDraftBlock.name = $('peBlockName').value.trim() || peDraftBlock.name;
  peDraftBlock.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(peDraftBlock));
  peDraftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  if (peDraftBlock.deload > peDraftBlock.weeks) peDraftBlock.deload = 0;
  /* Weeks the block has grown into need a goal to show in the banner, and
     the deload week may have moved; anything you wrote yourself is kept. */
  const phase = peDraftBlock.phase && typeof peDraftBlock.phase === 'object' ? peDraftBlock.phase : {};
  const generic = genericPhase(peDraftBlock.weeks, peDraftBlock.deload);
  const nextPhase = {};
  for (let w = 1; w <= peDraftBlock.weeks; w++) {
    const mine = phase[w] || phase[String(w)];
    const isDeload = w === peDraftBlock.deload;
    const wasDeload = mine && mine.r === DELOAD_PHASE.r;
    nextPhase[w] = (mine && mine.r && mine.t && isDeload === wasDeload) ? mine : generic[w];
  }
  peDraftBlock.phase = nextPhase;
  const days = dayList(peDraftBlock);
  if (!days.length) return 'El bloque necesita al menos un día.';
  days.forEach((day, i) => { if (!String(day.name || '').trim()) day.name = 'Día ' + (i + 1); });
  for (const day of days) {
    const ex = exList(day);
    if (!ex.length) return 'Cada día necesita al menos un ejercicio — revisa "' + day.name + '".';
    for (const e of ex) {
      if (!String(e.n || '').trim()) return 'Todos los ejercicios necesitan un nombre.';
      if (!e.reps || !String(e.reps).trim()) return 'Falta el rango de repeticiones en "' + (e.n || 'un ejercicio') + '".';
    }
  }
  return null;
}


/* Same shape as the "block" QR payload and the repo's blocks/*.json
   templates — no ids, no log, retired days/exercises left out — so the
   file downloaded here can be pasted straight into "Importar JSON" on any
   device, or committed to blocks/ as a new template. Reads the draft as it
   stands, unsaved edits included, so you don't have to "Guardar cambios"
   first just to pull a template out of a block you're reshaping — it goes
   through the same field-sync and validation "Guardar cambios" does, so
   what you export is never missing a name or a rep range either. */

function closePlanEditor() {
  closeSheet('planSheet');
  peDraftBlock = null;
  peDraftPurge = [];
  peDraftOriginalDay = {};
}


function wireBlockEditor() {
  $('blkKeepCurrent').onclick = async () => {
    const profile = getProfile();
    const others = profile.blockOrder.filter(id => id !== profile.activeBlock);
    if (!others.length) { await tell('Nada que eliminar', '"' + getBlock().name + '" ya es el único bloque de ' + profile.label + '.'); return; }
    const sets = others.reduce((t, id) => t + blockLoggedSets(profile, id), 0);
    const names = others.map(id => '· ' + blockPickerLabel(profile, id)).join('\n');
    const okd = await ask({
      title: '¿Eliminar los otros ' + others.length + ' bloques de ' + profile.label + '?',
      body: names + '\n\n' +
        (sets ? 'Se borran ' + setsLabel(sets) + ' en total. ' : 'No tienen nada registrado. ') +
        '"' + getBlock().name + '" y todo su registro se quedan como están. No se puede deshacer.',
      okLabel: 'Eliminar', danger: true,
    });
    if (!okd) return;
    const n = deleteBlocks(profile, others);
    renderBlockManager();
    mark(n + (n === 1 ? ' bloque eliminado' : ' bloques eliminados') + ' — el bloque actual intacto');
  };

  $('blkClose').onclick = () => closeSheet('blocksSheet');

  $('blocksSheet').addEventListener('click', e => { if (e.target.id === 'blocksSheet') closeSheet('blocksSheet'); });

  $('importFromText').onclick = () => {
    setNote($('importError'), '', false);
    let raw;
    try { raw = JSON.parse($('importBlob').value); } catch (e) { setNote($('importError'), 'Eso no es JSON válido.', true); return; }
    applyImportedBlock(raw, 'texto pegado');
  };

  $('importClose').onclick = () => closeSheet('importSheet');

  $('importSheet').addEventListener('click', e => { if (e.target.id === 'importSheet') closeSheet('importSheet'); });

  $('importDownloadTemplate').onclick = () => downloadBlockTemplate($('importError'));

  $('importCopyPrompt').onclick = () => copyBlockPrompt($('importError'));

  $('setupDownloadTemplate').onclick = () => downloadBlockTemplate($('setupImportStatus'));

  $('setupCopyPrompt').onclick = () => copyBlockPrompt($('setupImportStatus'));

  $('editPlan').onclick = () => {
    peDraftBlock = JSON.parse(JSON.stringify(getBlock()));
    peDraftPurge = [];
    peDraftOriginalDay = {};
    peDraftBlock.days.forEach(day => day.ex.forEach(ex => { peDraftOriginalDay[ex.id] = day.id; }));
    $('peBlockName').value = peDraftBlock.name;
    $('peWeeks').value = blockWeeks(peDraftBlock);
    renderDeloadOptions();
    renderPlanEditor();
    openSheet('planSheet');
  };

  $('peWeeks').oninput = () => {
    peDraftBlock.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, 8);
    if (deloadWeek(peDraftBlock) > peDraftBlock.weeks) peDraftBlock.deload = 0;
    renderDeloadOptions();
    peDraftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
    renderPlanEditor();
  };

  $('peDeload').onchange = () => {
    peDraftBlock.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
    renderPlanEditor();
  };

  $('peSave').onclick = async () => {
    const problem = syncDraftFromForm();
    if (problem) { await tell('Falta algo', problem); return; }
    const profile = getProfile();
    /* Catch the real log up on any "enviar a…" moves made while the sheet was
       open, before anything below reads or purges it by session id. */
    peDraftBlock.days.forEach(day => {
      day.ex.forEach(ex => {
        const from = peDraftOriginalDay[ex.id];
        if (from && from !== day.id) moveExLog(profile, peDraftBlock.id, from, day.id, ex.id);
      });
    });
    /* The only path that erases logged sets, and only the ones explicitly
       confirmed in "Retirados". */
    peDraftPurge.forEach(p => {
      if (p.exId) purgeExLog(profile, peDraftBlock.id, p.dayId, p.exId);
      else purgeDayLog(profile, peDraftBlock.id, p.dayId);
    });
    profile.blocks[peDraftBlock.id] = peDraftBlock;
    peDraftBlock = null; peDraftPurge = []; peDraftOriginalDay = {};
    save(); render();
    closeSheet('planSheet');
    mark('Plan actualizado — el registro se mantiene');
  };

  $('peExport').onclick = async () => {
    const problem = syncDraftFromForm();
    if (problem) { await tell('Falta algo', problem); return; }
    renderPlanEditor();
    const plan = blockSharePlan(peDraftBlock);
    const name = 'heavy-iron-plan-' + (slugify(peDraftBlock.name) || 'bloque') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    downloadFile(name, JSON.stringify(plan, null, 2), 'application/json');
    mark('Plan descargado — sin registro, listo para "Importar JSON" en otro sitio');
  };

  $('peClose').onclick = closePlanEditor;

  $('planSheet').addEventListener('click', e => { if (e.target.id === 'planSheet') closePlanEditor(); });

  $('peDeleteBlock').onclick = async () => {
    const profile = getProfile();
    if (profile.blockOrder.length <= 1) { await tell('No se puede', 'No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
    const id = peDraftBlock.id;
    const sets = blockLoggedSets(profile, id);
    const okd = await ask({
      title: '¿Eliminar "' + peDraftBlock.name + '"?',
      body: (sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ') +
        'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede. No se puede deshacer.',
      okLabel: 'Eliminar', danger: true,
    });
    if (!okd) return;
    closePlanEditor();
    deleteBlocks(profile, [id]);
    mark('Bloque eliminado');
  };
}
