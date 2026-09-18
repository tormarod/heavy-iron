/* ---------- QR transfer ----------
   The two of you are standing next to each other in a gym with no signal and
   one of you edited the plan. Every other way to move it — a file, a chat, a
   mail to yourself — needs something this app deliberately does not have: a
   network. The camera is the one channel that is already there.

   So: one phone draws the data as QR codes, the other reads them off the
   screen. Nothing is uploaded, nothing is fetched, the CSP is untouched
   (`getUserMedia` is not a network request and both libraries are vendored
   under `script-src 'self'`), and the "nothing leaves the device" promise in
   the README stays literally true — the data goes device → photons → device.

   Three things can be sent, smallest first, because size is the whole problem:

     bloque    the plan only. Usually one or two frames.
     bloque+   the plan *and* every set logged against it, for the profile
               sending it. The common case: "put my block on your phone so we
               can both see where I am."
     perfil    the whole profile — every block, every log. Biggest, slowest,
               and it *replaces* a profile on the other phone rather than
               adding to it, so it asks first through the same confirmation
               the file-based profile transfer already uses.

   A single QR that a phone camera can actually read across a gym holds a few
   hundred bytes, and a profile with months of history is tens of kilobytes.
   So the payload is deflated, base64'd and cut into numbered frames that
   cycle on screen; the reader collects them by index until it has the set.
   Frames may arrive in any order and repeat freely — that is the point of
   the animation, you just hold the phone there until it fills up.

   Split out of js/app.js as the last of the five seams that file's own
   section comments mark (plans/008 item 13), and split down the middle of
   its own section: what travelled is the wire format and the sheet — the
   camera's business. What stayed is the vocabulary either side of it, the
   blockShare* builders and the normalizeImported* validators, because
   js/block-editor.js, js/review.js and js/profile-transfer.js all read
   them. profile-transfer.js especially: sharing those per-row checks with
   the restore path is what plans/008 item 4 was, and a screen going
   missing must not quietly take a backup's validation with it.

   app.js asks one thing of this file — closeQr, from the Escape handler
   that closes the top sheet — and stubs it to a no-op when the file is not
   on the page.

   Loaded before app.js, so — like the other split files — its DOM wiring
   waits inside wireQrTransfer() until app.js calls it. */

const QR_MAGIC = 'HI1';
/* Base64 characters per frame. Plus a ~30-character header this lands each
   frame at QR version 18 (89×89 modules) at error-correction level M, which
   is about as dense as a phone screen can be read at arm's length in bad
   light. Raising it means fewer frames that are each harder to catch. */
const QR_CHUNK = 480;
/* Past this the animation takes longer than a person will stand still for,
   and the file-based transfer is simply the better tool. */
const QR_MAX_FRAMES = 60;
const QR_FRAME_MS = 500;

/* ---- checksum ----
   QR carries Reed–Solomon error correction of its own: a frame that decodes
   at all is essentially never wrong, so per-frame checksums would be belt
   and braces. What is worth catching is a *reassembly* fault — frames from
   two different shares mixed together, or a chunk quietly lost. The random
   transfer id catches the first, this CRC over the whole payload the
   second, and it is checked before anything is parsed. */
