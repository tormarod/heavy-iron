# Heavy Iron

A training log for two people: each follows a block of weekly sessions and
logs every set they do. These are the words the code and the guide use for
that record.

## The record

**Profile**:
One person's whole record: their blocks, everything logged against them,
and their preferences. There are exactly two.
_Avoid_: user, account

**The profile's record**:
Everything a profile keeps about what happened, beside its blocks: the
sets logged, and for each session its note, energy, order and objetivo
record, plus each exercise's variants. The legacy one-chip RIR is part of
it until every value has been folded onto the sets.
_Avoid_: record (alone, which reads as the RÉCORD badge, a best set),
parallel maps, profile maps

**Block**:
A training plan of a fixed number of weeks, made of days, each day made of
exercises with a set count and a rep range.
_Avoid_: program, mesocycle, plan (for the whole thing)

**Plan draft**:
The copy of a block being changed in the plan editor. Nothing in it
reaches the block or the profile's record until it is saved, and closing
without saving throws it away.
_Avoid_: edit buffer, pending plan

**Retired**:
An exercise or day taken out of the plan that still has sets logged
against it. It is out of the session, but its sets are kept, and it can
be restored exactly where it was.
_Avoid_: archived, hidden, deleted (which a retired item is not)

**Slot**:
One day of one week of a block, the place everything logged for that
day is filed under.
_Avoid_: key, day-week

**Set**:
One row logged against an exercise in a slot: a weight, a rep count,
whether it was ticked done, and optionally its RIR and drops.
_Avoid_: row (in prose), entry

**Working set**:
A set that was ticked done and has both a weight and a rep count. It is
what the objetivo reads and what an RIR belongs to.
_Avoid_: valid set, counted set, done set

**Session**:
Everything one lift was logged with in one slot: its sets, in order. A
lift planned on two days of the same week has two sessions that week.
_Avoid_: workout (for one exercise), entry

**Session date**:
The median of the times a session's sets were ticked, so a set ticked
days later from memory does not move it.
_Avoid_: session timestamp, last ticked

**Session start**:
The moment a lift's slot first holds something the lifter put there, a
typed value or a tick. That is when the objetivo on screen is kept, and
browsing a day without touching it never starts one.
_Avoid_: first tick, session open

**Extra set**:
A set logged beyond the number of sets the plan now asks for. It is kept
and still counts as lifted, but the exercise card hides it.
_Avoid_: parked set (in prose), overflow set

**Session note**:
Free text written about one slot: how the day went, not how one lift did.
_Avoid_: comment, exercise note

**Energy**:
How the lifter arrived at a slot, one of low, normal or high, asked
before the session starts. Context only; no estimate reads it.
_Avoid_: readiness, mood

**Session order**:
The order a slot's exercises were actually done in, kept only when it
differs from the plan's.
_Avoid_: exercise order (which is the plan's), sequence

**Objetivo record**:
The objetivo that was on screen for a lift in a slot, kept once the
session starts and never rewritten, so the rule's advice can later be
told apart from what was done.
_Avoid_: target history, obj (in prose)

**Variant**:
A name an exercise has had, with the date it started. Sets logged before
the current variant began stop feeding its objetivo.
_Avoid_: rename, alias

**Lift**:
The exercise a session belongs to. It is normally matched by the
exercise's id. The prior-block band matches by id and then by name, and
"last time" only looks at the same day.
_Avoid_: movement

**Deload week**:
A week the block prescribes lighter work in, whether it was set as the
block's deload week or written into the phase text by hand. A goal that
says there is no deload ("sin descarga") does not make one. Screens that
look for a trend leave it out; screens that show what happened keep it.
_Avoid_: descarga (in code comments), rest week

**Deload span**:
Consecutive deload weeks, taken as one deload. Whether a deload worked is
read from the week before the span to the week after it.
_Avoid_: deload block, double deload

**Stranded week**:
A week logged in a block that has since been shortened below it. Its sets
are kept, not deleted, and come back if the block is lengthened again.
Screens about the block hide them; screens about the lifter over time
(the objetivo, the Diagnóstico's rows per exercise, records, the
all-blocks chart) and the CSV export count them.
_Avoid_: orphaned week, beyond-end week
