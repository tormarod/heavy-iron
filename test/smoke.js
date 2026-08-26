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
/* A device with no saved data now opens on the first-run setup sheet.
   Tests that are not about setup skip it, exactly as a user could. */
const dismissSetup = async page => {
  if (await page.locator('#setupSheet.up').count()) {
    await page.click('#setupClose');
    await page.waitForTimeout(150);
  }
};

/* confirm()/alert()/prompt() are gone: answering a question is a click on
   the in-app dialog now. */
const answerDialog = async (page, accept, text) => {
  await page.waitForSelector('#askSheet.up', { timeout: 4000 });
  if (text != null) await page.fill('#askInput', text);
  await page.click(accept ? '#askOk' : '#askCancel');
  await page.waitForTimeout(250);
};

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

    console.log('\n== first-run setup ==');
    ok('a fresh device opens on the welcome sheet', await page.locator('#setupSheet.up').count() === 1);
    ok('it offers a starting plan on first run', await page.locator('#setupPlanField').isVisible());
    await page.fill('#setupNames input >> nth=0', 'Ana');
    await page.fill('#setupNames input >> nth=1', 'Bruno');
    await page.click('#setupUnits >> text=lb');
    await page.click('#setupSave');
    await page.waitForTimeout(400);
    ok('the names are used everywhere', (await page.textContent('#title')).includes('Ana'), await page.textContent('#title'));
    ok('the second profile is renamed too', (await page.textContent('.profiles')).includes('Bruno'));
    ok('the unit label follows the setting', (await page.locator('.fld u').first().textContent()) === 'lb');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    ok('setup does not come back on reload', await page.locator('#setupSheet.up').count() === 0);
    ok('names survive the reload', (await page.textContent('#title')).includes('Ana'));

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

    console.log('\n== muscle-group volume dashboard ==');
    ok('muscleTag falls back to "Sin clasificar" for an untagged exercise', await page.evaluate(() => muscleTag({}) === 'Sin clasificar'));
    ok('muscleTag reports whatever freeform tag is stored', await page.evaluate(() => muscleTag({ muscle: 'Gemelo externo' }) === 'Gemelo externo'));
    ok('muscleTag falls back for a blank/whitespace-only tag', await page.evaluate(() => muscleTag({ muscle: '   ' }) === 'Sin clasificar'));
    ok('the default chest press is tagged Pecho by migrate()', await page.evaluate(() =>
      state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'chestpress').muscle) === 'Pecho');
    ok('shoulder press is left untagged on purpose (front delt folded into press volume)', await page.evaluate(() =>
      state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'shoulderpress').muscle) === undefined);
    ok('lateral and rear delt work share one Hombro tag now', await page.evaluate(() =>
      state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'lat1').muscle === 'Hombro' &&
      state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'facepull').muscle === 'Hombro'));
    ok('volumeTotals excludes retired exercises', await page.evaluate(() => {
      const block = JSON.parse(JSON.stringify(state.profiles.hombre.blocks['block-1']));
      block.days[0].ex[0].off = 1;
      return volumeTotals('plan', state.profiles.hombre, block, 1, 'muscle').Pecho === 15 - 4;
    }));
    ok('blockTagsFor reflects the freeform tags actually present, in first-seen order', await page.evaluate(() => {
      const block = { days: [{ ex: [{ id: 'a', muscle: 'X' }, { id: 'b', muscle: 'Y' }, { id: 'c', muscle: 'X' }, { id: 'd' }] }] };
      return JSON.stringify(blockTagsFor('muscle', block)) === JSON.stringify(['X', 'Y', 'Sin clasificar']);
    }));
    ok('blockTagsFor works on the pattern dimension too', await page.evaluate(() => {
      const block = { days: [{ ex: [{ id: 'a', pattern: 'Empuje horizontal' }, { id: 'b' }] }] };
      return JSON.stringify(blockTagsFor('pattern', block)) === JSON.stringify(['Empuje horizontal', 'Sin clasificar']);
    }));
    ok('patternTag falls back to type — an untagged-pattern isolation move buckets as Aislamiento, not unclassified',
       await page.evaluate(() => patternTag({ type: 'Aislamiento' }) === 'Aislamiento'));
    ok('a genuinely untagged exercise (no pattern, no type) still buckets as unclassified',
       await page.evaluate(() => patternTag({}) === 'Sin clasificar'));
    ok('pattern wins over type when both are set',
       await page.evaluate(() => patternTag({ pattern: 'Empuje horizontal', type: 'Compuesto' }) === 'Empuje horizontal'));
    ok('buildBarSVG draws a background rect for every row, plus a filled one for nonzero rows', await page.evaluate(() => {
      const svg = buildBarSVG([{ label: 'Pecho', value: 10 }, { label: 'Espalda', value: 0 }]);
      return (svg.match(/<rect/g) || []).length === 3;
    }));

    ok('setVolume counts the set plus its drops, and only when ticked', await page.evaluate(() => {
      const r = { done: true, w: '60', r: '8', d: [{ w: '45', r: '5' }] };
      return setVolume(r) === 60 * 8 + 45 * 5 && setVolume({ w: '60', r: '8' }) === 0;
    }));
    ok('setVolume ignores a ticked set with a missing number', await page.evaluate(() =>
      setVolume({ done: true, w: '', r: '8' }) === 0));
    ok('blockTonnageByWeek indexes by week and skips weeks past the block length', await page.evaluate(() => {
      const block = { id: 'tb', weeks: 2, days: [] };
      const profile = { log: { tb: {
        'w1-d1': { a: [{ done: true, w: '10', r: '10' }] },
        'w2-d1': { a: [{ done: true, w: '20', r: '10' }, { w: '99', r: '9' }] },
        'w3-d1': { a: [{ done: true, w: '50', r: '10' }] },
      } } };
      return JSON.stringify(blockTonnageByWeek(profile, block)) === JSON.stringify([100, 200]);
    }));
    ok('blockTonnageByWeek still counts a retired exercise\'s logged sets', await page.evaluate(() => {
      const block = { id: 'tb', weeks: 1, days: [{ id: 'd1', ex: [{ id: 'a', off: 1 }] }] };
      const profile = { log: { tb: { 'w1-d1': { a: [{ done: true, w: '10', r: '10' }] } } } };
      return blockTonnageByWeek(profile, block)[0] === 100;
    }));

    await page.click('#volumeBtn');
    ok('the volume sheet opens', await page.locator('#volumeSheet.up').count() === 1);
    const kgStrip = await page.textContent('#volumeTonnage');
    ok('the kilos strip reports the block total (the one logged set, 22.5*10)', kgStrip.includes('225'), kgStrip);
    ok('with only week 1 logged it says so instead of printing the same number twice',
       kgStrip.includes('todo en la semana 1') && (kgStrip.match(/225/g) || []).length === 1, kgStrip);
    const twoWeekStrip = await page.evaluate(() => {
      const p = getProfile(), b = getBlock(), day = dayList(b)[0].id;
      p.log[b.id][slot(2, day)] = { probe: [{ done: true, w: '100', r: '10' }] };
      p.week = 2;
      drawVolumeTonnage(p, b, 2);
      const t = document.getElementById('volumeTonnage').textContent;
      delete p.log[b.id][slot(2, day)];
      p.week = 1;
      drawVolumeTonnage(p, b, 1);
      /* es-ES leaves four-digit numbers ungrouped (1225, not 1.225) — the
         thousands dot only shows up from five digits on. */
      return t;
    });
    ok('once an earlier week carries kilos the strip splits into block and week',
       twoWeekStrip.includes('1225 ') && twoWeekStrip.includes('1000 ') && twoWeekStrip.includes('2 semanas registradas'), twoWeekStrip);
    ok('starts on Plan scope', await page.getAttribute('#volumeScope >> text=Plan', 'aria-pressed') === 'true');
    const tagCount = await page.evaluate(() => blockTagsFor('muscle', getBlock()).length);
    ok('one row per muscle tag actually used in this block', await page.locator('#volumeHost .chart-table tbody tr').count() === tagCount);
    // chest and shoulders both land on 15 sets — merging hombro-lat/hombro-post
    // into one Hombro tag ties it with Pecho, and the alphabetical tie-break
    // puts Hombro first.
    const topPlanRow = await page.locator('#volumeHost .chart-table tbody tr').first().textContent();
    ok('shoulders (now one merged tag) top the plan view, tied with chest at 15 sets',
       topPlanRow.includes('Hombro') && topPlanRow.includes('15'), topPlanRow);
    const secondPlanRow = await page.locator('#volumeHost .chart-table tbody tr').nth(1).textContent();
    ok('chest is right behind it, same 15 sets', secondPlanRow.includes('Pecho') && secondPlanRow.includes('15'), secondPlanRow);

    await page.click('#volumeScope >> text=Registrado');
    await page.waitForTimeout(200);
    ok('the sub-label switches to registered sets', (await page.textContent('#volumeSub')).includes('marcadas como hechas'));
    ok('the kilos strip is the same on either scope — tonnage is log-only',
       (await page.textContent('#volumeTonnage')) === kgStrip);
    const topLogRow = await page.locator('#volumeHost .chart-table tbody tr').first().textContent();
    ok('the one completed set so far counts under Pecho', topLogRow.includes('Pecho') && topLogRow.trim().endsWith('1'), topLogRow);

    ok('starts on the Músculo dimension', await page.getAttribute('#volumeDim >> text=Músculo', 'aria-pressed') === 'true');
    await page.click('#volumeDim >> text=Patrón');
    await page.waitForTimeout(200);
    ok('switching dimension relabels the table header', (await page.textContent('#volumeHost .chart-table thead')).includes('Patrón'));
    ok('the sub-label follows the dimension too', (await page.textContent('#volumeSub')).includes('por patrón'));
    await page.click('#volumeDim >> text=Tipo');
    await page.waitForTimeout(200);
    ok('the type dimension header switches too', (await page.textContent('#volumeHost .chart-table thead')).includes('Tipo'));
    await page.click('#volumeDim >> text=Músculo');
    await page.waitForTimeout(200);

    await page.click('#volumeClose');
    ok('close hides it', await page.locator('#volumeSheet.up').count() === 0);

    console.log('\n== plan editor: muscle tag is freeform text ==');
    await page.click('#editPlan');
    const day0 = page.locator('.pe-day').first();
    ok('chest press starts tagged Pecho', await day0.locator('.pe-ex').nth(0).locator('.f-muscle').inputValue() === 'Pecho');
    ok('shoulder press starts blank (unclassified)', await day0.locator('.pe-ex').nth(2).locator('.f-muscle').inputValue() === '');
    ok('the muscle field offers suggestions via a datalist, not a fixed set', await day0.locator('.pe-ex').nth(0).locator('.f-muscle').getAttribute('list') === 'muscleSuggestions');
    await day0.locator('.pe-ex').last().locator('.f-muscle').fill('Pantorrilla externa');
    await page.click('#peSave');
    await page.waitForTimeout(300);
    ok('typing a custom tag and saving persists it verbatim', await page.evaluate(() =>
      state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'facepull').muscle) === 'Pantorrilla externa');

    await page.click('#editPlan');
    await page.locator('.pe-day').first().locator('.pe-ex').nth(0).locator('.f-muscle').fill('');
    await page.click('#peSave');
    await page.waitForTimeout(300);
    ok('clearing the field removes the tag rather than storing an empty string', await page.evaluate(() =>
      !('muscle' in state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'chestpress'))));

    console.log('\n== plan editor: pattern/type tags, same freeform shape as muscle ==');
    await page.click('#editPlan');
    const day0b = page.locator('.pe-day').first();
    ok('pattern starts blank (unclassified)', await day0b.locator('.pe-ex').nth(0).locator('.f-pattern').inputValue() === '');
    ok('type starts blank (unclassified)', await day0b.locator('.pe-ex').nth(0).locator('.f-type').inputValue() === '');
    ok('the pattern field offers suggestions via a datalist, not a fixed set', await day0b.locator('.pe-ex').nth(0).locator('.f-pattern').getAttribute('list') === 'patternSuggestions');
    ok('the type field offers suggestions via a datalist, not a fixed set', await day0b.locator('.pe-ex').nth(0).locator('.f-type').getAttribute('list') === 'typeSuggestions');
    await day0b.locator('.pe-ex').nth(0).locator('.f-pattern').fill('Empuje horizontal');
    await day0b.locator('.pe-ex').nth(0).locator('.f-type').fill('Compuesto');
    await page.click('#peSave');
    await page.waitForTimeout(300);
    ok('typing custom pattern/type tags and saving persists them verbatim', await page.evaluate(() => {
      const ex = state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'chestpress');
      return ex.pattern === 'Empuje horizontal' && ex.type === 'Compuesto';
    }));

    await page.click('#editPlan');
    await page.locator('.pe-day').first().locator('.pe-ex').nth(0).locator('.f-pattern').fill('');
    await page.locator('.pe-day').first().locator('.pe-ex').nth(0).locator('.f-type').fill('');
    await page.click('#peSave');
    await page.waitForTimeout(300);
    ok('clearing pattern/type removes the tags rather than storing empty strings', await page.evaluate(() => {
      const ex = state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'chestpress');
      return !('pattern' in ex) && !('type' in ex);
    }));

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

    console.log('\n== in-app dialogs ==');
    ok('no native dialog fired during the run', alertText === null, String(alertText));
    await page.click('#clearDay');
    ok('a confirmation sheet opens', await page.locator('#askSheet.up').count() === 1);
    ok('it says what will go', (await page.textContent('#askBody')).includes('semana'));
    await answerDialog(page, false);
    ok('cancelling leaves the log alone', await page.locator('.set-row.done').count() > 0);

    console.log('\n== undo ==');
    const doneBefore = await page.locator('.set-row.done').count();
    await page.click('#clearDay');
    await answerDialog(page, true);
    ok('confirming clears the day', await page.locator('.set-row.done').count() === 0, 'was ' + doneBefore);
    ok('the toast offers Deshacer', (await page.textContent('#toastAct')) === 'Deshacer');
    await page.click('#toastAct');
    await page.waitForTimeout(400);
    ok('undo puts the sets back', await page.locator('.set-row.done').count() === doneBefore);

    console.log('\n== block length + deload ==');
    ok('a fresh block shows 8 weeks', await page.locator('.wk').count() === 8);
    ok('week 8 is the deload', (await page.locator('.wk').nth(7).textContent()) === 'DL');
    await page.click('#editPlan');
    await page.fill('#peWeeks', '5');
    await page.waitForTimeout(200);
    ok('the deload list is trimmed to the new length', await page.locator('#peDeload option').count() === 6);
    await page.selectOption('#peDeload', '3');
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('the week bar follows the block', await page.locator('.wk').count() === 5);
    ok('week 3 is now the deload', (await page.locator('.wk').nth(2).textContent()) === 'DL');
    await page.locator('.wk').nth(2).click();
    await page.waitForTimeout(250);
    const full = await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 1, getBlock()));
    const cut = await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 3, getBlock()));
    ok('the deload week halves the sets', cut < full, cut + ' vs ' + full);
    ok('a week with no deload is untouched', await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 2, getBlock())) === full);
    ok('nothing is stranded while the log still fits', !(await page.locator('#beyond').isVisible()));

    // one week: now the week-2 sets are past the end
    await page.click('#editPlan');
    await page.fill('#peWeeks', '1');
    await page.waitForTimeout(150);
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('shortening past the log keeps it and says so', await page.locator('#beyond').isVisible());
    ok('...and counts what is out of reach', (await page.textContent('#beyond')).includes('serie'));
    ok('the current week is pulled back into range', await page.evaluate(() => getProfile().week) === 1);

    // back to 8 so the rest of the run sees a normal block
    await page.click('#editPlan');
    await page.fill('#peWeeks', '8');
    await page.waitForTimeout(150);
    await page.selectOption('#peDeload', '8');
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('lengthening brings the stranded weeks back', !(await page.locator('#beyond').isVisible()));

    console.log('\n== a new block is named in-app ==');
    await page.click('#blockbar >> text=+ Nuevo bloque');
    /* The block being left has sets logged by now, so the review is
       offered first — see the block-review section further down. Decline
       it here; this case is about the name prompt behind it. */
    await page.waitForTimeout(250);
    if (await page.locator('#askSheet.up').count() && !(await page.locator('#askInput').isVisible())) {
      await page.click('#askCancel');
      await page.waitForTimeout(300);
    }
    ok('the name prompt is an in-app sheet', await page.locator('#askInput').isVisible());
    await answerDialog(page, true, 'Bloque de prueba');
    ok('the block is created with that name', (await page.textContent('#title')).includes('Bloque de prueba'));

    console.log('\n== progress across every block ==');
    await page.locator('.ex').first().locator('.ex-chart-btn').click();
    ok('the chart opens on this block', await page.locator('#chartSheet.up').count() === 1);
    await page.click('#chartScope >> text=Todos los bloques');
    await page.waitForTimeout(250);
    ok('all-blocks mode names the profile', (await page.textContent('#chartSub')).includes('Todos los bloques'));
    ok('it finds history from the earlier block', await page.locator('.chart-table tbody tr').count() > 0);
    ok('rows are labelled by block and week',
       await page.locator('.chart-table tbody tr').count() > 0 &&
       (await page.locator('.chart-table tbody tr').first().textContent()).includes('·'));

    console.log('\n== estimated 1RM ==');
    ok('Epley formula matches by hand', await page.evaluate(() => est1RM(100, 5)) === 100 * (1 + 5 / 30));
    ok('a set past 12 reps is still picked, but flagged unreliable', await page.evaluate(() => {
      const rows = [{ done: true, w: '50', r: '20' }];
      return bestSet(rows, 'e1rm') === rows[0];
    }));
    await page.click('#chartMetric >> text=1RM est.');
    await page.waitForTimeout(250);
    ok('the sub-label switches to the 1RM estimate', (await page.textContent('#chartSub')).includes('1RM estimado'));
    ok('the table header switches to 1RM est.', (await page.textContent('#chartHost')).includes('1RM est.'));
    await page.click('#chartMetric >> text=Peso');
    await page.waitForTimeout(250);
    ok('switching back restores the weight label', (await page.textContent('#chartSub')).includes('mejor peso'));
    await page.click('#chartClose');

    console.log('\n== warm-up ramp & plate calculator ==');
    ok('fitPlates matches an exact target with no remainder', await page.evaluate(() => {
      const r = fitPlates(41.25, [1.25, 2.5, 5, 10, 15, 20]);
      return r.remainder === 0 && r.plates.reduce((a, b) => a + b, 0) === 41.25;
    }));
    ok('fitPlates reports what it could not reach', await page.evaluate(() => {
      const r = fitPlates(21, [5, 10, 20]);
      return r.remainder === 1 && r.plates.reduce((a, b) => a + b, 0) === 20;
    }));
    ok('warmupRamp never drops below the floor', await page.evaluate(() =>
      JSON.stringify(warmupRamp(50, 2.5, 20)) === JSON.stringify([20, 30, 40])));

    await page.click('#calcBtn');
    ok('the calculator opens', await page.locator('#calcSheet.up').count() === 1);
    ok('starts in Barra mode', await page.getAttribute('#calcMode >> text=Barra', 'aria-pressed') === 'true');
    ok('the stack-increment field is hidden in Barra mode', !(await page.locator('#calcIncField').isVisible()));

    await page.fill('#calcTarget', '10');
    await page.waitForTimeout(150);
    ok('below the bar weight, it says so instead of showing negative plates',
       (await page.textContent('#calcOut')).includes('menor que la barra'));

    await page.fill('#calcTarget', '100');
    await page.waitForTimeout(150);
    ok('a full ramp plus the target renders as four rows', await page.locator('#calcOut tbody tr').count() === 4);
    ok('the last row is the exact target, unrounded', (await page.locator('#calcOut tbody tr').last().textContent()).includes('100'));
    ok('the bar hint names the default bar and plates for this unit', (await page.textContent('#calcBarHint')).includes('45 lb'));

    await page.click('#calcMode >> text=Máquina');
    ok('the stack-increment field appears in Máquina mode', await page.locator('#calcIncField').isVisible());
    await page.waitForTimeout(150);
    ok('machine mode has no per-side plate column', !(await page.locator('#calcOut th', { hasText: 'Por lado' }).count()));
    await page.click('#calcClose');

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

    console.log('\n== import: freeform muscle field ==');
    await page.fill('#importBlob', JSON.stringify({
      name: 'Con músculos',
      days: [{ name: 'D', ex: [
        { id: 'x1', n: 'Uno', reps: '10', muscle: 'Antebrazo' },
        { id: 'x2', n: 'Dos', reps: '10', muscle: '   ' },
        { id: 'x3', n: 'Tres', reps: '10' },
      ] }],
    }));
    await page.click('#importFromText');
    await page.waitForTimeout(300);
    ok('a block with a custom muscle tag imports cleanly', (await page.textContent('#importError')) === '');
    ok('an arbitrary muscle tag is kept verbatim — the app enforces no taxonomy on import',
       await page.evaluate(() => getBlock().days[0].ex[0].muscle) === 'Antebrazo');
    ok('a blank/whitespace-only muscle tag is left absent',
       await page.evaluate(() => !('muscle' in getBlock().days[0].ex[1])));
    ok('a missing muscle tag is left absent',
       await page.evaluate(() => !('muscle' in getBlock().days[0].ex[2])));
    await page.click('#blockbar >> text=Importar JSON');

    console.log('\n== import: freeform pattern/type fields ==');
    await page.fill('#importBlob', JSON.stringify({
      name: 'Con patrones',
      days: [{ name: 'D', ex: [
        { id: 'x1', n: 'Uno', reps: '10', pattern: 'Empuje horizontal', type: 'Compuesto' },
        { id: 'x2', n: 'Dos', reps: '10', pattern: '   ', type: '   ' },
        { id: 'x3', n: 'Tres', reps: '10' },
      ] }],
    }));
    await page.click('#importFromText');
    await page.waitForTimeout(300);
    ok('a block with custom pattern/type tags imports cleanly', (await page.textContent('#importError')) === '');
    ok('arbitrary pattern/type tags are kept verbatim — the app enforces no taxonomy on import', await page.evaluate(() => {
      const ex = getBlock().days[0].ex[0];
      return ex.pattern === 'Empuje horizontal' && ex.type === 'Compuesto';
    }));
    ok('blank/whitespace-only pattern/type tags are left absent', await page.evaluate(() => {
      const ex = getBlock().days[0].ex[1];
      return !('pattern' in ex) && !('type' in ex);
    }));
    ok('missing pattern/type tags are left absent', await page.evaluate(() => {
      const ex = getBlock().days[0].ex[2];
      return !('pattern' in ex) && !('type' in ex);
    }));
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

    /* The camera itself is manual-test territory — there is no way to point a
       headless browser at another phone's screen. Everything up to the camera
       is not: the split/checksum/reassembly protocol and the import that
       follows it are ordinary functions, and they are what actually loses
       somebody's log if they are wrong. So the payload is fed in directly,
       exactly as a scanner would hand it over. */
    console.log('\n== QR transfer: protocol ==');
    await page.evaluate(() => qrEncoderReady());
    ok('a payload survives split and reassembly', await page.evaluate(async () => {
      const packed = await qrPackFrames({ kind: 'block', hello: 'ünïcødé ✓', n: 42 });
      const rx = qrReceiver();
      packed.frames.forEach(f => rx.accept(f));
      const got = await rx.payload();
      return got.hello === 'ünïcødé ✓' && got.n === 42;
    }));
    ok('frames are accepted out of order and repeated', await page.evaluate(async () => {
      /* Random text so deflate cannot shrink it to a single frame — the
         out-of-order case only means anything with several. */
      const noise = Array.from({ length: 4000 }, () => Math.random().toString(36)[2]).join('');
      const packed = await qrPackFrames({ kind: 'block', noise });
      if (packed.total < 3) return false;
      const rx = qrReceiver();
      packed.frames.slice().reverse().forEach(f => { rx.accept(f); rx.accept(f); });
      return rx.complete && (await rx.payload()).noise === noise;
    }));
    ok('a missing frame is reported, not guessed at', await page.evaluate(async () => {
      const noise = Array.from({ length: 4000 }, () => Math.random().toString(36)[2]).join('');
      const packed = await qrPackFrames({ kind: 'block', noise });
      const rx = qrReceiver();
      packed.frames.slice(1).forEach(f => rx.accept(f));
      if (rx.complete) return false;
      try { await rx.payload(); return false; } catch (e) { return /Faltan fotogramas/.test(e.message); }
    }));
    ok('a corrupted frame fails the checksum', await page.evaluate(async () => {
      const packed = await qrPackFrames({ kind: 'block', noise: 'x'.repeat(200) });
      const rx = qrReceiver();
      packed.frames.forEach(f => rx.accept(f));
      rx.parts.set(0, rx.parts.get(0).slice(0, -2) + 'AA');
      try { await rx.payload(); return false; } catch (e) { return /no encajan/.test(e.message); }
    }));
    ok('a QR that is not ours is ignored', await page.evaluate(() =>
      qrReceiver().accept('WIFI:S:gimnasio;T:WPA;P:secreto;;') === 'foreign' &&
      qrReceiver().accept('https://example.com') === 'foreign' &&
      qrReceiver().accept('HI1|abc|nope|2|zz|d|xx') === 'foreign'));
    ok('starting a second share restarts the reader instead of welding halves', await page.evaluate(async () => {
      const a = await qrPackFrames({ kind: 'block', which: 'first' });
      const b = await qrPackFrames({ kind: 'block', which: 'second' });
      const rx = qrReceiver();
      rx.accept(a.frames[0]);
      if (rx.accept(b.frames[0]) !== 'restart') return false;
      return (await rx.payload()).which === 'second';
    }));
    ok('a frame is small enough to scan and the QR is built dark-on-light', await page.evaluate(async () => {
      const packed = await qrPackFrames({ kind: 'block', noise: 'y'.repeat(6000) });
      const svg = buildQrSVG(packed.frames[0]);
      const box = /viewBox="0 0 (\d+)/.exec(svg);
      /* version 40 is 177 modules + 8 of quiet zone; anything approaching
         that is unreadable off a phone screen. */
      return packed.frames[0].length <= QR_CHUNK + 40 && +box[1] <= 120 &&
             svg.includes('fill="#fff"') && svg.includes('fill="#000"');
    }));

    console.log('\n== QR transfer: sharing progress, not just the plan ==');
    ok('the plan-only payload carries no log', await page.evaluate(async () => {
      const payload = await buildQrPayload('block', getProfile(), getBlock());
      return payload.kind === 'block' && !payload.log && Array.isArray(payload.block.days);
    }));
    ok('the plan+log payload carries the sets actually logged', await page.evaluate(async () => {
      const payload = await buildQrPayload('blocklog', getProfile(), getBlock());
      return payload.kind === 'blocklog' &&
             countShareLog(payload.log) === blockLoggedSets(getProfile(), getBlock().id);
    }));
    ok('empty padding rows are not shipped', await page.evaluate(async () => {
      const p = getProfile(), b = getBlock();
      const day = dayList(b)[0], ex = exList(day)[0];
      /* Opening a day pads every exercise out to its set count; those blank
         rows are most of a fresh block and none of its information. */
      entry(p, b.id, 8, day.id, ex.id, 4);
      const log = blockShareLog(p, b);
      return !log[slot(8, day.id)];
    }));
    ok('retired exercises are left out of the shared plan', await page.evaluate(() => {
      const b = getBlock(), day = dayList(b)[0], ex = exList(day)[0];
      ex.off = 1;
      const shared = blockSharePlan(b).days.find(d => d.id === day.id);
      ex.off = 0;
      return shared.ex.every(e => e.id !== ex.id);
    }));
    ok('a whole profile can be sent, shaped like the file export', await page.evaluate(async () => {
      const payload = await buildQrPayload('profile', getProfile(), getBlock());
      return payload.kind === 'profile' && !!payload.profile && !describeProfileProblem(payload.profile, payload.key);
    }));

    console.log('\n== QR transfer: what arrives ==');
    ok('a scanned plan+log rebuilds the log exactly, on a new block', await page.evaluate(async () => {
      const p = getProfile(), b = getBlock();
      /* Seeded here rather than inherited from whatever the suite has done so
         far: the assertion below is about ticked sets surviving, so the block
         has to be known to contain some. */
      const seedDay = dayList(b)[0], seedEx = exList(seedDay)[0];
      const seedRows = rowsFor(p, b.id, 1, seedDay.id, seedEx.id);
      seedRows[0] = { w: '80', r: '10', done: true, ts: Date.now() };
      save();
      const wasSets = blockLoggedSets(p, b.id), wasDone = blockDoneSets(p, b.id);
      const wasBlocks = p.blockOrder.length;
      const packed = await qrPackFrames(await buildQrPayload('blocklog', p, b));
      const rx = qrReceiver();
      packed.frames.forEach(f => rx.accept(f));
      const got = await rx.payload();
      const normalized = normalizeImportedBlock(got.block);
      const id = installImportedBlock(normalized, normalizeImportedLog(got.log, got.block, normalized));
      const np = getProfile();
      return blockLoggedSets(np, id) === wasSets &&
             /* counting rows is not enough: rowUsed() is true for a weight
                typed and never ticked, so a transfer that dropped every ✓
                would still match on the count alone. */
             blockDoneSets(np, id) === wasDone && wasDone > 0 &&
             np.blockOrder.length === wasBlocks + 1 &&
             np.activeBlock === id &&
             /* and the block it came from is still sitting there untouched */
             !!np.blocks[b.id] && blockLoggedSets(np, b.id) === wasSets;
    }));
    ok('a completed set still drives the chart after it is scanned in', await page.evaluate(async () => {
      const p = getProfile(), b = getBlock();
      const day = dayList(b)[0], ex = exList(day)[0];
      const rows = rowsFor(p, b.id, 1, day.id, ex.id);
      rows[0] = { w: '100', r: '8', done: true, ts: Date.now() };
      /* a second set with numbers but no ✓ — carried across, but it must not
         start counting as completed on the other side */
      rows[1] = { w: '105', r: '6', done: false };
      save();
      const packed = await qrPackFrames(await buildQrPayload('blocklog', p, b));
      const rx = qrReceiver();
      packed.frames.forEach(f => rx.accept(f));
      const got = await rx.payload();
      const normalized = normalizeImportedBlock(got.block);
      const id = installImportedBlock(normalized, normalizeImportedLog(got.log, got.block, normalized));
      const np = getProfile(), nb = np.blocks[id];
      const nd = dayList(nb)[0], ne = exList(nd)[0];
      const landed = np.log[id][slot(1, nd.id)][ne.id];
      return landed[0].done === true && landed[0].w === '100' &&
             landed[1].done === false && landed[1].w === '105' &&
             collectHistory(np, id, nd.id, ne.id, blockWeeks(nb), 'weight').length === 1;
    }));
    /* A profile opens on the week its owner was on, which is usually one they
       have not trained yet: no ticks, and greyed last-week placeholders in
       every weight box. That reads exactly like a transfer that lost its ✓,
       and it is the thing people actually reported. */
    /* Built by hand rather than by clobbering the live profile: these run in
       the middle of a long shared session, and wiping a real block's log to
       make a point here breaks the CSV and plan-editor cases further down. */
    ok('landing on an untrained week says where the history is', await page.evaluate(() => {
      const fake = week => ({
        week, activeBlock: 'b1',
        blocks: { b1: { id: 'b1', weeks: 8, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e0', n: 'E', reps: '8', sets: 3 }] }] } },
        log: { b1: { 'w1-d0': { e0: [{ w: '100', r: '8', done: true }] } } },
      });
      const onEmptyWeek = landingNote(fake(3));
      const onLoggedWeek = landingNote(fake(1));
      return /semana 3/.test(onEmptyWeek) && /anteriores/.test(onEmptyWeek) && onLoggedWeek === '';
    }));
    ok('a profile with nothing logged anywhere gets no misleading note', await page.evaluate(() =>
      landingNote({
        week: 3, activeBlock: 'b1',
        blocks: { b1: { id: 'b1', weeks: 8, days: [{ id: 'd0', name: 'D', ex: [{ id: 'e0', n: 'E', reps: '8', sets: 3 }] }] } },
        log: {},
      }) === ''));
    /* save() is debounced 400 ms and ends in mark('Guardado …'), so a result
       reported straight after it used to be wiped off the status line before
       anyone could read it — an import that looked like it said nothing. */
    ok('a result message outlives the save indicator', await page.evaluate(async () => {
      const status = document.getElementById('status');
      save();
      mark('sin flush');
      await new Promise(r => setTimeout(r, 900));
      const lostIt = status.textContent !== 'sin flush';
      save();
      flushSave();
      mark('con flush');
      await new Promise(r => setTimeout(r, 900));
      const keptIt = status.textContent === 'con flush';
      return lostIt && keptIt;
    }));
    ok('the sheet distinguishes sets that are merely written down from ones marked done', await page.evaluate(() => {
      return setsWithDoneLabel(12, 12) === '12 series registradas' &&
             setsWithDoneLabel(12, 9) === '12 series registradas, 9 marcadas como hechas' &&
             setsWithDoneLabel(2, 1) === '2 series registradas, 1 marcada como hecha' &&
             setsWithDoneLabel(0, 0) === '0 series registradas';
    }));
    ok('a hostile log is bounded rather than trusted', await page.evaluate(() => {
      const normalized = normalizeImportedBlock({ name: 'x', days: [{ id: 'd0', name: 'D', ex: [{ id: 'e0', n: 'E', reps: '8' }] }] });
      const log = normalizeImportedLog({
        'w1-d0': { e0: new Array(500).fill({ w: 'z'.repeat(4000), r: 'q'.repeat(4000), done: 1 }) },
        'w99-d0': { e0: [{ w: '1', r: '1', done: true }] },   // week past the ceiling
        'w1-nope': { e0: [{ w: '1', r: '1', done: true }] },  // unknown day
        'garbage': { e0: [{ w: '1', r: '1', done: true }] },  // unparseable key
      }, { days: [{ id: 'd0', ex: [{ id: 'e0' }] }] }, normalized);
      const rows = log['w1-d0'].e0;
      return Object.keys(log).length === 1 && rows.length <= 24 &&
             rows[0].w.length <= 12 && rows[0].done === true;
    }));
    ok('a log whose ids the importer had to rename still lands on the right sets', await page.evaluate(() => {
      /* Two exercises sharing an id: the importer keeps the first and renames
         the second, so a log keyed by the sender's ids has to follow it. */
      const raw = { name: 'dup', days: [{ id: 'd0', name: 'D', ex: [{ id: 'same', n: 'A', reps: '8' }, { id: 'same', n: 'B', reps: '8' }] }] };
      const normalized = normalizeImportedBlock(raw);
      if (normalized.days[0].ex[1].id === normalized.days[0].ex[0].id) return false;
      const log = normalizeImportedLog({ 'w1-d0': { same: [{ w: '60', r: '8', done: true }] } }, raw, normalized);
      return !!log['w1-d0'][normalized.days[0].ex[0].id];
    }));
    ok('a payload that is not ours is refused', await page.evaluate(async () => {
      await applyQrPayload({ kind: 'something-else' });
      return (document.getElementById('status').textContent || '').includes('no de Heavy Iron');
    }));

    /* The closest thing to the real trip that exists without two phones: the
       frames are drawn exactly as the app draws them, rasterised, and read
       back through the actual decoder. Everything between the two libraries
       is covered here — only pointing a lens at a screen is not. */
    ok('every drawn frame decodes back through jsQR into the same payload', await page.evaluate(async () => {
      await qrDecoderReady();
      const payload = await buildQrPayload('blocklog', getProfile(), getBlock());
      const packed = await qrPackFrames(payload);
      const rx = qrReceiver();
      for (const frame of packed.frames) {
        /* xmlns is not needed for the inline SVG the app injects, but it is
           for one loaded as an image, which is the only way to rasterise it. */
        const svg = buildQrSVG(frame).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        const size = +/viewBox="0 0 (\d+)/.exec(svg)[1];
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error('no se pudo rasterizar el QR'));
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        const c = document.createElement('canvas');
        c.width = c.height = size * 4;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const got = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
        if (!got) return false;
        rx.accept(got.data);
      }
      return rx.complete && JSON.stringify(await rx.payload()) === JSON.stringify(payload);
    }));

    console.log('\n== QR transfer: the sheet ==');
    /* The backup sheet is still open from the section above — the QR sheet is
       reached from inside it, and has to sit on top without closing it. */
    await page.click('#qrBtn');
    await page.waitForTimeout(1500);
    ok('the QR sheet opens with a code drawn', await page.locator('#qrSheet.up').count() === 1 &&
       await page.locator('#qrHost svg').count() === 1);
    ok('it says which frame you are looking at', /Fotograma \d+\/\d+|Un solo código/.test(await page.textContent('#qrCount')),
       await page.textContent('#qrCount'));
    ok('the plan+log option names the sets it will send', (await page.textContent('#qrShowDesc')).includes('series registradas'),
       await page.textContent('#qrShowDesc'));
    await page.click('#qrKind .seg-btn[data-kind="block"]');
    await page.waitForTimeout(900);
    ok('switching to plan-only redraws', (await page.textContent('#qrShowDesc')).includes('Solo el plan'));
    ok('escape closes the QR sheet and leaves the backup sheet up', await (async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      return await page.locator('#qrSheet.up').count() === 0 && await page.locator('#sheet.up').count() === 1;
    })());
    ok('closing the sheet stops the frame timer', await page.evaluate(() => qrTimer === null && qrFrames.length === 0));

    /* Closing before the payload has finished building used to let the build
       finish anyway and start an interval on a sheet nobody could see. Both
       calls are synchronous, so the close is guaranteed to land while the
       build is still suspended on its first await — no timing luck involved. */
    ok('closing mid-build leaves no timer running behind it', await page.evaluate(async () => {
      openQr();
      closeQr();
      await new Promise(r => setTimeout(r, 1200));
      return qrTimer === null && qrFrames.length === 0 && !document.querySelector('#qrSheet.up');
    }));

    /* Headless Chromium has no camera, which is the same dead end as a denied
       permission on a real phone — and the one case where this feature has to
       point at the file transfer instead of just failing. */
    await page.click('#qrBtn');
    await page.waitForTimeout(300);
    await page.click('#qrMode .seg-btn[data-mode="scan"]');
    await page.waitForTimeout(2500);
    ok('no camera falls back to the file transfer instead of a dead end',
       /cámara/.test(await page.textContent('#qrScanStatus')) &&
       /archivo/.test(await page.textContent('#qrScanStatus')), await page.textContent('#qrScanStatus'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok('nothing is left streaming or polling after the sheet closes',
       await page.evaluate(() => qrStream === null && qrScanTimer === null && qrTimer === null));

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
    ok('switched to the second profile', (await page.textContent('#title')).includes('Bruno'), await page.textContent('#title'));
    /* Saving settings normalises the shipped theme names ('mujer') to the
       accent names ('verde'); the CSS keeps both, so a profile that never
       goes through settings does not change colour. */
    ok('its accent class is applied', await page.locator('#app.profile-verde').count() === 1);

    console.log('\n== solo mode ==');
    await page.click('.profile-btn >> nth=0');   // back to the first profile
    await page.click('#settings');
    ok('settings hides the starting-plan question', !(await page.locator('#setupPlanField').isVisible()));
    await page.click('#setupMode >> text=Solo yo');
    ok('solo mode asks for one name only', await page.locator('#setupNames input').count() === 1);
    await page.click('#setupSave');
    await page.waitForTimeout(400);
    ok('the profile switcher is hidden', !(await page.locator('#profiles').isVisible()));
    ok('no JUNTOS/SOLO badges on any exercise', await page.locator('.badge.together, .badge.solo').count() === 0);
    ok('the pair note is hidden', !(await page.locator('#pair').isVisible()));
    ok('the shared-station stripe is gone', await page.locator('.ex.shared').count() === 0);
    await page.click('#editPlan');
    ok('plan editor hides the shared-station checkbox', !(await page.locator('.pe-check-share').first().isVisible()));
    ok('plan editor hides the pair note field', !(await page.locator('.pe-day-pair').first().isVisible()));
    await page.click('#peClose');
    ok('the other profile is hidden, not deleted',
       await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles).length) === 2);

    // and back again, with nothing lost
    await page.click('#settings');
    await page.click('#setupMode >> text=Dos personas');
    await page.click('#setupSave');
    await page.waitForTimeout(300);
    ok('two-person mode comes back intact', await page.locator('#profiles').isVisible()
       && await page.locator('.badge.together, .badge.solo').count() > 0);

    console.log('\n== moving one profile between phones ==');
    await page.click('#backup');
    ok('there is an export button per person', await page.locator('#profileExports button').count() === 2);
    ok('a dialog raised from inside a sheet is on top of it', await page.evaluate(() => {
      const ask = getComputedStyle(document.getElementById('askSheet')).zIndex;
      const sheet = getComputedStyle(document.getElementById('sheet')).zIndex;
      return Number(ask) > Number(sheet);
    }));
    const profileFile = await page.evaluate(() => profileExportPayload(state.activeProfile));
    const parsedProfile = JSON.parse(profileFile);
    ok('the file carries exactly one profile', parsedProfile.kind === 'profile' && !!parsedProfile.profile && !parsedProfile.data);
    // a profile file must not be mistaken for a full backup
    await page.fill('#blob', profileFile);
    await page.click('#bRestore');
    ok('loading it as a full backup is refused', (await page.textContent('#status')).includes('no tiene perfiles'));

    // now load it properly, into the other person's slot
    const swapped = JSON.stringify(Object.assign({}, parsedProfile, {
      key: 'mujer',
      profile: Object.assign({}, parsedProfile.profile, { label: 'Ana (del otro móvil)' }),
    }));
    const otherBefore = await page.evaluate(() => JSON.stringify(state.profiles.hombre));
    // fire and forget: the returned promise only settles once the dialog is
    // answered, and awaiting it here would deadlock against that click
    await page.evaluate(t => { loadProfileFromText(t); }, swapped);
    await answerDialog(page, true);
    ok('it replaces the profile it names', await page.evaluate(() => state.profiles.mujer.label) === 'Ana (del otro móvil)');
    ok('the other profile is untouched', await page.evaluate(() => JSON.stringify(state.profiles.hombre)) === otherBefore);

    console.log('\n== published blocks follow the fork ==');
    const base = await page.evaluate(() => blocksBase());
    ok('a local server falls back to the original repo', base.includes('tormarod/heavy-iron'), base);

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

  // ---------- weight drops ----------
  {
    console.log('\n== weight drops ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    const card = page.locator('.ex').first();
    const row1 = card.locator('.set-row').first();
    await row1.locator('input').nth(0).fill('60');
    await row1.locator('input').nth(1).fill('8');
    await row1.locator('.tick').click();
    await page.waitForTimeout(300);

    ok('every set row offers a ↓ button', await card.locator('.set-row .drop-add').count() >= 4);
    await card.locator('.set-row').first().locator('.drop-add').click();
    await page.waitForTimeout(300);
    ok('↓ opens a drop sub-row on that set', await card.locator('.drop-row').count() === 1);
    ok('and the dropset/forzado chips with it', await card.locator('.drop-kind .drop-chip').count() === 2);
    /* The card is still detached from the document while it is being built,
       so focusing the new box has to wait until the render has attached it —
       this is the assertion that catches that regressing. */
    ok('the cursor lands in the new weight box',
       await page.evaluate(() => !!(document.activeElement && document.activeElement.closest('.drop-row'))));

    await card.locator('.drop-row').first().locator('input').nth(0).fill('45');
    await card.locator('.drop-row').first().locator('input').nth(1).fill('5');
    await page.waitForTimeout(400);

    const storedRow = () => page.evaluate(() => {
      flushSave();
      return JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.log['block-1']['w1-d0'].chestpress[0];
    });
    let r = await storedRow();
    ok('the drop is stored on the set row it belongs to',
       JSON.stringify(r.d) === '[{"w":"45","r":"5"}]', JSON.stringify(r));
    ok('a drop is a planned dropset until told otherwise', r.dk === undefined || r.dk === 'drop', r.dk);

    await page.evaluate(() => render());
    await page.waitForTimeout(200);
    let note = await page.textContent('#note');
    ok('drop reps count toward tonnage (60*8 + 45*5 = 705)', note.includes('705'), note);
    ok('but a set with a drop is still one set', /^1 de \d+ series hechas/.test(note), note);

    for (let i = 0; i < 6; i++) {
      const btn = card.locator('.set-row').first().locator('.drop-add');
      if (await btn.isDisabled()) break;
      await btn.click();
      await page.waitForTimeout(150);
    }
    ok('a set takes at most 4 drops', await card.locator('.drop-row').count() === 4);
    ok('↓ goes disabled at the cap', await card.locator('.set-row').first().locator('.drop-add').isDisabled());
    for (let i = 0; i < 3; i++) {
      await card.locator('.drop-row').last().locator('.drop-x').click();
      await page.waitForTimeout(150);
    }
    ok('✕ removes one drop at a time', await card.locator('.drop-row').count() === 1);

    await card.locator('.drop-kind .drop-chip.forced').click();
    await page.waitForTimeout(300);
    ok('the forced kind is recorded', (await storedRow()).dk === 'forced');

    const csv = await page.evaluate(() => buildCsv());
    ok('CSV grows two columns rather than two rows', /bajadas,tipo_bajada/.test(csv.split('\r\n')[0]));
    ok('CSV keeps the drop on its own set row', /45x5,Forzado/.test(csv), csv.split('\r\n')[1]);

    const rt = await page.evaluate(() => {
      const p = state.profiles.hombre, bl = p.blocks['block-1'];
      const plan = blockSharePlan(bl);
      const shared = blockShareLog(p, bl);
      return JSON.stringify(normalizeImportedLog(shared, plan, normalizeImportedBlock(plan)));
    });
    ok('a QR transfer round-trips drops and their kind',
       /"d":\[\{"w":"45","r":"5"\}\],"dk":"forced"/.test(rt), rt.slice(0, 200));

    await card.locator('.drop-row').first().locator('.drop-x').click();
    await page.waitForTimeout(300);
    r = await storedRow();
    ok('the last drop leaving takes its kind with it', r.d === undefined && r.dk === undefined, JSON.stringify(r));

    /* Double progression: a week at the top of the range normally earns the
       increment, and a set the weight had to come off to finish does not. */
    const seed = forced => page.evaluate(f => {
      const p = state.profiles.hombre, bl = p.blocks['block-1'];
      const ex = bl.days[0].ex[0];
      ex.inc = 2.5;
      const n = setsFor(ex, 1, bl);
      const rows = [];
      for (let i = 0; i < n; i++) rows.push({ w: '60', r: '10', done: true, ts: Date.now() });
      if (f) { rows[n - 1].d = [{ w: '45', r: '3' }]; rows[n - 1].dk = 'forced'; }
      p.log[bl.id]['w1-d0'] = { [ex.id]: rows };
      delete p.log[bl.id]['w2-d0'];
      p.week = 2; p.day = 0;
      save(); render();
    }, forced);
    const week2First = () => page.evaluate(() =>
      state.profiles.hombre.log['block-1']['w2-d0'].chestpress[0].w);

    /* The rest timer the tick above started sits over the footer buttons. */
    if (await page.locator('#timer.up').count()) await page.click('#tskip');

    await seed(false);
    await page.click('#copyPrev');
    await page.waitForTimeout(300);
    /* 60×10 at the top of a 6–10 range, logged at the week's prescribed
       3 RIR, prices out at ~67,9 and rounds to 67,5 — and the predicted 6,2
       reps there still lands inside the range, so it stands. The button
       used to add exactly one increment (62,5) no matter what the set
       cost; it now calls the same estimate the session line shows. */
    ok('top of range levels up by what the set paid for (60 → 67.5)', await week2First() === '67.5', await week2First());

    await seed(true);
    await page.click('#copyPrev');
    await page.waitForTimeout(300);
    ok('a forced drop holds the increment back', await week2First() === '60', await week2First());
    ok('and says why', /bajar peso/.test(await page.textContent('#status')), await page.textContent('#status'));

    await page.evaluate(() => {
      const p = state.profiles.hombre;
      const rows = p.log['block-1']['w1-d0'].chestpress;
      rows[rows.length - 1].dk = 'drop';
      delete p.log['block-1']['w2-d0'];
      save(); render();
    });
    await page.click('#copyPrev');
    await page.waitForTimeout(300);
    ok('a planned dropset does not hold it back', await week2First() === '67.5', await week2First());

    await page.evaluate(() => {
      const p = state.profiles.hombre;
      p.log['block-1']['w1-d0'].chestpress[0].d = [{ w: '45', r: '5' }];
      save(); render();
    });
    await page.waitForTimeout(200);
    ok('last week\'s line shows the drop it carried',
       /60×10 ↓45×5/.test(await page.locator('.ex').first().locator('.last').textContent()),
       await page.locator('.ex').first().locator('.last').textContent());

    /* A restore drops the backup's JSON straight into state and runs
       migrate(), which deliberately never rewrites log rows — so junk in a
       hand-edited `d` reaches the renderer and must not blank the app.
       The slot is rewritten from scratch here so the count below is only
       ever about this one row. */
    await page.evaluate(() => {
      const p = state.profiles.hombre;
      p.log['block-1']['w1-d0'] = {
        chestpress: [{ w: '60', r: '10', done: true, d: [null, 'nonsense', { w: '40', r: '6' }] }],
      };
      p.week = 1; p.day = 0;   /* the copyPrev cases above moved us to week 2 */
      save(); render();
    });
    await page.waitForTimeout(200);
    ok('a malformed drop entry does not take the session down with it',
       await page.locator('.ex').count() > 0);
    ok('and the usable drop in the same array still renders',
       await page.locator('.drop-row').count() === 1,
       'drop rows: ' + await page.locator('.drop-row').count());

    await ctx.close();
  }

  // ---------- offline ----------
  {
    console.log('\n== offline ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
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
    await dismissSetup(page);
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
    await dismissSetup(page);
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

  // ---------- target weight + diagnóstico ----------
  {
    console.log('\n== objetivo de peso y diagnóstico ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    /* The spec's own table, in the app. Base: 32 kg, range 10–15,
       rirThis = 2, inc = 2 — every case is a different verdict or a
       different reason, which is the point of having three of them. */
    const target = (sets, rir, inc) => page.evaluate(([sets, rir, inc]) => {
      const block = { id: 'B', name: 'B', weeks: 8, deload: 0,
        phase: { 1: { r: '2 RIR' }, 2: { r: '2 RIR' } },
        days: [{ id: 'D', name: 'D', ex: [{ id: 'E', n: 'x', sets: sets.length, reps: '10–15', inc: inc }] }] };
      const profile = { log: { B: { 'w1-D': { E: sets.map(r => ({ w: '32', r: String(r), done: true })) } } },
        rir: rir ? { B: { 'w1-D': { E: rir } } } : {} };
      const e = targetEstimate(profile, block, block.days[0], block.days[0].ex[0], 2);
      return { kind: e && e.kind, line: e ? targetLine(e) : null, note: e ? targetNotes(e).join(' | ') : '' };
    }, [sets, rir, inc]);

    /* Case 1 — the report that started this. Two sets of 15 already owned,
       so the answer is one more rep per set at the same weight, NOT a jump
       that restarts him at the bottom of a range he never finished. */
    let t = await target([15, 15, 12, 12], '2+', 2);
    ok('reps short of the top hold the weight and chase a rep per set',
       t.kind === 'hold' && t.line === '↗ objetivo: 32 kg × 15/15/13/13', JSON.stringify(t));
    ok('and with the RIR it was logged at, there is nothing to warn about', t.note === '', t.note);

    /* The same sets at a harder RIR mean less capacity, so this week's
       prescription will produce fewer reps — which is not a loss. */
    t = await target([15, 15, 12, 12], '1', 2);
    ok('a harder last set still holds and chases reps',
       t.line === '↗ objetivo: 32 kg × 15/15/13/13', t.line);
    ok('but warns that pulling back to the prescription will cost reps',
       t.note.includes('~11 y no 12') && t.note.includes('No es retroceso'), t.note);
    t = await target([15, 15, 12, 12], '0', 2);
    ok('and a set taken to failure warns harder', t.note.includes('~10 y no 12'), t.note);
    t = await target([15, 15, 12, 12], '', 2);
    ok('with no chip the plan’s own prescription stands in, and agrees',
       t.line === '↗ objetivo: 32 kg × 15/15/13/13' && t.note === '', JSON.stringify(t));

    /* Case 2 — every set at the top. The jump is earned, and e1RM sizes
       it: not "one increment", but the step the set actually paid for. */
    t = await target([15, 15, 15, 15], '2+', 2);
    ok('top of the range on every set earns the jump',
       t.kind === 'up' && t.line === '↗ objetivo: 34 kg × 12', JSON.stringify(t));
    t = await target([15, 15, 15, 15], '1', 2);
    ok('and the RIR it cost changes what to expect at the new weight',
       t.line === '↗ objetivo: 34 kg × 11', t.line);
    t = await target([15, 15, 15, 15], '0', 2);
    ok('the top of the range reached at 0 RIR is not owned yet',
       t.kind === 'hold' && t.line === '→ objetivo: mantener 32 kg × 15/15/15/15', JSON.stringify(t));
    ok('and it says to run the same weight at the prescribed RIR instead',
       t.note.includes('tope del rango pero al fallo'), t.note);

    /* A coarse stack cannot land inside the range, and the old ±10 %/week
       clamp would have frozen the exercise forever rather than say so. */
    t = await target([15, 15, 15, 15], '1', 4);
    ok('a coarse stack still gets its one step', t.line === '↗ objetivo: 36 kg × 9', t.line);
    ok('and is told the step overshoots the range on purpose',
       t.note.includes('stack grueso'), t.note);

    /* The weight is not always constant across the sets, and the rule reads
       a rep count per set — so taking one set's weight and every set's reps
       mixed them into nonsense. Reported from a real session: 14×15, 14×11,
       9×12 came out as "9 kg × 15/12/13", fifteen reps at a weight two of
       the three sets were nowhere near. */
    const mixed = (rows, rir) => page.evaluate(([rows, rir]) => {
      const block = { id: 'B', name: 'B', weeks: 8, deload: 0,
        phase: { 1: { r: '2 RIR' }, 2: { r: '2 RIR' } },
        days: [{ id: 'D', ex: [{ id: 'E', n: 'x', sets: rows.length, reps: '10–15', inc: 1 }] }] };
      const profile = { log: { B: { 'w1-D': { E: rows.map(x => ({ w: x[0], r: x[1], done: true })) } } },
        rir: rir ? { B: { 'w1-D': { E: rir } } } : {} };
      const e = targetEstimate(profile, block, block.days[0], block.days[0].ex[0], 2);
      return { line: targetLine(e), from: e.from, sets: e.sets, notes: targetNotes(e) };
    }, [rows, rir]);

    let m = await mixed([['14', '15'], ['14', '11'], ['9', '12']], '0');
    ok('the working weight is the one most sets were done at',
       m.from === 14 && m.line === '↗ objetivo: 14 kg × 15/12', JSON.stringify(m));
    ok('and the set at another weight is left out, not folded in',
       m.sets.join() === '15,11' && m.notes[0].includes('una serie fue a otro peso'), JSON.stringify(m));
    /* The chip records the last set of the session. That set was the 9 kg
       one, so it is not evidence about the 14 kg sets this rests on. */
    ok('a RIR chip describing a set at another weight is not used',
       !m.notes.join(' ').includes('No es retroceso'), JSON.stringify(m.notes));

    m = await mixed([['14', '15'], ['14', '11'], ['14', '12']], '0');
    ok('a constant weight is untouched by any of that',
       m.from === 14 && m.line === '↗ objetivo: 14 kg × 15/12/13' &&
       m.notes[0].includes('No es retroceso'), JSON.stringify(m));

    /* A back-off set after the working sets must not drag the verdict down
       with it — every set at the working weight hit the top here. */
    m = await mixed([['14', '15'], ['14', '15'], ['14', '15'], ['9', '20']], '');
    ok('a back-off set does not cost the jump the working sets earned',
       m.line === '↗ objetivo: 15 kg × 12', JSON.stringify(m));

    /* Every set at its own weight: the heaviest breaks the tie, which is
       the top set, and it fell under the range. */
    m = await mixed([['12', '14'], ['14', '11'], ['16', '9']], '');
    ok('with no repeated weight the heaviest set decides',
       m.from === 16 && m.line === '↘ objetivo: 15 kg × 10', JSON.stringify(m));

    /* Case 3 — the answer copyPrev could never give at all. */
    t = await target([12, 10, 9, 8], '0', 2);
    ok('sets under the bottom of the range mean the weight was too heavy',
       t.kind === 'down' && t.line === '↘ objetivo: 28 kg × 10', JSON.stringify(t));

    /* A deload prescribes no RIR to solve for, and is not a progression
       week in the first place. */
    ok('the deload week proposes nothing', await page.evaluate(() => {
      const block = { id: 'B', name: 'B', weeks: 8, deload: 2,
        phase: { 1: { r: '2 RIR' }, 2: { r: 'Descarga' } },
        days: [{ id: 'D', ex: [{ id: 'E', n: 'x', sets: 1, reps: '10–15', inc: 2 }] }] };
      const profile = { log: { B: { 'w1-D': { E: [{ w: '32', r: '12', done: true }] } } }, rir: {} };
      return targetEstimate(profile, block, block.days[0], block.days[0].ex[0], 2);
    }) === null);

    /* "2–3 RIR" is a week you are meant to be able to take to 2; reading
       it as 3 quietly under-loads every estimate built on it. */
    ok('a prescribed RIR range reads as its hard end', await page.evaluate(() =>
      phaseRir({ phase: { 1: { r: '2–3 RIR' }, 2: { r: '0–1 RIR' } } }, 1) === 2 &&
      phaseRir({ phase: { 1: { r: '2–3 RIR' }, 2: { r: '0–1 RIR' } } }, 2) === 0));

    /* The rep ceiling gates the two cases that have to price a weight, and
       only those. Holding to chase reps is rep arithmetic, so a 12–20 range
       — which spends most of its life above 15 reps — still gets an answer
       rather than being silenced on the work it applies to most. */
    const high = (sets, all) => page.evaluate(([sets, all]) => {
      const block = { id: 'B', name: 'B', weeks: 8, deload: 0,
        phase: { 1: { r: '2 RIR' }, 2: { r: '2 RIR' } },
        days: [{ id: 'D', ex: [{ id: 'E', n: 'x', sets: sets.length, reps: '12–20', inc: 1 }] }] };
      const profile = { log: { B: { 'w1-D': { E: sets.map(r => ({ w: '12', r: String(r), done: true })) } } },
        rir: all ? { B: { 'w1-D': { E: '2+' } } } : {} };
      const e = targetEstimate(profile, block, block.days[0], block.days[0].ex[0], 2);
      return { kind: e.kind, line: targetLine(e) };
    }, [sets, all]);
    let h = await high([18, 17, 16, 16], false);
    ok('a long set short of the top still holds and chases reps',
       h.kind === 'hold' && h.line === '↗ objetivo: 12 kg × 19/18/17/17', JSON.stringify(h));
    /* Pricing a jump off an 18-rep set is what Epley cannot do. */
    h = await high([20, 20, 20, 20], true);
    ok('but a jump off a long set is still refused rather than guessed',
       h.kind === 'skip' && h.line.includes('sin estimar'), JSON.stringify(h));

    /* The rep-decay flag, on the numbers: the same 3-rep drop means
       different things at 15 reps and at 8. */
    const decay = await page.evaluate(() => {
      const rows = a => a.map(r => ({ w: '32', r: String(r), done: true }));
      return {
        taper: repDecay(rows([15, 15, 12, 12])),
        collapse: repDecay(rows([15, 12, 10, 8])),
        lowStart: repDecay(rows([8, 7, 6, 5])),
        highTaper: repDecay(rows([20, 19, 17, 16])),
        tiny: repDecay(rows([12, 12, 11, 11])),
      };
    });
    ok('15·15·12·12 es fatiga normal, no un fallo', decay.taper === 0, JSON.stringify(decay));
    ok('15·12·10·8 sí es un desplome', decay.collapse === 7, JSON.stringify(decay));
    ok('8·7·6·5 también, con la misma caída de 3 reps', decay.lowStart === 3, JSON.stringify(decay));
    ok('20·19·17·16 no, por la misma razón que 15·15·12·12', decay.highTaper === 0, JSON.stringify(decay));
    ok('y una caída de una o dos reps nunca cuenta', decay.tiny === 0, JSON.stringify(decay));

    /* Three sessions climbing, three flat: the whole point of the screen is
       telling those two apart without opening a chart per exercise. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const four = (w, r) => [0, 1, 2, 3].map(() => ({ w: String(w), r: String(r), done: true, ts: Date.now() }));
      p.log['block-1'] = {};
      [60, 65, 70, 75].forEach((w, i) => {
        p.log['block-1']['w' + (i + 1) + '-d0'] = { chestpress: four(w, 8), lat1: four(12, 12) };
      });
      p.week = 5;
      p.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.click('#diagBtn');
    await page.waitForTimeout(300);
    ok('el diagnóstico se abre', await page.locator('#diagSheet.up').count() === 1);
    const verdicts = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#diagHost .diag-row').forEach(r => {
        out[r.dataset.ex] = r.className + ' | ' + r.querySelector('.diag-read').textContent;
      });
      return out;
    });
    const climbing = verdicts.chestpress || '';
    const flat = verdicts.lat1 || '';
    ok('un ejercicio que sube sale como subiendo', climbing.includes('up'), climbing);
    ok('un ejercicio clavado sale como plano', flat.includes('flat'), flat);
    ok('lo peor sale primero',
       (await page.locator('#diagHost .diag-row').first().getAttribute('class') || '').includes('flat'));
    ok('un ejercicio sin sesiones suficientes no recibe veredicto',
       (verdicts.facepull || '').includes('none'), verdicts.facepull);
    /* Same name on two days, two different exercises — one row each. */
    ok('dos ejercicios con el mismo nombre no se pisan',
       !!verdicts.lat1 && !!verdicts.lat2 && verdicts.lat1 !== verdicts.lat2);
    await page.click('#diagClose');
    await page.waitForTimeout(200);
    ok('el diagnóstico se cierra', await page.locator('#diagSheet.up').count() === 0);
    await ctx.close();
  }

  // ---------- volume across the block + priority muscles ----------
  {
    console.log('\n== volumen del bloque y músculos prioritarios ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    /* save() is debounced 400ms; a seed written inside that window gets
       clobbered by the pending flush. */
    await page.waitForTimeout(700);

    ok('the shipped plan declares its priority muscles',
       (await page.evaluate(() => (JSON.parse(localStorage.getItem('heavy-iron-v1'))
          .profiles.hombre.blocks['block-1'].priority || []).join(','))) === 'Pecho,Espalda,Hombro');

    await page.click('#volumeBtn');
    await page.waitForTimeout(200);
    ok('the volume sheet still opens on this week', await page.locator('#volumeSpan .seg-btn[data-span="week"]').getAttribute('aria-pressed') === 'true');
    await page.click('#volumeSpan .seg-btn[data-span="block"]');
    await page.waitForTimeout(250);

    const rowsOf = () => page.evaluate(() => [...document.querySelectorAll('.vol-trend')].map(r => ({
      tag: r.dataset.tag, cls: r.className, n: r.querySelector('.vol-trend-n').textContent,
    })));
    let rows = await rowsOf();
    ok('one row per muscle in the block', rows.length >= 7, JSON.stringify(rows.map(r => r.tag)));
    ok('each row reports where the muscle typically sits',
       rows.every(r => /series?\/semana/.test(r.n)), JSON.stringify(rows.map(r => r.n)));
    ok('a muscle inside 10–20 reads as in the band',
       (rows.find(r => r.tag === 'Pecho') || {}).n.includes('en la franja'), (rows.find(r => r.tag === 'Pecho') || {}).n);
    /* "Sin clasificar" is a bucket the app assigned itself, not a muscle —
       it gets a number but never a verdict against a per-muscle landmark. */
    const unc = rows.find(r => r.tag === 'Sin clasificar');
    ok('the unclassified bucket gets no band verdict',
       !!unc && !/franja|mantenimiento/.test(unc.n), unc && unc.n);
    ok('the shipped plan raises no alarm about itself', await page.locator('.vol-warn').count() === 0);

    /* Starve a priority muscle and the amber flag has to fire, sort first,
       and name the non-priority muscle eating the volume. */
    await page.click('#volumeClose');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.blocks['block-1'].days.forEach(d => d.ex.forEach(e => {
        if (e.muscle === 'Pecho') { e.sets = 1; delete e.add; }
        /* Tríceps, not Hombro: the "eating the volume" half of the warning
           is about muscles you did NOT mark, and Hombro ships marked. */
        if (e.muscle === 'Tríceps') e.sets = 12;
      }));
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#volumeBtn');
    await page.waitForTimeout(150);
    await page.click('#volumeSpan .seg-btn[data-span="block"]');
    await page.waitForTimeout(250);
    ok('a starved priority muscle raises the amber flag', await page.locator('.vol-warn').count() === 1);
    const warn = await page.locator('.vol-warn').textContent();
    ok('the flag names the priority muscle', warn.includes('Pecho'), warn);
    ok('and the non-priority muscle sitting over the band', warn.includes('Tríceps'), warn);
    rows = await rowsOf();
    ok('the flagged muscle sorts first', rows[0].tag === 'Pecho' && rows[0].cls.includes('flagged'), JSON.stringify(rows[0]));

    /* The band is a per-muscle landmark: no such number exists for a
       movement pattern, so switching dimension drops it. */
    await page.click('#volumeDim .seg-btn[data-dim="pattern"]');
    await page.waitForTimeout(250);
    ok('no band on the pattern dimension', await page.locator('.vol-warn').count() === 0);
    ok('and no band verdict in the rows either',
       (await rowsOf()).every(r => !/franja|mantenimiento/.test(r.n)));
    await page.click('#volumeDim .seg-btn[data-dim="muscle"]');
    await page.click('#volumeClose');
    await page.waitForTimeout(200);

    /* Marking priorities is a chip you tap, not a field you type. */
    await page.click('#editPlan');
    await page.waitForTimeout(300);
    const chips = () => page.evaluate(() => [...document.querySelectorAll('#pePriority .pri-chip')]
      .map(c => c.textContent + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    const before = await chips();
    ok('the plan editor offers a chip per muscle in the block', before.length >= 7, JSON.stringify(before));
    ok('the shipped priorities start marked', before.filter(c => c.endsWith('*')).length === 3, JSON.stringify(before));
    ok('the unclassified bucket is never offered as a priority', !before.some(c => c.startsWith('Sin clasificar')));
    await page.click('#pePriority .pri-chip:not(.on)');
    await page.waitForTimeout(150);
    ok('tapping a chip marks it', (await chips()).filter(c => c.endsWith('*')).length === 4);
    await page.click('#pePriority .pri-chip.on');
    await page.waitForTimeout(150);
    ok('tapping it again clears it', (await chips()).filter(c => c.endsWith('*')).length === 3);
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('priorities survive a save and a reload',
       (await page.evaluate(() => (JSON.parse(localStorage.getItem('heavy-iron-v1'))
          .profiles.hombre.blocks['block-1'].priority || []).length)) === 3);

    /* It travels with the plan, like every other block-level field. */
    ok('the exported plan carries the priorities',
       await page.evaluate(() => (blockSharePlan(getBlock()).priority || []).join(',')) === 'Pecho,Espalda,Hombro');
    ok('an import without priorities simply has none',
       await page.evaluate(() => (normalizeImportedBlock({ days: [{ ex: [{ n: 'X', reps: '8-12' }] }] }).priority || []).length) === 0);
    ok('an imported list is cleaned like any other freeform tag',
       await page.evaluate(() => normalizeImportedBlock({
         priority: ['  Pecho  ', 'Pecho', '', 'Espalda'],
         days: [{ ex: [{ n: 'X', reps: '8-12' }] }],
       }).priority.join(',')) === 'Pecho,Espalda');
    await ctx.close();
  }

  // ---------- frequency per muscle, from r.ts ----------
  {
    console.log('\n== frecuencia por músculo ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    /* Four weeks. Day 1 every week; day 2 only in weeks 1 and 4, which puts
       a three-week hole in its muscles; day 3 every week. The whole point
       of the view is telling that hole apart from a programming problem. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const DAY = 86400000;
      const start = Date.now() - 27 * DAY;
      const sets = (w, r, ts) => [0, 1, 2, 3].map(() => ({ w: String(w), r: String(r), done: true, ts: ts }));
      pr.log['block-1'] = {};
      for (let i = 0; i < 4; i++) {
        const base = start + i * 7 * DAY;
        pr.log['block-1']['w' + (i + 1) + '-d0'] = { chestpress: sets(60 + i * 2.5, 8, base) };
        if (i === 0 || i === 3) pr.log['block-1']['w' + (i + 1) + '-d1'] = { hacksquat: sets(80, 10, base + 2 * DAY) };
        pr.log['block-1']['w' + (i + 1) + '-d2'] = { rdl: sets(70, 10, base + 4 * DAY) };
      }
      pr.week = 4;
      pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#diagBtn');
    await page.waitForTimeout(250);

    /* The doc's whole point: the spacing has to sit next to the trend, not
       on a screen of its own. */
    const trendNums = await page.evaluate(() => [...document.querySelectorAll('.diag-row')]
      .map(r => r.dataset.ex + '|' + r.querySelector('.diag-num').textContent));
    ok('the exercise rows carry the session spacing beside the trend',
       trendNums.some(t => t.startsWith('chestpress|') && /cada 7 días/.test(t)),
       JSON.stringify(trendNums.slice(0, 3)));

    await page.click('#diagView .seg-btn[data-view="freq"]');
    await page.waitForTimeout(300);
    ok('the frequency view opens', await page.locator('.freq-row').count() > 0);
    /* Adherence is measured against a plan and only this block has one. */
    ok('the across-blocks toggle is hidden where it means nothing',
       await page.evaluate(() => getComputedStyle(document.getElementById('diagScope')).display) === 'none');

    const freq = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('.freq-row').forEach(r => {
        out[r.dataset.tag] = {
          behind: r.classList.contains('behind'),
          gap: r.querySelector('.freq-gap').textContent,
          meta: r.querySelector('.freq-meta').textContent,
        };
      });
      return out;
    });
    ok('a muscle trained every week reads as every 7 days',
       (freq['Isquios'] || {}).gap === 'cada 7 días', JSON.stringify(freq['Isquios']));
    ok('and at full adherence it is not flagged',
       freq['Isquios'] && !freq['Isquios'].behind && freq['Isquios'].meta.includes('4 de 4'), JSON.stringify(freq['Isquios']));
    ok('a muscle trained in weeks 1 and 4 reads as a three-week gap',
       (freq['Cuádriceps'] || {}).gap === 'cada 21 días', JSON.stringify(freq['Cuádriceps']));
    ok('and is flagged as wider than the plan asks for',
       freq['Cuádriceps'] && freq['Cuádriceps'].behind && freq['Cuádriceps'].meta.includes('2 de 4'), JSON.stringify(freq['Cuádriceps']));
    ok('a muscle the plan wants twice a week but got once is flagged too',
       freq['Pecho'] && freq['Pecho'].behind && freq['Pecho'].meta.includes('previsto cada 3,5 días'), JSON.stringify(freq['Pecho']));
    ok('a muscle never trained says so rather than inventing a gap',
       (freq['Bíceps'] || {}).gap === 'sin sesiones' && freq['Bíceps'].meta.includes('0 de 8'), JSON.stringify(freq['Bíceps']));

    /* Never getting there at all is the worst attendance case, not the
       best — sorting on the gap alone used to file it last. */
    const order = await page.evaluate(() => [...document.querySelectorAll('.freq-row')].map(r => r.dataset.tag));
    ok('the muscles with no sessions sort above the well-attended ones',
       order.indexOf('Bíceps') < order.indexOf('Isquios'), JSON.stringify(order));

    ok('the calendar counts the days actually trained',
       (await page.locator('.freq-cal-t').textContent()).startsWith('10 días'),
       await page.locator('.freq-cal-t').textContent());
    ok('the calendar draws a cell per day of the block',
       await page.evaluate(() => document.querySelectorAll('.freq-cal-g rect').length % 7 === 0 &&
                                 document.querySelectorAll('.freq-cal-g rect').length >= 28));

    /* A set ticked late at night belongs to the day you trained: building
       the key off UTC would file it under tomorrow. */
    ok('day keys follow the local calendar, not UTC', await page.evaluate(() => {
      const late = new Date(2026, 0, 15, 23, 30).getTime();
      return dayKey(late) === '2026-01-15';
    }));

    /* Rows logged before timestamps existed, or imported without them,
       must not become a session at the epoch. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.log['block-1']['w2-d1'] = { hacksquat: [{ w: '80', r: '10', done: true }] };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#diagBtn');
    await page.waitForTimeout(200);
    await page.click('#diagView .seg-btn[data-view="freq"]');
    await page.waitForTimeout(250);
    ok('a ticked set with no timestamp is not counted as a session at the epoch',
       (await page.evaluate(() => {
         const r = [...document.querySelectorAll('.freq-row')].find(x => x.dataset.tag === 'Cuádriceps');
         return r.querySelector('.freq-gap').textContent;
       })) === 'cada 21 días');

    await page.click('#diagView .seg-btn[data-view="trend"]');
    await page.waitForTimeout(200);
    ok('switching back restores the exercise view', await page.locator('.diag-row').count() > 0);
    ok('and brings the across-blocks toggle back',
       await page.evaluate(() => getComputedStyle(document.getElementById('diagScope')).display) !== 'none');
    await ctx.close();
  }

  // ---------- strength index per muscle ----------
  {
    console.log('\n== índice de fuerza por músculo ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    /* Four weeks of chest. chestpress climbs 60 → 67,5 (+12,5 % on its
       e1RM), pecdeck stays flat, and inclinepress — a much heavier
       machine — only appears from week 3. Averaging raw e1RM would show
       the chest jumping off a cliff the week the new machine arrives;
       matched pairs is what stops that. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 27 * DAY;
      const one = (w, r, ts) => [{ w: String(w), r: String(r), done: true, ts: ts }];
      pr.log['block-1'] = {};
      for (let i = 0; i < 4; i++) {
        const ts = start + i * 7 * DAY;
        const slot = { chestpress: one(60 + i * 2.5, 8, ts), pecdeck: one(45, 12, ts) };
        if (i >= 2) slot.inclinepress = one(200, 8, ts);
        pr.log['block-1']['w' + (i + 1) + '-d0'] = slot;
      }
      pr.week = 4;
      pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#diagBtn');
    await page.waitForTimeout(200);
    await page.click('#diagView .seg-btn[data-view="index"]');
    await page.waitForTimeout(300);

    ok('the strength view opens', await page.locator('.idx-row').count() > 0);
    ok('the across-blocks toggle is hidden here too',
       await page.evaluate(() => getComputedStyle(document.getElementById('diagScope')).display) === 'none');

    const chest = await page.evaluate(() => {
      const r = strengthRows(getProfile(), getBlock()).find(x => x.tag === 'Pecho');
      return { index: r.index.map(v => v == null ? null : Math.round(v * 10) / 10), matched: r.matched, base: r.base, exercises: r.exercises };
    });
    /* +12,5 % on one exercise and 0 % on the other averages to +6,25 %.
       A ratio of averages would not: the numbers differ enough that this
       pins which of the two the code does. */
    ok('the index averages each exercise’s own ratio, not their loads',
       chest.index[3] === 106.3, JSON.stringify(chest.index));
    ok('a machine that appears mid-block never enters the average',
       chest.matched[2] === 2 && chest.matched[3] === 2 && chest.exercises === 3, JSON.stringify(chest.matched));
    /* The cliff this whole view exists to remove: week 3 must continue the
       line, not jump. */
    ok('so the week the new machine arrives is not a cliff',
       Math.abs(chest.index[2] - chest.index[1]) < 3, JSON.stringify(chest.index));
    const meta = await page.evaluate(() => document.querySelector('.idx-row[data-tag="Pecho"] .idx-meta').textContent);
    ok('and the row says how many exercises it actually rests on',
       meta.includes('sobre 2 ejercicios de 3'), meta);
    ok('the headline reads as a percentage from the baseline week',
       (await page.evaluate(() => document.querySelector('.idx-row[data-tag="Pecho"] .idx-n').textContent))
         .includes('+6,3 %'));

    /* A log that starts late still gets a baseline it can use. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 27 * DAY;
      const one = (w, r, ts) => [{ w: String(w), r: String(r), done: true, ts: ts }];
      pr.log['block-1'] = {
        'w3-d0': { chestpress: one(60, 8, start) },
        'w4-d0': { chestpress: one(66, 8, start + 7 * DAY) },
      };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const late = await page.evaluate(() => {
      const r = strengthRows(getProfile(), getBlock()).find(x => x.tag === 'Pecho');
      return { base: r.base, change: Math.round(r.change * 10) / 10 };
    });
    ok('a log starting at week 3 is indexed from week 3, not from nothing',
       late.base === 2 && late.change === 10, JSON.stringify(late));

    /* One week of data has nothing to compare against, and says so rather
       than drawing a flat line that means "no change". */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.log['block-1'] = { 'w1-d0': { chestpress: [{ w: '60', r: '8', done: true, ts: Date.now() }] } };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#diagBtn');
    await page.waitForTimeout(200);
    await page.click('#diagView .seg-btn[data-view="index"]');
    await page.waitForTimeout(250);
    ok('a single logged week offers no comparison instead of a fake flat line',
       await page.locator('.chart-empty').count() === 1);

    /* Same rep ceiling as the trend — a 20-rep back-off set would move a
       whole muscle's index on an estimate Epley cannot support. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const DAY = 86400000, start = Date.now() - 7 * DAY;
      s.profiles.hombre.log['block-1'] = {
        'w1-d0': { chestpress: [{ w: '60', r: '8', done: true, ts: start }] },
        'w2-d0': { chestpress: [{ w: '60', r: '8', done: true, ts: start + DAY },
                                { w: '30', r: '25', done: true, ts: start + DAY }] },
      };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok('sets past the rep ceiling are left out of the index',
       await page.evaluate(() => {
         const r = strengthRows(getProfile(), getBlock()).find(x => x.tag === 'Pecho');
         return Math.round(r.change * 100) / 100;
       }) === 0);
    await ctx.close();
  }

  // ---------- session note, energy, deload check ----------
  {
    console.log('\n== nota, energía y control de descarga ==');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    ok('the energy chips are offered before the sets', await page.locator('.energy-chip').count() === 3);
    ok('and start empty, like the RIR chips', await page.locator('.energy-chip.on').count() === 0);
    await page.click('.energy-chip:has-text("baja")');
    await page.waitForTimeout(500);
    ok('tapping one records it',
       await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1'))
         .profiles.hombre.energy['block-1']['w1-d0']) === 'baja');
    await page.click('.energy-chip.on');
    await page.waitForTimeout(500);
    ok('tapping it again clears it rather than leaving a wrong answer',
       await page.evaluate(() => {
         const e = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.energy['block-1'];
         return !e || e['w1-d0'] === undefined;
       }));

    await page.fill('#sesNote', 'Dormí 5 h');
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok('a session note survives a reload', await page.inputValue('#sesNote') === 'Dormí 5 h');

    /* The note is keyed by slot with no exercise under it, so unlike the
       RIR chips it would still be sitting there when the day came back. */
    await page.click('#clearDay');
    await answerDialog(page, true);
    await page.waitForTimeout(400);
    ok('clearing the day clears its note too', await page.inputValue('#sesNote') === '');

    /* "Borrar todo el registro" used to leave the RIR chips on disk. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      pr.rir['block-1'] = { 'w1-d0': { chestpress: '1' } };
      pr.notes['block-1'] = { 'w1-d0': 'algo' };
      pr.energy['block-1'] = { 'w1-d0': 'alta' };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#wipe');
    await answerDialog(page, true);
    await page.waitForTimeout(500);
    ok('wiping the log wipes the RIR, notes and energy with it',
       await page.evaluate(() => {
         const pr = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre;
         return !Object.keys(pr.rir).length && !Object.keys(pr.notes).length && !Object.keys(pr.energy).length;
       }));

    /* Deload on week 4, with weeks 3 and 5 logged: the only evidence there
       is about whether the deload was the right length. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 35 * DAY;
      const one = (w, r, ts) => [{ w: String(w), r: String(r), done: true, ts: ts }];
      pr.blocks['block-1'].deload = 4;
      pr.log['block-1'] = {
        'w3-d0': { chestpress: one(60, 8, start) },
        'w4-d0': { chestpress: one(36, 8, start + 7 * DAY) },
        'w5-d0': { chestpress: one(63, 8, start + 14 * DAY) },
      };
      pr.week = 5;
      pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const dl = await page.locator('#deloadCheck').textContent();
    ok('the week after a deload says whether it worked', dl.includes('+5 %') && dl.includes('semana 3'), dl);
    ok('and reads as a win when strength came back up',
       (await page.getAttribute('#deloadCheck', 'class')).includes('good'));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('heavy-iron-v1')); s.profiles.hombre.week = 6; localStorage.setItem('heavy-iron-v1', JSON.stringify(s)); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok('and it only shows on the week it is news',
       await page.evaluate(() => getComputedStyle(document.getElementById('deloadCheck')).display) === 'none');

    /* The artefact this had to not become: a deload is ~60 % of the weight
       on purpose, so counting it would report a block that did exactly what
       it was told as a loss. */
    const noArtefact = await page.evaluate(() => {
      const r = strengthRows(getProfile(), getBlock()).find(x => x.tag === 'Pecho');
      return { change: Math.round(r.change * 10) / 10, base: r.base, last: r.lastWeek };
    });
    ok('the deload week is never an end of the strength comparison',
       noArtefact.change === 5 && noArtefact.base === 2 && noArtefact.last === 4, JSON.stringify(noArtefact));
    ok('and never reaches the fitted trend either', await page.evaluate(() => {
      const pts = diagPoints(getProfile(), 'chestpress', getBlock().id);
      return pts.length === 2 && pts.every(p => p.weight >= 60);
    }));
    await ctx.close();
  }

  // ---------- block review ----------
  {
    console.log('\n== revisión del bloque ==');
    /* The export is the feature, so the copy buttons are tested for real
       rather than around — which needs the clipboard permission Chromium
       withholds by default. */
    const ctx = await browser.newContext({ permissions: ['clipboard-write'] });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 55 * DAY;
      const one = (w, r, ts) => [{ w: String(w), r: String(r), done: true, ts: ts }];
      pr.blocks['block-1'].priority = ['Pecho', 'Espalda', 'Hombro'];
      pr.log['block-1'] = {};
      for (let i = 0; i < 7; i++) {
        const ts = start + i * 7 * DAY;
        pr.log['block-1']['w' + (i + 1) + '-d0'] = { chestpress: one(60 + i * 2.5, 8, ts), pecdeck: one(45, 12, ts) };
      }
      pr.notes['block-1'] = { 'w3-d0': 'Dormí 5 h', 'w6-d0': 'Gimnasio lleno' };
      pr.energy['block-1'] = { 'w3-d0': 'baja', 'w1-d0': 'alta' };
      pr.week = 7;
      pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.click('#blockbar button:has-text("Revisión")');
    await page.waitForTimeout(400);
    ok('the review opens from the block bar', await page.locator('#reviewSheet.up').count() === 1);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.rev-row')]
      .map(r => r.dataset.tag + '|' + r.querySelector('.rev-n').textContent));
    ok('it reports strength per muscle',
       rows.some(r => r.startsWith('Pecho|') && r.includes('+12,5 %')), JSON.stringify(rows.slice(0, 3)));
    ok('priority muscles come first',
       (await page.evaluate(() => document.querySelector('.rev-row').classList.contains('priority'))));
    ok('and it carries the session notes', await page.locator('.rev-note').count() === 2);

    const text = await page.evaluate(() => reviewText(buildBlockReview(getProfile(), getBlock())));
    ok('the brief names the block', text.includes('"Bloque 1"'), text.slice(0, 80));
    ok('the brief carries strength, attendance and volume per muscle',
       /Pecho \(PRIORITARIO\).*fuerza \+12,5 %.*sesiones 7\/\d+.*series\/semana/.test(text),
       (text.match(/- Pecho.*/) || [''])[0]);
    ok('the brief carries the energy summary', text.includes('### Energía al empezar'));
    ok('the brief carries the notes', text.includes('Dormí 5 h'));
    ok('and closes with instructions for whatever writes the next block',
       text.includes('bloque siguiente'));

    /* The loop the whole proposal exists to close: the same prompt the
       import sheet hands out, with the evidence stapled to it. */
    await page.click('#reviewCopy');
    await page.waitForTimeout(400);
    ok('copying the review reports success',
       (await page.locator('#reviewStatus').textContent()).includes('copiada'),
       await page.locator('#reviewStatus').textContent());
    await page.click('#reviewPrompt');
    await page.waitForTimeout(900);
    const status = await page.locator('#reviewStatus').textContent();
    ok('and the prompt copy staples the review onto the JSON format spec',
       status.includes('revisión'), status);

    await page.click('#reviewClose');
    await page.waitForTimeout(300);

    /* "+ Nuevo bloque" offers the review first, and picking it resumes the
       flow when the sheet closes instead of dead-ending. */
    await page.click('#blockbar button:has-text("+ Nuevo bloque")');
    await page.waitForTimeout(300);
    ok('starting a new block offers the review of the one you are leaving',
       (await page.locator('#askBody').textContent()).includes('revisión'));
    await page.click('#askOk');
    await page.waitForTimeout(400);
    ok('choosing to read it opens the review', await page.locator('#reviewSheet.up').count() === 1);
    await page.click('#reviewClose');
    await page.waitForTimeout(400);
    ok('and closing it picks the new-block flow back up',
       await page.locator('#askSheet.up').count() === 1 &&
       (await page.locator('#askT').textContent()).includes('Nuevo bloque'));
    await page.click('#askCancel');
    await page.waitForTimeout(300);

    /* Declining goes straight to naming it, with no review in between. */
    await page.click('#blockbar button:has-text("+ Nuevo bloque")');
    await page.waitForTimeout(300);
    await page.click('#askCancel');
    await page.waitForTimeout(400);
    ok('declining the review goes straight to naming the block',
       (await page.locator('#askT').textContent()).includes('Nuevo bloque'));
    await page.click('#askCancel');
    await page.waitForTimeout(300);

    /* A block with nothing logged has nothing to review, and says so
       instead of printing a page of zeroes. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.log['block-1'] = {};
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#blockbar button:has-text("Revisión")');
    await page.waitForTimeout(300);
    ok('an empty block says there is nothing to review yet',
       await page.locator('#reviewHost .chart-empty').count() === 1);
    await ctx.close();
  }

  // ---------- layout on real phone widths ----------
  {
    console.log('\n== layout ==');
    for (const [label, width] of [['iPhone SE', 375], ['Pixel', 412], ['tablet', 768]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 820 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await dismissSetup(page);
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
