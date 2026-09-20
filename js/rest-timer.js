/* ---------- rest timer ----------
   The countdown is driven off a wall-clock end time (tEndAt), not a
   decrementing counter, so it self-corrects instantly when the phone
   was locked/backgrounded and setInterval got throttled or paused —
   the moment you look at the screen again it shows the real elapsed
   time instead of whatever it happened to freeze at. The Wake Lock
   request below tries to stop the screen from locking in the first
   place while a rest period is running, on browsers that support it.

   Split out of js/app.js as the second of the five seams that file's own
   section comments mark (plans/008 item 13): the countdown, the klaxon, the
   lock-screen card that keeps it audible from a pocket, the rest
   notification and the wake lock — one subject, and nothing else in the app
   is about any of it.

   Unlike the calculator, five of these are called from app.js: startRest and
   stopRest from the tick handler and from every navigation button,
   renderSoundBtn from drawApp, askForNotifications and keepAliveStop from
   Ajustes. app.js stubs all five to no-ops when this file is not on the page
   — see the comment there for why that matters more than a dead button.

   Loaded before app.js, so — like block-editor.js, diagnostics.js,
   review.js and calculator.js — its DOM wiring waits inside wireRestTimer()
   until app.js calls it. */

/* The countdown's own state. It lived at the top of js/app.js while this
   code did; nothing outside this file reads it. */
let tId = null, tEndAt = 0, tTotal = 0, tOverNotified = false;
let wakeLock = null;
let tLabel = '';

/* `next` names the set you are walking back to, and is optional: an old
   cached app.js calls this with two arguments and the line simply stays
   empty. */
function startRest(sec, label, next) {
  if (!sec) return;
  clearInterval(tId);
  stopAlarmLoop();
  tEndAt = Date.now() + sec * 1000;
  tTotal = sec; tOverNotified = false; tLabel = label;
  $('timer').classList.add('up');
  $('timer').classList.remove('over');
  /* Both guarded: this file is precached in every deployed shell and #tnext
     and #navBar arrived with plans/037's markup, so a precache hole can
     serve this copy against an index.html that has neither — and an
     unguarded read would throw before the countdown ever started
     (AGENTS.md's precache-hole rule, which covers ids as it does symbols). */
  const n = $('tnext');
  if (n) n.textContent = next || '';
  /* The timer takes the bar's place rather than stacking on top of it:
     that is what buys the three controls 44px each (plans/037). */
  const nav = $('navBar');
  if (nav) nav.hidden = true;
  $('tlbl').textContent = 'Descanso · ' + label;
  $('tmsg').setAttribute('aria-live', 'polite');
  $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  tick();
  tId = setInterval(tick, 1000);
  requestWakeLock();
  primeAudio();  /* we are inside the tap that ticked the set — the one moment the browser lets us unlock sound */
  keepAliveStart();
  showMediaSession(label, tEndAt, sec);
}

function tick() {
  const v = $('tval'), f = $('tfill');
  const left = Math.round((tEndAt - Date.now()) / 1000);
  if (left > 0) {
    v.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    f.style.width = (left / tTotal * 100) + '%';
    setMediaPosition(tTotal, tTotal - left);
  } else {
    if (!tOverNotified) {
      tOverNotified = true;
      $('timer').classList.add('over');
      $('tlbl').textContent = 'Vamos';
      /* This is the one message worth interrupting a screen reader for — the
         rest is over and the phone may well be out of sight in a pocket, so
         "polite" (which waits its turn) could go unheard entirely. */
      $('tmsg').setAttribute('aria-live', 'assertive');
      $('tmsg').textContent = 'Se acabó el descanso. Siguiente serie.';
      f.style.width = '100%';
      /* Both before the alarm: with the sound off, startAlarmLoop() has
         nothing to play and hands the audio back immediately, which takes
         the lock-screen card with it. */
      mediaSessionOver();
      notifyRestOver();
      startAlarmLoop();
    }
    const over = Math.abs(left);
    v.textContent = '+' + Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0');
    if (over > 180) stopRest();
  }
}

