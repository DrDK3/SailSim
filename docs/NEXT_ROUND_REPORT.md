# Next round: make the wind visible, add the spinnaker, polish, share

Requested 20 Nov 2026 (the owner's "SailSim: next round"), from the review of 20 Nov 2026 (recommendations #1–#43,
numbers kept). Packages A–G, each on its own branch and draft pull request, in order; physics only in package B.

**Software rendering only.** Every screenshot and every frame time in this report comes from Chromium's software
renderer (SwiftShader) in a container: nothing here was seen on a real GPU or a real phone. Nothing is validated:
measured means measured in the model, not against a Squib on the water.

| Package | Branch | Pull request | State |
|---|---|---|---|
| A (no physics): wind visibility and quick wins | `next-a-wind` | draft (link in §A.9) | Built; checks in §A.8 |
| B (physics): spinnaker and sail controls | `next-b-spinnaker` | draft (link in §B.9) | Built; checks in §B.8 |
| C (no physics): the low preset, trees, compact replays | `next-c-graphics` | draft (link in §C.9) | Built; checks in §C.6 |
| D (no physics): Learn map and instructor view | `next-d-learn` | draft (link in §D.8) | Built; checks in §D.6 |
| E (no physics): metadata, media, manifest, landing page | `next-e-share` | draft (link in §E.9) | Built; checks in §E.7 |
| F: simplified rule 18 and AI fleet safety | `next-f-rules` | — | Not started |
| G: STATUS.md and issue hygiene | `next-g-status` | — | Not started |

## The club's approval (20 Nov 2026)

"The RDYC has approved use of the club's name and burgee (owner, 20 Nov 2026)." Recorded exactly as stated in
[CLUB_DOCUMENTS.md](CLUB_DOCUMENTS.md) §4 and [SOURCES.md](SOURCES.md) (RA1), and no wider: it does not mean the club
has checked the RDYC courses, which keep their "pending club check" labels (status `pending-check` in
`data/courses/club/`, and on the weekly long course).

---

## Package A: wind visibility and quick wins (no physics)

### A.1 What changed, by review number

| # | Change | Where |
|---|---|---|
| #1 | **Look up**: hold **T**, or the console's **⇡** button, and the camera eases from where it is to a view up the mast at the masthead, and back on release (chase, helm and orbit views). With reduced motion it cuts instead of easing. A view change only: nothing is recorded, the boat's controls are untouched. In Help and on the button | `src/render/scene.ts` (`setLookUp`, `applyLookUp`), `src/render/frames.ts` (`lookUpBlend`), `src/ui/Controls.tsx` (`LookUp`), `src/ui/Help.tsx` |
| #2 | **The masthead in a small picture** by the compass, driven by the same apparent wind (the snapshot's `awa`, `aws`) as the 3D burgee at the masthead. Its own small WebGL canvas; on the lowest preset (and if a second WebGL context fails) a 2D vector drawing instead. A text alternative for screen readers ("Wind indicator: wind from 40° to starboard of the bow"). Settings → Masthead picture, or the Settings menu, hides it | `src/render/mastheadInset.ts`, `src/ui/MastheadInset.tsx`, `src/app/windIndicator.ts` |
| #3 | **Indicator setting**: "RDYC burgee" (default) or "Masthead vane" (a Windex-style arrow with tacking tabs at an angle you set, 30° by default, E, L5). Both fly in the one apparent wind the simulation has. **Which of the two Squib sailors use is still to be asked (#4): it is a setting until then** | `src/render/mastheadVane.ts`, `src/render/squibModel.ts` (`setIndicator`), `src/ui/SettingsPanel.tsx` |
| #3 | **The masthead kept clear** in the default chase framing: the camera's framing keeps the masthead below whatever lies across the middle of the top of the screen and above the console (`chaseFraming`), drawing back if it must (capped at 3× the distance); labels that would cover the masthead are hidden for that frame; the transient notices (Paused, running slow, quality) moved from the top centre to the right-hand column (bottom left on phones). Tested by projecting the masthead to the screen and asserting no interface element's box meets it, at 1280×800 and 390×844 | `src/render/frames.ts`, `src/render/scene.ts` (`clearMasthead`), `src/ui/App.tsx`, `tests/e2e/wind.spec.ts` |
| #9 | **The river data no longer resets a run.** Untouched (no input yet; an activity in its first 5 s): restart as before. A free sail under way: the river joins **in place** where the boat is, if that is safe (water deeper than her draught plus the start margin, clear of structures and mooring areas): the same boat, moment, place and speed, the same wind field (the gusts carry on), the river's bed, stream and obstacles from that step. Otherwise, and always for a lesson, an exercise, a race, a drill or a ghost race: a card, "The river is ready. Restart here?", with Restart and Keep sailing. A replay plays on; the river joins at the next start | `src/app/controller.ts` (`riverArrival`, `joinRiverHere`, `RiverCard`), `src/sim/simulation.ts` (`joinRiver`), `src/sim/env/conditions.ts` (`reuse.wind`) |
| #9 | A run the river joined part-way is recorded as replay schema **`squib-replay/2`** with the step (`dartFromStep`); its replay starts in open water and joins the river at the same step, bit for bit. **Every other recording is still `squib-replay/1`**, so older builds and the club table's verifier read them as before (an older build refuses a /2 file rather than replaying it wrongly) | `src/app/replay.ts` |
| #10 | **The weekly course is a junior course**: six short practice courses in Start Bay (windward–leeward 320 m and 400 m, triangle 350 m, tacking lane 350 m, three laps of the rounding drill, gybing slalom 720 m), each sized so that the good AI finishes in 5–10 minutes at 8 and at 14 kn (measured: §A.2). The RDYC courses at full length are each week's optional **long course** (still "pending club check"; its own best; no targets; not on the club table) | `src/app/weekly.ts`, `src/ui/Social.tsx`, `src/app/social.ts` |
| #11 | **Targets spread**: gold is the expert AI's median time; silver and bronze are that time 10% and 25% slower (E, L5, configurable: `TARGET_SPREAD`), their ghosts the gold ghost slowed after the start signal (labelled so). Shown as "gold 6:40 · silver 7:20 · bronze 8:20". The good AI's time is kept in the file as the course-length check. `tools/weekly-targets.ts` prints the new line; the workflow was not run | `src/app/targets.ts`, `src/app/weeklyTargets.ts`, `tools/weekly-targets.ts` |
| #16 | Renamed: **Options → "Conditions"**, **Library → "Scenarios and replays"** (toolbar, panel names, accessible names, Help, living docs, tests; the tooltips say what each was called). Historical reports keep the names of their day | `src/ui/App.tsx`, `src/ui/ScenarioPanel.tsx`, `src/ui/LibraryPanel.tsx`, docs |
| #17 | **Colour and words agree**: eased to its stop and still stalled (a run, auto-trim on or off) is a neutral state of its own, "Eased right out", with a grey dot; never "Stalled" in green. Green only for Drawing. The property test checks it over 240 seeded sails | `src/app/sailStatus.ts`, `tests/sim/sailAdvice.test.ts` |
| #18 | **Plain instruments at Learn**: "Wind from 40° to starboard", "Wind speed", "Wind on board", "Speed over the ground", "Sideways slip"; Club and Expert keep TWA, TWS, AWA, SOG, COG, each with its tooltip | `src/ui/Instruments.tsx` |
| #19 | **"VMG upwind" / "VMG downwind"** with a positive number, at every level (the side from the true wind angle, so a beam reach does not flicker) | `src/ui/format.ts` (`vmgShown`) |
| #20 | **Place labels off at Learn and Club, on at Expert** (the level sets them; the Settings menu's "Place labels" still toggles them). With them off, a mouse resting on a place, or a tap on it, labels that one place for 3 s. **Course mark labels are always shown** | `src/app/level.ts`, `src/render/dart.ts` (`revealNear`), `src/render/scene.ts` |
| #21 | **Phones**: the instruments become a compact strip (the compass small, then speed, wind, wind speed, VMG and depth); on touch screens every sailing control is at least 44 × 44 px; upright, the two sails sit side by side so the console does not grow; on its side the console is one band of two 44 px rows and the masthead's picture moves to the top right. Collapsing the console is the existing ▾ tab, now 44 px | `src/ui/styles.css`, `tests/e2e/console.spec.ts` |
| #22 | **Plain sail-state words at Learn**, from the state and the side the boom is on (issue 200): "Full", "Flapping: pull it in (W)", "Pulled in too far: let it out (S)", "Let right out", "the wind is on the boom's side (out to port): it may swing across; steer towards the wind". Checked to agree with the state and to ask only for what can be done | `src/app/sailStatus.ts` |
| #23 | **Ease that changes nothing**: a sheet that is slack (the sail inside the angle its sheet allows, held there by the wind) is no longer asked to be eased; the advice says why ("sheet slack: the wind holds the sail, easing moves nothing; head up a little"). When the sheet does move, an arrow at the end of the sheet's bar shows which way | `src/app/sailStatus.ts`, `src/ui/Controls.tsx` |
| #24 | **Auto-trim at work**: the toggle reads "Crew trimming" (from 1440 px, where the sail modules are widened to hold it beside "Eased right out"; "Crew" below that) while the crew works the sheet, and the bar's arrow shows which way; its accessible name stays "Auto-trim, main/jib" | `src/ui/Controls.tsx`, `src/ui/styles.css` |
| #15 | **The helm view from the helm's eye**: the camera sits where the helm figure's head is on the windward side deck, facing forward (it was a fixed point 0.8 m out, 1.5 m up); the head, neck, chest and upper arms are not drawn (the eye is inside them), the hands, forearms, legs, boots and the tiller are (before, the whole figure was hidden); the eye ducks to keep 0.3 m (E) from the boom's spar; the field of view is in Settings → Helm view (50–90°, default 68° as before) | `src/render/crew.ts` (`setFirstPerson`, `eye`), `src/render/squibModel.ts` (`helmEye`), `src/render/scene.ts`, `src/app/prefs.ts` |
| #36 | **A flogging sail flaps from any side** (issue 225): the flogging wave was multiplied by the sail's fill, which is zero exactly when the sail lines up with the wind and flogs, so a fully flogging sail went flat and still, edge-on from astern. The wave now runs across the chord's own normal, driven by the luff value alone (the same amplitude and wind dependence as before). Presentation only; no camera offset | `src/render/squibModel.ts` |
| #30 | **`daylight.spec.ts` (issue 202)**: see §A.6 | `tests/e2e/daylight.spec.ts` |

