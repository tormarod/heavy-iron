# Plan 075: The contrast check reads every text-on-background pair the stylesheet declares, in all six palettes, and no text colour goes unchecked

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/075-contrast-pairs`). Tests and docs only — **no**
> `CACHE_VERSION` bump; do not touch `sw.js`, `js/`, `css/`,
> `index.html`. If a newly checked pair fails, that is a design question
> about `css/`: STOP and report the pair, its ratios and its selectors.
>
> **Drift check (run first)**: `git diff --stat dfa29a9..origin/main -- test/unit.js AGENTS.md css/style.css`
> — plans 074, 076 and 077 edit `test/unit.js` and AGENTS.md in other
> places. Re-find each excerpt by its quoted text; a changed meaning is a
> STOP.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (test code and one doc paragraph)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `dfa29a9`, 2026-09-23 — the maintainer asked for
  the topics plan 072 had set aside to be done after all

## Why this matters

The unit section "css tokens keep WCAG contrast" computes the contrast of
colour-token pairs straight from `css/style.css`, but only the pairs it
names by hand. AGENTS.md now says so ("a new pair is checked only once it
is added there"). So a new rule that puts a text colour on a background
is unchecked until someone remembers to add it. Reading the stylesheet at
`dfa29a9` shows this already happened: 16 distinct pairs are declared
*together in one rule* (a `color:` and a `background:` on the same
element, so the text certainly sits on that background), and six of them
appear nowhere in the named list:

| Pair (text on background) | Light | Dark | e.g. |
|---|---|---|---|
| `--ink` on `--paper` | 16.06 | 16.73 | `body` |
| `--card` on `--ink` | 17.96 | 15.28 | `.profile-btn.on` |
| `--amber-ink` on `--amber-soft` | 5.25 | 6.59 | `.ex-parked` |
| `--ink` on `--sunk` | 14.82 | 13.45 | `.set-row input` |
| `--danger` on `--sunk` | 4.98 | 5.45 | `.recovery pre` |
| `--edge` on `--card`, **as text** | **3.57** | **3.20** | `.tick` |

All pass 4.5:1 but the last. `.tick` is the set's tick button. Unticked,
it shows its "✓" at 18px in `--edge`, the control's border colour. That
glyph is the icon of a toggle button, which WCAG 1.4.11 (non-text
contrast) holds to 3:1, and 3.57/3.20 pass that. The existing named check
holds `--edge` to 3:1 only as a border. The pair is worth an explicit,
reasoned entry, not an accident of which list it is in.

The accent palettes (`#app.profile-azul`/`-verde`, light and dark)
override `--signal`, `--signal-soft` and, in dark verde, `--on-signal`.
Three of the derived pairs involve those tokens. Checked by hand, all pass
in every palette (lowest: `--signal` on `--sunk`, 4.53, light azul). Today
only `--on-signal` on `--signal` is checked per accent.

## The decisions (settled — do not re-open)

1. **Every same-rule pair is checked.** Every rule in `css/style.css`
   (block comments stripped) that declares both a text colour
   `color: var(--A)` and a background `background: var(--B)` or
   `background-color: var(--B)` yields the pair A on B. A rule's own
   background is certainly behind its own text. Each distinct pair is
   checked at **4.5:1 in all six palettes**: light, dark, and each with
   the azul and the verde override merged over it. Take the overrides
   with the section's own `profileOverride` patterns. The dark palette is
   the light tokens with the dark block merged over them, because the
   dark block does not redefine every token. One `ok` per pair, named
   `'declared pair --A on --B (… selectors …) is >= T:1 in every palette'`,
   with the worst palette and ratio as the diagnostic.
2. **Exceptions are a table, with a reason each.** A pair checked at a
   different threshold goes in a `DECLARED_PAIR_EXCEPTIONS` table in the
   section, keyed by the selector and the pair, with the threshold and a
   one-line reason. It starts with exactly one entry: `.tick` —
   `--edge` on `--card`, 3:1, "the unticked ✓ is the toggle's icon: WCAG
   1.4.11 non-text contrast". Key by selector, so that a new rule using
   `--edge` as real text on `--card` fails. Also assert that every
   exception still matches a declared pair, so a stale entry fails.
3. **A background that is not an opaque colour fails loudly.** If a
   declared pair's background token is translucent (`rgba`), or missing
   in a palette, the pair's assertion FAILs with a message saying to add
   it to the named checks with the surface it sits on. None does at
   `dfa29a9`.
