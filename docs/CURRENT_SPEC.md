# Current behaviour: a short, build-linked specification

Design handover of 23 Nov 2026, item 31. What the simulator on `main` does now, in one page, for a contributor who
needs the current behaviour and its remaining uncertainty. It describes the build at the commit that last changed this
file; `tests/sim/currentSpec.test.ts` fails if the figures and switches named here stop matching the code. Historical
reports describe earlier builds (docs/README.md says which is which).

## Evidence words

Every claim of evidence names its kind, method, date and build:

- **Software check**: an automated test in this repository (named), run on the build in question. It shows the
  software does what is described, not that it teaches or is realistic.
- **Sailor review**: a named reviewer, the date, the build reviewed and what they looked at. None recorded yet.
- **Measurement**: a method, a date and a build (for example `npm run perf`, or a device check report).
- **Learning evidence**: observed learners or instructors, the task and the method. None recorded yet.

Nothing in the simulator is validated against a real Squib, and no RYA, class or club approval is claimed beyond the
RDYC's approval of its name and burgee (20 Nov 2026).

## Activities and what "done" means

- **Lessons**: complete only when every step with a goal was sailed in one run. Skipping moves on and is recorded as
  skipped ("end reached", the steps named, Try again). No lesson time is shown or kept. Records from before 23 Nov 2026
  stay done, marked as earlier records.
- **Exercises**: an attempt is **independent** with no auto-trim, teaching overlay or live help at any time, and
  **assisted** otherwise (auto-crew and input adaptations do not count). Support is also described against the
  exercise's task. Every review message names its telemetry basis, with a cause only when its preconditions were
  recorded (docs/COACHING_INVENTORY.md). An optional acknowledgement for a clean tack (entry floor 3.4 kn, E) shows
  at the end by default; it can be set to after each attempt or off.
- **Learn map**: a tick records an activity done in this browser, not a certificate. "Back to it" resumes the activity
  under way; "Start again" restarts.

## Racing

- **Judge**: rules 10–13 and 31; a simplified rule 18.2 only with mark-room penalties switched on (off by default).
  A finding that rule 15, rule 16 or an advisory rule 18 could change is labelled provisional; the penalty stands.
  Before the preparatory signal Part 2 applies, but a boat not racing is not penalised. docs/RACING.md has the scope
  table. Wording is paraphrased from secondary sources, awaiting a rules reviewer.
- **Personal bests**: an ordinary race's best is kept per identity (course and shape, laps, wind band, fleet size,
  boat, spinnaker, rules version, assistance). Older times are shown as other conditions. The weekly course and
  today's challenge use their own keys under rules version r2.
- **After a race**: one observation from the coach, then Race it again (the same race), Choose another activity or
  Sail freely (the raceRetry switch).
- **Laylines**: drawn only in still water (stream under 0.3 kn at the boat and the mark), as approach lines with no
  allowance for stream or leeway; hidden elsewhere, with the reason.
- **Challenges by link**: the card shows duration, set-up, support and whether this build re-sails the ghost exactly.
  A cut-short link points to the replay file.

## Controls and saving

- **Sailing buttons**: pointer press and release; Space or Enter held on a focused button; a single activation (a
  click with no pointer or key behind it) acts for 0.25 s of sailing. Hiding the page or losing the window lets go of
  everything.
- **Saving**: everything is kept in this browser only. A failed save says whether storage is full or blocked, and
  what was not kept. **Progress backup**: Settings → Your progress, format `sailsim-progress` version 1; restoring
  merges and never loses what is here.
- **Device check**: runs between activities only; it says why when it has to wait.

## Feature switches (Settings → Advanced) and their defaults

| Switch | Default |
|---|---|
| Spinnaker | on |
| River data joins a run in progress | on |
| Plain words at Learn | on at the Learn level |
| Learn map | on |
| Mark-room penalties (rule 18, simplified) | off |
| After a race: one observation and Race it again (prototype) | on |

## Releases

Deploy publishes a commit only after its build, unit tests and the critical browser checks (tests tagged
`@critical`) pass on that very build, and publishes that build (docs/DEPLOYMENT.md §3).

## Remaining uncertainty (the main items)

Physics coefficients, the river's provisional layers and the teaching thresholds are estimates (E); the rules wording
awaits a rules reviewer; no real phone, tablet or GPU has been checked; no learner, instructor or sailor session has
been held. docs/STATUS.md and docs/OUTSTANDING_ISSUES.md have the detail.
