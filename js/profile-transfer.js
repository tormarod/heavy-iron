/* ---------- backup / restore ---------- */





/* A restore replaces everything, so a file that is *almost* a backup is the
   most dangerous input the app takes: accepting it wipes real history and
   leaves something the app may not be able to draw. Checked before anything
   is touched, and the reason is reported rather than a generic "no vale". */
function describeBackupProblem(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'no contiene un objeto de datos';
  if (!data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) return 'no tiene perfiles';
  /* Whatever the profiles are called — the two this app shipped with, or the
     names you gave them — a backup has to carry at least one, and every one
     it does carry has to be readable. */
  const keys = Object.keys(data.profiles);
  if (!keys.length) return 'no tiene ningún perfil';
  for (const pk of keys) {
    const problem = describeProfileProblem(data.profiles[pk], pk);
    if (problem) return problem;
  }
  return null;
}

/* One profile's worth of the same checks, so a single-profile file gets the
   same scrutiny as a full backup before it replaces anything. */
function describeProfileProblem(p, pk) {
  const who = (p && p.label) || pk || 'sin nombre';
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'el perfil "' + who + '" está corrupto';
  if (!p.blocks || typeof p.blocks !== 'object' || !Object.keys(p.blocks).length) return 'el perfil "' + who + '" no tiene bloques';
  if (p.log && typeof p.log !== 'object') return 'el registro del perfil "' + who + '" está corrupto';
  for (const bk of Object.keys(p.blocks)) {
    const b = p.blocks[bk];
    if (!b || typeof b !== 'object') return 'el bloque "' + bk + '" de "' + who + '" está corrupto';
    if (!Array.isArray(b.days)) return 'el bloque "' + (b.name || bk) + '" de "' + who + '" no tiene días';
  }
  return null;
}

/* Blocks get this treatment already, from normalizeImportedBlock
   (js/block-editor.js:198): every string length-capped, every number
   clamped, day/exercise counts ceilinged, ids deduplicated. A profile or a
   full backup — a file a partner sent, or a QR scan of someone's screen —
   carries the same untrusted shape one level up, but describeProfileProblem
   above only checks that it *looks* like a profile. A profile with ten
   thousand exercises hangs the phone exactly like an oversized block does;
   it just arrives through a different door. This meets it with the same
   standard: reuse the audited block normalizer for every block, cap the one
   thing it doesn't bound (how many blocks there are), and validate the two
   fields (label, theme) that reach the screen unescaped otherwise.

   Mutates and returns `p`. Throws only when a count is so far beyond a real
   training history that the data cannot be saved — never for anything the
   app itself could have written. */
const PROFILE_LIMITS = { blocks: 40 };

/* True only when `o` OWNS `k` as a property, never when it merely inherits
   one. A plain {} answers a bracket read of '__proto__' with the real
   Object.prototype (truthy — see safeKey, js/app.js) unless it happens to
   own that exact key itself, which is exactly what a JSON.parse'd '__proto__'
   block id does (JSON.parse defines it as a normal own property, unlike the
   `{ __proto__: x }` literal syntax, which sets the actual prototype
   instead). Every lookup below that indexes a plain object by a raw,
   unsanitized block id goes through this first — a naive `obj[k]` truthy
   check would treat that inherited Object.prototype as "found", and the
   assignment it leads to would then create a NEW property under a key that
   isn't there yet, which for '__proto__' specifically means the plain
   `obj[k] = v` that follows call the inherited setter and change the
   receiver's actual prototype instead of adding a property to it. */