4. **No text colour goes unchecked.** Every token used as `color:
   var(--T)` anywhere in `css/style.css` must be the foreground of a
   declared pair (decision 1) or appear in a `NAMED_FOREGROUNDS` list:
   the foregrounds the hand-written checks already cover (`soft`,
   `amber-ink`, `edge`, `ink`, `on-signal`, `signal`, `on-share`,
   `share-ink`, `timer-ink`, `timer-dim`, `flare`, `danger`). One
   assertion, listing any token that is in neither. At `dfa29a9` the text
   colours are `soft`, `ink`, `signal`, `amber-ink`, `danger`,
   `on-signal`, `on-share`, `timer-dim`, `timer-ink`, `card`,
   `share-ink`, `edge` and `flare`, all covered.
5. **The named checks stay as they are**, assertion names and all. They
   carry the pairs a rule cannot show: text whose background comes from
   an ancestor.
6. **AGENTS.md says what is checked now**: the checklist's "A style" line
   and § "The CSP"'s colour paragraph. Both say a declared pair is
   checked with no list to update, and that a new text colour needs a
   declared pair or a named check.

## Current state

`test/unit.js:263-363` — the section. Its helpers: `tokenMap(blockSrc)`
(hex or rgba tokens of a block), `luminance(hex)`, `over(token, bgHex)`
(composites a translucent colour), `contrast(fg, bgHex)`. It also defines
`lightTokens` (`:root`), `darkTokens` (`:root[data-theme="dark"]`, the
dark block alone) and `profileOverride(selectorPattern)`, which throws if
the rule is not found. It is used with four patterns:

```js
[
  ['light azul', '#app\\.profile-hombre, #app\\.profile-azul', lightTokens],
  ['light verde', '#app\\.profile-mujer, #app\\.profile-verde', lightTokens],
  ['dark azul', ':root\\[data-theme="dark"\\] #app\\.profile-hombre,\\s*:root\\[data-theme="dark"\\] #app\\.profile-azul', darkTokens],
  ['dark verde', ':root\\[data-theme="dark"\\] #app\\.profile-mujer,\\s*:root\\[data-theme="dark"\\] #app\\.profile-verde', darkTokens],
].forEach(([label, pattern, base]) => { … on-signal on signal … });
```

The named checks run inside
`[['light', lightTokens], ['dark', darkTokens]].forEach(([label, t]) => { … })`,
lines 295-338. Note that `darkTokens` there is the dark block alone. The
tokens it names are all redefined in it, so the named checks work. The
declared pairs need the merged palette of decision 1.

`css/style.css` — the rule shapes to parse. Declarations are
`prop: value;` inside `selector { … }`, and there are no nested blocks
besides `@media`, whose inner rules the same `([^{}]+)\{([^{}]*)\}` scan
reads. Example (`css/style.css:626`):

```css
.tick {
  height: 52px; width: 100%; padding: 0;
  border: 2px solid var(--edge); background: var(--card);
  border-radius: 3px; cursor: pointer; font-family: var(--font-sans);
  font-size: 18px; color: var(--edge);
  …
}
```

A scan that works (it is how the table above was made): strip `/* … */`,
then for each `([^{}]+)\{([^{}]*)\}` match take
`/(?:^|;)\s*color:\s*var\(--([\w-]+)\)/` and
`/(?:^|;)\s*background(?:-color)?:\s*var\(--([\w-]+)\)/` from the body.
The `(?:^|;)` keeps `border-color:` from matching as `color:`. Include
`@media` inner rules. The `:root` token blocks declare no `color:`, so
they add nothing.

AGENTS.md, the checklist line:

```
- **A style** — a class in `css/style.css`, never a `style` attribute; a
  value computed at runtime through a CSSOM property; `--edge` for control
  borders, `--line` for dividers, `--amber-ink` for amber text. Held by unit
  "css tokens keep WCAG contrast" for the pairs it names (a new pair only
  once it is added there), and by smoke "main session" and "accesibilidad:
  reduced motion y CSP sin unsafe-inline", which fail on a CSP violation on
  the screens they open. → [The CSP](#the-csp)
```