const CRC32_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(str) {
  let c = 0 ^ (-1);
  for (let i = 0; i < str.length; i++) c = (c >>> 8) ^ CRC32_TABLE[(c ^ str.charCodeAt(i)) & 0xFF];
  return ((c ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

/* ---- base64url ----
   Plain base64 uses '+' and '/', and '/' is awkward the moment any of this
   is ever pasted into a URL or a file name. The url-safe alphabet costs
   nothing and avoids the question. Padding is dropped and re-added on the
   way back in. */
function bytesToB64u(bytes) {
  let bin = '';
  /* String.fromCharCode has an argument limit, so this walks in slices
     rather than spreading a 40 000-byte array into one call. */
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---- compression ----
   A block's log is the same three keys repeated a few hundred times, which
   is exactly what deflate is good at — usually an 8–10× win, and that is
   the difference between four frames and forty. CompressionStream is in
   every browser this app targets, but if it is missing the payload simply
   travels uncompressed and the header says so, rather than the feature
   disappearing. */
async function qrDeflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch (e) { return null; }
}

/* Compressed input is already bounded to ~16 KB (QR_MAX_FRAMES × QR_CHUNK),
   so deflate's ~1000x worst case tops out a few MB, not unbounded — but this
   is camera input pointed at a screen someone else controls, and reading the
   whole decompressed stream into memory before any shape check is still the
   wrong shape for that. Read it in chunks against a budget several times
   past any real profile instead. */
const QR_INFLATE_MAX_BYTES = 8 * 1024 * 1024;

async function qrInflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > QR_INFLATE_MAX_BYTES) {
      reader.cancel();
      throw new Error('El código trae más datos de los que la app admite.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(c => { out.set(c, offset); offset += c.length; });
  return out;
}

/* ---- frames ----
   HI1|<id>|<index>|<total>|<crc32>|<enc>|<data>
   `id` is a random per-transfer tag: start a second share while someone is
   still scanning the first and the reader notices the id changed and starts
   over, instead of welding halves of two payloads together. */
async function qrPackFrames(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const squeezed = await qrDeflate(raw);
  /* Only take the compressed form if it actually won — for a tiny payload
     deflate's own header can make it bigger. */
  const useDeflate = squeezed && squeezed.length < raw.length;
  const b64 = bytesToB64u(useDeflate ? squeezed : raw);
  const enc = useDeflate ? 'd' : 'p';
  const id = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const crc = crc32(b64);
  const total = Math.max(1, Math.ceil(b64.length / QR_CHUNK));
  const frames = [];
  for (let i = 0; i < total; i++) {
    frames.push([QR_MAGIC, id, i, total, crc, enc, b64.slice(i * QR_CHUNK, (i + 1) * QR_CHUNK)].join('|'));
  }
  return { frames, id, total, bytes: raw.length, sent: b64.length, enc };
}

function qrParseFrame(text) {
  if (typeof text !== 'string') return null;
  const p = text.split('|');
  if (p.length < 7 || p[0] !== QR_MAGIC) return null;
  const i = +p[2], n = +p[3];
  if (!Number.isInteger(i) || !Number.isInteger(n)) return null;
  if (n < 1 || n > QR_MAX_FRAMES || i < 0 || i >= n) return null;
  if (!/^[0-9a-f]{8}$/.test(p[4]) || (p[5] !== 'd' && p[5] !== 'p')) return null;
  /* Anything after the sixth separator is payload. base64url never contains
     '|', so this only ever rejoins a single piece — it is here so a stray
     separator can't silently truncate the data. */
  return { id: p[1], i, n, crc: p[4], enc: p[5], data: p.slice(6).join('|') };
}

/* The receiving end of a transfer: hand it whatever the camera decoded and
   it tells you where it is up to. Deliberately a plain object with no DOM
   in it, so the whole protocol can be round-tripped in a test without a
   camera anywhere near it. */
function qrReceiver() {
  return {
    id: null, total: 0, crc: '', enc: '', parts: new Map(),
    get count() { return this.parts.size; },
    get complete() { return this.total > 0 && this.parts.size === this.total; },
    reset() { this.id = null; this.total = 0; this.crc = ''; this.enc = ''; this.parts = new Map(); },
    /* 'foreign'  — not one of ours (a wifi QR, a poster, noise)
       'restart'  — a different transfer appeared; the old partial is dropped
       'added'    — a frame we did not have
       'dup'      — one we already had, which is most of them while it cycles */
    accept(text) {
      const f = qrParseFrame(text);
      if (!f) return 'foreign';
      let status = 'added';
      if (this.id !== f.id) { this.reset(); this.id = f.id; status = 'restart'; }
      this.total = f.n; this.crc = f.crc; this.enc = f.enc;
      if (this.parts.has(f.i)) return status === 'restart' ? 'restart' : 'dup';
      this.parts.set(f.i, f.data);
      return status;
    },
    joined() {
      let out = '';
      for (let i = 0; i < this.total; i++) {
        const part = this.parts.get(i);
        if (part == null) return null;
        out += part;
      }
      return out;
    },
    /* Throws rather than returning null on a bad payload: every failure here
       is worth showing the person holding the phone, and they are different
       problems with different fixes. */
    async payload() {
      /* Checked before joining so an empty or half-filled receiver says what
         is actually wrong, rather than failing the checksum further down and
         blaming the frames it did get. */
      if (!this.complete) throw new Error('Faltan fotogramas.');
      const b64 = this.joined();
      if (b64 == null) throw new Error('Faltan fotogramas.');
      if (crc32(b64) !== this.crc) throw new Error('Los fotogramas no encajan — vuelve a escanear.');
      let bytes = b64uToBytes(b64);
      if (this.enc === 'd') {
        if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir el código.');
        bytes = await qrInflate(bytes);
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}

/* ---- drawing one frame ----
   Always dark-on-light with a four-module quiet zone, whatever the app's
   theme is: an inverted QR is a coin flip across readers, and the person
   pointing a camera at this has no way to know that is why it will not
   catch. One <path> rather than a rect per module — a version-17 code is
   7 000 modules and that many elements makes the animation stutter. */
function buildQrSVG(text) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    }
  }
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="qr-svg" shape-rendering="crispEdges" ' +
         'role="img" aria-label="Código QR"><rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
         '<path d="' + d + '" fill="#000"/></svg>';
}

/* ---- loading the two vendored libraries ----
   Neither is touched until this sheet opens, so the app still starts on the
   same bytes it did before the feature existed. Injecting a same-origin
   <script> is allowed by `script-src 'self'` — no CSP change, which is the
   whole reason they are vendored rather than pulled from a CDN. */
const qrScripts = {};
function loadScriptOnce(src) {
  if (!qrScripts[src]) {
    qrScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete qrScripts[src]; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return qrScripts[src];
}
const qrEncoderReady = () => (typeof qrcode !== 'undefined' ? Promise.resolve() : loadScriptOnce('js/vendor/qrcode.js'));
const qrDecoderReady = () => (typeof jsQR !== 'undefined' ? Promise.resolve() : loadScriptOnce('js/vendor/jsQR.js'));

/* ---------- the sheet ---------- */
let qrMode = 'show';           /* 'show' | 'scan' */
let qrKind = 'blocklog';       /* what the show side is sending */
let qrFrames = [];
let qrAt = 0;
let qrTimer = null;
let qrPaused = false;
let qrStream = null;
let qrScanTimer = null;
let qrRx = null;
let qrBusy = false;
let qrShowToken = 0;

function openQr() {
  qrMode = 'show';
  openSheet('qrSheet');
  drawQr();
}

/* Everything this sheet starts has to be stopped here: a timer redrawing a
   QR nobody is looking at is merely wasteful, but a camera left streaming
   after the sheet closes is a light on the phone and a fair question about
   what this app is doing. */
function closeQr() {
  stopQrShow();
  stopQrScan();
  closeSheet('qrSheet');
}

/* Bumping the token is what cancels a build still in flight — closing the
   sheet while the deflate is running would otherwise let it finish and start
   an interval redrawing frames into a panel nobody can see. */
function stopQrShow() {
  qrShowToken++;
  if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
  qrFrames = []; qrAt = 0; qrPaused = false;
}

function stopQrScan() {
  if (qrScanTimer) { clearInterval(qrScanTimer); qrScanTimer = null; }
  if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  const v = $('qrVideo');
  if (v) v.srcObject = null;
  qrRx = null;
}

function drawQr() {
  $('qrMode').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === qrMode ? 'true' : 'false');
    b.onclick = () => {
      if (qrMode === b.dataset.mode) return;
      stopQrShow(); stopQrScan();
      qrMode = b.dataset.mode;
      drawQr();
    };
  });
  const showing = qrMode === 'show';
  /* .hidden on both, not .style.display for one of them: index.html ships
     qrScanPane with the `hidden` attribute (plans/008 item 22), and clearing
     an inline style there would leave that attribute in charge, never
     showing the scanner — so both panes toggle the same property rather than
     splitting the pair across two mechanisms. */
  $('qrShowPane').hidden = !showing;
  $('qrScanPane').hidden = showing;
  if (showing) { stopQrScan(); drawQrShow(); }
  else { stopQrShow(); startQrScan(); }
}

/* ---- show ---- */
function drawQrShow() {
  const profile = getProfile(), block = getBlock();
  const logged = blockLoggedSets(profile, block.id);
  const doneSets = blockDoneSets(profile, block.id);

  $('qrKind').querySelectorAll('.seg-btn').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.kind === qrKind ? 'true' : 'false');
    b.onclick = () => { qrKind = b.dataset.kind; drawQrShow(); };
  });

  const desc = {
    block: 'Solo el plan de "' + block.name + '": ejercicios, series, repeticiones y descansos. ' +
           'Se añade como bloque nuevo en el otro móvil, sin tocar nada de lo que ya tenga.',
    blocklog: 'El plan de "' + block.name + '" y lo que llevas hecho en él: ' + setsWithDoneLabel(logged, doneSets) + '. ' +
              'También entra como bloque nuevo: no sustituye nada.' +
              (logged > doneSets
                ? ' Ojo: las ' + (logged - doneSets) + ' sin marcar viajan con su peso y sus reps, pero llegan sin marcar — ' +
                  'igual que aquí, no cuentan para las gráficas hasta que les des al ✓.'
                : ''),
    profile: 'Todo el perfil de ' + profile.label + ': todos sus bloques y todo su registro. ' +
             'En el otro móvil sustituye a ese perfil entero — te lo preguntará antes.',
  }[qrKind];
  $('qrShowDesc').textContent = desc;

  const host = $('qrHost');
  host.innerHTML = '<p class="chart-empty">Preparando…</p>';
  $('qrCount').textContent = '';
  stopQrShow();

  const token = ++qrShowToken;
  const kind = qrKind;

  buildQrPayload(kind, profile, block)
    .then(async payload => {
      await qrEncoderReady();
      const packed = await qrPackFrames(payload);
      /* The sheet may have been closed, or the selection changed, while the
         libraries and the deflate were in flight. */
      if (token !== qrShowToken) return;
      if (packed.total > QR_MAX_FRAMES) {
        host.innerHTML = '<p class="chart-empty">Esto ocupa demasiado para pasarlo por la cámara (' +
          packed.total + ' fotogramas). Usa "Descargar copia" o "Exportar ' + esc(profile.label) +
          '" y pasa el archivo.</p>';
        return;
      }
      qrFrames = packed.frames;
      /* Only here, with the frames about to go on screen: the nag counts
         sessions since the data actually left the phone, and picking
         "perfil" in the segmented control is not that — neither is being
         told a paragraph later that the payload is too big to send at all,
         which is what the return above used to do after the counter had
         already been wiped (plans/013). The other reset sites
         (js/profile-transfer.js, js/app.js) fire on the same rule. */
      if (kind === 'profile') resetBackupNag();
      qrAt = 0;
      renderQrFrame();
      if (qrFrames.length > 1) {
        qrTimer = setInterval(() => {
          if (qrPaused) return;
          qrAt = (qrAt + 1) % qrFrames.length;
          renderQrFrame();
        }, QR_FRAME_MS);
      }
    })
    .catch(e => {
      if (token !== qrShowToken) return;
      host.innerHTML = '<p class="chart-empty">' + esc(e.message || 'No se pudo generar el código.') + '</p>';
    });
}

