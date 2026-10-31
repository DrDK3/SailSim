# Fix: racing on the river (31 Oct 2026)

The owner reported: **"Racing in the river is not working."** Two causes were found. The first is fixed. The second is shown clearly on screen and recorded, but not changed, because it is how the protected physics engine is designed. The owner then sent a screenshot of a third: a live race on the river would not start (section 3, fixed).

**Nothing in this fix needs an external service or paid infrastructure.**

## 1. The race froze within a few minutes (fixed)

**What happened:** in any race on the river, sooner or later between about one and three minutes in, every physics step threw an error and the race stopped. The boats froze and the clock stood still. Start Bay races were not affected.

**Cause:** the river traffic (ferries and marina boats) arrives and leaves. To keep clear of it, each AI skipper took the list of vessels now and the list one second later, and paired them by position in the list. When a boat arrived or left within that second, the two lists differed: the AI read a vessel that was not there (`undefined`) and threw.

- The fleet's own contact code already paired vessels by their id.
- The AI trials (`npm run ai:trials -- --river`) race without the traffic, so they never met this.

**Fix (`src/sim/ai/skipper.ts`, 8 lines):** the AI now pairs vessels by id, as the fleet does. A vessel that leaves within the second keeps its position (velocity zero) for that second. This is an AI change, not a physics change: the Start Bay determinism hash is unchanged (`11824f89f479d0f4`).

**Test:** `tests/sim/river-race.test.ts` (new) runs the app's controller headless with the River Dart data, so with the traffic:

- the library's "River race: the Range sausage" for 8 minutes;
- a quick race on the river with five AI boats for 7 minutes.

Both must run without an error, start, and get every AI boat racing.

- **Without the fix:** it fails with `TypeError: Cannot read properties of undefined (reading 'n')`.
- **With the fix:** it passes.

**Browser check:** a whole library river race, in Chromium with no page errors:

- the three AI boats started;
- they rounded the top and bottom marks twice;
- all three finished by about 26 minutes.

## 2. Your boat can run aground before the start and stay there (made clear on screen; not changed)

**What happens:** in the library river race your boat starts at the front of the row, sailing along the line towards its west end at 2 kn on a beam reach. The bank is about 120 m of clear water ahead. Left alone, the boat runs onto the mud in about 80 s, roughly three minutes before the start.

The **AI boats** turn away. **Your boat stays aground:**

- Helm either way, sheets in or released, crew in or out: none of these free her, as tried headless.
- The library race keeps the water level fixed, so the tide never floats her off.

**Why this is not changed here:** it is the grounding model as designed (PHYSICS.md §15). The bottom holds a grounded boat against her sails, and rising water floats her off. The crew can only hike to windward, so they cannot heel her off. There is no way to push off. These are the protected physics engine, so this fix does not change them.

The start slot was not changed either:

- turning your boat the other way along the line would put her head-on to the next boat in the row, 20 m away;
- moving her to the back of the row would change the reference race.

**What changed (interface only):**

- **The Aground warning** (`src/ui/aground.ts`): while the boat still moves on the bottom, it reads as before, "Aground: the keel is on the bottom". Once she has stopped (under 0.1 m/s over the ground), it says what will happen and what to do:
  - **rising tide:** "Aground and stopped: the rising tide will float her off, or press R to start again";
  - **falling tide:** "… the tide is falling, so she will stay until it turns. Press R to start again";
  - **no tide:** "… the water level does not change in this session, so she will stay. Press R to start again".

  Its tooltip explains that only rising water floats a grounded boat off in the simulator.
- **The Damage line** in the instruments (seen after hard groundings: "hull leaking 0.7 kg/s · 9 kg in the bilge") now spans the row and wraps. Before, its long text pushed the instrument columns out of the panel, cutting off TWA, TWS, VMG and Depth.

![Aground and stopped in the river race: the warning says what to do; the instruments fit](img/fix-river-aground.jpg)

