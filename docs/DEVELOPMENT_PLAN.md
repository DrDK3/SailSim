# Staged development plan and acceptance criteria

Every phase ends with a **phase gate**:

1. The app runs (dev server and production build).
2. `npm test` passes, and any phase-specific scenario suite passes.
3. Errors are fixed before moving on.
4. A phase report: what works, what is incomplete, assumptions, known defects, and reproducible test steps.
5. The README, physics docs, course-data docs, provisional-elements register and outstanding issues are updated.
6. Everything is committed (and pushed, once a remote exists).

## Phase 0: Research and feasibility (this delivery)

**Delivered:**

- Research report, source register and missing-information list
- Architecture
- This plan
- Geodata spike scripts and a feasibility map

**Awaiting:** your approval, plus the documents and network access in `MISSING_INFORMATION.md`.

## Phase 1: A working boat in simple water (first milestone, M1)

**Status: complete (22 Oct 2026).** See [`PHASE1_REPORT.md`](PHASE1_REPORT.md).

**Scope**

- Project skeleton:
  - Vite + TypeScript (strict) + Three.js + React (DOM UI only)
  - ESLint (including a rule forbidding `sim/` from importing DOM or Three.js), Prettier
  - Vitest, Playwright
- `sim/` core:
  - Vector and angle utilities, NED frames, seeded PRNG
  - Fixed-step RK4 loop and input log
- `class-spec.json` and `calibration.json` with provenance tags. The loader enforces provenance.
- **3-DOF Squib model:**
  - Main and jib with sheet-limited sail angle, luffing and stall
  - Keel and rudder lifting surfaces
  - ITTC + Delft-series hull resistance
  - Added mass and yaw damping
  - Quasi-static heel from moment balance
  - Steady uniform wind; no current yet
- Scene:
  - Procedural Squib (hull, keel, rudder, mast, boom, sails, basic standing rigging)
  - Animated open water, sky, chase and top-down cameras
- Controls (keyboard and on-screen): helm, mainsheet, jib sheet, optional auto-jib, pause, reset, restart.
- HUD: heading, STW, SOG, AWA/AWS, TWA/TWS, sheet trims, heel, tack.
- Debug overlay: numeric state plus force arrows.
- Headless scenario runner, which outputs CSV.

**Acceptance (see the criteria table):** 1, 2, 3, 6, 8 and 11 pass. Criterion 4 passes in its basic form (speed loss and non-instantaneous heading change). A Playwright smoke test passes.

## Phase 2: Tested sailing physics model (M2)

- 4-DOF with dynamic roll.
- GZ curve and crew weight and position (hiking).
- Heel effects on sail force, hull drag and helm.
- Weather and lee helm from CE and CLR geometry, shown on the HUD.
- Boom as a hinged body, so gybes (including crash gybes) emerge.
- Seeded gust and shift model; spatially varying wind.
- `TideSource` interface (Manual, Replay, Live) and a phase-driven uniform current (see `LIVE_TIDES.md`).
- `WeatherSource` interface: Manual, Replay, and **Live point mode** from the Met Office ingest (see `LIVE_WEATHER.md`).
- Current: uniform, analytic test fields, flood and ebb scenario curves.
- Wind-against-current wave flag.
- **Validation dashboard** (live plots) and **polar-sweep tool** (model output, labelled).
- Calibration workflow document: how to fit coefficients when GPS and wind logs arrive.
- **Acceptance:** criteria 1–8 and 11 in full, plus golden-trace regression tests.

**Status: done, 22 Oct 2026** ([PHASE2_REPORT.md](PHASE2_REPORT.md)). Criteria 1–8 and 11 pass in full; four golden traces. Differences from this list:
- the spatially varying UKV wind field arrived here rather than in Phase 3;
- live wind is a source the app discovers (`live/latest.json`); the scheduled ingest that publishes it is Phase 6 work, and a dated replay is bundled;
- live tide fetching is blocked in the build container, so tide is manual or from a snapshot file;
- criterion 5's sweep is TWA 160° → 200° (see the criteria table).

## Phase 3: Geographically grounded River Dart (M3)

- Geodata pipeline (`tools/geodata`) generating:
  - Coastline and water mask
  - Terrain chunks (EA LIDAR)
  - Sentinel-2 drape
  - Buildings
  - Landmarks, pontoons, trots
  - Ferry routes
  - `provenance.json`
