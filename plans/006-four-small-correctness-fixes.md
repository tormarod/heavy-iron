# Plan 006: Four small, independent correctness fixes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/app.js js/review.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

Four verified defects, each a one- or two-line fix in a different part of the
app. They are bundled because each is too small to justify its own review
cycle, and because they share a verification story (the existing smoke suite
plus one new assertion each where warranted). **The four steps are
independent** — if one turns out to be wrong, drop that step and land the
other three.

1. **Switching week, day or person is never saved.** Three handlers change
   state and re-render without calling `save()`. Background the app after one
   of them and it reopens where you were before. Worse, the two-tab
   reconciler treats "nothing pending" as permission to adopt the other tab's
   state wholesale, so the unsaved switch is silently clobbered instead of
   raising the warning that handler exists to show.
2. **The exported block review says "kg" even in pounds.** That text is
   explicitly designed to be handed to an external model to write the next
   training block, so a mislabelled unit feeds straight into the next
   programming decision.
3. **The lock-screen card is not restored when a finished rest is nudged.**
   With the background alarm on, pressing +30 after the rest ran out restarts
   the near-silent keep-alive track — taking audio focus and pausing the
   user's music, the cost that setting warns about — while the lock-screen
   controls stay gone. The user pays the price of the feature and gets none
   of the benefit.
4. **The service worker caches opaque cross-origin responses.** An opaque
   response has an unreadable status, so a captive portal's interception page
   is indistinguishable from a real font and gets written to the runtime
   cache — then served on every launch, including offline, until
   `CACHE_VERSION` changes.

## Current state

### Fix 1 — three handlers that render without saving

`js/app.js:1966` (profile switch):

```js
    b.onclick = () => { state.activeProfile = key; stopRest(); render(); };
```

`js/app.js:2065` (week switch):

```js
    b.onclick = () => { profile.week = w; stopRest(); render(); };
```

`js/app.js:2079` (day switch):

```js
    b.onclick = () => { profile.day = i; stopRest(); render(); };
```

The block picker sitting immediately beside them already does it correctly —
`js/block-editor.js:34`:

```js
  select.onchange = () => { profile.activeBlock = select.value; profile.week = 1; profile.day = 0; stopRest(); save(); render(); };
```

Why the second failure mode follows, `js/app.js:389-394` and `js/app.js:403-406`:

```js
function flushSave() {
  if (!saveT) return;
  clearTimeout(saveT);
  saveT = null;
  writeState();
}
```

```js
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || frozen || !ready) return;
  if (saveT) {
    toast('Otra pestaña ha guardado cambios. Aquí tienes cambios sin guardar: al guardarlos se quedarán los tuyos.', 'Recargar', () => location.reload());
```

`saveT` is the only evidence of pending work. Without a `save()` call, a
navigation change leaves `saveT` null, so `flushSave` writes nothing and the
`storage` handler takes the silent-adopt branch.

### Fix 2 — hardcoded unit in the exported review

`js/review.js:167`:

```js
      L.push('- ' + k + ': ' + e[k].n + (e[k].n === 1 ? ' sesión' : ' sesiones') +
        ', media de ' + Math.round(e[k].kg) + ' kg movidos.');
```

`js/review.js:134`:

```js
  L.push('- Series marcadas como hechas: ' + r.sets + '. Kilos movidos: ' + Math.round(r.tonnage) + '.');
```

The rest of the app resolves the label at render time. `js/app.js:1334`:

```js
const fmtKg = n => Math.round(n).toLocaleString('es-ES') + ' ' + units();
```

`js/app.js:365`:

```js
const units = () => state.prefs.units;
```

And `js/review.js:196` — the on-screen version of the same summary — already
does it right:

```js
    r.weeksLogged + ' con registro, ' + setsLabel(r.sets) + ', ' + fmtKg(r.tonnage) + ' movidos.';
```

