# Coaching messages: inventory and evidence basis

Design handover of 23 Nov 2026, item 5 ("Make coaching explanations match the evidence"). Every message the
simulator gives about how you sailed, where it comes from, what it is measured from, and when it names a cause.

**Rule (from 23 Nov 2026):** an observation states what was measured. A specific **cause** is given only when its
preconditions were recorded in the attempt or race; otherwise there is no cause, and the action is a **controlled
retry** (change one thing, compare the same measurement). Tactical comparisons are bounded to "this exercise, this
model"; a geometrically favoured start end is an observation, not a verdict. Thresholds are the simulator's own (E),
provisional until an instructor has reviewed them.

Not yet done (needs people): instructor review of worked examples, and a check that learners read the messages as
intended (see docs/HANDOVER_23NOV_REPORT.md, item 5).

## Exercise "Trim, tack and recover": post-attempt review (`src/app/exercises/tackRecover.ts`)

Each item carries `basis` (tests/sim/coachingBasis.test.ts checks that every item has one).

| id | Observation (measured) | Cause shown only when | Otherwise |
|---|---|---|---|
| skipped-* | a step was skipped | (none) | |
| gybed | the boat gybed before the tack | always: the sails crossed with TWA > 90° (that is how a gybe is detected) | |
| irons | stopped head to wind ≥ `ironsS` | the turn paused ≥ 1 s (heading changing < 2°/s, TWA < 40°) | retry: build full speed first, compare |
| big-loss | speed fell from X to Y kn | in irons recorded; or tack time > `slowTackS`; or a pause ≥ 1 s | "Nothing recorded explains it": change one thing, compare the slowest speed |
| slow-tack | the tack took X s (model's own ≈ 8.6 s, unchecked) | a pause ≥ 1 s; or the measured mean turn rate (°/s) | retry: hold the helm over until the sails fill, compare the time |
| overshoot | bore away to TWA X° after the tack | (no cause: the observation is the measurement) | |
| trim-main / trim-jib | the sail not drawing for X s | ≥ 60 % of that time in the close-hauled band (the sheet); or overshoot recorded (the steering) | no cause (records before 23 Nov have no on-course time) |
| slow-recover | course and speed back after X s | pinching measured ≥ 3 s (TWA under the band with speed still low); or a sail off > 4 s; or overshoot | retry: bear away 5° for 10 s, then head up, compare |
| clean | tack time, speeds, recovery time | (none) | |

Removed (23 Nov 2026): "Likely cause: the helm was not held over long enough" (the helm is not recorded), "a slow
turn, or the boat stopped head to wind" (two guesses), "the turn was not stopped as the sails filled" (restated the
observation), "pointing high … or sheets not trimmed" (now one or the other, when measured).

## Exercise "Wind shift": post-attempt review (`src/app/exercises/windShift.ts`)

| id | Basis | Bounded how |
|---|---|---|
| decision | when you tacked after the shift began (track); the two model demonstrations' times from the same start | the action is a comparison to try next attempt, "with this shift, in this model"; no general rule |
| prediction | your prediction and the decision recorded | |
| outcome | time to the mark, tacks (track), against the demonstration of the same decision | "the difference is in how the beat was sailed … this compares one attempt with one model run" (was: "came from sailing the boat, not from the decision") |
| timeout | the time limit | |

## Race debrief (`src/app/coach.ts`, `RaceCoach.debrief`)

| Area | Basis | Cause / advice shown when |
|---|---|---|
| Start | distance behind the line and speed at the gun; OCS | advice follows the measured distance and speed |
| Start (line bias) | the line's angle to the wind (`lineBias`) | always verdict "ok", worded as geometry only: "clear air, other boats and the first shift decide whether it pays" (was: praised or marked "work") |
| Upwind | VMG against the model polar (E) | heel past 30° > 25 % of the beat; or main luffing/stalled > 25 %; otherwise "the coach did not record why: compare your angle and speed with the target" (was: always "keep the boat flat, sail the target angle and avoid pinching") |
| Upwind (headers) | time on a header ≥ 8° | advice bounded: "usually pays; it depends on the shifts and the course" |
| Upwind (shifts praise) | header time low *and* shifts present (≥ 10 % of the beat) | |
| Downwind | VMG against the model polar, with or without the spinnaker | target angle from the polar |
| Boat handling | mean speed lost in tacks and gybes | |
| Boat handling (trim) | main luffing or stalled > 20 s | |
| Heavy air | time heeled past 30°, and how much with the sails flattened | |
| Rules | incidents (simplified judging, not an adjudication) | |

## Live coach calls (`src/app/coach.ts`, `RaceCoach.update`)

| id | Basis |
|---|---|
| one-minute, build-speed | start sequence time |
| ocs | over the line at the start signal |
| slow-tack | speed before and lowest in the manoeuvre ("try … and compare"; was "turn more smoothly") |
| overpowered, overpowered-flat | heel angle, flattener setting |
| weather-helm | rudder angle |
| power-up | wind speed and flattener setting |
| luffing, stalled | main sail state |
| header | wind shift against the leg's mean ("unless you are near the layline or someone is in the way") |
| layline | mark bearing against the model's close-hauled angle |
| gust-run | wind speed rise on a run |
| penalty | penalty owed |

## Free-sailing debrief notes (`src/app/sailLog.ts`, `debriefNotes`)

| id | Basis | Cause |
|---|---|---|
| ocs | over the line at the gun | none (was a guess about the last seconds) |
| late-start | seconds after the gun; distance at the gun when known (in the observation) | none |
| tacks, gybes | the time each cost (the summary does not record why) | none (were guesses); the action is a comparison to try |
