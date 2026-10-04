# Plan 083: What a tick took is on the rest timer at every width, with −1/+1 for the reps

Picked by the maintainer from the twelfth pass (`plans/README.md`, "Twelfth
pass", shortlist #2, defect D2) and built directly, without a separate
executor. This file records what was decided and why.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW (one new row on the timer; the write is the existing `writeRows`)
- **Depends on**: none (lands after 082 on the same branch)
- **Planned and built at**: `3b7eddb` (v150), 2026-10-04; ships in v151

## Why this matters

Since a311fa4 a tick takes the objetivo's reps as well as its weight, and
the objetivo asks each set one rep more than its best. A lift ticked as
shown therefore climbs a rep a week whatever was lifted: the log is only as
good as the ticks are honest. The one check on that is the note saying
what the tick took — "cámbialo si no fue eso" — and on a phone it was never
on screen:

- plans/080 C put it in `.timer-msg`, the coaching line, which is
  `display: none` below 620px (`css/style.css`, the phone media query);
- its copy in the status line at the foot of the page is replaced by
  "Guardado" when the save lands 400ms later.

The household logs on two phones.

## What changed

- **A row of its own on the timer**, `#ttook`, under the count and above
  the progress bar, shown at every width. The coaching line keeps the
  breathing tip, so `startRest` no longer takes a note (`js/rest-timer.js`);
  an older `app.js` that still passes one has it ignored.
- **−1 rep / +1 rep** (`#trepMinus`, `#trepPlus`) on that row, when the
  tick took the reps. Each press:
  - writes the set through `writeRows`, like a typed number, and redraws
    the card;
  - then says what is logged now: "Serie 1 anotada con 70 kg × 9 y RIR 1
    — corregido".

  It stops at 1 (a set of none is not a working set to any reader) and at
  99, and the button at a limit is disabled.
- **A press is for the set on screen.** `tookLive` checks that the row
  object is still the one on the card, still ticked, and that the rest is
  still up. Otherwise it writes nothing and hides the buttons. An undo, a
  write from another tab, or a move to another session therefore makes it
  inert.
- **The toast stands higher on a phone while the row shows**
  (`.timer.up.took ~ .toast`, 225px). Without that it would cover the
  timer's controls.
- `docs/guide.md` describes the row and the two buttons, in the controls
  table, in the timer paragraph, and under "The weight box already knows".

## Decisions

1. **Only the reps get buttons.** They are the number the objetivo climbs
   from. The weight is the grey number you saw before you ticked, and the
   RIR feeds no target. The row still names all three.
2. **The logic lives in `js/app.js`, not `js/rest-timer.js`.** The buttons
   write the log, and the row is set or cleared by every tick rather than
   by the rest's end. So no symbol crosses between the two files, and the
   new ids are read only in `app.js`: AGENTS.md's split rules and id rule
   need nothing.
3. **No row for a tick that starts no rest.** That is a superset's first
   exercise (`rest: 0`) and the day's last set (plans/080 D). Their
   numbers are in the boxes the thumb just tapped, which no timer covers.
   A toast for every superset tick was the alternative, and it would have
   been noise.

## Measurements

Chromium, with Barlow loaded, on the shipped plans:

| Width | Timer without the row | Timer with the note and −1/+1 |
|---|---|---|
| 320 | 137 px | 212 px (the note wraps to four lines) |
| 360–430 | 137 px | 196 px |
| 621 | 147–188 px | 242 px for "Elevaciones laterales en polea" |
| 768 | 147–172 px | 226 px for "Elevaciones laterales en polea" |

`#app`'s 250px reserve and `scroll-padding-bottom` still clear all of
these, with 8px to spare at 621. The CSS comments carry the numbers.

## Tests

- **`test/unit.js`, booted.**
  - The three plans/080 C assertions read the note from `#ttookMsg` now.
  - The "nothing adopted" case also checks that the row is hidden.
  - A new section, "what a tick took, on a row of the rest timer, and its
    reps a tap either way (plans/083)", presses the real buttons. It
    covers the row and the buttons' labels; −1 writes only the reps and the
    save carries it; the card is redrawn; the "corregido" line; +1; the
    floor at 1 with the button disabled; reps typed before the tick give
    no buttons; untick clears the row, and a press after it writes nothing;
    a press after moving week writes nothing.
- **`test/smoke.js`, "layout".** At 375, 412 and 768 the row is on screen,
  its buttons are 44px tall and inside the viewport, and −1 reaches the
  set's own rep box. With `.timer-took { display: none }` added under the
  phone breakpoint, the 375 case fails, which is the original bug.
- **Smoke sections run**: "layout", "Main session", "accesibilidad: tamaños,
  foco y área segura", "la barra y el menú de la tarjeta", "accesibilidad:
  reduced motion y CSP sin unsafe-inline" — 287 passed.

## Maintenance notes

- The twelfth pass's #3, a per-row record of which numbers a tick filled
  in, is still open and still needs the maintainer's decision. This plan
  makes a guess visible and cheap to correct; it does not make the log
  able to tell a guess from a report afterwards.
- If the row's text changes, re-measure the timer at 320 and at 621 with
  the longest shipped name, and update the three numbers in
  `css/style.css`: `#app`'s reserve, the phone toast offset, and the toast
  comment.
