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

/* The picker and nothing else. The four buttons this used to build on every
   render — "+ Nuevo bloque", "Revisión", "Importar JSON", "Gestionar" — are
   markup now, three in the bar's "Plan" hub and the review in "Progreso",
   with ids of their own and handlers bound once in wireBlockEditor and
   wireReview (plans/037). */
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
  /* Same reasoning as the profile switcher: choosing is the whole errand, so
     the sheet closes behind the choice (plans/034). */
  select.onchange = () => {
    closeSheet('blockSheet');
    profile.activeBlock = select.value; profile.week = 1; profile.day = 0;
    commit('view');
  };
  host.appendChild(select);

  /* The header chip is this picker's face. Read off the option the browser
     actually has selected rather than blockPickerLabel(activeBlock): a
     profile pointing at a block that is not in blockOrder selects the first
     option instead, and the chip has to say what the picker says. */
  /* Guarded, and guarded around the chip alone rather than by returning
     early: #blockBtn arrived with plans/037's bar, years after this file in
     shell terms, so a precache hole can serve this copy against an
     index.html that has no chip. Unguarded, the throw lands inside drawApp
     on every draw, render catches it, and a user whose data is perfectly
     intact gets the recovery screen — which js/boot-guard.js deliberately
     does not rescue. The picker itself still renders (AGENTS.md's
     precache-hole rule, which reads the same on ids as on symbols). */
  const chip = $('blockBtn');
  if (chip) {
    const label = (select.selectedOptions && select.selectedOptions[0] && select.selectedOptions[0].textContent) || 'Bloque';
    chip.innerHTML = '<span class="chip-lbl"></span><span class="chev" aria-hidden="true">▾</span>';
    chip.querySelector('.chip-lbl').textContent = label;
    chip.setAttribute('aria-label', 'Bloque: ' + label + '. Cambiar');
  }
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

  /* The log is not the only thing filed under a block id: every part of
     the profile's record keyed by slot is too, and nothing reads one
     without the block it belonged to. Leaving them behind grows the record
     forever with data no screen can ever show — on a storage backend the
     browser may evict when the phone fills up. purgeRecord drops them all;
     the variants stay, and their entry in RECORD_PARTS says why. */
  drop.forEach(id => {
    delete profile.blocks[id];
    purgeRecord(profile, id);
  });
  profile.blockOrder = keep;
  if (drop.has(profile.activeBlock)) {
    profile.activeBlock = keep[keep.length - 1];
    profile.week = 1; profile.day = 0;
  }
  commit();
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
        body: cost + rest + ' ' + UNDO_PROMISE,
        okLabel: 'Eliminar', danger: true,
      });
      if (!okd) return;
      deleteBlocks(profile, [id]);
      renderBlockManager();
      /* deleteBlocks() → render() rebuilds #blockbar, and the line above
         rebuilds #blockList — both can remove the button this handler is
         running on (the one that had focus), and a browser resolves that by
         dropping focus to <body> with no way back. The sheet stays open, so
         put focus back inside it — the same place openSheet puts it when the
         sheet is first opened — rather than stranding it on the page root. */
      if (document.activeElement === document.body) {
        const box = $('blocksSheet').querySelector('.sheet-box');
        if (box) box.focus();
      }
      mark('Bloque eliminado');
    };

    host.appendChild(row);
  });
}

/* The ceiling every road that adds a block stops at: "+ Nuevo bloque",
   an "Importar JSON" paste or a blocks/ pick (applyImportedBlock), a QR
   block (applyQrPayload), the review's JSON take-back (wireReview), and
   installImportedBlock under the last three. It is PROFILE_LIMITS.blocks,
   counted the way normalizeImportedProfile counts: every block the
   profile has. None of these used to stop. Each pasted attempt at an
   AI-written block is a block of its own, so iterating on one could take a
   profile past forty quickly, and its own backup then answered "tiene 41
   bloques: el máximo es 40" — plans/010's promise broken. Stopping here
   keeps every profile the app grows inside what a restore takes back; one
   that grew past it before this existed still trains and still restores
   (OWN_LIMITS, js/app.js), it just cannot grow until some go.

   Returns the reason, in the words each of those screens shows, or ''
   while there is room. It sends people to "Gestionar bloques" because that
   is where room is made, and the attempts that never became the plan are
   listed there as "sin registro": deleting one costs no set. */
function blocksFullNote(profile) {
  const n = Object.keys(profile.blocks).length;
  if (n < PROFILE_LIMITS.blocks) return '';
  return profile.label + ' ya tiene ' + n + ' bloques; el máximo es ' + PROFILE_LIMITS.blocks +
    '. Para añadir otro, entra en "Gestionar bloques" (en Plan) y borra alguno que ya no uses.';
}

