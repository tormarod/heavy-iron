# objetivo-sim

A week-by-week simulator for the weekly objetivo, written to decide whether
the rule in `targetFor` (`js/app.js`) helps or hurts, and what should replace
it. Nothing here is loaded by the app or by the test suites.

A simulated lifter trains one exercise through consecutive 8-week blocks of
the shipped "Hombre — Bloque 1" plan (same phase text, same RIR wave, deload
in week 8). Before every session a rule says what to do; the lifter does what
their strength that day allows; the session is logged; the next target is
computed from the log. The `actual` rule is the real `targetFor`, loaded
through `test/harness.js`, not a copy.

```
node tools/objetivo-sim/probe.js      # the real rule on four hand-built histories
node tools/objetivo-sim/compare.js    # every rule, 480 lifters each
node tools/objetivo-sim/trace.js chestpress hybrid none 0.005 3 actual rango
```

`compare.js` takes env vars to narrow or stress the matrix: `EX`, `BEHAVE`,
`LOGS`, `GAIN`, `SEEDS`, `BLOCKS`, `SD`, `CURVE=brzycki`, `RULES`.

## What the lifter is made of

| | value | why |
|---|---|---|
| fatigue between sets | 1 · 0,952 · 0,929 · 0,904 of the first set's capacity | measured on the real chest-press log (`docs/guide.md`) |
| …for a set stopped short of failure | that drop × (1 − 0,15 × its RIR), never under 40 % | a set far from failure costs the next one less |
| reps to failure | Epley; `CURVE=brzycki` swaps in a different truth | the app assumes Epley, so the second is the robustness check |
| day-to-day strength | ±3 % (1 SD) | the usual spread of a trained lifter's daily 1RM |
| strength gain | 1,2 %, 0,5 % or 0 % a week | novice, intermediate, stalled |
| what they do with the number | `target`, `hybrid`, `rir`, `capped` | see `doSet` in `lifter.js` |
| what goes in the RIR box | nothing, or the truth | the box is optional |

## The rules

See the header of `rules.js`. `actualFixed` patches the current rule's two
input bugs from outside; `todas`, `primera`, `rango` and `plan` are
one-weight double progressions that never read the RIR box, and `plan` is
the only one with no Epley anywhere.

## What a real log said that the simulation could not

Replayed against one real backup (one block, 23 load increases), Epley —
which the current rule and `rango` both price steps with — under-read the
reps at the new weight by a median of six; only 2 of the 23 landed within
two reps of it. A step cost the first set one or two reps whatever its
size, from +9 % to +56 %. The simulated lifter is built on Epley, so on
that question the simulation flatters every rule that uses it, and the
real log is the better witness. That is why `plan` exists. The backup
itself is personal data and is not in the repository.