- Rendering:
  - Terrain, buildings and landmark proxies
  - Moorings with instanced boats
  - Ferries animated on their routes, with a provisional schedule and RAM status
  - Navigation marks, using only positions with a stated source
- Provisional bathymetry and grounding; provisional channel-following current field; tide-height input.
- Minimap.
- **Live spatial wind field** from the UKV 2 km grid over the Dart area.
- Live tide height (EA Dartmouth gauge) for depth and grounding; spatial current pattern driven by real tidal phase, range and river flow (provisional pattern).
- In-app **Provisional Elements** panel and attribution panel.
- **Acceptance:**
  - Projected distances between eight reference landmarks match the source data to within 2 m.
  - The boat cannot sail through land (it collides or grounds).
  - All provisional layers are labelled in the UI.
  - Load errors (a missing tile or asset) degrade gracefully and are reported.

**Status: done, 22 Oct 2026** ([PHASE3_REPORT.md](PHASE3_REPORT.md)). All four acceptance criteria pass:
- landmark distances worst 8 cm;
- no sailing through land in eight shore approaches;
- provisional layers labelled;
- load errors degrade gracefully.

Differences from this list:
- **Live tide height:** still manual or from a snapshot (EA and UKHO hosts blocked here).
- **Navigation marks:** only Castle Ledge is placed (others have no established position).
- **Collisions:** ferries and moorings are animation and scenery, not obstacles, until Phase 5.
- **Live spatial wind:** done in Phase 2.
- **Projection:** replaced by an exact Transverse Mercator matching PROJ.

## Phase 4: Editable courses and official RDYC courses (M4)

- Course JSON schema, validator and loader.
- Line, gate and mark-rounding detection.
- **Course editor**: add, move, inspect and sequence marks; rounding sides; gates; import and export.
- Scenario setup UI: wind, tide, start time, course, laps, start position, seed.
- Simulated practice courses: windward/leeward, triangle, tacking lane, gybing slalom, mark-rounding drills. These are labelled *simulated*.
- **Verified club courses:** entered from the uploaded documents with status `pending-check`. You (or your nominated checker) mark them `verified`.
- Ferry tracks and restrictions are enforced by the validator.
- **Acceptance:** criteria 9 and 10. The validator rejects courses that cross land or restrictions.
- Optional: spinnaker (decision D2).

## Phase 5: Race management and AI competitors (M5)

- Start sequence per the SIs (default 5-4-1-0), OCS detection, individual and general recall.
- Laps, finishing and results table.
- AI Squibs using the **same physics**. The controller handles target-VMG steering, tack and gybe decisions (laylines, shifts, current), mark approach and rounding, and collision avoidance.
- A selected RRS 2025–2028 Part 2 subset, after verifying the rule text and the SIs. Flagged as non-authoritative.
- **Acceptance:** criterion 12. AI boats complete a practice course without grounding or collisions in at least 95% of 100 seeded runs.

## Phase 6: Visual refinement, replays, optimisation, deployment (M6)

- Water, wake and sail-shape polish; weather presets; helm and cockpit view refinement.
- Deterministic replays from input logs; scenario library.
- Performance profiling; asset compression; lazy loading.
- Production build, hosting setup (GitHub Pages or Cloudflare Pages), deployment documentation, cost statement.
- Scheduled live-weather and tide ingest job (EA, UKHO), harmonic-constant derivation and validation, stale-data handling, visual weather (cloud, visibility, rain).
- **Acceptance:**
  - The production build is served and passes the end-to-end tests.
  - Controls work.
  - Missing data is handled gracefully.
  - No secrets in the bundle (automated grep check).

---

## Acceptance criteria (draft numbers, open to your review)

Default test conditions:

| Condition | Value |
|---|---|
| TWS | 10 kn |
| Water | Flat, no current (unless stated) |
| Crew | 2 × 80 kg (E) |
| Water density | 1025 kg/m³ |
| Air density | 1.225 kg/m³ |

These criteria test **internal consistency and physical plausibility**. They do **not** claim real-world accuracy: no Squib performance data exists to compare against. The plausibility bands are estimates (E) and will be replaced when evidence arrives.