async function newBlock(skipReview) {
  const profile = getProfile();
  const current = getBlock();
  /* First, before the review is offered or a name asked for: neither is
     worth anybody's time when the block cannot be made. The button goes
     where room is made. */
  const full = blocksFullNote(profile);
  if (full) {
    if (await ask({ title: 'No caben más bloques', body: full, okLabel: 'Gestionar bloques', cancelLabel: 'Cerrar' })) openBlockManager();
    return;
  }
  /* The moment the last block is worth reading is the moment you start the
     next one — which is exactly when the app used to say nothing at all.
     Asked before the name, so choosing to read it costs nothing you have
     already typed, and the flow picks up where it left off when the review
     closes rather than dead-ending on a sheet. Offered, never forced.

     And offered only when js/review.js is on the page. It was split out
     after the licence this file has (AGENTS.md), so a precache hole can
     leave this file without it, and "Ver la revisión" then threw a
     ReferenceError out of this function and the block was never made.
     Without the review there is nothing to ask: this goes straight on to
     the name, as newBlock(true) does. */
  const doneSets = blockDoneSets(profile, current.id);
  if (!skipReview && doneSets > 0 && typeof openReview === 'function') {
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
  commit();
  mark('Bloque creado a partir de "' + current.name + '" — edítalo con "Editar plan"');
}

/* ---------- import block from JSON ----------
   Lets an external agent (or you, by hand) hand over a block as plain
   JSON — either pasted in, or committed to blocks/ in this repo and
   picked from the list, fetched read-only, same-origin, relative to the
   page (see blocksBase() in app.js) — no token, no write access. See
   README for the expected JSON shape.
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
function normalizeImportedBlock(raw, opts) {
  /* `own` is set by normalizeImportedProfile, for data this app itself
     wrote (a backup, a profile file, a QR "perfil"). A pasted or shared
     block stays strict — reject a nameless exercise, drop retired items —
     but the app must be able to read back anything it has ever saved:
     emptyBlock() ships one blank exercise on purpose, `off` is how a user
     retires an exercise without losing its history, and migrate() lets one
     id live on two days by design. Rejecting or rewriting any of those on
     restore turned the backup into a file that could not be restored
     (plans/010). */
  const own = !!(opts && opts.own);
  /* The two counts, retired items included on both paths. A paste is held
     to what the editor itself allows; own data gets the headroom OWN_LIMITS
     explains, because a block the editor let grow past that before it knew
     better is still somebody's real history, and "Demasiados días (15)" on
     the app's own backup was the bug. */
  const most = own ? OWN_LIMITS : IMPORT_LIMITS;
  /* The same headroom for the text the plan editor never capped: the
     block's name, and each day's name and pair note here, and an
     exercise's text through its EX_FIELDS entry. OWN_TEXT_LIMIT says why a
     restore takes more than a paste. */
  const text = (v, max) => txt(v, own ? OWN_TEXT_LIMIT : max);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El JSON no es un objeto válido.');
  const name = text(raw.name, IMPORT_LIMITS.name) || 'Bloque importado';
  /* Both optional: a block that says nothing is the eight-week, deload-on-8
     shape every block had before length was configurable. */
  const weeks = clampInt(raw.weeks, 1, MAX_WEEKS, 8);
  let deload = raw.deload == null ? (weeks === 8 ? 8 : 0) : clampInt(raw.deload, 0, MAX_WEEKS, 0);
  if (deload > weeks) deload = 0;
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error('Falta "days" (al menos un día de entrenamiento).');
  if (raw.days.length > most.days) throw new Error('Demasiados días (' + raw.days.length + '): el máximo es ' + most.days + '.');

  const usedIds = new Set();
  const usedDayIds = new Set();
  const days = raw.days.map((day, di) => {
    if (!day || typeof day !== 'object') throw new Error('El día ' + (di + 1) + ' no es válido.');
    const dayName = text(day.name, IMPORT_LIMITS.name) || ('Día ' + (di + 1));
    if (!Array.isArray(day.ex) || !day.ex.length) throw new Error('El día "' + dayName + '" necesita al menos un ejercicio.');
    if (day.ex.length > most.ex) throw new Error('El día "' + dayName + '" tiene ' + day.ex.length + ' ejercicios: el máximo es ' + most.ex + '.');
    /* Ids are unique per block for a paste and per day for own data: two
       days sharing one id is how the app records the same lift twice a
       week (migrate() dedupes within a day only, on purpose), so renaming
       the second one on restore moved a day's history onto an exercise
       nobody trained. A pasted block keeps the block-wide rule — see
       docs/guide.md#the-same-lift-on-two-days for what it means there. */
    const dayIds = own ? new Set() : usedIds;
    const ex = day.ex.map((e, ei) => {
      if (!e || typeof e !== 'object') throw new Error('Un ejercicio del día "' + dayName + '" no es válido.');
      /* Named rather than rejected on the own path: the blank exercise
         emptyBlock() ships is a real thing the app saves, and a backup the
         app cannot read back is not a backup. */
      const n = exField('n').accept(e.n, { own }) || (own ? 'Ejercicio ' + (ei + 1) : '');
      if (!n) throw new Error('Falta el nombre de un ejercicio en "' + dayName + '".');
      /* Before the id, as always: a paste without a rep range is refused
         next, naming the exercise, and own data gets the default. */
      const reps = exField('reps').accept(e.reps, { own, n });
      /* safeKey on the slug too, not just on the stated id: a name can slug
         straight to a reserved word — "Constructor" to `constructor` — and
         an id safeKey refuses is one recordVariant and the import's
         variants block silently drop, so that lift could never carry a
         rename cut.

         One cap for an id from outside, stated or slugged: a paste used to
         cut a stated id at 60 but keep a slug as long as the name made it,
         and a restore then cut every stored id at 60 — so two long names
         sharing their first sixty slug characters, on two days, came back
         from the first restore as one id, and the own path's one-id-on-two-
         days rule merged two different lifts' histories without a word
         (plans/063). Now a paste caps both at 60, and the block-wide
         de-duplication below gives any collision a visible "-2" at import
         time. Own data is the app's ids coming back, so a stored id keeps
         its length up to OWN_TEXT_LIMIT, the most any writer could have
         slugged it from; a slug is only made there when the id is missing. */
      const idCap = own ? OWN_TEXT_LIMIT : 60;
      const capSlug = s => s.slice(0, 60).replace(/-+$/, '');
      const baseId = safeKey(txt(e.id, idCap)) || safeKey(capSlug(slugify(n))) || ('ex-' + di + '-' + ei);
      let uniqueId = baseId, suffix = 2;
      while (dayIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
      dayIds.add(uniqueId);
      /* Every other field by its own entry in EX_FIELDS (js/app.js): what
         each one keeps, on which path, and whether it refuses the block —
         `add` does, rather than round a program under someone's feet. */
      return acceptExercise(e, { id: uniqueId, n, reps }, { own, weeks, n });
    });
    let dayId = safeKey(txt(day.id, 60));
    while (!dayId || usedDayIds.has(dayId)) dayId = uid('d');
    usedDayIds.add(dayId);
    const out = { id: dayId, name: dayName, ex };
    if (day.pair) out.pair = text(day.pair, IMPORT_LIMITS.pair);
    /* Same rule as an exercise's `off` (EX_FIELDS). */
    if (own && day.off) out.off = 1;
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
    /* Cloned, not referenced: the first-run setup handler installs the same
       normalized plan on both profiles by calling this once per profile,
       and a shared `days` made an inline machine-setting edit on one
       person's card write into the other's plan until the next reload
       broke the aliasing (plans/012). `freshBlock` in js/data.js already
       clones for the same reason; `priority` below is copied too. */
    days: JSON.parse(JSON.stringify(normalized.days)),
    phase: JSON.parse(JSON.stringify(normalized.phase)),
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
  /* Every caller turns a full profile away first, where its own screen can
     say so (blocksFullNote). This is the ceiling itself: a road added later
     that forgets to ask fails loudly here, rather than growing a profile
     past what its own backup restores. */
  const full = blocksFullNote(profile);
  if (full) throw new Error(full);
  const block = blockFromNormalized(normalized);
  profile.blocks[block.id] = block;
  profile.blockOrder.push(block.id);
  profile.activeBlock = block.id;
  profile.week = 1; profile.day = 0;
  installBlockData(profile, block.id, { log: log, rir: rir, order: order });
  commit();
  return block.id;
}

function applyImportedBlock(raw, sourceLabel) {
  /* Before the block is read at all: no fix to it would make room. */
  const full = blocksFullNote(getProfile());
  if (full) { setNote($('importError'), full, true); return; }
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
      if (!item || typeof item !== 'object' || typeof item.file !== 'string') return;
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


/* "la semana 4" for one deload week, "las semanas 4 y 8" for two, "las
   semanas 4, 6 y 8" for more — deloadWeeks (js/app.js) can now return more
   than the field's single week, and the prompt has to name all of them or
   the AI it is briefing writes the next block blind to the others. */
function weeksPhrase(weeks) {
  if (weeks.length === 1) return 'la semana ' + weeks[0];
  return 'las semanas ' + weeks.slice(0, -1).join(', ') + ' y ' + weeks[weeks.length - 1];
}

/* Builds a self-contained prompt for a third party's AI agent, describing
   the block JSON shape from the same limits the importer itself enforces
   (IMPORT_LIMITS, MAX_WEEKS, and for an exercise each field's own line in
   EX_FIELDS) so it can't quietly drift out of sync with what
   normalizeImportedBlock actually accepts. The worked
   example is fetched from blocks/ejemplo-plantilla.json — the same file the
   download button offers — rather than duplicated inline, for the same
   reason. Works with no network too: the example is just left out. Once the
   app is set up, the user's own block replaces the shipped example, so the
   AI sees the material, the names and the ids it is meant to keep. */
async function buildAiPrompt(opts) {
  const withBlock = !!(opts && opts.withBlock);
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
    /* One line per field, from its entry: the prompt says what the
       importer takes because both read the same table. */
    ...EX_PROMPT_ORDER.map((key, i) => '          "' + key + '": ' + exField(key).prompt() +
      (i < EX_PROMPT_ORDER.length - 1 ? ',' : '')),
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "priority": [ // opcional — músculos prioritarios del bloque, con los mismos nombres que uses en "muscle" (máx ' + PRIORITY_MAX + ')',
    '    "Pecho", "Hombro"',
    '  ],',
    '  "phase": { // opcional — objetivo de cada semana, clave = número de semana',
    '    "1": { "r": string corto, p.ej. RIR objetivo (máx ' + L.phaseR + ' car.), "t": texto del objetivo de esa semana (máx ' + L.phaseT + ' car.) }',
    '    // cada semana lleva "r" y "t" juntos: una semana con solo uno de los dos se sustituye por el objetivo genérico de la app',
    '  }',
    '}',
  ];

  let example = '';
  /* The shipped example is for a device with nothing of its own yet. Once
     the app is set up the user's own block is the example — it is what the
     AI is being asked to write the next version of, and it carries the
     machines, the names and the ids the reply should keep. */
  if (!withBlock) {
    try {
      const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
      if (r.ok) example = JSON.stringify(JSON.parse(await r.text()));
    } catch (e) { /* offline: the prompt still works without the embedded example */ }
    if (example) lines.push('', 'Ejemplo de referencia (formato válido, contenido de muestra):', example);
  }

  if (withBlock) {
    const block = getBlock();
    const days = dayList(block);
    const dls = deloadWeeks(block);
    const priority = blockPriority(block);
    const p = state.prefs;
    const ctx = [
      'Entreno ' + (soloMode() ? 'solo' : 'en pareja') + '.',
      'Peso en ' + units() + '. Incremento por defecto: ' + p.inc + ' ' + units() + '. Barra: ' + p.barWeight + ' ' + units() + '. Discos por lado: ' + p.plates.join(', ') + '.',
      'Mi bloque actual, ' + reviewName(block.name) + ', tiene ' + days.length + (days.length === 1 ? ' día' : ' días') + ' por semana y ' +
        blockWeeks(block) + ' semanas' + (dls.length ? ', con descarga en ' + weeksPhrase(dls) : ', sin descarga') + '.',
      priority.length ? 'Músculos prioritarios: ' + priority.map(reviewName).join(', ') + '.' : '',
    ].filter(Boolean).join(' ');
    lines.push(
      '',
      'Ahora genera el bloque siguiente para mí. Lo que la app ya sabe: ' + ctx,
      'Lo que no sé decirte desde la app: [tu nivel, tus objetivos para este bloque, y cualquier cambio de material, de días o de semanas].',
      '',
      'Mi bloque actual (JSON, en el mismo formato — es mi material, mis nombres y mis ids; conserva lo que mantengas y cambia lo que haga falta):',
      JSON.stringify(blockSharePlan(block)),
    );
  } else {
    lines.push(
      '',
      'Ahora genera un bloque para mí según mis objetivos. Mi contexto: [tu nivel, cuántos días a la semana, material del gimnasio disponible, qué músculos priorizar, si entrenas solo o en pareja, y cuántas semanas quieres el bloque].',
    );
  }
  lines.push('', 'Responde solo con el JSON.');
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

async function copyBlockPrompt(noteEl, opts) {
  setNote(noteEl, '', false);
  try {
    await copyText(await buildAiPrompt(opts));
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

/* The plan draft (CONTEXT.md) while the sheet is open, null otherwise:
   one object from openPlanDraft, where it used to be three globals that
   "Editar plan", closing the sheet and the end of "Guardar cambios" each
   reset by hand. */
let peDraft = null;

/* "Editar plan". The draft is a deep copy of the block, plus what saving
   it needs to know and the copy cannot say for itself:

   `startDay`: draft exercise object -> the session it lived in when the
   editor was opened. The real log is still filed under that session until
   "Guardar cambios", so anything that reads "how much history does this
   exercise have" while the sheet is open has to look there, not at
   wherever the draft has moved it to.

   Keyed by object identity, not by exercise id: a block can carry the same
   id on two days on purpose (migrate() allows it, see test/unit.js "the
   same id on two different days survives, by design"), and an id-only map
   only remembers one of them, so "Guardar cambios" would move the other
   day's log on top of it even though nothing was sent anywhere. Sending an
   exercise between draft days keeps the same object (moveExToDay splices
   and pushes, never clones), so identity survives the move.

   `erased`: what "Borrar registro" confirmed, as eraseFromDraft records it.

   `profile`: the profile object the draft was cut from. Another tab's
   write is adopted by replacing the profile objects (the 'storage' handler
   in js/app.js), so a draft saved into whatever is there now would write a
   plan read from the old data over the new one. applyPlanDraft refuses. */
function openPlanDraft(profile, block) {
  const copy = JSON.parse(JSON.stringify(block));
  const startDay = new Map();
  copy.days.forEach(day => day.ex.forEach(ex => { startDay.set(ex, day.id); }));
  return { block: copy, startDay: startDay, erased: [], profile: profile };
}

/* The one question "Guardar cambios" asks before anything else: is the
   profile being saved into still the one this draft was cut from? */
function planDraftStale(profile, draft) {
  return profile !== draft.profile;
}

/* Logged-set counts for the editor: keyed off the exercise's original
   session (openPlanDraft's startDay) so a pending "send to another session"
   move doesn't make its history look gone before the draft is saved. */
function draftExLogged(profile, ex, currentDayId) {
  return loggedSets(profile, peDraft.block.id, peDraft.startDay.get(ex) || currentDayId, ex.id);
}
function draftDayLogged(profile, day) {
  return day.ex.reduce((t, ex) => t + draftExLogged(profile, ex, day.id), 0);
}

/* Move an exercise to another session, keeping its id (and so its log)
   intact. The real log entries only move once the draft is saved — see
   the catch-up in applyPlanDraft. "Enviar a…" asks moveExRefusal first. */
function moveExToDay(ex, fromDay, toDay) {
  fromDay.ex.splice(fromDay.ex.indexOf(ex), 1);
  toDay.ex.push(ex);
}

/* Why "Enviar a…" will not put `ex` on `day`, as the words its option
   shows after the day's name, or '' when it will.

   A day holds an id once. One lift on two days shares its id on purpose,
   but the record is filed by slot and id, so two copies on one day are
   one record. While this road was open, the save folded the sent copy's
   sets into the other copy's sessions, two a week becoming one, and the
   next load's migrate() gave the second copy a new id, and so no history
   (plans/053's follow-up).

   Refused, not repaired, because two copies of one lift on one day is
   almost never what was meant, and neither repair keeps the record true.
   Merging them into one row still folds two sessions a week into one and
   keeps only one copy's plan. A fresh id for the sent copy keeps the
   second row nobody wanted, and splits one lift's history, objetivo and
   variants across two ids. What was meant is one step away: "Quitar" on
   the copy being sent, if only the other day should have the lift (its
   sets stay filed and still count for it), or "Borrar registro" on the
   other copy, if this one should take its place.

   A retired copy counts: it is still in the day, migrate() renames beside
   it all the same, and "Restaurar" would put both in the session. An
   erased one does not. It has left the draft, and applyPlanDraft purges
   its sets before any move lands, so the copy sent after it arrives on
   clean slots and the save still erases what the dialog counted
   (plans/053).

   A full day takes no more by this road either: a move is an exercise
   added to the day it lands on, past the ceiling its own "+ Añadir
   ejercicio" keeps (planFullNote). The id is asked first, since making
   room would not change that answer. */
function moveExRefusal(ex, day) {
  const twin = day.ex.find(e => e.id === ex.id);
  if (twin) return twin.off ? 'lo tiene retirado' : 'ya lo tiene';
  return dayFullNote(day) ? 'completo' : '';
}

/* A confirmed erase in "Retirados": the item leaves the draft for good,
   and what is recorded is what the dialog counted — the exercise object,
   or the day object with the exercises it held at that moment. It used to
   be the day's id, which is where the item sat in the draft; after an
   "Enviar a…" that is not where its sets sit, and the save purged a day
   holding none of them (plans/053). */
function eraseFromDraft(draft, it) {
  if (it.ex) {
    it.day.ex.splice(it.day.ex.indexOf(it.ex), 1);
    draft.erased.push({ ex: it.ex });
  } else {
    draft.block.days.splice(draft.block.days.indexOf(it.day), 1);
    draft.erased.push({ day: it.day, held: it.day.ex.slice() });
  }
}

/* `n` day ids for applyPlanDraft to lift moved exercises through: ones no
   part of this block's record is filed under, and that no day of the
   draft has, started with or erased. A day id is whatever string a backup
   carried, bar the few safeKey refuses, so no name is spare on its own.
   A record lifted onto a day the record already uses would be merged
   into the sessions filed there and carried off with them. One lifted
   onto a day of the draft could do that to another copy of the lift: a
   copy put down on that day while this record waits there is merged
   into it, and carried off with it to wherever it goes next. Nothing is
   left filed under a spare day: the second pass puts every record down. */
function spareDayIds(profile, draft, n) {
  const taken = new Set(draft.block.days.map(d => d.id));
  draft.startDay.forEach(dayId => taken.add(dayId));
  draft.erased.forEach(e => { if (e.day) taken.add(e.day.id); });
  RECORD_PARTS.forEach(part => {
    if (part.keyedBy !== 'exercise') forEachSlot(profile[part.name], draft.block.id, (k, w, dayId) => taken.add(dayId));
  });
  const out = [];
  for (let i = 0; out.length < n; i++) if (!taken.has('de-paso-' + i)) out.push('de-paso-' + i);
  return out;
}

/* "Guardar cambios" without the dialogs: bring the profile's record into
   line with the draft and land the draft as the block. Returns how many
   exercises were renamed, which the status line reports — or null,
   having changed nothing, when the draft was cut from another profile
   object than this one (openPlanDraft). There is no merge: the draft
   describes data that is no longer there. */
function applyPlanDraft(profile, draft) {
  if (planDraftStale(profile, draft)) return null;
  const block = draft.block;
  /* The only path that erases logged sets, and only the ones explicitly
     confirmed in "Retirados", each where the dialog counted it: an
     exercise under the day it started on, and a day in its own slots,
     plus every exercise it held that came from another day, under that
     one. It runs in two halves around the moves below, and the order is
     the fix (plans/053):

       1. every erased exercise, under the day it started on — the ones
          erased on their own and the ones an erased day brought in;
       2. the "enviar a…" moves;
       3. every erased day's own slots.

     Exercises first, because a move can land a copy that shares the id
     on that very day (the same id can live on two days by design), and
     once the move has merged the two no purge by day and id can tell
     whose sets are whose: saving used to erase both. Days last, so an
     exercise that left a day before the day was erased has taken its
     record with it by then. An exercise added in this draft has no start
     day, and nothing filed under its fresh id to erase. */
  draft.erased.forEach(e => {
    const exercises = e.ex ? [e.ex] : e.held.filter(ex => draft.startDay.get(ex) !== e.day.id);
    exercises.forEach(ex => {
      const from = draft.startDay.get(ex);
      if (from) purgeRecord(profile, block.id, { day: from, exercise: ex.id });
    });
  });
  /* Catch the profile's record up on any "enviar a…" moves made while
     the sheet was open (the log, the legacy RIR chips, the objetivo
     record and the session order: moveExerciseRecord), before anything
     below reads or purges it by session id.

     In two passes: every moved exercise's record is first lifted onto a
     day of its own that nothing is filed under (spareDayIds), and only
     then is each one put down on the day the exercise went to. The same
     id can live on two days by design, and the record is filed by day and
     id. Moved straight across one at a time, in the plan's order of days,
     a copy sent to the day another copy was leaving could get there
     first: it was merged into that copy's sessions, and the two left
     together. Monday's copy sent to Saturday and Thursday's to Monday put
     all four sets on Saturday and dropped one objetivo record (plans/053's
     second follow-up). Lifted first, each record is on its own when it is
     put down, whatever order the moves were made or run in. Putting it
     down still merges into whatever the destination already has under
     that id rather than overwriting it, so no set would be lost if two
     copies ever did end up on one day, which moveExRefusal is there to
     stop. */
  const moving = [];
  block.days.forEach(day => day.ex.forEach(ex => {
    const from = draft.startDay.get(ex);
    if (from && from !== day.id) moving.push({ id: ex.id, from: from, to: day.id });
  }));
  const via = spareDayIds(profile, draft, moving.length);
  moving.forEach((m, i) => moveExerciseRecord(profile, block.id, m.from, via[i], m.id));
  moving.forEach((m, i) => moveExerciseRecord(profile, block.id, via[i], m.to, m.id));
  draft.erased.forEach(e => { if (e.day) purgeRecord(profile, block.id, { day: e.day.id }); });
  /* An exercise whose NAME changed is a different lift from today on —
     "Elevaciones laterales en polea" became "Elevaciones en Y en polea
     cruzada" and the two are not on the same loads. Recorded here
     because this is the last moment the old name still exists: the log
     keeps no copy of it, so once the draft lands the only way to know
     where one variant ended is the date written now. See recordVariant
     and variantSince in js/app.js. The log itself is kept either way —
     only the objetivo history is cut — but the status line has to say
     so, or the next session shows no objetivo with no explanation. */
  const liveBlock = profile.blocks[block.id];
  let renamed = 0;
  if (liveBlock) {
    const wasNamed = Object.create(null);
    (liveBlock.days || []).forEach(d => (d.ex || []).forEach(e => { if (e && e.id) wasNamed[e.id] = e.n; }));
    block.days.forEach(d => d.ex.forEach(e => {
      if (e && e.id && wasNamed[e.id] != null && recordVariant(profile, e.id, wasNamed[e.id], e.n)) renamed++;
    }));
  }
  profile.blocks[block.id] = block;
  return renamed;
}

/* The deload list only offers weeks the block actually has, so shortening a
   block cannot leave the deload pointing off the end of it. */
function renderDeloadOptions() {
  const weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(peDraft.block));
  const sel = $('peDeload');
  const current = deloadWeek(peDraft.block);
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

/* What a text box in this sheet holds, cut at `max`: its field's
   IMPORT_LIMITS length (EX_FIELDS' `max` for an exercise), which the box's
   own maxlength already stops typing at. This catches what the attribute
   lets through, a value set by script or a browser that ignores it, and
   cuts the box as well as the draft, so what is on screen is what gets
   saved. With no cap here a restore used to cut what the editor had let
   you type (OWN_TEXT_LIMIT); held to the importers' lengths, anything typed
   now goes back in whole through every door. Only ever the box being typed
   in: a longer text saved before the editor stopped there stays as it was
   until somebody edits it. */
function typedText(box, max) {
  const v = String(box.value);
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  box.value = cut;
  return cut;
}

/* The editor stops where the importers stop: IMPORT_LIMITS.days days in a
   block, IMPORT_LIMITS.ex exercises in a day, counted the way
   normalizeImportedBlock counts them — retired ones included, because they
   are part of the block a backup carries and a restore reads back. With no
   ceiling here a block restructured a few times grew past it, and its own
   backup would not restore (plans/010's promise). Counting only the live
   ones would not have closed that: retire, add, retire again, and the
   stored block grows without end. Counted this way, nothing added here can
   take a block past any door back in — the restore, and "Importar JSON"
   and the QR too, since a share carries only the live part. A block saved
   over the limit before this existed still trains and still restores
   (OWN_LIMITS, js/app.js); it just cannot grow.

   Returns the line shown under the disabled "+ Añadir …", or '' while
   there is room. It names the retired ones when they are part of why:
   nothing else on the screen shows them taking up room. */
function planFullNote(list, max, holder, noun) {
  if (list.length < max) return '';
  const retired = list.filter(x => x.off).length;
  return holder + ' ya tiene ' + list.length + ' ' + noun +
    (retired ? ', contando ' + (retired === 1 ? 'el retirado' : 'los ' + retired + ' retirados') : '') +
    '; el máximo es ' + max + '.' +
    (retired ? ' Para añadir otro, borra alguno en "Retirados", al final de esta pantalla, o empieza un bloque nuevo con "+ Nuevo bloque", que copia solo lo que entrenas.' : '');
}
const blockFullNote = block => planFullNote(block.days, IMPORT_LIMITS.days, 'Este bloque', 'días');
const dayFullNote = day => planFullNote(day.ex, IMPORT_LIMITS.ex, 'Este día', 'ejercicios');

/* The reason a "+ Añadir …" is disabled, right under it. */
function appendFullNote(host, text) {
  if (!text) return;
  const note = document.createElement('p');
  note.className = 'setup-hint';
  note.textContent = text;
  host.appendChild(note);
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
  /* Both ids reached index.html hours after this file did, so a precache
     hole can pair this copy with a plan editor that has neither. Drawing
     the chips is this function's whole errand, so it returns instead of
     guarding each read. */
  const host = $('pePriority'), hint = $('pePriorityHint');
  if (!host || !hint) return;
  const block = peDraft.block;
  const tags = blockTagsFor('muscle', block).filter(t => t !== UNCLASSIFIED_LABEL);
  blockPriority(block).forEach(t => { if (tags.indexOf(t) < 0) tags.push(t); });
  tags.sort((a, b) => a.localeCompare(b, 'es'));

  host.innerHTML = '';
  tags.forEach(tag => {
    const on = isPriority(block, tag);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pri-chip' + (on ? ' on' : '');
    b.textContent = tag;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', tag + (on ? ' — prioritario, quitar' : ' — marcar como prioritario'));
    b.onclick = () => {
      const next = blockPriority(block).slice();
      const at = next.indexOf(tag);
      if (at >= 0) next.splice(at, 1); else next.push(tag);
      const clean = cleanPriority(next);
      if (clean.length) block.priority = clean; else delete block.priority;
      renderPriorityChips();
    };
    host.appendChild(b);
  });

  hint.textContent = tags.length
    ? 'Los que marques se vigilan en "Volumen muscular → Todo el bloque": si un músculo prioritario se queda por debajo de la franja de 10–20 series por semana, lo avisa.'
    : 'Ningún ejercicio de este bloque tiene músculo asignado todavía. Ponles uno abajo y aparecerán aquí.';
}

function renderPlanEditor() {
  const host = $('peDays');
  const profile = getProfile();
  host.innerHTML = '';

  renderPriorityChips();

  const block = peDraft.block;
  const live = dayList(block);
  live.forEach((day, pos) => host.appendChild(buildDayBox(profile, day, pos, live.length)));

  const addDay = document.createElement('button');
  addDay.type = 'button';
  addDay.className = 'pe-add-ex';
  addDay.textContent = '+ Añadir día';
  const full = blockFullNote(block);
  addDay.disabled = !!full;
  addDay.onclick = () => {
    if (blockFullNote(block)) return;
    block.days.push({ id: uid('d'), name: 'Día ' + (live.length + 1), ex: [newExercise()] });
    renderPlanEditor();
  };
  host.appendChild(addDay);
  appendFullNote(host, full);

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
      '<input type="text" class="pe-day-name" placeholder="Nombre del día" maxlength="' + IMPORT_LIMITS.name + '">' +
      '<textarea class="pe-day-pair" placeholder="Nota de pareja para este día (opcional)" maxlength="' + IMPORT_LIMITS.pair + '"></textarea>' +
    '</div><div class="pe-exlist"></div>';

  const logged = draftDayLogged(profile, day);
  if (logged) box.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  box.querySelector('.pe-day-name').value = day.name;
  box.querySelector('.pe-day-name').oninput = e => { day.name = typedText(e.target, IMPORT_LIMITS.name); };
  box.querySelector('.pe-day-pair').value = day.pair || '';
  box.querySelector('.pe-day-pair').oninput = e => { day.pair = typedText(e.target, IMPORT_LIMITS.pair); };

  const up = box.querySelector('.d-up'), down = box.querySelector('.d-down'), del = box.querySelector('.d-del');
  up.disabled = pos === 0;
  down.disabled = pos === liveCount - 1;
  del.disabled = liveCount === 1;
  up.onclick = () => { moveLive(peDraft.block.days, day, -1); renderPlanEditor(); };
  down.onclick = () => { moveLive(peDraft.block.days, day, 1); renderPlanEditor(); };
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
      peDraft.block.days.splice(peDraft.block.days.indexOf(day), 1);
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
  const full = dayFullNote(day);
  addBtn.disabled = !!full;
  addBtn.onclick = () => {
    if (dayFullNote(day)) return;
    day.ex.push(newExercise());
    renderPlanEditor();
  };
  box.appendChild(addBtn);
  appendFullNote(box, full);
  return box;
}

function renderRetired(host, profile) {
  const items = [];
  peDraft.block.days.forEach(day => {
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
                         : draftExLogged(profile, it.ex, it.day.id);
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
      eraseFromDraft(peDraft, it);
      renderPlanEditor();
    };
    box.appendChild(row);
  });

  host.appendChild(box);
}

function buildExRow(profile, day, ex, pos, liveCount) {
  /* Every text box stops at its field's length in EX_FIELDS (typedText). */
  const cap = key => ' maxlength="' + exField(key).max + '"';
  const typed = (e, key) => typedText(e.target, exField(key).max);
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
      '<div class="u-flex-grow"><span class="pe-field-lbl">Ejercicio</span><input type="text" class="f-n"' + cap('n') + '></div>' +
    '</div>' +
    '<div class="pe-row"><div class="u-flex-grow"><span class="pe-field-lbl">Alternativa</span><input type="text" class="f-alt"' + cap('alt') + '></div></div>' +
    '<div class="pe-row"><div class="u-flex-grow"><span class="pe-field-lbl">Nota / cue</span><input type="text" class="f-cue"' + cap('cue') + '></div></div>' +
    '<div class="pe-row"><div class="u-flex-grow"><span class="pe-field-lbl">Ajustes de máquina (asiento, respaldo…)</span><input type="text" class="f-setup"' + cap('setup') + '></div></div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">Series</span><input type="number" min="1" max="12" class="f-sets"></div>' +
      '<div class="u-flex-grow-sm"><span class="pe-field-lbl">Reps</span><input type="text" class="f-reps"' + cap('reps') + '></div>' +
      '<div><span class="pe-field-lbl">Descanso (s)</span><input type="number" min="0" max="900" step="5" class="f-rest"></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="' + MAX_WEEKS + '" class="f-add"></div>' +
      '<div><span class="pe-field-lbl">Incremento de peso (' + esc(units()) + ')</span><input type="number" min="' + INC_MIN + '" max="' + INC_MAX + '" step="' + INC_STEP + '" class="f-inc"></div>' +
    '</div>' +
    '<div class="pe-row"><div class="u-flex-grow"><span class="pe-field-lbl">Músculo</span>' +
      '<input type="text" class="f-muscle" list="muscleSuggestions" placeholder="Sin clasificar"' + cap('muscle') + '></div></div>' +
    '<div class="pe-row">' +
      '<div class="u-flex-grow"><span class="pe-field-lbl">Patrón</span>' +
        '<input type="text" class="f-pattern" list="patternSuggestions" placeholder="Sin clasificar"' + cap('pattern') + '></div>' +
      '<div class="u-flex-grow"><span class="pe-field-lbl">Tipo</span>' +
        '<input type="text" class="f-type" list="typeSuggestions" placeholder="Sin clasificar"' + cap('type') + '></div>' +
    '</div>' +
    '<div class="pe-row">' +
      '<label class="pe-check pe-check-share"><input type="checkbox" class="f-share"> Compartido (JUNTOS)</label>' +
      '<label class="pe-check"><input type="checkbox" class="f-ss"> Superserie (SS)</label>' +
    '</div>';

  row.querySelector('.f-n').value = ex.n;
  row.querySelector('.f-n').oninput = e => ex.n = typed(e, 'n');
  row.querySelector('.f-alt').value = ex.alt || '';
  row.querySelector('.f-alt').oninput = e => ex.alt = typed(e, 'alt');
  row.querySelector('.f-cue').value = ex.cue || '';
  row.querySelector('.f-cue').oninput = e => ex.cue = typed(e, 'cue');
  row.querySelector('.f-setup').value = ex.setup || '';
  row.querySelector('.f-setup').oninput = e => { const v = typed(e, 'setup'); if (v) ex.setup = v; else delete ex.setup; };
  row.querySelector('.f-sets').value = ex.sets;
  /* The bounds migrate() uses (js/app.js), applied as you type rather than
     on the next load: the session builds its set rows from the draft as
     saved, so 5000 in Series is 5000 rows on the spot (plans/012). */
  row.querySelector('.f-sets').oninput = e => ex.sets = clampInt(e.target.value, 1, 12, 3);
  row.querySelector('.f-reps').value = ex.reps;
  row.querySelector('.f-reps').oninput = e => ex.reps = typed(e, 'reps');
  row.querySelector('.f-rest').value = ex.rest || 0;
  row.querySelector('.f-rest').oninput = e => ex.rest = clampInt(e.target.value, 0, 900, 90);
  row.querySelector('.f-add').value = ex.add || '';
  /* Clamped from 0, not from 1, so clearing the box still clears the
     field: clampInt('') is 0 raised to the low bound, so a floor of 1
     would read an empty box as "from week 1" and make `add` unremovable. */
  row.querySelector('.f-add').oninput = e => { const v = clampInt(e.target.value, 0, MAX_WEEKS, 0); if (v) ex.add = v; else delete ex.add; };
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
  row.querySelector('.f-muscle').oninput = e => { const v = typed(e, 'muscle').trim(); if (v) ex.muscle = v; else delete ex.muscle; };
  row.querySelector('.f-pattern').value = ex.pattern || '';
  row.querySelector('.f-pattern').oninput = e => { const v = typed(e, 'pattern').trim(); if (v) ex.pattern = v; else delete ex.pattern; };
  row.querySelector('.f-type').value = ex.type || '';
  row.querySelector('.f-type').oninput = e => { const v = typed(e, 'type').trim(); if (v) ex.type = v; else delete ex.type; };
  row.querySelector('.f-share').checked = !!ex.share;
  row.querySelector('.f-share').onchange = e => { if (e.target.checked) ex.share = 1; else delete ex.share; };
  row.querySelector('.f-ss').checked = !!ex.ss;
  row.querySelector('.f-ss').onchange = e => { if (e.target.checked) ex.ss = 1; else delete ex.ss; };

  const logged = draftExLogged(profile, ex, day.id);
  if (logged) row.querySelector('.pe-log-tag').textContent = setsLabel(logged);

  const moveSel = row.querySelector('.pe-move-sel');
  const otherDays = dayList(peDraft.block).filter(d => d !== day);
  if (otherDays.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Enviar a…';
    moveSel.appendChild(placeholder);
    otherDays.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      const why = moveExRefusal(ex, d);
      if (why) { o.disabled = true; o.textContent = d.name + ' (' + why + ')'; }
      moveSel.appendChild(o);
    });
    moveSel.onchange = () => {
      const target = otherDays.find(d => d.id === moveSel.value);
      if (!target || moveExRefusal(ex, target)) return;
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

/* Pulls the form fields (name/weeks/deload) into the draft's block,
   regenerates the phase banner for whatever weeks that leaves it with, and
   defaults blank day names — the same shape-up that used to live inline in
   "Guardar cambios". Shared with the export button below: exporting reads
   the draft too, so it needs to see the fields as currently typed, not as
   they were when the sheet was opened, and shouldn't ship a plan missing a
   name or a set of reps any more than a save should write one. Returns an
   error message, or null once the draft is ready to use. */
function syncDraftFromForm() {
  const block = peDraft.block;
  block.name = $('peBlockName').value.trim() || block.name;
  block.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(block));
  block.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  if (block.deload > block.weeks) block.deload = 0;
  /* Weeks the block has grown into need a goal to show in the banner, and
     the deload week may have moved; anything you wrote yourself is kept. */
  const phase = block.phase && typeof block.phase === 'object' ? block.phase : {};
  const generic = genericPhase(block.weeks, block.deload);
  const nextPhase = {};
  for (let w = 1; w <= block.weeks; w++) {
    const mine = phase[w] || phase[String(w)];
    const isDeload = w === block.deload;
    const wasDeload = mine && mine.r === DELOAD_PHASE.r;
    nextPhase[w] = (mine && mine.r && mine.t && isDeload === wasDeload) ? mine : generic[w];
  }
  block.phase = nextPhase;
  const days = dayList(block);
  if (!days.length) return 'El bloque necesita al menos un día.';
  days.forEach((day, i) => { if (!String(day.name || '').trim()) day.name = 'Día ' + (i + 1); });
  for (const day of days) {
    const live = exList(day);
    if (!live.length) return 'Cada día necesita al menos un ejercicio — revisa "' + day.name + '".';
    /* `ex`, the name every writer of an exercise gives it: the guard in
       test/unit.js finds the fields the code writes by it (EX_FIELDS). */
    for (const ex of live) {
      if (!String(ex.n || '').trim()) return 'Todos los ejercicios necesitan un nombre.';
      if (!ex.reps || !String(ex.reps).trim()) return 'Falta el rango de repeticiones en "' + (ex.n || 'un ejercicio') + '".';
      /* The oninput clamps above are the UX; this is the gate. migrate()
         clamps these on the next load, but the session draws from the
         draft as saved, and 5000 sets is 5000 rows before any reload gets
         the chance to repair it. `add` is bounded by this block's own
         length, which the form may just have shortened. */
      ex.sets = clampInt(ex.sets, 1, 12, 3);
      ex.rest = clampInt(ex.rest, 0, 900, 90);
      if (ex.add != null) { const a = clampInt(ex.add, 0, block.weeks, 0); if (a) ex.add = a; else delete ex.add; }
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
  peDraft = null;
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
        '"' + getBlock().name + '" y todo su registro se quedan como están. ' + UNDO_PROMISE,
      okLabel: 'Eliminar', danger: true,
    });
    if (!okd) return;
    const n = deleteBlocks(profile, others);
    renderBlockManager();
    mark(n + (n === 1 ? ' bloque eliminado' : ' bloques eliminados') + ' — el bloque actual intacto');
  };

  registerSheet('blocksSheet', { closeBtn: 'blkClose' });

  $('importFromText').onclick = () => {
    setNote($('importError'), '', false);
    let raw;
    try { raw = JSON.parse($('importBlob').value); } catch (e) { setNote($('importError'), 'Eso no es JSON válido.', true); return; }
    applyImportedBlock(raw, 'texto pegado');
  };

  registerSheet('importSheet', { closeBtn: 'importClose' });

  $('importDownloadTemplate').onclick = () => downloadBlockTemplate($('importError'));

  $('importCopyPrompt').onclick = () => copyBlockPrompt($('importError'), { withBlock: true });

  $('setupDownloadTemplate').onclick = () => downloadBlockTemplate($('setupImportStatus'));

  /* On a first run there is no block of the user's own yet — only the
     shipped plan — so the prompt keeps the generic example. Reopened from
     "Ajustes" later, the block is real and goes in. */
  $('setupCopyPrompt').onclick = () => copyBlockPrompt($('setupImportStatus'), { withBlock: !!state.setupDone });

  /* The three block actions the "Plan" hub took over from renderBlockBar.
     Null-guarded, and #editPlan below is not, because these three ids are
     NEW to the shell and that one is the footer's own, moved: this file is
     precached in every already-deployed shell, so a precache hole can serve
     this copy of it against an index.html that has never heard of
     #newBlockBtn. wireBlockEditor() is one of the two unguarded calls in
     app.js's tail, so a throw here would take load() with it and leave the
     app on "Cargando tu registro…" — AGENTS.md's precache-hole rule, which
     covers ids exactly as it covers symbols. */
  if ($('newBlockBtn')) $('newBlockBtn').onclick = () => newBlock();
  if ($('importBtn')) $('importBtn').onclick = openImportSheet;
  if ($('manageBtn')) $('manageBtn').onclick = openBlockManager;

  /* The block's name stops where the importers' does, like every text box
     in this sheet (typedText). Set here rather than written into
     index.html, so IMPORT_LIMITS stays the one place the length is. */
  $('peBlockName').setAttribute('maxlength', IMPORT_LIMITS.name);
  $('peBlockName').oninput = e => { typedText(e.target, IMPORT_LIMITS.name); };

  $('editPlan').onclick = () => {
    peDraft = openPlanDraft(getProfile(), getBlock());
    $('peBlockName').value = peDraft.block.name;
    $('peWeeks').value = blockWeeks(peDraft.block);
    renderDeloadOptions();
    renderPlanEditor();
    openSheet('planSheet');
  };

  /* Every other field here mutates the draft without re-rendering; this was
     the outlier, rebuilding every exercise row on each keystroke of the
     weeks field. renderDeloadOptions() is cheap (it only touches the deload
     select) and stays on every input; the exercise rows only need
     renderPlanEditor() once the field is committed — the weeks value is
     re-read and re-clamped from the input on save regardless, so the draft
     cannot drift from skipping the per-keystroke rebuild.
     oninput must not write block.deload: typing "10" passes through "1" on
     the way, and the deload-week list for a one-week block has no week 8,
     so renderDeloadOptions() would fall to "Sin descarga" and this used to
     write that 0 straight into the draft — the planned deload silently
     vanished while the digits were still landing. The select keeps showing
     the stored deload whenever the weeks typed so far reach it, and
     syncDraftFromForm() reads the select on save, so leaving the draft's
     deload untouched here is enough; it only changes once the person
     actually picks a week (plans/062). */
  $('peWeeks').oninput = () => {
    const block = peDraft.block;
    block.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, 8);
    renderDeloadOptions();
  };
  $('peWeeks').onchange = () => renderPlanEditor();

  $('peDeload').onchange = () => {
    peDraft.block.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
    renderPlanEditor();
  };

  $('peSave').onclick = async () => {
    const profile = getProfile();
    /* Before the form is read: a draft cut from data another tab has since
       replaced cannot be saved however it is filled in (openPlanDraft), so
       asking for a missing name first would only waste the fix. Before the
       snapshot too, which would offer to undo a save that never happened.
       The sheet stays open. */
    if (planDraftStale(profile, peDraft)) {
      await tell('No se ha guardado', 'Los datos cambiaron en otra pestaña: vuelve a abrir el editor.');
      return;
    }
    const problem = syncDraftFromForm();
    if (problem) { await tell('Falta algo', problem); return; }
    /* This is the one save path that can move or erase logged sets (the
       "enviar a…" catch-up in applyPlanDraft, and the purge after it), so
       it is the one that needs the same one-level undo every other
       destructive action in this sheet already gets. */
    snapshotForUndo('Plan actualizado.');
    const renamed = applyPlanDraft(profile, peDraft);
    peDraft = null;
    commit();
    closeSheet('planSheet');
    mark('Plan actualizado — el registro se mantiene' +
      (renamed ? ' · ' + renamed + (renamed === 1 ? ' ejercicio renombrado: su objetivo empieza de cero desde hoy'
                                                  : ' ejercicios renombrados: su objetivo empieza de cero desde hoy') : ''));
  };

  $('peExport').onclick = async () => {
    const problem = syncDraftFromForm();
    if (problem) { await tell('Falta algo', problem); return; }
    renderPlanEditor();
    const plan = blockSharePlan(peDraft.block);
    const name = 'heavy-iron-plan-' + (slugify(peDraft.block.name) || 'bloque') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    downloadFile(name, JSON.stringify(plan, null, 2), 'application/json');
    mark('Plan descargado — sin registro, listo para "Importar JSON" en otro sitio');
  };

  registerSheet('planSheet', { closeBtn: 'peClose', onClose: closePlanEditor });

  $('peDeleteBlock').onclick = async () => {
    const profile = getProfile();
    if (profile.blockOrder.length <= 1) { await tell('No se puede', 'No puedes eliminar el único bloque de ' + profile.label + '.'); return; }
    const id = peDraft.block.id;
    const sets = blockLoggedSets(profile, id);
    const okd = await ask({
      title: '¿Eliminar "' + peDraft.block.name + '"?',
      body: (sets ? 'Se borran sus ' + setsLabel(sets) + '. ' : 'No tiene nada registrado. ') +
        'Es el bloque en el que estás entrenando: al borrarlo pasas al bloque más reciente que quede. ' + UNDO_PROMISE,
      okLabel: 'Eliminar', danger: true,
    });
    if (!okd) return;
    closePlanEditor();
    deleteBlocks(profile, [id]);
    mark('Bloque eliminado');
  };
}
