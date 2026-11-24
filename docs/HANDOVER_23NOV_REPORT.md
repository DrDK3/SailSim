# Design handover of 23 Nov 2026: what was done

The design team's handover ranked 36 recommendations. The owner asked for all of them to be carried out. On scope,
the owner chose "do the feasible part" (23 Nov 2026):

- build and prototype what can be built;
- for investigations, run what software can (reproductions, captures, model sweeps, trials, inventories) and prepare
  kits for the people the rest needs;
- write scoping notes for the conditional projects, to await the owner.

The owner also decided three questions the handover left open:

- **Item 1, the device check:** it runs between activities.
- **Item 3, lessons:** a lesson counts only when the steps were performed. Skipping still moves on, recorded as
  skipped, and introductory lessons give no fastest-time reward.
- **Item 6, race bests:** like with like.

**Evidence in this report is software checks only**, run in a cloud container with software rendering (SwiftShader):

- no GPU, phone or tablet was used;
- no learner, instructor, sailor or rules reviewer took part;
- **no physics changed**, so the golden traces and the behaviour envelope are unaffected;
- every model figure quoted is model output from estimated coefficients, not validation.

The current behaviour in one page: [CURRENT_SPEC.md](CURRENT_SPEC.md). The investigations and kits:
[handover-23nov/INVESTIGATIONS.md](handover-23nov/INVESTIGATIONS.md). Open issues raised: 276–284 in
[OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md).

## Batch 1: the reproduced repairs (items 1–9)

Each problem was first reproduced, then fixed. Each item has tests that fail on `main`.

| Item | What was wrong (reproduced) | What changed | Tests |
|---|---|---|---|
| **1** Protect sessions and saves | The device check ended a race, lesson or exercise in progress (only the scenario came back, restarted); a save that failed (storage full or blocked) failed silently | The device check waits until the activity is over and says why ("Not now: a lesson is under way"). Every progress write goes through `persist`, which records full or blocked and what was not kept; a notice says so, with what to do; existing records stay readable | `tests/sim/saveStatus.test.ts`; e2e `handover.spec.ts` (item 1, both tests; the save test is in the critical set) |
| **2** Controls through every input route | The hold buttons answered only the pointer: Space or Enter on a focused button, or a click from assistive technology or voice control, did nothing; a hidden page left a control held | Space or Enter held on a focused button holds the control (the W3C button pattern); a click with no pointer or key behind it acts for 0.25 s of sailing; blur, a hidden page and a lost window let go of everything | `tests/sim/holdControls.test.ts`; e2e `handover.spec.ts` item 2 (critical) |
| **3** Lesson completion | Skipping every step reached "✓ Lesson complete" and saved a best time | A lesson is complete only when every step with a goal was sailed; otherwise "end reached", the skipped steps named, Try again. No lesson time is shown or kept. Older records stay done, marked as earlier records; a complete run replaces them. The list, the Learn map and "Learn to sail" agree | `tests/sim/lessonCompletion.test.ts`, updated `lessons`, `learnMap`, e2e `ux.spec.ts` (critical) |
| **4** Rules explanations, bounded judging | "Before the preparatory signal: Part 2 did not yet apply" (wrong: it applies, but a boat not racing is not penalised under it); exoneration cited as rule 21 (now rule 43); penalties shown as certain where rules 15 or 16 could change them | Both texts corrected. A finding that rule 15, rule 16 or an advisory rule 18 (pointing at the other boat) could change is **labelled provisional**, in the summary and the protest room; **the penalty stands** (no immunity from uncertainty). RACING.md has a table of what the judge resolves. **No scoring change**, so no records or ghosts need a version | `tests/sim/rulesBounds.test.ts` |
| **5** Coaching matches the evidence | Causes stated as "likely" without the data to support them (the helm "not held over long enough", which is not recorded; two guesses at once); the favoured start end praised or blamed as a rule; wind-shift advice as a general rule | Every exercise review item names its telemetry **basis**. A cause appears only when its preconditions were recorded: turn pauses, turn rate, pinching, or a sail not drawing while on course (new measurements). Otherwise the action is a **controlled retry**. The favoured end is reported as geometry, with its caveats; wind-shift advice is bounded to this exercise and model. [COACHING_INVENTORY.md](COACHING_INVENTORY.md) lists every message | `tests/sim/coachingBasis.test.ts`, updated `coach`, `debriefNotes`, `exerciseWindShift` |
| **6** Fair personal bests | Ordinary race bests used the course name and laps only: a windier day could "earn" a best | Bests are kept per identity: course and its shape, laps, wind band, fleet size, boat, spinnaker, rules version and assistance. Older times are kept and shown as "other conditions", never compared. A start records its speed with its timing | `tests/sim/likeForLikeBests.test.ts` |
| **7** Progress and support | The Learn map ticked without saying what a tick meant; support was all-or-nothing whatever the task; terms differed ("on your own", "with assists", "independent") | The map says what a tick establishes, group by group: an activity done, not a certificate. Each exercise names its task, and an attempt's support is described against it: auto-trim in the wind-shift decision exercise is named as not bearing on the task. The record is not regraded. One pair of terms, independent and assisted, is used everywhere; input adaptations are never assists | `tests/sim/taskSupport.test.ts` |
| **8** Predictable panels | The Sails panel took no focus and ignored Escape; "Carry on" on the Learn map restarted the activity; "Scenario" named a panel called Conditions | The Sails panel takes focus on its heading; Escape or Close returns focus to its button (it stays non-modal). The Learn map says **Back to it** for the activity under way and **Start again** otherwise. Conditions is named consistently. The compact toolbar keeps the activity's name | e2e `handover.spec.ts` item 8; updated `learnMap.spec.ts` |
| **9** Releases protected | Deploy published after the build and unit tests only; no browser test guarded the published build | Deploy has two jobs. **verify** builds the commit, runs the unit tests and the **critical browser checks** (tests tagged `@critical`: a sailable state, keyboard helm and sheets, a steering button from the keyboard, a lesson, a race, a failed save) on that build, records the build, environment and results, and keeps the build. **publish** runs only if verify passed, and publishes that artifact without rebuilding. The post-deploy check is unchanged | `tests/sim/releaseGate.test.ts`; the six critical checks pass on this build (run locally with CI's time limits, on the config's own server) |