### A.2 Evidence (software rendering)

- **Masthead clear** (measured in the browser): at 1280×800 the masthead's box (636–700 × 58–122 px) meets no interface
  element; at 390×844 (masthead at 213, 272) none, one place label hidden for the frame. `tests/e2e/wind.spec.ts` asserts it at
  both sizes with the Paused notice up and labels on.
- **Phones** (measured, 390×844 upright and 844×390 on its side; screenshots before and after in the PR):

  | | Upright before | Upright after | On its side before | On its side after |
  |---|---|---|---|---|
  | Instruments' height | 250 px | 161 px | 263 px | 161 px |
  | Water between the instruments and the console | 363 px | 451 px | 30 px (the console's band, instruments down the left) | 106 px, and the whole boat in view |
  | Sailing controls under 44 × 44 px | 17 | 0 (the 22 px checkboxes sit inside 44 px labels) | 17 | 0 |

- **Weekly courses**, the good AI's time from the start signal, seed 1 (`tests/sim/weekly.test.ts` checks 300–600 s at 8 and 14 kn):

  | Course | 8 kn | 14 kn |
  |---|---|---|
  | Windward–leeward 320 m, 1 lap | 7:16 | 5:19 |
  | Triangle 350 m, 1 lap | 8:40 | 6:43 |
  | Tacking lane 350 m | 7:51 | 5:46 |
  | Rounding drill 120 m, 3 laps | 7:54 | 5:52 |
  | Windward–leeward 400 m, 1 lap | 8:56 | 6:30 |
  | Gybing slalom 720 m | 7:35 | 5:18 |

  Before, the rotation alternated practice courses with the RDYC courses at full length (the AI took about 50 minutes on
  those). **The good and expert AI differ by about 1% on every course measured** (0.3–1.9%), which is why the old
  bronze/silver/gold (club/good/expert AI) were nearly the same time and why review #11 asked for a spread.
- **River joining a run**: `tests/sim/riverArrival.test.ts`: untouched restarts; a free sail joins in place (same boat,
  time, position, wind field) and its replay matches every checkpoint; on land it asks, Keep sailing stays in open water
  until the next start; a lesson asks and Restart keeps the lesson; an exercise and a race ask. All fail on the old code
  (it replaced the run).
- **Helm view** (`tests/render/helmEye.test.ts`, `tests/e2e/helmView.spec.ts`): both tacks, upwind and downwind, at a
  fixed seed: the eye within 0.15 m of the helm figure's head, on the windward deck, aft of the mast; head and chest
  scaled to nothing, hands and legs drawn; the eye drops to keep 0.3 m from the boom when the boom is brought to it.
  Screenshots before and after in the PR.
- **Flogging sail** (`tests/render/flogging.test.ts`): fully flogging with the wind along the sail, the cloth now moves
  up to 0.15 m or more between moments, more at the leech; before the fix it did not move at all (0 m). Drawing: no motion.

- **Screenshots** (software rendering, in `docs/img/next-a/`): phones upright and on their side before and after;
  the helm view before and after (upwind starboard, downwind port); the console before and after at 1280 and 1600 px;
  the instruments at Learn before and after; the desktop at 1280 px after (the renamed toolbar, the masthead picture,
  the Paused notice at the top right).
- **Regressions found and fixed on the way** (by the existing end-to-end tests): widening the helm module for the
  look-up button pushed the band 2 px off an 820 px screen and under the minimap at 1180 px (now 188 px, and 172 px
  under 990 px); the sheet arrow sat in the page's flow (an older `.sheet-bar span` rule) and overflowed the meter; at
  1280 px "Crew trimming" squeezed the state pill until "Eased right out" spilled out of it, and from 1440 px an older
  wide-screen dock rule wrapped the pill onto two lines; the toolbar's longer "Scenarios and replays" label pushed it
  into its menu form when a panel was open beside it (it now reads "Scenarios" in the compact forms, its name unchanged).

### A.3 Physics

None. Package A changes no physics: the determinism hash is `11824f89f479d0f4` before and after; the behaviour envelope
and the golden traces are identical (§A.8). `Simulation.joinRiver` and `buildConditions(…, { wind })` are new paths
used only when the river data arrives during a run; no existing trajectory goes through them.

### A.4 Estimates introduced (E)

| Value | Level | Where |
|---|---|---|
| Vane tacking tabs 30° either side of dead aft (20–45° in Settings) | E, L5 | `src/app/windIndicator.ts` |
| Silver +10%, bronze +25% of gold | E, L5 | `src/app/targets.ts` |
| Junior course length: 5–10 minutes for the good AI | E (the review's figure) | `src/app/weekly.ts` |
| The helm's eye 7 cm above and 8 cm forward of the head's centre; 0.3 m clear of the boom | E | `src/render/crew.ts`, `src/render/squibModel.ts` |
| A slack sheet: the sail more than 3° inside its sheet's angle | E | `src/app/sailStatus.ts` |
| Label reveal: within 48 px, for 3 s | E | `src/render/dart.ts` |

### A.5 Accessibility

The masthead picture is an image with a text alternative; Look up works from the keyboard (T, or Space/Enter on the
button) and cuts with reduced motion; the river card is a dialog with two labelled buttons; the auto-trim toggle keeps
its accessible name; status words never depend on colour alone (the words agree with the colour, and the advice is read
out); phone targets 44 px. axe-core runs on the changed screens in `tests/e2e/a11y.spec.ts` (CI).

### A.6 `daylight.spec.ts` (issue 202, #30)

The CI logs of the failing runs (main at 8f86fb7, run 43744050970) show where it fails: line 46, after the dispatched
click on Settings → "Daylight view when dark", the setting never turned off within 120 s, twice (the test and its retry).
The item was found and showed `aria-checked="true"` just before. In the later runs listed in §A.8 the same test passed.
The CI job uploads `test-results/` on failure, but without traces, so no trace of a failing run exists. This round turns
traces on for that file (`retain-on-failure`) so the pull request's own runs keep one if it fails again; the result is in
§A.8. No retry was added.

### A.7 What is left from package A

- **#4**: which indicator Squib sailors use (needs people): a setting until then.
- The masthead picture's 3D view was checked in software rendering only; on the lowest preset it is the 2D drawing.
- The river joins in place only during free sailing; in every activity it asks (by design: "never reset silently").
- Phone layouts were checked at 390×844 and 844×390 in emulation only (#32: real devices need people).

### A.8 Checks

Locally (cloud container, software rendering): typecheck, lint, unit tests, build with the secret scan, the determinism
hash (`11824f89f479d0f4`, unchanged), `npm run envelope` (identical to the baseline), the golden traces (unchanged), and
the grep for RYA / "validated" / "realistic" claims (none added). The end-to-end tests touched by the package were run
locally one file at a time; CI runs the whole suite and is the authority (software rendering here runs at 1–7 % of
real time).

**First CI run (4ba9f71, run 44852625587): four defects found and fixed, one slow-renderer cancellation.**

| Shard | Test | What it was | Fix (with its regression test) |
|---|---|---|---|
| 3 | `smoke.spec.ts:193` | The River Dart state gained the restart card's flag (`ask`), the test expected the old shape | Test updated to the new state (6634248) |
| 2 | `redteam.spec.ts:49` (drone "Back to boat") | **Defect.** Moving the notices to the top right (A1) put the "Running slow" notice over the drone and helm views' camera strip, and a CSS rule of mine (`.notice-stack .banner.paused-pill`) gave it back the clicks it is meant to let through | The notices and side panels start below the camera strip in those views; a status notice lets clicks through again. New test in `notices.spec.ts` (fails before: the notice overlapped the strip) |
| 1 | `a11y.spec.ts:41` (text ≥ 12 px) | **Defect.** The phone's compact instrument strip (A4, #21) used 10.5–11.7 px text | All its text at 12 px; the strip stays under 180 px tall (`console.spec.ts`) |
| 1 | `a11y.spec.ts:117` (reduced motion, helm view) | **Defect.** The helm's-eye camera (A6, #15) followed the helm figure's head as it hikes, 1.5–1.8 cm a frame with reduced motion (limit 1 cm) | With reduced motion the eye moves at most 0.5 m/s and under 1 cm a frame; the existing test is the regression test |
| 1 | `experience.spec.ts:31` (hub → Race against AI) | The race set-up panel did not appear within 60 s, twice; **not reproduced locally** (with `CI=1`, and with the CPU throttled four times) | Not yet explained. The test now reports what was on the screen if it fails again; see the next run |
| 4 | `training.spec.ts:229` | Timed out at 8 min, passed on its retry: slow renderer | none |
| 4 | (whole shard) | Cancelled at the 60-minute job limit: the round's new tests took the slowest of four shards past the hour | Five shards (`.github/workflows/ci.yml`, `docs/DEPLOYMENT.md`) |

`daylight.spec.ts` (issue 202) passed in this run, both tests, first time.

**Second CI run (99746f4, five shards):** shards 2–5 and the checks green. Shard 1: the phone-on-its-side test
(`console.spec.ts`, 844×390) found 92 px of water between the 12 px instrument strip and the console against the
100 px it asks for (CI's fonts are taller than this container's: 104 px here). Fixed with a tighter strip on short
touch screens (9f7d09b: 120 px here). One flaky test, passed on its retry: `phase6.spec.ts`'s changed replay row did
not always diverge, because a helm already hard over, nudged outwards, is clamped back to the same input. The test now
nudges it towards the centre (bb36098). The hub's race door (`experience.spec.ts`) passed in this run and the next:
the first run's failure was not reproduced; its diagnostic stays in the test.

**Third CI run (bb36098):** shards 1, 3, 4, 5 and the checks green. Shard 2: the helm-view test (`helmView.spec.ts`,
A6) waited four drawn frames after each restart, and on CI's slow renderer the helm figure was still crossing to the
new windward deck (its eye 0.34 m from the centreline). The test now waits until the figure has settled (dce09fe);
settled, a hiking helm's eye reaches 1.006 m out, so its bound is 1.3 m rather than 1.0 m, the half-beam being
0.92 m (fac1f44). Test-only changes; the app is as in the third run.

**Fourth CI run (fac1f44, then c7e2259): the checks job failed, my mistake.** Commit dce09fe had swept in
`dist-a/`, a build made only to compare screenshots before and after, and ESLint read its minified files. Removed in
bb7b1e2 (a new commit, no history rewritten), with `dist-*/` added to `.gitignore`.

**Fifth CI run (bb7b1e2): green**, the checks job and all five browser shards.

### A.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/39 (branch `next-a-wind`, base `main`).

---

## Package B: the spinnaker and the sail controls (physics)

**The only package that adds physics.** No existing coefficient was retuned. With the spinnaker down and the new
controls at their defaults, every earlier golden trace, every earlier envelope row and the determinism hash
(`11824f89f479d0f4`) are identical (§B.3).

### B.1 What changed, by review number

| # | What | Where |
|---|---|---|
| B1, B2 (PH-3, D2, D3) | The Squib's symmetric spinnaker: 13.5 m² (C4) on a 2.14 m pole (C16). The player calls for it (O: hoist or drop; I: gybe the pole; game controller d-pad up and down; the console's Hoist/Drop and Pole buttons); the simulated crew carry each call out as a timed task (hoist 9 s, drop 7 s, pole gybe 8 s, each ±20 % by the step it starts on: no random numbers in the state) and trim it; while busy, half their hiking weight is lost; with the crew trimming they gybe the pole themselves 1.5 s after a gybe. Its force is one more sail force in the existing sums (drive, side force, yaw moment, heeling moment): heel, weather helm and a broach come out of the existing dynamics. It collapses forward of about 48–62° apparent, by the lee on the wrong side of the pole, and (by hand) when over-eased; it fills again when it can. Expert trims it by hand (Sails…). The jib behind it draws less (E, labelled pending B6) | `src/sim/boat/spinnaker.ts`, `src/sim/boat/dynamics.ts`, `src/sim/simulation.ts` |
| B2 | The AI calls for it through the same input as the player, with the same task times: hoist above 120° TWA with room before the next mark, drop below 100° or in time for the drop and a few lengths before the mark, none above 20 kn (E). AI parity extended: an AI boat's recorded inputs, fed to a plain simulation with the same parameters, give the same track with the spinnaker hoisted and dropped (`tests/sim/trustChecks.test.ts`) | `src/sim/ai/skipper.ts`, `src/sim/race/setup.ts` |
| B2 | Replays: schema `/3` (15-column input rows) only when a run uses the new controls; `/1` and `/2` still read and replay. The `/3` rows also carry the crew's request to stuff a hole, which `/1` rows dropped (issue 260: such replays diverged) | `src/app/replay.ts` |
| B3 (#25) | At Expert, the kicker, cunningham and outhaul one by one and the jib lead (Sails…). Their shares of the Flat control add up to it exactly, so "Flat" sets them as before: Flat with each set to the same value gives the same state bit for bit (tested). Manual crew weight was already there (Hike, Club and Expert) | `src/sim/boat/flatten.ts`, `src/ui/Controls.tsx` |
| B4 | The spinnaker drawn: one mesh shaped every frame between hoisting (gathered, rising), filled (round, ahead of the forestay on the pole's side), collapsing and flogging (behind the forestay, rippling) and dropping; the pole swings across in a pole gybe. Colours: the simulator's own colour sets (Settings → Spinnaker colours; AI boats in their club's colours), drawn in code, no third-party image. Drawn at every graphics preset (tested on the AI fleet at Smooth, Balanced and Ultra). Its state in words is the text alternative (read out, and on the button's tooltip): colour and words agree. Hoist, fill and collapse sounds through the cue pipeline (synthesised; no recording added) | `src/render/spinnakerView.ts`, `src/render/cues.ts`, `src/render/audio.ts`, `src/app/spinnakerWords.ts` |
| B5 | On by default in races (quick races, today's challenge, the library's practice races), the weekly course from 2026-W48, and free sailing at Club and Expert; off in lessons and the beginner exercise (they build their own scenarios). A "Spinnaker aboard" toggle in Conditions → Boat and "Spinnakers" in the race set-up. Help, README and the game controller | `src/app/quickRace.ts`, `src/app/weekly.ts`, `src/app/controller.ts`, `src/ui/*` |
| B5 | The weekly targets tool sails a course with the spinnaker with it (`tools/weekly-targets.ts` via `sailOnce`), so the targets account for the downwind legs. The app uses only targets sailed for the course it built (the targets file holds the scenario), so this week's published targets stay valid; the workflow was not run | `src/app/weeklyTargets.ts` |
| B6 | The questions for sailors (the jib with the spinnaker up, task times, collapse limits, the wind limit, who trims, broaching) are in README → Needs people | `README.md` |

### B.2 Sources and evidence levels

The ORC VPP documentation (free) could not be reached from this environment: the host was refused (HTTP 403 from the
network proxy) on 21 Nov 2026, and a request to widen the environment's network was closed unanswered. **No value was
taken from it, and no Squib target was invented.** The area and the pole are class figures (L1); the coefficient
table follows the general shape of published VPP spinnaker curves from general knowledge, every number an estimate
(E, L5); the task times, collapse limits, trim width, the jib behind it and the AI's calls are estimates (E, L6); the
split of Flat between the three controls and the jib lead's effect are estimates (E, L5). docs/SOURCES.md SP1–SP4,
docs/PARAMETERS.md, docs/PHYSICS.md §23.

### B.3 Physics checks

| Check | Result |
|---|---|
| Determinism hash, the reference race | `11824f89f479d0f4`, identical to package A |
| Golden traces (4 earlier) | Identical (regenerated: only the date line changed, restored) |
| `npm run envelope`, earlier rows | Identical to package A's (`diff` of the Markdown up to the new sections: no difference) |
| Carried and never hoisted | The same state bit for bit as without it, upwind and on a run (`tests/sim/spinnaker.test.ts`) |
| New golden traces | `spinnaker-6kn`, `-10kn`, `-16kn`: hoisted at 10 s, run from 40 s, gybed at 90 s, dropped at 150 s; its state as three extra columns |
| New envelope rows (B-SP-1…4) | On a run at TWA 150°: 2.78 → 3.38 kn at 6 kn, 4.28 → 4.88 at 10 kn, 5.61 → 6.16 at 16 kn (+0.54 to +0.60 kn); hoist 9.4 s, drop 7 s at this start step; after a gybe the pole is across in 12–16 s and the sail full a second later; no broach at 16 and 20 kn, TWA 100–140°; heel up to 25° at 20 kn, TWA 100°. Model output from estimated coefficients |
| `npm run exploits` | The earlier table unchanged; under the spinnaker no pattern beats steady sailing: sheet pumping −3.6 to −10.7 %, repeated hoist and drop −6.3 to −6.7 %, repeated pole gybes −7.9 to −8.5 %, helm rocking −0.4 to −2.7 %. The trim acts instantly (issue 259), so pumping loses the same at every period |
| AI parity | Holds with spinnakers (an AI boat hoisted and dropped over a windward-leeward race; its inputs replay to the same track) |
| `npm run perf` (quiet container) | 21 boats physics only 0.45 ms mean / 1.21 ms p99; full race pre-start 1.05 / 2.94; racing 0.85 / 2.32; **with spinnakers on the run (12–17 of 20 set) 0.90 / 2.68**: within the 3 ms budget. Under load (browser tests alongside) the leeward-mark window measured 4.01 ms p99 without spinnakers and 3.76 with them (issue 262) |

### B.4 Evidence (software rendering)

The spinnaker's states at a fixed seed (10 kn steady, a broad reach, crew trimming), `docs/img/next-b/`: hoisting
(`spin-1-hoisting.jpg`), full (`spin-2-full.jpg`, and from the bow quarter `spin-6-full-orbit.jpg`), collapsed and
flogging after being eased right out by hand (`spin-3-collapsed.jpg`, the button's colour red with "Spinnaker
collapsed: eased too far"), gybing the pole (`spin-4-gybing-pole.jpg`) and dropping (`spin-5-dropping.jpg`). The same
states are checked by the physics' state and the words in `tests/e2e/spinnaker.spec.ts`, which keeps a screenshot of
each with its results. Nothing here was judged on a real GPU.

### B.5 Accessibility

The spinnaker's state in words is a polite live region and the button's tooltip; its colour agrees with the words
(good only when drawing). The buttons are labelled with their keys ("Hoist the spinnaker (O)"); on a touch phone they
are 44 × 44 px (the console's rule). Learn's words are plain ("Big front sail full", "falling in"). Expert's sail
controls are a labelled dialog with labelled sliders.

### B.6 What is left from package B

- The coefficients need a source (issue 258): the ORC documentation from an environment that can reach it, and the
  validation session (#28) with the B6 questions.
- The trim has no sheet dynamics (issue 259); the AI polar does not know the spinnaker (issue 261).
- Little frame-time margin with twenty boats at a mark, with or without spinnakers (issue 262).
- Weekly targets with the spinnaker need the scheduled job to run for 2026-W48 after merging (issue 263).

### B.7 Estimates introduced (E)

Every figure in docs/PARAMETERS.md "The spinnaker and the sail controls" except the area and the pole.

### B.8 Checks

Locally (cloud container, software rendering): typecheck, lint, 876 unit tests (130 files), the build with the
secret scan, the hash, the golden traces (7), `npm run envelope` (earlier rows identical), `npm run exploits`,
`npm run perf` (§B.3). Browser tests run locally one file at a time: `spinnaker.spec.ts` (new), the console widths
at every size (`immersive.spec.ts`), the phones' 44 px controls (`console.spec.ts`), the 24 px / 12 px floor
(`a11y.spec.ts`), touch on a tablet (`juniors.spec.ts`), the masthead and look-up (`wind.spec.ts`), layout, phone.
The first local run caught the new buttons overflowing the console's crew module at 360 px; they moved to a tab on
the console's top edge (left on a laptop, right on a phone). The cue test caught a "collapsed" sound firing during a
drop; it now fires only for a set spinnaker. CI runs the whole suite and is the authority; its result is on the pull
request (§B.9).

**First CI run on the pull request (269d5a8): green.** The checks job (typecheck, lint, unit tests, build with the
secret scan, the envelope) and all five browser shards passed, the new `spinnaker.spec.ts` included. Later commits
on this branch only merge package A's test fixes (§A.8).

**Second CI run (22abcc9, merging package A's test fixes): one defect found and fixed.** The checks job failed on
package A's committed preview build (§A.8). Shard 1: `ghost.spec.ts` found a ghost boat (ghost racing) with 42 of its
44 meshes see-through: the spinnaker and its pole, made the first time the ghost's recording carried one, after the
rest of the ghost had been made see-through, were drawn solid. The ghost's spinnaker is now see-through too, and keeps
its see-through copy when its colours change (`src/render/ghostLook.ts`, `src/render/squibModel.ts`); regression test
`tests/render/ghostSpinnaker.test.ts` (fails before: `spinnaker-sail` and `spinnaker-pole` solid). Issue 265.

**Third CI run (a463eda, the fix): green**, the checks job and all five browser shards.

Screens added this package (`docs/img/next-b/`): the spinnaker's states (§B.4), the console's tab on a laptop and a
phone (`console-tab-laptop.jpg`, `console-tab-phone.jpg`), Expert's sail controls (`sail-controls-expert.jpg`).

### B.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/40 (branch `next-b-spinnaker`, base `next-a-wind`, so its
diff shows package B alone; it follows package A, https://github.com/DrDK3/SailSim/pull/39).

## Package C: the low preset, trees and compact replays (no physics)

**No physics.** The determinism hash, the golden traces and `npm run envelope` are identical to package B's (§C.6).
The player's controls are now kept on a grid of thousandths (C.1): no coefficient changes, and those checks do not go
through the app's controls.

### C.1 What changed, by review number

| # | Change | Where |
|---|---|---|
| Low preset: water | **Start Bay's stripes at the lowest preset** (Smooth draws "simple" water). Simple water drew five ripple trains at regular wavelengths (0.12 m × 2.2ⁿ, the longest 2.8 m, no jitter), which ran in step across the bay as parallel bands. It now draws every other train of the detailed water's spectrum (seven of thirteen: the same jittered wavelengths and spread of directions), fades each train before the pixel reaches half its wavelength (the preset draws at three-quarters resolution), and varies alternate trains in patches some 30–60 m across. Detailed water (Balanced and Ultra) is unchanged | `src/render/water.ts` (`LOW_RIPPLES`, `ripples()`) |
| Low preset: sky | **The sky and horizon at the lowest preset**: compared with Balanced in the same conditions they are the same (the same dome, gradient and haze; the two presets differ in the water, not the sky). Nothing needed changing, so nothing was changed | — |
| Low preset: lighter | **Impostors for far trees**: beyond 1,400 m, at the lowest scenery detail (the Performance preset), each tree is two crossed quads with a silhouette drawn in code (4 triangles against about 30), casting no shadow. Kept on the evidence of §C.3: fewer triangles and draw calls than without them, no measurable change in frame time. **Not done**, because they would not help here: merged geometry (the trees are already one instanced mesh per chunk and shape; the buildings are already merged into one mesh per map tile), texture atlases (the scene uses 35–48 textures, no draw-call problem from them), and density by distance (the woods already end at 2.7 km and coarsen beyond 850 m) | `src/render/trees.ts`, `src/render/dart.ts` |
| #35 | **Trees in several shapes**: three broadleaf crowns (round, tall and narrow, broad and flat-topped) and two conifers (a cone, and a pine with a bare trunk and a flat crown), each one instanced mesh per chunk. The shape comes from a hash of the tree's position, so every tree stands where it stood and none is added (tested: the same positions and count whichever band draws them). Billboards: the impostors above | `src/render/trees.ts` |
| #12 (issue 214) | **Compact replay inputs**: a new schema, **`squib-replay/4`**, stores the input log as small integers, one row per change: the steps since the last change, a mask of the controls that changed, and only their new values. To make every value a whole number, the player's controls are kept on a grid of thousandths of their travel (`quantiseInput`; E: below anything a person can set or feel); the file decodes to the very inputs sailed (a seeded property test over every control). A held sheet key keeps its exact rate (its position is accumulated, only the input is on the grid; rounding each step would have made it 14 % fast). Written whenever every input is on the grid (any run of this build); otherwise the recording is written as before. **Every older schema (/1, /2, /3) still reads and replays**, as do share links and saved runs (they carry the same recordings): tested by converting this build's recordings to the row form and replaying them bit for bit, and by the earlier files' tests. An older build refuses a /4 file rather than replaying it wrongly | `src/app/replay.ts`, `src/app/controller.ts` |
| Issue 264 (found here) | **A control handed back did not replay as handed back** (package B's /3 rows; fixed): the replay fed each recorded input to the simulation as a change, and the simulation merges changes, so a kicker or jib lead handed back to the Flat control (recorded as "not set") kept its last value in the replay, which then diverged. A recorded input now replaces the whole input. Regression test: a kicker set and handed back replays bit for bit in the compact and in the row form | `src/app/replay.ts` (`replacingInput`), `src/app/controller.ts` |

### C.2 Evidence (software rendering)

- **Water at the lowest preset**, Start Bay, 16 kn, the same scene before (the build before this round) and after:
  [`docs/img/next-c/water-low-before-after.jpg`](img/next-c/water-low-before-after.jpg). Before: bands of regular
  stripes radiating across the bay. After: the ripples vary in size and direction and patch; the long swell's
  pattern far off is the sea's wave trains, which the detailed water shows as well.
- **Trees**, the benchmark's fixed views before and after at the lowest preset:
  [`trees-drone-harbour.jpg`](img/next-c/trees-drone-harbour.jpg), [`trees-golden-river.jpg`](img/next-c/trees-golden-river.jpg).
  At these sizes the difference is hard to see; the shapes and the unchanged positions are checked by
  `tests/render/trees.test.ts`.
- **Against the rubric** (JUNIORS_REPORT §2.3): the horizon and the sky are unchanged and clear; the water keeps its
  colour and loses the regular stripes ("no shimmer"); the boat, landmarks and light are untouched; the impostors
  are only beyond 1,400 m, where a tree is a few pixels. Whether Smooth now looks better is the owner's judgement.

### C.3 Graphics figures (`tools/gfx-bench.mjs`, the lowest preset, software rendering, relative)

Eight fixed views; each cell is render time (ms, one frame under SwiftShader at 1280 × 720) / draw calls / triangles
(M). The last column is what this package ships: five shapes near (inside 850 m), one shape a family beyond,
impostors beyond 1,400 m.

| View | Before | Five shapes everywhere, no impostors | Five shapes everywhere + impostors (run 1 / run 2 ms) | **Shipped** |
|---|---|---|---|---|
| chase-river | 3003 / 350 / 2.83 | 2673 / 433 / 2.82 | 2619, 2522 / 394 / 2.65 | 3350 / 370 / 2.65 |
| helm-river | 2994 / 366 / 3.08 | 2821 / 463 / 3.04 | 3704, 2838 / 417 / 2.85 | 2893 / 393 / 2.85 |
| sail-close | 3935 / 675 / 3.50 | 4083 / 762 / 3.45 | 3676, 3956 / 710 / 3.23 | 3806 / 692 / 3.23 |
| wake-stern | 798 / 131 / 0.96 | 825 / 131 / 0.96 | 754, 797 / 131 / 0.96 | 779 / 131 / 0.96 |
| chase-sea | 774 / 131 / 0.96 | 726 / 131 / 0.96 | 997, 702 / 131 / 0.96 | 733 / 131 / 0.96 |
| golden-river | 2801 / 337 / 2.66 | 2656 / 414 / 2.62 | 2908, 2628 / 377 / 2.54 | 2796 / 356 / 2.53 |
| backlit-sails | 3478 / 375 / 3.27 | 3426 / 483 / 3.29 | 3015, 2889 / 426 / 2.80 | 3229 / 399 / 2.79 |
| drone-harbour | 2171 / 388 / 3.16 | 2848 / 465 / 3.07 | 2293, 1986 / 435 / 2.91 | 2050 / 414 / 2.91 |
| **Total** | **19953 / 2753 / 20.41** | **20058 / 3282 / 20.20** | **19966, 18320 / 3021 / 18.89** | **19636 / 2886 / 18.87** |

Five shapes everywhere cost 19 % more draw calls (each chunk drew up to five meshes instead of two) and pushed
sail-close past the Smooth budget of 700 calls proposed in JUNIORS_REPORT §2.4. Far off a crown is a few pixels and
its shape does not show, so the shipped version keeps the shapes near only: **7.5 % fewer triangles and 4.8 % more
draw calls than before**, every view inside the proposed Smooth budget (≤ 700 calls, ≤ 3.5 M triangles).
Frame time: the same build measured 19966 and 18320 ms in two runs (and the shipped build was measured while other
tests ran), so the run-to-run noise is as large as any difference; **no change in frame time is claimed**.

### C.4 Replay sizes (measured)

Ten minutes of sailing each, the input log alone (a replay adds its scenario and checkpoints, a few kB). Compressed
is deflate, as links and club submissions send it. Reproduce with
`REPLAY_SIZES=1 npx vitest run tests/sim/replaySizes.test.ts` (one minute each by default, as a test). "Before" is
the old controller's log in this round's row form; the middle column is this build's log (on the grid) in the row
form, to separate the two effects; "after" is what this build saves (/4).

| Run (10 min) | Before: changes, JSON, compressed | Same run on the grid, row form | After (/4): JSON, compressed | Compressed, before → after |
|---|---|---|---|---|
| Keyboard (a key held for 1.2 s every 5 s) | 14,826; 750 kB; 50 kB | 14,826; 451 kB; 44 kB | 120 kB; 2.2 kB | 22× smaller |
| Game controller (the stick moving every frame) | 41,816; 1.91 MB; 484 kB | 40,337; 1.30 MB; 197 kB | 337 kB; 81 kB | 6× smaller |
| AI-style helm (changes every step) | 56,452; 3.47 MB; 703 kB | 35,421; 1.15 MB; 154 kB | 275 kB; 56 kB | 12.6× smaller |

The grid alone (shorter numbers; for a stick or an AI, fewer changes, since a change smaller than a thousandth is no
change) halves to quarters the compressed size; writing only what changed then takes it down 2.4–2.8× more for a
stick or an AI and 20× for keys (whose changes repeat exactly). A share link is the compressed replay in base64,
about 4/3 of its size: a 10-minute stick-steered run is now about 110,000 characters, under the 150,000 limit (it was
about 645,000, not offered). The AI line stands for the app's own steering of the player's boat ("show me",
lessons), whose inputs go through the same grid; AI boats themselves are not recorded (they are re-sailed from the
seed).

### C.5 Accessibility

No interface changed. The replay panel's message counts the input changes in either form.

### C.6 Checks

Locally (cloud container, software rendering):

- typecheck (app, simulation and tests, tools), lint, the build with the secret scan;
- unit tests: 894 in 134 files before the last fixes, all passing after them. The first full run found five
  failures, all mine: two hand-over tests demanded 1e-9 where the grid now allows half a step (0.0005); the
  held-sheet rate bound was one float epsilon too tight; the tree test's wood was too big for one camera to see
  all of it in the impostor band;
- the determinism hash (`11824f89f479d0f4`, unchanged), the seven golden traces (identical with the date field
  removed), `npm run envelope` (identical to package B's, every row);
- new tests, each failing before its change: `replayCompact.test.ts` (round trip, malformed files, the older
  schemas, a compact run and its row form replaying bit for bit, a control handed back, the held key's rate),
  `waterLow.test.ts` (the low spectrum is the detailed one's, no regular ratio), `trees.test.ts` (shapes, the same
  positions, impostors);
- the browser test of replays (`phase6.spec.ts`) now checks the saved file is /4 and that its row form (/1) plays
  and is caught when changed.

CI runs the whole browser suite and is the authority; its result is on the pull request (§C.9).

### C.7 What is left from package C

- Whether Smooth now looks better, and the tree shapes, need the owner's eye (and a real GPU, #32).
- The near trees' shapes still cost some draw calls (+4.8 % in total at the lowest preset); drawing every shape of a
  chunk in one call (a shape attribute per instance) would win them back. Not needed within the budget measured here.
- Recordings of a run sailed with an older build's inputs (off the grid) are still written in the row form.

### C.8 Estimates introduced (E)

The input grid (thousandths of each control's travel), the impostor distance (1,400 m), the tree shapes' proportions
and the equal share of each shape, the water patches' size (30–60 m): E, L6, chosen for the eye and the file size,
not measured against anything.

### C.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/41 (branch `next-c-graphics`, base `next-b-spinnaker`, so
its diff shows package C alone; it follows package B, https://github.com/DrDK3/SailSim/pull/40). **CI on 0a06dcd:
green**, the checks job and all five browser shards.

---

## Package D: the Learn map and the instructor view (no physics)

**No physics.** Nothing in the simulation changed; the hash, the golden traces and the envelope are identical
(§D.6). Nothing was removed: every lesson, exercise and challenge is where it was, and every honesty label that left
the player's screens is kept in About and shown again, where it applies, in the instructor view.

### D.1 What changed, by review number

| # | Change | Where |
|---|---|---|
| #13 | **The Learn map** (Settings → Learn map; on later visits also "Learn map: what to do next" in the welcome): one ordered path through the six basic lessons, the three seamanship lessons, the two exercises and four challenges (today's challenge, a start drill, a race against the AI, this week's course). Each step is marked done, started or not yet, with a fact where there is one (a best time, attempts completed), and the next step is suggested with a Start (or Carry on) button: the first step not done; once all are done, today's challenge. **Done** is read from what the app already keeps in this browser: a finished lesson, a completed exercise attempt, a time today in today's challenge, a best start, a best on any other course, a time on this week's course. The map's own record (the steps started from it) is kept in this browser too, every read and write wrapped so a private window or blocked storage never breaks it. It removes nothing: the lessons and exercises are still in Settings → Lessons, the races, today's challenge and the weekly course in Race. No streaks, rewards or reminders (under-18 safeguards) | `src/app/learnMap.ts`, `src/ui/LearnMap.tsx`, `src/ui/App.tsx`, `src/ui/Welcome.tsx` |
| #14 | **The instructor view** (Settings → Instructor view, or the Settings menu; kept in this browser). On, the screens show where each figure comes from and its evidence label, the exercises' content status and provisional thresholds, the attempt-by-attempt assist record and the instructor tools (thresholds and records as files), and, in the Learn map, each exercise's assist record (attempts on the learner's own and assisted, and whether the thresholds were changed). Off (the player view, the default), those labels are gathered in About | `src/ui/trust.tsx`, `src/app/prefs.ts`, `src/ui/SettingsPanel.tsx` |
| #14 | **The labels moved** from the player's screens to About (and the instructor view): the Squib types' provenance column (S, E); "appearance only: the crew weight is an estimate"; both illustrative-stream notes; the short course's "(model output)"; "the effects are estimates (E)" under Expert's sail controls; the coach's "rules of thumb (estimates)"; damage's "thresholds, sizes and rates are estimates (E)"; the results' finishing-window estimate; the exercises' "Content: … Thresholds provisional (E)", attempts table and instructor tools. **Kept in the player view**, as safety or understanding rather than provenance: "Not for navigation" (depth, minimap, About, the welcome), the results' "Simplified rules, not an authoritative adjudication", "pending club check" on the RDYC courses, the weekly targets' "the simulator's expert AI (not people)", the option labels themselves ("Illustrative tidal stream"), the tooltips, and Settings → Layers and sources | the panels named, `src/ui/About.tsx` |
| #14 | **One "How far to trust this" link** in the player view, beside "All instruments and conditions": it opens About at "How far to trust this: the labels, one by one", which lists every label above in the same words and says where the instructor view shows them. On a phone's one-row instrument strip the link is not shown; About is in the Settings menu there | `src/ui/Instruments.tsx`, `src/ui/About.tsx` |
| Found here | **The close button of the welcome, About and the Learn map** was 34 × 34 px on touch screens (the 44 px rule): now 44 px on touch screens | `src/ui/styles.css` |

### D.2 Evidence (software rendering)

Screens at fixed settings (`docs/img/next-d/`): the player view's link beside the instruments
(`player-view-link.jpg`); About opened from it at the labels (`about-trust-labels.jpg`); Conditions in the player view
(`conditions-player-view.jpg`, no fine print) and in the instructor view (`conditions-instructor-view.jpg`, the
labels where they apply); the Learn map on a laptop (`learn-map-laptop.jpg`) and on a phone (`learn-map-phone.jpg`).
On a laptop the link wraps to its own line under "All instruments and conditions", so the instruments panel is about
24 px taller in the player view.

### D.3 Accessibility

The Learn map is a labelled dialog (Escape closes it, focus returns) with a heading per group and an ordered list;
each step's state is in words (done, started, next), not colour alone; on a touch phone every button is at least 44 ×
44 px and nothing scrolls sideways (`tests/e2e/learnMap.spec.ts`). About opened from the link moves focus to the
labels' heading. axe-core (WCAG 2 A/AA rules) finds no violations in the Learn map or About.

### D.4 What is left from package D

- Which labels instructors want inline, and whether a junior needs more or less in the player view: for the
  validation session (#28) and the club's instructors (needs people).
- The Learn map counts a challenge done from the bests the app keeps: a race abandoned before the finish leaves no
  best, so it does not count; a lesson finished on another device does not count (nothing leaves the browser).
- The link is not on the phone's instrument strip (About is in the Settings menu there).

### D.5 Estimates introduced (E)

None: the Learn map's order follows the existing lessons and exercises; its "about N min" figures are the lessons'
and exercises' existing estimates.

### D.6 Checks

Locally (cloud container, software rendering):

- typecheck, lint, the build with the secret scan; unit tests **904 in 136 files, all passing** (new:
  `learnMap.test.ts`, 7 tests: the order, done from each store, the next step, storage that throws);
- **the reference race hash**: `8f30a5cf5c450344` on `main` (before this round) and on this branch, identical. The
  reference race was a scratch script in earlier rounds (quoted as `11824f89f479d0f4`); the container was restarted
  during this package and the script was lost, so the reference race is now a committed tool,
  `tools/race-hash.ts` (7 AI boats, 400 s, the River Dart data, the channel-following stream), run on both commits;
- the seven golden traces identical (with the date field removed); `npm run envelope` identical to package C's,
  every row;
- browser tests run locally: `learnMap.spec.ts` (new: the player and instructor views, About at the labels, the Learn
  map started and noted, a touch phone's 44 px targets, axe-core on About and the Learn map), all passing; a run of the
  other suites the package touches (accessibility, the welcome, the phone console, the tablet, the exercises) was
  stopped by the container restart at 10 of 19 tests, none failed up to then. `smoke.spec.ts` and
  `training.spec.ts` now turn the instructor view on where they check the labels, and check the player view first.
  CI runs the whole suite and is the authority (§D.8);
- the grep for RYA, "validated" and "realistic" claims: none added.

**CI on the earlier packages, recorded here:** package C's pull request (0a06dcd) is green, the checks job and all
five browser shards.

### D.7 Under-18 safeguards

No free text, accounts or personal data were added; the Learn map keeps only step ids in this browser; no streaks,
reminders or rewards for coming back.

### D.8 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/42 (branch `next-d-learn`, base `next-c-graphics`, so its
diff shows package D alone; it follows package C, https://github.com/DrDK3/SailSim/pull/41). CI's result is recorded
in the next package's report.

---

## Package E: sharing (no physics)

**No physics.** The simulation is untouched; the reference race hash, the golden traces and the envelope are
identical (§E.7).

### E.1 What changed, by review number

| # | Change | Where |
|---|---|---|
| #37, #38 | **The page's description** no longer says "Phase 1 prototype": "Sail a National Squib keelboat on the River Dart and in Start Bay, in your browser: short lessons, free sailing, and races against AI boats. A simulator, not for navigation." **Open Graph and Twitter card tags** with an absolute image URL (`https://drdk3.github.io/SailSim/social-card.jpg`, 1200 × 630, its alt text saying it is a render from the simulator, not a photograph). Tested on the built page served as the site is (`tests/e2e/share.spec.ts`: the description, the absolute URLs, the image's size and that it loads) | `index.html`, `public/social-card.jpg` |
| #37 | **`npm run media`**: deterministic renders of the simulator itself, headless with the software renderer: a hero image (1600 × 900), social cards (1200 × 630: the river, an evening, the harbour from above, a race), and a 24-second trailer encoded by ffmpeg (H.264, `-preset veryfast`, no sound). Fixed places, times, winds and seeds, so the same build makes the same pictures; each frame carries the caption "simulator output, not a photograph"; no music, voices, third-party images or fonts; no people, results or records. `media.json` records what was made | `tools/media.mjs`, `public/media/` |
| #39 | **A web app manifest and icons**: name, colours, start URL `./`, standalone display; icons at 192 and 512 px and a maskable 512 px, rendered from the simulator's own mark (`npm run icons`). **No service worker**: see §E.2 | `public/manifest.webmanifest`, `public/icons/`, `tools/icons.mjs` |
| #40 | **A static landing page** at `landing.html`, beside the app, whose address does not change: what you can do, the trailer, how far to trust it, the RDYC's approval in its recorded words. No scripts, cookies or third-party fonts or images; light and dark; tested for axe-core, text alternatives, 44 px buttons and no sideways scroll on a phone | `public/landing.html` |
| #40 | **Names**: proposed in §E.3; no rename, no domain | — |
| #41 | **About leads with what you can do**: learn, sail the Dart, race, practise, look back, teach (each a line, each something the simulator already does), then what it is, then how far to trust it and the labels | `src/ui/About.tsx` |
| RDYC | The approval is recorded (package A): "The RDYC has approved use of the club's name and burgee (owner, 20 Nov 2026)." The landing page quotes it and claims nothing wider | `docs/CLUB_DOCUMENTS.md`, `public/landing.html` |
| NSOA | A note to the National Squib Owners' Association is drafted below (§E.4). **Not sent** | this report |

### E.2 Why there is no service worker

A service worker was allowed only if it fetched `live/`, `club/` and the weekly files network-first and an end-to-end
test proved it. It is left out, for these reasons:

- **Nothing asked for offline use**, and the simulator's River Dart data (about 12 MB) would make an offline cache
  large on a phone.
- **A stale build is a real risk here**: replays and club-table submissions are checked against the build that made
  them (src/app/clubVerify.ts), and a cached older build after a deploy would make a sailor's run "built by another
  version". A service worker's update lifecycle (the old one serves until every tab closes) makes that likelier.
- **The live weather, the club table and the weekly targets must always be fresh**; without a service worker the
  browser's ordinary HTTP caching already does that, with nothing to get wrong.
- With the manifest, a browser can add the simulator to a phone's home screen with its name and icon. Whether a
  given browser also offers an install prompt without a service worker varies by browser and version (not checked
  here, and not asked for).

The end-to-end test checks that no service worker is registered (`share.spec.ts`).

### E.3 Names (proposals only: no rename, no domain bought)

1. **Squib Sim**: short; says what it is; the manifest's short name already.
2. **Dart Squib**: the place and the boat.
3. **Squib on the Dart**: the same, as a phrase.
4. **Kingswear Squib Simulator**: the club's side of the river; long.
5. **Start Bay Squib**: the open-water half of the simulator.

None was checked for trade marks or domain availability (that is for the owner). The current name, "Squib Sailing
Simulator", stays.

### E.4 A note to the NSOA (draft, not sent)

> Dear National Squib Owners' Association,
>
> I am writing about a free browser simulator of the National Squib, sailed on the River Dart and in Start Bay,
> made for juniors and club sailors at the Royal Dart Yacht Club (the RDYC has approved the use of its name and
> burgee). It is at https://drdk3.github.io/SailSim/ (an overview: https://drdk3.github.io/SailSim/landing.html).
>
> It is a teaching and practice tool, not a performance prediction: the boat moves by a physics model whose
> dimensions come from the class rules and whose water and sail coefficients are estimates. Nothing in it has been
> checked against a real Squib yet, and the simulator's About page says so, label by label.
>
> If the Association were willing, three things would help most: (1) any polar or speed data the class holds;
> (2) a few experienced Squib sailors to try it and tell us where it is wrong (a list of questions is ready,
> including how the spinnaker is set and trimmed); (3) your view on how the simulator should describe the class.
> We would not use the Association's name or marks without permission.
>
> With thanks,
> [the owner]

### E.5 Evidence

Made by `npm run media` (and `npm run icons`) from this build, headless in Chromium's software renderer
(SwiftShader); every picture is the simulator's own frame with the caption "Squib sailing simulator · simulator
output, not a photograph". The scenes are fixed in `tools/media.mjs` (place, time, wind, seconds sailed, camera); the
gusts are set to steady, so the same build draws the same pictures. `public/media/media.json` records each one.

| File | Size | Scene |
|---|---|---|
| `public/social-card.jpg` (the card the sharing tags point at) | 1200 × 630, 92 kB | The river off the RDYC, 15 Jul 11:00, 12 kn from 225°, chase camera, the high preset |
| `public/media/hero.jpg` (the landing page's picture and the trailer's poster) | 1600 × 900, 155 kB | The same scene |
| `public/media/social-evening.jpg` | 1200 × 630, 96 kB | The river at 18:30, 10 kn from 250° |
| `public/media/social-harbour.jpg` | 1200 × 630, 93 kB | The harbour from above (drone camera), 11:00, 12 kn from 225° |
| `public/media/social-bay.jpg` | 1200 × 630, 56 kB | Start Bay's practice area, 13:00, 14 kn from 225° |
| `public/media/trailer.mp4` | 960 × 540, 24 s at 24 fps, 866 kB | One sail on the river: chase camera, the harbour from above (from 8 s), chase again (from 16 s). Drawn at the lowest preset (each frame takes seconds in software; the high preset would take hours). H.264 (libx264, `-preset veryfast`, CRF 24), no audio track |
| `public/media/trailer.vtt` | captions | Each third of the trailer described, each line starting "[No sound]" |

The trailer is a picture of the simulator, not a demonstration of how to sail. A social card of a race was tried
and dropped: at the fixed time the chase camera had no other boat in view; the Start Bay card replaced it. No
results, records or people's names appear in any picture.

### E.6 What is left from package E

- The trailer and cards are software renders (no GPU here): on a real GPU the simulator draws more (reflections,
  finer water) than they show.
- Sending the NSOA note, choosing a name and any domain: needs people (the owner).
- Whether an offline mode is wanted (then a service worker, network-first for live data, with its test).

### E.7 Checks

Locally (cloud container, software rendering):

- typecheck, lint, the build with the secret scan (48 files, 12.5 MB in `dist/`, no secret found); unit tests **904 in
  136 files, all passing** (package E adds no unit test: what it changes is pages and files, tested in the browser);
- **the reference race hash** (`tools/race-hash.ts`): `8f30a5cf5c450344`, identical to `main` and package D; the
  seven golden traces identical (with the date field removed); `npm run envelope` identical to package D's, every row;
- browser tests, against the production build: `share.spec.ts` (new: the built page's description and sharing tags,
  their absolute image URLs, the card, the manifest and every icon it lists, no service worker; the landing page's
  axe-core check (WCAG 2 A/AA rules: no violations), text alternatives, a muted video, the trailer, its poster and
  captions served with their types, 44 px buttons and no sideways scroll on a phone, and "Start sailing" opening the
  app), `learnMap.spec.ts` and `welcome.spec.ts` (both open About, which now leads with what you can do): **all
  passing**. The welcome's first-visit test ran out of time at the local allowances while the AI trials were using
  the processor, and passed with CI's (`CI=1`, the trials paused): it is slow here, not failing. CI runs the whole
  suite and is the authority (§E.9);
- the grep for RYA, "validated", "realistic", accreditation and "open source" in what package E adds: one match, the
  landing page's "Nothing in it has been validated against a real Squib".

**CI on the earlier packages, recorded here:** package D's pull request (371da2d) is green, the checks job and all
five browser shards.

### E.8 Assets and licences

Every new image and the trailer are the simulator's own renders (made by `npm run media` and `npm run icons` from
this repository); the icons draw the simulator's own mark. No third-party asset was added; no font, music or sound.

### E.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/43 (branch `next-e-share`, base `next-d-learn`, so its
diff shows package E alone; it follows package D, https://github.com/DrDK3/SailSim/pull/42). CI's result is recorded
in the next package's report.

---

## Package F: simplified rule 18 and AI fleet safety (no physics)

**No physics changed.** The boat model is untouched: the golden traces and `npm run envelope` are identical (§F.8). What
changed is the race judge (rule 18) and the AI skippers' decisions, so the reference race (seven AI boats) sails
differently: its hash changes, as it must, and both values are recorded in §F.8.

### F.1 What changed, by review number

| # | Change | Where |
|---|---|---|
| #26 | **Simplified rule 18, mark-room.** The zone is three hull lengths of the boat nearer the mark (17.4 m for a Squib), measured to any part of her hull. Rule 18 applies between boats bound for the same mark on the same leg and leaving it on the same side, once either is in the zone. It does not apply between boats on opposite tacks both beating, or between a boat approaching a mark and one leaving it. When the first of two boats reaches the zone (18.2(a)): if they are overlapped, the outside boat must give mark-room; if not, the boat that has not reached the zone must give it. This lasts until the entitled boat leaves the zone, passes head to wind, or rounds. At a contact while it lasts, the boat owing mark-room is at fault under rule 18.2 (a Two-Turns Penalty), and the protest room says so in plain words. **Labelled "simplified, not authoritative"**: what mark-room is, 18.2(c)–(e), 18.3, 18.4 and rule 21 are not judged | `src/sim/race/markRoom.ts`, `src/sim/race/session.ts`, `src/app/protestRoom.ts`, `docs/RACING.md` |
| #27, issue 42 | **The AI in big fleets**, each change aimed at a cause found by replaying the trials' contacts (§F.5): (1) the start spots spread over the usable line (the two boats nearest each end had been sent to one spot); (2) fleets of three or more wait in three staggered rows, at least about 37 m apart; (3) half the room asked of a boat that holds its distance alongside; (4) marks kept clear of the bow and the stern, not only the hull's centre; (5) avoidance never steers within 5° of a dead run; (6) at a mark, the boat owing mark-room keeps clear; (7) between two finished boats, the rules decide who keeps clear; (8) a collision reflex held over 5 s between boats side by side, away from marks, is broken by the boat keeping clear dropping back. Two other ideas were tried and dropped. Detail in `docs/RACING.md`, "The AI in big fleets" | `src/sim/ai/skipper.ts`, `src/sim/race/session.ts` |
| Found here | **The AI parity test replayed from the wrong starting controls.** It built its plain simulation after the run with the AI's input object as it was at the end, not at the start; it passed only while the AI happened to end with the controls it began with. It now replays from a copy of the starting controls, and passes on both the old and the new AI (to 1e-6 m) | `tests/sim/trustChecks.test.ts` |

### F.2 Sources and evidence levels (rule 18)

The World Sailing text of the Racing Rules of Sailing 2025–2028 could not be fetched: the host is refused from this
environment (issue 32). Rule 18 therefore follows secondary copies quoted in web-search excerpts: sailzing.com's rule
18 pages, the Asian Sailing Federation's printing of the rules, Dave Perry's overview for US Sailing, Sailing Canada's
presentation, the RYA's summary of changes, and US Sailing Appeal 130. They are recorded as SOURCES RR11: **search
excerpts only, no page opened** (L3). The sources differ on one point: whether the 2025 wording of 18.2(a)(2) changed
who gets room (the RYA calls it layout only; Perry and others say the boat reaching the zone first, not the one clear
ahead, is entitled). The simulator follows the second reading and says it is simplified. The "beating" test for the
opposite-tacks exception (within 80° of the true wind) is an estimate (E).

### F.3 Rule 18 scenario tests

`tests/sim/markRoom.test.ts` (6 tests):

1. The zone's size, measured to the hull.
2. Overlapped at the zone: the inside boat is entitled, and the ruling is 18.2, labelled simplified.
3. Clear ahead at the zone: she keeps her entitlement when the boat astern later gets an inside overlap.
4. No rule 18 between opposite tacks beating; rule 18 does apply on opposite gybes downwind.
5. No rule 18 between boats bound for different marks or rounding on different sides.
6. The entitlement ends when she leaves the zone, tacks or rounds.

### F.4 AI fleet safety: the trials

`npm run ai:trials` (`tools/ai-trials.ts`): seeded AI-only races, a one-lap windward–leeward or triangle in the Start
Bay practice area, wind 6–16 kn from any direction, a five-minute sequence. A race is clean only if every boat
finishes, no boat touches another boat, a mark, the committee boat or the bottom, and no boundary is crossed. "Before"
is the code as it was (package E's AI; the simplified rule 18 changes rulings, not the AI, so it cannot change whether
a race is clean); "after" is this package.

**The measure: seeds 101–200, never used for tuning** (`--first 101`):

| Fleet | Before: clean | After: clean | Contacts before → after | Boats finishing |
|---|---|---|---|---|
| 10 boats | **79 of 100** | **81 of 100** | 42 → 26 | 99.8% → 99.9% |
| 5 boats | 92 of 100 | **98 of 100** | 13 → 2 | 100% → 100% |
| River, 5 boats (20 races, the Range sausage, 1.5 kn flood) | 15 of 20 | 16 of 20 | 9 → 3 | 95% → 99% |

**The target was missed.** Package F aimed to take clean 10-boat races from about 77% to at least 90%. On the seeds
never used for tuning they went from 79 to 81 of 100. That is within the noise of 100 races: a change of two races
proves nothing either way. The number of contacts fell by 38% (42 to 26), and the 5-boat fleet did not fall: it rose
from 92 to 98. The tuning seeds overstated the gain (below), so the trial-to-trial spread is large. What is left is
spread across the race, with no single cause: 6 pre-start contacts, 5 mark touches, 5 contacts while racing, 2
line-end touches at the start, and 1 boat that did not finish (§F.6).

**Tuning: seeds 1–60, 10 boats** (the order the candidates were tried; each builds on A unless named):

| Variant | Clean | Pre-start contacts | Mark touches | Kept? |
|---|---|---|---|---|
| Before | 43 / 60 (72%) | 12 | 1 | — |
| A: start spots, dead runs, mark-room, finished boats | 45 / 60 (75%) | 6 | 3 | yes |
| A + waiting rows (H) | 44 / 60 (73%) | 4 | 6 | yes (fewer pre-start contacts) |
| A + H + half room alongside (P) | 49 / 60 (82%) | 4 | 3 | yes |
| A + H + P + the stern at marks (S) | 50 / 60 (83%) | 4 | 1 | yes |
| A + H + P + S + lock break (L) | 49 / 60 (82%) | 5 | 2 | yes: every boat finished (the lock in seed 17 broken), 13 contacts against 17 |
| A + a later reflex for the right-of-way boat (R), + a near-hard limit at marks (M) | stopped at 17 races (5 not clean) | — | — | no |
| A + H + L + M | stopped at 24 races (9 not clean; 3 windward-mark touches) | — | — | no |

Changing any part of the AI reshuffles which seeds fail, because a race is chaotic. 60 races cannot separate 75% from
82% with confidence, so each change was also judged by what it was for: the pre-start contacts it should remove, the
mark touches, the locks. Each also has a unit test of its mechanism (§F.8). One change was found to cost speed: the
waiting rows moved where a lone boat starts, and on the week's junior course the good AI took 607 s, over the 600 s
sizing check. Fleets of one or two now keep their slots (562.5 s, against 563 before; issue 270).

### F.5 Evidence (what caused the contacts)

The failing races (the baseline's on seeds 101–200, and seed 17 from a tuning run) were replayed with a diagnostic that prints both boats' positions, speeds and intentions
for the seconds before each contact (a scratch tool, not committed). What it showed, and which change answers it:

| Seen in | What happened | Change |
|---|---|---|
| Every fleet size (a unit test reproduces it) | Two boats were sent to the same spot on the starting line, 0 m apart | (1) |
| Seeds 105, 149, 165 (pre-start) | Boats waiting 17.6 m apart drifted into each other, or met while sailing back to their places; both "avoiding" for 10 s or more before the contact | (2), (3) |
| Seeds 17, 181 (windward mark) | Pushed inside her rounding circle by another boat, a boat bore away and her stern swung onto the mark | (4) |
| Seeds 120, 152 (the run) | An avoiding boat steered dead downwind; her tack flipped with the boom, and so did right of way | (5) |
| Seed 156 (after the finish) | Two finished boats each kept clear of the other, both swerved, and met | (7) |
| Seed 174 (the start) | Two boats side by side, 2 m apart, held their collision reflexes for over a minute and sailed off the course together; neither finished | (8) |

Change (6) brings the AI into line with the new judge (rule 18). It is not tied to one race.

### F.6 What is left from package F

- **The 90% target** for 10-boat fleets (81% now). What is left (issue 268):
  - the start line's ends: a boat slowing for its timed run (sails eased) near a crowded end is pinched up, cannot steer away, and is set onto the pin or the committee boat (seeds 122, 155);
  - the windward mark in a crowd (seeds 119, 152 and others);
  - crossings soon after the start;
  - a boat returning behind the line after starting early, held off its way for minutes by a boat sailing alongside, without a contact. In seed 176 she started 606 s late and missed the finishing window. This is a lock of the avoidance, not of the reflex (which L now breaks).
- **20-boat fleets** were not re-measured (40% clean in Phase 5). The river trials (seeds 1–20, not used for tuning in this package) are in the table above: no fall.
- **Rule 18** is simplified (§F.1), and its wording rests on secondary sources until the World Sailing text can be read (issue 32). The judge's rule 18 has not been tried on a crowded mark by people.

### F.7 Estimates introduced (E)

- The opposite-tacks "beating" test for rule 18: within 80° of the true wind.
- The AI: half the room for tracks not closing, and "closing" above 0.8 m/s.
- The waiting rows: 60, 95 and 130 m behind the line, a third of the fleet in each.
- Dead-run limit: 175° from the wind.
- Lock break: after 5 s.
- Mark clearance: measured at half the hull's length either side of the centre.

### F.8 Checks

Locally (cloud container):

- **Code checks**: typecheck and lint pass. Unit tests: **922 in 138 files, all passing**.
  - New: `markRoom.test.ts` (6 rule 18 scenarios) and `aiFleet.test.ts` (12).
  - `aiFleet.test.ts` has one test per AI change: the start spots at 5, 10 and 20 boats; the waiting places at 5, 10 and 20 boats; the room alongside; the dead run; the stern at a mark; mark-room; finished boats; the lock.
  - Each test was run against the code without its change and failed. The start-spot test failed at every fleet size. The waiting-place test failed at 5 and 10 boats, where the slots were 17 m apart, and passed at 20, whose slots were already 35 m apart.
- **The AI parity tests** (an AI boat acts only through the controls, with and without spinnakers) pass, to 1e-6 m, after the fix to the test itself (§F.1). The corrected test also passes on the AI before this package.
- **No physics changed**: the seven golden traces are identical (with the date field removed), and `npm run envelope` is identical to package E's, every row.
- **The reference race hash** (`tools/race-hash.ts`, seven AI boats, 400 s):
  - `8f30a5cf5c450344` with the simplified rule 18 alone, identical to `main` (no ruling in those 400 s changes a boat's course);
  - `33623f273ed1c7bd` with the AI changes, as expected: the AI decides differently.
- **`npm run perf`**, quiet container, mean / p99 per 1/60 s frame (ms):

  | Window | Package E, same machine | This package, two runs |
  |---|---|---|
  | Physics only (21 boats) | 0.47 / 1.22 | 0.60 / 1.50, then 0.46 / 1.19 |
  | 20 AI boats: pre-start | 1.24 / 4.18 | 1.16 / 3.82, then 1.13 / 4.23 |
  | 20 AI boats: racing | 0.96 / 2.84 | 1.08 / 4.38, then 1.00 / 3.56 |
  | 20 AI boats under spinnakers | 1.02 / 3.08 | 1.18 / 3.50, then 0.84 / 2.56 |

  The physics budget (≤ 1.5 ms mean, ≤ 3 ms p99) is met. The AI windows differ by about ±0.15 ms mean and ±1 ms p99 from run to run, before and after alike: no measurable change. The crowded windows exceed 3 ms p99 with the old AI too (issue 262).
- **The grep** for RYA, "validated", "realistic" and accreditation in what package F adds: only citations of a source ("the RYA's summary of changes") and the label "not authoritative".

**CI on the earlier packages, recorded here:** package E's pull request (d6302ad) is green, the checks job and all five browser shards.

### F.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/44 (branch `next-f-rules`, base `next-e-share`, so its
diff shows package F alone; it follows package E, https://github.com/DrDK3/SailSim/pull/43). CI's result is recorded
in the next package's report.

---

## Needs people (this round does not do these)

- **#28** The validation session with Squib sailors (with the B6 questions once package B adds them).
- **#32** Real-device checks (phones, tablets, a real GPU).
- **#4** Which wind indicator Squib sailors use (the setting stands in).
- **NSOA** contact (part of #42): a note is drafted in package E, not sent.
- **Naming** (#40): names proposed in package E; no rename, no domain.
- A **listening test** of the sounds.