**Proposed, not done (OUTSTANDING_ISSUES 107):** a crew "push off" after a grounding.

- **The rule:** RRS 42.3(h) reads: "To get clear after grounding or colliding with a vessel or object, a boat may use force applied by her crew or the crew of the other vessel and any equipment other than a propulsion engine". Sources: US Sailing's rule sheets, [2020](https://www.ussailing.org/wp-content/uploads/2020/12/42.3-Exceptions.pdf) and [December 2024](https://ussailing.org/wp-content/uploads/2024/12/42.3.pdf).
- **Before building it:** check the wording against the official World Sailing 2025–2028 rulebook.
- **Cost:** it would be a change to the protected engine.

## 3. A live race on the river would not start (fixed; owner report, second message)

**What happened:** on the published site, Quick race → the river → Live now (Met Office) said **"Could not start: conditions: a tidal stream needs a tide source"**.

**Cause:** a live race on the river asked for the river's tidal stream, which needs a tide to drive it, and gave it none.

- The site publishes the live Met Office wind (`live/latest.json`).
- It publishes **no live tide yet**: the published `live/index.json` lists no `tide.json`. The tide job writes one only when it has predictions:
  - from UKHO, which needs the `UKHO_API_KEY` secret (not set; licence terms unconfirmed, issue 15);
  - or from the site's own harmonic analysis of the EA gauge, which needs about 36 days of readings. The record began on 24 October 2026, and the analysis runs weekly on Mondays, so the first run that can produce them is about 30 November 2026, provided the record has no long gaps.
- Random conditions were not affected (they set a tide), nor was Start Bay (no stream). The Scenario panel already refuses a stream without a tide.

**Fix (`src/app/quickRace.ts`, `src/app/controller.ts`, `src/ui/QuickRacePanel.tsx`):**

- **With a live tide:** a live race uses it, so the river has its tide and channel stream. The tide applies in Start Bay as well (water level only).
- **Without one:** a live race on the river has no tidal stream, and the water stays at about mean sea level. It says so rather than failing:
  - before you start, the panel reads: "No live tide is published yet, so the river has no tidal stream";
  - during the race, the status line at the bottom reads "no tide · no current".

  No tide is made up for "live" conditions.

**Tests (`tests/sim/river-race.test.ts`, 2 new):** both run the controller with the River Dart data and a live Met Office source (the recorded snapshot in `tests/fixtures`).

- **No live tide:** the race starts with no stream and the note. **Without the fix it fails with the owner's exact message.**
- **With a live tide** (the synthetic tide snapshot): the race has the snapshot tide and the channel stream.

**Browser check:** in the app with a live wind source and no live tide, as on the site:

- the panel shows the note;
- the race starts with 6 boats, the Met Office wind and no stream;
- there are no page errors.

## Tests and checks

| Check | Result |
|---|---|
| `tests/sim/river-race.test.ts` (4, new) | Pass. The first and third fail without their fixes |
| `tests/sim/aground-text.test.ts` (2, new) | Pass |
| Unit and integration tests (Vitest) | All 363 pass (47 files) |
| Typecheck, lint, build | Pass |
| Start Bay determinism hash | Unchanged (`11824f89f479d0f4`) |
| Screenshots | River race aground at 1280 × 800 and 390 × 844; live quick race on the river at 1280 × 800. No page errors |

**Not tested:**

- **Real GPU and touch:** not checked on a real GPU or a touch device.
- **AI trials with traffic:** the AI trials still race without the traffic (issue 108). The new test covers two races, not a statistical run.

---

# Fix round: boats at their landings, the river start, the Cardiff Castle (29 Oct 2026)

The owner reported two faults, with screenshots, and supplied a photograph of MV Cardiff Castle:

1. **PS Kingswear Castle lay across the pontoon** at the South Embankment.
2. **At the start of a race on the river, the Squib was blocked by "some sort of building"** standing in the water.

