# Comprehensive review and revision plan

**Status (3 Nov 2026): decisions recorded (§12); Package 1 implemented (§13).** The review itself was written at the gate, against commit `dd7d16c` on `hifi`, before any production change. The owner then took decisions D1–D12 and asked for implementation in the recommended order.

**Companion files:**

- [review/VALIDATION_SHEET.md](review/VALIDATION_SHEET.md): questions for an experienced Squib sailor and an RDYC sailor.
- [review/ACCEPTANCE_SCENARIOS.md](review/ACCEPTANCE_SCENARIOS.md): reproducible scenarios with tolerances.
- [review/SOURCE_REGISTER.md](review/SOURCE_REGISTER.md): datasets and live-data sources.
- [`research/review-2026-11/`](../research/review-2026-11/README.md): the isolated diagnostic scripts and their outputs.

## Contents

0. [How to read this review](#0-how-to-read-this-review)
1. [Executive assessment](#1-executive-assessment)
2. [Existing-system map](#2-existing-system-map)
3. [Findings matrix](#3-findings-matrix)
4. [Physics validation specification](#4-physics-validation-specification)
5. [Collision, grounding and damage specification](#5-collision-grounding-and-damage-specification)
6. [Geography and environment assessment](#6-geography-and-environment-assessment)
7. [Live-data architecture and source register](#7-live-data-architecture)
8. [Onboarding, UI, UX, graphics, camera and audio recommendations](#8-onboarding-ui-ux-graphics-camera-and-audio)
9. [Validation and benchmarking plan](#9-validation-and-benchmarking-plan)
10. [Revision packages](#10-revision-packages)
11. [Recommended first package and decisions needed](#11-recommended-first-package-and-decisions-needed)
12. [Decisions (3 Nov 2026)](#12-decisions-3-nov-2026)
13. [Package 1: what changed](#13-package-1-what-changed)

---

## 0. How to read this review

### Claim types

Every finding says which of these it is.

| Code | Claim type | Meaning |
|---|---|---|
| **O** | Direct observation | I ran it in this review and saw or measured it |
| **C** | Code finding | Read in the source; behaviour follows from the code |
| **R** | Reference-supported conclusion | Follows from a cited source |
| **H** | Hypothesis | Plausible, not yet tested |
| **P** | Preference | A design opinion; reasonable people may differ |

### Evidence levels

Each claim about real-world behaviour is graded on the six levels in the brief.

| Level | Meaning |
|---|---|
| **L1** | Verified specification or geometry (class rules, survey data) |
| **L2** | Measured sailing or environmental data |
| **L3** | Published qualitative guidance |
| **L4** | Experienced-sailor judgement |
| **L5** | Engineering approximation |
| **L6** | Unsupported assumption |

### Severity and confidence

| Severity | Meaning |
|---|---|
| **S1** critical | Contradicts an explicit requirement of the brief, or makes a core activity unusable or misleading |
| **S2** major | Materially wrong behaviour, or a significant barrier for the intended players |
| **S3** moderate | Noticeable, but limited in scope or with a workaround |
| **S4** minor | Polish |

**Confidence** (High, Medium or Low) is how sure I am that the finding is real and correctly described. It is not a measure of how important the finding is.

### Software performance and boat performance

These are kept apart throughout:

- *speed*, *polar*, *handling* and *performance envelope* mean the **boat**;
- *frame time*, *load time*, *memory* and *software performance* mean the **program**.

### What I could and could not inspect

| Could | Could not |
|---|---|
| Read all the source, data and docs | Render on a real GPU. The browser here is Chromium with **SwiftShader** (software WebGL). I looked at software-rendered screenshots only. Colours, shading, frame rates and load times on real devices may differ, and **no graphics finding below claims real-GPU inspection** |
| Run the simulator headless and in the browser; run all 373 unit tests (49 files, all pass, 60 s) | Hear the audio. Sound is reviewed from code only |
| Run isolated diagnostics (`research/review-2026-11/`) | Open the RDYC sailing instructions, the 2026 programme or the club site (`royaldart.co.uk` is blocked by the network policy) |
| Fetch Met Office open data (the UKV forecast ran today: 106 → 117 files in 104 s) | Read CI logs or artifacts (`results-receiver.actions.githubusercontent.com` and `productionresultssa14.blob.core.windows.net` are blocked); CI status comes from the GitHub API |
| | Reach Dart Harbour (`dartharbour.org` gave no API), Wikipedia, simplonpc.co.uk, dartmouthrailriver.co.uk, broker and review sites (devalk.nl, boats.com, sailboat-cruising.com, boatshed, practical-sailor.com, sailmagazine.com) or cdnjs (so axe-core could not be loaded; accessibility was checked with custom Playwright probes) |
| | Validate anything with a sailor. **No validation has taken place.** The validation sheet is prepared, not completed |

---

## 1. Executive assessment

### Verdict

The simulator has a sound engineering core, but its realism is unproven, and three areas fall short of the brief.

**The core.**

- It is deterministic. The same seed and inputs give the same hash.
- The physics is force-based and closes:
  - port and starboard are exactly symmetric;
  - the forces balance at steady state;
  - no energy is gained in any collision;
  - no hidden clamps hold the boat to a target.
- Provenance is unusually honest: estimates are tagged E, and simulated courses are never passed off as club courses.
- 373 unit tests pass, plus Playwright end-to-end tests in CI.

**What is unproven.** Every hydrodynamic and aerodynamic coefficient is an engineering estimate (L5). No measured Squib performance exists in the project. The parameters are also poorly identifiable: several different combinations give the same speeds (§4.4). So the boat's speeds and handling are *model output*. They look plausible, but they are not validated.

**Where it falls short of the brief.**

1. **The tidal stream is driven by the rate of change of tide height.** That gives slack water at high and low water, with the flood a mirror of the ebb. The brief explicitly forbids this (EN-1, S1).
2. **Damage uses generic percentage penalties.** Rig damage scales sail force by a factor, and water in the bilge does not change stability. The brief asks for a causal chain from impact to handling (DM-1, S1).
3. **Real time is incomplete.**
   - The clock is UTC only.
   - A hidden tab pauses silently.
   - Below 10 fps the simulation runs slower than the wall clock.
   - The live forecast job, though scheduled more often, actually runs only every 4–6 hours.
   - No local observation sets the wind; the mean wind is the forecast (EN-4, EN-5).

**Other gaps.**

- **No spinnaker.** The Squib races with a 13.5 m² symmetric spinnaker, so the simulator's downwind sailing is a different activity from the real boat's (PH-3).
- **Picture and physics disagree:**
  - the committee boat collides as a 2.5 m circle but is drawn as a 10.8 m yacht (CO-3);
  - moored boats are drawn up to ±15° from where the physics has them (CO-4).
- **Reliability:**
  - each race restart leaks about 55 GPU geometries (GR-2);
  - nothing handles a lost WebGL context (GR-3).
- **Learning:**
  - on a phone the instruments overlap the dock (UX-5);
  - a beginner who is over the line early is never told how to clear (UX-6);
  - the bow-direction keyboard steering is not taught against the tiller's convention (UX-8).

### The ten most important findings

| # | ID | Finding | Sev |
|---|---|---|---|
| 1 | EN-1 | Tidal stream slaved to the rate of change of tide height (slack at high and low water) | S1 |
| 2 | DM-1 | Damage as generic multipliers; no causal chain; bilge water does not affect stability | S1 |
| 3 | PH-1 | No measured Squib performance; coefficients are estimates and poorly identifiable | S2 |
| 4 | PH-2 | The validation dashboard's polar uses a trim helper that ignores heel; at 22 kn it is not a steady state | S2 |
| 5 | PH-3 | No spinnaker | S2 |
| 6 | CO-3 | Committee boat: 2.5 m contact circle against a 10.8 m drawn yacht | S2 |
| 7 | EN-4 | No single authoritative real-time clock; UTC only; silent pause; slow below 10 fps | S2 |
| 8 | GR-2 / GR-3 | GPU leak on race restart; no WebGL context-loss handling | S2 |
| 9 | UX-5 / UX-6 / UX-8 | Phone layout overlap; over-the-line limbo; steering convention untaught | S2 |
| 10 | RA-2 | AI knows the current along its predicted track; the player does not | S3 |

### Recommendation in one paragraph

Start with **Package 1, "Measure and make consistent"** (§11). It contains:

- an automated behaviour-envelope report;
- a corrected polar dashboard;
- a single source of truth for the committee boat and moored boats;
- frame-rate and clock honesty;
- the GPU leak fix and context-loss handling.

None of this needs a decision from you. Run the dedicated **graphics, UI and UX package (Package 2)** alongside it. Send the validation sheet to the two sailors now. Their answers, together with your decisions D1–D6, gate the physics packages (spinnaker, irons, sail controls, calibration) and the tidal-stream rebuild.

### Recommended realism contract

This is a recommendation for you to accept or change (decisions D1–D4, D7, D10). It states what the simulator promises and what it deliberately leaves out.

| Element | Recommendation |
|---|---|
| **Intended players** | Club sailors and learners who sail, or want to sail, Squibs on the Dart. A secondary audience is experienced racers practising starts and tactics |
| **The player controls** | The helm (tiller); the mainsheet; calls for tack, gybe, spinnaker hoist and drop. Optionally (expert): the jib sheet and crew position |
| **The simulated crew does** | Jib trim, spinnaker trim and handling (timed tasks), hiking, bailing. It always acts through the same controls a player would use, never by setting the boat's state |
| **Assistance levels** | **Learn:** auto-trim, flatten, steering help, damage off, stream off, coach on. **Club** (default): auto-trim on and switchable, damage "realistic", stream as available. **Expert:** all assists off, damage "strict", manual jib and crew |
| **Fidelity promised** | Correct *direction and order of size* for speed, heel, leeway, helm, tacks, gybes, acceleration and stopping, within the sailors' agreed bands once validated. Until then every number is labelled model output |
| **Fidelity not promised** | Exact boat speeds; wave effects on speed; sail shape beyond sheeting (and the kicker and cunningham, if chosen); the wind at a given buoy at a given minute; authoritative rules adjudication |
| **Simplifications kept, labelled** | 4 degrees of freedom (no pitch or heave in the physics); lumped keel and hull; parametric residuary resistance; terrain wind effects estimated; generated moorings; the bed below the low-water line estimated until survey data arrives |
| **Never** | Invented club procedures, courses, marks or affiliations; a forecast shown as an observation; a stream timed from high and low water; secrets in the browser |

---

## 2. Existing-system map

### Modules

```
            ┌────────────── browser (Vite build, GitHub Pages) ───────────────┐
 public/    │ src/app/controller.ts ── owns the session, fixed-step loop,      │
 geo/*      │   │                     clock, scenario, live switch, replay     │
 live/*.json│   ├─ src/sim/ (pure TS, no DOM, no Math.random, no Date.now)     │
   ▲        │   │   boat/   4-DOF dynamics, sails, foils, hull, GZ, crew,      │
   │        │   │           cockpit water, damage                              │
   │        │   │   control/ helm, sheets, auto-trim, flatten, autopilot       │
   │        │   │   env/    wind field + gusts, terrain wind, tide, stream,    │
   │        │   │           live-data parsing and freshness                    │
   │        │   │   race/   fleet, contact, committee, course judge, rules     │
   │        │   │   ai/     skipper (tactics 5 Hz, reflex 20 Hz)               │
   │        │   ├─ src/render/ three.js r186: scene, cameras, water, Dart,     │
   │        │   │           Squib, fleet, course, SAMARITAN, traffic, audio    │
   │        │   └─ src/ui/  React 19: instruments, dock, panels, tutorial,     │
   │        │               coach, results, replay bar, settings               │
   │        └──────────────────────────────────────────────────────────────────┘
   │
 GitHub Actions: CI (lint, types, unit, e2e) · Deploy (Pages) · Live data (cron:
 Met Office UKV from AWS open data, EA gauge, UKHO via secret) · tide harmonics
 tools/ingest (Python: netCDF4, pyproj, utide) · tools/geodata · tools/*.ts
```

### Data flow each frame

1. `requestAnimationFrame` gives the frame time. It is clamped to 0.1 s.
2. The fixed-step accumulator runs RK4 steps of 0.01 s, at most 12 per frame.
3. For each boat, the environment is sampled at the boat:
   - wind: from the grid or the preset, plus terrain effects and seeded gusts;
   - tide height;
   - stream.
4. The controls are applied, then forces are computed and integrated.
5. Contacts are resolved: a penalty spring-damper with friction, using a separating-axis test on a 13-vertex hull outline. The contact forces are held over each step.
6. Race logic and rules events run. AI tactics run at 5 Hz and the reflex at 20 Hz.
7. The renderer reads a snapshot. It never writes to the simulation.
8. Audio reads the same snapshot.

### Clocks today

There is a simulation time `t` from the start, plus the scenario's `startTime` (UTC). Environment time is `startTime + t`. Wall-clock time is used only:

- to choose "now" when a session starts (`src/app/liveNow.ts`);
- to judge data freshness.

A hidden tab stops `requestAnimationFrame`, so `t` stops. Nothing brings it back to the wall clock afterwards.

### Tests

| Kind | Count | Notes |
|---|---|---|
| Unit and regression (Vitest) | 373 in 49 files | All pass (this review, 60 s). Includes golden traces and the determinism hash |
| End-to-end (Playwright) | 4 browser shards in CI | Green on `dd7d16c` (run 41631219224) |
| AI trials | `npm run ai:trials` | Start Bay: 97 of 100 clean. River: 15 of 20 clean |
| Performance | `npm run perf` | 21 boats: 0.80 ms mean, 1.98 ms p99 per 1/60 s frame (physics only) |

These are **regression** tests: they show that behaviour has not changed. They are **not** realism validation (§9).

---

## 3. Findings matrix

### Summary

**Physics and handling (PH):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| PH-1 | No measured performance; coefficients are estimates and poorly identifiable | C, O | S2 | High | L5 | 0, 5 |
| PH-2 | The polar dashboard and calibration use a heel-blind max-drive trim | C, O | S2 | High | L5 | 1 |
| PH-3 | No spinnaker | C | S2 | High | L1 | 5 |
| PH-4 | Irons is a stable trap; no way to back the jib | O, C | S3 | High | L3 | 5 |
| PH-5 | Below 10 fps the simulation runs slower than real time | C | S3 | High | — | 1 |
| PH-6 | Only sheets as sail controls (no kicker, cunningham, outhaul or jib car) | C | S3 | High | L3 | 5 |
| PH-7 | Two different "polars": the dashboard's (max drive) and the AI's (auto-trim) | C | S3 | High | — | 1 |
| PH-8 | Gust response and broaching not characterised | — | S3 | Med | L5 | 1, 5 |
| PH-9 | No pitch or heave in the physics; the waves only move the picture | C | S4 | High | L5 | later |

**Collision, grounding and damage (CO, DM):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| CO-1 | High rebound: 8 kn into a jetty comes back at 2.9 kn (restitution about 0.36) | O | S3 | High | L5 | 6 |
| CO-2 | Damage thresholds unevidenced: a 4 kn T-bone is only "scraped" | O, C | S2 | Med | L6 | 6 |
| CO-3 | Committee boat contact is a 2.5 m circle; the drawn boat is 10.8 m | C | S2 | High | L1 | 1 |
| CO-4 | Moored boats: the physics has no swing jitter; the picture adds ±15° | C | S3 | High | — | 1 |
| CO-5 | Tunnelling and energy: none found (a positive result) | O | — | High | — | — |
| CO-6 | Grounding: the release on the rising tide works; heel and draft interaction not tested | O | S3 | Med | L5 | 6 |
| DM-1 | Damage as generic multipliers; bilge water has no stability effect | C | S1 | High | — | 6 |
| DM-2 | Repair only by restart; no retire, no settings | C | S3 | High | — | 6 |

**Environment (EN):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| EN-1 | Stream timing slaved to the rate of change of tide height | C | S1 | High | L6 | 4 |
| EN-2 | The bed below the low-water line is an estimated profile | C | S2 | High | L6 | 4 |
| EN-3 | The chart-datum offset (2.62 m) is from a secondary source | C | S3 | Med | L3 | 4 |
| EN-4 | No authoritative real-time clock; UTC only; silent pause | C, O | S2 | High | — | 3 |
| EN-5 | Live mean wind is forecast only; refreshed every 4–6 h in practice | O, C | S2 | High | L2 | 3 |
| EN-6 | Terrain wind effects are estimated | C | S3 | High | L5 | 4 |
| EN-7 | Moorings, ferry timetables and most navigation marks are generated or estimated | C | S3 | High | L6 | 4 |
| EN-8 | No verified RDYC course (the club documents could not be reached) | R | S2 | High | — | 7 |

**Graphics, cameras and audio (GR):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| GR-1 | Real-GPU rendering not inspected | — | — | — | — | 2 |
| GR-2 | GPU memory leak on race restart | O, C | S2 | High | — | 1 |
| GR-3 | No WebGL context-loss handling | C | S2 | High | — | 1 |
| GR-4 | Reduced motion not honoured by the 3D camera | C | S3 | High | — | 2 |
| GR-5 | Heavy scene: about 345 draw calls, 2.2–2.7 M triangles, 480 MB JS heap | O | S3 | Med | — | 8 |
| GR-6 | Audio is procedural; no contact or grounding sounds; no spinnaker | C | S4 | Med | — | 2 |

**Onboarding, UI and UX (UX):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| UX-1 | 23.5 s load on software rendering (real devices unmeasured) | O | S3 | Low | — | 8 |
| UX-2 | The welcome dialog does not trap focus | O | S3 | High | — | 2 |
| UX-3 | Small targets (checkboxes 13 px, slider 16 px) and 11 px labels | O | S3 | High | — | 2 |
| UX-5 | The instruments overlap the dock at 390×844 and 1000×560 | O | S2 | High | — | 2 |
| UX-6 | Over-the-line limbo: no guidance to clear | O | S2 | High | — | 2, 7 |
| UX-7 | Truncated status text, "gusty gusts", coach card cut off | O | S4 | High | — | 2 |
| UX-8 | The bow-direction keyboard steering against the tiller is untaught | C | S2 | Med | L4 | 2 |
| UX-9 | Key distinctions shown but not taught (heading/COG, true/apparent, STW/SOG, VMG) | C | S3 | High | L3 | 2 |
| UX-10 | Open from the earlier UI audit: U4, U5, U6, U8, U9, U10, U12 | C | S3 | High | — | 2 |

**Racing, AI and replay (RA):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| RA-1 | Rules subset: no 18–20, no exoneration, no 44.3, no protests | C | S2 | High | L1 | 7 |
| RA-2 | AI knows the current along its predicted track | C | S3 | High | — | 7 |
| RA-3 | River AI: 15 of 20 clean; larger fleets 77% and 40% clean | O | S2 | High | — | 7 |
| RA-4 | Replays keep the live snapshot and seed (a positive result) | C | — | High | — | — |

**Software performance and reliability (PF):**

| ID | Finding | Type | Sev | Conf | Ev. | Pkg |
|---|---|---|---|---|---|---|
| PF-1 | The deployed build carries 6.7 MB of source maps out of 11 MB | O | S4 | High | — | 8 |
| PF-2 | Large modules (controller, Dart, Squib model, each about 1,300 lines) | C | S4 | High | — | 8 |

### Finding cards

Each card gives: the evidence and how to reproduce it, the player impact, the correction, the files involved, dependencies and risks, and the acceptance criteria. Scenario IDs (for example **A-PH-3**) refer to [ACCEPTANCE_SCENARIOS.md](review/ACCEPTANCE_SCENARIOS.md).

#### Physics and handling

**PH-1 · No measured performance; the coefficients are estimates and poorly identifiable.** S2 · High · C, O · L5
- **Evidence.** `data/boats/squib/calibration.json` tags every coefficient E: "None of these is Squib-specific measured data". The ±20% sensitivity runs (`physics.ts`, `physics2.ts`) gave these speeds:
  - average round a circular-random course in 12 kn (base 5.07 kn):
    - friction form factor: 5.14 / 4.99 kn;
    - sail area: 4.86 / 5.22 kn;
    - main clMax: 5.02 / 5.09 kn;
  - steady speed at 90° TWA in 12 kn (base 5.94 kn), residuary resistance: 6.18 / 5.78 kn;
  - at 18 kn and 90° TWA (base 7.14 kn) the residuary table dominates: 7.64 / 6.80 kn.
- **Why it matters.** Different combinations (more sail power with more drag, say) give the same steady speeds. A polar alone cannot pin down the 30-odd coefficients.
- **Impact.** Speeds, heel and helm may be right or wrong. Nobody can yet tell.
- **Correction.** Fit only a few lumped parameters, each identifiable from a distinct observable:
  1. sail power scale, from upwind speed in 8–10 kn;
  2. residuary scale, from reaching speed in 15+ kn;
  3. righting moment scale, from the heel against wind speed;
  4. keel lift slope, from leeway or pointing.

  Keep the rest fixed at their E values. Calibrate against GPS tracks plus sailor judgement (§9).
- **Files.** `data/boats/squib/calibration.json`, `src/sim/calibration/`.
- **Risk.** Over-fitting to one sailor's memory. Mitigation: use tolerances, not points.
- **Accept.** A-PH-1 … A-PH-8 within the tolerances agreed with the sailors.

**PH-2 · The polar dashboard and calibration use a heel-blind max-drive trim.** S2 · High · C, O · L5
- **Evidence.**
  - `optimalSheets` (`src/sim/control/trim.ts`) maximises drive for each sail and ignores heel.
  - It drives `optimiseTrim` in `src/sim/scenario.ts:73`, which is used by `src/app/polarWorker.ts:33` (the in-app polar), `src/sim/calibration/calibrate.ts:98` and `tools/model-polar.ts`. It also sets the opening sheets (`src/app/controller.ts:400`).
  - At 22 kn close-hauled it sheets the boom to 2–4° with the main 80% luffing. The boat heels to 50°, ships water (37 kg) and oscillates (`physics2-out.txt`).
  - With the player's auto-trim and flatten, the same case is steady at 5.7 kn and 25° of heel.
- **Impact.** The validation artefact a sailor would look at first shows heavy-air numbers that are neither steady nor what a crew would do.
- **Correction.**
  - Run the polar with the same crew policy the player and the AI use (auto-trim with flatten).
  - Flag any point whose speed or heel has not settled.
  - Keep the max-drive helper for light air only, labelled.
- **Files.** `src/app/polarWorker.ts`, `src/sim/scenario.ts`, `src/sim/calibration/calibrate.ts`, `src/ui/PolarPanel.tsx`.
- **Risk.** Golden traces that use `optimiseTrim` will change, so they must be regenerated deliberately.
- **Accept.** A-PH-7: every polar point settles to within 0.05 kn and 1° over the last 30 s, or is marked "not steady".

**PH-3 · No spinnaker.** S2 · High · C · L1 (the class sail area)
- **Evidence.**
  - `class-spec.json` gives 13.5 m², symmetric with a pole of 2.14 m and a hoist of 6.49 m (S(p)).
  - PHYSICS.md §13 lists the spinnaker as not modelled.
  - The model's downwind speeds in 10 kn: 5.15 / 4.85 / 4.32 / 4.14 / 3.94 kn at 120 / 135 / 150 / 165 / 178° TWA.
- **Impact.**
  - Downwind legs, gybe angles and crew workload are not those of a racing Squib.
  - Spinnaker broaches are missing.
  - The AI's downwind tactics are built on the wrong polar.
- **Correction.** A symmetric spinnaker with:
  - pole angle and height;
  - sheet and guy;
  - hoist, drop and gybe as timed crew tasks, which the player calls and the crew carries out (D2);
  - collapse when sailed too deep or too high;
  - a contribution to roll and yaw (broach).
- **Files.** `src/sim/boat/` (new sail), `src/sim/control/`, `src/render/squibModel.ts`, `src/ui/Controls.tsx`, `src/sim/ai/`, `tools/ai-polar.ts`.
- **Dependencies.** D1–D3 and PH-1 calibration. The spinnaker's coefficients will be L5 at best.
- **Accept.** A-PH-9 (hoist, drop and gybe timings agreed with the Squib sailor) and A-PH-10 (broach onset).

**PH-4 · Irons is a stable trap.** S3 · High · O, C · L3
- **Evidence.** Head to wind with no way on, the boat settles head to wind and slides astern (diagnostic).
- **Why it matters.** The standard recovery is to back the jib and reverse the rudder, which is published learn-to-sail guidance (L3). There is no "back the jib" control.
- **Impact.** Learners stall, then restart.
- **Correction.**
  - Add a crew action, "back the jib" (hold the jib to the old windward side).
  - Check that the rudder works in reverse flow (a sign test).
  - The coach should explain the recovery.
- **Files.** `src/sim/control/`, `src/sim/boat/` (jib side), `src/app/coach.ts`.
- **Accept.** A-PH-11: recover from irons within 20 s in 8 kn.

**PH-5 · Below 10 fps the simulation runs slower than real time.** S3 · High · C
- **Evidence.**
  - The frame time is clamped to 0.1 s, and at most 12 steps of 0.01 s run per frame.
  - Below 10 fps, simulated time falls behind the wall clock. Below about 8 fps the step limit also bites.
- **Impact.**
  - In live mode the conditions drift away from "now".
  - In a race every boat slows together, so fairness holds, but the player is not told.
- **Correction.**
  - A "running slow" indicator.
  - An automatic drop in quality tier.
  - In live mode, re-sync the environment time on resume (see EN-4).
- **Files.** `src/app/controller.ts`.
- **Accept.** A-PF-3.

**PH-6 · Only sheets as sail controls.** S3 · High · C · L3
- **Evidence.** PHYSICS.md §13: no twist or camber controls. There is no kicker (vang), cunningham, outhaul, backstay or jib car. Racing Squib crews use the kicker and cunningham to depower (L3, general keelboat guidance; the class rules list of permitted controls was not seen).
- **Impact.** Heavy-air technique cannot be practised. Depowering is folded into "flatten".
- **Correction.** Decide in the realism contract (D2). If you choose them, add the kicker and cunningham as twist and depth modifiers on the main coefficients.
- **Dependency.** The class rules (permitted controls) and D2.

**PH-7 · Two polars.** S3 · High · C
- **Evidence.** The dashboard uses `optimiseTrim` (PH-2). The AI's targets (`polarData.ts`) come from auto-trim with a TWA autopilot (`tools/ai-polar.ts`).
- **Impact.** The numbers a user validates are not the numbers the AI races to.
- **Correction.** One polar generator, one crew policy, with the provenance shown.
- **Accept.** The dashboard polar and `polarData.ts` agree within 0.02 kn at every point.

**PH-8 · Gust response and broaching are not characterised.** S3 · Med
- **Evidence.**
  - RACING.md: without easing, the model broaches when reaching in 20 kn or more, so the AI eases the main beyond 24° of heel (E).
  - Heavy-weather behaviours exist: rudder ventilation beyond 45° of heel, and the crew releasing the sheets beyond 50°.
  - This review did not measure gust response times or broach onset.
- **Correction.**
  - Add step-gust scenarios to the behaviour-envelope report: heel response time, speed response, and helm needed to hold course.
  - Add a broach-onset sweep (wind speed against TWA, sheets fixed and eased).
- **Accept.** A-PH-12 and A-PH-13 measured, then judged by the Squib sailor.

**PH-9 · No pitch or heave in the physics.** S4 · High · C · L5
- **Evidence.** PHYSICS.md §13. The boat rides the waves in the picture only.
- **Impact.** No speed loss in a chop; wind against tide has no effect on handling. This matters little on the river and more in Start Bay.
- **Correction.** Later: an added-resistance-in-waves term from the sea state. This is not recommended now.

**Positive results (no action).**
- Port/starboard symmetry is exact at 45, 90 and 150° TWA.
- Forces balance at steady state: drive 295.9 N against resistance 297.7 N, with a total residual of 0 at 5.29 kn.
- A current carries the boat at the right rate: 60.8 m against 61.7 m expected.
- Coast-down is monotonic.
- No hidden clamps hold speed or heel to a target.
- The simulation core is pure. ESLint forbids the DOM, `Math.random` and `Date.now` in `src/sim`.

#### Collision, grounding and damage

**CO-1 · High rebound.** S3 · High · O · L5
- **Evidence.**
  - 8 kn square into a jetty: rebounds at 2.89 kn, so restitution is about 0.36 and the damping ratio about 0.18 (`contact-out.json`).
  - The parameters: k = 2×10⁵ N/m, c = 5×10³ N·s/m.
- **Impact.** Collisions feel like pinball. A GRP keelboat hitting timber mostly absorbs energy (H, L5).
- **Correction.** Raise the damping towards a damping ratio of 0.6–0.8, and let damage absorb energy (§5). Restitution then falls to 0.05–0.15.
- **Accept.** A-CO-1.

**CO-2 · Damage thresholds are unevidenced.** S2 · Med · O, C · L6
- **Evidence.**
  - The hull threshold in `src/sim/boat/damage.ts` is about 800 J (E).
  - A 4 kn T-bone (691 J into the other boat's side) leaves both boats "scraped" with no functional damage.
  - A 6+6 kn head-on (1,577 J) cracks the hull.
- **Impact.** Collisions in a race have almost no consequence below about 5 kn, which rewards contact.
- **Correction.**
  - Thresholds per component and per location: bow, topsides, keel root, rudder, rig.
  - Use contact force and energy *per area*, not total energy.
  - Starting values to come from L4 judgement (validation sheet §B4), and labelled.
- **Accept.** A-CO-2 … A-CO-4 classes agreed with the Squib sailor.

**CO-3 · The committee boat's contact shape does not match the drawing.** S2 · High · C · L1
- **Evidence.**
  - In `src/sim/race/fleet.ts`, `markRadius` for a committee boat is 2.5 m.
  - SAMARITAN is drawn 10.82 × 3.57 m (`src/render/samaritan.ts`).
  - A Squib can sail through the drawn stern or bow, at the most contested spot on the start line.
- **Correction.**
  - Give the committee boat a hull polygon in the separating-axis contact used for boats.
  - Its heading comes from the simulation (head to wind, as drawn), not from the renderer.
  - The renderer reads that pose.
- **Files.** `src/sim/race/fleet.ts`, `src/render/course.ts`.
- **Accept.** A-CO-5: contact at the drawn hull edge within 0.2 m.

**CO-4 · Moored boats: the picture and the physics disagree.** S3 · High · C
- **Evidence.**
  - `mooredBoatPose` (`src/sim/race/fleet.ts:319`) has no jitter.
  - `updateMoorings` in `src/render/dart.ts` adds up to ±15° of swing for the picture.
  - For a 9 m boat that puts the drawn ends up to 1.2 m from the physical ones, in slack water.
- **Correction.** Compute the seeded swing in the simulation, deterministic per mooring. The renderer then draws the simulation's pose.
- **Accept.** A-CO-6: the drawn outline lies within 0.1 m of the physics outline for every moored boat.

**CO-5 · No tunnelling and no energy gain (positive).** O
- 8 kn into a 0.3 m jetty does not pass through.
- No collision gained energy.
- A boat pinned by 18 kn of wind is stable (1.9 mm jitter).
- A 20° glancing contact turns the boat parallel and rubs smoothly.
- **Keep:** add these as regression tests (A-CO-7).

**CO-6 · Grounding with tide and heel.** S3 · Med · O · L5
- **Evidence.**
  - A boat sailed onto the bank grounded at 141 s (keel 502 J, "scraped") and floated off on the rising tide at 1,239 s (`contact2-out.json`).
  - Not tested: whether heeling reduces the draft at the contact point, and kedging or sailing off by heeling.
- **Correction.** Test it (A-CO-8). If heel is ignored, take the contact points from the heeled keel geometry.

**DM-1 · Damage uses generic multipliers.** S1 · High · C
- **Evidence.**
  - `src/sim/boat/damage.ts`: rig damage scales sail force by a factor.
  - Hull damage leaks into a "bilge" that adds mass, but has no free-surface or stability effect.
  - The rudder states change grip and add a bias.
  - The instrument tooltip says "Thresholds and rates are estimates (E). Restart to repair."
- **Why it is S1.** The brief asks for a causal chain from impact through component condition to physical properties to handling, with no generic percentage penalties.
- **Correction.** The specification in §5.4.
- **Files.** `src/sim/boat/damage.ts` and its callers in the sail, foil and hull force code, plus `src/ui/Instruments.tsx`.
- **Accept.** A-DM-1 … A-DM-5.

**DM-2 · Repair, reset and retirement.** S3 · High · C
- **Evidence.** Restart is the only repair. There is no "retire" in a race, and no damage setting.
- **Correction.** See §5.6.

#### Environment

**EN-1 · The stream's timing is slaved to the rate of change of tide height.** S1 · High · C · L6
- **Evidence.**
  - `src/sim/env/current.ts` scales a fixed pattern (from the estimated bed, `tools/geodata/current.py`) by the normalised rate of change of tide height.
  - So the stream is slack exactly at high and low water, and the flood mirrors the ebb.
  - The brief: "never derive currents from high/low-water times or assume slack at high and low water."
- **Impact.**
  - Wrong timing of the stream turn, especially at the entrance and in Start Bay, where the Channel stream does not turn at local high water (R, general tidal knowledge; Dart-specific stream data not obtained).
  - Wrong strength asymmetry.
  - River tactics built on it teach the wrong lessons.
- **Correction.** See §6.3. In short:
  1. **Now:** label the stream "illustrative", and default it off in racing unless chosen.
  2. **Then:** drive it from published stream data, which needs a licence, or from a calibrated model, with its own phase and amplitude for flood and ebb.
- **Dependency.** D5 (data source and licence).
- **Accept.** A-EN-1.

**EN-2 · The bed below the low-water line is estimated.** S2 · High · C · L6
- **Evidence.** GEODATA.md: depth below chart datum = Dcap·(1 − e^(−d/35 m)), with Dcap 9 m in the harbour.
- **Impact.**
  - Groundings and the depth display mid-channel are not real.
  - The stream pattern rests on the same estimate.
  - The depth tooltip already says "PROVISIONAL … Not for navigation", which is good.
- **Correction.** Get survey bathymetry (§6.2, D6). Until then keep the warning, and mark the shallow areas the stream and grounding depend on.

**EN-3 · The chart-datum offset comes from a secondary source.** S3 · Med · C · L3
- **Evidence.** 2.62 m below ODN at Dartmouth (issue 14).
- **Correction.** Confirm against UKHO or National Tide and Sea Level Facility datum information.
- **Accept.** The offset is documented with a primary source.

**EN-4 · There is no authoritative real-time clock.** S2 · High · C, O
- **Evidence.**
  - Times are shown in UTC only. There is no Europe/London display, and no "BST/GMT" label.
  - A hidden tab stops the frames. `controller.ts:1043` only pauses the sound.
  - When the tab returns, `t` carries on from where it stopped, so a "live" session is now behind real time without saying so.
  - There is no "return to live".
- **Impact.** The owner asked for real-time weather and lighting. After a phone call, the sun and the tide are wrong.
- **Correction.** §7.2.
- **Accept.** A-EN-2, A-EN-3.

**EN-5 · The live mean wind is forecast only, refreshed every 4–6 h in practice.** S2 · High · O, C · L2
- **Evidence.**
  - The Live data workflow is scheduled every 30 minutes from 06:00 to 20:59 UTC and hourly at night (39 runs a day; `.github/workflows/live-data.yml`). GitHub's scheduler ran it only every 4–6 h (run history).
  - `WEATHER_JOB_LATE_MIN` is 480. The forecast horizon was extended to 8 h this round, so data stays usable, but its age grows.
  - The mean wind "now" is the UKV forecast. The ingest also reads Met Office land observations from Plymouth Mountbatten and Exeter Airport, 35–45 km away, but uses them only to set the size of the wind shifts (`src/sim/env/weather.ts`). The app labels the wind honestly: "Forecast model output, not a measurement".
- **Correction.** §7.3: a scheduled function off GitHub, an observation source where one exists, and blending without jumps.
- **Accept.** A-EN-4.

**EN-6 · Terrain wind effects are estimated.** S3 · High · C · L5
- **Evidence.** The instrument tooltip: "estimated from the terrain (docs/PHYSICS.md), not measured." The UKV grid used here is 2 km (the AWS open-data product), which cannot resolve the Dart valley.
- **Correction.** Keep, label, and validate with the RDYC sailor (validation sheet §C3). Do not add complexity without evidence.

**EN-7 · Generated environment features.** S3 · High · C · L6
- **Evidence.**
  - Moorings are generated (rows 22 m apart, buoys 16 m apart).
  - Ferry timetables are estimated.
  - Only the Castle Ledge buoy is a placed navigation mark.
  - Pontoon widths and deck heights are estimated.
- **Correction.** Ask the RDYC sailor which features matter for racing (validation sheet §C), and source those: DHNA mooring plans, the ferry operators' timetables, and buoy positions from the chart or the Trinity House list.

**EN-8 · No verified RDYC course.** S2 · High · R
- **Evidence.** The 2026 programme and the sailing instructions are on `royaldart.co.uk`, which is blocked. The course library correctly holds no `club-document` courses (COURSES.md).
- **Correction.** You supply the SIs and course cards. They are entered through the existing `pending-check` → `verified` workflow by a named checker. **Nothing is to be invented.**

#### Graphics, cameras and audio

**GR-1 · Real-GPU rendering not inspected.** See §0. Every visual judgement here comes from SwiftShader screenshots or from code. A real-device pass is part of Package 2.

**GR-2 · GPU memory leaks on race restart.** S2 · High · O, C
- **Evidence.**
  - Measured: geometries 399 → 1,257 and textures 34 → 85 over 6 restarts, about +55 geometries each (`ui/leak.mjs`).
  - Cause: `setCourse` removes the old `CourseScene` group without disposing it (`src/render/scene.ts:465`), and `FleetView.setBoats` removes boats without disposing their geometries, materials or label textures (`src/render/fleet.ts`).
- **Impact.** Long sessions on phones run out of GPU memory, which leads to context loss (GR-3).
- **Correction.** Dispose on removal through a shared `disposeObject` helper. Assert in a test that the counts return to baseline.
- **Accept.** A-PF-1.

**GR-3 · No WebGL context-loss handling.** S2 · High · C
- **Evidence.** No `webglcontextlost` or `webglcontextrestored` listener anywhere in `src`.
- **Impact.** On mobile, after backgrounding or memory pressure, the canvas goes blank or frozen with no message.
- **Correction.**
  - Pause the simulation and show "Graphics were reset by the browser — restoring".
  - Rebuild the GPU resources from the scene description.
  - Offer "reload at lower quality".
- **Accept.** A-PF-2, using `WEBGL_lose_context`.

**GR-4 · Reduced motion is not honoured by the 3D camera.** S3 · High · C
- **Evidence.** `prefers-reduced-motion` appears only in `styles.css`. The chase, helm (heel tilt), blends and wave-follow motion take no notice of it.
- **Correction.** With reduced motion:
  - a level horizon in the helm view;
  - no wave heave on the camera;
  - instant cuts instead of 0.6 s blends.
- **Accept.** With the emulated media feature, camera roll is 0 and position jitter is under 1 cm per frame.

**GR-5 · A heavy scene.** S3 · Med · O
- **Evidence.** About 345 draw calls, 2.2–2.7 M triangles and about 480 MB of JS heap on the river with 10 AI boats, in SwiftShader.
- **Impact.** Unknown on real phones. This must be measured before optimising (§9.3).

**GR-6 · Audio (from code only).** S4 · Med · C
- **What it does.** Procedural Web Audio (`src/render/audio.ts`): wind, water, luffing, boom, halyards. It follows the simulation, pauses when hidden and has no licensing exposure.
- **Missing:**
  - a sound for contact or grounding, which would be important feedback;
  - start-sequence sound signals (none in `audio.ts`; the sequence is shown with flags only);
  - spinnaker sounds (none, since there is no spinnaker).
- **Correction.** Add contact, grounding and start-signal sounds. Signals for the start sequence follow RRS 26 timing, *if* the club's SIs use sound signals; verify first.

**Graphics consistency checks.** These passed by code inspection:
- the boom, rudder, heel and luffing come from the simulation snapshot;
- the Squib's rudder blade depth matches the physics' rudder-heel contact point (0.8 m, `tests/render/committee.test.ts`);
- the sails are drawn on the side the simulation computes.

The known inconsistencies are CO-3 and CO-4.

#### Onboarding, UI and UX

Screenshots (software-rendered): [phone 390×844](img/review/08-race-phone.png), [laptop 1000×560](img/review/08-race-laptop.png), [pre-start](img/review/05-race-prestart.png), [race end](img/review/07-race-end.png), [tutorial](img/review/03-tutorial-step1.png).

**UX-1 · Load time.** S3 · Low · O
- **Evidence.** 23.5 s to the first steerable frame in SwiftShader. Real devices are unmeasured.
- **Correction.** Measure on two or three real devices (Package 8). Show progress with what is loading. Make free sailing in open water available before the Dart geodata finishes.

**UX-2 · The welcome dialog does not trap focus.** S3 · High · O
- **Evidence.** Tab moves to controls behind the dialog.
- **Correction.**
  - Use `inert` on the background, or a focus loop.
  - Move focus to the heading on open.
  - Escape closes the dialog.
  - Return focus on close.

**UX-3 · Small targets and small text.** S3 · High · O
- **Evidence.**
  - Checkboxes are 13×13 px and the slider thumb is 16 px. WCAG 2.2 SC 2.5.8 asks for at least 24×24 CSS px.
  - Labels are 11 px.
- **Correction.** Tokens for a minimum target size of 24 px (44 px on touch) and a minimum text size of 12–13 px.

**UX-5 · The instruments overlap the dock.** S2 · High · O
- **Evidence.** At 390×844 and 1000×560 the instruments panel covers part of the dock (screenshots). U12 records the phone layout as "by design".
- **Correction.** A layout grid with reserved regions (§8.3 mockup), and container queries for the dock.
- **Accept.** No overlap at 360×640, 390×844, 1000×560, 1280×800 or 1920×1080 (Playwright bounding-box test).

**UX-6 · Over-the-line limbo.** S2 · High · O
- **Evidence.** An unsteered player who is OCS stays OCS indefinitely. The race panel shows the state but gives no instruction.
- **Correction.**
  - Coach: "You were over the line at the start. Sail back to the pre-start side of the line (either end), then start."
  - An arrow to the nearest end.
  - After N minutes, offer "retire" or "return to start".
  - This follows RRS 30/29.1 as implemented (individual recall); it does not adjudicate.
- **Accept.** A-RA-1.

**UX-7 · Text glitches.** S4 · High · O
- Status text is truncated ("Luffing · trim i…", U11).
- The footer says "gusty gusts".
- The coach card is cut off at 800 px height (U7).

**UX-8 · The steering convention is untaught.** S2 · Med · C · L4
- **Evidence.** A/D (and the arrow keys) turn the bow left or right. On a tiller the helm pushes the tiller *away* to turn the bow *towards* the side it was pushed from. The tutorial does not say which convention the keys use.
- **Impact.** Sailors try "tiller logic" and steer the wrong way. Non-sailors learn a habit that will not transfer to a real boat.
- **Correction.**
  - Ask once: "Steer like a car (bow follows the key) or like a tiller (push the tiller)?" (D4).
  - Show a tiller widget that moves with the actual tiller angle.
  - Teach it in lesson 1.

**UX-9 · Key distinctions are shown but not taught.** S3 · High · C · L3
- **Evidence.**
  - The instruments already show STW, SOG, COG, TWA, AWA, TWS, AWS, VMG, leeway and helm balance, with good tooltips (`src/ui/Instruments.tsx`).
  - No lesson or overlay explains heading against course over ground, true against apparent wind, speed through the water against over the ground, or VMG.
- **Correction.** Short lessons with a scene overlay:
  - a heading line against a COG line, with the current vector;
  - a true-wind arrow against an apparent-wind arrow;
  - a VMG projection onto the wind axis.

  The arrows module (`src/render/arrows.ts`) already draws some vectors.

**UX-10 · Still open from the earlier UI audit.**
- U4: two overlapping race set-ups.
- U5: no interface level.
- U6: a luffing warning first in free sailing.
- U8: colour-only distinctions.
- U9: one long tutorial.
- U10: layered CSS overrides.
- U12: phones.

See [UI_V2_REPORT.md](UI_V2_REPORT.md).

#### Racing, AI and replay

**RA-1 · The rules subset.** S2 · High · C · L1
- **Implemented** (RACING.md §3):
  - at a contact, rules 13, 10, 11 and 12 decide which boat had to keep clear, and she owes a Two-Turns Penalty (44.1);
  - rules 14, 15 and 16 are noted, not judged;
  - touching a mark is a rule 31 One-Turn Penalty;
  - penalty turns follow 44.2.
- **Not implemented.**
  - 14, 15 and 16 as adjudication;
  - 17–24, including **18 (mark-room)** and 19–20 (obstructions, hailing);
  - exoneration;
  - the scoring penalty (44.3);
  - protests and redress (RACING.md).
- **Impact.** At roundings the player gets no mark-room and must judge it. The AI keeps clear but awards nothing.
- **Correction.**
  - Rule 18 first, after re-verifying the RRS 2025–2028 text. It needs the zone (3 lengths), "clear astern/ahead" and "overlapped" at the zone, and the exemptions.
  - Then 19/20 for the river's pontoons.
  - Label everything "simplified, not an authoritative adjudication", as now.
- **Dependency.** D11.

**RA-2 · The AI knows the current along its predicted track.** S3 · High · C
- **Evidence.** `src/sim/ai/skipper.ts:884` samples the stream at the AI's predicted future positions. It senses the wind only where it is, which is fair. A human sees only the current at the boat (and on the water, if drawn).
- **Correction.**
  - At "club" level, the AI uses the stream at its position plus a tide-table expectation.
  - "Expert" may keep the look-ahead, labelled as local knowledge (D10).

**RA-3 · AI on the river and in large fleets.** S2 · High · O
- **Evidence.**
  - River: 15 of 20 runs clean, 96% of boats finished. One boat over the line early was pinned on the pontoons in 7 kn against the stream.
  - Larger fleets: 10 boats 77% clean, 20 boats 40% (no mark-room).
- **Correction.** Comes after RA-1 (mark-room) and EN-1 (the real stream), since both change the AI's problem. Re-run the trials after each.

**The racing journey (from code and RACING.md; not all sailed in this review).**

| Stage | Present | Gap |
|---|---|---|
| Set-up | Quick race and the scenario race panel; venue, fleet size, AI level, wind, sequence | Two overlapping set-ups (U4) |
| Start | 5-4-1-0 and one-minute sequences with flags; individual and general recall; OCS judged on the hull | No sound signals (GR-6); no guidance to clear (UX-6) |
| Rounding | String-rule roundings, gates, boundaries | No mark-room (RA-1) |
| Finish | Line crossing judged | — |
| Scoring | Results table; an untaken penalty is shown, the score is not changed | No 44.3 scoring penalty; no RET or DNF choice by the player (DM-2) |
| Debrief | Coach tips and decision feedback; replay bar | No track-against-polar analysis; incidents not listed with rule numbers in one place |
| Rules research | RRS 2025–2028 text verified for the implemented subset (Phase 5) | The rule 13 "both tacking" wording is marked "not verified" in RACING.md |

**AI equivalence.** The AI sails through the same controls and assists as the player (RACING.md §4) and never sets the boat's state. Its targets come from the model's own polar. Its advantages are:

- the look-ahead current (RA-2);
- the brisk turn model in its avoidance search, which is a planning device, not extra boat performance.

**RA-4 · Replays (positive).** C
- Recordings keep the scenario, the seed, the inputs and any live-data snapshot (`src/app/replay.ts`). This meets the brief's requirement to preserve data snapshots and seeds.
- **Extend** to:
  - damage events (DM-1);
  - clock re-syncs (EN-4);
  - live-data blends (EN-5).

#### Software performance and reliability

**PF-1 · Source maps in the deployed build.** S4 · High · O
- **Evidence.** Of the 11 MB `dist`, 6.7 MB is source maps. They contain no secrets (`tools/check-secrets.ts` scans them).
- **Correction.** Either keep them (they help debugging, and there is no secrecy issue) or upload them elsewhere. This is a preference (P). The download cost is only paid when developer tools are open.

**PF-2 · Large modules.** S4 · High · C
- **Evidence.** `controller.ts`, `dart.ts` and `squibModel.ts` are each about 1,300 lines.
- **Correction.** Split along seams when a package touches them: the clock out of the controller, the moorings out of `dart.ts`. Do not refactor for its own sake.

**Measured software performance (SwiftShader, so relative only).**
- Physics with 11 boats: 0.23–0.62 ms per 0.01 s step in the browser.
- `npm run perf` (Node): 21 boats, 0.80 ms mean and 1.98 ms p99 per frame.
- The physics is not the bottleneck. Rendering is the unknown.

---

## 4. Physics validation specification

### 4.1 Reference sheet

| Quantity | Value | Level | Source and use |
|---|---|---|---|
| LOA | 5.79 m | L1 | Wikipedia, keelindex |
| LWL | 5.18 m | L1 | keelindex |
| Beam | 1.867 m | L1 | Wikipedia |
| Draft | 0.99 m | L1 | keelindex |
| **Bare boat** | Not known | — | No source separates hull, rig and keel weights except the ballast |
| Ballast (cast iron fin) | 375 kg | L1 | keelindex; class rules excerpt |
| **Class minimum** | 680 kg, including sails and mandatory items (up to 30 kg of correctors) | L1 (partial) | Class Rules 2022 excerpt. The 2025 edition was not seen |
| **Sailing displacement in the model** | 680 + 2 × 80 kg crew = **840 kg**; older non-self-draining variants +15 kg | L1 + L6 | Crew mass 80 kg each is E. No crew-weight limit was found |
| Main / jib / spinnaker | 10.5 / 6.0 / 13.5 m² | L1 (partial) | NSOA. **Conflicts** with 15.8–15.98 m² upwind (Wikipedia, keelindex). ±4% area is worth about ±0.07 kn by the sensitivity runs, so it is low priority |
| Mast | 7.695 m | L1 (partial) | Datum not established |
| Spinnaker pole / hoist | 2.14 m / 6.49 m | L1 (partial) | Class Rules 2022 excerpt |
| Hull lines | None | — | Shapes are E |
| Portsmouth Yardstick | 1142 | L2 (a handicap) | Wikipedia; not checked against the current RYA list |
| ORC GPH | 880.1 s/nm | L2? | keelindex. Its basis (certificate or estimate, wind speeds averaged) is unconfirmed |
| Hull-speed rule of thumb | ≈ 5.5 kn | L5 | 1.34√LWL(ft) |

**Class rules needed.** The 2025 class rules are needed to settle three things:

- the minimum weight and how it is measured;
- the permitted controls (PH-6);
- the sail area.

### 4.2 Foundations audit

| Item | Status | Evidence |
|---|---|---|
| Units | SI internally; kn and ° only at the UI and in scenario files | C |
| Frames | NED world; body x forward, y starboard, z down; documented in PHYSICS §1 | C |
| Integration | RK4, dt 0.01 s, fixed step, accumulator; deterministic hash `11824f89f479d0f4` | C, O |
| Force-based or target-driven | **Force-based** for the boat. Target-driven parts are the crew policy (auto-trim targets 20° main and 16° jib; auto crew within ±0.8 m), the heavy-weather sheet release at 50°, and the AI. These are *controllers acting through the same controls*, not overrides of the state | C |
| Double counting | None found. The current enters only through ground velocity; apparent wind is wind minus ground velocity; hydrodynamics use velocity through the water | C, O (drift test) |
| Clamps | None hidden on speed, heel or yaw rate. Frame time is clamped (PH-5). Sheets and rudder are clamped to physical ranges | C |
| Added mass | Surge, sway and yaw, constant (E) | C |
| Roll | Dynamic with a GZ table (E, GM 0.8 m) and damping (E) | C |
| Pitch, heave | Not modelled (PH-9) | C |

### 4.3 Behaviour envelope

These are **model outputs from this review**, not expectations. Column 3 says what would falsify them and who can judge. The "provisional band" is what I would *ask the sailor to confirm or correct*; it is not a claim about the real boat.

| Behaviour | Model output (this review) | Judged by / evidence needed | Provisional band to put to the sailor |
|---|---|---|---|
| Upwind speed, 6 / 10 / 14 / 18 kn TWS (max-drive helper, PH-2) | 3.47 / 4.79 / 5.21 / 4.92 kn | Squib sailor (L4); GPS tracks (L2) | 10 kn: 4.3–5.0 kn |
| Heel close-hauled, same winds | 0.1 / 8.5 / 23.3 / 42.9° | Squib sailor (L4) | 14 kn: 15–25° with the crew hiking; 18 kn heel above 30° is suspect (PH-2) |
| 22 kn close-hauled, auto-trim with flatten | 5.7 kn, 25° steady | Squib sailor | — |
| Leeway close-hauled | 3.6–7.9° | L5; L4 hard to judge | — |
| Helm balance (rudder for straight) | 0.4 → 5.5° weather helm, 6 → 18 kn | Squib sailor ("how much weather helm?") | Light weather helm rising with heel |
| Reaching, 10 kn, 90° TWA | 5.57 kn | Squib sailor; GPS | — |
| Downwind, 10 kn, no spinnaker, 120–178° | 5.15 → 3.94 kn | GPS without spinnaker is rare: low value until PH-3 | — |
| Acceleration from 3 kn, 60° TWA, 10 kn | t50 4.6 s, t90 10 s to 5.28 kn | Squib sailor | — |
| Coast-down from 5 kn, no wind | 3 kn at 9.2 s; 1 kn at 60 s and 61 m | Squib sailor ("shooting a mooring") | — |
| Tack, 10 kn | 4.78 → 2.45 kn; turn 8.6 s; 90% recovery 13.6 s; 11.8 m to windward lost | Squib sailor; video | Loss of about 1–2 boat lengths |
| Tack, 6 / 15 kn | Losses 14 m and 10 m; recovery 27 s and 12 s | as above | — |
| Gybe, 10 / 18 kn | Turn 5.8 / 4.4 s; minimum speed 3.16 / 4.68 kn | as above | — |
| Turning circle, hard over | 17.3 m diameter at a mean 2.7 kn | Squib sailor | About 3 boat lengths |
| Circular-random average | 874 s/nm at 8 kn; 710 at 12 kn | ORC GPH 880.1 (basis unconfirmed) | If GPH is the mean of the 8 and 12 kn values, the model (792) is about 10% fast **without** a spinnaker. A signal to examine, not a target (H) |
| Irons | Stable head to wind, sliding astern; no recovery control | L3 | Recoverable in 10–20 s by backing the jib |
| Drift in 1 kn current, no wind | SOG 1.01 kn; STW 0.22 kn (sailing on the current-made wind) | Physics | Correct |

### 4.4 Sensitivity and identifiability

These are the ±20% runs. The first three rows are the average speed round a circular-random course in 12 kn (base 5.07 kn). The residuary rows are steady speeds at 90° TWA (base 5.94 kn in 12 kn, 7.14 kn in 18 kn).

| Parameter | −20% | +20% | Identifiable from |
|---|---|---|---|
| Sail areas (sail power) | 4.86 | 5.22 | Upwind speed in moderate air |
| Friction form factor | 5.14 | 4.99 | Light-air speed (weakly) |
| Main clMax | 5.02 | 5.09 | Hardly: insensitive |
| Residuary table, 90° TWA | 6.18 | 5.78 | Reaching speed in 12+ kn |
| Residuary table, 18 kn, 90° TWA | 7.64 | 6.80 | Reaching speed in strong winds |

**Conclusion.** Calibrate at most four lumped scales, each against a distinct observation:

| Scale | Observation |
|---|---|
| Sail power | Upwind speed in 8–10 kn |
| Residuary | Reaching speed in 15+ kn |
| Righting moment | Heel against wind speed |
| Keel lift slope | Pointing and leeway: tacking angle over the ground in no current |

Fix everything else. This is the **simplest defensible model**: the current structure, with four tunable scales and the rest frozen and labelled.

### 4.5 What not to change

- Do not add pitch or heave, wave added resistance or wind gradient until the four-scale calibration is done. They add parameters that cannot yet be identified.
- Do not tune by eye to "feel". Every change goes through the behaviour-envelope report and the sailor's tolerances.

---

## 5. Collision, grounding and damage specification

Physics, damage and rules stay **separate**:

```
contact (physics) ──► impact event {who, where, normal, relative speed, energy, peak force}
                          │
                          ├──► damage model ──► component condition ──► physical properties
                          │                                               (read by the force code)
                          └──► rules (RRS 14, 31 as now) ──► penalties
```

Neither damage nor rules ever moves a boat. Only forces do.

### 5.1 Detection

| Item | Keep / change |
|---|---|
| Separating-axis test on the 13-vertex hull outline against polygons | Keep |
| Circles for marks and buoys | Keep for marks. **Change** the committee boat to a polygon (CO-3) |
| Moored boats | Pose from the simulation, including the swing (CO-4) |
| Tunnelling | None found at 8 kn against 0.3 m. Add a regression test (A-CO-7) at a 14 kn closing speed against a 0.3 m pile |

### 5.2 Contact model

**Today:** a penalty spring-damper, with μ 0.3 and these stiffnesses:

| Contact | k (N/m) | c (N·s/m) |
|---|---|---|
| Hard body | 2×10⁵ | 5×10³ |
| Inflatable mark | 3×10⁴ | — |
| Floating pontoon | 8×10⁴ | — |

**Proposed:**

1. Set the damping per pair from a target damping ratio ζ: c = 2ζ√(k·m_eff). Use ζ 0.7 for GRP against timber or GRP, and 0.3 for inflatable marks.
2. Absorb energy into damage. The energy above a component's elastic limit is removed from the contact through extra damping during that contact.
3. Keep the forces held over each RK4 step. They are energy-safe, as measured.
4. Frames: the contact point and normal in world NED; the impact event carries both the body-frame location (bow, topsides, keel, rudder) and the world normal.

### 5.3 Grounding

**Today:**

- three contact points (keel fore, keel aft, rudder heel);
- the bed from the elevation grid;
- the water level from the tide;
- release when the tide lifts the boat.

**Proposed:**

- Take the contact points from the heeled geometry: heeling reduces draft at the keel tip.
- Model bed friction by material if data exists. Otherwise μ 0.4 (E), labelled.
- Grounding at speed is an impact (§5.4). Lying aground is not, beyond its first contact.
- On the UI: show "Aground — the tide is rising, about N min to float" from the tide prediction, or "falling" with the option to heel, back the sails or retire.

### 5.4 Damage: a causal chain

| Component | Condition variables | Physical property changed | Handling effect | Initial thresholds (E, to be agreed — validation sheet §B4) |
|---|---|---|---|---|
| Hull, bow and topsides | Crack area (cm²), location above or below the waterline | Leak rate from the crack area and its depth below the waterline (orifice flow, Cd 0.6) | Water mass → displacement, trim **and free-surface loss of GM** → slower and more tender | Cosmetic < 0.4 kJ per contact; crack 0.4–1.5 kJ local, or a peak force > 15 kN; hole > 3 kJ |
| Keel root | Joint damage (none / weeping / loose) | Leak at the keel bolts | As for the hull; a loose keel is session-ending | Grounding > 1.5 kJ at the keel tip |
| Rudder | Blade (ok / chipped / bent / broken), stock angle offset | Lift slope, area, angle offset | Less grip, a constant pull, or no steering | Bent: lateral load > 3 kN at the blade |
| Rig | Forestay, shrouds, spreaders, mast (ok / damaged / failed) | The maximum *load* each can carry before it fails; when failed: the sail cannot be set | A damaged shroud limits sheeting on that tack (crew eases); a failure brings the mast down (session-ending) | Bow impacts load the forestay; a side impact at the chainplates loads the shrouds |
| Sails | Torn (area lost) | Sail area and coefficients | Less drive on that sail only | From rig failures, not from impacts |
| Water inside | Bilge volume (L) | Mass, free surface (reduced GM) | Slower and more tender; the crew pumps (rate E) | — |

**Rules for the chain.**

- **No percentage penalties.** Every effect works through a physical quantity the force model already uses: mass, GM, sail area, foil lift slope or offset, or a load limit.
- **State thresholds explicitly** in one table (`data/boats/squib/damage.json`), each with its tag and source.
- **Three outcome classes:**
  - **cosmetic:** a scratch is drawn, with no handling change;
  - **functional:** a property changes;
  - **session-ending:** sinking (water above a threshold), a dismasting or a loose keel.

### 5.5 How the player is told

- **At the impact:** a short sound (GR-6), a camera shake (not with reduced motion), and a toast that says what happened in plain words. For example: "Hit the pontoon at 3.1 kn — bow cracked above the waterline (cosmetic)".
- **Condition panel:** a simple boat diagram with the component states and the bilge level, plus the rate in and the rate out.
- **Session-ending:** a dialog that explains why, and offers a replay of the last 20 s.

### 5.6 Settings, repair, reset, retirement, fairness, replay

| Setting | Effect | Recommended use |
|---|---|---|
| Off | Contact forces only; no damage | Learning |
| Realistic | §5.4 | **Default for racing** |
| Strict | Lower thresholds; no repair | Expert |

- **Repair:** only outside a race. "Return to the club pontoon" repairs everything. A quick "reset boat" repairs too, but is available only in free sailing.
- **Retire:** a "Retire" button in a race. It is scored RET, and the AI boats retire too when session-ending damage occurs.
- **Fairness:** the AI uses the same damage model. Its reflexes already avoid contact.
- **Replay:** damage is derived deterministically from impacts, so replays reproduce it. Store the damage-model version in the recording.

---

## 6. Geography and environment assessment

### 6.1 Geography

| Element | State | Level | Note |
|---|---|---|---|
| Projection (Transverse Mercator about RDYC) | Matches PROJ to < 1 mm; landmark distances within 8 cm | L1 | Tested |
| Heights | ODN; chart datum 2.62 m below ODN (EN-3) | L1 / L3 | — |
| Land terrain | EA LIDAR composite DTM 2 m (via terrarium tiles, about 3 m), sampled on an 8 m grid (4 m in the towns) | L1 | Survey date unknown |
| Water outline | OSM coastline and riverbanks via Overture 2026-10-21 | L1 (crowd-sourced) | — |
| Drying areas | LIDAR between the surveyed water surface and +2.5 m ODN | L1 | — |
| **Bed below the low-water line** | Exponential estimate (EN-2) | **L6** | Drives groundings, depth and the stream |
| Buildings | OSM and Microsoft footprints; heights from data (2,041), floors (392) or type (2,971, E) | L1 / L6 | Visual only, except the shoreline structures |
| Piers and pontoons | OSM positions; widths and deck heights E | L1 / L6 | Collision geometry follows the estimated widths |
| Moorings | **Generated** | L6 | EN-7 |
| Navigation marks | Castle Ledge only | L1 | Others listed, not placed |
| Ferries | OSM routes; timetables E | L1 / L6 | Restricted in ability to manoeuvre (DHNA, S(p)) |
| Landmarks | OSM footprints; models from the owner's photographs | L1 / L4 | — |

**Collision geometry against the picture.** Shorelines, piers, pontoons and drying ground come from the same data for both. The two exceptions are CO-3 and CO-4.

**Terrain effects on wind.** These are estimated shelter and channelling (EN-6). Keep them, label them, and let the RDYC sailor judge them (validation sheet §C3).

### 6.2 Datasets still needed

| Need | Candidate source | Licence and cost | Status |
|---|---|---|---|
| River bathymetry | DHNA hydrographic surveys; UKHO survey data (the ADMIRALTY marine data portal) | To confirm. Some UKHO survey data is under OGL; DHNA unknown | Not obtained |
| Tidal stream timing and rates | UKHO tidal-stream data (tidal diamonds on the Dart harbour chart; tidal stream atlases) | Licensed UKHO product; cost and terms to confirm | Not obtained |
| Chart datum offset | UKHO or NTSLF | Free to read | To confirm (EN-3) |
| RDYC courses, marks, SIs, 2026 programme | You or the club | Club documents | Blocked host; needed from you |
| Mooring layout | DHNA | Unknown | Optional |

### 6.3 Time, weather, tide and currents

**One authoritative clock (EN-4).** See §7.2.

**Tide height.** Today the height comes from three sources:

- **live:** the EA Dartmouth gauge, station 46154, in 15-minute readings (an observation, OGL);
- **prediction:** harmonics derived with utide from the gauge history (validated in LIVE_TIDES.md);
- **optionally:** UKHO HW/LW events (the Discovery tier; the key is held server-side only).

This is sound. Keep it.

**Tidal stream (EN-1).** Rebuild it to separate height from stream:

1. The stream at a point is a function of the **tidal phase relative to a reference port's high water** (as tidal diamonds are tabulated) and of the **tidal range** (springs or neaps). It is **not** derived from dh/dt.
2. The flood and the ebb each have their own amplitudes and turn times, read from the data.
3. The spatial pattern can stay the present channel-following field. It needs re-scaling at the diamond positions once there is real bathymetry.
4. **Until data is licensed:**
   - label the stream "illustrative — not real timing";
   - default it **off** in racing;
   - remove any UI text implying slack at high and low water.

**Wind.** UKV vectors are interpolated as components, so north is handled correctly. Gusts are seeded from the forecast gust value (E) and terrain effects estimated (E).

**What a live update may do.** A live update may not jump the force on the boat. Blend old to new over at least 60 s of simulation time, recording the blend in the replay.

**Accuracy ceiling.** State this in the Conditions panel:

- the UKV grid used is 2 km, so it resolves features of several kilometres at best;
- the Dart's valley winds, shifts and gusts at the scale that matters for racing (tens to hundreds of metres) are **not** in the data;
- what the simulator shows is a plausible realisation, not the actual wind at a given buoy.

---

## 7. Live-data architecture

The full source register is in [review/SOURCE_REGISTER.md](review/SOURCE_REGISTER.md).

### 7.1 Today

```
GitHub Actions cron (best effort; observed every 4–6 h)
  ├─ Met Office UKV 2 km (AWS open data, CC BY-SA 4.0) → tools/ingest/weather.py → live/latest.json (8 h of forecast)
  ├─ Met Office land observations (AWS open data): Plymouth, Exeter, 35–45 km away → shift size only
  ├─ EA gauge 46154 (OGL)                         → live tide observations
  └─ UKHO Discovery (key as a CI secret)          → HW/LW events
        ▼
GitHub Pages (static JSON) ──► browser: freshness check (fresh / stale / expired) ──► scenario
```

**Strengths:**

- no secrets in the browser (a build-time scan of `dist/`, source maps included);
- snapshots go into the replays;
- stale data is labelled.

**Weaknesses:**

- the refresh cadence (EN-5);
- the mean wind is forecast only (no local observation);
- no smoothing on updates;
- the clock (EN-4).

### 7.2 The authoritative clock

**One module**, `src/app/clock.ts`. It is the only reader of the wall clock outside the freshness checks.

| State | Simulation time | Environment time |
|---|---|---|
| Live | Advances with the frames | `t_env = wall clock` (UTC). Corrected smoothly if the simulation falls behind |
| Paused | Stops | Stops; live mode becomes "Paused — X min behind live" |
| Accelerated (×2, ×5, ×10 outside races) | Faster | Moves ahead of live; shows "+X min" |
| Background tab | Stops | On return, if the session is live: the dialog "Return to live (jump X min) / carry on from here" |
| Replay | From the recording | From the recording |

- **UTC internally.** Every display is Europe/London, with BST or GMT shown (`Intl.DateTimeFormat` with `timeZone: 'Europe/London'`).
- **Return to live.** Jump the environment time, keep the boat's state, and blend the wind over 60 s. The replay records the jump as an event.

### 7.3 The smallest backend that works

**Recommended (D8):** one scheduled serverless function with a free tier, such as a Cloudflare Worker cron or a similar service, running every 15 minutes. It:

- holds the API keys (the Met Office DataHub key and the UKHO key) server-side;
- fetches:
  - the UKV or DataHub site-specific forecast for the Dart;
  - the EA gauge;
  - **a local observation source if one becomes available**, such as a harbour or club anemometer (DHNA publishes no API that I could find). The regional Met Office stations already ingested are too far away (35–45 km) to set the Dart's wind;
- writes one small JSON file with `issued`, `validFrom`, `kind: observation|forecast` and the attribution, to the same static host or to a KV store, with CORS limited to the site.

**Estimated cost:** £0 on free tiers. The DataHub paid tiers start at £8 a month (LIVE_WEATHER.md) if 360 calls a day is not enough.

**Keep GitHub Actions** as the fallback writer. The browser keeps the present freshness logic.

### 7.4 Observation and forecast

- Show the kind on every value: "Measured 10:40 at …" against "Forecast for 10:45 (issued 06:00)".
- Never present a forecast as an observation.
- When both exist, an observation sets the start of the session and the forecast drives its evolution, blended (§6.3).

---

## 8. Onboarding, UI, UX, graphics, camera and audio

### 8.1 The journey (proposed)

1. **First visit:** one question, "Have you sailed before?". It sets the interface level, the steering convention (D4) and the assists.
2. **Lesson 1:** steering. A tiller widget, one buoy to sail to, and the heading against the course over the ground.
3. **Lesson 2:** the wind. True and apparent wind, the no-go zone, and getting out of irons (PH-4).
4. **Lesson 3:** trim. Telltales, luffing, the auto-trim assist and when to turn it off.
5. **Lesson 4:** tacking and gybing, with timing feedback from the behaviour-envelope metrics.
6. **Lesson 5:** the start. The sequence, the line, being over early and clearing (UX-6).
7. **Lesson 6:** tide. Speed through the water against over the ground, VMG and laylines in a stream. Use the illustrative stream, labelled, until EN-1 is done.
8. **Quick race**, then the debrief: track, speeds against the polar, decisions, incidents with rule numbers (non-authoritative).

### 8.2 Steering conventions (D4)

| Mode | Keys | What moves | Recommended for |
|---|---|---|---|
| **Bow** (today) | A/← bow to port; D/→ bow to starboard | The bow follows the key; the tiller widget shows the tiller going the *other* way | Non-sailors, gamepads |
| **Tiller** | A/← tiller to port (the bow goes to starboard) | As on the boat | Sailors |

Show the tiller widget in both modes, and teach the difference in lesson 1.

### 8.3 Annotated mockups (PROPOSALS, not current screens)

**Racing HUD, laptop (1280×800), proposal:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] River · Race 1/1 · 10:42 BST (live)   ⏸  ⚙            Leg 2/4 ▲ Mark 1   │ ← top bar: clock in Europe/London,
│                                                                              │   live/behind state (EN-4)
│  ┌─────────────┐                                         ┌──────────────┐    │
│  │ STW 4.8 kn  │                                         │  minimap     │    │ ← reserved regions; nothing
│  │ SOG 5.6 kn  │   (3D view)                             │              │    │   overlaps the dock (UX-5)
│  │ VMG 3.9 kn  │                                         └──────────────┘    │
│  │ TWA 44° S   │                                                             │
│  │ Heel 12°    │          ┌ Coach ─────────────────────────────┐             │ ← coach card in its own region,
│  └─────────────┘          │ Over the line: sail back below the │             │   never clipped (U7, UX-6)
│                           │ line, either end. → nearest end ↙  │             │
│                           └────────────────────────────────────┘             │
│ ┌ dock ────────────────────────────────────────────────────────────────────┐ │
│ │ ⟲ tiller ◀━━━●━━━▶  Main ▮▮▮▯ Jib ▮▮▯▯  [Auto-trim ✓] [Flatten] [Spin ↑]│ │ ← 44 px targets on touch (UX-3);
│ └──────────────────────────────────────────────────────────────────────────┘ │   spinnaker only after PH-3
└──────────────────────────────────────────────────────────────────────────────┘
```

**Phone (390×844), proposal:** the instruments collapse to one strip of three values (STW, TWA, heel), and tapping it expands to all of them. The dock becomes two rows. The minimap is hidden behind a button. The coach shows as a bottom sheet over the dock, not over the instruments.

**Teaching overlay, proposal:** in the 3D view,

- a thin heading line from the bow;
- a dashed COG line;
- a current arrow at the boat;
- the true-wind arrow (blue) and the apparent-wind arrow (orange);
- labels, never colour alone (U8).

### 8.4 Accessibility checklist (Package 2)

- Focus trap and restore in every dialog (UX-2).
- Targets at least 24 px, and 44 px on touch (UX-3).
- Text at least 12 px, with contrast 4.5:1 (to be measured with axe once a CDN-free copy is vendored for tests).
- No colour-only meaning (U8).
- Reduced motion for the 3D camera (GR-4).
- Captions or visual equivalents for the start signals and contact sounds (GR-6).
- Everything playable from the keyboard, as now; checked that the keys work after the dialogs close.

### 8.5 Graphics (independent of physics)

**Defects** (fix in Package 1 or 2):

- GR-2: the leak;
- GR-3: context loss;
- CO-3: the committee boat outline;
- CO-4: the mooring swing;
- GR-4: reduced motion.

**Preferences** (your call; none is a defect):

- water colour and wave scale;
- sky and haze;
- the level of detail in the town;
- crew animation fidelity.

**Real-GPU pass.** Capture the same six camera views on two or three real devices (a laptop with an integrated GPU, a recent iPhone, a mid-range Android) and compare them with the SwiftShader references. Record the frame times per quality tier (§9.3).

### 8.6 Cameras

- The six modes are fine (chase, scenic, helm, orbit, drone, top).
- Add an optional "start-line view", looking along the line from the committee boat. It helps when practising starts.
- Honour reduced motion (GR-4).

### 8.7 Audio

Add the contact, grounding and start-signal sounds (GR-6). Add spinnaker sounds with PH-3. Keep everything procedural, so there is no licensing.

---

## 9. Validation and benchmarking plan

### 9.1 Regression versus realism

| | Regression | Realism validation |
|---|---|---|
| Purpose | Behaviour did not change by accident | The behaviour matches the real boat and place |
| Tools | Vitest, golden traces, determinism hash, AI trials, perf | Validation sheet; GPS tracks; on-the-water comparisons |
| Who | CI | The Squib sailor, the RDYC sailor, you |
| Pass means | Same as before (within numerical tolerance) | Within the tolerances the sailors agree |

**A passing regression test is never reported as validation.**

### 9.2 The validation sessions

1. Send [VALIDATION_SHEET.md](review/VALIDATION_SHEET.md) to the two sailors, with a build and the behaviour-envelope report from Package 1.
2. **Squib sailor:** a 45-minute guided session. They sail scenarios A-PH-1 … A-PH-13 and answer each question with "about right / too much / too little, by how much", with their confidence.
3. **RDYC sailor:** the river and Start Bay. Landmarks, depth and danger areas, wind shadows and shifts, stream behaviour, course practice, the start-line set-up.
4. **GPS tracks** (if available): any Squib's logged tracks with a wind record. Each track gives L2 points for the four-scale calibration.
5. **Record** the answers verbatim in `docs/validation/` with the date, the name (if they agree) and the build hash. Change no coefficient without a recorded reason.

### 9.3 Software benchmarking (measure before optimising)

| Metric | Tool | Devices | Budget (proposed) |
|---|---|---|---|
| Time to first steerable frame | Playwright plus a real-device manual run | 3 real devices | < 8 s on the laptop; < 15 s on a mid-range phone |
| Frame time (p50/p95) per quality tier | In-app frame-time overlay, a 60 s scripted route | as above | p95 < 33 ms at the device's default tier |
| GPU resources after 10 restarts | `renderer.info.memory` | any | Back to baseline ± 5% |
| JS heap | `performance.memory` (Chromium) | laptop | < 350 MB on the river (today about 480 MB, SwiftShader) |
| Physics per frame | `npm run perf` | CI | No regression above 10% |

**Quality tiers.** Use the existing graphics presets, auto-selected by a 3-second probe and stepped down when the frame time stays over budget.

---

## 10. Revision packages

Dependency order. Packages 1 and 2 run in parallel; Package 0 is not code.

```
P0 decisions + validation outreach ─┐
P1 measure & make consistent ───────┼──► P3 clock & live data ──► P4 stream & bathymetry ──┐
P2 graphics, UI & UX (parallel) ────┘                                                     ├──► P7 racing & AI
                                     P5 physics fidelity (needs P0 answers, P1 report) ───┤
                                     P6 damage causal model (needs P1 contact fixes) ─────┘
P8 software performance (after P1 measurements; in parallel with P3–P7)
```

| Pkg | Scope | Benefit | Effort | Uncertainty | Validation | Rollback |
|---|---|---|---|---|---|---|
| **P0** Decisions and outreach | D1–D12; send the validation sheet; request the RDYC SIs, the class rules 2025 and the data licences | Unblocks P4, P5 and P7 | You: about 1 h; me: drafting | Answers may take weeks | — | — |
| **P1** Measure and make consistent | (1) Behaviour-envelope report (`npm run envelope`, scenarios A-PH-*, A-CO-*). (2) Polar dashboard on the crew policy, steady-state flags; one polar generator (PH-2, PH-7). (3) Committee-boat polygon; mooring swing in the simulation (CO-3, CO-4). (4) "Running slow" indicator (PH-5). (5) GPU disposal; context-loss handling (GR-2, GR-3). (6) Contact regression tests (CO-5) | Trustworthy measurements; picture = physics; long sessions survive | Medium: about 1–1.5 rounds | Low | A-PH-7, A-CO-5/6/7, A-PF-1/2/3; unit + e2e green; determinism hash changes **only** where documented (moorings, committee boat) | Per item; each is a separate commit |
| **P2** Graphics, UI and UX | UX-2/3/5/6/7/8/9, U4–U12, GR-4, GR-6 (contact and start sounds); lesson tutorial (§8.1); steering mode (after D4); teaching overlays; real-GPU pass (with your devices or screenshots) | The biggest gain for learners; accessibility | Medium–large: 2 rounds | Low–medium (design taste: preferences) | Playwright layout tests at 5 sizes; a focus test; an axe run (vendored); your review of the mockups first | CSS and UI only; the simulation hash is unchanged |
| **P3** Clock and live data | `clock.ts` (§7.2); Europe/London display; return to live; background tabs; a 60 s blend of live updates; observation and forecast labels; the scheduled function (after D8) | Real time as the owner asked | Medium | Medium (the observation source) | A-EN-2/3/4 | Feature flag `liveClockV2` |
| **P4** Stream and bathymetry | Interim label and default off (immediate, small). Then stream tables by phase from licensed data; survey bathymetry; datum confirmed | Removes the S1 stream fault; real groundings | Small interim; large full | **High**: data access and licence | A-EN-1; the RDYC sailor's judgement; AI river trials re-run | Keep the old field behind a setting |
| **P5** Physics fidelity | Four-scale calibration (after the sailor data); spinnaker (PH-3); back the jib (PH-4); kicker and cunningham if chosen (PH-6); gust and broach characterisation (PH-8) | Racing-relevant handling | Large: 2–3 rounds | **High**: parameters L5 until data | Behaviour envelope against the sailor's tolerances; regenerate the AI polar; AI trials | Calibration file versions; a spinnaker feature flag |
| **P6** Damage causal model | §5.2–5.6 | Consequences that teach; no generic penalties | Medium–large | Medium (thresholds L4/L6) | A-DM-1…5; the Squib sailor's judgement of classes | Damage setting "legacy" kept for one release |
| **P7** Racing and AI | OCS guidance (if not in P2); rule 18 after re-verifying the text; 19/20; exoneration; 44.3 scoring option; AI information parity (RA-2); river AI after P4; RDYC courses when the SIs arrive; debrief | Fairer, more realistic racing | Large | Medium (rules edge cases) | A-RA-*; AI trials (Start Bay ≥ 95%, river ≥ 90%, 10 boats ≥ 85%); rules test matrix | Rules behind a "rules level" setting |
| **P8** Software performance | Real-device benchmark; auto quality tiers; heap reduction (geodata typed arrays, label atlases); source-map policy; module splits when touched | Phones usable | Medium | Medium (device variety) | §9.3 budgets | Tier thresholds are configuration |

---

## 11. Recommended first package and decisions needed

### Recommended first package: P1, "Measure and make consistent"

**Why first.**

- It is physics-led, as the brief asks: the behaviour-envelope report and the corrected polar are what the sailors will judge.
- It needs **no decision from you**.
- It removes the picture-against-physics disagreements.
- It makes long sessions reliable.

Everything later is checked against its report.

**Concrete contents.**

| # | Change | Findings | Files (main) | Acceptance |
|---|---|---|---|---|
| 1.1 | `npm run envelope`: runs A-PH-1…13 and A-CO-1…8 headless and writes `out/envelope.json` plus a Markdown table, labelled "model output, not validation" | PH-1, PH-8 | `tools/envelope.ts` (new), `src/sim/scenario.ts` | The report is reproducible (same hash); runs in CI as an artifact |
| 1.2 | Polar dashboard and calibration use auto-trim with flatten; non-steady points flagged; one polar generator for the dashboard and the AI | PH-2, PH-7 | `src/app/polarWorker.ts`, `src/sim/calibration/calibrate.ts`, `tools/ai-polar.ts`, `src/ui/PolarPanel.tsx` | A-PH-7; the dashboard and `polarData.ts` agree within 0.02 kn |
| 1.3 | Committee boat as a hull polygon in the simulation, heading from the simulation | CO-3 | `src/sim/race/fleet.ts`, `src/render/course.ts` | A-CO-5 |
| 1.4 | Mooring swing computed in the simulation (seeded); the renderer draws the simulation pose | CO-4 | `src/sim/race/fleet.ts`, `src/render/dart.ts` | A-CO-6 |
| 1.5 | "Running slow" indicator and automatic step-down of the quality tier | PH-5 | `src/app/controller.ts`, `src/ui/App.tsx` | A-PF-3 |
| 1.6 | Dispose GPU resources on course and fleet changes; handle context loss and restore | GR-2, GR-3 | `src/render/scene.ts`, `src/render/fleet.ts`, `src/render/course.ts` | A-PF-1, A-PF-2 |
| 1.7 | Contact regression tests: no tunnelling, no energy gain, pinned stability, glancing rub | CO-5 | `tests/sim/contact-envelope.test.ts` (new) | Green in CI |
| 1.8 | Interim stream label: "illustrative" and default off in racing (from P4; small, and removes the S1 risk of teaching wrong timing) | EN-1 | `src/app/quickRace.ts`, `src/ui/*` | A-EN-1 (interim part) |

- **Effort:** about one round.
- **Risk:** low. Items 1.3 and 1.4 change the determinism hash; the new hash will be documented with the reason.
- **Rollback:** one commit per item.

### Decisions needed from you

| # | Decision | Recommended | Consequence of the recommendation |
|---|---|---|---|
| **D1** | Intended players | **Club sailors and learners on the Dart, with an expert setting** | The default assists stay on; the depth comes from lessons and settings, not from more controls by default |
| **D2** | What the player controls versus the simulated crew | **Player:** helm and mainsheet; calls for tack, gybe and spinnaker hoist or drop. **Crew (simulated):** jib, spinnaker trim, hiking. Optional manual jib and crew position for experts | Matches the Squib's two-person roles (helm with main, crew with jib and spinnaker); keeps the controls manageable on a keyboard or phone |
| **D3** | Spinnaker in scope? | **Yes, symmetric, crew-handled on the player's call** (P5) | Downwind racing becomes realistic; the coefficients are L5 until there is data; a large package |
| **D4** | Default steering convention | **Ask on first visit; "Bow" for non-sailors, "Tiller" for sailors**; the tiller widget always shown | One extra question; transfers to the real boat |
| **D5** | Tidal stream source | **Interim: illustrative, labelled, off in racing (P1.8). Then ask UKHO about licensing the tidal-stream data for the Dart and Start Bay** | No wrong timing taught now; the full fix depends on the licence terms and cost |
| **D6** | River bathymetry | **Ask DHNA and check the UKHO survey data under OGL** | Real groundings and better stream patterns; may cost money or take time |
| **D7** | Default damage setting | **"Realistic" for racing, "Off" in lessons** | Collisions matter in races without punishing learners |
| **D8** | Live-data backend | **One scheduled serverless function (free tier), keys server-side; GitHub Actions as the fallback** | A 15-minute refresh; a second service to look after; £0 unless the DataHub paid tier is needed |
| **D9** | Validation partners | **Name an experienced Squib sailor and an RDYC sailor; supply the RDYC SIs, the 2026 programme and the class rules 2025** | Unblocks P4, P5 and P7 and the club courses |
| **D10** | AI information | **Parity at "club" level (local current plus tide tables); look-ahead only at "expert", labelled** | Fairer races; the AI may get slightly worse on the river |
| **D11** | Rules scope next | **Rule 18 (mark-room), then 19–20; always labelled "simplified, not authoritative"** | Fewer pile-ups at marks; a large test matrix |
| **D12** | Minimum supported device | **A 2020 mid-range phone and an integrated-GPU laptop** | Sets the performance budgets in §9.3 |

**Review gate.** I have stopped here. Tell me which package to implement (P1 recommended, with P2 in parallel if you want), and your answers to whichever decisions you are ready to make. Nothing in production code will change until then.

---

## 12. Decisions (3 Nov 2026)

The owner's answers to §11. "Recommended" means the recommendation in §11 was accepted as written.

| # | Decision | Taken |
|---|---|---|
| D1 | Intended players | Recommended: club sailors and learners on the Dart, with an expert setting |
| D2 | Player controls versus simulated crew | Recommended: the player helms, trims the main and calls tacks, gybes and spinnaker hoists and drops; the crew trims the jib and spinnaker and hikes; experts may take the jib and crew position |
| D3 | Spinnaker | Recommended: symmetric, crew-handled on the player's call (Package 5) |
| D4 | Steering convention | Recommended: asked on the first visit; "bow" for non-sailors, "tiller" for sailors; the tiller always shown (Package 2) |
| D5 | Tidal stream | Recommended: illustrative, labelled, off in races (done in Package 1); then ask UKHO about licensed stream data (Package 4) |
| D6 | River bathymetry | Acknowledged. The owner also pointed to the **Dart Harbour Guide 2026** (`content.yudu.com/web/1vkfm/0A1vl9e/DartHarbourGuide2026/…`) |
| D7 | Damage default | Recommended: "Realistic" in races, "Off" in lessons (Package 6) |
| D8 | Live-data backend | Recommended: one scheduled serverless function on a free tier, keys server-side; GitHub Actions as the fallback (Package 3) |
| D9 | Validation documents | The owner supplied links to the **RDYC sailing instructions** (a PDF on `96479e17-8f8d-45ff-8102-d5349efe7f23.filesusr.com`) and the **Squib class rules 2024** (`squibs.co.uk/squib-class-rules-2024/`). The validation sailors are still to be named |
| D10 | AI information | Recommended: parity at "club"; look-ahead only at "expert", labelled (Package 7) |
| D11 | Rules scope | Recommended: rule 18 (mark-room), then 19–20; always "simplified, not authoritative" (Package 7) |
| D12 | Minimum device | Recommended: a 2020 mid-range phone and an integrated-GPU laptop |

**The three documents arrived later the same day.**

- **How they came:** their hosts were blocked by this environment's network policy, so the owner uploaded them: the RDYC Sailing Programme 2026 (with the SIs and Course Appendix), the National Squib Class Rules 2025 and the Dart Harbour guide 2019.
- **What they gave** (read in full; [CLUB_DOCUMENTS.md](CLUB_DOCUMENTS.md)):
  - the club's marks, now on the map;
  - eight RDYC courses, entered pending a club check, with a quick-race venue that picks the course for the wind;
  - the class spec, now citing the class rules.
- **What remains open:** the facts that need positions the documents do not give (the Blackstone Point line, the Club Line, the temporary marks). They are listed in CLUB_DOCUMENTS.md §1.

## 13. Package 1: what changed

Implemented 3 Nov 2026, in the order of §11. Each item lists what changed, how it was checked, and what remains.

| # | Change | Files | Checked by |
|---|---|---|---|
| 1.1 | **Behaviour envelope.** `npm run envelope` runs A-PH-1…6, 8, 11–13 and A-CO-1…5, 7 headless in about 10 s, and writes `out/envelope.json` and `out/envelope.md`, labelled "model output, not validation". CI runs it and keeps the report as the `behaviour-envelope` artifact | `src/sim/validation/envelope.ts`, `tools/envelope.ts`, `.github/workflows/ci.yml` | `tests/sim/envelope.test.ts` (determinism) |
| 1.2 | **One polar generator** (PH-2, PH-7). `crewPolicyPoint` gives the steady state with the crew policy of the player's assists and the AI: auto-trim with easing and flattening. It averages over 20 s and flags points that have not settled. The polar panel, the calibration, `npm run polar` and the AI's table all use it. The AI's table is unchanged (it already used this policy), so no AI behaviour changed. The panel draws unsettled points hollow (* in the table). The synthetic calibration fixture was regenerated with the new procedure | `src/sim/ai/polar.ts`, `src/app/polarWorker.ts`, `src/ui/PolarPanel.tsx`, `src/sim/calibration/calibrate.ts`, `tools/model-polar.ts` | `tests/sim/envelope.test.ts` (the dashboard point equals the AI table within 0.02 kn; 25 kn close-hauled flagged as not steady), `tests/sim/calibration.test.ts` |
| 1.3 | **The committee boat collides where she is drawn** (CO-3). She is SAMARITAN's hull outline (10.82 × 3.57 m), centred on the line-end mark, lying head to the stream or the base wind. The renderer takes her heading from the same function | `src/sim/race/anchored.ts`, `src/sim/race/fleet.ts`, `src/sim/race/session.ts`, `src/render/course.ts`, `src/render/samaritan.ts` | A-CO-5: contact at 0.2 m overlap, none at 0.2 m clear (`tests/sim/envelope.test.ts`) |
| 1.4 | **Moored boats: one pose** (CO-4). The physics now includes each boat's slack-water swing from the layout, and the renderer draws the physics' pose. Both lie to the base wind (no gust spin) and blend between wind and stream | `src/sim/race/anchored.ts`, `src/render/dart.ts`, `src/app/controller.ts`, `src/sim/race/setup.ts` | `tests/sim/anchored.test.ts`: contact at 0.2 m overlap with the posed box, none at 0.2 m clear |
| 1.5 | **Running slow** (PH-5). "Running slow: N% of real time" below the toolbar when the simulation keeps under 90% of the clock. The graphics step down one preset after two slow windows (not saved), never against the user's own choice. A setting turns it off | `src/app/controller.ts`, `src/ui/App.tsx`, `src/ui/SettingsPanel.tsx`, `src/ui/styles.css` | Browser probe in software rendering (the pill shows; screenshot); PERFORMANCE.md §1b |
| 1.6 | **GPU memory and lost contexts** (GR-2, GR-3). Removed courses, fleet boats and replaced boat models give back their geometries and textures. A lost WebGL context pauses the run, says so and resumes on restore | `src/render/dispose.ts`, `src/render/scene.ts`, `src/render/fleet.ts`, `src/app/controller.ts`, `src/ui/App.tsx` | `tests/e2e/review.spec.ts`. Measured: the geometry count levels off (726–846 over 7 restarts) instead of growing by about 55 a restart |
| 1.7 | **Contact regression tests**: no tunnelling (8 kn into a 0.3 m jetty, 14 kn into a 0.3 m pile), no energy gain in any collision, a pinned boat still (under 5 mm) | `tests/sim/envelope.test.ts` | Unit tests |
| 1.8 | **Illustrative stream** (EN-1, D5). The river's stream is labelled "illustrative, not real timing" everywhere and is off by default in quick races on the river (a tick box turns it on). The Scenario panel explains why | `src/app/quickRace.ts`, `src/ui/QuickRacePanel.tsx`, `src/ui/ScenarioPanel.tsx`, `src/sim/env/current.ts` | `tests/sim/river-race.test.ts` |

**The determinism reference hash is unchanged** (`11824f89f479d0f4`): the reference run has no moorings, committee boat or stream changes.

**AI trials** (RACING.md §6). A same-day baseline was run on the commit before Package 1.

| Trial | Baseline (before) | Package 1 |
|---|---|---|
| Start Bay, 100 seeds | 91 clean | 92 clean; no committee-boat contact |
| River, 20 runs | 15 clean | 15 clean |

**Start Bay is below the 95% criterion in both.** The drop from 97% (23 Oct) predates this package (issue 121).

On the river the real-size committee boat first cost three clean runs: boats crawling against the stream were set onto her bow. Two small AI changes recovered them:

- an AI boat keeps full power on the way to its waiting spot when a stream runs;
- its reflex keeps 0.75 m more room round the committee boat.

**A new finding from the envelope (PH-10, issue 118).** The model's best upwind VMG is at a true wind angle of 30–35° in 6–18 kn. A keelboat usually beats at about 38–45° true (L3). The model may point too high; the Squib sailor's tacking angle (validation sheet B1.5) will tell. This is not tuned in Package 1: it belongs to the calibration in Package 5.

**A physics fault found and fixed while testing (stability beyond 120°).**
- **Found:** re-running the AI trials, a river race hung. An AI boat manoeuvring near the start line, already heeled past 65°, rolled past 120° (what first knocked it down was not isolated). The righting-arm table was extrapolated beyond its end, so the capsizing arm grew without limit. The roll ran away to infinity, and a later loop never ended.
- **Fixed:** GZ now goes to zero at 180° and is taken round the circle. Past 75° of heel the rig is in the water: it stops driving and damps the roll (PHYSICS.md §8).
- **Effect on normal sailing:** none below 75°; the reference hash is unchanged.
- **Regression tests:** `tests/sim/stability.test.ts`. They fail on the old code.

**Irons (issue 119).** The envelope confirms PH-4: with the helm hard over and the sails on auto-trim, the boat is still within 11° of head to wind after 60 s, going astern.


## 14. Package 2, round A: what changed

Implemented 3 Nov 2026. Package 2 is split into two rounds. Round A covers accessibility, layout, the start and the steering choice; round B (next) covers the lessons (§8.1), the teaching overlays (UX-9), the two overlapping race set-ups (U4), the interface level (U5), the start-line camera (§8.6) and the remaining colour-only distinctions (U8). **The physics is unchanged: the determinism hash is still `11824f89f479d0f4`.**

| Finding | Change | Files | Checked by |
|---|---|---|---|
| UX-2 | **Dialogs keep the keyboard in.** Every modal (welcome, help, settings, layers, course editor, the two confirmations) makes the rest of the app `inert`, moves focus in (an autofocus button, else the heading), wraps Tab, closes on Escape and gives focus back to what opened it | `src/ui/useModal.ts` (new), `src/ui/Confirm.tsx` (new), the dialog components | `tests/e2e/a11y.spec.ts`: 12 Tab and Shift+Tab presses stay in Help; Escape returns focus to the Help button; the sailing keys work afterwards |
| UX-3 | **Targets and text.** Every control is at least 24 × 24 CSS px (44 px where the pointer is a finger); text at least 12 px (the type tokens and every smaller size raised) | `src/ui/styles.css` | `tests/e2e/a11y.spec.ts`: every visible control and text in the HUD, dock, race panel and coach, racing, at 1280 × 800 and 390 × 844 |
| UX-5 | **Reserved regions.** The left column (instruments, race panel, coach) stops above the dock and scrolls; the toolbar keeps clear of the column's measured width | `src/ui/App.tsx`, `src/ui/styles.css` | `tests/e2e/layout.spec.ts`: no overlap and nothing off screen at 360 × 640, 390 × 844, 1000 × 560, 1280 × 800 and 1920 × 1080, sailing and racing. Before: three overlaps, all racing (phones and 1000 × 560) |
| UX-6 | **Over the line at the start.** The race panel says what to do (back to the pre-start side round either end, then start), names the nearer end with its distance and direction from the bow, with an arrow, and once flag X is down (rule 29.1) says you can still come back and start, or retire | `src/app/ocsGuide.ts` (new), `src/app/controller.ts`, `src/ui/RacePanel.tsx` | `tests/sim/ocsGuide.test.ts`; `tests/e2e/review.spec.ts` (a boat put 30 m over the line before the gun) |
| UX-7 | "gusty gusts" in the footer is now "gusty", and the steady preset reads "steady wind"; a sail's status and advice wrap instead of being cut off; the coach card scrolls within the left column instead of being cut off | `src/ui/App.tsx`, `src/ui/styles.css` | Layout test; screenshot |
| UX-8, D4 | **Steering choice.** The first visit asks "Have you sailed before?": sailors get tiller steering (A / ← push the tiller to port, so the bow turns to starboard), others keep bow steering. Graphics and sound changes it. A drawing of the tiller from above, at the simulation's rudder angle, replaces the helm bar in both modes. The tutorial's steering step explains the mode in use. Recordings keep the helm, not the keys, so replays are the same either way | `src/app/steering.ts` (new), `src/app/controller.ts`, `src/ui/Controls.tsx`, `src/ui/Welcome.tsx`, `src/ui/SettingsPanel.tsx`, `src/app/tutorial.ts`, `src/ui/TutorialPanel.tsx` | `tests/sim/steering.test.ts`; `tests/e2e/a11y.spec.ts` (first visit: choose tiller, A gives a positive rudder, the tiller drawing says "to port · bow turning to starboard", kept after a reload) |
| GR-4 | **Reduced motion.** With the reader's "reduce motion" setting the camera keeps a level horizon in every view, does not ride the waves, cuts instead of blending between views, and the scenic view holds still. It follows the setting if it changes | `src/render/scene.ts` | `tests/e2e/a11y.spec.ts`: helm view, 16 kn on a beam reach, heeled: 12 frames with the camera's right vector level (under 0.001) and under 1 cm of height change a frame. Without the setting the same test fails (0.021), so it measures something |
| U8 (part) | **Minimap marks by shape**, as on a chart: a can square, a cone pointed, a cardinal a diamond, a buoy of unstated shape round, each outlined; not colour alone | `src/ui/Minimap.tsx` | Code; screenshot |
| GR-6 | **Sounds for events.** The race committee's sound signals (one sound, one long sound, two sounds, as RRS 26 and 29), a knock for a contact and a scrape for a grounding, all made in the browser. Every sound signal is captioned in the race panel ("One long sound: one-minute signal") in a live region. Contacts and groundings already have their banner | `src/render/audio.ts`, `src/app/signalCaption.ts` (new), `src/app/controller.ts`, `src/ui/RacePanel.tsx` | `tests/sim/signalCaption.test.ts` (a five-minute sequence gives four captions, in order); `tests/e2e/review.spec.ts` (captions at the one-minute signal and the start, gone 8 s later). The sounds themselves were not heard here: the test browser has no audio output |

**The club's sailing instructions on signals** (R13, docs/CLUB_DOCUMENTS.md): races start under RRS 26 with the warning signal 5 minutes before the start (SI 9.1). Starting signals may also be made on VHF (SI 3.4). When no committee boat is out, a competitor broadcasts the times on VHF and no visual or sound signals are made (SI 9.3). The simulator always has a committee boat, so it makes the RRS 26 flags and sounds. The VHF broadcasts are not simulated: the SIs do not give their wording.

**Not inspected on a real GPU or with real speakers.** All screenshots come from software rendering, and the sounds were checked only by code and by their captions (GR-1).

## 15. The owner's required improvements (4 Nov 2026)

Added before Package 2 round B, at the owner's request. Each item lists its status, what changed, how it was checked and what remains. **The physics is unchanged** (determinism hash `11824f89f479d0f4`).

### 15.1 Audit: have the earlier changes reached the owner?

- **Deployed.** All rounds up to Package 2 round A are merged and deployed: `main` holds `749dc1c`, and the Deploy run of 07:20 UTC on 4 Nov succeeded. Help and Settings now show the build's commit and time, so the owner can tell which version is running.
- **Why the owner and this review saw different pictures.** Every check here runs in software rendering. On a software renderer the app picks the Performance preset (low scenery, single shadow map). On a graphics card it picks Balanced (high scenery, cascaded shadows, sky reflections). "Running slow" then lowers software rendering further.
  - The real-card path was therefore forced here (`?quality=high` with Balanced stored).
  - Every earlier change was photographed on it: SAMARITAN, the robotic marks on both courses, the marina boats at Darthaven and Dart Marina, and the RDYC. All draw as intended.
- **The black surfaces are real, and specific to the owner's card.** The owner's 1 Nov screenshot (built after the robotic marks of 28 Oct) shows:
  - the marks' orange bodies and flags black, beside a correct textured white sponsor band;
  - the marina boats' hulls black, beside correct masts and coloured covers in the **same draw call**.
- **What was ruled out.** The geometry has no NaN or zero-length normals and correct colours (inspected), and shadows are honoured under the cascades. So particular surfaces shade black on that card, for a cause that cannot be reproduced here.
- **What changed.** The app now **measures** painted surfaces on the card it runs on (`src/render/gpuCheck.ts`).
  - Test spheres painted as the hulls and marks are drawn in the real scene and read back, against unlit references.
  - If the painted ones come out black, the app tries drawing without sky reflections, then with simpler materials, and keeps the first that works for that card.
  - Settings → Graphics check shows the result and copies a report.
  - It runs by itself only on a graphics card, about 8 s after loading in daylight. Its test draws hide the rest of the scene and reuse the shadow maps, so it costs a few small draws. The first version redrew the whole scene and its shadows eight times, which stalled software rendering in CI.
  - The Settings panel shows the card's name. The first version asked the graphics driver for it with every interface update (ten a second); each query waits for all the drawing queued before it. In software rendering that kept the page busy for 10–25 s of every 20 s (measured with the browser's profiler), and on a real card it stalled the drawing ten times a second. The name is now read once (`rendererName` in `src/render/sunlight.ts`; `tests/render/gpuCheck.test.ts`). With that, the page's script time is the same as before this round: about 0.2 s in 20 s.
  - "Running slow · graphics lowered" (owner, 4 Nov, on the build deployed that morning, before this round went live). No code change in that build accounts for it: on the real-card path it draws about 4% more objects than the 3 Nov build in the same view, with the same triangles and shaders. The day's live weather was much stronger (13–23 kn, gusts to 30 kn). This round's check could have caused the same message, so two changes guard against it:
    - The check now tries each drawing mode on its test spheres alone. The scene changes mode at most once, to the mode that works; before, each mode tried recompiled every shader in the scene, a pause of seconds on some cards.
    - The pace measurement leaves out the app's own pauses: the graphics check, a change of drawing mode or graphics, and the river scene's arrival (`settlePace` in `src/app/controller.ts`). Before, such a pause counted as a slow device and lowered the graphics.
    - Checked by `tests/e2e/review.spec.ts`: the scene switches once, and a 2.5 s pause of the app's own does not show "running slow" while the same pause from elsewhere does.

| Earlier change | Where | Seen here, real-card path |
|---|---|---|
| SAMARITAN, Southerly 110 with navy canopy (3 Nov) | Committee boat, both courses | Yes |
| Robotic marks with sponsors (28 Oct) | Start Bay and river courses | Yes: orange with sponsor bands |
| Marina boats white with coloured covers (1 Nov) | Darthaven, Dart Marina, Noss | Yes: white |
| RDYC rebuilt to the photographs (28 Oct) | Kingswear | Yes; improved again below |
| Lower Ferry tug and float to the photographs (photo round) | Both slips | Yes |

### 15.2 Changes

| Item | Change | Files | Checked by |
|---|---|---|---|
| Black hulls and marks | Graphics check with automatic fallbacks; a build stamp | `src/render/gpuCheck.ts` (new), `src/render/scene.ts`, `src/render/sunlight.ts`, `src/app/controller.ts`, `src/ui/SettingsPanel.tsx`, `src/ui/Help.tsx`, `vite.config.ts` | `tests/render/gpuCheck.test.ts`; `tests/e2e/review.spec.ts` (a simulated fault is fixed by another mode; Settings shows the result and the build) |
| Top bar | One row sized to its content. As space shrinks: the activity shows as its icon, Reset loses its label and the camera menu narrows; then tighter spacing; then a Menu button. Race, Library and Scenario always stay on the bar | `src/ui/App.tsx`, `src/ui/styles.css` | Screenshots at 1920, 1440, 1280, 1100 and 1000 px wide; `tests/e2e/layout.spec.ts` (no overlaps at five sizes) |
| UI review against best-in-class practice | [UI_BENCHMARK.md](review/UI_BENCHMARK.md): guidance on onboarding and retention, where the simulator stands, recommendations for round B; what needs a service (leaderboards, analytics) | docs | Desk review with sources |
| RDYC recognisable | From the owner's photographs: dinghies standing on their transoms in a rack (they were lying as striped rolls); warm buff rubble for the sea wall (was grey); wider white bargeboards, a taller finial and a king post on the river gable; the neighbour north of the club in light render under slate (red brick and clay tile made a block that dominated the club); four Scots pines on the hill behind | `src/render/rdyc.ts`, `src/render/landmarks.ts`, `src/render/dart.ts` | `tests/render/rdyc.test.ts`; screenshots from the photographs' viewpoints |
| Bayard's Cove and its fort | The fort as itself: an open round rubble tower on the waterline at its published position, with eleven round-headed gunports facing the river and a doorway from the quay. Its footprint makes it solid to boats. The quays and sea walls in warmer stone, as photographed | `src/render/bayards.ts` (new), `src/app/geoLoader.ts`, `src/render/landmarks.ts`, `src/render/rdyc.ts` | `tests/render/landmarks.test.ts` (position within 5 m of the published coordinates; eleven ports facing the river); screenshots |
| Higher Ferry | Up to 36 cars in four lanes (was 18 in three), on a larger estimated hull. She no longer turns round at each slip: a double-ended cable ferry keeps her cabin on the same side. Her two cables now run from each slipway down to the bed and up through her sheaves, following her as she crosses (they lay under the surface across the river, unattached) | `src/render/traffic.ts`, `src/sim/env/traffic.ts`, `src/render/dart.ts` | `tests/sim/traffic.test.ts`; screenshots |
| Lower Ferry | Re-checked against the sources and the owner's photographs: floats of up to 8 cars pushed and pulled by tugs (F1, F8); the tug alongside, swinging end for end at the slips (F3). No change found necessary this round | — | Screenshot at the Dartmouth slip |
| Noss, Sandquay | **Not done.** The building data has only the old shipyard sheds at Noss, not the 2023 buildings, and no photographs of Sandquay were available. Positions must not be invented. Sourced facts recorded (NO1, SQ1) | — | Issues 123 and 124: photographs needed |

### 15.3 What the owner can do to close the black-surface fault

1. Open the simulator, wait 10 s in daylight, then open More → Graphics and sound.
2. Under "Graphics check", read the result. It names the drawing mode the app chose, if it found a fault.
3. Press "Copy the report" and paste it into the conversation. It holds the card's name, the browser, the build and the measured colours, so the cause can be fixed directly.

## 16. Package 2, round B: what changed

Implemented 4 Nov 2026. This round covers the lessons (§8.1, U9), the teaching overlay (UX-9), one race set-up (U4), the interface level (U5), the start-line camera (§8.6) and the last colour-only distinction (U8). From the UI review ([UI_BENCHMARK.md](review/UI_BENCHMARK.md)) it adds "Sail now" first, a five-minute short course, personal bests and a daily challenge, all kept in the browser. **The physics is unchanged: the determinism hash is still `11824f89f479d0f4`.**

| Finding | Change | Files | Checked by |
|---|---|---|---|
| U9, §8.1 | **Six short lessons replace the one long tutorial:** 1 steering (heading against course over ground, a buoy to sail to); 2 the wind (true and apparent, the no-go zone); 3 trim (telltales, luffing and stalling, auto-trim); 4 tacking and gybing (each tack timed); 5 the start (the countdown, holding back, the line, clearing if over early); 6 the stream (STW against SOG both ways, then VMG). Each has its own steady open water, a goal per step checked as you sail, and a live readout where it helps ("Buoy 84 m away", "STW 4.1 kn · SOG 3.2 kn"). Each ends on a **result card**: what you did, your best time, and the next lesson. Progress is kept in the browser, and "Learn to sail" starts the next lesson not yet done | `src/app/lessons.ts` (new), `src/app/tutorial.ts`, `src/app/controller.ts`, `src/ui/TutorialPanel.tsx` | `tests/sim/lessons.test.ts`: a scripted helmsman finishes **every lesson** with the keys alone. Lesson 2 measures the apparent wind strongest close-hauled and lightest running. Lesson 4 times its tacks between 2 and 20 s, slower out than in. Lesson 5 holds back, beats up to the line, starts after the signal and records the start. `tests/e2e/ux.spec.ts`: the card, the overlay, a goal met, the result card, the list of lessons |
| UX-9 | **Teaching overlay** in the 3D view: a solid heading line, a dashed course-over-ground line, the stream arrow with its rate, true and apparent wind arrows, and a VMG line along the wind axis with its value. Every part is labelled in words. Lessons show the parts they teach; More → Teaching overlay shows all of them at any time | `src/render/teaching.ts` (new), `src/render/scene.ts` | `tests/render/teaching.test.ts`: each part points the right way (heading, COG, the stream setting 045°, the true wind blowing to 045°, VMG upwind when close-hauled) and every part has a label |
| U4 | **One race set-up.** Race now holds every race option: the short course and the five practice courses, the river, an RDYC club course for the wind, any library course (your own included), laps, leg length, the start sequence, the start time and the preparatory flag, with random, live or Scenario conditions. The Scenario panel no longer has its own course and fleet options: it says what the scenario races and links to Race | `src/app/quickRace.ts`, `src/ui/QuickRacePanel.tsx`, `src/ui/ScenarioPanel.tsx` | `tests/sim/raceSetup.test.ts`; `tests/e2e/smoke.spec.ts` (both course tests now set up through Race, one reached from the Scenario panel's link) |
| Benchmark G8 | **Short course:** one beat and one run on a 220 m windward–leeward, one lap. It is the default course | `src/app/quickRace.ts` | `tests/sim/raceSetup.test.ts`: three good AI Squibs finish in 3.5–6.5 minutes at both 10 and 14 kn (model output). On a 250 m course they took 5.3–6.5 min at 10 kn and 8–9 min at 6 kn, so in light air it is longer |
| Benchmark G4, G8 | **Today's challenge:** the same seeded race for everyone on the same UTC day (three good AI boats, the short course, a moderate random breeze, a one-minute sequence). **Personal bests:** the best time on each course and on each day's challenge, and the best start (the shortest delay after the signal, for a clean start). Both are shown in Race and in the race panel ("New personal best … (was 5:40)"). Kept in this browser: nobody else's times are seen, because a shared table needs a server (decision D8) | `src/app/quickRace.ts`, `src/app/bests.ts` (new), `src/app/controller.ts`, `src/ui/RacePanel.tsx` | `tests/sim/raceSetup.test.ts` (same race all day, a different one the next; bests); `tests/sim/lessons.test.ts` (the start lesson records the best start); `tests/e2e/roundB.spec.ts` (the challenge starts the short course against three AI boats) |
| U5 | **Interface level: Learn, Club, Expert.** Chosen on the first visit by "Have you sailed before?": *Not yet* gives Learn with bow steering; *Yes, I sail* gives Club with the tiller; *I race* gives Expert with the tiller. Settings changes it. Learn turns on the teaching overlay and the coach and leaves the dock's advanced controls (flatten, hiking by hand) out. Club is the simulator as it was. Expert shows every instrument with no coach or overlay. Each part can still be switched by hand. A first visit with no answer is Learn | `src/app/level.ts` (new), `src/app/controller.ts`, `src/ui/Welcome.tsx`, `src/ui/SettingsPanel.tsx`, `src/ui/Controls.tsx`, `src/ui/Instruments.tsx`, `src/ui/App.tsx` | `tests/sim/level.test.ts`; `tests/e2e/roundB.spec.ts` (Expert shows SOG with no coach; Learn hides Flatten and shows the overlay) |
| Benchmark G1, G2 | **"Sail now" first.** On the first visit the welcome's largest button, focused, is "Sail now": lesson 1 for a newcomer (the boat is already sailing when the card appears), free sailing for a sailor. The four ways in follow | `src/ui/Welcome.tsx`, `src/ui/App.tsx` | `tests/e2e/ux.spec.ts` |
| §8.6 | **Start-line view:** from just outside the committee boat end, 4 m up, looking along the line to the pin. It is in the camera menu and on C, whenever there is a course | `src/render/scene.ts`, `src/app/controller.ts`, `src/ui/App.tsx` | `tests/e2e/roundB.spec.ts` (the camera within 20 m of the committee boat end, the pin beyond the line's length) |
| U8 | **The compass's two winds** are told apart by letter (T, A) and line (solid, dashed) as well as colour, and its accessible name gives both angles. The tack chip already said its tack in words, and the minimap marks went by shape in round A | `src/ui/Compass.tsx` | `tests/e2e/roundB.spec.ts` |

**What the lessons do not teach yet, and why.** Getting out of irons: the model does not yet let a stopped boat drift backwards and fall off (PH-4). Here a boat held head to wind creeps forward at about 1.9 kn, and with the helm hard over it stays about 11° off the wind. So lesson 2 teaches bearing away before the boat stops. Laylines in a stream are not drawn (lesson 6 says so). The stream in lesson 6 is an illustrative steady 1.2 kn, not the Dart's (EN-1).

**Not inspected on a real GPU.** The overlay, the start-line view and the new panels were checked in software rendering and by their tests (GR-1).

## 17. The owner's photographs and requests of 5 Nov 2026

The owner sent photographs of the club, Noss, Sandquay and both ferries (SOURCES.md P5, P6) and a screenshot of the dock (P7), and asked for the scenery to follow them, the dock to be redesigned, and two faults at the RDYC to be fixed. **The physics is unchanged** (determinism hash `11824f89f479d0f4`).

| Request | What was wrong | Change | Files | Checked by |
|---|---|---|---|---|
| Strobing at the pontoon outside the RDYC | Measured by drawing the same view twice with the camera moved 1 mm and comparing the pixels: the flicker was in the dinghy rack. The 22 dinghies stood side by side with their flat bottoms in one plane, 0.42 m apart but 1.28 m wide, so their surfaces overlapped and the depth buffer could not tell them apart | Each dinghy turned 55° from the line of the rack, leaning one against the next like fanned cards (as the photographs show them), 0.34 m apart face to face, more than a hull's 0.32 m depth; grey, as photographed | `src/render/rdyc.ts` | `tests/render/rdyc.test.ts` (neighbours further apart than a hull is deep, all parallel). The same measurement: flickering pixels on the pontoon view fell from 13,518 to 479 (what remains is the sun's glitter and the water's edge) |
| Strobing along the RDYC shoreline | The town's 4 m ground grid left a shelf of foreshore just above the water in front of the sea wall, drawn nearly black; the waves covered and uncovered it as they passed | In front of the club's frontage wall (within 30 m, on the river side) the bed is drawn below the water (3 m below datum), fading out over 12 m past the wall's ends, so the wall stands in the water as in the photographs. Visual only: the physics' depth grid is unchanged | `src/render/rdyc.ts` (`rdycForeshore`), `src/render/dart.ts` | `tests/render/rdyc.test.ts` (5 m out: below the water; 5 m behind the wall, far out and far away: unchanged); screenshots |
| People walk through the wall at the RDYC | A footway in the data runs past the club's south side and on beyond the sea wall's face, over the water; walkers turn only at a path's end, so they walked through the wall. The path also passes 0.6 m from the clubhouse's corner | Walking routes stop at a keep-out: the clubhouse with a 0.7 m margin and the river side of the frontage wall. Walkers turn round there. Cars are unaffected | `src/render/population.ts` (`splitWalkable`), `src/render/rdyc.ts` (`rdycKeepOut`), `src/render/dart.ts` | `tests/render/rdyc.test.ts`: every walking route within 80 m of the club, split, keeps clear (the footway that crossed the wall is found and cut) |
| The Lower Ferry's float has no cabin | The model had a crew shelter on the port walkway | Removed. The float is an open deck with rails, lamps and lifebuoys; a post either side of each ramp carries its lifting gear, and an arm runs along each side of the ramp | `src/render/traffic.ts` | `tests/render/traffic.test.ts` (nothing where the shelter stood, above the rails); screenshot |
| The Higher Ferry, to the photographs | A lounge and control cabin along one side | A dark blue hull; low white casings along both sides with a house at each corner; the control cabin high on a white gantry amidships that bridges the car deck, reached by a stair on each side; symmetrical end to end and side to side; 36 cars under the bridge | `src/render/traffic.ts` | `tests/render/traffic.test.ts` (the highest structure centred, over 9 m up, nothing over the car deck between 4 and 7 m); screenshots from both sides |
| Noss | The building data has only the old shipyard sheds | The largest waterfront shed as the Philip & Son hall: red brick, grey roof, PHILIP & SON LTD · SHIPBUILDERS & ENGINEERS on its river gable with three round windows (lettering drawn on a plane with a depth offset, so it cannot flicker); the shed beside it in brick; three of the new commercial buildings larch-clad with dark roofs. The Noss ferry runs in the river traffic as herself: NORAGH PHILIP of NOSS, red hull with her name, white cabin, red roof, a NOSS FERRY board, blue canopy aft. The apartment block in the render is a later phase and is not drawn (NO1) | `src/render/landmarks.ts`, `src/render/noss.ts` (new), `src/render/traffic.ts` | `tests/render/landmarks.test.ts`; screenshots. Which footprints are the hall and the new buildings is an estimate (E) |
| Sandquay | No photographs before | Three grey Royal Navy training boats (grey hull and saloon, white life-raft canisters, orange lifebuoys, radar, the White Ensign) along the river side of the college's pontoon; the boathouses behind the pier white with pale green roofs; the dark green timber sheds behind the Hindostan's berth. The Hindostan and the training boats now fly the White Ensign | `src/render/traffic.ts`, `src/render/dart.ts`, `src/render/landmarks.ts` | Screenshot. Where along the pontoon the boats lie, and which footprints the boathouses are, are estimates (E) |
| The dock "cannot be read and labels do not fit" | Layered styles from several rounds (U10): the sheet bar between Ease and Trim was squeezed to almost nothing (")%"), labels were muted and small | Redesigned. Each sail is a block: its name; Ease, a meter of the sheet ("35% eased", at least 112 px wide) and Trim on one line; the Auto-trim switch and the sail's state in words. On a wide dock a sail is one line. Full-contrast text, 13–15 px; the helm and crew controls grouped beside it. On a phone the dock is 366 px tall (was 481) and the paused notice moves clear of it | `src/ui/Controls.tsx`, `src/ui/styles.css` | `tests/e2e/dock.spec.ts`: at 1280 × 800, 1024 × 700 and 390 × 844 nothing in the dock is clipped and both meters show "100% eased"; `tests/e2e/a11y.spec.ts` (24 px targets, 12 px text) and `tests/e2e/layout.spec.ts` (no overlaps) still pass |

**Not inspected on a real GPU.** The views were checked in software rendering (GR-1). The flicker measurement is the same on any GPU in kind, but a real card's depth buffer and anti-aliasing differ in detail.

### The buildings around the RDYC, from the owner's photographs of the old Royal Dart (5 Nov 2026, second set)

The owner sent four photographs of the old Royal Dart building from the river (SOURCES.md P8) and asked for the buildings around the club to follow them. The view from the river was compared with the photographs from the same four places. **The physics is unchanged** (determinism hash `11824f89f479d0f4`).

| What the photographs show | What was drawn | Change | Files | Checked by |
|---|---|---|---|---|
| The Royal Dart: cream render, four storeys from the water, a low hipped roof on deep bracketed eaves, three sashes across the top floor; on the river front a wide splayed bay with a first-floor balcony and a second-floor cast-iron balcony under a grey tented canopy on thin columns; ROYAL DART BARS on a navy fascia; a navy base on a granite plinth | A flat-topped white box filling the whole footprint, four rows of small windows, a striped awning on one side | Modelled as itself in its own frame on the data's footprint (as the yacht club is): the main block with its bracketed eaves, zinc roof and stacks; the bay (solid ground floor, the sign, two balconies set back 1 m, French windows, white balustrades, eight thin columns, a bellcast canopy with a white valance); the lower rear range up the slope. The data's top (16.1 m ODN) is kept | `src/render/royalDart.ts` (new), `src/render/rdyc.ts` (its builder takes a frame; the club's geometry is unchanged, checked by a fingerprint of every vertex) | `tests/render/royalDart.test.ts`: on its footprints, roof at the data's top, the bay's corners on the data's outline, the sign at the fascia facing the river, the balconies inside the bay, windows lit at night; screenshots from the photographs' four places |
| The north wing: white, a first floor of large windows over an open loggia on white columns where the passenger gangway lands, a slate roof, a small square lantern | A plain pale-blue block | Modelled with the Royal Dart: the loggia on its river faces (columns, the wall set back 1.8 m, doors), large windows above, a slate roof to a flat top, the lantern | `src/render/royalDart.ts` | `tests/render/royalDart.test.ts` (the loggia's floor where the gangway lands) |
| The passenger pier: a white lattice-truss gangway from the wing to a pontoon along the river, with piles | A grey timber jetty on piles at quay level (OpenStreetMap maps the pier as an outline and a centreline) | Drawn as a white lattice truss (chords, posts, crossed diagonals) hinged at the loggia's floor, its other end on a floating pontoon (the outline's landing stage, 22 by 4.2 m, with guide piles) that rises and falls with the tide; nobody stands on the gangway. Visual only: boats still meet the data's outline | `src/render/royalDart.ts` (`passengerPierAsDrawn`), `src/render/pontoons.ts` (the truss style), `src/render/dart.ts` | `tests/render/royalDart.test.ts`: the pontoon and landing inside the outline, the gangway's ends at the pontoon's deck and the loggia's floor at three tide levels, every other pier unchanged, nobody on the gangway |
| Across the slipway at the top of the Square: a stone building with red-brick arches over white sashes (pink in the older photograph) and a cream one with round-headed windows | Random painted render | The two footprints facing the river at the top of the Square coloured as photographed (stone; cream), slate roofs | `src/render/landmarks.ts` | `tests/render/landmarks.test.ts` (each landmark on one footprint). Which footprints they are is judged from where they stand in the photographs (E) |

Storey heights, the bay's balconies and canopy, the wing's details and the gangway's depth are read from the photographs, not measured (E). The older photograph (the hotel's days, with THE ROYAL DART on the bay) shows the same building; the current sign is drawn. Checked in software rendering only (GR-1).

## 18. The owner's review of the interface, the sea and the sky (5 Nov 2026)

The owner asked: Start Bay back in the race menu (keeping today's challenge); a dock that does not take over the screen; numbers in the map block that spill onto the map (a screenshot was mentioned but did not arrive); a pattern over the Squib; breaking waves in Start Bay when the weather calls for them; the new-sail-package Squib not turning in the helm, top-down and drone views; and the sky and light following the real weather. **The physics is unchanged** (determinism hash `11824f89f479d0f4`).

| Request | What was wrong | Change | Files | Checked by |
|---|---|---|---|---|
| Not turning in the helm, top-down and drone views | The camera is chosen from a list, and the list kept the keyboard after the choice: A and D were then ignored (and D chose the drone view). The boat itself turns the same in every type (10 s of full helm: 107° for the Rondar, 107.5° for the new sail package) | The list hands the keyboard back after a choice, and the sailing letter keys reach the boat whenever a list, slider, checkbox or button has the focus (text fields keep every key; controls keep their arrows, Space and Enter) | `src/app/controller.ts`, `src/ui/App.tsx` | `tests/sim/keys.test.ts`; `tests/e2e/immersive.spec.ts` (with the list focused, D steers in each view and the view stays) |
| A pattern over the Squib, across the top and in the hull | The antifouling, boot top and sheer stripe were painted per vertex, so their edges followed the hull mesh's rows and drew a saw-tooth along the waterline and the sheer | Painted in the shader from each point's height and its station's sheer, with edges a pixel wide | `src/render/squibModel.ts` | Screenshots before and after (software rendering); `tests/render/*` |
| Start Bay missing from the race menu | Round B folded "Where" into one list of courses headed "Short course…", so Start Bay was out of sight | Today's challenge first, then **Where**: Start Bay (chosen by default), the river, an RDYC course, the library; the course list follows the place. The welcome's race card names Start Bay | `src/ui/QuickRacePanel.tsx`, `src/ui/Welcome.tsx` | `tests/e2e/immersive.spec.ts` |
| The dock takes too much of the screen | About 150 px tall and most of the width | As wide as its controls and two rows on a laptop (each sail on one line, the helm and crew beside them), translucent, about 76 px tall at 1280 × 800; where the two halves do not fit side by side the helm and crew wrap under the sails, never overlapping. The tiller's state is short on screen ("12° port"), its full sentence read out. The flatten percentage is in the slider's hover text and read out | `src/ui/Controls.tsx`, `src/ui/styles.css` | `tests/e2e/dock.spec.ts`, `immersive.spec.ts` (under 100 px, clear of the minimap), `layout.spec.ts` (no overlaps at five sizes), `a11y.spec.ts` (24 px targets, 12 px text) |
| Numbers in the map block spill onto the map | The scale bar's figure ("625 m", "1.7 km") was drawn past the end of its backing box onto the map | The scale under the map, with north and "Not for navigation" beside it; the map drawn at the screen's resolution | `src/ui/Minimap.tsx`, `src/ui/styles.css` | `tests/e2e/immersive.spec.ts` (the scale below the map). Without the screenshot this is the likeliest cause, not a certain one |
| All blocks for an immersive sim | The left column's cards were long | The coach shows the briefing's first point (the rest a click away); course warnings on hover; the rules note in one line; the cards and the minimap translucent | `src/ui/Coach.tsx`, `src/ui/RacePanel.tsx`, `src/ui/styles.css` | `tests/e2e/redteam.spec.ts` (the briefing) |
| The sky and light to follow the real weather | The live forecast published no cloud: the scheduled job took the newest model run as soon as its wind was out, before its cloud fields were uploaded, so the app fell back to 30% cloud. Today at noon the forecast was overcast with light rain | The job reads each sky field from the newest run that has it (up to six hourly runs back) and records which came from an earlier run. Where an hour still has no cloud, the app infers a closed sky from rain or fog (E) and says so. Random races and today's challenge keep their seeded wind and tide phase, but with a live forecast covering now and the sun up they start now under the forecast's sky (visual only); at night they keep their afternoon | `tools/ingest/weather.py`, `src/sim/env/sky.ts`, `src/sim/env/conditions.ts`, `src/app/quickRace.ts` | `tools/ingest/test_ingest.py`, `tests/sim/live.test.ts`, `tests/sim/raceSetup.test.ts`; the job's sky step run here against the Met Office bucket read cloud 1.0 and rain 1.0 mm/h for 12:00Z |
| Breaking waves in Start Bay | The modelled whitecap cover (Monahan and O'Muircheartaigh: about 0.4% at 15 kn, 1% at 20 kn) was drawn nearly literally, so white horses barely showed; waves limited by the depth on shoals and beaches were capped in height but not shown breaking | Whitecaps mapped for the eye after Beaufort's descriptions (none in a light air, scattered at about 10 kn, frequent from 15 kn, many at 20 kn and more), drawn as white horses: torn patches of white water a few metres across, weighted to the crests, drifting with the waves and each breaking for a few seconds; surf where the depth limits the waves, in proportion to how far they exceed it (E). Found on the way: after a restart in new conditions the water kept drawing the old sea until its next refresh (a few seconds while sailing, for ever while paused); it is now filled afresh at once. Visual only | `src/render/water.ts`, `src/render/scene.ts`, `src/app/controller.ts`, `src/sim/env/seaState.ts` | `tests/sim/seastate.test.ts` (a shoal under a fresh onshore breeze breaks; a light air does not); renders of Start Bay at 8, 12 and 20 kn onshore (software rendering): none at 8 kn, white horses near the boat at 20 kn, fewer towards the horizon |

### The helm console (the owner's follow-up, 5 Nov 2026)

The owner's screenshot of the two-row dock: "not looking good … too much white space … lacks the immersive experience … the height takes too much of the screen and expands as the rudder moves". On that screen the helm and crew had wrapped under the sails (four rows, the right half empty), and the tiller's words and the sails' advice changed length as they changed, so the dock grew and shrank.

| What changed | Files | Checked by |
|---|---|---|
| Reinvented as a helm console: four instrument modules side by side, MAIN, JIB, HELM and BOAT, each exactly two rows (about 84 px in all on a laptop), translucent glass with uppercase instrument labels. Nothing in it wraps and every readout has a fixed width, so it keeps its size whatever the rudder, the sheets and the sails do | `src/ui/Controls.tsx`, `src/ui/styles.css` | `tests/e2e/immersive.spec.ts` (the same size before, while luffing and with the helm over), `dock.spec.ts`, `layout.spec.ts`, `a11y.spec.ts` |
| A sail: its name, its state as a coloured pill (Drawing, Luffing, Stalled, By the lee) and Auto-trim; under them Ease, the sheet's meter ("23% eased") and Trim. The button that fixes the sail's trouble glows (Trim when it luffs, Ease when it stalls): a novice sees what to press, an expert reads the state at a glance. The advice in words is the pill's tooltip and is read out with it | `src/ui/Controls.tsx` | `immersive.spec.ts` (Trim glows while the main luffs), `ux.spec.ts` (the state and its advice) |
| The helm: steer either way either side of the rudder and tiller from above; under them where the bow is turning, in a fixed-width readout ("Straight", "12° → stbd"), and Centre. The whole sentence ("Tiller 12° to port · bow turning to starboard") is read out and shown on hover | `src/ui/Controls.tsx` | `a11y.spec.ts` (tiller steering) |
| The boat: Release (X), Flat in the Z key's 25% steps (click for more, Shift-click or right-click for less), Auto crew, and Hike in the same steps when the crew is by hand | `src/ui/Controls.tsx` | `redteam.spec.ts` (Z flattens 25%) |
| Narrower windows (under 1250 px with the minimap, 1050 px without it): the sails above, the helm and the boat below; a phone: the sails across the width, one above the other, the helm and the boat side by side | `src/ui/styles.css` | `dock.spec.ts` at 1024 × 700 and 390 × 844 |
| **CI follow-up.** The pull-request run failed the layout check in a race on a 360 × 640 phone: the instruments column ran over the console and off the screen. Its height was set from a measurement taken after a resize, and in software rendering the first frames of a race can take longer than the check waits, so the height measured on the larger screen before stayed. The column is now also capped in CSS, above the console, whose height is fixed at each width (86, 164 or 232 px); the measurement can only lower that cap | `src/ui/App.tsx`, `src/ui/styles.css` | `layout.spec.ts` (five sizes, sailing and racing) |
| **CI follow-up.** Measuring every module at its widest (Expert, crew by hand, every figure 100%) found the boat module 18 px too narrow on a laptop and 50–65 px on a phone, and the four modules in a row running under the minimap from 1180 to 1219 px. The boat module is 230 px; four in a row from 1250 px (the console is 1020 px, the minimap and margins 228 px); on a phone the key letters are left off (no keyboard; the buttons' names still give the keys) and the hide button is a tab above the console's corner | `src/ui/styles.css` | `immersive.spec.ts` (nine widths from 360 to 1920 px: nothing runs out of its module, the console's height, clear of the minimap) |

### White spots on the river (the owner, 5 Nov 2026)

"What are the white spots on the river? It looks like a disco ball reflection and it is very distracting." Rendered on the river at 18 kn and switched off in turn, the spots were the white horses added for Start Bay: 5 m patches, as many as the wind speed alone says, drawn on the river's chop too, whose waves are only 1 to 5 m long (fetches of 0.3 to 2.5 km; Start Bay's are 15 to 70 m). Away from the boat each patch shrank to a few pixels that twinkled as the waves moved. At 25 kn the crest foam, strengthened with them, also turned the chop's crests into solid white blobs.

| What changed | Files | Checked by |
|---|---|---|
| White horses only where the waves are long enough to carry them (from 6 m, all from 12 m, E): Start Bay's sea and the surf, not the river's chop | `src/render/water.ts` | Renders on the river at 18 and 25 kn and in Start Bay at 18 and 25 kn, before and after (software rendering only) |
| Where a patch would be only a few pixels across, it fades out and a faint, slowly varying whitening of the same cover takes its place, so nothing twinkles in the distance | `src/render/water.ts` | The same renders |
| A crest breaks over about a second and its foam thins and fades over the next few, rather than switching on and off | `src/render/water.ts` | The same renders |
| On short chop the crests whiten at most a third (E), a lace on the crests rather than white blobs | `src/render/water.ts` | The same renders |

**Takes effect on the site after the merge:** the live job runs the ingest from `main`, so the cloud fix reaches the published forecast at its first run after this is merged. **Not inspected on a real GPU** (GR-1).
