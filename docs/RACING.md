# Racing: the fleet, the race committee, the rules subset and the AI

Phase 5 adds racing against AI Squibs. This page describes what is simulated, what each part is based on and its limits. **The racing-rules logic is a simplified subset, not an authoritative adjudication**: it holds no protests or hearings and leaves many rules out.

Sources are in [SOURCES.md](SOURCES.md) (RR1–RR9). The 2025–2028 rulebook PDF could not be downloaded from this environment (network policy), so the wording was checked against secondary copies quoted by web search (23 Oct 2026). The **club's sailing instructions are not available** (MISSING_INFORMATION A2), so every choice they would make is a labelled default.

## 1. The fleet and contact (`src/sim/race/fleet.ts`, `hull.ts`)

All boats share one environment, stepped once per 10 ms tick, and sail with the same physics (`Simulation`). Each boat is a convex hull outline: the same estimated deck plan as the 3D model, 5.79 m × 1.87 m.

| Contact with | Model | Coefficients |
|---|---|---|
| Another boat | Overlap by the separating-axis test. Normal force k·depth + c·closing speed (never pulling), Coulomb friction μ = 0.3, equal and opposite, at the contact point (gives yaw) | k = 2×10⁵ N/m, c = 5×10³ N s/m (E) |
| Committee boat | SAMARITAN's hull outline (10.82 × 3.57 m), centred on the line-end mark, lying head to the stream or the base wind exactly as drawn (`src/sim/race/anchored.ts`; review CO-3, 3 Nov 2026). Was a 2.5 m circle | as above (E) |
| Navigation buoy, fixed mark | Fixed circle; same law | as above (E) |
| Turning mark, pin (robotic marks: an inflatable on twin pontoons, `src/render/robotMark.ts`) | Fixed circle of 0.9 m round the pontoons (was 0.75 m for an anchored inflatable and 0.4 m for the pin buoy), softer | k = 3×10⁴ N/m, c = 2×10³ N s/m (E) |
| Moored boat | Box l × l/3, lying to the stream (or the base wind, swung by up to ±15° from the layout) downstream of its buoy. The renderer draws the same pose (`anchored.ts`; review CO-4). It used to add its own swing, up to ±15° away from the physics | hard (E) |
| Ferry, river boat, the paddle steamer | Box on its timetabled track, moving | hard (E) |
| Pier, jetty, pontoon (and the RDYC pontoon's gangway); the towns' quay walls (photo round, PHYSICS.md §16); buildings standing in the water, such as the Hindostan, BRNC's moored training ship, and huts on pontoons (fix round, `src/sim/env/structures.ts`) | Convex pieces of the outline; floating pontoons softer on their fenders; buildings in the water fixed | PIER_CONTACT (E) |

**How the forces are applied:** they are computed from the states at the start of the step and held over it, so the result does not depend on the order of the boats and runs are deterministic. They act in the horizontal plane, and since the realism round a contact also heels the boat through its force at deck height, and a hard one can damage the hull, rudder or rig (PHYSICS.md §21). Marks do not move.

**Test:** in a 3.7 m/s port–starboard collision, the hulls overlap by at most 14 cm, and the boats push apart (`tests/sim/race.test.ts`).

## 2. Race committee (`src/sim/race/committee.ts`)

| Item | What the simulator does | Basis |
|---|---|---|
| Starting sequence | Warning 5 min: class flag, one sound. Preparatory 4 min: P, U or black flag, one sound. One minute: preparatory flag down, one long sound. Start: class flag down. Times from the visual signals. Also a 3-minute and a 1-minute practice sequence. Since review Package 2 the sounds are played (a procedural horn) and captioned in the race panel | Rule 26 (default 5-4-1-0). The RDYC SIs 2026 use rule 26 with the warning 5 min before the start (SI 9.1; docs/CLUB_DOCUMENTS.md) |
| Individual recall | Flag X with one sound when a boat is on the course side at her starting signal. Down when every such boat has returned completely, or 4 minutes after the start, whichever is earlier. Not with U or black flag | Rule 29.1 |
| General recall | First Substitute, two sounds. The new warning signal comes one minute after it is lowered | Rule 29.2 |
| When to recall | The committee may recall when it cannot identify OCS boats. Here every boat is identified, so it is a **policy (E)**: recall when at least 3 boats and 30% of the fleet are OCS. Lowered 60 s after the start (E). After a recall the next start uses flag U (E; a setting) | Rule 29.2, simulation policy |
| U flag | Any part of the hull in the triangle formed by the line ends and the first mark during the last minute: UFD (disqualified without a hearing; not if the race is restarted) | Rule 30.3 |
| Black flag | As U, but BFD stands if the race is restarted or resailed, and the boat may not sail the restart | Rule 30.4 |
| Finishing window | Boats still racing 15 min after the first finisher are DNF (E: SI-dependent). Overall time limit 90 min after the start (E) | SIs not available |
| Scoring | Low point: place = points. DNS, OCS, DNF, RET, UFD and BFD score entries + 1 | Appendix A4, A5.2 |

**Not modelled:**
- **Flags I and Z:** the 2025–2028 text was not verified.
- **Postponement and abandonment.**
- **More than one class.**
- **Shortened course.**
- **Course changes.**

## 3. Rules subset (`src/sim/race/rules.ts`)

### Definitions as used

- **Tack:** the boat's windward side (true wind over the water). When head to wind, the previous tack. When by the lee or dead downwind, the side opposite the mainsail.
- **Clear astern, clear ahead, overlap:** judged on the hull outline against a line abeam from the other boat's aftermost point. Equipment and crew are not modelled.
- **Leeward and windward:** of two overlapped boats on the same tack, the one on the other's leeward side. If the two boats' views disagree (crossing at an angle), the boat further downwind is the leeward boat.

### Right of way

| Rule | Implemented as |
|---|---|
| 13 | From passing head to wind until within 3° of her close-hauled angle (from the AI polar), a boat keeps clear. Rules 10–12 do not apply to her. Both tacking: the one on the other's port side keeps clear (2025–2028 wording not verified) |
| 10 | Opposite tacks: port keeps clear of starboard |
| 11 | Same tack, overlapped: windward keeps clear of leeward |
| 12 | Same tack, not overlapped: clear astern keeps clear of clear ahead |

### Incidents

- **Contact between two racing boats** after the preparatory signal: the boat that had to keep clear (rules 13, 10, 11, 12, checked in that order) is reported. She owes a **Two-Turns Penalty** (rule 44.1).
- **Contact before the preparatory signal** (or with a boat no longer racing): no penalty. Part 2 applies then too, between boats intending to race, but a boat not racing is not penalised under it, except under rule 14 when there is injury or serious damage, and rule 23.1 (neither judged here). Until 23 Nov 2026 the text said Part 2 "did not yet apply", which was wrong (design handover item 4).
- **Notes added, not judged:**
  - rule 14 for the right-of-way boat;
  - rule 15 when right of way changed less than 5 s before contact;
  - rule 16 when the right-of-way boat turned more than 15° in the 3 s before;
  - rule 18 (advisory) when one boat owed the other mark-room and its penalties are switched off.
- **Provisional findings** (design handover item 4, 23 Nov 2026): when the rule 15, rule 16 or advisory rule 18 note
  applies and could change who was at fault (for rule 18: the boat owing mark-room is not the one found at fault), the
  incident carries `provisional: ['15' | '16' | '18']`, its summary ends "Provisional: rule N, not judged here, could
  change this finding.", and the protest room says so. **The penalty stands**: the game's outcome stays explicit, and
  uncertainty gives no immunity. No scoring changed, so no records or ghosts need a new version.

### What the simplified judge resolves (scope, 23 Nov 2026)

| Situation | Resolved? |
|---|---|
| Contact, opposite tacks, neither tacking (rule 10) | Yes |
| Contact, same tack, overlapped (rule 11) or clear astern (rule 12) | Yes |
| Contact while one boat is tacking (rule 13) | Yes (2025–2028 wording of the both-tacking case not verified) |
| Touching a mark of the current leg (rule 31) | Yes |
| Contact soon after right of way was acquired (rule 15) | Ruled under 10–13, **labelled provisional** |
| Contact after the right-of-way boat changed course (rule 16) | Ruled under 10–13, **labelled provisional** |
| Contact at a mark (rule 18) | Simplified 18.2 when switched on; otherwise ruled under 10–13, **provisional** where rule 18 points at the other boat |
| Avoiding contact (rule 14), obstructions (19, 20), rule 17, exoneration (rule 43, formerly 21), redress, protests | Not resolved |
| Contact before the preparatory signal, or with a boat no longer racing | No penalty (see above) |

Wording here is paraphrased from secondary sources (World Sailing's rules site was not reachable from the build
environment). A qualified rules reviewer should check it, and the reviewed cases (right of way acquired, course
changes, mark-room) before any behavioural or scoring change: see docs/HANDOVER_23NOV_REPORT.md.
- **Touching a mark of the current leg** (a start mark before starting, a finishing mark) while racing: rule 31, **One-Turn Penalty**.
- **Hitting a moored boat or a ferry:** recorded as a collision outside the racing-rules subset.

### Penalty turns

Rule 44.2: each turn is 360° in one direction and includes one tack and one gybe. Turning back by more than 45° restarts the turn in progress. "Promptly" and "well clear" are not checked.

### Results

An untaken penalty is shown in the results ("no penalty taken"). There is no protest: the score is not changed.

### Not implemented

- Rules 15 and 16 as adjudication.
- Rules 17, 19 and 20 and Part 2 Section D (obstructions, hailing). **Rule 18 is judged in a simplified form** (package F, below); the AI keeps clear of boats at marks.
- Exoneration (rule 43 in the current rules; rule 21 in older editions).
- The scoring penalty (44.3).
- Protests, hearings and redress.

## 4. AI skippers (`src/sim/ai/`)

The AI sails the boat through the same controls as the user: helm, the auto-trim assist and the crew assist. It never sets the boat's state.

### Target speeds (`polarData.ts`, generated by `npm run ai:polar`)

These are the **model's** own steady speeds with the AI's controls. They are model output from estimated coefficients, not measured Squib data.

- **Sheet handling:** the AI eases the main beyond 24° of heel, as a crew dumps the main in a gust (E). Without this the model broaches when reaching in 20 kn or more.
- **Staleness check:** a test fails if the boat parameters change without regenerating the table.
- **With the spinnaker** (fixes of 21 Nov 2026, §2.3; `polarDataSpin.ts`, generated by `npx tsx tools/ai-polar.ts --spin`): the same model sailed with the spinnaker set and drawing, by the crew's own policy, for two minutes at each point. Aft of 90° and up to 20 kn each point takes the faster of the two tables; elsewhere it is the table without one. Model output (E), with the spinnaker's estimated coefficients.
  - **Who uses it:** a boat that carries the spinnaker is judged by it: the coach's downwind score (its debrief names the table: "model polar with the spinnaker set, E" or "without a spinnaker, E"), the laylines on a run, and the spinnaker advice's angle. The AI steers by it only while racing in 20 kn or less (where it flies the spinnaker); before the start, and above 20 kn, it keeps the table without one, so its starts are as before.
  - **Replays:** a race with spinnakers records `aiSpinPolar: true` and replays by the spinnaker table; a recording without it (made before) replays with the AI on the table without one, as sailed.
  - **Downwind angle:** neither table sends a boat nearer dead downwind than 175° (`RUN_TWA_MAX_DEG`); the table without one keeps its angles (all below that).
  - **The weekly course:** its targets are sailed with the AI on the spinnaker table only from the ISO week 2026-W49 (Monday 30 Nov 2026, Europe/London: `AI_SPIN_POLAR_FROM_WEEK` in `src/app/weekly.ts`), never mid-week; until then the fleet carries the spinnaker but steers by the table without one, as when the week began.
  - **Measured** (`npm run ai:trials -- --first 101 --runs 100`, seeds 101–200): see docs/FIXES_21NOV_REPORT.md §2.3 for the clean races before and after, with and without spinnakers. The reference race (`tools/race-hash.ts`, no spinnaker) is unchanged; its spinnaker variant (`--spinnaker`) changed, as intended.

### Tactics (5 times a second)

- **Upwind and downwind:** best-VMG angles from the polar, with leeway and current in the track predictions.
  - **Lay lines:** the AI tacks or gybes when the mark (or the point beside it) can be laid, plus a skill-dependent overstand.
  - **Shifts:** it sails the tack that points nearer the mark, with a hysteresis of twice the skill's shift threshold.
  - **Cone:** it comes back if it strays too far from the line to the mark.
  - **Hazards:** it tacks away from shallow water, boundaries, mooring areas, piers and structures in the water (a track passing within 6 m of one costs more, one within 4 m is a hazard: fix round), and the starting line before the gun.
- **Marks:** the AI approaches on the tack that leaves the mark on the required side (starboard for a port rounding). It aims at a point one rounding radius beside the mark, then follows a circle round it until the judge credits the rounding. It leaves the mark astern before turning for the next one.
  - It does not tack within two rounding radii of the mark: it stalls there.
  - Close to the mark, if a shift has put it below its layline, it tacks away and comes back.
- **Start:** each boat holds near its own starting slot (rows 60, 95, 130 m behind the line) with the sails eased. Slots are only placed in clear water: deep enough, outside the moorings, and (since the fix round) at least 12 m from any pier or structure in the water. It then makes a timed run: to an approach point 25 m below its spot on the line, then close-hauled to the line. It eases the main to arrive on time, a few seconds after the signal (skill).
  - **Spots:** they follow the slots' order along the line and stay well inside its ends.
  - **Over early:** the AI returns. If it ends up on the course side without starting (for example round the end of the line), it goes back behind the line.
- **Penalties:** the AI turns when no boat is within 15 m or closing to within 12 m, and no mark is near.
- **After finishing, or when disqualified:** the AI sails about 150 m beyond the finishing line, to a spot it picks once: in water deep enough, outside the mooring areas, at least 20 m from any pier or structure, and reachable in a straight line that keeps 12 m clear of them (fix round). There it keeps out of the way.

### Collision avoidance (5 times a second)

Candidate headings, every 10° (then refined to 5°), plus "slow down", are each simulated for 12 s with a kinematic model:
- the turn rate is deliberately brisk (it tested better than the measured rate; see §6);
- speed eases towards the polar speed and nearly stops through head to wind;
- leeway and current are included.

Other boats are extrapolated two ways: holding course, and continuing their present turn. The closer of the two counts.

**Who keeps clear:**
- by the simplified rules (or always, while tacking or gybing, or when out of the race);
- a moving boat always keeps clear of a stopped one (rule 14), and a fixed tie-break settles two stopped boats.

| Role | Wants to stay this far apart (centre to centre) | Looks ahead |
|---|---|---|
| Keeping clear | 16 m (18 m while tacking or gybing) | 12 s |
| Right of way (rule 14) | 10 m | 7 s |

**Scoring:**
- **Clearance:** from marks (rounding: radius + 4 m; others + 7 m; the line ends + 9 m, weighted more heavily), ferries, shallow water, mooring areas and boundaries.
- **Costs:** deviation from the tactical heading, manoeuvres, and a small preference for the escape chosen last time (to commit to it).
- **No real risk:** the tactical heading stands.

**Pinned by another boat:** if avoidance has held the boat more than 60° off its course for 30 s, it lets the other boats go ahead. For example, a boat to windward of a boat it must pass astern of, both sailing on side by side.
- **How:** it holds its heading with the sails fully eased, for at most 25 s.
- **Safety:** only while the slowed track carries no real risk.
- **Ends:** as soon as its own course is clear of boats.

**Tacks and gybes:**
- **Traffic:** they wait for traffic for at most 20 s, and only if clearly riskier than carrying on.
- **Speed:** they wait until the boat has way on.
- **Commitment:** once past head to wind the boat completes the turn.

### Collision reflex (20 times a second)

Each hull is two circles. If contact with a boat or mark is predicted within 2.5 s on the present plan, the reflex picks hard port, hard starboard or straight on (whichever keeps the most clearance) and eases the sheets. This holds whoever has right of way (rule 14).

- **Turn rate in the reflex:** this check uses the measured rate, about 5.3°/s per m/s of speed after the rudder moves.

### Steering and sheets (every 10 ms step)

- **Helm:** PD on heading or on true wind angle.
- **Sheets:** the auto-trim assist, with the main eased beyond the heel limit or on request (to slow down).
- **Irons:** the AI recovers with the main eased, steering reversed when going astern.

### Skill (seeded per boat, E)

The skill level (club, good, expert) sets:
- the shift threshold and overstand;
- how late it aims to start;
- the steering bias;
- the minimum time between tactical tacks;
- the rounding radius;
- the helm gains.

It never changes the physics.

## 5. In the app

**Scenario → Course and start → Fleet.** Choose 0–20 AI boats, their level, and the preparatory flag.
- **Line length:** practice start lines are 2.5 boat lengths per boat, at least 100 m.
- **Your start:** with a fleet you start in the first slot; alone, 100 m behind the line as before.

**Race panel:**
- the flags shown, as text chips: class, P, U, black, X, First Substitute;
- your place in the fleet;
- penalty turns owed, with how to take them;
- your own events (the start, each rounding, the finish); the fleet's incidents and penalties are listed in the results (18 Nov 2026);
- Results and Retire buttons.

**Results:**
- **Low points:** results are scored by low points. They open by themselves when you finish (provisional while boats are still racing; 18 Nov 2026) and again when the committee closes the race.
- **Your place first:** your place in large figures with the gaps to the boats either side, and your place at the start and at each mark, above the table.

**3D view and minimap:** the AI boats are shown in their hull colours with sail-number labels. Sail numbers ("AI01" …) are invented.

### The race display, tactical aids and the finish (18 Nov 2026)

- **At a glance** (`src/ui/RaceGlance.tsx`): a large countdown at the top centre for the last minute; an arrow at the screen's edge to the race's target when it is out of view (the starting line, then the next mark, then the finishing line; `SimController.raceTarget`, placed by `src/app/edgePointer.ts`); on a phone the race panel as one line, opened by a tap.
- **Race aids** (`src/app/raceAids.ts`; on at the Learn and Club levels, off at Expert, one setting): the laylines to the next mark on a beat or a run, at the model polar's best VMG angle in the wind at the boat (solid green starboard, dashed red port; no allowance for leeway or the stream, E), drawn on the water (`src/render/course.ts`) and on the minimap; and "lifted", "headed" or "steady" sailing upwind, from the wind's direction against its 90 s mean (the coach's mean; under 3° is steady, E).
- **The minimap in a race** (`src/app/courseFit.ts`, `src/ui/courseMap.ts`): the whole course fitted into the map by default, the legs with the way round, the next mark ringed.
- **The finish** (`src/app/raceStory.ts`, `src/ui/ResultsPanel.tsx`): your place large, the gaps to the boats either side, your place at the start and at each mark (from each boat's judge), then the table, the incidents and penalties, and the standing note that the rules are simplified.
- **The race from above** (`src/app/fleetTrack.ts`, `src/ui/RaceReplay.tsx`): every boat's position kept once a second during the race, shown in the debrief as tracks over the course with play, pause and a time slider. A record, not a re-simulation.

## 6. Acceptance and how it was measured

- **Clean-run criterion:** AI boats complete a practice course without grounding or collisions in at least 95% of 100 seeded runs.
  - **Command:** `npm run ai:trials` (`tools/ai-trials.ts`, `src/sim/race/trial.ts`) runs 100 seeds in parallel processes.
  - **Each seed:** 5 AI boats, a one-lap windward–leeward or triangle in the Start Bay practice area, wind 6–16 kn from any direction, moderate or shifty gusts, and a 5-minute starting sequence.
  - **A run is clean only if:** every boat finishes; no boat touches another boat, a mark, the committee boat, a moored boat or a ferry; no boat touches the bottom; and no boundary is crossed. **Touching a mark counts as a failure here**, a stricter reading than "collision".
  - The report (`out/ai-trials.json`) lists every contact with its time.
  - **Results (23 Oct 2026):** 97 of 100 runs clean (seeds 1–100), and 97 of 100 on seeds 101–200, which were never used for tuning (`npm run ai:trials -- --first 101`). Details in [PHASE5_REPORT.md](PHASE5_REPORT.md).
- **On the river (fix round, 29 Oct 2026):** `npm run ai:trials -- --river --runs 20 --boats 5` sails the Range sausage with a 1.5 kn flood and wind 6–14 kn. 15 of 20 runs were clean and 96% of boats finished, with no groundings and no contact with any structure. The failures were:
  - boat-on-boat contacts;
  - mark touches;
  - pontoon contacts, including one boat over the line early that could not beat back against the stream in 7 kn and lay pinned against the mid-river pontoons.

  The river is below the Start Bay standard; see OUTSTANDING_ISSUES 93.
- **Larger fleets:** same code, other seeds (`--boats 10`, `--boats 20`). 77% of 30 ten-boat races and 40% of 10 twenty-boat races are clean.
  - With 10 boats the contacts are mostly port–starboard around the start.
  - With 20 boats they come during the race, at crossings and roundings (no mark-room).
  - See issue 42.
- **Package F (21 Nov 2026), seeds 101–200, never used for tuning:** 10 boats, 79 → 81 of 100 clean (contacts 42 →
  26; short of the 90% aimed for); 5 boats, 92 → 98 of 100 (contacts 13 → 2); river (20 races, 5 boats), 15 → 16 of 20 (contacts 9 → 3, boats finishing 95% → 99%). The changes are in
  "The AI in big fleets" below; the trials, the tuning runs and what is left in
  [NEXT_ROUND_REPORT.md](NEXT_ROUND_REPORT.md) §F.
- **Review Package 1 (3 Nov 2026).** The committee boat became her drawn hull (10.82 m, lying to the stream or the wind) instead of a 2.5 m circle. Trials were re-run, with a same-day baseline from the commit before the change (`dd7d16c`), because results had drifted since 23 Oct:
  - **Start Bay, seeds 1–100:**
    - baseline 91 of 100 clean;
    - after Package 1, 92 of 100, with no committee-boat contact.
    - **Both are below the 95% criterion.** The drop from 97% predates this package (issue 121). The failures are port–starboard crossings mid-race and two windward-mark touches.
  - **River, 20 runs:**
    - baseline 15 of 20 clean;
    - with the real-size committee boat and no AI change, 12 of 20. Five runs touched her: boats crawling against the stream after finishing, and boats manoeuvring near the line's end before the start, were set onto her bow.
    - Two AI changes brought it back to 15 of 20 (the remaining failures are boat–boat contacts, a top-mark touch, one grounding, and two committee-boat touches before a start):
      - on the way to its waiting spot, an AI boat keeps full power when a stream runs (more than 0.2 m/s);
      - its last-moment reflex keeps 0.75 m more room round the committee boat.
- **Criterion 12 (performance with AI):** `npm run perf`.
  - **Physics only:** 21 boats on the River Dart, 0.80 ms mean and 1.98 ms p99 per 1/60 s frame.
  - **Full race:** 1 user + 20 AI boats, including the AI and race logic, 1.7 ms mean and about 5 ms p99.
  - See the report.
- **Why the turn model is brisk:** using the measured turn rate in the avoidance search was tried. Clean runs fell from 88% to 30% on the same 40 seeds: when every escape looks equally late, the boat holds on into trouble. The brisk model starts avoidance earlier and further; the reflex, which does use the measured rate, handles the last 2.5 s.


## Simplified rule 18, mark-room (package F, 21 Nov 2026)

**Simplified, not authoritative.** From secondary copies of the 2025–2028 rules quoted in web-search excerpts (SOURCES
RR11; the World Sailing PDF could not be fetched, issue 32). `src/sim/race/markRoom.ts`, tested in
`tests/sim/markRoom.test.ts`.

- **The zone**: three hull lengths of the boat nearer the mark (17.4 m for a Squib), to any part of her hull.
- **When it applies**: boats bound for the same mark on the same leg, to leave on the same side, at least one in the
  zone; not between boats on opposite tacks both beating (within 80° of the true wind, E), nor between a boat
  approaching a mark and one leaving it (bound for different marks).
- **Who must give mark-room**: decided when the first of the two reaches the zone (18.2(a)): if they are overlapped
  (the definition's overlap, on opposite tacks too), the outside boat (the one farther from the mark); if not, the boat
  that has not reached the zone.
- **Until**: the entitled boat leaves the zone, passes head to wind, or has rounded (bound for the next mark).
- **At a contact while it lasts** (fixes of 21 Nov 2026, §2.2): **advisory by default.** Rule 18's penalties are behind
  a switch, `markRoomPenalties` (Settings → Advanced), **off** until the club has reviewed the rule. Off: the contact is
  ruled and penalised under rules 10–13, as before package F, and the incident and the protest room say "Rule 18
  (simplified, advisory): X should have given mark-room. No penalty applied until the club has reviewed this rule". On:
  the boat that owed mark-room is at fault under rule 18.2 (a Two-Turns Penalty, as for rules 10–13) and the entitled
  boat is not blamed. A race's recording carries the setting it was sailed with, so its replay rules the same way. The
  AI keeps clear of a boat it owes mark-room either way.
- **Not judged**: how much room was needed (the definition of mark-room), 18.2(c) (overlaps after 18.2(a) ends),
  18.2(d) (an inside overlap from clear astern or by tacking that the outside boat could not answer), 18.2(e), 18.3
  (tacking in the zone), 18.4 (gybing), exoneration (rule 43, formerly rule 21), and gate marks beyond taking the nearer mark.

## The AI in big fleets (package F, 21 Nov 2026)

What made 10-boat AI races collide, found by replaying the contacts of the trials, and what changed
(`src/sim/ai/skipper.ts`, `src/sim/race/session.ts`; each with a test in `tests/sim/aiFleet.test.ts` that fails
without it). Thresholds marked E are estimates.

- **Start spots.** Each boat's spot on the line was its line fraction clamped into the usable part of the line, so the
  boats nearest each end were sent to the same spot (0 m apart, at every fleet size). The fractions are now spread over
  the usable part: 8–10 m apart with 10 boats.
- **Waiting places** (fleets of three or more). The boats waited at their starting slots, 17.6 m apart in a row of
  seven, while each wanders up to 30 m from its place as it drifts. They now wait in the order of their slots over three
  staggered rows 60, 95 and 130 m behind the line, at least about 37 m apart; a place that is not clear water keeps the
  slot. One or two boats wait at their slots as before.
- **Room for boats side by side.** The avoidance asked 16 m of a boat keeping clear of any other, whatever the
  geometry, so on a crowded line the windward boat was always "avoiding". Tracks that have held their distance so far
  (side by side, not closing) now need half the room; once they close at any point, the full room (E: halved, and
  "closing" above 0.8 m/s).
- **Marks and the stern.** The avoidance kept marks clear of the hull's centre only: a boat turning away from a mark
  close by swung her stern onto it (most windward-mark touches). The bow and the stern are now kept clear too.
- **Not onto a dead run.** Avoidance could pick a heading within 5° of dead downwind, where the boom can go either
  side, so a boat's tack (and who had right of way) flipped back and forth. It no longer does (E: 5°).
- **Mark-room.** At a mark, the boat owing mark-room under the simplified rule 18 keeps clear, as the judge rules it.
- **Finished boats.** A boat out of the race keeps clear of one still racing; between two out of the race both used to
  keep clear, and swerved, sometimes into each other. The rules now decide between them.
- **Locks.** Two boats side by side, each unable to turn away without her stern swinging into the other, could hold
  their collision reflexes for minutes and sail off the course together (in baseline seed 174 two boats locked just
  after the start, one of them not yet started, and neither finished).
  After 5 s (E), away from marks, the boat keeping clear lets her sails go to drop back and the other keeps hers
  drawing.
- **Tried and dropped** (measured on the tuning seeds, no gain): a later reflex for the boat with right of way; a
  near-hard limit round marks measured at the hull's centre (more windward-mark touches).
