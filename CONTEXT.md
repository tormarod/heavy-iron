# Heavy Iron

A training log for two people: each follows a block of weekly sessions and
logs every set they do. These are the words the code and the guide use for
that record.

## The record

**Profile**:
One person's whole record: their blocks, everything logged against them,
and their preferences. There are exactly two.
_Avoid_: user, account

**Block**:
A training plan of a fixed number of weeks, made of days, each day made of
exercises with a set count and a rep range.
_Avoid_: program, mesocycle, plan (for the whole thing)

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

**Extra set**:
A set logged beyond the number of sets the plan now asks for. It is kept
and still counts as lifted, but the exercise card hides it.
_Avoid_: parked set (in prose), overflow set

**Lift**:
The exercise a session belongs to. It is normally matched by the
exercise's id. The prior-block band matches by id and then by name, and
"last time" only looks at the same day.
_Avoid_: movement

**Deload week**:
A week the block prescribes lighter work in, whether it was set as the
block's deload week or written into the phase text by hand. Screens that
look for a trend leave it out; screens that show what happened keep it.
_Avoid_: descarga (in code comments), rest week

**Stranded week**:
A week logged in a block that has since been shortened below it. Its sets
are kept, not deleted, and come back if the block is lengthened again.
Screens about the block hide them; screens about the lifter over time
(the objetivo, records, the all-blocks chart) and the CSV export count
them.
_Avoid_: orphaned week, beyond-end week
