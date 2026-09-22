/* Smoke tests for the whole app, driven in a real browser.
 *
 *   npx playwright install chromium     # once
 *   python3 -m http.server 8765 &                                 # Git Bash
 *   Start-Process python3 -ArgumentList '-m','http.server','8765' # PowerShell
 *   node test/smoke.js
 *
 * Nothing here is a unit test: the app has no modules and no build step, so
 * the useful thing to assert is that a person can open it, log a set, break
 * their data and still get it back. Add a case here whenever a bug turns out
 * to have been invisible from the outside.
 *
 * BASE can be overridden: BASE=http://localhost:8000 node test/smoke.js
 *
 * The suite is a list of independent sections, each opening its own browser
 * context. The full run is what the pre-PR hook does; while working on one
 * thing, run only the sections that can see it:
 *
 *   node test/smoke.js --list                      # the section names, no browser
 *   node test/smoke.js --only "aviso de versión"   # substring, case-insensitive
 *   node test/smoke.js --only recovery --only layout
 *   SMOKE_ONLY=offline,layout node test/smoke.js   # the same, as an env var
 *
 * "main session" is the exception: its sub-headings (boot, undo, QR transfer,
 * …) share one page and build on each other's state, so they run as one
 * section or not at all.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
/* Plan 032 pins the main screen's header height and its set-row floor, so a
   later redesign cannot quietly widen either gap without a red run. Both
   were that plan's "current, not final" values: 034 folded the header and
   lowered HEADER_MAX to 140 (measured: 133), and 036 raised the set row's
   own floor, SET_ROW_MIN, from 40 to 44 — every box, tick and ↓ in the row
   now clears the 44px target size WCAG 2.5.5 asks for, not just the 24px
   2.5.8 requires. */
const HEADER_MAX = 140;
const SET_ROW_MIN = 44;
let pass = 0, fail = 0, skipped = 0;

const argv = process.argv.slice(2);
const LIST = argv.includes('--list');
const ONLY = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only' && argv[i + 1] != null) ONLY.push(argv[++i]);
  else if (argv[i].startsWith('--only=')) ONLY.push(argv[i].slice(7));
}
if (process.env.SMOKE_ONLY) ONLY.push(...process.env.SMOKE_ONLY.split(','));
const wanted = ONLY.map(s => s.trim().toLowerCase()).filter(Boolean);
const selected = name => !wanted.length || wanted.some(w => name.toLowerCase().includes(w));
let ran = 0;

/* One section per browser context. A section that throws — a selector that
   no longer exists, a sheet that never opened — used to abort the whole
   suite through the single catch at the bottom, so one stale line hid every
   later section's result. Now it is recorded as a failure and the next
   section still runs; the contexts it leaves open are closed with the
   browser. */
const section = async (name, fn) => {
  if (LIST) { console.log(name); return; }
  if (!selected(name)) { skipped++; return; }
  ran++;
  console.log('\n== ' + name + ' ==');
  try { await fn(); }
  catch (e) {
    fail++;
    console.log('  FAIL  ' + name + ': the section itself threw  → ' + (e && e.stack || e));
  }
};
/* A device with no saved data now opens on the first-run setup sheet.
   Tests that are not about setup skip it, exactly as a user could. */
const dismissSetup = async page => {
  if (await page.locator('#setupSheet.up').count()) {
    await page.click('#setupClose');
    await page.waitForTimeout(150);
  }
};

/* plans/034 folded the header: the week strip, the profile switcher, the
   block bar and the theme toggle are each one tap further in than they
   were. These are that tap, and they are idempotent so a section can put
   one in front of every click without tracking what it left open. Always
   page.click on the control — openSheet() moves the focus into the box it
   opens, so a keyboard route would type into the wrong place. */
const openWeeks = async page => {
  if (await page.locator('#weekPanel[hidden]').count()) {
    await page.click('#weekBtn');
    await page.waitForSelector('#weekPanel:not([hidden])', { timeout: 4000 });
  }
};
const openSheetVia = async (page, btn, sheet) => {
  if (await page.locator(sheet + '.up').count()) return;
  await page.click(btn);
  await page.waitForSelector(sheet + '.up', { timeout: 4000 });
};
const openProfiles = page => openSheetVia(page, '#profileBtn', '#profileSheet');
const openBlocks = page => openSheetVia(page, '#blockBtn', '#blockSheet');
const openMore = page => openSheetVia(page, '#moreBtn', '#moreSheet');

/* #blockSheet's four actions each open a sheet *over* it and leave it
   standing — that is the point, you came from there — so anything that
   goes back to the page underneath has to put it away first, exactly as a
   person would. The profile sheet needs no partner: picking somebody closes
   it from inside renderProfiles. */
const closeSheetVia = async (page, btn, sheet) => {
  if (!(await page.locator(sheet + '.up').count())) return;
  await page.click(btn);
  await page.waitForSelector(sheet + '.up', { state: 'hidden', timeout: 4000 });
};
const closeBlocks = page => closeSheetVia(page, '#blockClose', '#blockSheet');
const closeMore = page => closeSheetVia(page, '#moreClose', '#moreSheet');

/* plans/037 did it once more, to the whole shell: the nine footer buttons
   and the block bar's four are four destinations now, three of which open a
   hub. Same shape as the two above — the tap, and nothing else — and no
   partner to close it: a hub row that opens another sheet closes its hub on
   the way (js/app.js), so the only thing left standing is what you asked
   for. #copyPrev and #calcBtn are on the page and need none of this. */
const HUB_OF = { progress: ['#navProgress', '#progressSheet'], plan: ['#navPlan', '#planHubSheet'], more: ['#navMore', '#moreSheet'] };
const openHub = (page, which) => openSheetVia(page, HUB_OF[which][0], HUB_OF[which][1]);

/* plans/036 did the same to the card: "Progreso ↗", the two order arrows,
   the ⚙ settings line and the calculator are all one tap further in, four
   of them behind the "⋯" and the machine settings behind the name as well.
   Same shape as the header's helpers above — the tap, and nothing else. */
const openExMenu = async (page, index) => {
  await page.locator('.ex').nth(index).locator('.ex-menu-btn').click();
  await page.waitForSelector('#exMenuSheet.up', { timeout: 4000 });
};
/* `dir` is 'up' or 'down', naming the row rather than a sign: the menu's
   labels say where the card lands, not which way an arrow points. */
const moveEx = async (page, index, dir) => {
  await openExMenu(page, index);
  await page.click(dir === 'up' ? '#exMenuUp' : '#exMenuDown');
  await page.waitForSelector('#exMenuSheet.up', { state: 'hidden', timeout: 4000 });
};
/* The fold behind the name: the alternative, the cue and the machine
   settings. Idempotent, like the header's, so a section can put one in
   front of every read without tracking what it left open. */
