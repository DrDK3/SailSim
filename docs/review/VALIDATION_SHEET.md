# Validation sheet: Squib sailor and RDYC sailor

**This sheet is prepared, not completed. No validation has taken place.** Until a named sailor has answered it, every speed, angle and timing in the simulator is model output from estimated coefficients (evidence level L5), not validated behaviour.

It belongs to [COMPREHENSIVE_REVIEW.md](../COMPREHENSIVE_REVIEW.md) §9.2.

## How to use it

1. **Before the session.** Send this sheet with:
   - a link to the build under test (the commit hash goes on the record);
   - the behaviour-envelope report from Package 1 (`out/envelope.md`).
2. **During the session.** The sailor sails the listed scenarios (the scenario IDs refer to [ACCEPTANCE_SCENARIOS.md](ACCEPTANCE_SCENARIOS.md)) or watches them replayed, then answers.
3. **Answer format.** For each question:
   - **Verdict:** about right / too much / too little / can't say.
   - **By how much:** a number or range if possible, for example "more like 15° than 25°".
   - **Confidence:** 1 = a guess, 2 = fairly sure, 3 = sure, from repeated experience.
   - **Conditions:** the wind, sea state, crew weight and boat variant they are thinking of.
4. **After the session.** Record the answers verbatim in `docs/validation/` with the date, the build hash and the sailor's name (or "anonymous" if they prefer). No coefficient changes without a recorded answer behind it.

**Questions are deliberately open.** Where the simulator has a number, the sailor is shown it *after* giving their own estimate, so the model's number does not anchor them.

---

## A. About the sailor

| # | Question | Answer |
|---|---|---|
| A1 | How many seasons have you sailed Squibs? Helm, crew or both? | |
| A2 | Which boats (sail numbers, builder: Hunter, Parker, Rondar)? Self-draining cockpit? | |
| A3 | Typical crew weight (combined)? | |
| A4 | Where do you mostly sail (the Dart, Start Bay, elsewhere)? | |
| A5 | Have you logged GPS tracks with wind data? Would you share some? | |

## B. Squib sailor: handling and performance

### B1. Upwind

Scenario A-PH-1.

| # | Question | Model (show after) | Verdict / how much / confidence |
|---|---|---|---|
| B1.1 | Close-hauled boat speed in 6, 10, 14 and 18 kn of true wind, flat water? | A-PH-1 table | |
| B1.2 | Heel angle at each of those, with the crew hiking normally? | A-PH-1 table | |
| B1.3 | At what wind speed do you start depowering (and how: kicker, cunningham, traveller, easing)? | Auto-trim eases beyond 24° (AI) | |
| B1.4 | Weather helm: how much tiller angle to hold her straight at 10 and 18 kn? | 1.3° and 5.5° | |
| B1.5 | Tacking angle (track to track over the ground, no current) in 10 kn? | From the envelope | |

### B2. Reaching and running

Scenarios A-PH-2 and A-PH-3.

| # | Question | Model | Verdict / how much / confidence |
|---|---|---|---|
| B2.1 | Beam-reach speed (no spinnaker) in 8, 12 and 16 kn? | A-PH-2 | |
| B2.2 | Running speed without a spinnaker in 10 kn? With one? | 3.9–4.3 kn without (no spinnaker in the model) | |
| B2.3 | Does she surf or plane at all? From what wind speed and angle? | Not modelled as such | |

### B3. Manoeuvres

Scenarios A-PH-4 … A-PH-8 and A-PH-11.

| # | Question | Model | Verdict / how much / confidence |
|---|---|---|---|
| B3.1 | Tack in 10 kn: how long from close-hauled to close-hauled, and how much speed is lost? | 8.6 s; 4.8 → 2.5 kn | |
| B3.2 | How many boat lengths to windward does a tack cost in 6, 10 and 15 kn? | 2.4, 2.0 and 1.7 lengths | |
| B3.3 | Gybe in 10 kn and 18 kn: time, and speed lost? | 5.8 s / 4.4 s | |
| B3.4 | Turning circle with the tiller hard over at 3 kn? | 17 m (3 lengths) | |
| B3.5 | From 5 kn, sails let fly into wind: how far does she carry way (shooting a mooring)? | About 60 m to 1 kn | |
| B3.6 | From 3 kn on a close reach in 10 kn, how long to reach full speed? | 10 s to 90% | |
| B3.7 | In irons: what do you do, and how long does it take? | The model has no "back the jib" yet | |

