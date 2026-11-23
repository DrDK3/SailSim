# Design handover, 23 Nov 2026: investigations and kits

The owner's decision on scope was "do the feasible part": run what software can (reproductions, captures, model
sweeps, trials and inventories) and prepare kits for the people the rest needs. Conditional projects get scoping notes
awaiting the owner. Everything measured here ran in a cloud container with **software rendering (SwiftShader), no GPU,
no phone or tablet**, and every model figure is **model output from estimated coefficients, not validation**.

Summary in [../HANDOVER_23NOV_REPORT.md](../HANDOVER_23NOV_REPORT.md). Session logging: [../FEEDBACK_SESSIONS.md](../FEEDBACK_SESSIONS.md).

## 12. Supported device performance

**What software did here**

- Loading over a throttled 10 Mbit link with `tools/load-timing.mjs` (two runs, this build, software WebGL): the
  first row of the matrix below. The largest downloads are the river's elevation grid (570 kB) and the app's code
  (402 kB). In this container the page's main thread is slow under software rendering (a simple script call took
  7–8 s on both this branch and `main`), which is why times here are not a guide to a real device.
- The in-app device check (Settings → Device check) is now safe to run: it waits for the activity in progress, and a
  failed save says so (item 1). It is the tool for volunteers' devices.

**Device matrix (start of a dated record)**

| Date | Build | Device | Browser | Settings | Task | Result |
|---|---|---|---|---|---|---|
| 23 Nov 2026 | this branch | Cloud container, 4 vCPU, **software WebGL** (not a real device) | Chromium (Playwright 1.64) | Default (automatic quality) | Load over 10 Mbit, gzipped like Pages (median of 2) | Instruments live 11.7 s; River Dart loaded 22.7 s; 2.09 MB transferred |
| (date) | (build) | (phone or tablet model) | (browser) | (preset) | Device check, 60 s | (report JSON attached) |

**Kit for people**: run Settings → Device check on each device for 60 s, between activities, and attach the report;
then sail lesson 1 and a short race, noting how the controls respond, any long pauses, and whether sails, telltales,
the burgee, marks and other boats stay readable at the lowest preset. The first devices to choose: the phones and
tablets juniors bring to the club, and one laptop with a real GPU. Published support and defaults should then follow
the matrix.

## 13. Natural sailing cues and accessible equivalents

**Inventory (from the code)**: the cues every preset keeps (`src/render/cueAudit.ts`, checked at each preset by
`tests/e2e/juniorsCues.spec.ts`): the sails' shape, the jib's telltales, the boat's heel, the wake and bow wave,
cat's paws on the water, the masthead burgee, marks, other boats and spinnakers. Their accessible equivalents in the
interface: the sail status words (Drawing, Luffing, Stalled) beside each sheet, the heel and speed instruments, the
wind arrow and TWA, the lifted or headed readout in words, captions for every sound signal, and the coach's text.
"Drawn this frame" proves presence, not readability: the scene flags cannot show that a learner sees the cue.

**Kit for people**: one cue at a time, with an instructor and an accessibility reviewer. Show the cue (a luffing jib,
say) with the instruments hidden, ask what it means and what to do, then repeat with a matched variation and fewer
prompts. Record the device and preset. Only after the cue is recognised, try the optional reduced-instrument variant of
the tack exercise; the accessible equivalents stay available throughout.

## 15. Calibrating core Squib handling

**Model output to review** (`npm run envelope`, this build; flat water, steady wind, the crew policy):

| Behaviour | 6 kn | 10 kn | 14–15 kn | 18 kn |
|---|---|---|---|---|
| Upwind: best-VMG TWA, speed, VMG | 35°, 2.98 kn, 2.31 kn | 32°, 4.15 kn, 3.30 kn | 30°, 4.68 kn, 3.77 kn | 30°, 5.02 kn, 4.11 kn |
| Upwind heel, leeway | 0°, 4.3° | 4.6°, 5.3° | 13.8°, 6.5° | 20°, 6.9° |
| Tack: lowest speed, turn time, back to 90% | 1.56 kn, 10.6 s, 28.8 s | 2.25 kn, 7.3 s, 16.2 s | 2.74 kn, 6.4 s, 11.4 s | |
| Tack: ground lost to windward | 14.2 m | 14.6 m | 14.5 m | |
| Beam reach speed (8, 12, 16 kn) | 5.04 kn (8) | 5.93 kn (12) | 6.54 kn (16) | |
| Acceleration from rest, 10 kn, TWA 60° | | 50% in 4.6 s, 90% in 10.0 s, 5.28 kn | | |
| Step gust 10 → 16 kn close-hauled | | heel 4.6° → 20.2° in 2.9 s, speed 4.15 → 5.01 kn | | |

The full table is `out/envelope.md` (CI keeps it as the `behaviour-envelope` artifact).