Only the two exported-text lines above are wrong. Confirm with
`grep -n "kg" js/review.js` — line 167 is the only hardcoded unit string.

### Fix 3 — the lock-screen card is not restored on nudge

`js/app.js:1610-1627`:

```js
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
    $('timer').classList.remove('over');
    $('tlbl').textContent = 'Descanso · ' + tLabel;
    $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
  }
  tick();
}
```

The card was torn down when the alarm finished. `js/app.js:1655-1658`, inside
`startAlarmLoop`'s `fire()`:

```js
    if (!state.prefs.sound || count >= ALARM_REPEATS) {
      stopAlarmLoop();
      /* Whatever music this interrupted can have the phone back: the rest is
         over, and the counting-up display needs no audio. */
      keepAliveStop();
```

and `keepAliveStop` (`js/app.js:1776-1779`):

```js
function keepAliveStop() {
  if (keepAlive) { try { keepAlive.pause(); } catch (e) { /* already gone */ } }
  clearMediaSession();
}
```

`clearMediaSession` (`js/app.js:1825-1834`) nulls the metadata and unregisters
every action handler. The only thing that ever re-establishes it is
`showMediaSession`, called from `startRest` alone (`js/app.js:1567`):

```js
  showMediaSession(label, tEndAt, sec);
```

`tLabel`, `tEndAt` and `tTotal` are all module-level and current at the point
`nudgeRest` needs them (`js/app.js:13` and `js/app.js:1550`).

### Fix 4 — opaque responses cached cache-first

`sw.js:106-117`:

```js
function cacheFirst(request, cacheName) {
  return caches.match(request).then(hit => {
    if (hit) return hit;
    return fetch(request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(request, copy));
      }
      return response;
    });
  });
}
```

The font route that reaches it, `sw.js:145-147`:

```js
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
```

Same-origin requests are never opaque, so only the font route is affected. The
webfont is already deliberately non-blocking (`index.html:32` loads it as
`media="print"`, flipped by `enableWebfont` in `js/app.js`), so a font that
has to be re-fetched costs nothing but a request.

### Repo conventions

- Comments explain *why*, in prose, often naming the failure prevented.
- Spanish for user-facing strings, English for code comments.
- No build step, no modules; one shared global scope.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check js/app.js && node --check js/review.js && node --check sw.js` | exit 0 |
| Install test dep | `npm install --no-save playwright@1.56.1` | exit 0 |
| Serve the site | `python3 -m http.server 8765` (leave running) | serves on 127.0.0.1:8765 |
| Smoke tests | `node test/smoke.js` | 0 failures |

## Scope

**In scope**:

- `js/app.js` — the three navigation handlers, and `nudgeRest`
- `js/review.js` — two string lines
- `sw.js` — `cacheFirst`, and `CACHE_VERSION`
- `test/smoke.js` — new assertions for fixes 1 and 2

**Out of scope**:

- The debounce interval or the structure of `save`/`flushSave`/`writeState`
  (`js/app.js:371-394`) — fix 1 adds calls, it does not change the mechanism.
- The `storage` event handler (`js/app.js:403-417`) — fix 1 makes its existing
  logic correct by giving it accurate evidence; the handler itself is fine.
- `showMediaSession`, `clearMediaSession`, `keepAliveStart`, `keepAliveStop`
  (`js/app.js:1761-1834`) — fix 3 adds one call, it does not change them.
- The `install` handler in `sw.js` (lines 48-55), which swallows individual
  precache failures. That is a real separate issue, tracked in
  `plans/README.md`; do not fix it here.
- Self-hosting the webfont. A larger change with its own trade-offs; fix 4 is
  only about not caching unreadable responses.

## Git workflow

- Branch: `advisor/006-small-correctness-fixes`
- **One commit per fix**, so any single one can be reverted independently.
  Message style: short imperative sentence, no prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Persist week, day and profile switches

In `js/app.js`, add `save()` before `render()` in all three handlers, matching
the block picker at `js/block-editor.js:34`:

- line 1966 → `b.onclick = () => { state.activeProfile = key; stopRest(); save(); render(); };`
- line 2065 → `b.onclick = () => { profile.week = w; stopRest(); save(); render(); };`
- line 2079 → `b.onclick = () => { profile.day = i; stopRest(); save(); render(); };`

**Verify**: `node --check js/app.js` → exit 0, and
`grep -n "stopRest(); render();" js/app.js` returns **no matches**.

### Step 2: Follow the unit setting in the exported review

In `js/review.js`, line 167, replace the hardcoded `' kg movidos.'`:

```js
      L.push('- ' + k + ': ' + e[k].n + (e[k].n === 1 ? ' sesión' : ' sesiones') +
        ', media de ' + Math.round(e[k].kg) + ' ' + units() + ' movidos.');