Both are fixed. The Cardiff Castle is now drawn as the photograph shows her. **Nothing this round needs an external service or paid infrastructure.**

## 1. Boats lying across the pier

![Before: the steamer across the Town Jetty](img/fix-before-steamer.jpg)

**Cause.** Each river boat's route is taken from OpenStreetMap (OSM). Most routes end on the edge of a pier, and the steamer's berth was a point on the Town Jetty. A boat at rest stopped *on* that point, heading along its last leg, so it lay half across the pier. The jetty is the end of five routes as well as the steamer's berth, so boats arriving there also lay on top of one another.

**Fix (`src/sim/env/landings.ts`, new).** Each end of a route and the steamer's berth are matched to the nearest pier edge. The edge must be within 15 m and face the way the boat comes in.

- **Placing the boats.** Boats sharing an edge lie along it in order, 2 m apart, parallel to it and fendered 0.6 m off.
- **When the edge is full.** A boat that does not fit lies alongside the boat nearest its place (rafted), as river boats do at the embankment.
- **Clearing other piers.** Each boat is then moved out, half a metre at a time, until it clears every pier, such as a jetty corner sticking out beside the landing.
- **Arriving and leaving.** Boats ease into this pose over their last 40 m and out of it over their first 40 m.

**Result.** At 11:05 local on 15 July, three boats lie at the Town Jetty: the Kingswear Castle alongside it, the Cardiff Castle outside her, and the passenger ferry outside that. Eleven landings are matched in all.

A check every ten minutes from 06:00 to 22:00 finds no boat at rest overlapping a pier or another boat by more than 5 cm (`tests/sim/landings.test.ts`).

![After: alongside, and rafted outside her](img/fix-after-landing.jpg)

![After, from above: the Kingswear Castle against the jetty, the Cardiff Castle and the passenger ferry outside her](img/fix-after-landing-above.jpg)

## 2. The "building" at the river start

![Before: the river start beside a long yellow building in the water](img/fix-before-river-start.jpg)

**What it was.** The "building" is the **Hindostan**, Britannia Royal Naval College's static training ship, moored off Sandquay. She is the former Sandown-class minehunter HMS Cromer (M103), 52.5 m long (N1 in SOURCES.md). OSM maps her as a building, so the app drew her as a house in the water. The race physics did not see her at all: boats could start beside her and sail through her.

The river course's start line lay just below her, among the Sandquay jetties. Start slots there could put a boat against her side.

**Fixes.**

| What | Change |
|---|---|
| **She is drawn as a ship** | A grey Sandown-class minehunter with a high flared bow, a long deckhouse with the bridge forward, a mast with a radar, a low funnel, a gun forward and a crane on the quarterdeck. She lies on OSM's outline, bow to its narrow north-west end, afloat with the tide (`minehunterModel`, `shipOnFootprint` in `src/render/traffic.ts`; `src/render/dart.ts`). Proportions are estimates (E) |
| **Buildings in the water are solid** | Any OSM building whose ground is under water is now a fixed outline in the race physics, as piers are. "Under water" means the bed at its centre, or at half its corners or more, is below 0.5 m ODN, about mean tide (E). Fourteen are found: the Hindostan, two boathouses, the ferry office and ten unnamed huts and offices on pontoons (`src/sim/env/structures.ts`) |
| **Start slots keep clear** | No start slot is placed within 12 m of a pier or any of these structures (`START_CLEARANCE.structureM`) |
| **The AI steers round them** | AI boats penalise tracks that pass within 6 m of a structure and treat one within 4 m as a hazard. After finishing, a boat parks in clear water it can reach in a straight line, at least 20 m from any structure and outside the moorings (`src/sim/ai/skipper.ts`) |
| **The river course moved upriver** | The Range sausage now starts 180 m further up, at the wide part of the Range, with the line from (1560 N, −430 E) to (1560 N, −340 E). The bottom mark is at 1620 N and the top mark at 1960 N. The start is clear of the Sandquay jetties, the Hindostan and Dart Marina (`data/courses/simulated/river-range-sausage.course.json`) |
| **The solo start and free sailing** | When the user sails alone, the starting position also avoids these structures and the quay walls. Free sailing meets them as obstacles too (`src/app/controller.ts`) |

