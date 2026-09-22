# Plan 068: A set's date is the day it was trained, a timestamp no clock can read is refused, and the CSV follows a language preference

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md`.
>
> **Two independent steps, one PR each**: A (`claude/068-a`, timestamps)
> and B (`claude/068-b`, the language preference and the CSV separator).
> Both bump `CACHE_VERSION`. Read the whole plan, execute only your step.
>
> **Drift check (run first)**:
> `git diff --stat c9114bc..origin/main -- js/app.js test/unit.js test/smoke.js docs/guide.md README.md AGENTS.md sw.js`

## Status

- **Priority**: P2
- **Effort**: S each
- **Risk**: LOW (A); LOW–MED (B changes the CSV's format — decided by the
  maintainer, see below)
- **Depends on**: none. Step A owns the `ts` entry of `ROW_FIELDS` (both
  its `accept` and its `cell`); Step B must not touch that entry.
- **Category**: bug (A), feature/format (B)
- **Planned at**: commit `c9114bc`, 2026-09-22 — the tenth audit's
  finding 14 and its recorded `ts` follow-up

## Why this matters

**A — dates.** The CSV's `fecha` is `new Date(r.ts).toISOString().slice(0, 10)`:
the **UTC** day. In Spain (UTC+1/+2) a set ticked between midnight and
01:00/02:00 is exported under the previous date, while every screen of the
app shows the local day. The Diagnóstico already knows this trap
(`js/diagnostics.js`, `dayKey`: "toISOString() would file half your
evening sessions under tomorrow"). Separately, a row's `ts` is accepted on
import when it is merely finite and positive; above 8.64e15 ms (the most a
JavaScript `Date` can hold) `toISOString()` **throws** — in the CSV (the
export silently does nothing) and in `isoDay`, which `migrate()` reaches
through `seedLateralVariants` on every load: a crafted or corrupted `ts`
in storage stops the app from opening.

**B — the separator.** The CSV is comma-separated with decimal commas
quoted (`"22,5"`). Spanish-locale Excel splits a CSV on `;`, so the file
opens as one column. The maintainer decided (2026-09-22): the separator
follows the app's language, and a language preference is wired in now for
the English version to come — **Spanish → `;`, English → `,`** — even though
no language can be chosen on screen yet. Spanish is the default and the
only language the interface speaks; the preference is the hook, and the
CSV is its first reader.

## Current state

All in `js/app.js` unless noted; re-locate by search string.

**The `ts` row field** (search `{ key: 'ts', col: 'fecha',`):

```js
{ key: 'ts', col: 'fecha',
  send: r => (Number.isFinite(+r.ts) && +r.ts > 0 ? +r.ts : undefined),
  accept: raw => {
    const ts = isObj(raw.ts) ? NaN : +raw.ts;
    return Number.isFinite(ts) && ts > 0 ? ts : undefined;
  },
  cell: r => (r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '') },
```

**`isoDay` and its migrate-time caller** (search `const isoDay =` and
`function seedLateralVariants(`):

```js
const isoDay = ts => new Date(ts).toISOString().slice(0, 10);
…
rows.forEach(r => { const t = r && +r.ts; if (t > 0 && (!first || t < first)) first = t; });
…
{ n: now, since: isoDay(first || Date.now()) },
```

`isoDay` is also called by `recordVariant` with `ts || Date.now()` — a
real clock value. Note `variantSince` compares `since` dates as UTC
midnight (`Date.parse(since + 'T00:00:00Z')`) against the rule's session
times; **leave `isoDay` UTC** — changing it would move every rename cut by
a day for evening renames. Only make it safe (below).

**The local day already exists in a split file** (`js/diagnostics.js`,
`dayKey(ts)`): `getFullYear()-MM-DD` from `new Date(ts)`. `js/app.js` may
not read a split file's symbol (AGENTS.md rule 1), and a second top-level
function named `dayKey` would trip the suite's "no top-level declaration
shared by two files" check — so add a new `localDay(ts)` in `js/app.js`.

**The CSV** (search `function csvCell(` and `function buildCsv(`):

```js
function csvCell(v) {
  …
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCsv() {
  …
  /* The BOM is what makes Excel open a UTF-8 CSV without mangling accents. */
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
```

**Preferences** are validated in `migrate()` (search
`if (['auto', 'light', 'dark'].indexOf(state.prefs.theme) < 0)`) and travel
whole in a backup (`BACKUP_FIELDS` in `js/profile-transfer.js` lists
`prefs`), so a new key validated in `migrate()` is kept by a restore with
no change to the restore path.

**Tests that read the CSV with a comma** — every one must move to the
separator the file now uses: `test/unit.js` (search `buildCsv()` —
≈ lines 3498, 4923, 7122, 7535: `split(',')`, `indexOf(',peso,unidad,')`,
the header check) and `test/smoke.js` (search `buildCsv()` — ≈ 1271
"CSV quotes the comma decimal", ≈ 1530 `/bajadas,tipo_bajada/` and
`/45x5,Forzado/`, ≈ 2708 `split(',')` for `orden`). The smoke assertion
"CSV quotes the comma decimal" pinned the old design on purpose; it
becomes "a Spanish CSV leaves the decimal comma bare" (below).

**Docs**: `docs/guide.md` (search `CSV export`, ≈ line 141, and the
"Known limits" bullet `**Spanish only.**`), `README.md` ("Known limits",
`**Spanish only.**`), `AGENTS.md` ("Documented limits",
`**Spanish only.**`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Smoke (B only) | `BASE=http://127.0.0.1:<port> node test/smoke.js --only "main session" --only "orden" --only "bajadas"` — find the exact section names with `node test/smoke.js --list` for the three places listed above | PASS |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope** — A: the `ts` entry of `ROW_FIELDS`, `isoDay`,
`seedLateralVariants`' `first` scan, a new `localDay` and a new
`TS_MAX` constant; `test/unit.js`; `sw.js`. B: `migrate()`'s prefs block
(one line), a small language table, `csvCell`, `buildCsv`; `test/unit.js`,
`test/smoke.js`; the three "Spanish only" bullets and the guide's CSV
sentence; `sw.js`.

**Out of scope**: any visible language control (none yet — the maintainer
will add it with English); translating anything; the CSV's columns, BOM,
line endings or file name; `isoDay`'s UTC semantics; `js/diagnostics.js`'s
`dayKey`.

## Git workflow

`git checkout -B claude/068-<a|b> --no-track origin/main`; plain-sentence
commit subjects with your `Co-Authored-By:` line; bump last.

## Steps

### Step A (PR 1): timestamps

A.1 Add, beside `isoDay`, `const TS_MAX = 8.64e15;` with a comment (the
largest time a `Date` can hold; `toISOString()` throws above it, and every
reader of a row's `ts` turns it into a date) and a helper
`const validTs = t => Number.isFinite(t) && t > 0 && t <= TS_MAX;`.

A.2 `ROW_FIELDS` `ts`: `send` and `accept` use `validTs` (so a restore or
a QR import drops an impossible `ts` instead of storing it); `cell`
becomes `r => (validTs(+r.ts) ? localDay(+r.ts) : '')`.

A.3 `localDay(ts)` in `js/app.js`: the local calendar day,
`YYYY-MM-DD` from `getFullYear()`/`getMonth()`/`getDate()`, with a comment
naming why it is not `isoDay` (a set ticked at 00:30 in Spain belongs to
the day it was trained; `isoDay` stays UTC on purpose for `variantSince`)
and that `js/diagnostics.js` has the same rule as `dayKey` (a split file
`app.js` may not read).

A.4 `seedLateralVariants`: only count `t` when `validTs(t)`.
`isoDay` itself: guard so it never throws — `isoDay(ts)` returns
`isoDay(Date.now())`'s value when `ts` is not `validTs` (write it as
`const isoDay = ts => new Date(validTs(ts) ? ts : Date.now()).toISOString().slice(0, 10);`)
— the callers already fall back to "now".

A.5 Tests (`test/unit.js`, a section `timestamps (plans/068)`):
1. `ROW_FIELDS` accept: `9e15` → dropped; `8.64e15` → kept; `-1`, `'x'`,
   `{}` → dropped (reach it through `rowFromImport` or the part's
   `accept`, the way existing row-codec cases do — search `rowFromImport(`).
2. A profile in storage with one row `ts: 9e15` on `lat1` and the lateral
   raise renamed so `seedLateralVariants` runs → `migrate()` does not throw
   (booted: `bootApp({ state })` boots to a drawn app, not the recovery
   screen — check how existing boot cases detect recovery).
3. The CSV: a row with `ts` = 2026-03-10 00:30 **local** time (build it
   with `new Date(2026, 2, 10, 0, 30).getTime()` inside the app context)
   → its `fecha` cell is `2026-03-10`; a row with `ts: 9e15` in storage →
   `buildCsv()` does not throw and its `fecha` is blank.
Mutations: `cell` back to `toISOString` → case 3's first half FAILs when
the suite runs in a UTC+ timezone. **The suite's timezone is whatever the
machine's is** — so make case 3 independent of it: compute the expected
string inside the context with the same local getters, and assert it
differs from `isoDay(ts)` only when the offset makes them differ (i.e.
assert `cell === expectedLocal`, and separately assert
`localDay(new Date(2026, 2, 10, 0, 30).getTime()) === '2026-03-10'`, which
holds in every zone). Drop `validTs` from `accept` → case 1 FAILs.

**Verify**: `node test/unit.js` → `0 failed`. Bump, PR.

### Step B (PR 2): the language preference and the CSV separator

B.1 In `migrate()`'s prefs block, after the theme line:
`if (['es', 'en'].indexOf(state.prefs.lang) < 0) state.prefs.lang = 'es';`
with a comment: the interface is Spanish only; this is the hook the
English version will read (the maintainer's decision, 2026-09-22), and the
CSV already follows it.

B.2 A small table beside the CSV code:

```js
/* What each language writes a CSV with. A Spanish spreadsheet splits on
   ';' because ',' is its decimal mark — Excel in es-ES opened the old
   comma file as a single column — and an English one splits on ','. */
const CSV_BY_LANG = { es: { sep: ';' }, en: { sep: ',' } };
const csvFormat = () => CSV_BY_LANG[(state && state.prefs && state.prefs.lang) || 'es'] || CSV_BY_LANG.es;
```

B.3 `csvCell(v, sep)`: quote only when the cell contains `sep`, `"`, CR
or LF — a decimal comma in a `;` file is left bare, which is what lets
Spanish Excel read `22,5` as a number. Keep the formula-injection guard
exactly as it is. `buildCsv` joins with `csvFormat().sep` and passes it to
`csvCell`. Update `buildCsv`'s BOM comment only if needed.

B.4 Tests. Move every CSV test listed in Current state to the separator
the file uses — read it from the app (`csvFormat().sep`) rather than
hard-coding `;`, so the tests keep holding when English lands. Replace
the smoke assertion "CSV quotes the comma decimal" with two unit
assertions: with `lang: 'es'` the weight `22,5` appears bare between two
`;`; with `lang: 'en'` the file splits on `,` and `22,5` is quoted.
Add: `migrate()` sets `lang: 'es'` when absent or unknown and keeps
`'en'`; a backup restored with `prefs.lang: 'en'` keeps it.

B.5 Docs. The guide's CSV sentence (≈ line 141): the file is split with
`;`, the way a Spanish spreadsheet expects, so Excel opens it in columns.
The three "**Spanish only.**" bullets (guide, README, AGENTS.md): keep
them true — the interface is Spanish only — and add one clause: a
language preference exists for the English version to come, and the CSV
already follows it. Do not rewrite anything else in those sections.

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed`;
the three smoke sections that read the CSV → PASS (on your port). Bump, PR.

## Test plan

A: three cases, two mutations, timezone-proof. B: the moved CSV
assertions, two separator cases, two `lang` cases, three smoke sections.

## Done criteria

- [ ] A: `grep -n "toISOString" js/app.js` shows no row `ts` being turned
      into a CSV date; `isoDay` cannot throw
- [ ] B: `grep -n "join(',')" js/app.js` no longer finds the CSV join;
      `state.prefs.lang` is validated in `migrate()`
- [ ] `node test/unit.js` → `0 failed`; B's smoke sections pass
- [ ] Each PR bumps `CACHE_VERSION` above `origin/main`'s; only in-scope files changed

## STOP conditions

- A: an existing test pins `fecha` as the UTC day on purpose.
- B: something other than the listed tests parses the CSV (an import
  path, a tool under `tools/`) — list it.
- B: the unit suite has a guard that fails on a new `state.prefs` key
  (search `prefs` near "keeps only" / "BACKUP_FIELDS") — follow what it
  asks, and report if it asks for more than one line.

## Maintenance notes

- When English lands, the language control writes `state.prefs.lang`;
  the CSV needs nothing more. `localDay` is the date to show a person;
  `isoDay` stays the UTC key `variantSince` compares.
- Step A done as PR #180 (`claude/068-a`). No deviations from
  A.1–A.4; the plan's three numbered test cases and its two named
  mutation checks (cell → toISOString, validTs dropped from accept) all
  landed as described. Two additions beyond the minimum, both worth
  knowing about: a direct `isoDay(9e15)` no-throw assertion, and a third
  mutation check (isoDay's own guard reverted alone) that showed its
  fallback and seedLateralVariants' `validTs(t)` scan filter are
  independent layers — reverting either one alone leaves migrate()
  un-thrown because the other still covers it; only reverting both (or
  the direct isoDay assertion) catches a regression in just one. While
  running that extra mutation check by hand, an early version of the
  direct assertion crashed the whole `node test/unit.js` process instead
  of failing cleanly: its diagnostic-message argument (the third argument
  to `ok()`) called the throwing expression a second, unguarded time
  outside `throws()`'s try/catch — JS evaluates all of a call's arguments
  before the call runs, so this happened even though the condition
  argument short-circuited past its own copy of the same call. Fixed by
  computing the diagnostic only on the safe side of the same `throws()`
  check. Worth remembering for any future assertion here that both
  probes a throw and wants to report the thrown value: guard the
  diagnostic exactly as strictly as the condition, not looser.
- Review round 1 on #180 found a second, pre-existing timezone bug this
  plan's own fix exposed rather than caused: `test/unit.js`'s byte-for-byte
  CSV fixture (`csvFixture`, "the CSV: every set ever logged") pinned its
  two ts-bearing rows' `fecha` as the literal `2023-11-14`. Those ts values
  are 22:13:20Z/22:15:00Z, so once `fecha` became the local day the
  literal only held from UTC+1 down — from UTC+2 up (and in zones like
  Tokyo) the local day is already the 15th. Fixed by computing both
  through `call('localDay(...))` instead of hard-coding, each ts
  separately even though the two are only 100 seconds apart (so a later
  edit to one literal can't quietly go stale against the other). Confirmed
  against a real UTC+9 zone before and after (see below), not just argued.
  Landed as its own commit on `claude/068-a`, then a rebase onto
  `origin/main` (which had taken v135 via #178 meanwhile) and a re-bump to
  v136 — `git rebase` correctly dropped this branch's own v134→v135 bump
  commit as a duplicate of main's rather than conflicting on it.
- **This Windows Node build does not honour an IANA zone name in `TZ`**
  (confirmed on `node v24.18.0`): `TZ=Asia/Tokyo` and `TZ=America/Los_Angeles`
  both run `node test/unit.js` to completion with no error and no warning,
  but silently keep the system's own zone (Europe/Madrid here) instead —
  checked directly with `new Date(...).toString()` under each, both came
  back `Central European Standard Time`, identical to no `TZ` at all. A
  bare POSIX offset string (`TZ=JST-9`, `TZ=CET-1`) is also silently
  ignored, falling back to a plain `GMT+0000` instead. Only a short list of
  legacy names is actually honoured: `UTC` (confirmed), `PST8PDT` (real
  UTC-8, stands in for `America/Los_Angeles`) and `Japan` (real UTC+9,
  stands in for `Asia/Tokyo`) among what was tried. Anything here that
  needs a *real* non-UTC, non-Madrid offset to prove a timezone fix on
  this machine should use one of those two rather than the IANA name, and
  should sanity-check the offset it actually got
  (`TZ=<name> node -e "console.log(new Date().toString())"`) rather than
  trust that a run with no error means the zone took effect — the failure
  mode here is silent, not a crash.
- *(Executor: record deviations here.)*