```

And line 134, where the label itself names the unit. Make it unit-neutral and
append the real one:

```js
  L.push('- Series marcadas como hechas: ' + r.sets + '. Peso movido: ' + Math.round(r.tonnage) + ' ' + units() + '.');
```

Do **not** switch these to `fmtKg` — it adds Spanish thousands separators
(`toLocaleString('es-ES')`), and this text is parsed by a language model, so a
plain integer is the safer output. Keep `Math.round`.

**Verify**: `node --check js/review.js` → exit 0, and
`grep -n " kg" js/review.js` returns no matches.

### Step 3: Restore the lock-screen card when a finished rest is nudged

In `js/app.js`, inside `nudgeRest`'s `if (tOverNotified)` branch, add a
`showMediaSession` call after `keepAliveStart()`:

```js
    keepAliveStart();
    /* The card and its controls were torn down when the alarm gave the audio
       back (see keepAliveStop). Restarting the keep-alive without them would
       take the phone's audio focus — pausing whatever music is playing —
       and give nothing back on the lock screen for it. */
    showMediaSession(tLabel, tEndAt, tTotal);
```

Place it after `keepAliveStart()` and before the three DOM writes. Leave the
`setMediaPosition(tTotal, tTotal - next)` call earlier in the function alone —
`tick()` at the end refreshes the position anyway.

**Verify**: `node --check js/app.js` → exit 0, and
`grep -n "showMediaSession" js/app.js` returns **three** lines: the definition,
the `startRest` call, and the new one.

### Step 4: Stop caching opaque responses

In `sw.js`, change the condition in `cacheFirst` from

```js
      if (response && (response.ok || response.type === 'opaque')) {
```

to

```js
      /* Only responses we can actually read the status of. An opaque response
         reports status 0 whether it is a real font or a captive portal's
         interception page, and this cache is served first on every later
         launch — so caching one would pin whatever the network handed back
         until CACHE_VERSION moves. A font re-fetched on each cold load costs
         a request; the webfont is already non-blocking (see index.html). */
      if (response && response.ok) {
```

**Verify**: `node --check sw.js` → exit 0, and
`grep -n "opaque" sw.js` returns no matches.

### Step 5: Add smoke assertions for fixes 1 and 2

Fixes 3 and 4 are not practically assertable in this suite — Media Session
state and cross-origin opaque responses are not observable from Playwright
here. Do not contort the suite to cover them; note them in your report instead.

**For fix 1**, add to `test/smoke.js` (place it near the existing navigation
assertions — find them with `grep -n "== boot ==\|weeks\|days" test/smoke.js`):

```js
    // A week/day switch must reach localStorage on its own: nothing else is
    // going to write it if the phone goes into a pocket straight after.
    await page.click('#weeks button >> nth=1');
    await page.waitForTimeout(600);
    ok('switching week is saved without any other edit',
       await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.week) === 2,
       String(await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.week)));
