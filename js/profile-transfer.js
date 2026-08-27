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
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese texto no es una copia válida', true); return; }
  const data = parsed && parsed.data ? parsed.data : parsed;

  const problem = describeBackupProblem(data);
  if (problem) { mark('Esa copia no se puede usar: ' + problem, true); return; }

  const mine = countBackupSets(state);
  const theirs = countBackupSets(data);
  const when = parsed && parsed.saved ? new Date(parsed.saved) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  const okd = await ask({
    title: '¿Reemplazar todo tu registro con esta copia?',
    body: 'Copia' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Ahora mismo tienes: ' + setsLabel(mine) + '.\n\n' +
      (theirs < mine ? 'La copia tiene MENOS registro que lo que hay ahora — comprueba que es la que quieres. ' : '') +
      'No se puede deshacer.',
    okLabel: 'Reemplazar', danger: true,
  });
  if (!okd) return;

  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  migrate();
  applyTheme();
  save(); render();
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

  const okd = await ask({
    title: '¿Sustituir el perfil de ' + local.label + '?',
    body: 'Entra "' + (incoming.label || target) + '"' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Se reemplaza ' + local.label + ', que tiene ahora ' + setsLabel(mine) + '.\n\n' +
      (others.length ? others.join(' y ') + ' no se toca' + (others.length > 1 ? 'n' : '') + '. ' : '') +
      'No se puede deshacer.',
    okLabel: 'Sustituir', danger: true,
  });
  if (!okd) return;

  snapshotForUndo('Perfil de ' + local.label + ' sustituido.');
  state.profiles[target] = incoming;
  migrate();
  applyTheme();
  save(); render();
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
    acts.style.display = 'none';
    return;
  }

  persisted().then(safe => {
    line.textContent = safe
      ? size + ' Está protegido: el navegador no lo borrará para hacer sitio, solo lo pierdes si borras los datos del sitio o desinstalas la app.'
      : size + ' No está protegido: si al móvil le falta espacio, el navegador puede borrarlo para hacer sitio. Instalar la app y pulsar aquí lo evita.';
    acts.style.display = safe ? 'none' : '';
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

  $('bClose').onclick = () => closeSheet('sheet');

  $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet('sheet'); });

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
