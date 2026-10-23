# Racing: the fleet, the race committee, the rules subset and the AI

Phase 5 adds racing against AI Squibs. This page describes what is simulated, what each part is based on and its limits. **The racing-rules logic is a simplified subset, not an authoritative adjudication**: it holds no protests or hearings and leaves many rules out.

Sources are in [SOURCES.md](SOURCES.md) (RR1–RR9). The 2025–2028 rulebook PDF could not be downloaded from this environment (network policy), so the wording was checked against secondary copies quoted by web search (23 Oct 2026). The **club's sailing instructions are not available** (MISSING_INFORMATION A2), so every choice they would make is a labelled default.

## 1. The fleet and contact (`src/sim/race/fleet.ts`, `hull.ts`)

All boats share one environment, stepped once per 10 ms tick, and sail with the same physics (`Simulation`). Each boat is a convex hull outline: the same estimated deck plan as the 3D model, 5.79 m × 1.87 m.

| Contact with | Model | Coefficients |
|---|---|---|
| Another boat | Overlap by the separating-axis test. Normal force k·depth + c·closing speed (never pulling), Coulomb friction μ = 0.3, equal and opposite, at the contact point (gives yaw) | k = 2×10⁵ N/m, c = 5×10³ N s/m (E) |
| Committee boat, navigation buoy, fixed mark | Fixed circle; same law | as above (E) |
| Inflatable mark, pin | Fixed circle, softer | k = 3×10⁴ N/m, c = 2×10³ N s/m (E) |
| Moored boat | Box l × l/3, lying to the stream (or wind) downstream of its buoy, as drawn | hard (E) |
| Ferry | Box on its timetabled track, moving | hard (E) |

**How the forces are applied:** they are computed from the states at the start of the step and held over it, so the result does not depend on the order of the boats and runs are deterministic. They act in the horizontal plane only: there is no roll from contact, no damage and no capsize. Marks do not move.

**Test:** in a 3.7 m/s port–starboard collision, the hulls overlap by at most 14 cm, and the boats push apart (`tests/sim/race.test.ts`).

## 2. Race committee (`src/sim/race/committee.ts`)

| Item | What the simulator does | Basis |
|---|---|---|
| Starting sequence | Warning 5 min: class flag, one sound. Preparatory 4 min: P, U or black flag, one sound. One minute: preparatory flag down, one long sound. Start: class flag down. Times from the visual signals. Also a 3-minute and a 1-minute practice sequence | Rule 26 (default 5-4-1-0; SIs may change it) |
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
- **Notes added, not judged:**
  - rule 14 for the right-of-way boat;
  - rule 15 when right of way changed less than 5 s before contact;
  - rule 16 when the right-of-way boat turned more than 15° in the 3 s before.
- **Touching a mark of the current leg** (a start mark before starting, a finishing mark) while racing: rule 31, **One-Turn Penalty**.
- **Hitting a moored boat or a ferry:** recorded as a collision outside the racing-rules subset.

### Penalty turns

Rule 44.2: each turn is 360° in one direction and includes one tack and one gybe. Turning back by more than 45° restarts the turn in progress. "Promptly" and "well clear" are not checked.

### Results

An untaken penalty is shown in the results ("no penalty taken"). There is no protest: the score is not changed.

### Not implemented

- Rules 15 and 16 as adjudication.
- Rules 17–24, including 18 (mark-room) and 19–20 (obstructions, hailing). The AI keeps clear of boats at marks, but no mark-room is awarded.
- Exoneration.
- The scoring penalty (44.3).
- Protests, hearings and redress.

## 4. AI skippers (`src/sim/ai/`)

The AI sails the boat through the same controls as the user: helm, the auto-trim assist and the crew assist. It never sets the boat's state.

### Target speeds (`polarData.ts`, generated by `npm run ai:polar`)

These are the **model's** own steady speeds with the AI's controls. They are model output from estimated coefficients, not measured Squib data.

- **Sheet handling:** the AI eases the main beyond 24° of heel, as a crew dumps the main in a gust (E). Without this the model broaches when reaching in 20 kn or more.
- **Staleness check:** a test fails if the boat parameters change without regenerating the table.