The critical run found one real defect: the save notice's dismiss button was under the click-through notice stack.
It was fixed (`904fefa`). Tests that encoded superseded policies were updated with the policy: the lesson result,
"Carry on", and causes without a basis.

## Batch 2: prototypes, a pilot and bounded aids (items 10, 11, 14, 24, 25)

| Item | What was built | Tests |
|---|---|---|
| **10** Result → retry (prototype) | Once you are out of the race, the results show one observation from the coach's debrief and **Race it again** as the main action: the same race, so the time compares like with like. **Choose another activity** and **Sail freely** sit beside it. Behind the `raceRetry` feature switch (on). Players' reasons for repeating are for a session ([FEEDBACK_SESSIONS.md](FEEDBACK_SESSIONS.md)) | `tests/sim/raceRetry.test.ts` |
| **11** Quiet kudos (pilot) | One optional acknowledgement, for a clean tack in Trim, tack and recover. It is earned only through the whole manoeuvre, with an entry-speed floor so a slow entry cannot earn it, and never for a skipped, aborted or restarted attempt. It says what earned it. Shown after each attempt, **at the end only (default)**, or not at all. Comparisons only against matching entries and support. No points, streaks or return rewards | `tests/sim/kudos.test.ts` |
| **14** Layline aid | Drawn only in its supported case: still water, the stream under 0.3 kn at the boat and the mark. The race panel says what it assumes (approach lines at the model's best angle, no stream or leeway, not the rounding path) or why it is hidden. The estimator awaits agreement on the aid's use | `tests/sim/laylineSupport.test.ts` |
| **24** Challenge journey | Before racing, the card shows the duration, the set-up (course and wind, boat, spinnaker, fleet, rule 18) and the sender's support. It also says whether this build re-sails the ghost exactly (the same build), may drift from it (another build), or was sailed under earlier rules. A cut-short link explains itself and points to the replay file; ghosts are said to be recordings | `tests/sim/challengeJourney.test.ts` |
| **25** Progress backup | Settings → Your progress saves one versioned file (`sailsim-progress` v1): lessons, exercise records, best and challenge times, the start best and the Learn map. It is distinct from replays and scenarios. Restoring merges and never loses what is here, so restoring twice changes nothing. Files that are not backups, from a newer version or damaged are refused whole; a save that fails part-way is undone | `tests/sim/progressBackup.test.ts` |

## Batch 3: story, identity and evidence (items 29–31)

- **29, the free development story:**
  - About and the landing page say it is free, with no account.
  - They link the public source (MIT for the code; the data and the club's material keep their own terms).
  - [COST_LEDGER.md](COST_LEDGER.md) is a dated template that keeps running costs, optional services, development
    tools, hardware and contributed time apart. **The figures await the owner** (issue 278); none were invented.
- **30, identity:**
  - The text names the river's places: Dartmouth and Kingswear up to Noss and Dittisham.
  - It says plainly which approval exists (the RDYC's, for its name and burgee) and that the class and the RYA have
    not endorsed it.
  - A new name, domain or appearance stays the owner's choice. Verified in-sim marketing views wait for item 21.
- **31, current evidence:**
  - [CURRENT_SPEC.md](CURRENT_SPEC.md) is a one-page, build-linked specification with evidence words (software check,
    sailor review, measurement, learning evidence). `tests/sim/currentSpec.test.ts` holds it to the code.
  - [docs/README.md](README.md) separates current documents from historical reports.
  - [FEEDBACK_SESSIONS.md](FEEDBACK_SESSIONS.md) is a kit for owner-authorised, task-specific sessions, with a
    disposition log.
  - A stale claim was corrected: the README still said the 21 Nov fixes were "in progress".

## Batch 4: investigations and conditional scoping

Details, tables and kits are in [handover-23nov/INVESTIGATIONS.md](handover-23nov/INVESTIGATIONS.md).

- **12, devices:**
  - The first row of a dated device matrix: loading over 10 Mbit (instruments live in 11.7 s, the river in 22.7 s,
    2.09 MB transferred, in software rendering).
  - A kit using the in-app device check, which is now safe to run (item 1).
- **13, cues:** an inventory of the cues and their accessible equivalents, and a one-cue-at-a-time test kit.
- **15, calibration:** the behaviour envelope as a review sheet for a Squib sailor (upwind, tacks, acceleration, a gust),
  and the measurement plan's next steps.
- **16, sail controls:**
  - A model sweep: the kicker, the cunningham and the outhaul act almost interchangeably (issue 281).
  - A proposal of one relationship to agree first: the kicker and leech twist.
- **17, recoverable mistakes:** an irons study. With the helm alone the boat stays in irons; with the sheets eased she
  gets out in 10 and 16 kn but **not in 6 kn**, and there is no backed jib (issue 280).
- **18–20, sightlines, touch layouts and sound:** status and kits; the existing automated checks are named.
- **21, places:**
  - Labels-hidden, water-level views of Dartmouth, Kingswear, Noss, Dittisham and the Start Bay approach, from fixed
    viewpoints, with a viewpoint sheet (issue 277).
  - Noss needs a reference date from the owner.
- **22, local appearance:** conditional on item 21's results.
- **23, an exploration voyage:** a scoping note (Off Dart Marina to the Noss pontoons).
- **26–27, the instructor workflow and local conditions:** kits, and the existing data checks named.
- **28, the AI:**
  - A rerun of the AI trials on this build, 30 races per fleet size. It is a rerun, not a new benchmark: 10 boats 90%
    clean, 5 boats 97%.
  - 4 of the 5 contacts in 10-boat races are provisional findings (issue 283).
- **32, varied practice:** a scoping note.
- **33–36, conditional projects:** scoping notes awaiting the owner: waves coupled to performance, disturbed air, the
  club table hardened, and crew or multiplayer.

## The rules sources (item 4)

World Sailing's rules site could not be reached from the build environment:

- The fetch tool's DNS failed.
- The proxy refused the host until the environment allowed it.
- A direct fetch was then declined by the session's safety checks.

So no official text is quoted. The corrections rest on secondary sources found by search: the RYA's guidance on the
2025–2028 changes, and US Sailing's material on the preamble to Part 2 and rule 43. They say that:

- Part 2 applies between boats intending to race, racing or having raced;
- a boat not racing is not penalised under Part 2, except under rule 14 with injury or serious damage, and under rule
  23.1;
- exoneration is consolidated in rule 43.

A qualified rules reviewer should check the wording and review incident cases before any behavioural or scoring
change (issue 276).

## What needs people (from this round)

- **A rules reviewer:** item 4's wording and cases.
- **An instructor:** item 5's worked examples, item 11's pilot, item 17's recovery task and item 26's workflow.
- **Local sailors:** item 21's viewpoint sheet and item 27's local claims.
- **A Squib sailor:** item 15's review sheet.
- **Volunteers with phones, tablets and a real GPU:** item 12.
- **Players:** items 10, 24 and 25 ([FEEDBACK_SESSIONS.md](FEEDBACK_SESSIONS.md)).
- **The owner:**
  - the cost ledger's figures;
  - Noss's reference date;
  - the decisions on items 22, 33, 34, 35 and 36.

## How it was checked

- **Unit tests** (Vitest): the full suite, including the new tests named above.
- **Lint and typecheck:** the full project.
- **Browser tests** (Playwright, software WebGL, one worker):
  - each new or changed browser test was run;
  - the critical set passed in full (6 of 6), the last two with CI's time limits on the critical config's own server.
- **The full browser suite** runs in CI on the pull request. In this container two Learn map tests timed out on slow
  clicks. A simple script call into the page took 7–8 s on both this branch and `main`, measured side by side, so the
  cause is the container's software rendering and not this change.