function stopRest() {
  clearInterval(tId); tId = null;
  stopAlarmLoop();
  keepAliveStop();
  clearRestNotification();
  $('timer').classList.remove('up', 'over');
  const nav = $('navBar');
  if (nav) nav.hidden = false;
  releaseWakeLock();
}
/* The prescribed rest is a starting point, not a rule: the machine is still
   busy, or the set was easier than it looked. Nudging moves the finish line
   without restarting the countdown. */
function nudgeRest(delta) {
  if (!tId) return;
  const left = Math.max(0, Math.round((tEndAt - Date.now()) / 1000));
  const next = Math.max(5, left + delta);
  tEndAt = Date.now() + next * 1000;
  tTotal = Math.max(tTotal, next);
  setMediaPosition(tTotal, tTotal - next);
  if (tOverNotified) {
    tOverNotified = false;
    stopAlarmLoop();
    clearRestNotification();
    keepAliveStart();
    /* The card and its controls were torn down when the alarm gave the audio
       back (see keepAliveStop). Restarting the keep-alive without them would
       take the phone's audio focus — pausing whatever music is playing —
       and give nothing back on the lock screen for it. */
    showMediaSession(tLabel, tEndAt, tTotal);
    $('timer').classList.remove('over');
    $('tlbl').textContent = 'Descanso · ' + tLabel;
    $('tmsg').setAttribute('aria-live', 'polite');
    $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  }
  tick();
}
/* ---------- rest alarm ----------
   Vibration is silent to anyone whose phone is on a bench two metres away,
   and headphones drown the buzz. A short synthesised alarm needs no audio
   file — which matters for a site that has to work offline. Sawtooth waves
   carry more harmonics than a sine or square at the same gain, so they cut
   through gym noise and tinny phone speakers better; a flat, rapid-fire
   same-pitch pulse (rather than a melodic two-tone interval) reads as a
   klaxon instead of a doorbell chime. The whole burst repeats on an
   interval — one beep is easy to miss mid-set — until the rest is skipped,
   nudged, or a repeat cap is hit. */
let audioCtx = null;
let alarmLoopId = null;
const ALARM_REPEATS = 6;
const ALARM_INTERVAL_MS = 1100;

function stopAlarmLoop() {
  if (alarmLoopId) { clearInterval(alarmLoopId); alarmLoopId = null; }
}

function startAlarmLoop() {
  stopAlarmLoop();
  primeAudio();  /* the context may have been suspended while the page was hidden */
  let count = 0;
  const fire = () => {
    if (!state.prefs.sound || count >= ALARM_REPEATS) {
      stopAlarmLoop();
      /* Whatever music this interrupted can have the phone back: the rest is
         over, and the counting-up display needs no audio. */
      keepAliveStop();
      return;
    }
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    count++;
  };
  fire();
  alarmLoopId = setInterval(fire, ALARM_INTERVAL_MS);
}

function primeAudio() {
  if (!state.prefs.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio on this device — the vibration still fires */ }
}

function beep() {
  if (!state.prefs.sound || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const pattern = [1046.5, 1046.5, 1046.5, 1046.5];
    pattern.forEach((freq, i) => {
      const off = i * 0.12;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + off);
      gain.gain.exponentialRampToValueAtTime(0.65, now + off + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + off);
      osc.stop(now + off + 0.1);
    });
  } catch (e) { /* ignore — never let the alarm break the countdown */ }
}

/* aria-checked, not aria-pressed: since plans/037 this is a labelled switch
   ("Aviso sonoro") rather than a four-letter toggle button, and role=switch
   is the one that carries a checked state. */
function renderSoundBtn() {
  const b = $('tsound');
  const on = !!state.prefs.sound;
  b.setAttribute('aria-checked', on ? 'true' : 'false');
  b.title = on ? 'Aviso sonoro activado' : 'Aviso sonoro desactivado';
}