### Tactics (5 times a second)

- **Upwind and downwind:** best-VMG angles from the polar, with leeway and current in the track predictions.
  - **Lay lines:** the AI tacks or gybes when the mark (or the point beside it) can be laid, plus a skill-dependent overstand.
  - **Shifts:** it sails the tack that points nearer the mark, with a hysteresis of twice the skill's shift threshold.
  - **Cone:** it comes back if it strays too far from the line to the mark.
  - **Hazards:** it tacks away from shallow water, boundaries, mooring areas, and the starting line before the gun.
- **Marks:** the AI approaches on the tack that leaves the mark on the required side (starboard for a port rounding). It aims at a point one rounding radius beside the mark, then follows a circle round it until the judge credits the rounding. It leaves the mark astern before turning for the next one.
  - It does not tack within two rounding radii of the mark: it stalls there.
  - Close to the mark, if a shift has put it below its layline, it tacks away and comes back.
- **Start:** each boat holds near its own starting slot (rows 60, 95, 130 m behind the line) with the sails eased. It then makes a timed run: to an approach point 25 m below its spot on the line, then close-hauled to the line. It eases the main to arrive on time, a few seconds after the signal (skill).
  - **Spots:** they follow the slots' order along the line and stay well inside its ends.
  - **Over early:** the AI returns. If it ends up on the course side without starting (for example round the end of the line), it goes back behind the line.
- **Penalties:** the AI turns when no boat is within 15 m or closing to within 12 m, and no mark is near.
- **After finishing, or when disqualified:** the AI sails 150 m beyond the finishing line and keeps out of the way.

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
- the fleet's events (starts, roundings, incidents, penalties);
- Results and Retire buttons.

**Results:**
- **Low points:** results are scored by low points and open by themselves when the committee closes the race.
- **Live view:** the table is available as soon as you have finished.

**3D view and minimap:** the AI boats are shown in their hull colours with sail-number labels. Sail numbers ("AI01" …) are invented.

## 6. Acceptance and how it was measured

- **Clean-run criterion:** AI boats complete a practice course without grounding or collisions in at least 95% of 100 seeded runs.
  - **Command:** `npm run ai:trials` (`tools/ai-trials.ts`, `src/sim/race/trial.ts`) runs 100 seeds in parallel processes.
  - **Each seed:** 5 AI boats, a one-lap windward–leeward or triangle in the Start Bay practice area, wind 6–16 kn from any direction, moderate or shifty gusts, and a 5-minute starting sequence.
  - **A run is clean only if:** every boat finishes; no boat touches another boat, a mark, the committee boat, a moored boat or a ferry; no boat touches the bottom; and no boundary is crossed. **Touching a mark counts as a failure here**, a stricter reading than "collision".
  - The report (`out/ai-trials.json`) lists every contact with its time.
  - **Results (23 Oct 2026):** 97 of 100 runs clean (seeds 1–100), and 97 of 100 on seeds 101–200, which were never used for tuning (`npm run ai:trials -- --first 101`). Details in [PHASE5_REPORT.md](PHASE5_REPORT.md).
- **Larger fleets:** same code, other seeds (`--boats 10`, `--boats 20`). 77% of 30 ten-boat races and 40% of 10 twenty-boat races are clean.
  - With 10 boats the contacts are mostly port–starboard around the start.
  - With 20 boats they come during the race, at crossings and roundings (no mark-room).
  - See issue 42.
- **Criterion 12 (performance with AI):** `npm run perf`.
  - **Physics only:** 21 boats on the River Dart, 0.80 ms mean and 1.98 ms p99 per 1/60 s frame.
  - **Full race:** 1 user + 20 AI boats, including the AI and race logic, 1.7 ms mean and about 5 ms p99.
  - See the report.
- **Why the turn model is brisk:** using the measured turn rate in the avoidance search was tried. Clean runs fell from 88% to 30% on the same 40 seeds: when every escape looks equally late, the boat holds on into trouble. The brisk model starts avoidance earlier and further; the reflex, which does use the measured rate, handles the last 2.5 s.
