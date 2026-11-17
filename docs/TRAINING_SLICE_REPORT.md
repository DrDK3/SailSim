# Training slice: a bounded improvement pass for two exercises

**Status: in progress.** The delta audit (§1–§3) was committed before any fix; the sections after it are filled as the work lands. Conventions follow [COMPREHENSIVE_REVIEW.md](COMPREHENSIVE_REVIEW.md) §0: claim types O (observed here), C (code), R (reference), H (hypothesis), P (preference); evidence levels L1–L6; severity S1–S4; confidence High/Medium/Low. New findings are numbered issues in [OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md) (198 onwards). Every new threshold in this pass is **provisional (E), awaiting instructor review**. Nothing in this pass establishes calibration, validation, instructional effectiveness or any accreditation.

Branch `training-slice`, from `hifi` at `d51c325` (which carries the unmerged rounds of 17 Nov 2026 on top of `main` at `8f86fb7`). Draft PR only; nothing is merged to `main` or published.

---

## 1. Baseline (17 Nov 2026)

### 1.1 Environment

| Item | Value |
|---|---|
| Machine | Cloud container, 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, Linux 6.18 |
| Node / npm | v22.22.0 / 10.9.4 (the brief's baseline: Node 22.23) |
| Browser for tests | Chromium 141.0.7390.37 (Playwright 1.64.0), **SwiftShader software WebGL**; no real GPU, no physical device |
| CI | GitHub Actions, ubuntu-24.04 runners, no GPU (software rendering); browser tests split over four jobs |

### 1.2 Commands, on `main` at `8f86fb7` (a worktree) and on the branch base `d51c325`

| Check | `main` 8f86fb7 (here) | Branch base d51c325 (here) | The brief's baseline |
|---|---|---|---|
| `npm run typecheck` | Pass (15 s) | Pass | Pass (21 s) |
| `npm run lint` | Pass (7 s) | Pass | Pass |
| `npm test` | **89 files, 588 tests, all pass** (67 s on 4 CPUs) | 96 files, 632 tests, all pass (65 s) | 89 files, 588 tests (3 min 32 s on 2 CPUs) |
| `npm run envelope` | Written (5 s) | Written; **identical to main's** (diffed) | — |
| `npm run perf` (1 + 20 AI boats, full race, per 1/60 s frame) | 0.93 ms mean, 2.86 ms p99, 32.2 ms max (one frame, the start) | 0.91 ms mean, 2.59 ms p99, 24.4 ms max | Budget 3 ms |
| Golden traces | Pass (in `npm test`) | Pass | — |

### 1.3 Browser tests: from CI, as the owner asked ("rely on GitHub's test runs")

The local software renderer runs at 1–5% of real time, so the e2e suite (85 tests) is judged from CI, where each job has one browser.

| Run | Result |
|---|---|
| `main` 8f86fb7, push run [43744050970](https://github.com/DrDK3/SailSim/actions/runs/43744050970) (15 Nov) | **83 passed, 1 flaky, 1 failed.** Failed: `daylight.spec.ts:9` ("dark in real time…": the Settings menu item does not turn the daylight view off within 120 s, twice). Flaky: `roundB.spec.ts:51` (interface levels; passed on retry) |
| `hifi` 40692e5, push run 44083808740 | All passed (daylight.spec.ts passed) |
| `hifi` 40692e5, pull-request run 44083819534 | `daylight.spec.ts:9` failed twice again; a re-run was cancelled by a newer push |
| The brief's local failure: `a11y.spec.ts:16` (the Help dialog did not appear in 15 s at 1% of real time) | **Passed in CI** on `main` (37 s): a slow-renderer timing artefact, not a defect (O) |

`daylight.spec.ts:9` failing in some CI runs and passing in others on the same code is recorded as issue 202 (not established whether a defect or a timing artefact; outside both exercises).

---

## 2. Physics-trust checks

New tests in [`tests/sim/trustChecks.test.ts`](../tests/sim/trustChecks.test.ts) and a new tool, [`tools/exploit-search.ts`](../tools/exploit-search.ts) (`npm run exploits`). What each establishes is stated; **none establishes calibration**.

| # | Check | Result | Establishes |
|---|---|---|---|
| 2.1 | **Frame-rate independence.** The app's own frame loop (`SimController.frame`) at 60 fps, at 24 fps, and with irregular frames including 0.25 s and 1 s frames, topped up to the same step (3000) with the same held helm | **Bit-identical state** in all three (tolerance 0, same engine). Long frames are clamped to 0.1 s: simulated time is dropped (the "running slow" indicator, PH-5), the physics is unchanged | Numerical correctness of the fixed 0.01 s step and the accumulator |
| 2.2 | **Reproducibility.** Same scenario, gust seed and inputs, twice; then another seed | Same hash; another seed gives another hash. Cross-engine: within ~1e-13, not bit-exact (issue 17; replays detect and report divergence) | Numerical determinism on one engine |
| 2.3 | **Reference frames.** A boat in a 1 kn current with true wind W, against a boat in still water with wind W − current | Through the water the two are the same boat to 1e-6 (STW, heading, heel, AWA); over the ground they are 60 s × 1 kn apart; velocity over the ground = velocity through the water + current to 1e-9; heading ≠ COG | Numerical consistency of the frames: apparent wind over the ground, hydrodynamics through the water |
| 2.4 | **Through a tack.** Same helm at 1 kn and 4 kn; rudder hard over against centred at 4 kn; a tack from close-hauled in 10 kn | Turn in 2 s at 4 kn is more than 1.5× that at 1 kn (and between 5° and 120°); hard rudder for 6 s ends over 0.3 kn slower; the tack's minimum speed is between 25% and 90% of the speed going in, and the speed recovers to over 80% | Physical plausibility of direction and order of size only |
| 2.5 | **AI parity.** An AI boat's inputs recorded through the race, replayed into a plain `Simulation` from the same pose with the same environment | Same track to 1e-6 m; same `squibParams()` | AI acts only through the controls (the realism contract), with the player's parameters. RA-2 stands: the AI's *planning* knows the current along its track (information, not physics) |
| 2.6 | **Exploit search** (`npm run exploits`): helm oscillation ±0.3/±0.6/±1 at 0.1–2 Hz; sheet pumping ±0.15 every 0.5–2 s; auto-trim switched off and on every 1–5 s; upwind (made good to windward in 180 s) and on a beam reach, 10 kn steady | **No pattern beats steady sailing** (best steady upwind angle in the sweep: 38° TWA, 312.5 m in 180 s). Oscillation costs 1–28%; pumping 13–18% upwind; switching auto-trim off and on every few seconds costs **20–24% upwind**, which exposed issue 201 below | Absence of the tried exploits in the model (not in real boats) |

The table of 2.6 is written to `out/exploit-search.md` by the tool.

---

## 3. Delta audit (only what the two exercises touch)

### 3.1 The earlier observations O1–O9

| # | Observation | Status now | Evidence |
|---|---|---|---|
| O1 | Options' wind source disagrees with the instruments after a restart | **Confirmed (C).** `src/ui/ScenarioPanel.tsx:82` deep-copies the scenario; `:86` finds the source by object identity (`s.json === w.snapshot`), which never matches the copy, so it falls back to `manual`; `:87` does the same for tide. Issue 198 | Code; the brief's browser reproduction |
| O2 | Auto-trim on, sheet fully eased, status "Stalled" and Ease highlighted | **Confirmed (O, C).** `src/ui/Controls.tsx:135–136` calls `sailAdvice(state, keys)` without the sheet position or the auto-trim state; `src/app/sailStatus.ts:14–25` therefore asks for impossible actions. Reproduced headless: running at TWA 169° in 10 kn with auto-trim on, the main is 100% eased and shows "Stalled: ease out"; the jib shows "By the lee: gybe risk: head up" (advice about gybing for a sail that does not gybe the boat). It never says why a fully eased sail stalls (on a run a sail works by drag: eased right out it cannot draw). Issue 199 | Headless probe; code |
| O3 | Main "By the lee" at TWA 137° with the main sheeted 23% | **Confirmed (O, C).** `sailStatus.ts:7` calls any \|incidence\| > 90° by the lee. Reproduced: TWA 136°, AWA 115°, boom 21°, sheet 23% → incidence −94° → "By the lee: gybe risk: head up". The wind is not from the boom's side: the main is over-sheeted (stalled) and needs easing. `byTheLeeAngle` in `src/sim/boat/dynamics.ts:419` already tells the two apart. Negative-learning risk. Issue 200 | Headless probe; code |
| O4 | No live tide file; the published app starts with no tide or stream | **Explained, by design** (unchanged). The in-app text may say why (§7 of this report, if done) | — |
| O5 | No spinnaker controls | Tracked (PH-3, D2/D3, issue 67, Package 5). Out of scope; not added | — |
| O6 | One "Flat" control combines several adjustments | Tracked (issues 21, 67). **Its tooltip already says what it combines** (`Controls.tsx:222`: "cunningham, outhaul and kicker on, leech twisted open, to depower"); the label stays "Flat" (the console's fixed width) | Code |
| O7 | Coefficients labelled as estimates | Intended (L5). Kept | — |
| O8 | WebGL failed in one remote browser | Not established as a general defect. WebGL works here (SwiftShader) and in CI; context loss is handled (Package 1). No compatibility claim made | — |
| O9 | Earlier reviewers missed features | Noted: nothing removed or rebuilt for that reason | — |

### 3.2 Confirmed defects

| Issue | Finding | Where | Reproduce | Effect on the exercises | Sev | Conf | Type / Ev. |
|---|---|---|---|---|---|---|---|
| 198 | O1: wind (and tide) source shown wrongly in Options | `ScenarioPanel.tsx:86–87` | Restart with a Met Office replay; open Options: Source says Manual | Both: the instruments and the settings disagree on the active state | S2 | High | C (and O in the brief) |
| 199 | O2: advice asks for impossible actions, and to adjust a sheet auto-trim controls | `Controls.tsx:135–136`, `sailStatus.ts:14–25` | Run at TWA 169° with auto-trim on | Beginner: "ease" glows when nothing can be eased; teaches pressing keys that do nothing | S2 | High | O, C |
| 200 | O3: an over-sheeted main is called "by the lee: head up" | `sailStatus.ts:7` | TWA 136°, main sheeted 23% | Beginner: wrong cause and wrong action (negative learning) | S2 | High | O, C |
| 201 | **New.** Switching auto-trim off (M, J or the Auto box) drops the sheet to the last manual setting: the sheet jumps (e.g. from fully eased on a run to 30%) | `controller.ts:2394–2395`, `Controls.tsx` Auto checkbox; `Simulation.currentSheet` uses `input.mainSheet` once auto is off | Sail with auto-trim on, change course, press M | Beginner, "repeat with reduced assistance": taking the sheet over stalls or overpowers the boat at once; the exploit search shows the cost (20–24% upwind when toggled every few seconds). The sheet keys already take over smoothly (`controller.ts:2061–2066`) | S2 | High | O (headless), C |
| 202 | `daylight.spec.ts:9` fails in some CI runs (main 8f86fb7; PR run of 40692e5) and passes in others on the same code | `tests/e2e/daylight.spec.ts:46` | CI | None directly; CI on `main` is red | S3 | Medium | O (CI). Not established whether a defect or a timing artefact |

### 3.3 Existing features that need improvement

| Area | What exists | What the exercises need | Ref. |
|---|---|---|---|
| Lessons | Nine lessons (`src/app/lessons.ts`); a step engine with goals, hold times and one static `hint` per step (`src/app/tutorial.ts:59–81`); lesson 4 ("turns") times two tacks against the model's reference tack | Graduated help (attend → explain → suggest → explain the result), each level logged; an assistance record per attempt; a result card that separates assisted completion from independent performance; variation (tack and heading from a seed); a short control familiarisation step not scored as sailing | U9, issue 47 |
| Thresholds | Embedded in each step's goal (e.g. close-hauled TWA 38–55° at ≥ 2.5 kn; `lessons.ts:105–112`) | One configurable, labelled table (provisional, E) | Issue 47 |
| Assistance | Auto-trim main and jib, auto crew, flatten (`ControlInput`); the interface level (`src/app/level.ts`) changes **only defaults of the interface** (overlay, coach, dock), not assistance; lessons set `AUTO` inputs | The realism contract's "Learn" assistance level is approximated by the lessons' inputs; record what was on and for how long | Contract §1; D2 |
| Sail status | Four states (`sailStatus.ts`) | Actionable advice: aware of sheet limits, auto-trim and which side the wind is on | 199, 200 |
| Debrief | Track map coloured by speed, tacks and gybes costed in seconds (`src/app/sailLog.ts`, `src/ui/DebriefPanel.tsx`); a race coach with rules of thumb (issue 68) | A few observations kept apart from inferred cause, one next practice action, the assistance used, and for the tactical exercise a counterfactual | Issue 68 |
| Replay and ghost | Bit-exact replays with take-over; ghost racing from a replay (`src/app/ghost.ts`); share links (`src/app/shareLink.ts`) | Re-run from a decision point with the other choice, both tracks shown | RA-4 |
| Telltales and luffing | Jib telltales drawn (`src/render/squibModel.ts:407–413`) from the simulation's flow; sail luffing drawn and heard (`src/render/audio.ts:109–111`, flutter from `luff`) | Readable at the default camera; the same state as the instruments (to be checked) | — |
| Sound | Water rush from STW (`audio.ts:105`), sail flutter from luff | Assertions that the settings track the simulation values | GR-6 |

### 3.4 Missing capabilities

| Missing | Where it would go | Note |
|---|---|---|
| A scripted, deterministic wind shift (the wind has seeded Ornstein–Uhlenbeck shifts and a persistent trend only, `src/sim/env/wind.ts:150–160, 220`) | An isolated environment input; `timeSteppedBase` (`wind.ts:245`) already blends base winds in time | Must not change any boat physics |
| A counterfactual re-run from a decision point | Built on replays (bit-exact, same engine) | — |
| Exercise attempt records (assists, hint levels) that export and import | Browser storage with try/catch, as `shareLink.ts` and the lessons' progress | No server (contract) |
| Key remapping | `controller.ts` KEYMAP is static | Gap, unless cheap |
| axe-core | Accessibility has been checked with custom Playwright probes (review §0: cdnjs was blocked) | `@axe-core/playwright` as a dev dependency if justified |

### 3.5 Unverified hypotheses

| # | Hypothesis | How to test |
|---|---|---|
| H1 | The model points high (issue 16; the brief's PH-10). The exploit search's sweep put the best steady made-good angle at 38° TWA in 10 kn with the autopilot holding TWA (this sweep includes leeway: TWA is measured from the heading) | Sailors' tacking angles (validation B1.5); the tactical exercise's sensitivity check (§8 of this report) |
| H2 | `daylight.spec.ts:9`: a timing artefact of dispatched clicks under a fixed page clock (issue 202) | Investigate in CI with traces |
| H3 | Telltales, luffing and sound are readable and consistent at the default camera on real devices | Real GPU and device checks (none here) |
| H4 | Beginners can tell the jib's telltales from the sail-state pills | The validation protocol (§12) |

### 3.6 Questions for sailors and instructors

1. Do instructors teach "recognise luff → bear away or trim" before or after the first tack? What order for this exercise?
2. What speed recovery after a tack would an instructor accept from a beginner in a keelboat, and in what time?
3. When the wind heads by a few degrees on a short beat, what do instructors teach beginners to do, and from what size of shift?
4. Is a shift overlay a help or a crutch? Should it fade out with progress?
5. Does "Stalled" mean anything to beginners, or should the console speak of "sheeted too hard" and "eased too far"?

---

## 4. Fixes

(Filled as they land.)

## 5. Beginner exercise: trim, tack and recover

(Filled as it lands.)

## 6. Tactical exercise: respond to a wind shift on a short beat

(Filled as it lands.)

## 7. Controls, feedback, graphics and sound

(Filled as it lands.)

## 8. Debrief and instructor support

(Filled as it lands.)

## 9. Verification

(Filled at the end.)

## 10. Handover

(Filled at the end.)