### B4. Contact and damage

These are your judgement of consequences (L4). No measured data exists. The answers set the first damage thresholds (§5.4 of the review).

| # | Question | Verdict / confidence |
|---|---|---|
| B4.1 | Squib bow into another Squib's side at 2 kn, 4 kn and 6 kn: what damage do you expect (scuff, gelcoat crack, structural crack, hole)? | |
| B4.2 | Squib bow square onto a timber pontoon at 3 kn and 6 kn? | |
| B4.3 | Two Squibs head-on at a 6 kn and a 12 kn closing speed? | |
| B4.4 | Grounding on mud or sand at 4 kn: keel damage? Is the keel–hull joint a weak point? | |
| B4.5 | Which collisions would end your race (you would retire), and which would end the boat's day? | |
| B4.6 | A crack at or below the waterline: how fast would she take water, and could a crew keep up with a bucket or pump? | |

### B5. Heavy weather

Scenarios A-PH-12 and A-PH-13.

| # | Question | Model | Verdict / how much / confidence |
|---|---|---|---|
| B5.1 | A sudden gust from 10 to 16 kn close-hauled: how far does she heel and how fast? What do you do first? | From the envelope | |
| B5.2 | Reaching in 20 kn or more without easing: does she broach? At what heel? | The model broaches without easing (AI eases beyond 24°) | |
| B5.3 | How much water comes into the cockpit, and when? (Self-draining and older boats separately.) | From the envelope | |
| B5.4 | Have you seen a Squib knocked down? What happened to the sheets and the boat? | Crew releases the sheets beyond 50° | |

### B6. Spinnaker

Not yet modelled. These answers define it.

| # | Question | Answer |
|---|---|---|
| B6.1 | Hoist time, from bearing away at the windward mark to a filled spinnaker, with a good crew? A club crew? | |
| B6.2 | Drop time before a leeward mark? | |
| B6.3 | Spinnaker gybe: time and typical speed loss? | |
| B6.4 | In what wind do club Squibs stop flying the spinnaker? | |
| B6.5 | Where does the broach risk start with the spinnaker up (wind and angle)? | |

### B7. Controls and crew

| # | Question | Answer |
|---|---|---|
| B7.1 | Which controls does the helm handle, and which the crew? | |
| B7.2 | Which sail controls matter most in a race (kicker, cunningham, outhaul, jib car, backstay)? Which can be left out of a simulator without losing the feel? | |
| B7.3 | How much does crew position (fore and aft, in and out) matter, and when? | |

### B8. Overall

| # | Question | Answer |
|---|---|---|
| B8.1 | After 20 minutes: what feels most wrong? | |
| B8.2 | What feels right? | |
| B8.3 | Would you use it to practise starts, tactics or boat handling? What would stop you? | |

---

## C. RDYC sailor: place, conditions and racing

**Nothing here is to be invented.** Where the answer is a club document, please supply the document rather than recall it.

### C1. Geography and landmarks

| # | Question | Answer |
|---|---|---|
| C1.1 | Sailing from the RDYC pontoon down to the castles and back: is anything missing, misplaced or wrongly sized that a sailor would use to navigate or race? | |
| C1.2 | Are the trots and moorings in the right areas? Which mooring rows matter for racing? | |
| C1.3 | Pontoons and piers: any wrong in position, length or height? | |

### C2. Depths and dangers

| # | Question | Answer |
|---|---|---|
| C2.1 | Where do boats actually go aground in the harbour? Do the simulator's shallow areas match? (Shown: the depth layer, labelled PROVISIONAL.) | |
| C2.2 | Which rocks and banks matter for racing (for example near the castles, Kingswear and the entrance)? | |
| C2.3 | Would the club or DHNA share survey depths? | |

### C3. Wind in the river

| # | Question | Answer |
|---|---|---|
| C3.1 | In a south-westerly, a westerly and a north-easterly: where are the wind holes and the bends in the wind along the course area? | |
| C3.2 | How much more shifty is the river than Start Bay? | |
| C3.3 | Does the simulator's shelter look right? (Shown: the "Land effect" layer, labelled estimated.) | |

### C4. Tidal streams

