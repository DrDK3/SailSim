# Acceptance scenarios

These scenarios belong to [COMPREHENSIVE_REVIEW.md](../COMPREHENSIVE_REVIEW.md). Each one is reproducible: it gives the initial conditions, the inputs, what to measure, and the expected behaviour with its evidence and tolerances.

**Two kinds of tolerance are kept apart:**

- **Regression tolerance.** How far the measurement may move between builds before a test fails. It protects against accidental change and says nothing about realism.
- **Realism band.** What the validation sailor agrees is right. Until a sailor has answered ([VALIDATION_SHEET.md](VALIDATION_SHEET.md)), the band is **"to be agreed"**. The model value shown is model output (L5), not a target.

## Common set-up

- **Code path:** `runScenario` (`src/sim/scenario.ts`), headless.
- **Wind and water:** the default Squib (`squibParams()`), uniform wind from 000°, flat water, no current unless stated.
- **Seed:** 1.
- **Crew policy:** auto-trim with flatten and auto crew (the player's assists), unless stated.
- **Steady-state window:** a 20 s average after 120–150 s (the same as the AI's target table).
- **Settled:** STW varies by less than 0.05 kn and heel by less than 1° in the window.

**Automated (Package 1, 3 Nov 2026):** `npm run envelope` (`src/sim/validation/envelope.ts`, about 10 s) runs A-PH-1…6, 8, 11–13 and A-CO-1…5 and 7, and writes `out/envelope.json` and `out/envelope.md`. CI keeps the report as the `behaviour-envelope` artifact. Regression checks: `tests/sim/envelope.test.ts`, `tests/sim/anchored.test.ts`. A-PH-9 and A-PH-10 wait for the spinnaker (Package 5); A-CO-6 is checked through the shared pose function (`tests/sim/anchored.test.ts`).

## Physics (A-PH)

| ID | Initial conditions | Inputs | Measure | Expected behaviour | Evidence now | Regression tol. | Realism band |
|---|---|---|---|---|---|---|---|
| **A-PH-1** Upwind | TWS 6, 10, 14, 18 kn; 3 kn start | Autopilot at the polar's best-VMG TWA | STW, heel, leeway, rudder, VMG | Settled; heel rises with wind; weather helm rises with heel | L5. Model (max-drive helper): 3.47 / 4.79 / 5.21 / 4.92 kn; heel 0.1 / 8.5 / 23.3 / 42.9° | ±0.02 kn, ±0.2° | Validation sheet B1.1–B1.4 |
| **A-PH-2** Reaching | TWS 8, 12, 16 kn; TWA 90° | Autopilot TWA 90° | STW, heel | Settled | L5. 12 kn: 5.94 kn | ±0.02 kn | B2.1 |
| **A-PH-3** Running (no spinnaker) | TWS 10 kn; TWA 120, 135, 150, 165, 178° | Autopilot | STW | Speed falls as the TWA rises | L5. 5.15 → 3.94 kn | ±0.02 kn | B2.2 |
| **A-PH-4** Acceleration | TWS 10 kn, TWA 60°, from 0.01 kn | Autopilot TWA 60° | t50 and t90 of the final STW | Monotonic rise | L5. t50 4.6 s, t90 10 s, final 5.28 kn | ±0.2 s | B3.6 |
| **A-PH-5** Coast-down | No wind, 5 kn start, head 000° | Sails free, helm 0 | Time to 3 kn and 1 kn; distance to 1 kn | Monotonic decay | L5. 9.2 s, 60 s, 61 m | ±0.2 s, ±1 m | B3.5 |
| **A-PH-6** Tack | TWS 6, 10, 15 kn; close-hauled on port, settled | Helm hard over until through head to wind, then autopilot on starboard | Minimum STW, turn time, 90% recovery time, windward distance lost against a non-tacking ghost | Speed dips and recovers to the same steady speed | L5. 10 kn: 4.78 → 2.45 kn, 8.6 s, 13.6 s, 11.8 m | ±0.3 s, ±0.5 m | B3.1, B3.2 |
| **A-PH-7** Polar steadiness | Every polar point (TWS 4–24 kn, TWA 35–180°) | Polar generator with the crew policy | Settled? | Every point settled, or flagged "not steady" | — (fixes PH-2) | Exact (flag set) | — |
| **A-PH-8** Gybe and turning circle | Gybe: TWS 10 and 18 kn, TWA 150° → 150° on the other gybe. Circle: 3 kn, helm hard over for 120 s | Helm scripted, then autopilot | Gybe: turn time, minimum STW. Circle: diameter, mean speed | No capsize; boom crosses once | L5. Gybe 10 kn: 5.8 s, 3.16 kn. Circle 17.3 m at 2.7 kn | ±0.3 s, ±0.5 m | B3.3, B3.4 |
| **A-PH-9** Spinnaker handling (after P5) | TWS 10 kn, bear away at a windward mark | Player calls hoist; later drop; one spinnaker gybe | Times from call to filled or stowed; speed loss | Timed crew tasks | Not modelled | Set when built | B6.1–B6.3 |
| **A-PH-10** Spinnaker broach (after P5) | TWS 14–24 kn, TWA 90–150°, spinnaker up | Autopilot; sheets fixed and then eased | Onset (yaw off course > 30° with full helm) | Onset rises when eased | Not modelled | Set when built | B6.5 |
| **A-PH-11** Irons | TWS 8 kn, head to wind, 0 kn | Back the jib to port and reverse the rudder (after P5); before P5, any input | Time to TWA > 50° with STW > 1 kn | Recovered within 20 s | L3 (learn-to-sail guidance) | ±1 s | B3.7 |
| **A-PH-12** Step gust | TWS 10 kn close-hauled, settled; the wind ramps to 16 kn over 2 s | Autopilot; crew policy | Peak heel and when it happens; STW change; peak rudder | Heels, then recovers as the crew eases or flattens; no broach | Not measured | Set at baseline | B5.1 |
| **A-PH-13** Broach sweep (no spinnaker) | TWS 16, 20, 24 kn; TWA 70–120° in 10° steps | Autopilot; sheets (a) fixed, (b) auto | Broach (yaw off course > 30° with the helm hard over) | (b) broaches later than (a), or not at all | AI note: broaches ≥ 20 kn without easing (E) | Exact (yes/no) | B5.2 |

## Collision and grounding (A-CO)

The fleet contact is used: `Fleet` with `uniformEnvironment`, two Squibs or a Squib and a jetty polygon.

| ID | Initial conditions | Measure | Expected (after P6 unless stated) | Evidence now | Tolerance |
|---|---|---|---|---|---|
| **A-CO-1** Square impact on a jetty | 4 kn and 8 kn, heading normal to a 0.3 m-wide fixed jetty | Rebound speed / impact speed (restitution); passed through? | Restitution 0.05–0.15 (L5, to be agreed); never passes through | Today 0.36 at 8 kn; no pass-through | ±0.02 |
| **A-CO-2** T-bone | A at 4 kn into B's side at 90°, B stationary | Impact energy and location; damage class for both boats | The class agreed in validation sheet B4.1 | Today 691 J, "scraped" | Class exact |
| **A-CO-3** Head-on | 3+3 kn and 6+6 kn | Energy; damage class; end speeds | Validation sheet B4.3 | Today 512 J "scraped"; 1,577 J "cracked" | Class exact |
| **A-CO-4** Glancing | 15° and 20° at 4–5 kn (boat and jetty) | Turns parallel; rubs; no rebound away at speed | As today (positive) | Today: rubs smoothly | Heading within 5° of the face |
| **A-CO-5** Committee boat edge (P1) | A Squib at 2 kn aimed to pass 0.5 m inside SAMARITAN's drawn stern, and 0.5 m outside it | Contact? Point of contact | Contact inside, none outside | Today: no contact unless within 2.5 m of the centre | 0.2 m |
| **A-CO-6** Moored-boat pose (P1) | All moored boats on the river, slack water and a 2 kn stream | Distance between the drawn and the physics hull outlines | Within 0.1 m | Today: up to about 1.2 m (±15° render jitter) | 0.1 m |
| **A-CO-7** Regression set (P1) | (a) 14 kn closing on a 0.3 m pile; (b) all of A-CO-1…4; (c) 18 kn wind pinning a boat to a jetty for 60 s | Pass-through; kinetic energy after ≤ before; jitter | No pass-through; no energy gain; jitter < 5 mm | Today: passes (a) at 8 kn; energy and jitter pass | Exact / 5 mm |
| **A-CO-8** Grounding with tide and heel | Dart geodata; sail at 3 kn onto a LIDAR-surveyed drying bank on a rising tide, upright and at 20° of heel | Depth at first contact; float-off time against the tide prediction | Heeled contact at a shallower depth (draft reduced); floats within 2 min of the predicted time | Today: grounded at 141 s, released at 1,239 s; heel effect untested | 0.05 m, 2 min |

## Damage (A-DM, after P6)

| ID | Initial conditions | Measure | Expected |
|---|---|---|---|
| **A-DM-1** Leak | A crack of a stated area 0.1 m below the waterline, close-hauled in 12 kn | Leak rate; bilge volume over time; GM; heel at the same wind against undamaged | Leak rate from the orifice formula; heel rises with water through the free-surface effect; the crew's bailing rate (E) shown |
| **A-DM-2** Bent rudder | Rudder bent by a stated angle | Rudder needed to sail straight | Equals the bend (± the helm-balance change) |
| **A-DM-3** Damaged shroud | Starboard shroud damaged | Maximum main sheeting on port tack; behaviour on starboard | Limited on the loaded tack only |
| **A-DM-4** Session-ending | Water above the threshold; a mast failure | Dialog; race result | RET, with an explanation and a replay offered |
| **A-DM-5** Replay | Any race with damage | The replay's damage events and final state hash | Identical to the live run |

## Environment and clock (A-EN)

| ID | Initial conditions | Measure | Expected |
|---|---|---|---|
| **A-EN-1** Stream | **Interim (P1.8):** a quick race on the river with defaults. **Full (P4):** the stream at the diamond positions over a spring and a neap day | Interim: stream off by default; the "illustrative" label present. Full: turn times and peak rates | Interim: as stated. Full: within ±15 min and ±0.2 kn of the licensed tables; flood and ebb not mirror images unless the data says so |
| **A-EN-2** Time display | Wall clock at 2026-10-25 00:30 UTC and 01:30 UTC (BST ends at 01:00 UTC that day), and 2026-07-01 12:00 UTC | Displayed time and zone | "01:30 BST", "01:30 GMT", "13:00 BST" |
| **A-EN-3** Background tab | A live session; hide the tab for 10 min; show it again | Prompt; the gap shown; environment time after "Return to live" | Prompt shows "10 min behind live"; after return, environment time within 1 s of the wall clock; boat state unchanged |
| **A-EN-4** Live update | A live session; inject a new snapshot with the wind 5 kn stronger and 20° veered | Rate of change of TWS and TWD at the boat; force steps | Change spread over ≥ 60 s; no single-step jump in force above 5% of the steady drive; the replay reproduces it |

## Racing (A-RA)

| ID | Initial conditions | Measure | Expected |
|---|---|---|---|
| **A-RA-1** Over the line | A quick race; the player's boat 5 m over the line at the start, then no input | Coach message; guidance arrow; clearing; retire offer | Message within 5 s; following the arrow back below the line clears OCS (individual recall as implemented); retire offered after 3 min |
| **A-RA-2** Mark-room (after P7) | Two boats overlapped entering the zone (3 lengths), inside and outside | The inside boat given room; the incident attributed | Per the RRS 2025–2028 rule 18 text, re-verified; labelled non-authoritative |
| **A-RA-3** AI trials | `npm run ai:trials` (Start Bay 100 seeds; river 20; 10-boat 30) | Clean-run rate | Start Bay ≥ 95%; river ≥ 90% (after P4/P7); 10 boats ≥ 85% (after P7) |

## Software performance and reliability (A-PF)

| ID | Initial conditions | Measure | Expected |
|---|---|---|---|
| **A-PF-1** GPU resources | Free sailing; then 10 quick-race restarts | `renderer.info.memory` geometries and textures | Back to the first race's counts ± 5% (today +55 geometries per restart) |
| **A-PF-2** Context loss | A race running; call `WEBGL_lose_context.loseContext()`, then `restoreContext()` after 2 s | Message; simulation paused; scene restored; state hash | Message within 1 s; restored within 5 s; the simulation hash is the same as without the loss |
| **A-PF-3** Running slow | CPU throttled (CDP `Emulation.setCPUThrottlingRate`) until below 10 fps | Indicator; quality tier | The indicator appears within 3 s; the tier steps down; live mode shows the gap |