![After: the river start in open water](img/fix-after-river-start.jpg)

![After, from above: the start line clear of the pontoons](img/fix-after-river-start-above.jpg)

![After: the Hindostan drawn as a ship at Sandquay](img/fix-after-hindostan.jpg)

**AI trials on the river.** There were 20 seeded races with 5 AI boats each (`npm run ai:trials -- --river --runs 20 --boats 5`), with the wind 6–14 kn from any direction and a 1.5 kn flood stream.

- **15 of 20 were clean.** 96% of boats finished.
- **No structure contacts and no groundings.** No boat touched the Hindostan or any other building.
- **The five runs that were not clean:**
  - two had boat-on-boat contacts (rules 10 and 13);
  - two had mark touches, one of which ended in a DNF;
  - one had a single contact with a pontoon.
- **The worst run (seed 17).** The wind was 7.3 kn from SSE, against the flood. One boat was over the line early (OCS) and could not beat back against the stream. It drifted into the lane behind the mid-river pontoons and lay pinned against them until the race ended. A second boat also touched those pontoons.

These remain open as issue 93. This is the first river trial the project has recorded (issue 40), so there is no earlier figure to compare with. The Start Bay trials and the physics are unchanged: the determinism hash is still `11824f89f479d0f4`.

## 3. MV Cardiff Castle from the owner's photograph (P3)

The photograph shows:

- a dark navy hull with a white crest on the bow and a white band at the gunwale;
- a long main saloon with large windows;
- an upper deck behind a solid white bulwark, lined with passengers;
- a raised wheelhouse forward;
- a tall white mast with a radar and flags;
- no funnel to be seen.

The model now follows it (`cruiserModel` in `src/render/traffic.ts`):

- **Removed:** the earlier estimate's buff funnel.
- **Added:** the white bulwark round the upper deck with passengers along it; the wheelhouse forward with the mast and its flags.
- **Bow crest:** drawn as a plain white shield; its device is not drawn.
- **Hull:** the navy darkened to the photograph's.

The photograph is a small one: sizes and the crest's shape are estimates (E19).

## Tests

**New tests:**

- **`tests/sim/landings.test.ts`, 7 tests:**
  - boats lie along an edge in order and the one that does not fit is rafted;
  - a claim with no pier edge within reach is left out;
  - no Dart river boat at rest overlaps a pier or another boat all day;
  - the steamer lies alongside the Town Jetty, parallel to it;
  - the Hindostan is found among the structures in the water;
  - start slots refuse a point beside her;
  - she is drawn about 52 m by 10 m with her bow to the north-west.
- **`tests/render/traffic.test.ts`:** the minehunter model builds at her size, bow forward, within the triangle budget.

**Results:**

| Check | Result |
|---|---|
| Unit and integration tests (Vitest) | All 336 pass |
| Typecheck, lint, build | Pass |
| Build secret check | Pass |
| Start Bay determinism hash | Unchanged (`11824f89f479d0f4`) |

## Still open

These are recorded in OUTSTANDING_ISSUES.md:

- **Issue 91.** The layout at a landing is a rule (E). Five OSM routes and the steamer end at the Town Jetty, so when several boats are in they raft outside one another, up to five deep, where in reality they use several pontoons along the embankment. Traffic is kinematic: a boat leaving from inside a raft passes through the boats outside it.
- **Issue 92.** The in-water threshold (0.5 m ODN) is an estimate. The Hindostan's proportions and details are estimates: no photograph or drawing of her was viewed.
- **Issue 93.** River AI: 15 of 20 trials were clean. An OCS boat in light wind against the stream can end up pinned against a pontoon.
