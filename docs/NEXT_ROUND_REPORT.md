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
| C (no physics): graphics performance and the low preset | `next-c-graphics` | — | Not started |
| D (no physics): Learn map and instructor view | `next-d-learn` | — | Not started |
| E (no physics): metadata, media, manifest, landing page | `next-e-share` | — | Not started |
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
bb7b1e2 (a new commit, no history rewritten), with `dist-*/` added to `.gitignore`; on the next run the checks job
passed.

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

Screens added this package (`docs/img/next-b/`): the spinnaker's states (§B.4), the console's tab on a laptop and a
phone (`console-tab-laptop.jpg`, `console-tab-phone.jpg`), Expert's sail controls (`sail-controls-expert.jpg`).

### B.9 Pull request

Draft pull request: https://github.com/DrDK3/SailSim/pull/40 (branch `next-b-spinnaker`, base `next-a-wind`, so its
diff shows package B alone; it follows package A, https://github.com/DrDK3/SailSim/pull/39).

### B.7 Estimates introduced (E)

Every figure in docs/PARAMETERS.md "The spinnaker and the sail controls" except the area and the pole.

## Needs people (this round does not do these)

- **#28** The validation session with Squib sailors (with the B6 questions once package B adds them).
- **#32** Real-device checks (phones, tablets, a real GPU).
- **#4** Which wind indicator Squib sailors use (the setting stands in).
- **NSOA** contact (part of #42): a note is drafted in package E, not sent.
- **Naming** (#40): names proposed in package E; no rename, no domain.
- A **listening test** of the sounds.