| # | Criterion | Method | Pass condition |
|---|---|---|---|
| 1 | Trimmed sail drives on feasible points of sail | Steady-state runs at TWA 50°, 90°, 135°, with sheets set by an optimiser for 180 s | Net sail drive > 0. STW converges (\|dSTW/dt\| < 0.01 kn/s). *Plausibility (warning only):* steady STW 3–6 kn |
| 2 | Luffing reduces drive | From optimum trim at TWA 60°, ease the sheet past the luff point | Drive falls ≥ 50% within 1 s; steady STW falls ≥ 30% |
| 3 | Apparent wind consistent | 10,000 random states compared with the analytic vector formula; heading sweep at fixed STW | Error < 1e-9 m/s. AWS is monotonically non-increasing as TWA goes from 0° to 180° |
| 4 | Tack slows the boat and turns it over time | Scripted helm input from steady close-hauled starboard | Heading change 70–110°. Minimum STW ≤ 85% of entry STW. Bow-through-wind ≥ 1.5 s after helm-over. Peak \|yaw rate\| ≤ 45°/s. Back to ≥ 90% of steady STW within 30 s. Sails change side as a result of the apparent-wind sign change |
| 5 | Gybe emerges | **Revised in Phase 2.** Bear away at 1°/s from TWA 160° to by-the-lee (TWA 200°) with the mainsheet fixed, fully eased and half in | Boom crosses the centreline without any gybe command. Boom never beyond the sheet limit; a crash gybe (sheet eased) swings faster than a controlled one (sheet half in). Heading stays continuous (< 1° per 10 ms step). The crossing angle and peak rate are reported as model output (Phase 2: 10.7° by the lee; 314°/s eased, 140°/s half in) |
| 6 | Rudder response consistent | Rudder sweep −25°…+25° at 4 kn (and at 2 and 6 kn) | Yaw-rate sign matches the helm convention. \|r\| rises monotonically up to the stall angle. Turn rate at fixed rudder angle increases with speed. Zero rudder, symmetric case: \|r\| < 1e-6 rad/s |
| 7 | Current affects ground motion only | Same run with and without uniform current (1.5 kn, 8 directions), wind defined over water | STW traces identical within 1e-6 kn. SOG equals \|V_w + C\| within 1e-9. Track offset equals C·t within 0.01 m after 300 s |
| 8 | Cannot sail into the wind | **Revised in Phase 1.** Captive (heading-locked) test at TWS 6, 10, 15 and 20 kn and TWA 0–15°, from rest and from 5 kn | No steady forward STW > 0.3 kn within 15° of the wind. The minimum TWA giving positive steady STW is reported as model output (Phase 1: 21° from rest, 17° with way on; Phase 2: 22° and 18°) |
| 9 | Rounding order and direction | Synthetic track fixtures: correct, wrong side, skipped, wrong order, unwinding loop, extra loop | 100% expected verdicts |
| 10 | Start and finish repeatable | 100 repeated runs; analytic straight-line crossings | Bit-identical crossing times. Interpolation error ≤ 1 ms. OCS flagged when any hull reference point is on the course side at the signal |
| 11 | Reproducibility | Same scenario, seed and input log, 600 s simulated | **Revised in Phase 1.** Bit-identical hash within one engine (Node–Node, Chromium–Chromium). Across engines, every state component within 1×10⁻⁶; different V8 versions differ in the last bit of Math.sin, Math.cos and Math.pow |
| 12 | Performance with AI | 1 + 20 boats, headless | Physics ≤ 1.5 ms mean and ≤ 3 ms p99 per 1/60 s frame on the CI container. Rendering ≥ 55 fps median at 1080p "medium" on reference hardware (to be agreed; manual check) |

## First milestone (M1) definition of done

- `npm install && npm run dev` opens a Squib sailing in open water. You can steer, trim both sails, tack, bear away, stop (head to wind), reset and restart.
- `npm test` passes criteria 1, 2, 3, 6, 8, 11 and basic 4. `npm run test:e2e` passes the smoke test.
- `npm run scenario -- scenarios/beat-10kn.json` writes a CSV trace.
- `docs/PHYSICS.md` documents every force model, its equation and source, and lists each coefficient with its tag.
- The phase report lists the estimated coefficients, the known defects and how to test them.
