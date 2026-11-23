# Status: what the simulator does, and how far to trust it

One page for the owner, the club and anyone deciding what to do next (package G, 21 Nov 2026). The detail is in the
round reports linked from the [README](../README.md); open issues are in [OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md),
grouped by area.

**Latest round (23 Nov 2026):** the design team's handover, 36 items: [HANDOVER_23NOV_REPORT.md](HANDOVER_23NOV_REPORT.md).
The current behaviour in one page, checked against the build: [CURRENT_SPEC.md](CURRENT_SPEC.md); which documents are
current and which historical: [docs/README.md](README.md).

## What it does

A browser simulator of the National Squib keelboat on the River Dart and in Start Bay, free, with no account and
nothing to install. It runs at https://drdk3.github.io/SailSim/ (an overview page:
https://drdk3.github.io/SailSim/landing.html).

- **Learn**: six short lessons checked as you sail (steering, the wind, trim, tacking and gybing, the start, the
  stream), three seamanship lessons (a mooring, coming alongside, man overboard), two exercises (trim, tack and
  recover; a wind shift on a beat), and the Learn map, which orders them and suggests the next step.
- **Sail**: free sailing on the river and in Start Bay, in the Met Office forecast or the wind and tide you set;
  three Squib types; the spinnaker; at Expert, the sail controls one by one.
- **Race**: today's challenge, a weekly course with model-sailed targets, a start drill, and races against up to 20
  AI Squibs on practice courses, the RDYC's courses (pending the club's check) or one you build; a race committee, a
  simplified judge (rules 10–13 and 31, rule 18 advisory unless switched on, findings that unjudged rules could change labelled provisional; not authoritative) with penalties and a protest room.
- **Look back**: a debrief after each sail, replays, ghosts, challenge links; a club table (written, off until the
  owner sets it up).
- **Teach**: the instructor view (where each figure comes from, the exercises' thresholds and the assist record) and
  instructor files.

## How far to trust it

Evidence levels as in the [comprehensive review](COMPREHENSIVE_REVIEW.md) §0: L1 verified specification or geometry,
L2 measured data, L3 published guidance, L4 experienced-sailor judgement, L5 engineering approximation, L6 unsupported
assumption. "E" marks an estimate.

| | Measured or specified | Estimated (E) | Validated |
|---|---|---|---|
| The boat | The hull's dimensions from the class rules (L1); the spinnaker's area and pole from the class (L1) | The upwind sail area (from the rules' maxima, issue 2); every hydrodynamic and aerodynamic coefficient; the crew's trim; the spinnaker's behaviour; damage thresholds (L5) | **Nothing** |
| The river and the sea | The shoreline and drying areas from Environment Agency LIDAR survey data (L1) | Buildings, piers, pontoons and mooring areas from OpenStreetMap (positions not checked, issue 9); mid-channel depths, individual moorings, the tidal stream, the wind's sheltering by the land, ferry timetables (L5) | **Nothing** |
| Weather and tide | Environment Agency tide data, published by a scheduled job. The "live" wind is Met Office forecast-model output for the region, not a local measurement (issue 12) | Gust and shift statistics; the "from data" gust mapping (L5) | **Nothing** |
| Racing | The RDYC marks and eight courses from the club's own documents (the courses pending a club member's check, issue 1); the rules as quoted in secondary sources of the 2025–2028 rules (L3; the World Sailing text could not be fetched, issue 32) | The judge's thresholds; the AI's skill and tactics (L5) | **Nothing** (the judge is not an authoritative adjudication) |
| Teaching | The lessons' and exercises' content (draft) | Every threshold (provisional, L5) | **Nothing**: not yet tried by learners or instructors |

The simulator says so itself: About lists every label, and the instructor view shows them where they apply. **Not
for navigation or performance prediction.** No RYA or other accreditation is claimed.

## Measured here (software rendering, a cloud container)

- **The AI fleet** (`npm run ai:trials`, seeds 101–200, 21 Nov 2026; a race is clean when no boat touches anything and
  every boat finishes):
  - 10 boats: 81 of 100 races clean (79 before package F), short of the 90% aimed for;
  - 5 boats: 98 of 100;
  - the river: 16 of 20.

  [NEXT_ROUND_REPORT.md](NEXT_ROUND_REPORT.md) §F has the detail; issue 268 has what is left.
- **Physics cost** (`npm run perf`): 0.46–0.60 ms mean and 1.19–1.50 ms p99 per 1/60 s frame for 21 boats, within the
  budget of 1.5 ms and 3 ms. A race with 20 AI boats goes over 3 ms p99 in its crowded moments (issue 262).
- **Graphics** (`tools/gfx-bench.mjs`): relative figures, in software rendering only. **No real GPU, phone or tablet
  has been checked** (#32).

## Scenery freeze (#29)

**The scenery is frozen**: no new buildings, vehicles, people, trains or landmarks. Scenery is changed only where a
recommendation needs it for performance, looks or occlusion. Recorded 21 Nov 2026; it stands until the owner lifts it.

## Open decisions (the owner's)

- **A name and a domain** (#40): five names proposed in [NEXT_ROUND_REPORT.md](NEXT_ROUND_REPORT.md) §E.3; none
  adopted, no domain bought.
- **The NSOA**: a note is drafted (§E.4), not sent.
- **The club table**: written and tested, off until the owner sets up its free-tier endpoint.
- **Offline use**: no service worker (§E.2); one could be added, network-first for the live data, if offline use is
  wanted.
- **The UKHO licence** for publishing its predictions (issue 15), before any UKHO key is added.
- **The RDYC courses**: entered, each labelled "pending club check" until a club member checks them (issue 1). The
  club's approval covers its name and burgee (owner, 20 Nov 2026), nothing wider.

## Needs people

None of these is claimed done.

- **#28 A validation session** with Squib sailors: nothing in the simulator is validated. With it, the **B6
  questions** about the spinnaker (the README lists them).
- **#32 Real-device checks**: phones, tablets and a real GPU.
- **#4 The wind indicator** Squib sailors use (a burgee or a masthead vane): both are offered until it is known.
- **The NSOA**: not contacted.
- **Naming** (#40): not chosen.
- **A listening test** of the sounds.
- Squib performance data (polars, GPS tracks), measured currents in the harbour, and a local wind record: requested
  in [MISSING_INFORMATION.md](MISSING_INFORMATION.md).