Answer from experience. Please do not adjust your answer to the simulator.

| # | Question | Answer |
|---|---|---|
| C4.1 | Relative to local high water, when does the stream turn in the harbour off the club? At the entrance? In Start Bay? | |
| C4.2 | Is the flood or the ebb stronger, and by how much? Springs and neaps? | |
| C4.3 | Where are the eddies and the slack areas along the banks that racers use? | |
| C4.4 | How does river flow after rain change the ebb? | |

### C5. Racing practice

Documents please.

| # | Question | Answer / document |
|---|---|---|
| C5.1 | ~~The 2026 sailing instructions and course cards~~ Received (Sailing Programme 2026). Are there amendments on the online notice board since printing? | |
| C5.2 | Received for the fixed marks. Still needed: the two white flagstaffs at Blackstone Point (the BP line), the Club Line's outermost downriver pontoon pile, and where T, T1, T2 and MS1 are usually laid. Is "Gate H" set with the committee boat where she started? | |
| C5.3 | Starting: line between which marks, the sequence (5-4-1-0?), sound signals, recalls | |
| C5.4 | The committee boat: where SAMARITAN lies on the line, how she is anchored, which end is "the boat end" | |
| C5.5 | Any club rules about ferries, the chain ferries and commercial traffic during races | |

### C6. Traffic

| # | Question | Answer |
|---|---|---|
| C6.1 | Lower and Higher Ferry timings on a race evening? Do racers ever have to give way? | |
| C6.2 | Other traffic that matters (Kingswear Castle, trip boats, tenders)? | |

### C7. Live conditions

| # | Question | Answer |
|---|---|---|
| C7.1 | Compare the simulator's "now" wind with what you see from the club, on three or four occasions. Record the date and time, the app's wind and your estimate. | |
| C7.2 | Is there a club or harbour anemometer whose readings could be shared? | |

---

## T. Training exercises: learners, instructors and Squib sailors (training slice)

**Prepared, not completed. No learner, instructor or sailor has tried the exercises yet.** Every threshold, help text and review rule in them is the simulator's draft (content status: draft; thresholds tagged E in `data/exercises/thresholds.json`). Nothing here is a syllabus, an accreditation or a claim that the exercises teach well. See [TRAINING_SLICE_REPORT.md](../TRAINING_SLICE_REPORT.md).

### T1. Who, and how to record it

| Group | Who | What they do | About |
|---|---|---|---|
| Beginners | 3–5 people new to sailing (or nearly) | T2: pre-test, the beginner exercise, post-test, independent attempt, transfer | 45 min each |
| Instructors | 2 RDYC instructors | T3: accept, change or reject each exercise item; watch at least one beginner | 60 min |
| Squib sailors | 2 people who sail Squibs | T4: the B-section questions the exercises lean on, and the tactical exercise | 40 min |