const openExMore = async (page, index) => {
  const card = page.locator('.ex').nth(index);
  if (await card.locator('.ex-more:not([hidden])').count()) return;
  await card.locator('.ex-name-btn').click();
  await card.locator('.ex-more:not([hidden])').waitFor({ timeout: 4000 });
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
  const browser = LIST ? null : await chromium.launch();

  // ---------- main session ----------
  await section('main session', async () => {
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
    /* The unit is the card's own column heading since plans/036, said once
       instead of glued inside every weight box. */
    ok('the unit label follows the setting', (await page.locator('.set-head span').first().textContent()) === 'lb');
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

    /* plans/036: the alternative, the cue and the machine settings are
       behind the name now. The field has never been covered here — it used
       to be built only while the ⚙ panel was open, and it is built with
       every card now, so what is worth pinning is that it stays out of the
       way until asked for and still writes to the plan when it is. */
    console.log('\n== what is behind the name ==');
    ok('the fold starts closed', await page.locator('.ex').first().locator('.ex-more[hidden]').count() === 1);
    /* Nothing said the card opened at all before: the name and the meta line
       looked like a title, so the alternative, the cue and the machine
       settings were behind a tap only someone who already knew would try.
       Read as rotation rather than as presence, so a chevron that stopped
       answering the disclosure still fails. */
    const chev = async () => page.evaluate(() => {
      const e = document.querySelector('.ex .ex-name-btn .chev');
      return e ? { hidden: e.getAttribute('aria-hidden'), t: getComputedStyle(e).transform } : null;
    });
    const chevShut = await chev();
    ok('the head carries a chevron, out of the accessibility tree',
       !!chevShut && chevShut.hidden === 'true', JSON.stringify(chevShut));
    await openExMore(page, 0);
    ok('the name says it is open', await page.locator('.ex').first().locator('.ex-name-btn').getAttribute('aria-expanded') === 'true');
    /* Waited for, not read straight away: .chev transitions over .12s, so an
       immediate read catches the identity matrix it starts from. A condition
       wait rather than a sleep, and a miss comes back as this assertion
       failing with both matrices rather than as a timeout that would take the
       rest of the section with it. */
    const chevTurned = await page.waitForFunction(
      () => { const e = document.querySelector('.ex .ex-name-btn .chev');
              return !!e && getComputedStyle(e).transform.replace(/\s/g, '').startsWith('matrix(-1,'); },
      { timeout: 3000 }).then(() => true, () => false);
    const chevOpen = await chev();
    ok('and the chevron turns over with it', chevTurned, chevShut.t + ' → ' + chevOpen.t);
    await page.locator('.ex').first().locator('.ex-setup-in').fill('asiento 4');
    await page.waitForFunction(() => !saveT && !held);
    ok('the machine settings write straight to the plan',
       await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1'))
         .profiles.hombre.blocks['block-1'].days[0].ex[0].setup) === 'asiento 4');
    ok('and the head previews them without opening anything',
       (await page.locator('.ex').first().locator('.ex-meta').textContent()).includes('asiento 4'));

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

    console.log('\n== one card redraws, the rest stand still (plans/008 item 14) ==');
    ok('every card names the exercise it is drawing', await page.locator('#list .ex[data-ex]').count() === 7);
    /* An expando property, not an attribute: it cannot survive the element
       being replaced, which makes it exactly the question "was this card
       rebuilt?". Ticking a set used to rebuild all seven. */
    await page.evaluate(() => {
      document.querySelectorAll('#list .ex').forEach((el, i) => { el.__probe = 'card' + i; });
    });
    await page.locator('.ex').first().locator('.set-row').nth(1).locator('.tick').click();
    await page.waitForTimeout(250);
    ok('the other six cards are still the same elements',
       await page.evaluate(() => Array.from(document.querySelectorAll('#list .ex'))
         .filter((el, i) => i > 0 && el.__probe === 'card' + i).length) === 6);
    ok('the card that was ticked is the one that got rebuilt',
       await page.evaluate(() => document.querySelectorAll('#list .ex')[0].__probe === undefined));
    ok('the keyboard lands on the tick that was pressed rather than falling to <body>',
       await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('tick')));
    const tickedNote = await page.textContent('#note');
    ok('the line under the session counts both ticked sets without a full draw',
       /(^|\s)2 de \d+ series hechas/.test(tickedNote), tickedNote);
    ok('and the progress bar moved with it',
       await page.evaluate(() => parseFloat(document.getElementById('barfill').style.width) > 0));

    /* The half of the win that only a keyboard notices: a redraw of one card
       is invisible to a box being typed in on another. */
    ok('a redraw elsewhere leaves another card\'s box and cursor untouched',
       await page.evaluate(() => {
         const cards = document.querySelectorAll('#list .ex');
         const box = cards[1].querySelector('.set-row input');
         box.focus();
         drawCard(cards[0].dataset.ex);
         return document.activeElement === box;
       }));
    ok('and the rebuilt card keeps the text cursor where it was, not at the end',
       await page.evaluate(() => {
         const card = document.querySelectorAll('#list .ex')[0];
         const box = card.querySelector('.set-row input');
         box.focus();
         box.setSelectionRange(2, 2);
         drawCard(card.dataset.ex);
         const a = document.activeElement;
         /* A different element carrying the same value: the card really was
            rebuilt, and the cursor came across anyway. */
         return a !== box && a.value === box.value && a.selectionStart === 2;
       }));

    console.log('\n== the week dot follows the log (plans/008 item 14) ==');
    const weekDots = () => page.locator('#weeks .wk').first().locator('.dot').count();
    ok('week 1 carries a dot while something is ticked in it', await weekDots() === 1);
    await page.locator('.ex').first().locator('.set-row').nth(1).locator('.tick').click();
    await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(250);
    ok('unticking the last set of the week takes the dot with it', await weekDots() === 0);
    await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(250);
    ok('and the next tick brings it back', await weekDots() === 1);
    await page.click('#tskip');

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

    await openHub(page, 'progress');
    await page.click('#volumeBtn');
    ok('the volume sheet opens', await page.locator('#volumeSheet.up').count() === 1);
    const kgStrip = await page.textContent('#volumeTonnage');
    ok('the kilos strip reports the block total (the one logged set, 22.5*10)', kgStrip.includes('225'), kgStrip);
    ok('with only week 1 logged it says so instead of printing the same number twice',
       kgStrip.includes('todo en la semana 1') && (kgStrip.match(/225/g) || []).length === 1, kgStrip);
    const twoWeekStrip = await page.evaluate(() => {
      const p = getProfile(), b = getBlock(), day = dayList(b)[0].id;
      /* Stamped lb, because this session is in lb and every row the app
         writes goes through stampRowUnit. The strip converts per row since
         plans/011, so an unstamped row here would be read as kg — correctly,
         but it would make this a test of the conversion rather than of the
         block/week split it is actually about. */
      p.log[b.id][slot(2, day)] = { probe: [{ done: true, w: '100', r: '10', u: 'lb' }] };
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
    await openHub(page, 'plan');
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

    await openHub(page, 'plan');
    await page.click('#editPlan');
    await page.locator('.pe-day').first().locator('.pe-ex').nth(0).locator('.f-muscle').fill('');
    await page.click('#peSave');
    await page.waitForTimeout(300);
    ok('clearing the field removes the tag rather than storing an empty string', await page.evaluate(() =>
      !('muscle' in state.profiles.hombre.blocks['block-1'].days[0].ex.find(e => e.id === 'chestpress'))));

    console.log('\n== plan editor: pattern/type tags, same freeform shape as muscle ==');
    await openHub(page, 'plan');
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

    await openHub(page, 'plan');
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
    await openWeeks(page);
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

    console.log('\n== personal record on estimated 1RM ==');
    /* Week 3, same 30 as the week-2 record but more reps: not a heavier
       weight, so no RÉCORD — but a better estimate, so the outlined one. */
    await openWeeks(page);
    await page.locator('.wk').nth(2).click();
    const first3 = page.locator('.ex').first();
    await first3.locator('.set-row').first().locator('input').first().fill('30');
    await first3.locator('.set-row').first().locator('input').nth(1).fill('12');
    await first3.locator('.set-row').first().locator('.tick').click();
    ok('the e1RM badge appears when reps beat the estimate at a weight already lifted',
       await first3.locator('.badge.pr-e1rm').count() === 1);
    ok('and the weight badge does not', await first3.locator('.badge.pr').count() === 0);
    ok('the row is marked with its own class', await first3.locator('.set-row.pr-e1rm').count() === 1);
    ok('and it counts as a record in the footer', (await page.textContent('#note')).includes('récord'));
    await page.click('#tskip');

    console.log('\n== in-app dialogs ==');
    ok('no native dialog fired during the run', alertText === null, String(alertText));
    await openHub(page, 'more');
    await page.click('#clearDay');
    ok('a confirmation sheet opens', await page.locator('#askSheet.up').count() === 1);
    ok('it says what will go', (await page.textContent('#askBody')).includes('semana'));
    await answerDialog(page, false);
    ok('cancelling leaves the log alone', await page.locator('.set-row.done').count() > 0);

    console.log('\n== undo ==');
    const doneBefore = await page.locator('.set-row.done').count();
    await openHub(page, 'more');
    await page.click('#clearDay');
    await answerDialog(page, true);
    ok('confirming clears the day', await page.locator('.set-row.done').count() === 0, 'was ' + doneBefore);
    ok('the toast offers Deshacer', (await page.textContent('#toastAct')) === 'Deshacer');
    await page.click('#toastAct');
    await page.waitForTimeout(400);
    ok('undo puts the sets back', await page.locator('.set-row.done').count() === doneBefore);

    console.log('\n== block length + deload ==');
    await openWeeks(page);
    ok('a fresh block shows 8 weeks', await page.locator('.wk').count() === 8);
    ok('week 8 is the deload', (await page.locator('.wk').nth(7).textContent()) === 'DL');
    await openHub(page, 'plan');
    await page.click('#editPlan');
    await page.fill('#peWeeks', '5');
    await page.waitForTimeout(200);
    ok('the deload list is trimmed to the new length', await page.locator('#peDeload option').count() === 6);
    await page.selectOption('#peDeload', '3');
    await page.click('#peSave');
    await page.waitForTimeout(400);
    await openWeeks(page);
    ok('the week bar follows the block', await page.locator('.wk').count() === 5);
    ok('week 3 is now the deload', (await page.locator('.wk').nth(2).textContent()) === 'DL');
    await openWeeks(page);
    await page.locator('.wk').nth(2).click();
    await page.waitForTimeout(250);
    const full = await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 1, getBlock()));
    const cut = await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 3, getBlock()));
    ok('the deload week halves the sets', cut < full, cut + ' vs ' + full);
    ok('a week with no deload is untouched', await page.evaluate(() => setsFor(getBlock().days[0].ex[0], 2, getBlock())) === full);
    ok('nothing is stranded while the log still fits', !(await page.locator('#beyond').isVisible()));

    // one week: now the week-2 sets are past the end
    await openHub(page, 'plan');
    await page.click('#editPlan');
    await page.fill('#peWeeks', '1');
    await page.waitForTimeout(150);
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('shortening past the log keeps it and says so', await page.locator('#beyond').isVisible());
    ok('...and counts what is out of reach', (await page.textContent('#beyond')).includes('serie'));
    ok('the current week is pulled back into range', await page.evaluate(() => getProfile().week) === 1);

    // back to 8 so the rest of the run sees a normal block
    await openHub(page, 'plan');
    await page.click('#editPlan');
    await page.fill('#peWeeks', '8');
    await page.waitForTimeout(150);
    await page.selectOption('#peDeload', '8');
    await page.click('#peSave');
    await page.waitForTimeout(400);
    ok('lengthening brings the stranded weeks back', !(await page.locator('#beyond').isVisible()));

    console.log('\n== a new block is named in-app ==');
    await openHub(page, 'plan');
    await page.click('#newBlockBtn');
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
    /* The block sheet is the picker and nothing else since plans/037 moved
       its four actions into the "Plan" hub, so this is what is left covering
       it — and the new block has to be in the list it draws. */
    await openBlocks(page);
    ok('the block picker lists both blocks', await page.locator('#blockbar select option').count() === 2);
    await closeBlocks(page);

    console.log('\n== progress across every block ==');
    await openExMenu(page, 0);
    await page.click('#exMenuChart');
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
      JSON.stringify(warmupRamp(50, 2.5, 20).map(r => r.weight)) === JSON.stringify([20, 30, 40])));

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
    // "auto" resolves into an explicit data-theme (js/theme-init.js, then
    // applyTheme()) rather than leaving the attribute unset, so the dark
    // palette only needs declaring once in css/style.css (plans/008 item 20)
    ok('starts on auto, resolved to the browser default (light)',
       await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
    await openHub(page, 'more');
    await page.click('#themeBtn');
    ok('cycles to light', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
    await openHub(page, 'more');
    await page.click('#themeBtn');
    ok('cycles to dark', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('dark theme actually repaints body', bg === 'rgb(15, 17, 19)', bg);
    await page.reload({ waitUntil: 'networkidle' });
    ok('theme choice persists', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
    await openHub(page, 'more');
    await page.click('#themeBtn'); // back to auto
    ok('back on auto', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');

    // On auto, applyTheme()'s matchMedia listener is what now has to pick up
    // a live system change — the @media(prefers-color-scheme) rule that used
    // to do this was removed along with the duplicate dark palette block.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    ok('auto follows a live system theme change without a reload',
       await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    await closeMore(page);
    /* Two routes into the same sheet since plans/037: the header's "⋯"
       (plans/034) and the bar's "Más". Everything above came in by the bar;
       this is the other one, which nothing else covers. */
    await openMore(page);
    ok('the header\'s ⋯ opens the same "Más" sheet the bar does',
       await page.locator('#moreSheet.up').count() === 1);
    await closeMore(page);

    console.log('\n== XSS: hostile imported block ==');
    await page.evaluate(() => { window.__xss = false; });
    await openHub(page, 'plan');
    await page.click('#importBtn');
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
    const repsText = await page.locator('.ex-meta').first().textContent();
    ok('rep range rendered as literal text', repsText.includes('<img'), repsText);
    ok('no injected img element in the card', await page.locator('.ex img').count() === 0);

    console.log('\n== import validation ==');
    await openHub(page, 'plan');
    await page.click('#importBtn');
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
    // Read from the registry rather than a copy of it: a fourth published
    // block is then covered the moment it is listed, and a list that has
    // drifted from blocks/ fails in test/unit.js instead of quietly
    // testing two of three files here.
    const blockIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'blocks/index.json'), 'utf8'));
    for (const f of blockIndex.map(e => e.file)) {
      const body = await (await fetch(BASE + '/blocks/' + f)).text();
      // a successful import closes the sheet, so reopen it each time round
      if (await page.locator('#importSheet.up').count() === 0) {
        await openHub(page, 'plan');
        await page.click('#importBtn');
      }
      await page.fill('#importBlob', body);
      await page.click('#importFromText');
      await page.waitForTimeout(300);
      const err = await page.textContent('#importError');
      ok('blocks/' + f + ' imports cleanly', err === '', err);
      ok('blocks/' + f + ' became the active block', (await page.textContent('#title')).length > 0);
    }
    await openHub(page, 'plan');
    await page.click('#importBtn');

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
    await openHub(page, 'plan');
    await page.click('#importBtn');

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
    await openHub(page, 'plan');
    await page.click('#importBtn');

    console.log('\n== escape closes sheets ==');
    ok('import sheet open', await page.locator('#importSheet.up').count() === 1);
    await page.keyboard.press('Escape');
    ok('escape closed it', await page.locator('#importSheet.up').count() === 0);
    /* And nothing is left underneath: a hub row that opens another sheet
       closes its hub on the way (plans/037), so one Escape puts you back on
       the page rather than on a dashboard you never asked to return to. The
       stack in openSheet/closeSheet still has a nesting case of its own —
       #qrSheet over the backup sheet, further down. */
    ok('the Plan hub it opened from is already closed', await page.locator('#planHubSheet.up').count() === 0);

    console.log('\n== backup / restore validation ==');
    await openHub(page, 'more');
    await page.click('#backup');
    ok('backup sheet opens', await page.locator('#sheet.up').count() === 1);
    ok('backup blob is valid JSON', await page.evaluate(() => { try { return !!JSON.parse(document.getElementById('blob').value).data.profiles; } catch (e) { return false; } }));
    await page.fill('#blob', JSON.stringify({ data: { profiles: { hombre: {} } } }));
    await page.click('#bRestore');
    ok('half-valid backup rejected with a reason', (await page.textContent('#status')).includes('perfil "hombre" no tiene bloques'), await page.textContent('#status'));
    await page.fill('#blob', '{"nope":1}');
    await page.click('#bRestore');
    ok('non-backup rejected', (await page.textContent('#status')).includes('no tiene perfiles'));

    console.log('\n== downloadFile prefers the share sheet when one exists (plans/008 item 8) ==');
    // Stands in for an installed iOS PWA, where <a download> is unreliable:
    // Web Share API with a file is what downloadFile() should reach for
    // first there, falling back to the anchor everywhere else. The backup
    // sheet from the block above is still open — no need to reopen it, and
    // clicking #backup again while its own sheet covers it would only hit
    // the overlay.
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = files => true;
      navigator.share = data => { window.__shared = data; return Promise.resolve(); };
    });
    await page.click('#bDownload');
    await page.waitForTimeout(200);
    const shared = await page.evaluate(() => window.__shared && {
      count: window.__shared.files.length,
      name: window.__shared.files[0].name,
      isFile: window.__shared.files[0] instanceof File,
    });
    ok('the backup download goes through navigator.share when it is available',
       !!shared && shared.count === 1 && shared.isFile, JSON.stringify(shared));
    ok('the shared file is named like a backup', /heavy-iron-backup-.*\.json$/.test(shared && shared.name), shared && shared.name);
    // Cleaned up, but the sheet itself is left open: the QR section below
    // reaches #qrBtn from inside it.
    await page.evaluate(() => { delete navigator.canShare; delete navigator.share; });

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
             countSets(payload.log) === blockLoggedSets(getProfile(), getBlock().id);
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
    /* No sleep: the Escape handler moves focus synchronously, and press()
       resolves after the page has run it.
       The backup sheet was opened from a row in "Más" and the QR sheet from
       a button inside it. With one shared return slot (before plans/009 item
       1) the QR sheet overwrote it on open and nulled it on close, so closing
       the backup sheet afterwards left focus on <body> and a keyboard user
       lost their place. Each sheet carries its own return target now.
       #navMore, not #backup: the hub closes before the row's own handler
       runs, which hands the focus back to the bar button first, and that is
       what the backup sheet then records (plans/037). */
    ok('focus returns to the bar button the backup sheet was reached from, after a sheet opened over it',
       await page.evaluate(() => document.activeElement && document.activeElement.id) === 'navMore',
       await page.evaluate(() => document.activeElement && document.activeElement.id));

    console.log('\n== plan editor still works ==');
    await openHub(page, 'plan');
    await page.click('#editPlan');
    ok('editor opens', await page.locator('#planSheet.up').count() === 1);
    ok('editor lists days', await page.locator('.pe-day').count() >= 1);
    await page.click('#peClose');

    console.log('\n== profile switch ==');
    await openProfiles(page);
    await page.click('.profile-btn >> nth=1');
    ok('switched to the second profile', (await page.textContent('#title')).includes('Bruno'), await page.textContent('#title'));
    /* Saving settings normalises the shipped theme names ('mujer') to the
       accent names ('verde'); the CSS keeps both, so a profile that never
       goes through settings does not change colour. */
    ok('its accent class is applied', await page.locator('#app.profile-verde').count() === 1);

    console.log('\n== solo mode ==');
    await openProfiles(page);
    await page.click('.profile-btn >> nth=0');   // back to the first profile
    await openHub(page, 'more');
    await page.click('#settings');
    ok('settings hides the starting-plan question', !(await page.locator('#setupPlanField').isVisible()));
    await page.click('#setupMode >> text=Solo yo');
    ok('solo mode asks for one name only', await page.locator('#setupNames input').count() === 1);
    await page.click('#setupSave');
    await page.waitForTimeout(400);
    /* #profiles itself is inside #profileSheet now (plans/034), so it is
       invisible whether or not solo mode is on — the chip that opens that
       sheet is the control solo mode actually has to take away. */
    ok('the profile chip is hidden', !(await page.locator('#profileBtn').isVisible()));
    ok('no JUNTOS/SOLO badges on any exercise', await page.locator('.badge.together, .badge.solo').count() === 0);
    ok('the pair note is hidden', !(await page.locator('#pair').isVisible()));
    ok('the shared-station stripe is gone', await page.locator('.ex.shared').count() === 0);
    await openHub(page, 'plan');
    await page.click('#editPlan');
    ok('plan editor hides the shared-station checkbox', !(await page.locator('.pe-check-share').first().isVisible()));
    ok('plan editor hides the pair note field', !(await page.locator('.pe-day-pair').first().isVisible()));
    await page.click('#peClose');
    ok('the other profile is hidden, not deleted',
       await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles).length) === 2);

    // and back again, with nothing lost
    await openHub(page, 'more');
    await page.click('#settings');
    await page.click('#setupMode >> text=Dos personas');
    await page.click('#setupSave');
    await page.waitForTimeout(300);
    ok('two-person mode comes back intact', await page.locator('#profileBtn').isVisible()
       && await page.locator('.badge.together, .badge.solo').count() > 0);

    console.log('\n== moving one profile between phones ==');
    await openHub(page, 'more');
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

    console.log('\n== week switch persists on its own ==');
    // A week/day switch must reach localStorage on its own: nothing else is
    // going to write it if the phone goes into a pocket straight after.
    await openWeeks(page);
    await page.locator('.wk').nth(0).click();
    await page.waitForTimeout(600);
    ok('switching week is saved without any other edit',
       await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.week) === 1,
       String(await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.week)));

    console.log('\n== exported review follows the unit setting ==');
    const unitReviewText = await page.evaluate(() => reviewText(buildBlockReview(getProfile(), getBlock())));
    ok('the exported review uses the lb unit label', unitReviewText.includes(' lb'), unitReviewText.slice(0, 200));
    ok('the exported review never hardcodes kg', !unitReviewText.includes(' kg'), unitReviewText.slice(0, 200));

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
  });

  // ---------- profile import hardening + happy-path restore ----------
  await section('profile import hardening', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    // log a set: something a bad restore could destroy, and a good one should bring back
    await page.locator('.ex').first().locator('.set-row').first().locator('input').first().fill('40');
    await page.locator('.ex').first().locator('.set-row').first().locator('input').nth(1).fill('8');
    await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(200);
    await page.click('#tskip'); // clear the rest timer overlay so it doesn't block later clicks
    const setsBefore = await page.locator('.set-row.done').count();
    ok('a set was logged, to restore later', setsBefore > 0);

    await openHub(page, 'more');
    await page.click('#backup');
    const goodBlob = await page.evaluate(() => document.getElementById('blob').value);

    // an oversized profile: more blocks than PROFILE_LIMITS.blocks allows
    const oversized = await page.evaluate(() => JSON.stringify({
      app: STORAGE_KEY, v: 1, saved: new Date().toISOString(),
      data: { activeProfile: 'hombre', profiles: { hombre: (() => {
        const validBlock = { name: 'B', weeks: 8, deload: 8, days: [{ name: 'D', ex: [{ n: 'Ex', sets: 3, reps: '10-15' }] }] };
        const blocks = {}, blockOrder = [];
        for (let i = 0; i < 41; i++) { blocks['b' + i] = validBlock; blockOrder.push('b' + i); }
        return { label: 'Hombre', theme: 'azul', blocks, blockOrder, log: {} };
      })() } },
    }));
    await page.fill('#blob', oversized);
    await page.click('#bRestore');
    await page.waitForTimeout(200);
    ok('an oversized profile is rejected with a reason',
       (await page.textContent('#status')).includes('bloques'), await page.textContent('#status'));
    ok('the existing log is untouched by the rejected restore',
       await page.locator('.set-row.done').count() === setsBefore);

    // happy path: wipe, reload, restore the good blob taken earlier, get it all back
    await page.evaluate(() => localStorage.removeItem('heavy-iron-v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(300);
    ok('the wipe actually took effect', await page.locator('.set-row.done').count() === 0);

    await openHub(page, 'more');
    await page.click('#backup');
    await page.fill('#blob', goodBlob);
    await page.click('#bRestore');
    await answerDialog(page, true);
    await page.waitForTimeout(300);
    ok('a normal backup restores successfully', await page.locator('.set-row.done').count() === setsBefore);
    ok('the undo toast is offered after a restore', (await page.textContent('#toastAct')) === 'Deshacer');

    await ctx.close();
  });

  // ---------- weight drops ----------
  await section('weight drops', async () => {
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

    /* Double progression: a week at the top of the range earns the next
       rung, and the sets the weight had to come off in are simply not
       working sets — they never reach the estimate to be vetoed. */
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

    const filled = () => page.waitForFunction(() =>
      (document.getElementById('status').textContent || '').includes('Objetivo escrito'));

    await seed(false);
    await page.click('#copyPrev');
    await filled();
    /* One session, 60×10 at the top of a 6–10 range and no RIR typed: that
       is a FLOOR under what the set was worth, not a reading of it, so it
       can raise the level and nothing more. 60 is also the only weight
       this exercise has ever been logged at, so the ladder has one rung
       and `ex.inc` has to supply the next. */
    ok('top of the range earns the next rung of the stack (60 → 62,5)',
       await week2First() === '62,5', await week2First());

    await seed(true);
    await page.click('#copyPrev');
    await filled();
    /* A set the weight had to come off to finish used to veto the rise
       outright. It no longer does, and nothing is lost: the reps done at
       60 are what the level is read from and the stripped ones were never
       working sets to begin with. What a forced drop still does is flag
       the session in the Diagnóstico, which is where "why did this
       happen" belongs. */
    ok('a forced drop no longer vetoes the rise — only the sets that happened count',
       await week2First() === '62,5', await week2First());

    await page.evaluate(() => {
      const p = state.profiles.hombre;
      const rows = p.log['block-1']['w1-d0'].chestpress;
      rows[rows.length - 1].dk = 'drop';
      delete p.log['block-1']['w2-d0'];
      save(); render();
    });
    await page.click('#copyPrev');
    await filled();
    ok('and a planned dropset never did', await week2First() === '62,5', await week2First());

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
  });

  // ---------- offline ----------
  await section('offline', async () => {
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
  });

  // ---------- published blocks stay importable offline ----------
  await section('published blocks stay importable offline (plans/008 item 7)', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(300);

    // blocksBase() fetches blocks/ relative to the page now (same-origin),
    // which is what lets the worker's network-first /blocks/ handler see
    // and cache these requests — cross-origin, as this used to be, the
    // handler never ran and "importable offline once you've seen it" was
    // dead in production. Seeing it once online is the setup for that.
    await openHub(page, 'plan');
    await page.click('#importBtn');
    await page.waitForSelector('.import-item button');
    await page.locator('.import-item button').first().click();
    await page.waitForTimeout(400);
    ok('a published block imports online', (await page.textContent('#title')).length > 0);

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissSetup(page);
    await page.waitForTimeout(500);
    await openHub(page, 'plan');
    await page.click('#importBtn');
    await page.waitForTimeout(500);
    ok('the published-blocks list still loads offline',
       await page.locator('.import-item').count() > 0,
       await page.textContent('#importRepoList'));
    await page.locator('.import-item button').first().click();
    await page.waitForTimeout(400);
    ok('importing an already-seen block still works offline',
       (await page.textContent('#importError')) === '',
       await page.textContent('#importError'));
    await ctx.close();
  });

  // ---------- corrupted data ----------
  await section('corrupt data recovery', async () => {
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

    // truly broken JSON: unreadable, so it must reach the recovery screen
    // rather than being replaced by a fresh plan and written back over.
    await page.evaluate(() => localStorage.setItem('heavy-iron-v1', '{not json'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok('unreadable data lands on the recovery screen',
       await page.locator('.recovery').count() === 1);
    ok('the damaged bytes are left on disk, not overwritten',
       await page.evaluate(() => localStorage.getItem('heavy-iron-v1')) === '{not json',
       await page.evaluate(() => localStorage.getItem('heavy-iron-v1')));

    /* Back to a readable log, so the next case starts from a page that
       actually booted rather than from the recovery screen. */
    await page.evaluate(() => localStorage.removeItem('heavy-iron-v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(300);

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
  });

  // ---------- storage read failure (not corrupt data — no bytes at all) ----------
  await section('storage read failure', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // simulates private-mode/blocked storage: getItem throws before any bytes
    // are retrieved, which must not be folded into "first run" or "corrupt
    // data" — both would risk seeding over or losing data that may be intact.
    await page.addInitScript(() => {
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === 'heavy-iron-v1') throw new Error('storage blocked de prueba');
        return orig.call(this, key);
      };
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.recovery', { timeout: 5000 });
    ok('a storage read failure lands on the recovery screen, not a fresh seed',
       await page.locator('.recovery').count() === 1);
    ok('copy says storage could not be read, not that the data is corrupt',
       (await page.textContent('.recovery h1')).includes('podido leer'));
    ok('no download offered when there are no bytes to hand over',
       await page.locator('#recDownload').count() === 0);
    ok('Reintentar is offered as the primary way out', await page.locator('#recReload').count() === 1);
    await ctx.close();
  });

  // ---------- recovery screen ----------
  await section('recovery screen', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(600);

    // off week 1 first, so "Volver a la semana 1" below is an actual reset
    await page.evaluate(() => { state.profiles.hombre.week = 3; });

    // break rendering itself, then force a redraw
    await page.evaluate(() => { window.setsFor = () => { throw new Error('boom de prueba'); }; });
    await page.locator('.day').nth(1).click();
    await page.waitForTimeout(300);
    ok('recovery screen replaces the blank page', await page.locator('.recovery').count() === 1);
    ok('shows the underlying error', (await page.textContent('.recovery pre')).includes('boom de prueba'));
    // a render throw is a code bug on data that parsed and migrated fine, so
    // the copy and the extra buttons must say so (plans/008 item 18)
    ok('copy says the app failed to draw, not that the data is unreadable',
       (await page.textContent('.recovery h1')).includes('fallado al dibujar'));
    ok('offers a way out that does not delete data', await page.locator('#recWeek1').count() === 1);
    ok('offers switching block too', await page.locator('#recBlock').count() === 1);
    const dl = await Promise.all([page.waitForEvent('download'), page.click('#recDownload')]).then(r => r[0]).catch(() => null);
    ok('hands the raw data over as a file', !!dl);

    const before = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').length);
    await page.evaluate(() => { try { state.profiles.hombre.label = 'CLOBBERED'; } catch (e) {} writeState(); });
    const clobbered = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').includes('CLOBBERED'));
    const after = await page.evaluate(() => (localStorage.getItem('heavy-iron-v1') || '').length);
    ok('refuses to write over the data it could not read', !clobbered && before === after);

    // "Volver a la semana 1" resets the week and reloads instead of wiping
    await Promise.all([page.waitForNavigation(), page.click('#recWeek1')]);
    await page.waitForTimeout(300);
    ok('leaves the recovery screen after resetting the week', await page.locator('.recovery').count() === 0);
    ok('the profile is back on week 1',
       await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.week) === 1);
    await ctx.close();
  });

  // ---------- deleting a block takes its parallel maps with it ----------
  await section('block delete purges rir/notes/energy/order', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const id = 'block-orphan-test';
      p.blocks[id] = {
        id, name: 'Bloque huérfano', createdAt: new Date().toISOString(),
        weeks: 8, deload: 8,
        days: [{ id: 'd0', name: 'Día 1', ex: [{ id: 'e0', n: 'x', alt: '', cue: '', sets: 3, reps: '10–15', rest: 90, share: 0, ss: 0 }] }],
        phase: {},
      };
      p.blockOrder.push(id);
      p.log[id] = { 'w1-d0': { e0: [{ done: true, w: '10', r: '10' }] } };
      p.rir[id] = { 'w1-d0': { e0: '2+' } };
      p.notes[id] = { 'w1-d0': 'nota' };
      p.energy[id] = { 'w1-d0': '7' };
      p.order[id] = { 'w1-d0': ['e0'] };
      p.obj[id] = { 'w1-d0': { e0: { v: 3, sets: [{ w: 10, r: 10, m: '' }] } } };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(300);

    await openHub(page, 'plan');
    await page.click('#manageBtn');
    await page.waitForTimeout(200);
    ok('the block manager sheet opens', await page.locator('#blocksSheet.up').count() === 1);
    await page.locator('.blk-row', { hasText: 'Bloque huérfano' }).locator('.blk-del').click();
    await answerDialog(page, true);
    await page.waitForTimeout(200);

    const leftovers = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles[s.activeProfile];
      /* Every part of the record filed by block, read off the app's own
         table: the list here used to be written out by hand and had no
         objetivo record in it. */
      return RECORD_PARTS.filter(part => part.keyedBy !== 'exercise').map(part => part.name)
        .filter(m => p[m] && Object.prototype.hasOwnProperty.call(p[m], 'block-orphan-test'));
    });
    ok('deleting a block takes every part of its record with it',
       leftovers.length === 0, 'still present in: ' + leftovers.join(', '));

    /* The confirm above was raised from inside the still-open block manager
       sheet — the exact case that used to null the sheet stack's shared
       focus-return variable (plans/008 item 22). Deleting a block also
       rebuilds #blockbar and #blockList (both render() and the explicit
       renderBlockManager() call), which would otherwise remove the focused
       button out from under the browser and drop focus to <body> with no
       way back — the del.onclick handler catches that and puts focus back
       in the sheet instead. */
    ok('deleting the block does not strand focus on <body>',
       await page.evaluate(() => document.activeElement !== document.body));
    /* Closing the sheet after this is a separate, larger gap than this item
       covers: deleteBlocks()'s render() also recreates the "Gestionar"
       button that opened this sheet (the nav bar is rebuilt on every
       render()), so closeSheet's isConnected guard correctly skips focusing
       the now-detached original rather than silently no-op'ing on it — but
       nothing stands in for it, so focus does fall to <body> here. Restoring
       identity across an arbitrary full re-render is out of scope for this
       item; not asserted either way so this test does not pin that gap. */
    await page.click('#blkClose');
    await page.waitForTimeout(150);
    ok('the sheet actually closes', await page.locator('#blocksSheet.up').count() === 0);
    await ctx.close();
  });

  // ---------- target weight + diagnóstico ----------
  await section('objetivo de peso y diagnóstico', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    /* The arithmetic itself is asserted in test/unit.js — the fifteen cases
       the rule was specified against, all of which read several sessions and
       none of which a browser can see anything extra about. What is left
       here is the part only a browser can answer: that the line reaches the
       card, that the confidence chip and the notes come with it, and that
       the greyed placeholder in every weight box carries the same number the
       line shows — which is the contract that makes ticking a set without
       typing safe.

       The history is the spec's own chest-press case: three sessions, the
       last one ending at the top of the range, so set 1 earns the next rung
       and set 4 comes down one. */
    /* localStorage is written behind the app's back here, so the app's own
       debounced save has to have drained first or it lands on top of the
       seed — the same wait "primera semana de un bloque nuevo" documents. */
    const seedChest = () => page.waitForFunction(() => !saveT && !held).then(() => page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 21 * DAY;
      const ex = p.blocks['block-1'].days[0].ex[0];   /* chestpress */
      ex.reps = '8–12'; ex.inc = 2.25; ex.sets = 4; delete ex.add;
      p.log['block-1'] = {}; p.rir['block-1'] = {};
      [[42.75, [11, 10, 9, 8]], [45, [11, 10, 9, 8]], [45, [12, 10, 9, 8]]].forEach((wk, i) => {
        p.log['block-1']['w' + (i + 1) + '-d0'] = {
          chestpress: wk[1].map(r => ({ w: String(wk[0]), r: String(r), done: true, ts: start + i * 7 * DAY })),
        };
        p.rir['block-1']['w' + (i + 1) + '-d0'] = { chestpress: '0' };
      });
      p.week = 4; p.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    }));
    await seedChest();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ex .ex-est-l');

    const card = page.locator('.ex').first();
    ok('la línea de objetivo da una respuesta por serie',
       (await card.locator('.ex-est-l').textContent()) === '↗ objetivo: 47,25×9 · 45×9 · 45×8 · 42,75×9',
       await card.locator('.ex-est-l').textContent());
    ok('con el chip de confianza al lado',
       (await card.locator('.ex-est-c').textContent()) === 'confianza media',
       await card.locator('.ex-est-c').textContent());
    ok('y el aviso de que la semana pide más RIR',
       (await card.locator('.ex-est').textContent()).includes('Esta semana pide más RIR'),
       await card.locator('.ex-est').textContent());
    /* The whole reason the line is per set: the boxes are per set too. */
    const hints = await card.locator('.set-row')
      .evaluateAll(els => els.map(e => e.querySelector('input').placeholder));
    ok('cada casilla de peso muestra el peso que el objetivo pide para ESA serie',
       hints.join(' · ') === '47,25 · 45 · 45 · 42,75', hints.join(' · '));

    await card.locator('.set-row').first().locator('.tick').click();
    await page.waitForFunction(() => (document.getElementById('status').textContent || '').includes('el objetivo de esta semana'));
    ok('marcar sin escribir toma el número del objetivo',
       await card.locator('.set-row').first().locator('input').first().inputValue() === '47,25',
       await card.locator('.set-row').first().locator('input').first().inputValue());
    ok('y dice de dónde salió',
       (await page.textContent('#status')).includes('el objetivo de esta semana'), await page.textContent('#status'));
    /* Only the weight box has the adoption contract, and the tick that just
       fired is the one place that could quietly break it. The RIR box was
       showing the week's own target in grey at that moment — week 4 of the
       seed plan reads "1–2 RIR" — and a reserve nobody reported is not a
       measurement (plans/035 Step H.4, plans/036 Step C.5): the set has to
       read as a floor, which is what sessionRirs, the objetivo's censoring
       and the Diagnóstico all assume of a blank one. Adopting it would
       feed the rule a number the lifter never gave it.

       The rule itself is tickRow's and test/unit.js pins it (plans/048).
       This is the same contract through the real tick, which the unit
       suite cannot press: loadApp's inert document hands querySelectorAll
       an empty array, so there is no row to tick. */
    const adopt = await page.evaluate(() => {
      const row = document.querySelectorAll('.ex')[0].querySelector('.set-row');
      const saved = getProfile().log['block-1']['w4-d0'].chestpress[0];
      return { rirShown: row.querySelector('.rir-in').placeholder,
               rirTyped: row.querySelector('.rir-in').value,
               keys: Object.keys(saved).sort().join(','), w: saved.w };
    });
    ok('marcar no adopta el RIR que enseña la casilla, sólo el peso',
       adopt.rirShown === '1' && adopt.rirTyped === '' &&
       adopt.w === '47,25' && !adopt.keys.split(',').includes('rir'),
       JSON.stringify(adopt));
    if (await page.locator('#timer.up').count()) await page.click('#tskip');

    /* The record of what was shown — the one thing that can later tell a
       back-off the rule asked for from a weight that had to come off. */
    ok('el objetivo que se mostró queda guardado con la sesión', await page.evaluate(() => {
      const rec = getProfile().obj['block-1']['w4-d0'].chestpress;
      return rec.v === 3 && rec.conf === 'media' && rec.sets.length === 4 &&
             rec.sets[0].w === 47.25 && rec.sets[0].m === '↑' && rec.sets[3].m === '↓';
    }));

    /* A week that was logged before the record existed gets no record from
       being looked at: a rebuilt target is the one thing the map must not
       hold, and the rule reads the live clock, so a week logged two months
       ago would come back filed as a "vuelta de parón". Week 2 is one of
       the three the seed above logged, and it has no record of its own. */
    ok('mirar una semana ya registrada no fabrica su objetivo', await page.evaluate(() => {
      const blk = getProfile().obj['block-1'] || {};
      delete blk['w2-d0'];
      return !blk['w2-d0'];
    }));
    await openWeeks(page);
    await page.locator('.wk').nth(1).click();
    await page.waitForFunction(() => getProfile().week === 2);
    await page.waitForTimeout(150);
    ok('   ni después de dibujarla', await page.evaluate(() => {
      const blk = getProfile().obj['block-1'] || {};
      return !blk['w2-d0'];
    }));
    await openWeeks(page);
    await page.locator('.wk').nth(3).click();   /* back to the week the section works in */
    await page.waitForFunction(() => getProfile().week === 4);
    await page.waitForSelector('.ex .ex-est-l');

    /* "Rellenar con el objetivo" writes exactly what the line above it
       says, set by set — one rule, one number, and no second implementation
       of double progression to drift away from it. */
    await page.click('#copyPrev');
    await page.waitForFunction(() => (document.getElementById('status').textContent || '').includes('Objetivo escrito'));
    const written = await card.locator('.set-row')
      .evaluateAll(els => els.map(e => e.querySelector('input').value));
    ok('"Rellenar con el objetivo" escribe el peso de cada serie',
       written.join(' · ') === '47,25 · 45 · 45 · 42,75', written.join(' · '));
    ok('y cuenta lo que se movió',
       (await page.textContent('#status')).includes('sube de peso en alguna serie') &&
       (await page.textContent('#status')).includes('baja de peso en alguna serie'),
       await page.textContent('#status'));

    /* Three exercises falling inside a week is a fact about the lifter, so
       it is said before the cards rather than inferred from twenty of them
       quietly declining to move. */
    await page.waitForFunction(() => !saveT && !held);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 9 * DAY;
      p.log['block-1'] = {}; p.rir['block-1'] = {};
      p.blocks['block-1'].days[0].ex.forEach(ex => { ex.reps = '8–12'; ex.sets = 3; delete ex.add; });
      [[10, 9, 8], [11, 10, 9], [8, 8, 7]].forEach((reps, i) => {
        const slotRows = {}, slotRir = {};
        p.blocks['block-1'].days[0].ex.slice(0, 3).forEach(ex => {
          slotRows[ex.id] = reps.map(r => ({ w: '40', r: String(r), done: true, ts: start + i * 3 * DAY }));
          slotRir[ex.id] = '1';
        });
        p.log['block-1']['w' + (i + 1) + '-d0'] = slotRows;
        p.rir['block-1']['w' + (i + 1) + '-d0'] = slotRir;
      });
      p.week = 4; p.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    /* Shown by clearing the `hidden` attribute it ships with, not by an
       inline display, since plans/041 — the old style.display read timed
       out on the new code. */
    await page.waitForFunction(() => {
      const el = document.getElementById('brakeNote');
      return el && !el.hidden;
    });
    ok('el freno global se anuncia arriba del día',
       (await page.textContent('#brakeNote')).includes('no sube nada') &&
       await page.locator('#brakeNote').isVisible(), await page.textContent('#brakeNote'));
    ok('y con el freno puesto ninguna ficha sube de peso',
       await page.evaluate(() => {
         const block = getBlock();
         return exList(block.days[0]).slice(0, 3).every(ex => {
           const t = targetNow(getProfile(), block, block.days[0], ex, 4);
           return t && t.brake === true && t.sets.every(x => x.move !== '↑');
         });
       }));

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
    await openHub(page, 'progress');
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
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok('Escape cierra el diagnóstico', await page.locator('#diagSheet.up').count() === 0);

    /* The case the screen used to read as "Funciona · No toques nada" while
       the session's own target was holding the weight: three sessions at
       40 kg, the last one a real decline under the level. The reps over the
       window still climbed, so the trend is genuinely `subiendo` — what is
       wrong is that today is not the day to act on it, and the two screens
       have to agree about that. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const DAY = 86400000, start = Date.now() - 21 * DAY;
      const ex = p.blocks['block-1'].days[0].ex[0];   /* chestpress */
      ex.reps = '8–12'; ex.sets = 3; delete ex.add;
      p.log['block-1'] = {};
      p.rir['block-1'] = {};
      [[10, 9, 8], [11, 10, 9], [8, 8, 7]].forEach((reps, i) => {
        p.log['block-1']['w' + (i + 1) + '-d0'] = {
          chestpress: reps.map(r => ({ w: '40', r: String(r), done: true, ts: start + i * 7 * DAY })) };
        p.rir['block-1']['w' + (i + 1) + '-d0'] = { chestpress: '1' };
      });
      p.week = 4;
      p.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openHub(page, 'progress');
    await page.click('#diagBtn');
    await page.waitForTimeout(300);
    const held = await page.evaluate(() => {
      const r = document.querySelector('#diagHost .diag-row[data-ex="chestpress"]');
      return { cls: r.className, read: r.querySelector('.diag-read').textContent,
               do: r.querySelector('.diag-do').textContent };
    });
    ok('una racha al alza con una sesión mala sigue saliendo como subiendo', held.cls.includes('up'), JSON.stringify(held));
    ok('pero el diagnóstico ya no dice que no toques nada',
       held.read.includes('no sube el peso esta semana') && !held.do.includes('No toques nada'), JSON.stringify(held));
    /* The point of the row: it says the same thing as the session's target,
       because it reads that target's own answer rather than re-deriving it. */
    ok('y coincide con lo que manda el objetivo de la semana', await page.evaluate(() => {
      const block = getBlock();
      const t = targetNow(getProfile(), block, block.days[0], block.days[0].ex.find(e => e.id === 'chestpress'), 4);
      return t.hold === true && t.sets.every(x => x.move !== '↑');
    }), JSON.stringify(held));
    ok('y pide el RIR que prescribe la semana en curso', held.do.includes('1 RIR'), JSON.stringify(held));
    await page.click('#diagClose');
    await page.waitForTimeout(200);

    /* The work axis. diagPoints() keeps the best set of a session and
       nothing else, so 45×12/8/6 and 45×12/12/11 are the SAME point on the
       chart — and the second one is nine more reps of work. */
    const workCase = async weeks => {
      await page.evaluate(weeks => {
        const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
        const p = s.profiles.hombre;
        const DAY = 86400000, start = Date.now() - weeks.length * 7 * DAY;
        p.log['block-1'] = {};
        p.rir['block-1'] = {};
        weeks.forEach((sets, i) => {
          const ts = start + i * 7 * DAY;
          p.log['block-1']['w' + (i + 1) + '-d0'] = {
            chestpress: sets.map(x => ({ w: String(x[0]), r: String(x[1]), done: true, ts: ts })) };
        });
        p.week = weeks.length + 1;
        p.day = 0;
        localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
      }, weeks);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      await openHub(page, 'progress');
      await page.click('#diagBtn');
      await page.waitForTimeout(300);
      const out = await page.evaluate(() => {
        const r = document.querySelector('#diagHost .diag-row[data-ex="chestpress"]');
        const pts = diagPoints(getProfile(), 'chestpress', getBlock().id);
        return { cls: r.className, read: r.querySelector('.diag-read').textContent,
                 e1rm: diagLevelTrend(getProfile(), getBlock(), getBlock().days[0], getBlock().days[0].ex[0], getBlock().id).pct,
                 work: diagWorkSlope(pts), sets: pts.map(p => p.sets) };
      });
      await page.click('#diagClose');
      await page.waitForTimeout(150);
      return out;
    };
    const at45 = reps => reps.map(r => [45, r]);

    let wk = await workCase([at45([12, 8, 6]), at45([12, 10, 8]), at45([12, 12, 11])]);
    ok('la serie tope clavada sigue saliendo plana', wk.cls.includes('flat') && wk.e1rm === 0, JSON.stringify(wk));
    ok('pero las series de después poniéndose al día ya no es "sin señal clara"',
       wk.read.includes('el trabajo sube') && wk.read.includes('%'), JSON.stringify(wk));

    /* The same axis pointing down, which the row below it needs said out
       loud: "neither one is moving" is false when the kilos are falling. */
    wk = await workCase([at45([12, 12, 12]), at45([12, 12, 11]), at45([12, 11, 10])]);
    ok('y la serie tope aguantando mientras el trabajo cae también se ve',
       wk.cls.includes('flat') && wk.work < 0 && wk.read.includes('el trabajo cae'), JSON.stringify(wk));
    /* Within-session emptying out is the more immediate story and is
       checked further up, so it wins when both fire. */
    wk = await workCase([at45([12, 12, 11]), at45([12, 10, 9]), at45([12, 9, 8])]);
    ok('pero la caída de reps dentro de la sesión sigue ganando',
       wk.read.includes('Primera serie al fallo'), JSON.stringify(wk));

    wk = await workCase([at45([10, 10, 10]), at45([10, 10, 10]), at45([10, 10, 10])]);
    ok('y plano en los dos ejes se dice como lo que es',
       wk.cls.includes('flat') && wk.work === 0 && wk.read.includes('Estancado de verdad'), JSON.stringify(wk));

    /* Per-set takes the count out of the total but not out of the average:
       a fourth set is a tired set, so adding one moves kilos/serie on its
       own. The reading is withheld rather than reported wrong. */
    wk = await workCase([at45([12, 8, 6]), at45([12, 10, 8]), at45([12, 12, 11, 10])]);
    ok('un cambio en el número de series retira la lectura en vez de mentir',
       wk.sets.join() === '3,3,4' && !wk.read.includes('el trabajo sube'), JSON.stringify(wk));

    /* The case this must never flag: the weight went up and the reps reset
       underneath it. That is double progression working, not a work drop. */
    wk = await workCase([[[45, 10], [45, 10], [45, 10]], [[47.5, 7], [47.5, 7], [47.5, 7]],
                         [[47.5, 10], [47.5, 10], [47.5, 10]]]);
    ok('subir de peso con las reps reseteadas no dispara nada del eje de trabajo',
       wk.cls.includes('up') && !wk.read.includes('trabajo'), JSON.stringify(wk));

    /* The kilos come from setVolume(), the app's one definition of "kilos
       movidos" — drops included, exactly as the volume strip counts them.
       A second definition living here is how the two would drift apart. */
    ok('el eje de trabajo cuenta los kilos con la misma regla que el resto de la app',
       await page.evaluate(() => {
         /* Read straight out of diagPoints() rather than through the
            screen: the assertion is about the kilos, not about a verdict. */
         const p = getProfile();
         p.log['block-1'] = { 'w1-d0': { chestpress: [
           { w: '45', r: '8', done: true, ts: Date.now(), dk: 'forced', d: [{ w: '30', r: '5' }] },
           { w: '45', r: '6', done: true, ts: Date.now() },
         ] } };
         /* The write the app itself would follow with save(): sessionsOf
            answers from a cache that save() empties (plans/045), and the
            sheet opened above has just filled it from the previous log. */
         save();
         const pt = diagPoints(p, 'chestpress', 'block-1')[0];
         return pt.sets === 2 && pt.vol === (45 * 8 + 30 * 5) + 45 * 6;
       }));
    await ctx.close();
  });

  // ---------- volume across the block + priority muscles ----------
  await section('volumen del bloque y músculos prioritarios', async () => {
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

    await openHub(page, 'progress');
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
    await openHub(page, 'progress');
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
    await openHub(page, 'plan');
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
  });

  // ---------- frequency per muscle, from r.ts ----------
  await section('frecuencia por músculo', async () => {
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
    await openHub(page, 'progress');
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
    await openHub(page, 'progress');
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
  });

  // ---------- strength index per muscle ----------
  await section('índice de fuerza por músculo', async () => {
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
    await openHub(page, 'progress');
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
    await openHub(page, 'progress');
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
  });

  // ---------- the order the session was actually done in ----------
  await section('orden real de la sesión', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    const names = () => page.$$eval('.ex-name', els => els.map(e => e.childNodes[0].textContent.trim()));
    const planned = await names();
    ok('the session starts in the order the plan asks for', planned[0].startsWith('Press de pecho'), planned[0]);
    ok('and says nothing about the order until it changes',
       await page.locator('#ordNote').isVisible() === false);
    ok('nothing is stored for a session done in the planned order',
       await page.evaluate(() => {
         const o = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.order;
         return !o || !o['block-1'] || o['block-1']['w1-d0'] === undefined;
       }));

    /* The bench is taken, so the second exercise gets done first. Two taps
       rather than one since plans/036: the arrows moved into the "⋯". */
    await moveEx(page, 1, 'up');
    await page.waitForTimeout(400);
    const swapped = await names();
    ok('moving an exercise up puts it first in the session',
       swapped[0] === planned[1] && swapped[1] === planned[0], swapped.slice(0, 2).join(' | '));
    ok('the whole sequence is recorded, not just the pair that moved',
       await page.evaluate(() => {
         const ids = JSON.parse(localStorage.getItem('heavy-iron-v1'))
           .profiles.hombre.order['block-1']['w1-d0'];
         return ids.length === 7 && ids[0] === 'lat1' && ids[1] === 'chestpress';
       }));
    ok('and the session says so', (await page.locator('#ordNote').textContent()).includes('Elevaciones laterales'));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok('the order survives a reload', (await names())[0] === planned[1]);

    /* Sets stay filed under the exercise, never under a position: the
       whole point of keying the order separately from the log. */
    await page.locator('.ex').first().locator('.set-row').first().locator('input').first().fill('12');
    await page.waitForTimeout(400);
    await moveEx(page, 0, 'down');
    await page.waitForTimeout(400);
    ok('moving an exercise carries its sets with it',
       await page.locator('.ex').nth(1).locator('.set-row').first().locator('input').first().inputValue() === '12');
    ok('and landing back on the plan order forgets the record rather than storing a copy of it',
       await page.evaluate(() => {
         const o = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.order['block-1'];
         return !o || o['w1-d0'] === undefined;
       }));
    ok('so the line about the order goes away too',
       await page.locator('#ordNote').isVisible() === false);

    await openExMenu(page, 0);
    const firstUp = await page.locator('#exMenuUp').isDisabled();
    await page.click('#exMenuClose');
    await page.waitForSelector('#exMenuSheet.up', { state: 'hidden', timeout: 4000 });
    const lastIndex = await page.locator('.ex').count() - 1;
    await openExMenu(page, lastIndex);
    const lastDown = await page.locator('#exMenuDown').isDisabled();
    await page.click('#exMenuClose');
    await page.waitForSelector('#exMenuSheet.up', { state: 'hidden', timeout: 4000 });
    ok('the first exercise cannot be moved up and the last cannot be moved down',
       firstUp && lastDown, 'first up ' + firstUp + ', last down ' + lastDown);

    /* Four swaps are not four taps to undo, which is what the reset is for. */
    await moveEx(page, 4, 'up');
    await page.waitForTimeout(300);
    await moveEx(page, 3, 'up');
    await page.waitForTimeout(300);
    await page.click('.ord-reset');
    await page.waitForTimeout(400);
    ok('the reset puts the session back in the plan order', (await names())[0] === planned[0]);

    /* An order left pointing at exercises the plan no longer has must not
       strand the session on a sequence that stopped describing it. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.order['block-1'] = { 'w1-d0': ['no-existe', 'pushdown', 'chestpress'] };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const patched = await names();
    ok('ids the plan no longer has are dropped, and the rest keep their order',
       patched[0].startsWith('Extensiones de tríceps') && patched[1].startsWith('Press de pecho'),
       patched.slice(0, 2).join(' | '));
    ok('exercises the stored order never mentioned come after it, not instead of it',
       patched.length === 7 && patched[2].startsWith('Elevaciones laterales'), patched.join(' | '));

    /* Same rule as the note and the energy chips: keyed by slot with no
       exercise under it, so it would still be sitting there when the day
       came back. */
    await openHub(page, 'more');
    await page.click('#clearDay');
    await answerDialog(page, true);
    await page.waitForTimeout(400);
    ok('clearing the day clears its order too', (await names())[0] === planned[0]);
    ok('and nothing is left on disk',
       await page.evaluate(() => {
         const o = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre.order['block-1'];
         return !o || o['w1-d0'] === undefined;
       }));

    /* The CSV is where this leaves the app, so it has to carry the number
       for every set — including the sessions nobody reordered. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      pr.log['block-1'] = { 'w1-d0': {
        chestpress: [{ w: '60', r: '8', done: true }],
        lat1: [{ w: '10', r: '15', done: true }],
      } };
      pr.order['block-1'] = { 'w1-d0': ['lat1', 'chestpress'] };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const csv = await page.evaluate(() => buildCsv());
    const head = csv.split('\r\n')[0].replace('\ufeff', '').split(',');
    ok('the CSV has a column for it', head[5] === 'orden', head.join(','));
    const csvRow = n => (csv.split('\r\n').find(l => l.indexOf(n) >= 0) || '').split(',');
    ok('an exercise done first is a 1 in the CSV whatever the plan said',
       csvRow('Elevaciones laterales en polea')[5] === '1', csvRow('Elevaciones laterales en polea').join(','));
    ok('and the one that was bumped is a 2', csvRow('Press de pecho')[5] === '2',
       csvRow('Press de pecho').join(','));

    await ctx.close();
  });

  // ---------- the same lift on two days of the block ----------
  await section('el mismo ejercicio en dos sesiones', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    /* Not a hypothetical: the block that ships with the app already plans
       lateral raises twice — `lat1` on the push day and `lat2` on the third
       — under one name and two ids. Anyone running it has had two separate
       histories for one lift since the day they installed. */
    ok('the shipped block already has one lift on two days',
       await page.evaluate(() => {
         const b = getBlock();
         const slots = liftSlots(b, b.days[0].ex.find(e => e.id === 'lat1'));
         return slots.length === 2 && slots[1].exId === 'lat2';
       }));

    /* The case this is all about: the same machine planned twice in one
       block. The twin is added the way the plan editor adds one — a fresh
       uid, so the only thing it shares with the original is its name. If
       the match were on id alone this whole section would find nothing. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const b = p.blocks['block-1'];
      const src = b.days[0].ex.find(e => e.id === 'chestpress');
      b.days[2].ex.unshift({ id: 'ex-twin-1', n: src.n, sets: 2, reps: src.reps, rest: 90 });
      const set = (w, r) => ({ w: String(w), r: String(r), done: true });
      p.log['block-1'] = {
        'w1-d0': { chestpress: [set(40, 12), set(40, 11)], pecdeck: [set(25, 14), set(25, 13)] },
        'w1-d2': { 'ex-twin-1': [set(45, 10), set(45, 9)] },
      };
      p.week = 2;
      p.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    ok('two rows with the same name are the same lift even with different ids',
       await page.evaluate(() => {
         const b = getBlock();
         return sameLift(b.days[0].ex.find(e => e.id === 'chestpress'), b.days[2].ex[0])
           && !sameLift(b.days[0].ex[0], b.days[0].ex[1]);
       }));

    ok('and the plan knows both places it is trained',
       await page.evaluate(() => {
         const b = getBlock();
         const slots = liftSlots(b, b.days[0].ex.find(e => e.id === 'chestpress'));
         return slots.length === 2 && slots[0].dayId === 'd0' && slots[1].dayId === 'd2';
       }));

    /* The card: this session's own history first, the other day under it. */
    const bands = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.ex')]
        .find(c => c.querySelector('.ex-name').childNodes[0].textContent.includes('Press de pecho'));
      return [...card.querySelectorAll('.last')].map(b => ({
        other: b.classList.contains('other'),
        tag: b.querySelector('.tag').textContent,
        sets: b.querySelector('span:last-child').textContent,
      }));
    });
    ok('the card shows this session\'s last time first', bands.length === 2 &&
       !bands[0].other && bands[0].tag === 'Sem. 1' && bands[0].sets.includes('40'), JSON.stringify(bands));
    ok('and the other session under it, named by its day', bands.length === 2 &&
       bands[1].other && bands[1].tag === 'Sem. 1 · Pecho/Brazo…' && bands[1].sets.includes('45'),
       JSON.stringify(bands));

    /* The whole point of keeping them as two bands. The other day was
       heavier, and the target must not have moved because of it: a machine
       pressed first on Monday and fourth on Thursday is not the same set,
       so the estimate reads this session's own history and nothing else. */
    ok('but the target still comes from this session alone',
       await page.evaluate(() => {
         const b = getBlock(), day = b.days[0];
         resetRenderCache();
         const t = targetFor(getProfile(), b, day, day.ex.find(e => e.id === 'chestpress'), 2, Date.now(), false);
         return t && t.from === 40;
       }), await page.evaluate(() => {
         const b = getBlock(), day = b.days[0];
         resetRenderCache();
         return JSON.stringify(targetFor(getProfile(), b, day, day.ex.find(e => e.id === 'chestpress'), 2, Date.now(), false));
       }));

    /* The chart is where the two sessions do meet. */
    ok('the block chart collects both sessions, in the order they were done',
       await page.evaluate(() => {
         const b = getBlock();
         const pts = collectHistoryDays(getProfile(), b, b.days[0].ex.find(e => e.id === 'chestpress'), 8, 'weight');
         return pts.length === 2 && pts[0].dayId === 'd0' && pts[0].weight === 40
           && pts[1].dayId === 'd2' && pts[1].weight === 45;
       }));

    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.ex')]
        .find(c => c.querySelector('.ex-name').childNodes[0].textContent.includes('Press de pecho'));
      card.querySelector('.ex-menu-btn').click();
    });
    await page.click('#exMenuChart');
    await page.waitForTimeout(400);
    const chart = await page.evaluate(() => ({
      head: document.querySelector('#chartHost .chart-table th').textContent,
      rows: [...document.querySelectorAll('#chartHost .chart-table tbody tr')].map(r => r.cells[0].textContent),
      sub: document.getElementById('chartSub').textContent,
    }));
    ok('a week now holds two points, so the axis counts sessions not weeks',
       chart.head === 'Sesión' && chart.rows.length === 2 &&
       chart.rows[0] === 'S1 · Empuje' && chart.rows[1] === 'S1 · Pecho/Brazo…', JSON.stringify(chart));
    ok('and the chart says so rather than still claiming one point per week',
       chart.sub.includes('de cada sesión registrada'), chart.sub);
    await page.click('#chartClose');
    await page.waitForTimeout(250);

    /* A lift planned on one day only must be exactly as it was: the week
       axis is the better one whenever it still fits. */
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.ex')]
        .find(c => c.querySelector('.ex-name').childNodes[0].textContent.includes('Contractora'));
      card.querySelector('.ex-menu-btn').click();
    });
    await page.click('#exMenuChart');
    await page.waitForTimeout(400);
    ok('a lift on one day only keeps the week axis',
       await page.evaluate(() => {
         const th = document.querySelector('#chartHost .chart-table th');
         const rows = document.querySelectorAll('#chartHost .chart-table tbody tr');
         return th && th.textContent === 'Semana' && rows.length === 1 && rows[0].cells[0].textContent === 'Semana 1';
       }));
    await page.click('#chartClose');
    await page.waitForTimeout(200);

    /* Renaming one of them is how you say they were never the same lift. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.blocks['block-1'].days[2].ex[0].n = 'Press de pecho inclinado en máquina';
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);
    ok('renaming one of them splits the history again',
       await page.evaluate(() => {
         const card = [...document.querySelectorAll('.ex')]
           .find(c => c.querySelector('.ex-name').childNodes[0].textContent.includes('Press de pecho'));
         return card.querySelectorAll('.last').length === 1;
       }));

    await ctx.close();
  });

  // ---------- plan-editor save: same exercise id on two days (plans/008 item 1) ----------
  await section('"Guardar cambios" con el mismo id de ejercicio en dos días', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    /* migrate() allows the same exercise id on two different days on
       purpose (see test/unit.js, "the same id on two different days
       survives, by design"). A hand-repaired file or an old backup can
       carry it, and "Guardar cambios" used to confuse the two under a map
       keyed by id alone, erasing one day's history even when nothing in
       the sheet was touched. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles.hombre;
      const b = p.blocks['block-1'];
      const src = b.days[0].ex.find(e => e.id === 'chestpress');
      b.days[1].ex.unshift(JSON.parse(JSON.stringify(src)));
      const set = (w, r) => ({ w: String(w), r: String(r), done: true });
      p.log['block-1'] = {
        'w1-d0': { chestpress: [set(40, 12)] },
        'w1-d1': { chestpress: [set(60, 8)] },
      };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(400);

    await openHub(page, 'plan');
    await page.click('#editPlan');
    ok('editor opens', await page.locator('#planSheet.up').count() === 1);
    await page.click('#peSave');
    await page.waitForTimeout(400);

    ok('day 1\'s chest press history survives an unmodified save',
       await page.evaluate(() => state.profiles.hombre.log['block-1']['w1-d0'].chestpress[0].w) === '40');
    ok('so does day 2\'s — the id-only map used to erase one of them',
       await page.evaluate(() => state.profiles.hombre.log['block-1']['w1-d1'].chestpress[0].w) === '60');
    ok('the save offers an undo, like every other destructive action here',
       (await page.textContent('#toastAct')) === 'Deshacer');

    await ctx.close();
  });

  // ---------- session note, energy, deload check ----------
  await section('nota, energía y control de descarga', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    ok('the energy chips are offered before the sets', await page.locator('.energy-chip').count() === 3);
    ok('and start empty', await page.locator('.energy-chip.on').count() === 0);
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

    /* The RIR box's own round trip, on a day where nothing has been ticked
       — the shape that used to write a value getRir could not read and
       pruneLog deleted on the next save (plans/035). Until that plan
       nothing in either suite had ever recorded an RIR at all, which is how
       it got that far; the control is a box per set since plans/036, so
       this is the same round trip through the box. */
    const rirCard = page.locator('.ex').first();
    const rirBox = rirCard.locator('.set-row').first().locator('.rir-in');
    const rirBoxes = rirCard.locator('.rir-in');
    /* Counted before it is read, and read through evaluateAll rather than
       one locator at a time. Both halves matter: `every` over an empty
       match is vacuously TRUE, so a renamed class would sail through this
       and take the section down four cases later instead — and asking a
       locator that matches nothing for an attribute waits thirty seconds
       and then takes the whole section down with it. The count is what
       makes the class name itself part of what is being asserted. */
    const rirPlaceholders = () => rirBoxes.evaluateAll(els => els.map(e => e.placeholder));
    ok('there is one RIR box per set row, and every one starts empty',
       await rirBoxes.count() === 4 &&
       await rirBoxes.evaluateAll(els => els.every(e => e.value === '')),
       'boxes: ' + await rirBoxes.count());
    /* Week 1 of the seed plan asks for 3 RIR, and every box says so in grey
       the way the weight box shows the objetivo's weight. */
    const week1Rir = await rirPlaceholders();
    ok('the RIR box greys in the week\'s own target',
       week1Rir.length === 4 && week1Rir.every(p => p === '3'), JSON.stringify(week1Rir));

    /* And a week that prescribes no RIR at all greys in nothing. Week 8 of
       the seed plan is "Descarga": phaseRir finds no number in it and
       returns null, while weekRir answers 0 — 0 is what it falls back to
       when nothing has been prescribed, and it is also a real reserve
       meaning "to failure". Read weekRir alone, as plans/036 Step C.3
       literally asks, and every box on a deload card greys in a 0 telling
       you to take a back-off set to failure; the '—' branch that plan
       names is unreachable. The probe reads both numbers so the assertion
       carries the trap in its own diagnostic. render() runs synchronously
       off the week click, so there is nothing to wait for. */
    await openWeeks(page);
    await page.locator('.wk').nth(7).click();
    const deloadRir = await page.evaluate(() => {
      const b = getBlock(), ex = b.days[0].ex[0];
      return { phase: phaseRir(b, 8), raw: weekRir(b, ex, 8, null),
               boxes: [...document.querySelectorAll('.ex')[0].querySelectorAll('.rir-in')].map(e => e.placeholder) };
    });
    ok('a deload week greys in an em dash, not the 0 weekRir falls back to',
       deloadRir.phase === null && deloadRir.raw === 0 &&
       deloadRir.boxes.length === 3 && deloadRir.boxes.every(p => p === '—'),
       JSON.stringify(deloadRir));
    await openWeeks(page);
    await page.locator('.wk').nth(0).click();
    await rirBox.fill('1');
    await page.waitForFunction(() => !saveT && !held);
    ok('typing one on a day with nothing ticked records it on the row',
       await page.evaluate(() => {
         const sl = JSON.parse(localStorage.getItem('heavy-iron-v1'))
           .profiles.hombre.log['block-1']['w1-d0'] || {};
         return Object.keys(sl).some(k => (sl[k] || []).some(r => r && r.rir === '1'));
       }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.rir-in').length > 0);
    const rirAfter = page.locator('.ex').first().locator('.set-row').first().locator('.rir-in');
    ok('...and it is still in the box after a reload', await rirAfter.inputValue() === '1',
       'box holds: ' + await rirAfter.inputValue());
    /* One digit, 0-5: the box refuses the rest rather than storing a number
       no reader can price a set on. */
    await rirAfter.fill('7');
    await page.waitForFunction(() => !saveT && !held);
    ok('...a reserve outside 0-5 is refused rather than stored',
       await rirAfter.inputValue() === '' &&
       await page.evaluate(() => {
         const sl = JSON.parse(localStorage.getItem('heavy-iron-v1'))
           .profiles.hombre.log['block-1']['w1-d0'] || {};
         return !Object.keys(sl).some(k => (sl[k] || []).some(r => r && r.rir === '7'));
       }), 'box holds: ' + await rirAfter.inputValue());
    await rirAfter.fill('1');
    await page.waitForFunction(() => !saveT && !held);
    await rirAfter.fill('');
    await page.waitForFunction(() => !saveT && !held);
    ok('...and emptying it clears it',
       await page.evaluate(() => {
         const sl = JSON.parse(localStorage.getItem('heavy-iron-v1'))
           .profiles.hombre.log['block-1']['w1-d0'] || {};
         return !Object.keys(sl).some(k => (sl[k] || []).some(r => r && r.rir != null));
       }));

    await page.fill('#sesNote', 'Dormí 5 h');
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok('a session note survives a reload', await page.inputValue('#sesNote') === 'Dormí 5 h');

    /* The note comes back the next week, on the same day, under the box.
       render() runs synchronously off the click, like the week switch at
       line 381 above, so no wait is needed before reading the DOM. */
    await openWeeks(page);
    await page.locator('.wk').nth(1).click();   /* the week after the one the note was typed on */
    const prevNote = page.locator('#sesNotePrev');
    ok('last week\'s note shows under the box the following week',
       await prevNote.isVisible() && (await prevNote.textContent()).includes('Sem. ') &&
       (await prevNote.textContent()).includes('Dormí 5 h'), await prevNote.textContent());
    await page.locator('.day').nth(1).click();   /* another day, no note before it */
    ok('a day with no earlier note shows nothing', await page.locator('#sesNotePrev').isHidden());
    await page.locator('.day').nth(0).click();
    await openWeeks(page);
    await page.locator('.wk').nth(0).click();   /* back to where the section left off */

    /* The note is keyed by slot with no exercise under it, so unlike an
       RIR on a row it would still be sitting there when the day came
       back. */
    await openHub(page, 'more');
    await page.click('#clearDay');
    await answerDialog(page, true);
    await page.waitForTimeout(400);
    ok('clearing the day clears its note too', await page.inputValue('#sesNote') === '');

    /* "Borrar todo el registro" used to leave the legacy RIR map on disk. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      pr.rir['block-1'] = { 'w1-d0': { chestpress: '1' } };
      pr.notes['block-1'] = { 'w1-d0': 'algo' };
      pr.energy['block-1'] = { 'w1-d0': 'alta' };
      pr.order['block-1'] = { 'w1-d0': ['lat1', 'chestpress'] };
      pr.obj['block-1'] = { 'w1-d0': { chestpress: { v: 3, sets: [{ w: 40, r: 10, m: '' }] } } };
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await openHub(page, 'more');
    await page.click('#wipe');
    await answerDialog(page, true);
    await page.waitForTimeout(500);
    /* Every part filed by block, off the app's own table. The log is read
       for sets rather than keys: the session redrawn after the wipe files
       its empty rows straight back, which is not a set anybody logged. */
    const wipeLeft = await page.evaluate(() => {
      const pr = JSON.parse(localStorage.getItem('heavy-iron-v1')).profiles.hombre;
      return RECORD_PARTS.filter(part => part.keyedBy !== 'exercise')
        .filter(part => part.name === 'log' ? countProfileSets(pr) > 0 : Object.keys(pr[part.name]).length)
        .map(part => part.name + ': ' + JSON.stringify(pr[part.name]).slice(0, 200));
    });
    ok('wiping the log wipes every part of the record filed by block with it',
       wipeLeft.length === 0, wipeLeft.join(' | '));

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
  });

  // ---------- block review ----------
  await section('revisión del bloque', async () => {
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

    await openHub(page, 'progress');
    await page.click('#reviewBtn');
    await page.waitForTimeout(400);
    ok('the review opens from the Progreso hub', await page.locator('#reviewSheet.up').count() === 1);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.rev-row')]
      .map(r => r.dataset.tag + '|' + r.querySelector('.rev-n').textContent));
    ok('it reports strength per muscle',
       rows.some(r => r.startsWith('Pecho|') && r.includes('+12,5 %')), JSON.stringify(rows.slice(0, 3)));
    ok('priority muscles come first',
       (await page.evaluate(() => document.querySelector('.rev-row').classList.contains('priority'))));
    ok('and it carries the session notes', await page.locator('.rev-note').count() === 2);

    const text = await page.evaluate(() => reviewText(buildBlockReview(getProfile(), getBlock())));
    ok('the brief names the block', text.includes('«Bloque 1»'), text.slice(0, 80));
    ok('the brief carries strength, attendance and volume per muscle',
       /«Pecho» \(PRIORITARIO\).*fuerza \+12,5 %.*sesiones 7\/\d+.*series\/semana/.test(text),
       (text.match(/- «Pecho».*/) || [''])[0]);
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
    await openHub(page, 'plan');
    await page.click('#newBlockBtn');
    await page.waitForTimeout(300);
    ok('starting a new block offers the review of the one you are leaving',
       (await page.locator('#askBody').textContent()).includes('revisión'));
    await page.click('#askOk');
    await page.waitForTimeout(400);
    ok('choosing to read it opens the review', await page.locator('#reviewSheet.up').count() === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('and closing it with Escape still picks the new-block flow back up',
       await page.locator('#askSheet.up').count() === 1 &&
       (await page.locator('#askT').textContent()).includes('Nuevo bloque'));
    await page.click('#askCancel');
    await page.waitForTimeout(300);

    /* Declining goes straight to naming it, with no review in between. */
    await openHub(page, 'plan');
    await page.click('#newBlockBtn');
    await page.waitForTimeout(300);
    await page.click('#askCancel');
    await page.waitForTimeout(400);
    ok('declining the review goes straight to naming the block',
       (await page.locator('#askT').textContent()).includes('Nuevo bloque'));
    await page.click('#askCancel');
    await page.waitForTimeout(300);

    /* The return leg, from the flow that needs it most: "+ Nuevo bloque"
       offers the review, the review takes the JSON back, and the
       continuation that would have asked to name a copied block is
       dropped — the pasted block is the next block. */
    const nextBlock = JSON.stringify({ name: 'Bloque siguiente', days: [{ name: 'Día A', ex: [{ n: 'Press banca', reps: '6–10', sets: 3 }] }] });
    await openHub(page, 'plan');
    await page.click('#newBlockBtn');
    await page.waitForSelector('#askSheet.up');
    await page.click('#askOk');
    await page.waitForSelector('#reviewSheet.up');
    ok('the review is up again from "+ Nuevo bloque"', await page.locator('#reviewSheet.up').count() === 1);
    await page.fill('#reviewBlob', 'esto no es json');
    await page.click('#reviewImport');
    await page.waitForFunction(() => (document.getElementById('reviewStatus').textContent || '').includes('JSON'));
    ok('a paste that is not JSON is refused on the sheet itself',
       (await page.locator('#reviewStatus').textContent()).includes('JSON') &&
       await page.locator('#reviewSheet.up').count() === 1,
       await page.locator('#reviewStatus').textContent());
    await page.fill('#reviewBlob', '{"name":"Sin días"}');
    await page.click('#reviewImport');
    await page.waitForFunction(() => (document.getElementById('reviewStatus').textContent || '').includes('days'));
    ok('and so is a block the validator rejects, with its own message',
       (await page.locator('#reviewStatus').textContent()).includes('days'),
       await page.locator('#reviewStatus').textContent());
    await page.fill('#reviewBlob', nextBlock);
    await page.click('#reviewImport');
    await page.waitForSelector('#reviewSheet.up', { state: 'hidden' });
    ok('pasting the next block on the review installs it and closes the sheet',
       await page.locator('#reviewSheet.up').count() === 0);
    ok('without asking to name a second block afterwards',
       await page.locator('#askSheet.up').count() === 0);
    ok('it is the active block now',
       (await page.textContent('#title')).includes('Bloque siguiente'), await page.textContent('#title'));
    ok('as a new block beside the old one, not on top of it',
       await page.evaluate(() => getProfile().blockOrder.length) === 2 &&
       await page.evaluate(() => getProfile().blocks[getProfile().blockOrder[0]].name) === 'Bloque 1');
    ok('the old block keeps its log',
       await page.evaluate(() => Object.keys(getProfile().log['block-1'] || {}).length) === 7);

    /* A block with nothing logged has nothing to review, and says so
       instead of printing a page of zeroes. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.profiles.hombre.log['block-1'] = {};
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await openHub(page, 'progress');
    await page.click('#reviewBtn');
    await page.waitForTimeout(300);
    ok('an empty block says there is nothing to review yet',
       await page.locator('#reviewHost .chart-empty').count() === 1);
    await ctx.close();
  });

  // ---------- the first week of a new block sees the block before it ----------
  await section('primera semana de un bloque nuevo', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForSelector('.ex');
    /* Seeding below writes localStorage behind the app's back, so it has to
       wait for the app's own debounced save() queue to be empty first:
       closeSetup() schedules one on the way out of the first-run sheet, and
       when it fires 400 ms later it writes the app's untouched in-memory
       state straight over the seed — the reload then reads week 1 with an
       empty log and the new-block flow skips the review offer. (The two
       older sections seeding this way happen to sleep past it; a condition
       is what actually makes it safe.) */
    await page.waitForFunction(() => !saveT && !held);

    /* Seven working weeks of one exercise, plus the deload at 40 — which
       must be the one week the hint does NOT come from. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const one = (w, r) => [{ w: String(w), r: String(r), done: true, ts: Date.now() }, { w: String(w), r: String(r - 1), done: true, ts: Date.now() }];
      pr.log['block-1'] = {};
      for (let i = 0; i < 7; i++) pr.log['block-1']['w' + (i + 1) + '-d0'] = { chestpress: one(60 + i * 2.5, 8) };
      pr.log['block-1']['w8-d0'] = { chestpress: one(40, 8) };
      pr.week = 8; pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ex');

    await openHub(page, 'plan');
    await page.click('#newBlockBtn');
    await answerDialog(page, false);            /* "Crear sin repasar" */
    await answerDialog(page, true, 'Bloque 2'); /* the name prompt */
    await page.waitForFunction(() => (document.getElementById('title').textContent || '').includes('Bloque 2'));
    ok('the new block opens on week 1', (await page.textContent('#title')).includes('Bloque 2'));

    const card = page.locator('.ex').first();
    const wIn = card.locator('.set-row').first().locator('input').first();
    /* The rule reads its history by exercise id across blocks, so week 1 of
       a new block is a week with seven sessions behind it like any other:
       there IS an objetivo, and the hint is its own weight for set 1. */
    ok('week 1 of the new block already has an objetivo, built on the block before it',
       (await card.locator('.ex-est-l').textContent()).startsWith('↘ objetivo: 75×'),
       await card.locator('.ex-est-l').textContent());
    ok('and the hint in every box is that objetivo, set by set',
       await wIn.getAttribute('placeholder') === '75', 'got ' + await wIn.getAttribute('placeholder'));
    ok('under a band that names the block and the week it came from',
       (await card.locator('.last.prior .tag').textContent()).includes('Bloque 1') &&
       (await card.locator('.last.prior .tag').textContent()).includes('Sem. 7'),
       await card.locator('.last.prior').textContent());
    ok('the deload week was skipped', !(await card.locator('.last.prior').textContent()).includes('40'));
    ok('an exercise the old block never logged gets no band and no hint',
       await page.locator('.ex').nth(1).locator('.last.prior').count() === 0 &&
       await page.locator('.ex').nth(1).locator('.set-row').first().locator('input').first().getAttribute('placeholder') === '—');

    await card.locator('.set-row').first().locator('.tick').click();
    await page.waitForFunction(() => (document.getElementById('status').textContent || '').includes('objetivo'));
    ok('ticking the empty box adopts the hint', await wIn.inputValue() === '75');
    ok('and the status line says where the number came from',
       (await page.textContent('#status')).includes('el objetivo de esta semana'), await page.textContent('#status'));
    await page.click('#tskip');

    await page.click('#copyPrev');
    await page.waitForFunction(() => (document.getElementById('status').textContent || '').includes('Objetivo escrito'));
    /* The last block ended two sets deep at 75; the deeper sets of a
       four-set week have no reference at that weight and come down the
       ladder rather than being asked for reps nobody has done. */
    ok('"Rellenar con el objetivo" writes week 1 from the block before it',
       await card.locator('.set-row').nth(1).locator('input').first().inputValue() === '72,5',
       await card.locator('.set-row').nth(1).locator('input').first().inputValue());
    await ctx.close();
  });

  // ---------- keeping the log on the device ----------
  await section('almacenamiento', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('#setupNames input >> nth=0', 'Ana');
    await page.click('#setupSave');
    await page.waitForTimeout(500);

    ok('the browser is asked to protect the log once setup is saved',
       await page.evaluate(() => state.prefs.persistAsked === true));

    await openHub(page, 'more');
    await page.click('#backup');
    await page.waitForTimeout(400);
    const line = await page.textContent('#storageState');
    ok('the backup sheet says what the log weighs', /Tu registro ocupa \d+ (B|KB|MB)\./.test(line), line);
    /* Headless Chrome refuses persistence (no install, no engagement), which
       is exactly the state a first-time visitor is in: the sheet has to say
       so and offer the one tap that fixes it. */
    const safe = await page.evaluate(() => navigator.storage.persisted());
    ok('and whether the browser has promised to keep it',
       safe ? /Está protegido/.test(line) : /No está protegido/.test(line), line);
    ok('the protect button appears exactly when it is needed',
       await page.locator('#storageActs').isVisible() === !safe);

    await page.click('#storageProtect');
    await page.waitForTimeout(400);
    ok('asking again reports back either way',
       /proteg/.test(await page.textContent('#status')), await page.textContent('#status'));
    ok('and asking never throws the log away',
       (await page.textContent('#title')).includes('Ana'));

    /* Writes are debounced by 400 ms, and the phone going into a pocket is
       the most likely moment for the tab to be discarded — so hiding the
       page has to flush. Untested until the rest timer was split out of
       app.js (plans/008 item 13): that listener did this job and the timer's
       in the same handler, and only one half stayed behind. */
    await page.keyboard.press('Escape');  /* the backup sheet is still up */
    await page.waitForTimeout(200);
    const flushed = await page.evaluate(() => {
      const box = document.querySelector('#list .set-row input');
      box.value = '77,5';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      /* Straight into the debounce window: nothing is in localStorage yet. */
      const before = localStorage.getItem('heavy-iron-v1').includes('77,5');
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return { before: before, after: localStorage.getItem('heavy-iron-v1').includes('77,5') };
    });
    ok('a weight typed a moment ago is not in storage yet', flushed.before === false);
    ok('and hiding the page flushes it before the debounce would have',
       flushed.after === true);
    await ctx.close();
  });

  // ---------- two tabs: the pending write used to land before the toast ----------
  /* js/app.js's 'storage' handler used to leave its own pending debounce
     timer running after showing the conflict toast, so it fired up to
     400 ms later regardless of the toast — landing before anyone could have
     read it, let alone answered it. Two pages in one context share
     localStorage the way two real tabs do, so a write from one fires a real
     'storage' event in the other. */
  await section('dos pestañas: el guardado pendiente no se adelanta al aviso', async () => {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    await page1.goto(BASE, { waitUntil: 'networkidle' });
    await page1.fill('#setupNames input >> nth=0', 'Ana');
    await page1.click('#setupSave');
    await page1.waitForTimeout(500);

    const page2 = await ctx.newPage();
    await page2.goto(BASE, { waitUntil: 'networkidle' });
    await page2.waitForTimeout(500);

    await page1.evaluate(() => { state.prefs.barWeight = 11; save(); });
    ok('page1 has a debounced write queued', await page1.evaluate(() => saveT !== null));

    await page2.evaluate(() => { state.prefs.barWeight = 22; writeState(true); });
    await page1.waitForTimeout(150);

    ok('page1 shows the two-tab conflict toast', await page1.locator('#toast').isVisible());
    ok('offering both "keep mine" and "reload" rather than one dismiss',
       (await page1.textContent('#toastAct')).includes('Quedarme') &&
       (await page1.textContent('#toastAct2')).includes('Recargar'));
    ok('and cancels its own pending timer instead of letting it fire later',
       await page1.evaluate(() => saveT === null && held === true));

    /* Opening a file that is not a backup must not answer the toast: a
       rejected import is not the user saying "keep mine", so it must leave
       the held conflict — and the other tab's write — exactly as they were. */
    const beforeInvalid = await page1.evaluate(() => localStorage.getItem('heavy-iron-v1'));
    await page1.evaluate(() => restoreFromText('esto no es json'));
    ok('una copia inválida no resuelve el conflicto de pestañas: se informa del motivo',
       (await page1.textContent('#status')).includes('no es una copia válida'), await page1.textContent('#status'));
    ok('el aviso de dos pestañas sigue en pantalla', await page1.locator('#toast').isVisible());
    ok('y lo que la otra pestaña había guardado no se ha tocado',
       await page1.evaluate(() => localStorage.getItem('heavy-iron-v1')) === beforeInvalid);

    await page1.waitForTimeout(500);
    const midway = await page2.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).prefs.barWeight);
    ok('past the old 400ms window, page2\'s write is still the one on disk — nothing overwrote it silently',
       midway === 22, midway);

    await page1.click('#toastAct');
    await page1.waitForTimeout(300);
    const kept = await page1.evaluate(() => JSON.parse(localStorage.getItem('heavy-iron-v1')).prefs.barWeight);
    ok('"Quedarme con lo mío" writes page1\'s state through on purpose',
       kept === 11, kept);
    ok('and clears the held flag', await page1.evaluate(() => held === false));
    await ctx.close();
  });

  // ---------- the rest alarm with the phone in a pocket ----------
  /* The alarm above only fires while the page is running. This is the part
     that survives a locked screen: a near-silent loop that keeps the page
     from being frozen, the lock-screen card that comes with it, and a
     notification for when even that is not enough. Headless Chrome denies
     notification permission outright, so the permission and the delivery are
     stubbed and what is tested is the app's own decision: what it posts,
     when, and when it stays quiet. */
  await section('descanso con la pantalla apagada', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('#setupNames input >> nth=0', 'Ana');
    await page.click('#setupSave');
    await page.waitForTimeout(500);

    ok('the setting is off until somebody turns it on',
       await page.evaluate(() => state.prefs.bgAlarm === false));

    await page.evaluate(() => {
      window.__notes = [];
      window.__closed = 0;
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
      ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
        window.__notes.push({ title: title, opts: opts });
        return Promise.resolve();
      };
      ServiceWorkerRegistration.prototype.getNotifications = function () {
        return Promise.resolve(window.__notes.map(() => ({ close: () => { window.__closed++; } })));
      };
    });

    /* Off: a rest is just a rest — nothing plays, and the phone is told
       nothing, so whatever music is on keeps playing. */
    await page.evaluate(() => startRest(1, 'Press banca'));
    await page.waitForTimeout(300);
    ok('with the setting off nothing is played to keep the page awake',
       await page.evaluate(() => keepAlive === null || keepAlive.paused));
    ok('and no lock-screen card is claimed',
       await page.evaluate(() => !navigator.mediaSession.metadata));
    await page.evaluate(() => stopRest());

    await openHub(page, 'more');
    await page.click('#settings');
    await page.waitForTimeout(300);
    ok('the setting is in Ajustes', await page.locator('#setupBgField').isVisible());
    await page.click('#setupBgAlarm .seg-btn[data-bg="on"]');
    ok('turning it on explains what it costs',
       (await page.textContent('#setupBgHint')).includes('música'));
    await page.click('#setupSave');
    await page.waitForTimeout(400);
    ok('and the choice is saved', await page.evaluate(() => state.prefs.bgAlarm === true));

    await page.evaluate(() => { state.prefs.sound = true; });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    });
    await page.evaluate(() => startRest(2, 'Press banca'));
    await page.waitForTimeout(400);
    ok('a rest now plays something, so the phone will not freeze the page',
       await page.evaluate(() => !!keepAlive && !keepAlive.paused && keepAlive.loop));
    const card = await page.evaluate(() => [navigator.mediaSession.metadata.title, navigator.mediaSession.metadata.artist]);
    ok('the lock screen says what you are resting for', card[0] === 'Descanso · Press banca', card[0]);
    ok('and when it ends', /^Termina a las /.test(card[1]), card[1]);

    await page.waitForTimeout(2400);
    ok('when it is over the card says so',
       await page.evaluate(() => navigator.mediaSession.metadata.title) === 'Vamos — se acabó el descanso');
    const posted = await page.evaluate(() => window.__notes.map(n => [n.title, n.opts.body, n.opts.tag]));
    ok('and a notification goes out, since the app is out of sight',
       posted.length === 1 && posted[0][0] === 'Se acabó el descanso', JSON.stringify(posted));
    ok('it names the exercise', posted.length === 1 && posted[0][1].includes('Press banca'), JSON.stringify(posted));
    ok('and replaces itself rather than stacking up', posted.length === 1 && posted[0][2] === 'heavy-iron-rest');
    ok('the alarm still holds the audio while it is beeping',
       await page.evaluate(() => !!keepAlive && !keepAlive.paused));

    /* Skipping hands the phone back: the music this interrupted gets to
       carry on, and the notification does not sit there over a rest you
       have already got on with. */
    await page.evaluate(() => stopRest());
    await page.waitForTimeout(300);
    ok('skipping stops playing and gives the audio back',
       await page.evaluate(() => keepAlive.paused));
    ok('and clears the card', await page.evaluate(() => !navigator.mediaSession.metadata));
    ok('and takes the notification down', await page.evaluate(() => window.__closed > 0));

    /* Watching the countdown is not a moment to be notified about it. */
    await page.evaluate(() => {
      window.__notes.length = 0;
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    });
    await page.evaluate(() => startRest(1, 'Sentadilla'));
    await page.waitForTimeout(1800);
    ok('a rest that ends with the app on screen notifies nobody',
       await page.evaluate(() => window.__notes.length === 0));
    await page.evaluate(() => stopRest());
    await ctx.close();
  });

  // ---------- being told about a new version ----------
  /* The prompt used to hang off updatefound alone, which never fires for a
     worker that finished installing while nobody was looking — so the app
     sat on the old code with the new one parked behind it and nothing on
     screen to say so. Serving a second version from here would mean writing
     to the files under test, so what is stubbed is the state the browser
     hands the app (a registration with something waiting) and what is
     asserted is what the app does about it. */
  await section('aviso de versión nueva', async () => {
    const ctx = await browser.newContext();

    /* First visit: register, and become controlled. */
    const first = await ctx.newPage();
    await first.goto(BASE, { waitUntil: 'networkidle' });
    await first.waitForTimeout(1200);
    ok('the app takes control on the first visit',
       await first.evaluate(() => !!navigator.serviceWorker.controller));
    await first.close();

    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__skipped = null;
      window.__updates = 0;
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'waiting', {
        configurable: true,
        get() { return { postMessage: m => { window.__skipped = m; } }; },
      });
      ServiceWorkerRegistration.prototype.update = function () {
        window.__updates++;
        return Promise.resolve();
      };
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    ok('a version already waiting when the app opens is offered straight away',
       await page.locator('#toast').isVisible());
    ok('and says what it is', (await page.textContent('#toastMsg')).includes('versión nueva'),
       await page.textContent('#toastMsg'));

    await page.click('#toastAct');
    await page.waitForTimeout(300);
    ok('taking it up tells the waiting version to take over',
       await page.evaluate(() => window.__skipped === 'skipWaiting'));

    /* Coming back to an app that never navigates is the only chance the
       browser gets to look for a new version — but not on every glance. */
    ok('opening the app counts as having just checked',
       await page.evaluate(() => window.__updates === 0));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    ok('coming straight back does not check again',
       await page.evaluate(() => window.__updates === 0));

    await page.evaluate(() => { lastUpdateCheck = 0; });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    ok('coming back much later does', await page.evaluate(() => window.__updates === 1));
    await ctx.close();
  });

  // ---------- a shell that did not boot hands over to the waiting worker ----------
  /* Twice a returning phone has been left on "Cargando tu registro…" by a
     shell mixed from two releases: the old cached app.js and a newly split
     file declared the same top-level name, app.js failed to parse, and the
     "Actualizar" offer inside it never ran. js/boot-guard.js is the script
     after app.js that runs anyway: it hands over to the worker already
     waiting with a complete shell. The worker is blocked here so the page's
     own requests are routable; the registration is stood in for. */
  await section('arranque roto: el guardián cambia al worker en espera', async () => {
    const standIn = async (page, waiting) => {
      await page.addInitScript(w => {
        window.__skipped = null;
        window.__updates = 0;
        const reg = {
          waiting: w ? { postMessage: m => { window.__skipped = m; } } : null,
          installing: null,
          addEventListener() {},
          update() { window.__updates++; return Promise.resolve(); },
        };
        navigator.serviceWorker.getRegistration = () => Promise.resolve(reg);
      }, waiting);
    };
    /* The old app.js of a mixed shell: a top-level name js/chart.js has
       already declared. A parse error, so nothing of it runs — the same
       "Identifier 'e1rmValue' has already been declared" that shipped. */
    const brokenAppJs = page => page.route('**/js/app.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: 'const e1rmValue = 1;\n' }));

    const ctx = await browser.newContext({ serviceWorkers: 'block' });

    const stuck = await ctx.newPage();
    await standIn(stuck, true);
    await brokenAppJs(stuck);
    await stuck.goto(BASE, { waitUntil: 'load' });
    await stuck.waitForTimeout(600);
    ok('the broken shell really did not boot',
       await stuck.evaluate(() => typeof load === 'undefined' && !!document.querySelector('#list .skel')));
    ok('the guard tells the waiting worker to take over',
       await stuck.evaluate(() => window.__skipped === 'skipWaiting'), await stuck.evaluate(() => String(window.__skipped)));
    await stuck.close();

    const alone = await ctx.newPage();
    await standIn(alone, false);
    await brokenAppJs(alone);
    await alone.goto(BASE, { waitUntil: 'load' });
    await alone.waitForTimeout(600);
    ok('with nothing waiting it asks for an update instead',
       await alone.evaluate(() => window.__skipped === null && window.__updates === 1));
    ok('and still says "Cargando" while a swap could yet come',
       (await alone.textContent('#list .skel')).includes('Cargando'));
    await alone.waitForTimeout(4000);
    ok('after a fair wait it says the app did not start, and what to do',
       (await alone.textContent('#list .skel')).includes('no ha podido arrancar'), await alone.textContent('#list .skel'));
    await alone.close();

    const healthy = await ctx.newPage();
    await standIn(healthy, true);
    await healthy.goto(BASE, { waitUntil: 'load' });
    await healthy.waitForTimeout(600);
    ok('a shell that booted is left alone, waiting worker or not',
       await healthy.evaluate(() => window.__skipped === null && !document.querySelector('#list .skel')));
    await ctx.close();
  });

  // ---------- which version is running ----------
  /* "Did it update?" used to be answerable only by reasoning about service
     workers. The footer line answers it, and it has to come from the worker
     serving the page rather than a constant in this file, or it would report
     what the code wishes it were rather than what is installed. */
  await section('versión en el pie', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);

    /* The worker claims the first uncontrolled page and the app reloads, so
       wait for a controlled page rather than for a fixed delay. */
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await page.waitForTimeout(800);

    const shown = await page.textContent('#version');
    ok('the footer names the running version', /^Heavy Iron v\d+$/.test(shown.trim()), shown);
    ok('and it is the version the worker actually is',
       shown.trim() === 'Heavy Iron ' + await page.evaluate(() => new Promise(res => {
         const ch = new MessageChannel();
         ch.port1.onmessage = e => res(e.data);
         navigator.serviceWorker.controller.postMessage('version', [ch.port2]);
       })), shown);
    ok('it is visible', await page.locator('#version').isVisible());

    /* A worker too old to know the question leaves the line alone rather
       than printing a guess — the same as before this line existed. */
    const quiet = await page.evaluate(async () => {
      const el = document.getElementById('version');
      el.hidden = true;
      el.textContent = '';
      const real = navigator.serviceWorker.controller.postMessage;
      navigator.serviceWorker.controller.postMessage = () => {};   // an older worker: no reply
      renderVersion();
      await new Promise(r => setTimeout(r, 400));
      const state = { hidden: el.hidden, text: el.textContent };
      navigator.serviceWorker.controller.postMessage = real;
      return state;
    });
    ok('a worker that does not answer leaves the line hidden',
       quiet.hidden === true && quiet.text === '', JSON.stringify(quiet));
    await ctx.close();
  });

  // ---------- the app starts without the font host ----------
  /* The webfont sat in front of the scripts, so a font host that was slow to
     answer held the whole app at "Cargando tu registro…" — on an app that
     otherwise needs no network at all. It is parked on media="print" now and
     switched on once it lands. The service worker is blocked in these cases
     so that the font request is the page's own, and therefore routable. */
  await section('arranque sin la tipografía', async () => {

    const startsWith = async (label, routeFn) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      await routeFn(ctx);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      let ms = null;
      for (let i = 0; i < 40; i++) {
        if (await page.evaluate(() => typeof startRest === 'function').catch(() => false)) { ms = Date.now() - t0; break; }
        await page.waitForTimeout(250);
      }
      ok(label, ms !== null && ms < 5000, ms === null ? 'never started' : ms + 'ms');
      return { ctx, page };
    };

    /* The gym-basement case: the connection is accepted and then nothing. */
    const dead = await startsWith('the app starts even when the font host never answers',
      ctx => ctx.route('https://fonts.googleapis.com/**', () => { /* hang */ }));
    ok('and it has drawn something rather than sitting on the skeleton',
       await dead.page.locator('.ex, .skel').count() > 0);
    ok('the webfont stays parked while it has not arrived',
       await dead.page.evaluate(() => document.getElementById('webfont').media) === 'print');
    await dead.ctx.close();

    const refused = await startsWith('and when the font host refuses outright',
      ctx => ctx.route('https://fonts.googleapis.com/**', r => r.abort()));
    await refused.ctx.close();

    /* ...and when it does arrive, it is switched on for real. */
    const fine = await startsWith('and when the font host is healthy',
      ctx => ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({
        status: 200, contentType: 'text/css',
        body: "@font-face{font-family:'Archivo';src:local('Arial');}",
      })));
    await fine.page.waitForTimeout(800);
    ok('a webfont that arrives is switched on',
       await fine.page.evaluate(() => document.getElementById('webfont').media) === 'all');
    ok('and the stylesheet is really applied',
       await fine.page.evaluate(() => !!document.getElementById('webfont').sheet));
    await fine.ctx.close();

    /* Every element that names the webfont has to name the fallback too, or
       it drops to the browser's serif for the first moments of every start. */
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof startRest === 'function');
    await dismissSetup(page);
    /* Anything that asks for Archivo must say what to use instead of it.
       (Elements that never asked for it — the day and energy buttons take the
       browser's own control font — are a separate question, and not one this
       change touches.) */
    const orphaned = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('*').forEach(el => {
        const f = getComputedStyle(el).fontFamily;
        if (/Archivo/.test(f) && !/sans-serif/.test(f)) bad.push((el.className || el.tagName) + ' :: ' + f);
      });
      return bad.slice(0, 5);
    });
    ok('every element that asks for the webfont also names a fallback',
       orphaned.length === 0, JSON.stringify(orphaned));
    await ctx.close();
  });

  // ---------- installable as an app ----------
  /* Firefox on Android is the strict one: it only offers "Instalar" when the
     manifest names a raster icon of a size it can parse and that size is at
     least 192. An SVG with sizes:"any" — which Chrome and Safari are happy
     with — is invisible to it, so these cases pin the PNGs down. */
  await section('installable', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const m = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').getAttribute('href');
      const manifest = await (await fetch(href)).json();
      /* PNG dimensions straight out of the IHDR chunk: bytes 16-23 of the
         file are width and height, big-endian. No decoding, no CSP. */
      const files = {};
      for (const icon of manifest.icons) {
        const res = await fetch(icon.src);
        if (!res.ok) { files[icon.src] = { status: res.status }; continue; }
        const buf = new Uint8Array(await res.arrayBuffer());
        const view = new DataView(buf.buffer);
        const png = buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        files[icon.src] = {
          status: res.status,
          type: res.headers.get('content-type') || '',
          px: png ? [view.getUint32(16), view.getUint32(20)] : null,
        };
      }
      return { manifest, files };
    });

    ok('the manifest asks for its own window', m.manifest.display === 'standalone', m.manifest.display);
    ok('the manifest has a name and a short name', !!m.manifest.name && !!m.manifest.short_name);
    ok('the manifest has a start_url', !!m.manifest.start_url, m.manifest.start_url);

    const raster = m.manifest.icons.filter(i => /^\d+x\d+$/.test(i.sizes || ''));
    const big = raster.filter(i => parseInt(i.sizes, 10) >= 192);
    ok('at least one icon declares a numeric size of 192 or more (Firefox Android)',
       big.length > 0, JSON.stringify(m.manifest.icons.map(i => i.sizes)));
    ok('one of those is a PNG', big.some(i => i.type === 'image/png'));
    ok('there is a maskable icon for the home screen',
       m.manifest.icons.some(i => (i.purpose || '').split(/\s+/).includes('maskable')));

    for (const icon of m.manifest.icons) {
      const f = m.files[icon.src];
      ok('the manifest icon ' + icon.src + ' exists', f && f.status === 200, JSON.stringify(f));
      if (f && f.px) {
        const [w, h] = icon.sizes.split('x').map(Number);
        ok(icon.src + ' really is ' + icon.sizes,
           f.px[0] === w && f.px[1] === h, f.px.join('x'));
      }
    }

    /* An icon the install prompt cannot fetch offline is an icon the phone
       may draw as a blank square, so the shell precaches every one of them. */
    const sw = await (await page.request.get(BASE + '/sw.js')).text();
    for (const icon of m.manifest.icons) {
      ok('the service worker precaches ' + icon.src, sw.includes("'" + icon.src + "'"));
    }

    const touch = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
    ok('the apple-touch-icon is a PNG (iOS ignores an SVG here)',
       /\.png$/.test(touch || ''), touch);
    await ctx.close();
  });

  // ---------- layout on real phone widths ----------
  // ---------- accessibility: reduced motion, CSP with no unsafe-inline ----------
  await section('accesibilidad: reduced motion y CSP sin unsafe-inline (plans/008 item 22)', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const cspViolations = [];
    page.on('console', msg => { if (msg.text().includes('Content Security Policy')) cspViolations.push(msg.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(300);
    const dur = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.sm')).transitionDuration) * 1000);
    ok('prefers-reduced-motion collapses a transition to near-zero', dur < 1, dur + 'ms');
    // sheets, the heat-map SVG, the volume/strength charts and the plan
    // editor's flex fields are the ones that used to carry style="" —
    // exercising them here is what would surface a CSP violation the
    // "no Content-Security-Policy violations" check in "main session"
    // might not reach if this section's --only run skips that one.
    await openHub(page, 'progress');
    await page.click('#diagBtn');
    await page.click('#diagView >> text=Frecuencia');
    await page.waitForTimeout(200);
    await page.click('#diagClose');
    await openHub(page, 'progress');
    await page.click('#volumeBtn');
    await page.waitForTimeout(200);
    await page.click('#volumeClose');
    await openHub(page, 'plan');
    await page.click('#editPlan');
    await page.waitForTimeout(200);
    await page.click('#peClose');
    ok('none of that tripped the CSP', cspViolations.length === 0, cspViolations.join(' | '));
    await ctx.close();
  });

  await section('layout', async () => {
    for (const [label, width] of [['iPhone SE', 375], ['Pixel', 412], ['tablet', 768]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 820 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await dismissSetup(page);

      /* The bar, before anything is covering it. 48px rather than SC 2.5.8's
         24: it is the floor plans/036 held the card's own controls to, and a
         destination you reach for mid-set with one hand is the last place to
         economise (plans/031 § L8). */
      const bar = await page.evaluate(() => ({
        vw: window.innerWidth, vh: window.innerHeight,
        btns: [...document.querySelectorAll('.navbar-btn')].map(b => {
          const x = b.getBoundingClientRect();
          return { id: b.id, l: Math.round(x.left), r: Math.round(x.right), bot: Math.round(x.bottom), h: Math.round(x.height) };
        }),
      }));
      ok(label + ': the bar\'s four destinations are inside the viewport and at least 48px tall',
         bar.btns.length === 4 && bar.btns.every(x => x.l >= 0 && x.r <= bar.vw && x.bot <= bar.vh && x.h >= 48),
         JSON.stringify(bar.btns) + ' in ' + bar.vw + 'x' + bar.vh);

      /* The energy chips shipped flush against the week selector's border: the
         row's only separation came from the pair note between them, so it read
         correctly for a pair and touched for anyone training alone. Measured
         with the note hidden, which is the case that was broken. */
      const gap = await page.evaluate(() => {
        const pair = document.querySelector('.pair'), was = pair.hidden;
        pair.hidden = true;
        const top = document.querySelector('.energy').getBoundingClientRect().top;
        const bottom = document.querySelector('.week-row').getBoundingClientRect().bottom;
        pair.hidden = was;
        return Math.round(top - bottom);
      });
      ok(label + ': the energy chips do not touch the week selector with no pair note',
         gap >= 8, gap + 'px');

      await page.locator('.ex').first().locator('.set-row').first().locator('input').first().fill('60');
      await page.locator('.ex').first().locator('.set-row').first().locator('.tick').click();
      await page.waitForTimeout(300);
      /* Still four boxes, but the fourth is the sound switch on the line
         below rather than a fourth 29px button squeezed into the row — which
         is what bought the other three their 44px (plans/037). */
      const r = await page.evaluate(() => ({
        vw: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        navHidden: document.getElementById('navBar').hidden,
        btns: [...document.querySelectorAll('.timer-acts .timer-btn'), document.getElementById('tsound')]
          .map(b => b.getBoundingClientRect()).map(x => [Math.round(x.left), Math.round(x.right)]),
      }));
      ok(label + ': the three rest-timer controls and the sound switch are on screen',
         r.btns.length === 4 && r.btns.every(([l, rt]) => l >= 0 && rt <= r.vw), JSON.stringify(r.btns));
      /* The timer takes the bar's place rather than stacking on top of it —
         the reason the bar's place was worth having. */
      ok(label + ': the bar is out of the way while a rest runs', r.navHidden === true, String(r.navHidden));
      ok(label + ': page does not scroll sideways', r.scroll <= r.vw, r.scroll + ' > ' + r.vw);

      await page.click('#tskip');
      /* Both halves of both switches, because hiding is the easy one to get
         right: a bar stuck hidden passes every "it is not on screen" check
         ever written, and neither of the two things that hide it is the
         thing that brings it back — stopRest() and focusout are. */
      const afterRest = await page.evaluate(() => ({
        hidden: document.getElementById('navBar').hidden,
        display: getComputedStyle(document.getElementById('navBar')).display,
      }));
      ok(label + ': and comes back when the rest ends',
         afterRest.hidden === false && afterRest.display !== 'none', JSON.stringify(afterRest));

      /* And again for the software keyboard. iOS has no
         `interactive-widget` viewport segment, so the visual viewport does
         not shrink and a fixed bar floats on top of the keyboard — over the
         very row being typed into.

         No sleeps anywhere here: stopRest() runs inside the click, focusin
         inside the focus() and focusout inside the blur(), and each call
         resolves after the page has run the handler. */
      const wBox = page.locator('.ex').first().locator('.set-row').nth(1).locator('input').first();
      await wBox.focus();
      const kb = await page.evaluate(() => ({
        kbOpen: document.getElementById('app').classList.contains('kb-open'),
        display: getComputedStyle(document.getElementById('navBar')).display,
      }));
      ok(label + ': the bar goes away while a weight box has the keyboard',
         kb.kbOpen && kb.display === 'none', JSON.stringify(kb));
      await wBox.blur();
      const kbBack = await page.evaluate(() => ({
        kbOpen: document.getElementById('app').classList.contains('kb-open'),
        display: getComputedStyle(document.getElementById('navBar')).display,
      }));
      ok(label + ': and comes back when the box loses it',
         !kbBack.kbOpen && kbBack.display !== 'none', JSON.stringify(kbBack));
      await ctx.close();
    }
  });

  /* Pins plan 032's four fixes at once: the header height, the day-tab
     colour, the focus-under-header bug and the sub-24px controls. 375x667
     (an iPhone SE's logical size) with colorScheme: 'dark' reproduces the
     bug plan 032 Step C fixed — data-theme="light" used to draw .day in the
     OS dark scheme's button colour, not the app's own --ink. */
  await section('accesibilidad: tamaños, foco y área segura', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);

    /* Force the saved theme to "light" against this dark-system context —
       same localStorage-then-reload route the objetivo section uses to seed
       state (test/smoke.js, seed() above) — so the day-tab case in play is
       data-theme="light" on a dark-system browser, the one the bug needed. */
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      s.prefs.theme = 'light';
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);

    // 1. the sticky header
    const topH = await page.evaluate(() => document.querySelector('.top').getBoundingClientRect().height);
    ok('.top is at most ' + HEADER_MAX + 'px tall at 375 wide', topH <= HEADER_MAX, topH + 'px');

    /* The height above is bought with a fixed 60px day tab, and the cheapest
       way to buy it would have been one ellipsized line — plans/031's draft
       renders showed "Tirón + Cuádri…", and a day tab that will not say
       which day it is has stopped being a day tab.

       Both axes, because .day-t is clamped on both: it wraps, so a switch
       back to nowrap makes scrollWidth exceed clientWidth — but it wraps
       inside -webkit-line-clamp: 2 in a fixed 60px .day with overflow
       hidden, so the axis it actually truncates on is the vertical one, and
       a width-only comparison cannot see it. Measured with a 51-character
       name: scrollWidth 98 == clientWidth 98 while scrollHeight 79 >
       clientHeight 32 (plans/034 fix round 1). Day names run to
       IMPORT_LIMITS.name = 80 characters; two lines hold about 26 at 375
       wide, so the seed plan passing is not the same as the clamp being
       safe. */
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.day-t')]
      .filter(e => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight)
      .map(e => e.textContent + ' ' + e.scrollWidth + 'x' + e.scrollHeight +
                ' in ' + e.clientWidth + 'x' + e.clientHeight));
    ok('the day names are not truncated', clipped.length === 0, clipped.join(', '));

    /* The week strip left the header for a panel behind #weekBtn, and a
       disclosure that discloses nothing is how a whole screen goes missing.
       Both halves: hidden to start with, and the strip really there after
       the tap. */
    ok('the week strip starts folded away', await page.locator('#weekPanel[hidden]').count() === 1);
    await openWeeks(page);
    const strip = await page.evaluate(() => ({
      hidden: document.getElementById('weekPanel').hidden,
      weeks: document.querySelectorAll('#weeks .wk').length,
      goal: (document.querySelector('.banner-r') || {}).textContent || '',
    }));
    ok('the week row opens the strip', !strip.hidden && strip.weeks >= 1 && strip.goal.length > 0,
       JSON.stringify(strip));
    await page.click('#weekBtn');   /* back to folded, for the probes below */
    await page.waitForSelector('#weekPanel[hidden]', { state: 'attached', timeout: 4000 });

    // 2. every control at least 24x24 outside a sheet (SC 2.5.8); the set
    //    row's own inputs and ticks held to a stricter, already-met floor.
    const undersized = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('button, input, select').forEach(el => {
        if (el.closest('.sheet') || el.getClientRects().length === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width >= 24 && r.height >= 24) return;
        /* No exceptions left to make. The 24x20 order arrows that used to
           need SC 2.5.8's spacing exception are gone — plans/036 moved them
           into the card's "⋯" menu, where they are 48px rows — so anything
           under 24x24 here is a real failure. */
        bad.push(el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return bad;
    });
    ok('every visible button/input/select outside a sheet is at least 24x24',
       undersized.length === 0, undersized.join(', '));

    const shallowSetRow = await page.evaluate(min => {
      const bad = [];
      document.querySelectorAll('.set-row input, .tick, .drop-add').forEach(el => {
        if (el.getClientRects().length === 0) return;
        const h = el.getBoundingClientRect().height;
        if (h < min) bad.push(el.className + ' ' + Math.round(h) + 'px');
      });
      return bad;
    }, SET_ROW_MIN);
    ok('the set row\'s boxes, ticks and ↓ are at least ' + SET_ROW_MIN + ' tall',
       shallowSetRow.length === 0, shallowSetRow.join(', '));

    // 3. focus never ends up entirely under the sticky header (WCAG 2.4.11,
    //    failure F110) — from the third card's first tick, the same probe
    //    plans/031 measured by hand.
    const thirdTick = page.locator('.ex').nth(2).locator('.tick').first();
    await thirdTick.scrollIntoViewIfNeeded();
    await thirdTick.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab');
    const probe = await page.evaluate(() => {
      const el = document.activeElement;
      const r = el.getBoundingClientRect();
      return { cls: el.className, bottom: r.bottom, topBottom: document.querySelector('.top').getBoundingClientRect().bottom };
    });
    ok('focus after 12x Shift+Tab from the third card is not entirely under .top',
       probe.bottom > probe.topBottom, JSON.stringify(probe));

    // 4. the day tabs are drawn in --ink, not the UA default <button> colour
    //    a dark-system browser would otherwise supply through color-scheme.
    const dayColour = await page.evaluate(() => {
      const dayColor = getComputedStyle(document.querySelector('.day:not(.on) .day-t')).color;
      const inkVar = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
      // Normalise --ink to the same rgb() form getComputedStyle reports, via
      // a scratch element — direct CSSOM assignment, not the style="" the
      // CSP's style-src blocks (AGENTS.md, "The CSP").
      const scratch = document.createElement('div');
      scratch.style.color = inkVar;
      document.body.appendChild(scratch);
      const inkColor = getComputedStyle(scratch).color;
      scratch.remove();
      return { dayColor, inkColor };
    });
    ok('an unselected day tab uses --ink, not the OS scheme\'s default button colour',
       dayColour.dayColor === dayColour.inkColor, JSON.stringify(dayColour));

    // 5. the safe-area padding is genuinely declared, not just inert at 0px
    //    the way it renders here with no inset to resolve.
    const timerPad = await page.evaluate(() => getComputedStyle(document.querySelector('.timer')).paddingBottom);
    ok('.timer has a paddingBottom length declared (0px is correct with no inset)', /^-?\d/.test(timerPad), timerPad);
    const cssText = await page.evaluate(() => fetch('css/style.css').then(r => r.text()));
    ok('css/style.css declares safe-area-inset-bottom', cssText.includes('safe-area-inset-bottom'));
    /* Not merely that the string is in the file — .top's own padding-top
       already puts safe-area-inset-top in it, so the only form of this
       check that guards anything is that the scroll-padding-top
       *declaration* carries the inset too. Without it, .top is 177-192px on
       a notched phone against a flat 140px reserved band, and a focused
       control lands 37-52px underneath it: F110 again, on exactly the
       devices plans/032's safe-area work was for (plans/034 fix round 1).
       The computed value is read as well, because a calc() malformed enough
       to be dropped would leave the source string in place and the rule
       gone. */
    const scrollPadTop = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
    ok('scroll-padding-top reserves the header plus the top safe-area inset',
       /scroll-padding-top:\s*calc\([^;]*safe-area-inset-top/.test(cssText) && /^\d/.test(scrollPadTop),
       scrollPadTop);

    await ctx.close();
  });

  // ---------- the bar's fourth destination and the card's "⋯" (plans/036, plans/037) ----------
  /* Three paths the shell rework left with no assertion in either suite:
     the one hub row that must keep its hub up (data-keep-open — "Tema"
     cycles in place and has to still be there to show what it cycled to),
     the "⋯" rows that hand the keyboard into the fold and open the
     calculator, and Sesión itself. Plus the keyboard each set box asks the
     phone for — the one thing about the boxes headless Chromium can still
     see (js/app.js, "text + inputmode rather than type=number"). */
  await section('la barra y el menú de la tarjeta (plans/036, plans/037)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);

    // 1. data-keep-open: "Tema" leaves the hub up; every other row puts it away.
    //    closeSheet() and applyTheme() both run synchronously inside the
    //    click handler (js/app.js), so there is nothing to wait on here —
    //    the existing theme cases at :695-696 read data-theme the same way,
    //    right after the click (plans/008 item 21: a condition or nothing,
    //    never a fixed sleep).
    await openHub(page, 'more');
    await page.click('#themeBtn');
    ok('"Tema" leaves the Más hub up (data-keep-open)', await page.locator('#moreSheet.up').count() === 1);
    await page.click('#settings');
    await page.waitForSelector('#setupSheet.up', { timeout: 4000 });
    ok('...and "Ajustes" closes the hub on its way to the settings sheet',
       await page.locator('#moreSheet.up').count() === 0 && await page.locator('#setupSheet.up').count() === 1);
    await page.click('#setupClose');
    await page.waitForSelector('#setupSheet.up', { state: 'hidden', timeout: 4000 });

    // 2. Sesión: back to the top of the day. Neither scrollTo nor
    //    $('main').scrollIntoView() (js/app.js) asks for smooth scrolling —
    //    css/style.css sets no scroll-behavior — so each is a same-tick
    //    jump; waiting on the scroll position itself is both correct and
    //    faster than a guessed sleep.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 4000 });
    const before = await page.evaluate(() => window.scrollY);
    await page.click('#navSession');
    await page.waitForFunction(prev => window.scrollY < prev, before, { timeout: 4000 });
    const after = await page.evaluate(() => window.scrollY);
    ok('Sesión scrolls the day back up', before > 0 && after < before, before + ' → ' + after);
    ok('...and is the current page in the bar', await page.getAttribute('#navSession', 'aria-current') === 'page');

    // 3. "Ajustes de máquina" from the "⋯" hands the keyboard into that card's fold
    await openExMenu(page, 0);
    await page.click('#exMenuSetup');
    await page.waitForSelector('#exMenuSheet.up', { state: 'hidden', timeout: 4000 });
    const setupFocus = await page.evaluate(() => {
      const card = document.querySelector('.ex');
      const fold = card.querySelector('.ex-more');
      const el = document.activeElement;
      return { open: !fold.hidden, focused: !!el && el.classList.contains('ex-setup-in') && card.contains(el) };
    });
    ok('"Ajustes de máquina" opens the first card\'s fold', setupFocus.open, JSON.stringify(setupFocus));
    ok('...and puts the keyboard in that card\'s settings box', setupFocus.focused, JSON.stringify(setupFocus));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    // 4. "Calculadora" from the "⋯"
    await openExMenu(page, 0);
    await page.click('#exMenuCalc');
    await page.waitForSelector('#calcSheet.up', { timeout: 4000 });
    ok('"Calculadora" from the menu opens the calculator sheet', await page.locator('#calcSheet.up').count() === 1);
    await page.click('#calcClose');
    await page.waitForSelector('#calcSheet.up', { state: 'hidden', timeout: 4000 });

    // 5. the keyboard each box asks for — counted first, so a renamed class fails here and not vacuously
    const boxes = page.locator('.ex').first().locator('.set-row input');
    const modes = await boxes.evaluateAll(els =>
      els.map(e => e.className + ':' + e.inputMode + (e.maxLength > 0 ? ':' + e.maxLength : '')));
    ok('every set row asks for a number pad: weight decimal, reps numeric, RIR numeric and one digit',
       modes.length >= 3 && modes.length % 3 === 0 &&
       modes.every((m, i) => m === ['w-in:decimal', 'r-in:numeric', 'rir-in:numeric:1'][i % 3]),
       modes.join(' '));

    await ctx.close();
  });

  if (browser) await browser.close();
  if (LIST) process.exit(0);
  if (wanted.length && !ran) {
    console.error('smoke: no section matches --only ' + JSON.stringify(ONLY) + ' — see --list');
    process.exit(2);
  }
  console.log('\n----------------------------------------');
  console.log(pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' sections skipped by --only' : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