async function buildQrPayload(kind, profile, block) {
  const base = { app: STORAGE_KEY, v: 1, saved: new Date().toISOString() };
  if (kind === 'profile') {
    /* Shaped exactly like the profile file the app already exports, so the
       receiving side can hand it straight to loadProfileFromText. */
    return Object.assign(base, { kind: 'profile', key: state.activeProfile, profile: state.profiles[state.activeProfile] });
  }
  const plan = blockSharePlan(block);
  if (kind === 'block') return Object.assign(base, { kind: 'block', from: profile.label, block: plan });
  return Object.assign(base, { kind: 'blocklog', from: profile.label, block: plan,
    log: blockShareLog(profile, block), rir: blockShareRir(profile, block), order: blockShareOrder(profile, block) });
}

function renderQrFrame() {
  const host = $('qrHost');
  try {
    host.innerHTML = buildQrSVG(qrFrames[qrAt]);
  } catch (e) {
    host.innerHTML = '<p class="chart-empty">No se pudo dibujar el código.</p>';
    stopQrShow();
    return;
  }
  const total = qrFrames.length;
  $('qrCount').textContent = total === 1
    ? 'Un solo código — apunta con el otro móvil.'
    : 'Fotograma ' + (qrAt + 1) + '/' + total + ' — mantén el otro móvil apuntando hasta que los recoja todos.';
  /* .hidden, not .style.display — same reason as qrScanPane above. */
  $('qrPause').hidden = total <= 1;
  $('qrPause').textContent = qrPaused ? 'Reanudar' : 'Pausa';
}