- **Consent.** Written consent before the session, kept by the club, not in the repository. Anyone under 18 needs a parent's or guardian's consent too. Learners are recorded by code only (B1–B5), never by name.
- **Build.** Note the commit hash (Settings → All settings → About, or the replay file's `build`).
- **Records.** One file per person in `docs/validation/<date>-<group>-<code>.md` with the date, build hash and that consent was given (yes/no, not the form). Attach the learner's exported records (`squib-exercise-records.json`, "Save records (file)") and, where useful, replay files of attempts ("Save this attempt (replay)").
- **No coefficient or threshold changes without a recorded answer behind them**, as for sections B and C.

### T2. Beginners

1. **Pre-test (5 min, spoken or written, no sim).** Q1 Which way can a boat not sail? Q2 What does a luffing sail look like, and what does it tell you? Q3 What are the steps of a tack? Q4 After a tack, what do you do first? Q5 If the boat is slow after a tack, what do you try? Score each 0/1/2 (none, partly, right).
2. **Warm-up and attempts 1–3 (assisted).** Start the beginner exercise from the lessons list, or the instructor link `?exercise=tack-recover`. The observer says nothing beyond "carry on" unless the learner is stuck for 2 minutes.
3. **Attempt 4 (on your own: both sheets, no overlay, help only on request).** The app records whether it was independent.
4. **Post-test (5 min).** The same five questions, reworded (for example Q2: "The front of the jib flaps: what is happening and what do you do?").
5. **Independent performance.** Repeat the exercise once more, from the start, on their own: the result card's "Independent attempts" line.
6. **Transfer.** Without help: lesson 4 (Tacking and gybing), or the beginner exercise with the wind changed to 14 kn by the instructor (a thresholds file with `tackRecover.windKn` 14). Record completion and the tack's slowest speed.

**Measures** (from the result card and records file unless stated): attempts complete (assisted / independent); tack time, slowest speed as a share of the speed going in, time back on course and speed; help shown by level (Look / Why / Try) and asked for; restarts; skipped steps; in-irons episodes; pre- and post-test scores; time on task (observer); confidence 1–5 before and after (asked); "would you do this again?" (asked).

### T3. Instructors: accept, change or reject

For each item: **Accept / Change (to what) / Reject**, and why. Items are listed in the order a learner meets them.

| # | Item | Draft (E) | Verdict and reason |
|---|---|---|---|
| T3.1 | Close-hauled band and speed (both exercises) | TWA 38–55° at 2.5 kn or more, held 5 s (issue 47) | |
| T3.2 | The cue: head up to the luff, back to drawing, held 2 s | as built | |
| T3.3 | A tack counted from TWA under 35° to TWA 35–90° on the other tack above 1 kn | as lesson 4 | |
| T3.4 | Recovery: course and 80% of the speed going in, held 3 s; "slow" after 25 s | as built | |
| T3.5 | In irons: under 0.8 kn with the bow within 30° of the wind for 6 s | as built | |
| T3.6 | A "slow tack" over 15 s; a "big loss" under 40% of the speed going in | as built | |
| T3.7 | Help timing: Look after 10 s stuck, Why after 20 s, Try after 30 s | as built | |
| T3.8 | Each help text (Look / Why / Try) for: too low, too high, slow, sheet not drawing, find the luff, back to drawing, start the tack, in irons, headed | read them on the card | |
| T3.9 | Each review rule (observation, likely cause, next time): irons, big loss, slow tack, overshoot, sheet not drawing, slow recovery, clean | read them after an attempt | |
| T3.10 | Assistance falling over four attempts (auto-trim and overlay, then main in hand, then both and help on request) | as built | |
| T3.11 | "Independent" means: no auto-trim on either sail, no overlay, no live help at any time in the attempt (auto-crew allowed) | as built | |
| T3.12 | Wind-shift exercise: a 600 m beat; 15° backing shift after 60 s that returns after 90 s; a 40 s decision window, timed from where the tack begins; help at 8 / 16 / 24 s headed (all E) | as built | |
| T3.13 | Wind-shift review: the decision judged against model demonstrations ("in this model"), apart from the time to the mark | as built | |
| T3.14 | The debrief's notes after any sail: tack cost over 5 s, gybe over 6 s, start over 10 s late (E) | as built | |
| T3.15 | Content status: what must change before an item can be marked "instructor-reviewed"? | all draft | |

### T4. Squib sailors (the B-section questions the exercises lean on)

| # | Question | Model | Verdict / how much / confidence |
|---|---|---|---|
| T4.1 | B1.5: your tacking angle, and the true wind angle you sail close-hauled at in 10 kn (PH-10: the model's best VMG is at 30–38°; the exercise asks for 38–55°) | best VMG 38° in the exploit search | |
| T4.2 | B3.1: a tack in 10 kn: time and speed lost | 8.6 s; 4.8 → 2.5 kn | |
| T4.3 | B3.6: from a tack, how long until full speed again? | 10 s to 90% from 3 kn on a close reach | |
| T4.4 | With the tiller let go on a close reach in 10 kn, does a Squib round up to close-hauled, and how fast? | the model rounds up from TWA 72° to about 45° in about 15 s | |
| T4.5 | Sail the wind-shift exercise: is a 15° shift for 90 s on a 600 m beat a fair test? Would you tack on the header? | tacking on each header was 30 s faster in this model | |

### T5. Negative-learning probes

Each is something the exercises could teach wrongly. Check it on purpose; record what happened.

| # | Risk | How to probe | What would show the problem |
|---|---|---|---|
| T5.1 | UX-8: the bow-direction keys are the opposite of a tiller | After the exercise, ask: "To head up on starboard, which way do you push the tiller?" | Beginners who answer with the key direction |
| T5.2 | PH-10: the model may point too high, so close-hauled feels higher than in a Squib | T4.1; watch whether beginners pinch to TWA 30–35° because the boat still goes | A sailor's tacking angle well above the model's; beginners rewarded for pinching |
| T5.3 | Overlays: reliance on the wind arrows | Compare attempts 1–2 (overlay) with 4 (none); ask "how did you know where the wind was?" | Performance falling with the overlay off; answers naming only the arrows |
| T5.4 | O3: by the lee and stalled (issue 200, fixed) | Show a stalled main on a broad reach (sheet hard in); ask what the status means and what to do | Answers saying "head up" (the old wrong advice) instead of "ease" |
| T5.5 | Auto-trim expectations | Attempts 3–4 (sheets in hand): count reviews with "the main/jib was not drawing for … s" | Learners waiting for the sails to trim themselves |
| T5.6 | "Tack on every header" over-generalised | Ask instructors and sailors: "In a persistent shift, would you still tack on the header?" (in this model a persistent shift gave no gain: report §6) | Learners or the exercise implying it always pays |
| T5.7 | The model's weather helm (T4.4) | Watch whether beginners hold the helm against it all the time | A habit a real Squib would not need |

### T6. What to send back

The completed tables, the records and replay files, and the observer's notes, in `docs/validation/` as above. Results change thresholds, help texts or rules only through a recorded answer (and a note in `docs/OUTSTANDING_ISSUES.md`).

---

## D. Record

| Field | Value |
|---|---|
| Date | |
| Build (commit hash) | |
| Sailor (name or "anonymous") | |
| Interviewer | |
| Scenarios sailed | |
| Answers stored at | `docs/validation/<date>-<sailor>.md` |

## E. Juniors round (17 Nov 2026): feel, cues and social goals

A short protocol for checks that only people can make ([JUNIORS_REPORT.md](../JUNIORS_REPORT.md)). Nothing in this
section has been done yet. Record the results in section D's table, with the date and the build (Help shows it).

### E1. The first five minutes, with juniors

5–10 juniors (with a parent's or guardian's consent), each on their own or a club device, using the build alone.
**Say nothing**; do not help unless they ask twice. For each junior, note:

| | Notes |
|---|---|
| Device (kind, roughly how old) and the device check's result (Settings → Display → Check this device; [procedure](../DEVICE_CHECK.md)) | |
| What they comment on, in their words | |
| Where they get stuck, and for how long | |
| Do they notice the **gusts** (darker water) before one reaches them, without being told? | |
| Do they notice the sails **luffing** (flapping, the sound, the word on the sail panel)? | |
| Do they notice the **tack** feedback (the boom across, the thump, the camera's small settle)? | |
| Do they ask to play again? | |

### E2. The low preset: would you play this?

Show the owner and two or three juniors the **Smooth** and **Balanced** presets side by side (the screenshot sheets in
the report, then the app on a real device). Ask one question: **"Would you play this?"** Note the answer for each
preset, and why. The owner, not the developer, judges whether Smooth "looks good".

### E3. Instructors: do the cues teach the right thing?

An instructor sails the weekly course and a few gusty scenarios. Check for **negative learning**:

- Are gusts on the water **more obvious than on the real river** (so juniors learn to rely on a cue they will not have)?
  The natural look should be readable but not exaggerated. The outlines are a teaching aid (off by default and off in
  races).
- Does anyone **rely on vibration or the overlay**? Turn both off and see whether they still sail as well.
- Is the **acceleration out of a tack too forgiving**? (The physics is unchanged from earlier rounds. Only the sound
  and camera feel were added. Note whether the feel suggests otherwise.)
- Do the telltales behave as on a real jib: the windward ones lifting when pinching or under-trimmed, the leeward ones
  when over-trimmed?

### E4. Social goals, during a trial week with the club table on

| Question | Notes |
|---|---|
| Do juniors understand that ghosts are **recordings** that do not react, and that targets are **model-sailed** (not people)? | |
| Do the weekly course and the club table **motivate without pressure**? (Watch for anxiety about ranking, or for juniors comparing real identities behind the word-list names.) | |
| Did **anything need a person to step in** during the week? (The target is nothing: note every case.) | |
| Do parents find the **plain-language note** ([PARENTS.md](../club-table/PARENTS.md)) clear and acceptable? | |