/* ---------- the rest alarm with the phone in a pocket ----------
   Everything above only fires while the page is running, and a phone that
   locks or switches to WhatsApp mid-rest stops running it: timers throttle
   to about once a minute and then the page freezes outright, so the klaxon
   lands whenever you next look at the screen. The wake lock holds the screen
   on, but it dies the moment you press the power button yourself.

   A page that is playing audio is exempt from being frozen, so the fix is to
   play something for the length of the rest. That is what this near-silent
   loop is. It costs something real — Android hands audio focus to whatever
   is playing, which can pause the music you are lifting to — so it is off
   until you turn it on in Ajustes, and it stops the moment the alarm has
   finished rather than running for the whole session.

   With audio playing, the phone shows a media card on the lock screen, and
   Media Session turns that into the rest timer: what you are resting for,
   when it ends, and the same −30 / +30 / skip the app has. */
let keepAlive = null;
let silentTrack = '';

/* Seven seconds of near-silence as a WAV, built here rather than shipped as
   a file so it works offline like everything else. Two details matter: the
   samples alternate ±1 instead of being zero, because an audio service that
   reads the track as digital silence may not count it as playback at all;
   and it is longer than five seconds, under which Chrome declines to show a
   media card. */
function silentWav() {
  if (silentTrack) return silentTrack;
  const rate = 8000, samples = rate * 7, bytes = 44 + samples * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const tag = (at, str) => { for (let i = 0; i < str.length; i++) view.setUint8(at + i, str.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, bytes - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  let raw = '';
  const bytesOut = new Uint8Array(view.buffer);
  for (let i = 0; i < bytesOut.length; i++) raw += String.fromCharCode(bytesOut[i]);
  silentTrack = 'data:audio/wav;base64,' + btoa(raw);
  return silentTrack;
}

function keepAliveStart() {
  if (!state.prefs.bgAlarm) return;
  try {
    if (!keepAlive) {
      keepAlive = new Audio(silentWav());
      keepAlive.loop = true;
      keepAlive.setAttribute('aria-hidden', 'true');
    }
    /* Called from the tap that ticked the set, which is the only moment a
       browser lets a page start playing anything. */
    const started = keepAlive.play();
    if (started && started.catch) started.catch(() => {});
  } catch (e) { /* no audio here — the countdown and the notification stand */ }
}

function keepAliveStop() {
  if (keepAlive) { try { keepAlive.pause(); } catch (e) { /* already gone */ } }
  clearMediaSession();
}

/* The lock-screen card. Set once per rest rather than every tick: rewriting
   the metadata each second makes the notification flicker, and the progress
   bar is what shows the countdown anyway. */
function showMediaSession(label, endsAt, seconds) {
  const ms = navigator.mediaSession;
  if (!ms || !state.prefs.bgAlarm) return;
  try {
    if (window.MediaMetadata) {
      ms.metadata = new MediaMetadata({
        title: 'Descanso · ' + label,
        artist: 'Termina a las ' + new Date(endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        album: 'Heavy Iron',
        artwork: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    }
    ms.playbackState = 'playing';
    setMediaPosition(seconds, 0);
    /* Whatever the phone decides to draw — a pause button, skip, seek — ends
       up doing what the same control does in the app. */
    const handlers = {
      pause: stopRest,
      stop: stopRest,
      nexttrack: stopRest,
      seekforward: () => nudgeRest(30),
      seekbackward: () => nudgeRest(-30),
      previoustrack: () => nudgeRest(-30),
    };
    Object.keys(handlers).forEach(action => {
      try { ms.setActionHandler(action, handlers[action]); } catch (e) { /* not offered here */ }
    });
  } catch (e) { /* no media session — the notification still fires */ }
}

function setMediaPosition(duration, position) {
  const ms = navigator.mediaSession;
  if (!ms || !ms.setPositionState || !duration) return;
  try {
    ms.setPositionState({ duration, position: Math.min(Math.max(position, 0), duration), playbackRate: 1 });
  } catch (e) { /* out-of-range position after a nudge — not worth reporting */ }
}

function clearMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  try {
    ms.playbackState = 'none';
    ms.metadata = null;
    ['pause', 'stop', 'nexttrack', 'seekforward', 'seekbackward', 'previoustrack']
      .forEach(action => { try { ms.setActionHandler(action, null); } catch (e) { /* ignore */ } });
  } catch (e) { /* ignore */ }
}

/* The card again, once the rest is over: same notification, new words. */
function mediaSessionOver() {
  const ms = navigator.mediaSession;
  if (!ms || !ms.metadata || !window.MediaMetadata) return;
  try {
    ms.metadata = new MediaMetadata({
      title: 'Vamos — se acabó el descanso',
      artist: tLabel,
      album: 'Heavy Iron',
      artwork: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch (e) { /* ignore */ }
}

/* A notification is the one thing that still reaches you through a locked
   screen from a page the phone has stopped running, so it is posted whenever
   the rest ends with the app out of sight. Asked for only when the setting
   is switched on: a permission prompt on somebody's first set is how an app
   gets its notifications denied forever. */
const REST_TAG = 'heavy-iron-rest';

function askForNotifications() {
  if (!('Notification' in window)) return Promise.resolve(false);
  if (Notification.permission === 'granted') return Promise.resolve(true);
  if (Notification.permission === 'denied') return Promise.resolve(false);
  return Notification.requestPermission().then(p => p === 'granted').catch(() => false);
}

function notifyRestOver() {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.ready
    .then(reg => reg.showNotification('Se acabó el descanso', {
      body: tLabel ? 'Siguiente serie · ' + tLabel : 'Siguiente serie',
      tag: REST_TAG,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
    }))
    .catch(() => { /* the phone said no — the klaxon is still trying */ });
}

/* Coming back to the app answers the notification, so it does not sit in the
   shade over a rest you have already got on with. */
function clearRestNotification() {
  if (!navigator.serviceWorker || !('Notification' in window) || Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready
    .then(reg => reg.getNotifications({ tag: REST_TAG }))
    .then(list => list.forEach(n => n.close()))
    .catch(() => { /* ignore */ });
}

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    /* A second rest started while one is live (a superset, a set ticked
       during the countdown) used to request a second lock and drop the
       first reference on the floor; "saltar" then released only the one it
       could see, and the screen stayed on for the whole session (plans/013).
       The test is .released and not bare truth because the browser releases
       the lock itself when the tab is hidden without telling this variable:
       a plain `if (wakeLock)` would turn the visibilitychange re-acquire in
       wireRestTimer() into a no-op and let the screen sleep instead. */
    if (wakeLock && !wakeLock.released) return;
    const lock = await navigator.wakeLock.request('screen');
    /* stopRest() can run while the request above is in flight (tapping
       "saltar" mid-request); if the rest is already over by the time the
       lock resolves, release it instead of holding a lock with no timer. */
    if (!tId) { lock.release().catch(() => {}); return; }
    /* Same again for two rests started in the same tick: both cleared the
       guard above before either request resolved, so the one that lands
       second lets go of its own lock rather than overwriting the first. */
    if (wakeLock && !wakeLock.released) { lock.release().catch(() => {}); return; }
    wakeLock = lock;
  } catch (e) { /* not supported, or permission denied — countdown still self-corrects on tick */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}


/* Every line here needs $(), which js/app.js defines — and js/app.js is the
   last script on the page. See the call site at the foot of that file. */
function wireRestTimer() {
  $('tskip').onclick = stopRest;
  $('tminus').onclick = () => nudgeRest(-30);
  $('tplus').onclick = () => nudgeRest(30);

  $('tsound').onclick = () => {
    state.prefs.sound = !state.prefs.sound;
    renderSoundBtn();
    save();
    if (state.prefs.sound) { primeAudio(); beep(); }
    else { stopAlarmLoop(); }
  };

  /* Coming back to the page is the moment the countdown has to re-read the
     wall clock: setInterval was throttled or stopped outright while the tab
     was hidden, and the wake lock was released by the browser. The other
     half of this event — flushing the pending write — is app.js's, and
     stayed there. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return;
    clearRestNotification();
    if (tId) {
      tick();
      requestWakeLock();
    }
  });
}
