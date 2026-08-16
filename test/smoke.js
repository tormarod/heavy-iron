/* Smoke tests for the whole app, driven in a real browser.
 *
 *   npx playwright install chromium     # once
 *   python3 -m http.server 8765 &       # or any static server
 *   node test/smoke.js
 *
 * Nothing here is a unit test: the app has no modules and no build step, so
 * the useful thing to assert is that a person can open it, log a set, break
 * their data and still get it back. Add a case here whenever a bug turns out
 * to have been invisible from the outside.
 *
 * BASE can be overridden: BASE=http://localhost:8000 node test/smoke.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch();

  // ---------- main session ----------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];      // real JS faults
    const netErrors = [];   // unreachable hosts in this sandbox — not the app's doing
    const cspErrors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) cspErrors.push(t);
      else if (/Failed to load resource|net::ERR|ERR_/i.test(t)) netErrors.push(t);
      else if (m.type() === 'error') errors.push('console: ' + t);
    });
    let alertText = null;
    page.on('dialog', async d => { alertText = d.message(); await d.accept(); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    console.log('\n== boot ==');
    ok('no page/console errors', errors.length === 0, errors.join(' | '));
    ok('title rendered', (await page.textContent('#title')).includes('Bloque 1'));
    ok('3 days', await page.locator('.day').count() === 3);
    ok('7 exercises on day 1', await page.locator('.ex').count() === 7);
    ok('status says loaded', (await page.textContent('#status')).length > 0);

    console.log('\n== comma decimals ==');
    const w1 = page.locator('.ex').first().locator('.set-row').first().locator('input').first();
    await w1.fill('22,5');
    await page.waitForTimeout(600);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.log['block-1']['w1-d0'].chestpress[0].w);
    ok('comma weight stored verbatim', stored === '22,5', 'got ' + JSON.stringify(stored));
    await page.locator('.ex').first().locator('.set-row').first().locator('input').nth(1).fill('10');
    await page.waitForTimeout(600);

    console.log('\n== tick / timer / tonnage ==');
    await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
    ok('tick is a button with aria-pressed', await page.locator('.ex').first().locator('.set-row').first().locator('.tick').getAttribute('aria-pressed') === 'true');
    ok('rest timer shown', await page.locator('#timer.up').count() === 1);
    const note = await page.textContent('#note');
    ok('tonnage in note (22.5*10=225)', note.includes('225'), note);
    ok('timer +30 / -30 present', await page.locator('#tplus').count() === 1 && await page.locator('#tminus').count() === 1);
    const before = await page.textContent('#tval');
    await page.click('#tplus');
    ok('+30 extends countdown', (await page.textContent('#tval')) !== before);
    await page.click('#tskip');
    ok('skip hides timer', await page.locator('#timer.up').count() === 0);

    console.log('\n== timestamps + persistence across reload ==');
    await page.waitForTimeout(600);
    const ts = await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.log['block-1']['w1-d0'].chestpress[0].ts);
    ok('completed set carries a timestamp', typeof ts === 'number' && ts > 0);
    await page.reload({ waitUntil: 'networkidle' });
    ok('weight survives reload', await page.locator('.ex').first().locator('.set-row').first().locator('input').first().inputValue() === '22,5');

    console.log('\n== last-week placeholder ==');
    await page.locator('.wk').nth(1).click(); // week 2
    const ph = await page.locator('.ex').first().locator('.set-row').first().locator('input').first().getAttribute('placeholder');
    ok('week 2 placeholder shows week 1 weight', ph === '22,5', 'got ' + ph);
    await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(200);
    ok('ticking empty box adopts the placeholder', await page.locator('.ex').first().locator('.set-row').first().locator('input').first().inputValue() === '22,5');
    await page.click('#tskip');

    console.log('\n== personal record ==');
    await page.locator('.ex').first().locator('.set-row').nth(1).locator('input').first().fill('30');
    await page.locator('.ex').first().locator('.set-row').nth(1).locator('input').nth(1).fill('8');
    await page.locator('.ex').first().locator('.set-row').nth(1).locator('.tick').click();
    await page.waitForTimeout(200);
    ok('PR badge appears on the card', await page.locator('.ex').first().locator('.badge.pr').count() === 1);
    ok('PR row is marked', await page.locator('.ex').first().locator('.set-row.pr').count() === 1);
    ok('PR counted in the note', (await page.textContent('#note')).includes('récord'));
    await page.click('#tskip');

    console.log('\n== theme ==');
    ok('starts on auto (no attribute)', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === null);
    await page.click('#themeBtn');
    ok('cycles to light', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
    await page.click('#themeBtn');
    ok('cycles to dark', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('dark theme actually repaints body', bg === 'rgb(21, 22, 26)', bg);
    await page.reload({ waitUntil: 'networkidle' });
    ok('theme choice persists', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
    await page.click('#themeBtn'); // back to auto

    console.log('\n== XSS: hostile imported block ==');
    await page.evaluate(() => { window.__xss = false; });
    await page.click('#blockbar >> text=Importar JSON');
    const hostile = JSON.stringify({
      name: '<img src=x onerror="window.__xss=true">Bloque malo',
      days: [{
        name: '<script>window.__xss=true<\/script>Día',
        pair: '<img src=x onerror="window.__xss=true">',
        ex: [{ n: '<img src=x onerror="window.__xss=true">Press', reps: '8<img src=x onerror="window.__xss=true">', cue: '<svg onload="window.__xss=true">' }],
      }],
    });
    await page.fill('#importBlob', hostile);
    await page.click('#importFromText');
    await page.waitForTimeout(400);
    ok('hostile block imported as data', (await page.textContent('#title')).includes('Bloque malo'));
    ok('no script executed', await page.evaluate(() => window.__xss) === false);
    const repsText = await page.locator('.ex-target').first().textContent();
    ok('rep range rendered as literal text', repsText.includes('<img'), repsText);
    ok('no injected img element in the card', await page.locator('.ex img').count() === 0);

    console.log('\n== import validation ==');
    await page.click('#blockbar >> text=Importar JSON');
    await page.fill('#importBlob', JSON.stringify({ name: 'Enorme', days: Array.from({ length: 40 }, (_, i) => ({ name: 'd' + i, ex: [{ n: 'x', reps: '5' }] })) }));
    await page.click('#importFromText');
    ok('too many days rejected', (await page.textContent('#importError')).includes('Demasiados días'));
    await page.fill('#importBlob', JSON.stringify({ days: [{ name: 'd', ex: [{ n: 'sin reps' }] }] }));
    await page.click('#importFromText');
    ok('missing reps rejected', (await page.textContent('#importError')).includes('repeticiones'));
    await page.fill('#importBlob', 'no json');
    await page.click('#importFromText');
    ok('invalid JSON rejected', (await page.textContent('#importError')).includes('JSON'));

    console.log('\n== the blocks published in this repo still validate ==');
    for (const f of ['hombre-bloque-1.json', 'mujer-bloque-1.json', 'ejemplo-plantilla.json']) {
      const body = await (await fetch(BASE + '/blocks/' + f)).text();
      // a successful import closes the sheet, so reopen it each time round
      if (await page.locator('#importSheet.up').count() === 0) await page.click('#blockbar >> text=Importar JSON');
      await page.fill('#importBlob', body);
      await page.click('#importFromText');
      await page.waitForTimeout(300);
      const err = await page.textContent('#importError');
      ok('blocks/' + f + ' imports cleanly', err === '', err);
      ok('blocks/' + f + ' became the active block', (await page.textContent('#title')).length > 0);
    }
    await page.click('#blockbar >> text=Importar JSON');

    console.log('\n== escape closes sheets ==');
    ok('import sheet open', await page.locator('#importSheet.up').count() === 1);
    await page.keyboard.press('Escape');
    ok('escape closed it', await page.locator('#importSheet.up').count() === 0);

    console.log('\n== backup / restore validation ==');
    await page.click('#backup');
    ok('backup sheet opens', await page.locator('#sheet.up').count() === 1);
    ok('backup blob is valid JSON', await page.evaluate(() => { try { return !!JSON.parse(document.getElementById('blob').value).data.profiles; } catch (e) { return false; } }));
    await page.fill('#blob', JSON.stringify({ data: { profiles: { hombre: {} } } }));
    await page.click('#bRestore');
    ok('half-valid backup rejected with a reason', (await page.textContent('#status')).includes('perfil "hombre" no tiene bloques'), await page.textContent('#status'));
    await page.fill('#blob', '{"nope":1}');
    await page.click('#bRestore');
    ok('non-backup rejected', (await page.textContent('#status')).includes('no tiene perfiles'));

    console.log('\n== CSV ==');
    const csv = await page.evaluate(() => buildCsv());
    ok('CSV has a header row', csv.split('\r\n')[0].includes('perfil,bloque,semana'));
    ok('CSV contains the logged set', csv.includes('22,5') || csv.includes('"22,5"'), csv.split('\r\n')[1]);
    ok('CSV quotes the comma decimal', csv.includes('"22,5"'));
    await page.keyboard.press('Escape');

    console.log('\n== plan editor still works ==');
    await page.click('#editPlan');
    ok('editor opens', await page.locator('#planSheet.up').count() === 1);
    ok('editor lists days', await page.locator('.pe-day').count() >= 1);
    await page.click('#peClose');

    console.log('\n== profile switch ==');
    await page.click('.profile-btn >> nth=1');
    ok('switched to mujer', (await page.textContent('#title')).includes('Mujer'));
    ok('mujer theme class applied', await page.locator('#app.profile-mujer').count() === 1);

    console.log('\n== service worker ==');
    const swOk = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return !!(reg && reg.active);
    });
    ok('service worker is active', swOk);

    ok('no JS errors anywhere in the run', errors.length === 0, errors.join(' | '));
    ok('no Content-Security-Policy violations', cspErrors.length === 0, cspErrors.join(' | '));
    console.log('  note: ' + netErrors.length + ' network fetches failed (sandbox has no direct egress; app degrades gracefully)');
    await ctx.close();
  }

  // ---------- offline ----------
  {
    console.log('\n== offline ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(500);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    ok('app boots with no network', await page.locator('.ex').count() > 0);
    ok('log still readable offline', (await page.textContent('#title')).includes('Bloque 1'));
    await ctx.close();
  }

  // ---------- corrupted data ----------
  {
    console.log('\n== corrupt data recovery ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok('a fresh install persists its starting plan', await page.evaluate(() => !!localStorage.getItem('heavy-iron-v1')));

    // repairable: dangling activeBlock + missing phase + broken blockOrder
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.activeBlock = 'block-does-not-exist';
      s.profiles.hombre.blockOrder = ['ghost', 'block-1', 'block-1'];
      delete s.profiles.hombre.blocks['block-1'].phase;
      s.profiles.mujer.blocks['block-1'].days[0].ex = [];
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    ok('repairs dangling references instead of dying', await page.locator('.ex').count() > 0);
    ok('no recovery screen needed', await page.locator('.recovery').count() === 0);
    ok('blockOrder deduped', await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.blockOrder.length) === 1);

    // truly broken JSON
    await page.evaluate(() => localStorage.setItem('heavy-iron-v1', '{not json'));
    await page.reload({ waitUntil: 'networkidle' });
    ok('unparseable data falls back to a fresh plan', await page.locator('.ex').count() > 0);

    // unrenderable: force render to throw
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.blocks['block-1'].days = 'not an array at all';
      Object.defineProperty(s.profiles.hombre, 'label', { value: 'Hombre' });
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    ok('bad days array is repaired, not fatal', await page.locator('.ex').count() > 0);
    await ctx.close();
  }

  // ---------- recovery screen ----------
  {
    console.log('\n== recovery screen ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // break rendering itself, then force a redraw
    await page.evaluate(() => { window.setsFor = () => { throw new Error('boom de prueba'); }; });
    await page.locator('.day').nth(1).click();
    await page.waitForTimeout(300);
    ok('recovery screen replaces the blank page', await page.locator('.recovery').count() === 1);
    ok('shows the underlying error', (await page.textContent('.recovery pre')).includes('boom de prueba'));
    const dl = await Promise.all([page.waitForEvent('download'), page.click('#recDownload')]).then(r => r[0]).catch(() => null);
    ok('hands the raw data over as a file', !!dl);

    const before = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').length);
    await page.evaluate(() => { try { state.profiles.hombre.label = 'CLOBBERED'; } catch (e) {} writeState(); });
    const clobbered = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').includes('CLOBBERED'));
    const after = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').length);
    ok('refuses to write over the data it could not read', !clobbered && before === after);
    await ctx.close();
  }

  // ---------- layout on real phone widths ----------
  {
    console.log('\n== layout ==');
    for (const [label, width] of [['iPhone SE', 375], ['Pixel', 412], ['tablet', 768]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 820 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.locator('.ex').first().locator('.set-row').first().locator('input').first().fill('60');
      await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({
        vw: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        btns: [...document.querySelectorAll('.timer-acts .timer-btn')].map(b => b.getBoundingClientRect()).map(x => [x.left, x.right]),
      }));
      ok(label + ': all 4 rest-timer controls fit on screen',
         r.btns.length === 4 && r.btns.every(([l, rt]) => l >= 0 && rt <= r.vw), JSON.stringify(r.btns));
      ok(label + ': page does not scroll sideways', r.scroll <= r.vw, r.scroll + ' > ' + r.vw);
      await ctx.close();
    }
  }

  await browser.close();
  console.log('\n----------------------------------------');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
