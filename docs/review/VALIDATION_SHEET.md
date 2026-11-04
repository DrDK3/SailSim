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

## D. Record

| Field | Value |
|---|---|
| Date | |
| Build (commit hash) | |
| Sailor (name or "anonymous") | |
| Interviewer | |
| Scenarios sailed | |
| Answers stored at | `docs/validation/<date>-<sailor>.md` |