function ownGet(o, k) {
  return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

function normalizeImportedProfile(p) {
  const rawIds = Object.keys(p.blocks);
  if (rawIds.length > PROFILE_LIMITS.blocks) {
    throw new Error('tiene ' + rawIds.length + ' bloques: el máximo es ' + PROFILE_LIMITS.blocks + '.');
  }

  const blocks = {};
  /* raw block key -> the key it actually lands on. Almost always itself —
     block ids are ordinary strings — but any name `Object.prototype`
     carries reads back off the plain {} above as a block that is already
     there, and `__proto__` sets its prototype instead of adding a property
     (see safeKey, js/app.js, and plans/008 item 2), so a key like that gets
     a fresh id here. Every other block-id-keyed thing below
     (log/rir/notes/energy/order, blockOrder, activeBlock) has to follow the
     same rename, or the block comes back with everything except its own
     history.

     A Map, not a plain object: the raw key is exactly the untrusted string
     this whole function exists to defend against, and `plainObj[bk] = id`
     has the identical bracket-assignment hazard ownGet's comment describes
     — a `keyMap = {}` here reintroduces the bug one line below the fix for
     it. Map.prototype.get/set never consult a prototype chain, so any
     string is just a key. */
  const keyMap = new Map();
  rawIds.forEach(bk => {
    const raw = p.blocks[bk];
    let normalized;
    try {
      normalized = normalizeImportedBlock(raw, { own: true });
    } catch (e) {
      throw new Error('el bloque "' + (raw && raw.name || bk) + '": ' + e.message);
    }
    let id = safeKey(bk) || uid('block');
    while (blocks[id]) id = uid('block');
    keyMap.set(bk, id);
    /* Not part of normalizeImportedBlock's own return — it has no concept
       of the key it will be filed under. blockId is the profile.blocks key
       everywhere else in the app (log/rir/notes/energy/order are all keyed
       by it too), so that is the id kept here, not whatever raw.id says. */
    normalized.id = id;
    normalized.createdAt = (raw && raw.createdAt) || new Date().toISOString();
    blocks[id] = normalized;

    /* The QR "blocklog" path already runs every row through the same
       per-row limits and RIR enum (LOG_LIMITS / normalizeImportedLog /
       normalizeImportedRir, js/app.js) before trusting them; a restored
       backup or a loaded profile file is exactly as untrusted as a scanned
       block and used to skip this entirely (plans/008, item 4) — an
       oversized or hand-repaired row array restored without complaint, and
       the first tap on the volume dashboard or the CSV export hung the
       tab. Re-keyed the same way a QR transfer is, in case
       normalizeImportedBlock above renamed an id this profile's log still
       refers to by its old name (a duplicate, or a blocked key like
       `__proto__`). ownGet, not a naive `p.log[bk]`: see its own comment. */
    const rawLog = ownGet(p.log, bk);
    if (rawLog) {
      try {
        p.log[bk] = normalizeImportedLog(rawLog, raw, normalized);
      } catch (e) {
        throw new Error('el registro del bloque "' + normalized.name + '" ' + e.message);
      }
    }
    const rawRir = ownGet(p.rir, bk);
    if (rawRir) p.rir[bk] = normalizeImportedRir(rawRir, raw, normalized);

    /* Same re-keying as log and rir: a renamed exercise id (a blocked key,
       or a duplicate on the strict path) would otherwise leave the recorded
       session order pointing at ids no card on this phone has, and it would
       silently fall back to plan order. Never done here before plans/010. */
    const rawOrder = ownGet(p.order, bk);
    if (rawOrder) p.order[bk] = normalizeImportedOrder(rawOrder, raw, normalized);

    /* Same again for the objetivo record: per exercise, so it is re-keyed
       like the log and the chips, and absent in every file written before
       v3 — which restores as no record at all rather than as an error. */
    const rawObj = ownGet(p.obj, bk);
    if (rawObj) p.obj[bk] = normalizeImportedObj(rawObj, raw, normalized);

    /* Notes and energy carry no such re-keying (they are per-session, not
       per-exercise, so no id map applies) but were never capped or
       validated against their own limits on this path either — only
       migrate()'s generic "is it an object" check ran. */
    const rawNotes = ownGet(p.notes, bk);
    if (rawNotes && typeof rawNotes === 'object' && !Array.isArray(rawNotes)) {
      const out = {};
      Object.keys(rawNotes).slice(0, LOG_LIMITS.slots).forEach(k => {
        const t = txt(rawNotes[k], NOTE_LIMIT);
        if (t) out[k] = t;
      });
      p.notes[bk] = out;
    } else if (p.notes) {
      delete p.notes[bk];
    }
    const rawEnergy = ownGet(p.energy, bk);
    if (rawEnergy && typeof rawEnergy === 'object' && !Array.isArray(rawEnergy)) {
      const out = {};
      Object.keys(rawEnergy).slice(0, LOG_LIMITS.slots).forEach(k => {
        if (ENERGY_OPTIONS.indexOf(rawEnergy[k]) >= 0) out[k] = rawEnergy[k];
      });
      p.energy[bk] = out;
    } else if (p.energy) {
      delete p.energy[bk];
    }
  });
  p.blocks = blocks;

  /* Whatever a block-id-keyed map points at has to still exist under its
     (possibly renamed) key: an entry left behind for a block that got
     rejected, renumbered or renamed above is an orphan by construction, the
     same invariant deleteBlocks maintains on purpose (see
     plans/002-purge-parallel-maps.md). Rebuilding under the mapped key does
     both the rename and the orphan drop in one pass. `out[id] = …` is safe
     even though `bk` is not: `id` only ever comes from keyMap, which never
     hands back a name safeKey refuses (see safeKey). */
  ['log', 'rir', 'notes', 'energy', 'order', 'obj'].forEach(key => {
    const map = p[key];
    if (!map || typeof map !== 'object') return;
    const out = {};
    Object.keys(map).forEach(bk => {
      const id = keyMap.get(bk);
      if (id && blocks[id]) out[id] = map[bk];
    });
    p[key] = out;
  });

  /* Same dedupe-and-append shape migrate() uses on blockOrder: keep the
     order the file gave, once per id, drop anything that didn't survive
     normalization, then file in any block the order was missing. */
  const rawOrder = Array.isArray(p.blockOrder) ? p.blockOrder : rawIds;
  const seen = new Set();
  const order = rawOrder.map(bk => keyMap.get(bk)).filter(id => id && blocks[id] && !seen.has(id) && seen.add(id));
  rawIds.forEach(bk => { const id = keyMap.get(bk); if (id && order.indexOf(id) < 0) order.push(id); });
  p.blockOrder = order;
  const activeId = keyMap.get(p.activeBlock);
  p.activeBlock = (activeId && blocks[activeId]) ? activeId : order[order.length - 1];

  /* Variants are keyed by exercise id and not by block, so the re-keying
     above does not reach them: an id the whole file never mentions is
     harmless (nothing asks for it) but a malformed date is not — it would
     cut a history at a moment nobody can name. Anything that is not a
     plain YYYY-MM-DD is dropped, which leaves the exercise reading as one
     unbroken variant: the reading it had before v3. */
  if (p.variants && typeof p.variants === 'object' && !Array.isArray(p.variants)) {
    const vars = {};
    Object.keys(p.variants).slice(0, IMPORT_LIMITS.days * IMPORT_LIMITS.ex).forEach(rawExId => {
      const exId = safeKey(rawExId);
      const list = p.variants[rawExId];
      if (!exId || !Array.isArray(list)) return;
      const clean = list.filter(v => v && typeof v === 'object' && VARIANT_SINCE_RE.test(String(v.since)))
        .map(v => ({ n: txt(v.n, IMPORT_LIMITS.exName) || '', since: String(v.since) }))
        .slice(-VARIANT_LIMIT);
      if (clean.length) vars[exId] = clean;
    });
    p.variants = vars;
  } else {
    p.variants = {};
  }

  p.label = txt(p.label, 80);
  /* accentOf already encodes "in ACCENTS, or a known legacy value, or the
     default" — the same rule migrate() applies to a stored profile's theme. */
  p.theme = accentOf(p);

  return p;
}

function countProfileSets(p) {
  let n = 0;
  const log = p && p.log;
  if (!log || typeof log !== 'object') return 0;
  Object.keys(log).forEach(bId => {
    const blk = log[bId];
    if (!blk || typeof blk !== 'object') return;
    Object.keys(blk).forEach(k => {
      const sl = blk[k];
      if (!sl || typeof sl !== 'object') return;
      Object.keys(sl).forEach(exId => { if (Array.isArray(sl[exId])) n += sl[exId].filter(rowUsed).length; });
    });
  });
  return n;
}

function countBackupSets(data) {
  let n = 0;
  Object.keys(data.profiles).forEach(pk => {
    const log = data.profiles[pk].log;
    if (!log || typeof log !== 'object') return;
    Object.keys(log).forEach(bId => {
      const blk = log[bId];
      if (!blk || typeof blk !== 'object') return;
      Object.keys(blk).forEach(k => {
        const s = blk[k];
        if (!s || typeof s !== 'object') return;
        Object.keys(s).forEach(exId => { if (Array.isArray(s[exId])) n += s[exId].filter(rowUsed).length; });
      });
    });
  });
  return n;
}

async function restoreFromText(text) {
  /* A set ticked just before this runs leaves a debounced save() pending
     (js/app.js, 400 ms). Left alone, that timer can fire after one of the
     mark() calls below and silently overwrite "no se puede usar…" with
     "Guardado hh:mm" — the rejection reason disappears exactly when it
     matters most. Flushing first means any autosave lands before this
     function's own message, never after. */
  flushSave();
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese texto no es una copia válida', true); return; }
  const data = parsed && parsed.data ? parsed.data : parsed;

  const problem = describeBackupProblem(data);
  if (problem) { mark('Esa copia no se puede usar: ' + problem, true); return; }

  for (const pk of Object.keys(data.profiles)) {
    try {
      normalizeImportedProfile(data.profiles[pk]);
    } catch (e) {
      mark('Esa copia no se puede usar: el perfil "' + pk + '" ' + e.message, true);
      return;
    }
  }

  const mine = countBackupSets(state);
  const theirs = countBackupSets(data);
  const when = parsed && parsed.saved ? new Date(parsed.saved) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  const okd = await ask({
    title: '¿Reemplazar todo tu registro con esta copia?',
    body: 'Copia' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Ahora mismo tienes: ' + setsLabel(mine) + '.\n\n' +
      (theirs < mine ? 'La copia tiene MENOS registro que lo que hay ahora — comprueba que es la que quieres. ' : '') +
      UNDO_PROMISE,
    okLabel: 'Reemplazar', danger: true,
  });
  if (!okd) return;

  /* The one destructive path that had no way back. Its sibling
     loadProfileFromText has taken a snapshot since it was written, and
     "Borrar todo el registro" takes one too — restoring a copy is at least as
     final as either, and is the operation the README tells people to rely on.
     Undo is one level deep and does not survive a reload, which is exactly
     the window this covers: realising within seconds that it was the wrong
     file. */
  snapshotForUndo('Registro restaurado desde una copia.');
  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  migrate();
  applyTheme();
  commit();
  closeSheet('sheet');
  flushSave();
  mark('Registro restaurado — ' + setsLabel(theirs));
}

/* ---------- moving one person between phones (loading a profile file) ----------
   The counterpart to the export in renderProfileExports (app.js): a profile
   file carries exactly one person, and loading it overwrites exactly that
   one, without touching anyone else's log. */
async function loadProfileFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese archivo no es un perfil válido', true); return; }

  if (!parsed || parsed.kind !== 'profile' || !parsed.profile) {
    mark('Eso no es un perfil suelto. Si es una copia completa, usa "Cargar copia".', true);
    return;
  }

  const incoming = parsed.profile;
  const problem = describeProfileProblem(incoming, parsed.key);
  if (problem) { mark('Ese perfil no se puede usar: ' + problem, true); return; }

  /* Before the dialog is built, not after: the dialog quotes the set count
     and the label, so the user has to be shown numbers from the data that
     will actually be installed, not the raw file. */
  try {
    normalizeImportedProfile(incoming);
  } catch (e) {
    mark('Ese perfil no se puede usar: ' + e.message, true);
    return;
  }

  /* Land it on the slot it came from. The keys are internal and never
     renamed, so this matches whoever exported it; a file from somewhere
     stranger falls back to the profile you are looking at. */
  const target = (parsed.key && state.profiles[parsed.key]) ? parsed.key : state.activeProfile;
  const local = state.profiles[target];
  const theirs = countProfileSets(incoming);
  const mine = countProfileSets(local);
  const when = parsed.saved ? new Date(parsed.saved) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  const others = profileKeys().filter(k => k !== target).map(k => state.profiles[k].label);
  /* Whatever the payload says its label is, it must not be able to
     restructure this dialog: the body renders with white-space: pre-line
     (css/style.css:836), so an unsanitised newline becomes a line break in
     the one confirmation that irreversibly replaces a training history.
     Same treatment js/app.js:4602 gives an imported block's "from" field. */
  const incomingLabel = txt(incoming.label, 80) || target;

  const okd = await ask({
    title: '¿Sustituir el perfil de ' + local.label + '?',
    body: 'Entra "' + incomingLabel + '"' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Se reemplaza ' + local.label + ', que tiene ahora ' + setsLabel(mine) + '.\n\n' +
      (others.length ? others.join(' y ') + ' no se toca' + (others.length > 1 ? 'n' : '') + '. ' : '') +
      UNDO_PROMISE,
    okLabel: 'Sustituir', danger: true,
  });
  if (!okd) return;

  snapshotForUndo('Perfil de ' + local.label + ' sustituido.');
  state.profiles[target] = incoming;
  migrate();
  applyTheme();
  commit();
  closeSheet('sheet');
  /* Flushed before the message, not after: save() is debounced 400 ms and
     ends in mark('Guardado …'), so anything said here would be wiped off the
     status line half a second later, unread. Everything below that reports
     the result of an import does the same. */
  flushSave();
  mark(state.profiles[target].label + ' cargado — ' + setsLabel(theirs) + landingNote(state.profiles[target]));
}