**Kit for people** (the measurement plan's first step): an experienced Squib sailor reviews these figures for gross
errors before any measurement: upwind angle and speed by wind, acceleration, tack loss and recovery, helm balance
(weather helm in a breeze), and the spinnaker's gain downwind. Each answer is recorded with the sailor's role, date and
build in the validation sheet (`docs/review/VALIDATION_SHEET.md`). Then: a small GPS-logged set (two or three
behaviours) with the conditions and crew noted, half kept back for validation. No coefficient changes until then;
afterwards the polars, the AI, the weekly targets and the records must be rechecked (and versioned where they change).

## 16. Sail controls: meaning, physics and appearance

**What software did here**: at fixed conditions, each control moved from its default to full, one at a time, with the
helm on a TWA autopilot and auto-trim on: [model-sail-controls-and-irons.md](model-sail-controls-and-irons.md).

**Finding**: the kicker, the cunningham and the outhaul act almost interchangeably. Each reduces heel by about the same
amount (14 kn upwind: −4.8°, −4.1°, −5.5°), costs a little speed in light air (8 kn: −0.04 to −0.07 kn) and gains a
little in a breeze (14 kn upwind: +0.05 to +0.10 kn). The jib lead has small effects (heel ±1°). This matches the
handover's description: individual controls use simplified coefficients and lack independent shape inputs.

**Proposal for agreement before any change** (the "one meaningful relationship" first): the kicker's control of leech
twist on a reach (its distinct job), with its intended direction and size agreed with a Squib instructor, then the
physics and the drawn sail fed from the same state. Recordings keep the existing aggregate behaviour unless a version
is agreed.

## 17. Recoverable sailing mistakes

**What software did here**: from stopped head to wind, on each side, three recoveries with the controls the player
has: [model-sail-controls-and-irons.md](model-sail-controls-and-irons.md).

**Finding**: with the helm alone (sails on auto-trim) the boat stays in irons in 6, 10 and 16 kn (still within 11–24°
of the wind after 60 s). Easing the sheets with the helm over gets her out in 10 kn (34–41 s) and 16 kn (16 s), but
**not in 6 kn** (she bears away to about 63° but has not reached 1.5 kn after 60 s). A real Squib's crew would back
the jib; the model has no backed jib (the envelope's A-PH-11 already notes it). So in light air a learner can be
trapped in a restart loop, which is the case the handover asks about.

**Next step (needs an instructor)**: agree the recovery task (irons on both tacks in light air), then decide whether a
"back the jib" crew action is warranted, and how it should behave, before it is modelled. It must not become a turning
or speed exploit (check with `npm run exploits`).

## 18. Camera sightlines and comfort

**Status**: not re-shot in this round. The obstruction evidence in `docs/img/fixes-21nov/` is historical. The existing
controls (the helm view's field of view, the faded crew, reduced motion) are the starting points.

**Kit**: capture current views on both tacks through a full tack and a mark rounding (`tools/rig-shots.mjs` frames the
boat from fixed eye points), then ask sailors to do three tasks on a supported device: see the jib's luff, check for
traffic to leeward, and judge a mark approach. Change posture, eye position or transparency only for a failure that
the captures reproduce.

## 19. Touch layouts and information density

**What software already checks**: `tests/e2e/phone.spec.ts` and the Learn map's phone test (every control at least
44 × 44 px, no sideways scroll); `tests/e2e/layout.spec.ts` for the dock. This round kept the activity's name in the
compact toolbar (item 8).

**Kit**: on a short landscape phone, a tablet and with the browser's text at 200%, do trim, a tack and the Sails panel,
and note whether the sails, the next mark and traffic stay visible. Ask experienced sailors new to games to pick a
display (Settings → Display) and find an activity unaided.

## 20. Sound

**Inventory**: sounds are synthesised in the browser (`src/render/audio.ts`): wind, water, sail flutter, the
spinnaker's flogging, the horn and whistles, halyards; every signal has a caption; `public/audio/manifest.json` takes
recordings that replace a synthesised sound.

**Kit**: a listening session on headphones and on a phone speaker: identify luffing, flogging, a gust, the start
sequence and a ship's whistle in a busy race; compare boat-relative and camera-relative wind as the camera turns.
Add a recording only where a sound fails a test.

## 21. Recognition of the required places

**What software did here**: water-level views, eye 1.6 m above the water, labels and the interface hidden, from fixed
viewpoints (`tools/handover/place-shots.mjs`, so a later build can be shot from the same places):

| Place | Picture | Viewpoint (local metres: eye → looking at) |
|---|---|---|
| Dartmouth waterfront | [places/dartmouth.jpg](places/dartmouth.jpg) | n 230, e −120 → n 300, e −430 |
| Kingswear | [places/kingswear.jpg](places/kingswear.jpg) | n 160, e −260 → n 170, e 120 |
| Noss | [places/noss.jpg](places/noss.jpg) | n 1500, e −260 → n 1850, e −40 |
| Dittisham | [places/dittisham.jpg](places/dittisham.jpg) | n 3450, e −1250 → n 3850, e −1650 |
| The approach from Start Bay | [places/approach.jpg](places/approach.jpg) | n −2000, e 1550 → n −650, e 700 |

The viewpoints are first attempts: the Noss view frames the marina at its left edge, and the Dittisham eye sits close
to the shore. A local sailor should adjust them to the views a sailor actually knows. Noss is shot as modelled now;
the handover asks for a stated reference date for Noss (its marina and hall have changed): the owner should name it.

**Viewpoint sheet (for each picture, each viewer)**: the place named (or "don't know"), confidence 1–5, the major
features that mislead, and what they expected to see. Record the viewer's role only. Bespoke-model coverage
(`src/render/landmarks.ts` has Dartmouth's and Kingswear's waterfront buildings, not Noss's or Dittisham's) is a clue
to investigate, not a score.

## 22. Correcting local appearance problems (conditional)

**Waiting for item 21's results.** Correct only what viewers get wrong, largest discrepancy first, within the scenery
freeze (docs/STATUS.md) and the performance budget; new assets need the owner's agreement. Each correction is shot
again from the same viewpoint and shown to different viewers.

## 23. A local exploration voyage (pilot proposal)

**Scoping note**: one short segment from an existing start, Off Dart Marina, upriver to the Noss pontoons: an
objective (pick up a mooring off Noss, using the mooring lesson's check), a recognisable destination and a clear end.
It needs the place views (21) to be recognisable first, and it must survive interruption (the resume card exists for
free sailing; the segment would use it). Build it only after observing whether players want another segment.

## 26. A practical instructor workflow

**Kit**: observe one RDYC instructor prepare (choose an exercise and thresholds: Settings → Instructor view),
demonstrate, hand over to a learner, review the attempt table and the assist record, and choose the next task, without
developer help. Note the first obstacle; scope presets, threshold editing or session controls from it. Any mapping to a
training syllabus is checked with the training centre; no qualification or endorsement is claimed.

## 27. Local weather, tide and sea scenarios

**What software already checks**: the freshness rules (`src/sim/env/liveData.ts`), and `tests/e2e/deploy.spec.ts`
(missing and stale live data leave a labelled, usable set-up); the instruments name the sources in use.

**Kit**: local sailors review, as separate claims, river shelter, the timing of the stream, the harbour exit and the
bay. Until a claim is reviewed against local observation, the simulator does not teach precise eddies, wind shadows
or tide-dependent routes as reliable local knowledge (docs/OUTSTANDING_ISSUES.md keeps the open ones).

## 28. AI fairness and encounter reliability

**What software did here**: a rerun of the AI trials on this build (`npm run ai:trials -- --runs 30 --spinnaker`,
practice courses in Start Bay, seeds 1–30). It is a rerun with these conditions, not a new benchmark:

| Fleet | Races clean | Contacts | Groundings | Boats finished | OCS boats | Median start |
|---|---|---|---|---|---|---|
| 10 boats | 27 of 30 (90%) | 5 | 0 | 100% | 4 | 14.3 s after the signal |
| 5 boats | 29 of 30 (97%) | 1 | 0 | 100% | 1 | 13.2 s |

**What the new labels show (item 4)**: 4 of the 5 contacts in 10-boat races are labelled provisional: the right-of-way
boat had changed course in the 3 s before (rule 16), or right of way had just changed (rule 15). So most AI contacts
happen in exactly the encounters the simplified judge does not resolve. All contacts were slow (0.1–1.2 m/s).

**Next step**: review those encounters (the protest room shows each from above) with racers: who caused the contact,
whether the avoidance looked believable, whether either boat had information or physics the other lacked. Choose
default fleet sizes and difficulty from that review. "All boats clean" stays one diagnostic among several.

## 32. Varied practice and tactical decisions

**Scoping note**: build on the two reviewed exercises with variations across both tacks and wind strengths first
(cheap, and they test transfer), then decision types (pressure against shift, layline position) once items 5, 13–16
and 28 make the interactions credible. Allow more than one defensible choice; separate outcome from luck in the
feedback; define repeated-skill evidence only with instructor-reviewed criteria.

## Scoping notes awaiting the owner (33–36)

| Item | What it would take | Before starting |
|---|---|---|
| **33 Waves coupled to performance** | One bounded response first (added resistance in a seaway), integrated with the existing visual wave riding; then exploit checks; the AI, polars, targets and records rechecked or versioned | Calm-water review (15) and the sea-state scenarios (27); the owner's go-ahead and a compatibility plan |
| **34 Disturbed air between boats** | A modest, reviewable model applied to players and AI alike; controlled encounter tests; checks for a dominant covering exploit; performance budget | Calibration (15) and AI review (28); the owner's scope and budget |
| **35 The shared club table, hardened** | Recheck the provider's current limits; repair atomicity, retries, partial writes and verification; a daily operations ceiling; static weekly and ghost play unaffected when the service fails | The owner's decision to activate it (it is off); items 6, 9 and 24 are now in place |
| **36 Crew cooperation and multiplayer** | Demand first (observed players), then a small role or task prototype; networking, synchronisation, support and running cost estimated before any real-time play or accounts | Items 10, 15, 24 and 28; an owner decision consistent with the free, no-account goal |