/* ---- scan ---- */
async function startQrScan() {
  const status = $('qrScanStatus');
  qrRx = qrReceiver();
  status.textContent = 'Pidiendo permiso para la cámara…';
  $('qrScanProgress').textContent = '';

  let stream;
  try {
    await qrDecoderReady();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    /* No camera, no permission, or an insecure origin. None of them are worth
       a dead end: the file transfer above does the same job. */
    status.textContent = e && e.message === 'nocam'
      ? 'Este navegador no da acceso a la cámara. Usa "Cargar copia" o "Cargar un perfil" con un archivo.'
      : 'Sin acceso a la cámara. Dale permiso en el navegador, o pasa los datos con un archivo desde los botones de arriba.';
    return;
  }
  if (qrMode !== 'scan' || !$('qrSheet').classList.contains('up')) { stream.getTracks().forEach(t => t.stop()); return; }

  qrStream = stream;
  const video = $('qrVideo');
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  try { await video.play(); } catch (e) { /* some browsers resolve this late; the frame loop copes */ }
  status.textContent = 'Apunta al código del otro móvil.';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  qrScanTimer = setInterval(() => {
    if (qrBusy || !qrStream || !video.videoWidth) return;
    /* Downscaled: a version-17 code still resolves to several pixels per
       module at this width, and reading a full 1280px frame every 120 ms
       makes the preview stutter on an older phone. */
    const scale = Math.min(1, 720 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let result;
    try {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    } catch (e) { return; }
    if (!result || !result.data) return;

    const status2 = qrRx.accept(result.data);
    if (status2 === 'foreign') return;
    $('qrScanProgress').textContent = 'Recibido ' + qrRx.count + '/' + qrRx.total;
    if (!qrRx.complete) return;

    qrBusy = true;
    const rx = qrRx;
    stopQrScan();
    $('qrScanStatus').textContent = 'Comprobando…';
    rx.payload()
      .then(payload => applyQrPayload(payload))
      .catch(e => { mark(e.message || 'No se pudo leer el código', true); })
      .then(() => { qrBusy = false; });
  }, 120);
}

/* The last step, and the one place all of this rejoins the app: every kind
   lands in the confirmation flow that the file-based transfer already uses,
   so arriving by camera is not a way to get looser validation than arriving
   by file. */
async function applyQrPayload(payload) {
  if (!payload || typeof payload !== 'object') { mark('Ese código no trae datos de Heavy Iron', true); return; }

  if (payload.kind === 'profile') {
    closeQr();
    await loadProfileFromText(JSON.stringify(payload));
    return;
  }

  if (payload.kind === 'block' || payload.kind === 'blocklog') {
    let normalized;
    try {
      normalized = normalizeImportedBlock(payload.block);
    } catch (e) {
      mark('Ese bloque no se puede usar: ' + e.message, true);
      return;
    }
    const log = payload.kind === 'blocklog' ? normalizeImportedLog(payload.log, payload.block, normalized) : null;
    const rir = payload.kind === 'blocklog' ? normalizeImportedRir(payload.rir, payload.block, normalized) : null;
    const order = payload.kind === 'blocklog' ? normalizeImportedOrder(payload.order, payload.block, normalized) : null;
    const sets = log ? countShareLog(log) : 0;
    const doneSets = log ? countShareLog(log, true) : 0;
    const profile = getProfile();
    const from = txt(payload.from, IMPORT_LIMITS.name);

    const okd = await ask({
      title: '¿Añadir "' + normalized.name + '"?',
      body: 'Llega' + (from ? ' de ' + from : '') + ': ' + normalized.days.length +
        (normalized.days.length === 1 ? ' día' : ' días') + ', ' + normalized.weeks +
        (normalized.weeks === 1 ? ' semana' : ' semanas') +
        (log ? ' y ' + setsWithDoneLabel(sets, doneSets) : ', sin registro') + '.\n\n' +
        (log && sets > doneSets
          ? 'Las ' + (sets - doneSets) + ' sin marcar traen peso y reps pero llegan sin el ✓, tal y como estaban en el otro móvil.\n\n'
          : '') +
        'Entra como bloque nuevo en ' + profile.label + ' y pasa a ser el bloque activo. ' +
        'No se toca nada de lo que ya tienes.',
      okLabel: 'Añadir',
    });
    if (!okd) return;

    closeQr();
    installImportedBlock(normalized, log, rir, order);
    flushSave();
    mark('Bloque "' + normalized.name + '" añadido' + (log && sets ? ' con ' + setsWithDoneLabel(sets, doneSets) : '') + ' en ' + profile.label);
    return;
  }

  mark('Ese código es de otra cosa, no de Heavy Iron', true);
}


/* Every line here needs $(), which js/app.js defines — and js/app.js is the
   last script on the page. See the call site at the foot of that file. */
function wireQrTransfer() {
  $('qrBtn').onclick = openQr;
  registerSheet('qrSheet', { closeBtn: 'qrClose', onClose: closeQr });
  $('qrPause').onclick = () => { qrPaused = !qrPaused; renderQrFrame(); };
}
