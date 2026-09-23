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
  /* Counted before any of them is read: the walk below, and the
     normalizeImportedProfile each one then goes through, are bounded per
     profile (OWN_LIMITS.blocks, and the block limits under it) but
     nothing bounded how many profiles there were, which is the same
     unbounded loop one level up. */
  if (keys.length > PROFILE_LIMITS.profiles) return 'tiene ' + keys.length + ' perfiles: el máximo es ' + PROFILE_LIMITS.profiles;
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
   thing it doesn't bound (how many blocks there are), validate the two
   fields (label, theme) that reach the screen unescaped otherwise, and
   keep no key a profile is not made of.

   Mutates and returns `p`. Throws only when a count is so far beyond a real
   training history that the data cannot be saved — never for anything the
   app itself could have written.

   `blocks` is how many blocks a profile holds, and it is the app's writers
   that stop there: "+ Nuevo bloque" and every import (blocksFullNote,
   js/block-editor.js). The count below is OWN_LIMITS.blocks (js/app.js),
   twice that, because the writers did not always stop, and a profile that
   passed forty before they did still has to come back from its own
   backup. Held to `blocks` itself, the 41st block the app let somebody
   paste made the next backup it wrote refuse to restore (plans/010).

   `profiles` is read by describeBackupProblem, above, for a whole backup.
   The app keeps two and has no way to make a third (AGENTS.md), but a
   phone that loaded a crafted profile file before plans/040 could have
   gained a phantom one for each of the eleven functions Object.prototype
   carries, and its own backups carry those too. Sixteen is past that and
   still nothing a phone cannot walk. */
const PROFILE_LIMITS = { blocks: 40, profiles: 16 };

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

/* Which profile a loaded file replaces: the key it names, when that is a
   profile this device actually has, else the one on screen. Both halves of
   the test matter — safeKey refuses the prototype's names outright, and the
   own-property check refuses a name the map merely inherits — because
   `state.profiles[key]` alone was truthy for 'constructor' (the dialog then
   asked to replace "undefined" and the file landed as a phantom third
   profile) and for '__proto__' (the assignment re-pointed the map's
   prototype, nothing was saved, and the status line said it was). Same
   reasoning as ownGet above; this is the one place a key from a file is
   used to WRITE (plans/040). */
function profileSlotFor(key) {
  const k = typeof key === 'string' ? safeKey(key) : '';
  return k && Object.prototype.hasOwnProperty.call(state.profiles, k) ? k : state.activeProfile;
}

/* Drops every own key of `o` that `keys` does not name. A file used to
   carry any extra key it liked into storage, because nothing whitelisted
   them, and every backup taken afterwards carried it out again; what the
   app never reads is not the app's to keep (plans/051). `delete` on an own
   '__proto__' removes that property and never touches the prototype. */
function keepOnly(o, keys) {
  Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) delete o[k]; });
  return o;
}