/* ---------- what this device is holding ----------
   The sheet is where somebody comes when they are worried about losing the
   log, so it is where the answer belongs: how big it is, and whether the
   browser has promised to keep it. "Sin proteger" is not an error — it is
   the default for every website — but it is the one thing here that a
   single tap can fix. */
function renderStorageState() {
  const line = $('storageState');
  const acts = $('storageActs');
  const size = 'Tu registro ocupa ' + fmtBytes(logBytes()) + '.';

  if (!canPersist()) {
    line.textContent = size + ' Este navegador no sabe proteger el almacenamiento, así que descarga una copia de vez en cuando.';
    acts.hidden = true;
    return;
  }

  persisted().then(safe => {
    line.textContent = safe
      ? size + ' Está protegido: el navegador no lo borrará para hacer sitio, solo lo pierdes si borras los datos del sitio o desinstalas la app.'
      : size + ' No está protegido: si al móvil le falta espacio, el navegador puede borrarlo para hacer sitio. Instalar la app y pulsar aquí lo evita.';
    /* .hidden, not .style.display: index.html ships this with the `hidden`
       attribute now (plans/008 item 22), and clearing an inline style would
       leave that attribute in charge, never showing these actions at all. */
    acts.hidden = safe;
  });
}

function wireProfileTransfer() {
  $('backup').onclick = () => {
    $('blob').value = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state });
    renderProfileExports();
    renderStorageState();
    openSheet('sheet');
  };

  $('storageProtect').onclick = () => {
    askForPersistence().then(safe => {
      renderStorageState();
      mark(safe
        ? 'Registro protegido en este móvil'
        : 'El navegador no ha querido protegerlo — sigue descargando copias', !safe);
    });
  };

  registerSheet('sheet', { closeBtn: 'bClose' });

  $('bDownload').onclick = () => {
    const payload = JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2);
    downloadFile('heavy-iron-backup-' + new Date().toISOString().slice(0, 10) + '.json', payload, 'application/json');
    resetBackupNag();
    mark('Copia descargada — ' + setsLabel(countBackupSets(state)));
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
      resetBackupNag();
      mark('Copiado al portapapeles');
    } catch (e) {
      mark('No se pudo copiar — selecciona el texto y cópialo a mano', true);
    }
  };

  $('bRestore').onclick = () => restoreFromText($('blob').value);
}