and § "The CSP", second paragraph ("Colour tokens follow a similar
one-place rule: …", ending "A new pair is checked only once it is added
there.").

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit | `node test/unit.js` | `0 failed` |
| Syntax | `node --check test/unit.js` | exit 0 |
| CR check | `node -e "for (const f of ['test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `test/unit.js` (the contrast section only), `AGENTS.md`
(the two passages above), this plan's Maintenance notes.

**Out of scope**: `css/style.css` and everything else shipped; the named
checks' names and thresholds; every other AGENTS.md line (plans 074, 076
and 077 edit other sentences at the same time).

## Git workflow

`git fetch origin && git checkout -B claude/075-contrast-pairs --no-track origin/main`;
plain-sentence commit subjects; no bump.

## Steps

### Step 1: the palettes and the declared pairs

After the accent loop (the section's end), add:
1. `palettes`: six named token maps, as decision 1 says. Build the
   accent ones with `profileOverride` (the same four patterns), merged
   over the right base.
2. The scan of `css/style.css` for declared pairs: selectors kept per
   pair, for the diagnostic.
3. `DECLARED_PAIR_EXCEPTIONS` with its one entry (decision 2).
4. One `ok` per distinct pair (decision 1), each at the exception's
   threshold if a matching entry exists, else 4.5.
5. The "every exception still matches a declared pair" assertion, and
   decision 3's handling.

A comment above says why: the named checks miss a pair nobody added; a
rule's own background is certainly behind its own text; the table
(plans/075) lists the six that were unchecked, and why `.tick` is 3:1.

**Verify**: `node test/unit.js` → `0 failed`, with 16 declared-pair
assertions (count the lines containing `declared pair`) plus the
exceptions assertion. If any declared pair other than `.tick`'s fails:
STOP (see below).

### Step 2: coverage of text colours

Add `NAMED_FOREGROUNDS` beside the named checks, with the list in decision
4, and one assertion: every `color: var(--T)` token in `css/style.css` is
a declared-pair foreground or in `NAMED_FOREGROUNDS`, with the uncovered
ones as the diagnostic.

**Mutation checks** (report each):
- in a scratch copy of the stylesheet string only (do not edit
  `css/style.css`: change the test's input, e.g. append
  `.x { color: var(--edge); background: var(--sunk); }` to the string the
  scan reads, behind a temporary line): the new pair `--edge` on
  `--sunk` FAILs at 4.5. Revert;
- remove `.tick` from `DECLARED_PAIR_EXCEPTIONS` → `.tick`'s pair FAILs
  at 4.5 (3.57/3.20). Revert;
- append `.y { color: var(--line); }` to the scanned string → the
  coverage assertion FAILs, naming `line`. Revert.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 3: AGENTS.md

Per decision 6, in the file's voice:
- The checklist line: "Held by unit "css tokens keep WCAG contrast": every
  pair a rule declares together is checked in all six palettes, the named
  pairs cover text on an ancestor's background, and a new text colour
  needs one or the other" (fit it to the line's style).
- § The CSP, the colour paragraph: say what is checked (declared pairs,
  the six palettes, the named pairs, the exception table and its reason),
  replacing "A new pair is checked only once it is added there."

**Verify**: `node test/unit.js` → `0 failed` (the link check included);
CR check `0`; `git diff --stat origin/main` shows only `test/unit.js`,
`AGENTS.md` and the plan.

## Test plan

Steps 1–2: the declared-pair assertions (16 at `dfa29a9`), the exception
table's assertion, the coverage assertion, and three mutation checks.

## Done criteria

- [ ] every declared pair is checked in six palettes; `.tick` at 3:1 by
      its table entry; all pass
- [ ] the coverage assertion passes and fails under its mutation
- [ ] AGENTS.md's two passages describe the new checks
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; no `css/`, `js/` or
      `sw.js` change

## STOP conditions

- A declared pair other than `.tick`'s fails its threshold in any
  palette. That is a real contrast defect, and fixing it changes
  `css/style.css` (a design decision and a bump). Report the pair,
  palette, ratio and selectors.
- `profileOverride` cannot find one of the four accent rules.
- The scan finds fewer than 16 distinct declared pairs (it is missing
  rules) or more than 16 (the stylesheet changed since this plan). Report
  the list either way before going on.

## Maintenance notes

- A new rule that sets `color:` and `background:` together needs nothing
  more: its pair is checked. Text on an ancestor's background needs a
  named check, and the coverage assertion catches a text colour that has
  neither.
- *(Executor: record deviations here.)*