function normalizeImportedProfile(p) {
  keepOnly(p, RECORD_PARTS.map(part => part.name).concat(NON_RECORD_FIELDS));
  const rawIds = Object.keys(p.blocks);
  if (rawIds.length > OWN_LIMITS.blocks) {
    throw new Error('tiene ' + rawIds.length + ' bloques: el máximo es ' + OWN_LIMITS.blocks + '.');
  }

  const blocks = {};
  /* raw block key -> the key it actually lands on. Almost always itself —
     block ids are ordinary strings — but any name `Object.prototype`
     carries reads back off the plain {} above as a block that is already
     there, and `__proto__` sets its prototype instead of adding a property
     (see safeKey, js/app.js, and plans/008 item 2), so a key like that gets
     a fresh id here. Every other block-id-keyed thing below (each part of
     the profile's record filed by block, blockOrder, activeBlock) has to
     follow the same rename, or the block comes back with everything except
     its own history.

     A Map, not a plain object: the raw key is exactly the untrusted string
     this whole function exists to defend against, and `plainObj[bk] = id`
     has the identical bracket-assignment hazard ownGet's comment describes
     — a `keyMap = {}` here reintroduces the bug one line below the fix for
     it. Map.prototype.get/set never consult a prototype chain, so any
     string is just a key. */
  const keyMap = new Map();
  /* raw exercise id -> the id it ended up with, unioned across every block.
     The parts filed by block are re-keyed block by block inside the loop
     below, but a part keyed by exercise id alone (the variants) has no
     block above it, so it has nowhere to look a per-block map up from and
     needs this one flat union instead. First occurrence wins, matching
     importIdMaps' own rule. A Map for the same reason keyMap is one: the
     key is an untrusted string. */
  const exIdMap = new Map();
  rawIds.forEach(bk => {
    const raw = p.blocks[bk];
    let normalized;
    try {
      normalized = normalizeImportedBlock(raw, { own: true });
    } catch (e) {
      throw new Error('el bloque "' + (txt(raw && raw.name, IMPORT_LIMITS.name) || bk) + '": ' + e.message);
    }
    let id = safeKey(bk) || uid('block');
    while (blocks[id]) id = uid('block');
    keyMap.set(bk, id);
    /* Not part of normalizeImportedBlock's own return — it has no concept
       of the key it will be filed under. blockId is the profile.blocks key
       everywhere else in the app (every part of the profile's record but
       the variants is keyed by it too, see RECORD_PARTS), so that is the id
       kept here, not whatever raw.id says. */
    normalized.id = id;
    normalized.createdAt = txt(raw && raw.createdAt, 40) || new Date().toISOString();
    blocks[id] = normalized;

    /* Filled here, inside the loop, because it needs `normalized` — the
       block as it actually landed — and read after the loop by the parts
       keyed by exercise, which no longer have either form in hand. */
    const ids = importIdMaps(raw, normalized).exMap;
    Object.keys(ids).forEach(dayId => Object.keys(ids[dayId]).forEach(rawEx => {
      if (!exIdMap.has(rawEx)) exIdMap.set(rawEx, ids[dayId][rawEx]);
    }));

    /* Every part of the record filed by block, through its own `accept`
       (RECORD_PARTS). A restored backup or a loaded profile file is exactly
       as untrusted as a scanned block, and used to skip the per-row limits
       the QR path already ran (plans/008, item 4): an oversized or
       hand-repaired row array restored without complaint, and the first
       tap on the volume dashboard or the CSV export hung the tab. Each part
       is re-keyed the way a QR transfer is, in case normalizeImportedBlock
       above renamed an id or a day it is filed under (a duplicate, a
       blocked key like `__proto__`, a day id past 60 characters). A part
       this code named by hand was the part it forgot: the session order
       was not re-keyed before plans/010, nor notes and energy before #138.
       Only a part that `rejects` can refuse the file, and the refusal
       names the block. ownGet, not a naive `p.log[bk]`: see its own
       comment. */
    RECORD_PARTS.forEach(part => {
      if (part.keyedBy === 'exercise') return;
      const rawPart = ownGet(p[part.name], bk);
      if (!rawPart) return;
      if (!part.rejects) { p[part.name][bk] = part.accept(rawPart, raw, normalized); return; }
      try {
        p[part.name][bk] = part.accept(rawPart, raw, normalized);
      } catch (e) {
        throw new Error('el registro del bloque "' + normalized.name + '" ' + e.message);
      }
    });
  });
  p.blocks = blocks;

  /* Whatever a block-id-keyed map points at has to still exist under its
     (possibly renamed) key: an entry left behind for a block that got
     rejected, renumbered or renamed above is an orphan by construction, the
     same invariant deleteBlocks maintains on purpose (see
     plans/002-purge-parallel-maps.md). Rebuilding under the mapped key does
     both the rename and the orphan drop in one pass. `out[id] = …` is safe
     even though `bk` is not: `id` only ever comes from keyMap, which never
     hands back a name safeKey refuses (see safeKey). A falsy entry (a
     null where a block's map should be) is dropped here for every part
     alike: the loop above leaves it untouched, and notes and energy used to
     be the only two that deleted it. The parts filed by block are
     RECORD_PARTS' less the ones keyed by exercise alone, which are
     re-keyed on their own below. */
  RECORD_PARTS.filter(part => part.keyedBy !== 'exercise').forEach(part => {
    const key = part.name;
    const map = p[key];
    if (!map || typeof map !== 'object') return;
    const out = {};
    Object.keys(map).forEach(bk => {
      const id = keyMap.get(bk);
      if (id && blocks[id] && map[bk]) out[id] = map[bk];
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

  /* The parts keyed by exercise id and not by block, which the block-by-block
     re-keying above cannot reach: `exIdMap` is the union it left behind for
     exactly this, and each part's `accept` says what it keeps. A part that
     is missing or malformed comes back empty. */
  RECORD_PARTS.forEach(part => {
    if (part.keyedBy === 'exercise') p[part.name] = part.accept(p[part.name], exIdMap);
  });

  /* The name comes back as it was stored, cut at 80 and on one line
     (storedLine): Ajustes keeps a double space typed inside it, migrate()
     keeps it too, and the import used to tidy it away (plans/077). The one
     line matters here most: the dialogs quote this name, and
     loadProfileFromText's question says why a line break must not reach
     them. */
  p.label = storedLine(p.label, 80);
  /* A theme the app stores comes back as stored: a current accent, or one
     of the two legacy names every phone set up from the seed still holds
     (legacyAccent), which migrate() keeps as they are. Turning a legacy
     name into its new one here made the app's own file change the data it
     was read over (plans/077). Anything else gets accentOf's default,
     'azul', where migrate() would give it the seed's accent for that
     profile (by its name, else its place) — the one difference left, and
     only a file the app did not write can carry such a theme. */
  if (ACCENTS.indexOf(p.theme) < 0 && !legacyAccent(p.theme)) p.theme = accentOf(p);

  return p;
}

/* What a backup's top level keeps, which is what it becomes: the state.
   These are the fields load() and migrate() read off it, and so the ones
   the app writes (plans/051). `v` is deliberately absent: it is the
   version stamp on the wrapper around the state ({ app, v, saved, data }),
   never a field of the state itself, so listing it here would keep nothing
   and suggest otherwise. The guard in test/unit.js fails when the app
   writes a top-level key this list does not name, since a restore would
   then drop it. */
const BACKUP_FIELDS = ['profiles', 'activeProfile', 'mode', 'prefs', 'setupDone'];

/* A whole backup the way normalizeImportedProfile takes one profile: each
   of them through it, then the top level cut down to BACKUP_FIELDS.
   Mutates `data`; throws, naming the profile, when one cannot be restored.
   Out of restoreFromText so what a restore keeps can be tested without a
   dialog. */
function normalizeImportedBackup(data) {
  Object.keys(data.profiles).forEach(pk => {
    try {
      normalizeImportedProfile(data.profiles[pk]);
    } catch (e) {
      throw new Error('el perfil "' + pk + '" ' + e.message);
    }
  });
  return keepOnly(data, BACKUP_FIELDS);
}

/* A profile's total, over every block it has. countSets (js/app.js) is the
   one counter that walks a single block's log; this sums it across
   whatever blocks a profile carries. */
function countProfileSets(p) {
  const log = p && p.log;
  if (!log || typeof log !== 'object') return 0;
  return Object.keys(log).reduce((n, bId) => n + countSets(log[bId]), 0);
}

/* Every profile's total, for the "you have this much, the file has that
   much" line a restore shows before it overwrites everything. */
function countBackupSets(data) {
  return Object.keys(data.profiles).reduce((n, pk) => n + countProfileSets(data.profiles[pk]), 0);
}

async function restoreFromText(text) {
  /* A set ticked just before this runs leaves a debounced save() pending
     (js/app.js, 400 ms). Left alone, that timer can fire after one of the
     mark() calls below and silently overwrite "no se puede usar…" with
     "Guardado hh:mm" — the rejection reason disappears exactly when it
     matters most. Flushing first means any autosave lands before this
     function's own message, never after. `flushPending`, not `flushSave`:
     the forcing one would resolve an open two-tab conflict in this tab's
     favour before the file has even been parsed. */
  flushPending();
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese texto no es una copia válida', true); return; }
  const data = parsed && parsed.data ? parsed.data : parsed;

  const problem = describeBackupProblem(data);
  if (problem) { mark('Esa copia no se puede usar: ' + problem, true); return; }

  try {
    normalizeImportedBackup(data);
  } catch (e) {
    mark('Esa copia no se puede usar: ' + e.message, true);
    return;
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
     final as either, and is the operation the guide tells people to rely on
     (docs/guide.md, "Data & privacy" and "Two phones, one profile each").
     Undo is one level deep and does not survive a reload, which is exactly
     the window this covers: realising within seconds that it was the wrong
     file. */
  snapshotForUndo('Registro restaurado desde una copia.');
  const prev = state;
  state = data;
  /* No default for activeProfile here: migrate() hands a missing or
     foreign one the file's first profile, which is the answer a load from
     storage gets for the same data. A 'hombre' default here was redundant
     with that, and where the file did not list 'hombre' first it picked a
     different profile than a reload of the same data would. */
  try {
    migrate();
  } catch (err) {
    /* migrate() throwing partway used to leave `state` pointed at the
       copy, half migrated and never drawn, with "Deshacer" offered for a
       restore that had not happened, and the next save() wrote that copy
       over this tab's data. Put this tab's own back, the way adoptStored
       (js/app.js) turns away bytes migrate() cannot take in, drop the
       undo with the toast that offered it, and refuse the copy like the
       checks above do (plans/071). */
    state = prev;
    dropUndo();
    mark('Esa copia no se puede usar: ' + err.message, true);
    return;
  }
  applyTheme();
  commit();
  closeSheet('sheet');
  /* writeState (and so flushSave) can come back undefined rather than
     false on an app.js cached from before this return value existed (a
     precache hole) — only an explicit false means the write failed, so
     checking truthiness here would swallow every success message on that
     shell. On false, writeState has already put the failure in the footer
     and it must stay there. */
  if (flushSave() !== false) mark('Registro restaurado — ' + setsLabel(theirs));
}

/* ---------- moving one person between phones (loading a profile file) ----------
   The counterpart to the export in renderProfileExports (app.js): a profile
   file carries exactly one person, and loading it overwrites exactly that
   one, without touching anyone else's log. */
async function loadProfileFromText(text) {
  /* Same reasoning as restoreFromText's pre-flight flush above: land any
     pending debounce before the first rejection message can be overwritten
     by it, without forcing through an open two-tab conflict. */
  flushPending();
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

  /* Land it on the slot it came from; a file from somewhere stranger falls
     back to the profile you are looking at — see profileSlotFor. */
  const target = profileSlotFor(parsed.key);
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
  try {
    migrate();
  } catch (err) {
    /* restoreFromText's catch, above, for one profile: the one this file
       was replacing goes back in its slot, and the undo offered for a
       change that did not happen is dropped. The other profiles went
       through the same migrate(), but they are this app's own data,
       already migrated, and its repairs change nothing on them
       (plans/071). */
    state.profiles[target] = local;
    dropUndo();
    mark('Ese perfil no se puede usar: ' + err.message, true);
    return;
  }
  applyTheme();
  commit();
  closeSheet('sheet');
  /* Flushed before the message, not after: save() is debounced 400 ms and
     ends in mark('Guardado …'), so anything said here would be wiped off the
     status line half a second later, unread. Everything below that reports
     the result of an import does the same. Same as restoreFromText above:
     only an explicit false means the write failed. */
  if (flushSave() !== false) mark(state.profiles[target].label + ' cargado — ' + setsLabel(theirs) + landingNote(state.profiles[target]));
}


/* ---------- what this device is holding ----------
   The sheet is where somebody comes when they are worried about losing the
   log, so it is where the answer belongs: how big it is, and whether the
   browser has promised to keep it. "Sin proteger" is not an error — it is
   the default for every website — but it is the one thing here that a
   single tap can fix. */
function renderStorageState() {
  /* Both ids landed a day after this file, so a precache hole can serve
     this copy against a sheet that has no storage line. Saying nothing is
     the whole of what this function can do then (AGENTS.md's
     precache-hole rule, which reads the same on ids as on symbols). */
  const line = $('storageState'), acts = $('storageActs');
  if (!line || !acts) return;
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

  /* wireProfileTransfer is one of the two unguarded calls in app.js's tail,
     so a throw here takes load() with it and the app never draws — and
     #storageProtect is newer than this file. */
  const prot = $('storageProtect');
  if (prot) prot.onclick = () => {
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