```

Adjust the profile key and selector to match what the surrounding test context
actually has — read the neighbouring assertions first. The 600 ms wait must
exceed the 400 ms debounce at `js/app.js:386`; that is the point of the test.

**For fix 2**, assert the exported review text follows the unit setting. The
existing suite sets units to `lb` during first-run setup
(`test/smoke.js:~70`, `await page.click('#setupUnits >> text=lb')`), so find a
context in `lb` and assert the generated review text contains `lb` and not
` kg`. Locate the review export with
`grep -n "reviewPrompt\|reviewText\|Copiar" test/smoke.js` and follow the
pattern already used there.

**Verify**: `node --check test/smoke.js` → exit 0.

### Step 6: Bump `CACHE_VERSION` and run the suite

Read `sw.js:20` and increment the integer by one.

```bash
python3 -m http.server 8765 &
node test/smoke.js
```

**Verify**: 0 failures, including both new assertions.

## Test plan

- **New**: one assertion that a week switch is persisted with no other edit
  (fix 1); one that the exported review follows the unit setting (fix 2).
- **Must keep passing**: every existing assertion. Fix 1 adds writes on paths
  that previously did not write, so watch anything asserting on
  `localStorage` contents after navigation. Fix 4 changes the service worker,
  so watch the offline-boot assertions (`test/smoke.js:~1105`).
- **Not covered by tests, by design**: fixes 3 and 4. Both are browser-API
  behaviours this suite cannot observe. State that plainly in your report
  rather than writing an assertion that only appears to cover them.

## Done criteria

ALL must hold:

- [ ] `node --check js/app.js && node --check js/review.js && node --check sw.js` exits 0
- [ ] `node --check test/smoke.js` exits 0
- [ ] `node test/smoke.js` exits 0 with 0 failures
- [ ] `grep -n "stopRest(); render();" js/app.js` returns no matches
- [ ] `grep -n " kg" js/review.js` returns no matches
- [ ] `grep -n "showMediaSession" js/app.js` returns 3 matches
- [ ] `grep -n "opaque" sw.js` returns no matches
- [ ] `CACHE_VERSION` in `sw.js` is higher than at commit `f9afbe0`
- [ ] `git status` shows only `js/app.js`, `js/review.js`, `sw.js`, `test/smoke.js` modified
- [ ] Four separate commits, one per fix
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any cited line does not match its "Current state" excerpt.
- Adding `save()` to the navigation handlers makes an existing smoke assertion
  fail. That would mean something depends on those switches *not* persisting,
  which would be surprising and worth understanding before proceeding.
- The offline-boot assertions fail after the `sw.js` change. Fix 4 should only
  affect cross-origin fonts; a same-origin regression means the condition was
  changed in the wrong place.
- `units()` is not reachable from `js/review.js` at the point you call it.
  (It should be — `js/review.js` loads before `js/app.js` but only calls it at
  runtime, which is the same arrangement `fmtKg` already relies on at
  `js/review.js:196`. If it is not, report rather than restructuring.)
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this next:

- **Fix 1's real lesson**: `saveT` is the app's only signal that there is
  unsaved work, and both `flushSave` and the cross-tab reconciler read it. Any
  future handler that mutates `state` and re-renders must call `save()`, or it
  silently opts out of both. That is worth checking in review on every new
  handler.
- **Fix 2**: `units()` is the single source of the unit label. A hardcoded
  `'kg'` anywhere is a bug by construction — `grep -n "'kg'\|\" kg\"" js/`
  is a cheap check when touching any text the app exports.
- **Fix 3**: `startRest` and `nudgeRest`'s recovery branch now both have to
  establish the same four things (keep-alive, media session, timer classes,
  labels). If a fifth is added, both places need it. They are close enough to
  be worth merging into one `resumeRest()` helper if this diverges again —
  deliberately not done here to keep the change minimal.
- **Fix 4**: dropping opaque caching means a cross-origin font is re-fetched
  on a cold load when the network is available and simply absent when it is
  not. That is the intended trade. If the font's absence offline ever becomes
  a real complaint, the fix is to self-host it under `font-src 'self'` — not
  to cache unreadable responses again.
