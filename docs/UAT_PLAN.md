# User acceptance test plan

A script for the owner (and any club testers) to accept or reject the build. It is about two hours in all; each part can be done on its own.

## Before you start

- **Where.** Use the published site once the `hifi` branch is merged into `main`: the Deploy workflow publishes it to GitHub Pages. Or run it locally with `npm install` then `npm run dev` (README, Quick start).
- **What to use.** A laptop or desktop with a real graphics card and a current Chrome, Edge, Firefox or Safari. Do part 9 on a phone as well.
- **Fill in each row.** Mark it **Pass**, **Fail** or **Note**. For a Fail, write what you did, what you saw and the scenario's start time, and take a screenshot.
- **Saving a run.** Library → **Save replay of this run** saves the whole run as a file. Send it with the report: it plays back exactly what you saw.
- **The judge.** It is a simplified subset of the racing rules, not an authoritative adjudication (RACING.md). Judge it for whether it is useful for training, not as a protest committee would.

| Key | Action |
|---|---|
| A / D | Helm |
| S / W | Ease / trim the main |
| Q / E | Ease / trim the jib |
| C | Change camera |
| U | Sound on / off |
| B | Fly back to the boat |
| P | Pause |
| R | Restart |
| H | Help |

## 1. First run and sailing (15 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 1.1 | Open the app in a fresh browser window | The welcome screen; the River Dart loads in under a minute on a normal connection | |
| 1.2 | Take the tutorial (five minutes) | Each step (steer, trim, tack, gybe, stop) is checked as you sail; the wording is clear to a club sailor | |
| 1.3 | Sail close-hauled, tack, bear away to a run, gybe | Sails fill on the correct side at every angle; the crew move smoothly across in tacks and gybes; the boom crosses in the gybe | |
| 1.4 | Scenario → Boat → Squib type: try the Rondar, the classic and the B3 sails | The classic cockpit keeps water it ships; the types feel slightly different (the differences are estimates) | |
| 1.5 | Scenario → Wind 20 kn, gusty; sail upwind and reach | The boat heels and rounds up in gusts, the auto main eases, Flatten depowers; a knockdown comes back up | |

## 2. The Royal Dart Yacht Club (15 min): **the owner's check against the real building**

Restart with Scenario → Start position **Off RDYC, mid-river**, Start time **15 July 2026 11:00 (UTC)**. Switch to the **Drone** camera (C) and fly round the club.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 2.1 | Look at the club from the river, from the west | Compare with your photographs. The red-brick gable to the river has a canted bay over a gabled porch on white posts and the navy RDYC sign; the round brick turret has a conical slate roof; there is a white balcony on the south side and round the turret; the south wing is white; the roofs are steep slate with tall chimneys | |
| 2.2 | Look along the waterfront | A stone sea wall with a white rail, and the terrace in front with tables, parasols and a marquee; the flagstaff stands in front of the turret, flying the club's ensign (crown over a golden dart) | |
| 2.3 | Fly to the pontoon | A gangway with open rails runs from the terrace down to the pontoon head; dinghies are stored on edge, with a stacked rack carrying the RDYC sign | |
| 2.4 | Look at the neighbours north and south | Red-brick houses with tile roofs to the north; white-rendered houses with slate to the south | |
| 2.5 | Set the start time to 21:00 and restart | The clubhouse windows glow after dark; the ensign is lowered after sunset | |
| 2.6 | **Note anything still wrong** (proportions, colours, missing features) | List it, ideally with a photograph from the same angle | |

## 3. Robotic marks and sponsors (10 min)

Library → **Practice race**, or Race → **Quick race** with 0–5 AI boats.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 3.1 | Fly the drone to each mark | Each turning mark is a robotic mark: an inflatable on twin pontoons with a mast, a GPS dome and an amber light. It lies head to wind and rides the chop | |
| 3.2 | Read the sponsor bands | Each mark carries one of RDYC, Ancaster, Salcombe Gin or Henri Lloyd, in plain type. With four or more marks, each name appears before any repeats | |
| 3.3 | Restart the same race, then pick a different course | The same course shows the same names; another course deals them differently | |
| 3.4 | Touch a mark deliberately | The judge reports a mark touch at about a metre from the mark's centre; a one-turn penalty is offered | |
| 3.5 | **Sponsors' permission** | Confirm whether the three commercial names may appear on a public site (issue 83) | |

## 4. Roads and the towns (15 min)

Use the Drone camera over Dartmouth, then fly low along a street.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 4.1 | From 80–100 m up over Dartmouth and Kingswear | Roads read as roads: dark asphalt with centre dashes and double yellows on the main streets, pale pavements, cars on the carriageways | |
| 4.2 | Fly low (2–5 m) along the embankment and a hillside street | Kerbs, raised paving-flag pavements and gutters; roads cut into the hillside with a bank above and below; nothing sinks into the ground or floats | |
| 4.3 | **Look closely at the edge of a road next to a pavement** | **No white or yellow glitter** along the kerb (fixed this round, but tested only on a software renderer: issue 85) | |
| 4.4 | Watch the cars and the people for a minute | Cars stay on the roads; parked cars sit on the road surface; people walk on pavements and quays | |
| 4.5 | **Compare with your photographs** (photo round): fly round the castle, along South Town and Bayard's Cove, and along the Kingswear shore | Green-teal water, lighter in the shallows; woods down to dark rocks at the harbour mouth; white and strongly painted fronts under grey slate, with gardens between; houses standing on stone quay walls; the castle's square tower, St Petrox limewashed, BRNC's three towers | |
| 4.6 | Sail gently into a quay wall below the houses (South Town or Kingswear) | The boat stops against the wall, as at a pier, rather than running up a slope | |

## 5. River traffic: the paddle steamer, ferries, trains (20 min)

Set the start time to **15 July 2026 10:05 (UTC)**, which is 11:05 local, before the steamer's 11:15 cruise.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 5.1 | Fly to the South Embankment, Dartmouth | **PS Kingswear Castle** lies alongside the Town Jetty, parallel to it and not across it (fixed in the fix round), with passengers aboard: black hull with a gold line, varnished saloons, paddle boxes, buff funnel with a wisp of smoke. Other river boats lie outside her (rafted) | |
| 5.2 | Restart at 10:14 UTC and watch; then restart at 10:35 and at 11:05 UTC (live play runs in real time; only replays speed up) | At 10:15 she leaves; by 10:35 she has been down past the castles and is heading up towards Greenway, smoking from her funnel; by about 11:05 she is coming back to, or lying at, the embankment | |
| 5.3 | Sail into her side, gently | She is solid like the other ferries: the contact pushes your boat away, and a hard one can damage it | |
| 5.4 | Set the date to a Friday (17 July 2026) or to October | She does not sail; out of season she is not there | |
| 5.5 | Find the Totnes river boat (at 10:05 UTC she lies outside the steamer) | It is labelled **MV Cardiff Castle** (a motor vessel; the paddle steamer is the Kingswear Castle). Compare with your photograph: navy hull with a white crest on the bow and a white band at the gunwale, windowed saloon, white bulwark round the upper deck with passengers, wheelhouse forward, tall white mast with flags | |
| 5.5a | Watch the ferries arrive at and leave their landings for a few minutes (any landing) | Each comes alongside the pier, parallel to it; none lies across a pier or on top of another boat at rest | |
| 5.6 | Watch the Lower Ferry, Higher Ferry, passenger ferry and a steam train at Kingswear | The Lower Ferry tug (black hull, cream wheelhouse) swings the float (orange ramp lips, "Do not board" boards) and the two units pass port to port; trains arrive and leave on the timetable | |
| 5.7 | **Livery** | Note any colour or detail of the steamer or the Cardiff Castle that is wrong (both are estimates; E19) | |

## 6. Racing (20 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 6.1 | Quick race, 5 AI boats, Good level, random conditions | The 5-4-1-0 sequence with its flags and a countdown (there are no sound signals); the AI start sensibly and race the course | |
| 6.2 | Start early (OCS) | An individual recall (X flag); you must return | |
| 6.3 | Meet an AI boat port and starboard | The judge's call is shown, labelled as the simplified judge | |
| 6.4 | Finish | Results show elapsed times and any penalties | |
| 6.5 | Coach (More → Race coach) | Tips during the race and a debrief afterwards; the advice is sensible | |
| 6.6 | Race → **River: the Range sausage**, 4 AI boats | The start is in open water in the wide part of the Range, clear of the pontoons; no boat starts beside a building. The Hindostan at Sandquay is drawn as a grey ship, and a boat sailed into her stops as at a pier | |
| 6.7 | Race the river sausage to the finish (or Quick race → River). Then, in a new race, let your boat sail into the bank and stop | The race runs to the end with the ferries and marina boats moving and does not freeze (31 Oct fix). Aground and stopped, the warning says whether the tide will float you off or to press R; the instruments stay inside their panel | |
| 6.8 | On the published site: Race → Where: the river → Conditions: Live now → Start race | The race starts with the live wind. Until the site publishes a live tide (issue 110) the panel says the river has no tidal stream; once it does, the Tide line under All instruments and conditions shows the live tide | |
| 6.9 | Race → the river; Chase view from astern | The Squib's rudder hangs on the transom: its head above the transom, the blade into the water, the tiller forward into the cockpit | |
| 6.10 | Same race: look at the start boat | SAMARITAN: white Southerly with her navy canopy and sail cover, radome on the mast, her name on the bow, the orange flag; lying head to wind | |
| 6.11 | Same race, in the morning light: look across at Noss and Dart Marina | The berthed boats are mostly white with coloured canvas, none drawn black | |

## 7. Conditions and weather (10 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 7.1 | Library → Wind against tide | Short steep waves in the entrance; spray into a classic cockpit | |
| 7.2 | Library → Fog, Rain, Evening | Visibility, rain streaks and sunset light look right; colours are not washed out | |
| 7.3 | Scenario → Tide manual; set a low tide and sail near the edge | The boat grounds where the drying areas are; no start is placed on the mud | |
| 7.4 | Library → the Met Office replay | Wind follows the forecast, labelled as model output with its age | |
| 7.5 | Open the published site fresh (no scenario chosen) | Within a few seconds it sails in today's live wind and sky, at this minute: the light is the real light (dark after sunset); the instruments (All instruments and conditions) and More → Layers and sources name the Met Office forecast | |
| 7.6 | Settings → Light → Real time | Restarts now, in the live weather if the site has it | |

## 8. Library, replays and the editor (10 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 8.1 | Save the current scenario, reload the page, load it | It comes back as saved | |
| 8.2 | Save a replay of a short race and open it | It plays back and reports that it matches; you can take over | |
| 8.3 | More → Course editor: add a mark, export, import | The course round-trips; the live check flags a mark on land | |

## 9. Phone (10 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 9.1 | Open the site on a phone, upright | Instruments and controls fit; the sail status reads in full ("Luffing · trim in (W)"); the sheet bars show "% eased" | |
| 9.2 | Steer and trim with the on-screen buttons | They respond; nothing important is hidden | |

## 10. Speed on your own machine (5 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 10.1 | Sail off RDYC with the chase camera, then fly the drone over the town | Smooth movement (aim: 30 frames a second or more on a laptop; this could not be measured here) | |
| 10.2 | Note the machine and browser | e.g. "MacBook Air M2, Safari 18" | |
| 10.3 | More → Graphics and sound: note which preset it chose, and the frames a second it shows there; try the other two | A graphics card starts on Balanced; Ultra is sharper on a high-density screen; Performance is smoother on an older laptop | |
| 10.4 | If the view is slow, try Performance, then lower the resolution | It becomes smooth enough to sail; nothing about the sailing changes | |

## 11. Graphics and sound (20 min)

The graphics round ([GRAPHICS_REPORT.md](GRAPHICS_REPORT.md)). It was checked here only on a software renderer, so **your machine is the real test**.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 11.1 | Sail off RDYC in 12 kn, chase camera; look at the water near and far | Fine ripples running with the wind near the boat, short-crested, never tiled; further off the water grows smoothly duller and rougher, with **no shimmer or crawling** | |
| 11.2 | Look along the sun's direction (Settings → Light → Golden hour) | A glitter path of sun on the water; the sky and the water warm; distant hills fade into warm haze toward the sun and bluer haze away from it | |
| 11.3 | Look back at the wake at 5 kn, then put the helm over | A churned white centre that spreads and breaks up, faint arms at an angle behind; it lies on the waves; turning stirs it | |
| 11.4 | Sail fast on a reach in waves (Library → Fresh and shifty, or Start Bay at 16 kn) | A bow wave and foam along the lee side that grow with speed; spray from the bow when it drops into a wave | |
| 11.5 | Press Z (flatten) twice, then ease the main a long way (S) | The sails flatten and their heads open; easing lets the leech twist open; let a sail luff and it flogs, harder in more wind | |
| 11.6 | Camera → Scenic; then the wheel in the chase view; then press C a few times | Scenic circles the boat low and well off, never over land; the wheel moves the chase camera in and out; each change of camera glides rather than jumps | |
| 11.7 | Settings → Camera motion at 0, then at 100% | At 0 the horizon stays level in the chase and helm views; at 100% the view rides the waves and heels with the boat | |
| 11.8 | Look up at the sails with the sun behind them (Golden hour, sail away from the sun) | The sails glow, with the seams showing darker; behind a hill the glow fades | |
| 11.9 | Settings → Light: each of the four presets | Clear morning, bright midday, golden hour and overcast each restart at that time on the same date; the wind is kept | |
| 11.10 | Sound: click in the view, then sail; tack, let the sails luff, sail into the moorings | Wind rising with the apparent wind, water with speed, a flutter when luffing, a thump as the boom crosses, halyards clinking near the moorings. U mutes and unmutes; each volume slider works; nothing plays before the first click | |
| 11.11 | **Note anything that looks wrong or worse than before** | List it with a screenshot and the preset used | |

## 12. Getting started and switching activity (10 min)

UI v2, slice 1 ([UI_V2_REPORT.md](UI_V2_REPORT.md)).

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 12.1 | Open the site in a private window (first visit) | "Squib sailing simulator" with four choices: Learn to sail, Free sailing, Race against AI, Scenarios; the sea is live behind it; Escape or × closes it and you are sailing | |
| 12.2 | Look at the start of the toolbar | A button says what you are doing: "Free sailing" | |
| 12.3 | Choose it, then each door in turn | Learn to sail starts the lesson (the button says Tutorial); Race against AI opens the race set-up; Scenarios opens the library; Free sailing ends the lesson and sails on | |
| 12.4 | Start a quick race and let the start signal go; then choose a scenario in the Library, or Free sailing from the activity button | "Leave the race?" asks first. Keep racing (or Escape) changes nothing; Leave the race starts the new activity | |
| 12.5 | Pause, then load a scenario from the Library | The new scenario starts sailing (it does not stay paused) | |
| 12.6 | **Look and feel** | The colours (deep navy, slate, ocean blue; teal for good, amber for advice, red for warnings) read well over the water; note anything hard to read | |

## 13. Review Package 1: measure and make consistent (15 min)

The first revision package of the comprehensive review ([COMPREHENSIVE_REVIEW.md](COMPREHENSIVE_REVIEW.md) §11 and §13).

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 13.1 | Start a quick race in Start Bay; sail close past the committee boat SAMARITAN's stern, then her bow | You touch her where her hull is drawn, not before and not through her; she lies head to the wind (in a stream, head to the stream) and swings slowly, not with every puff | |
| 13.2 | On the river, in slack water, sail slowly along a row of moored boats and touch one | The contact comes where the boat is drawn; the boats lie at slightly different angles, as before | |
| 13.3 | More → Model polar; tick 15 kn and open the Table | The text says the crew trims as your assists and the AI do; the numbers match what the AI races to; any point still swinging shows as a hollow dot (* in the table) | |
| 13.4 | Quick race → venue River | The stream is off unless you tick "Illustrative tidal stream"; with it ticked, the conditions say "Tidal stream (illustrative, not real timing)" | |
| 13.5 | On your slowest device, sail a river race with 10 AI boats | If the simulation cannot keep up, "Running slow: N% of real time" shows below the toolbar, and the graphics may step down one preset; choosing graphics yourself stops that | |
| 13.6 | Restart a quick race ten times, then sail on | No slow-down or crash builds up over the restarts | |
| 13.7 | Optional (a developer's console): `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` | "The browser reset the graphics…" shows and the run pauses; it carries on by itself when the picture returns (or press Reload) | |

## 14. RDYC courses and marks from the club's documents (10 min)

From the documents the owner supplied on 3 Nov 2026 ([CLUB_DOCUMENTS.md](CLUB_DOCUMENTS.md)).

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 14.1 | Sail out of the harbour towards Castle Ledge with labels on | Homestone (red can, quick red light), Castle Ledge (green cone), Checkstone (red can), West Rock and Mewstone (south cardinals), the yellow 6-knot buoys and RDYC 1–4 (yellow cones) where the club's Course Appendix puts them; also on the minimap | |
| 14.2 | Quick race → Where: "Start Bay: an RDYC club course for the wind", random conditions | The summary names the course (e.g. "RDYC B1: wind south-west") and says it awaits a club check; SAMARITAN lies at one end of the line, the named buoy at the other | |
| 14.3 | Sail the course | The marks and roundings match the course string in the appendix (Library → the course's description) | |
| 14.4 | **For an RDYC member:** Library → Club courses → each course | Compare it with the Course Appendix 2026; if it matches, set it to verified with your name and the date in the course editor, and export it | |

## 15. Review Package 2, round A: accessibility, the start, steering (15 min)

What changed: [COMPREHENSIVE_REVIEW.md](COMPREHENSIVE_REVIEW.md) §14.

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 15.1 | In a private window (a first visit) | The welcome asks "Have you sailed before?". "Yes" gives tiller steering: A pushes the tiller to port and the bow turns to starboard; the tiller drawing in the dock shows it. "Not yet" keeps the keys turning the bow. More → Graphics and sound changes it | |
| 15.2 | Open Help with the keyboard, then press Tab many times, then Escape | Focus stays inside Help; Escape closes it and focus is back on the Help button; A / D still steer | |
| 15.3 | Start a quick race on a phone (or a narrow window) and on a short laptop window | The instruments, race panel and coach never cover the sailing controls, the toolbar or the minimap; the left column scrolls instead | |
| 15.4 | Start a quick race, cross the line before the gun | The race panel says you are over, what to do, and where the nearer end of the line is (with an arrow); after four minutes it says flag X is down and offers Retire | |
| 15.5 | With sound on, listen through a start sequence; bump a mark; touch the bottom in the river | A horn at each signal (one long one at one minute), its caption in the race panel; a knock at the contact; a scrape on the bottom | |
| 15.6 | Turn on "reduce motion" in the operating system, then sail in the helm view in a breeze | The horizon stays level and the view does not bob with the waves; camera changes cut instead of sliding | |

## 16. The owner's improvements of 4 Nov 2026 (15 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 16.1 | Help (?) | The build line at the bottom names the commit and the time it was made | |
| 16.2 | More → Graphics and sound → Graphics check, 10 s after loading in daylight | "Painted surfaces draw correctly", or the fault and the mode chosen. Copy the report and send it | |
| 16.3 | Look at the marina boats, the racing marks and SAMARITAN | White hulls; orange marks with sponsor bands; SAMARITAN white with her navy canopy | |
| 16.4 | Make the window narrower and wider | The top bar stays on one row; the activity becomes its icon and Reset loses its label, then the spacing tightens, then a Menu button; Race, Library and Scenario stay on the bar | |
| 16.5 | Sail past the RDYC | Dinghies standing in their rack on the pontoon; buff stone wall; white bargeboards; the light-rendered houses beside the club; pines on the hill | |
| 16.6 | Sail past Bayard's Cove | The round stone fort at the end of the quay with its gunports | |
| 16.7 | Watch the Higher Ferry cross both ways | Her cabin stays on the same side; her cables come up out of the water through her ends; up to 36 cars | |

## 17. Package 2, round B: lessons, one race set-up, levels (20 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 17.1 | In a private window (a first visit), look at the welcome | "Have you sailed before?" with Not yet / Yes, I sail / I race; "Sail now" first and largest | |
| 17.2 | Answer Not yet, then Sail now | Lesson 1 starts at once, the boat sailing; the heading and course-over-ground lines and a yellow buoy labelled Target on the water | |
| 17.3 | Sail lesson 1 to the end | Each step moves on when done; the buoy's distance counts down; a result card with your time and "Next: The wind" | |
| 17.4 | Sail lessons 2 to 6 (or Skip step through them) | Lesson 2 reports the apparent wind on each point of sail; lesson 4 times your tacks against the model's 8.6 s; lesson 5 starts a race and reports your start; lesson 6 shows STW against SOG in a stream | |
| 17.5 | More → Lessons → All lessons | Six lessons, those done ticked with your best time | |
| 17.6 | Race | Today's challenge at the top; the short course by default; every option of the old Scenario race section under More options | |
| 17.7 | Sail today's challenge to the finish | Your time, and "Your first time on Today's challenge" (a later, faster finish says "New personal best") | |
| 17.8 | During a race, camera menu → Start line | The view from beside the committee boat looking along the line to the pin | |
| 17.9 | More → Graphics and sound → Interface level: try Learn, Club, Expert | Learn: the teaching overlay on and no Flatten slider; Expert: all instruments and no coach; Club: as before | |
| 17.10 | Look at the compass | The two wind arrows marked T (solid) and A (dashed) | |

## 18. The owner's photographs and requests of 5 Nov 2026 (20 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 18.1 | Sail slowly past the RDYC pontoon, then hold still and look at the rack and the shore | The dinghies fanned in their rack, grey, leaning one against the next; no flickering on the rack or along the foot of the sea wall; the wall stands in the water | |
| 18.2 | Watch the people near the RDYC for a minute | Nobody walks through the clubhouse or along the river face of the sea wall; walkers turn back at the wall | |
| 18.3 | Watch the Lower Ferry's float cross | No cabin on the float: an open deck with rails, lamps and lifebuoys, a post either side of each ramp | |
| 18.4 | Watch the Higher Ferry from both sides | Dark blue hull, white casings with a house at each corner, the control cabin high on a gantry amidships over the cars | |
| 18.5 | Sail up to Noss and Sandquay | Noss: the brick hall with PHILIP & SON LTD · SHIPBUILDERS & ENGINEERS and three round windows on its river gable; the Noss ferry red with a white cabin. Sandquay: three grey training boats on the pontoon flying the White Ensign; white boathouses with green roofs. (Positions are estimates: note any that are wrong) | |
| 18.6 | Look at the sailing dock on a laptop | Each sail's name, Ease, the sheet meter ("35% eased") and Trim on one line, then Auto-trim and the sail's state in words; nothing cut off; all labels easy to read | |
| 18.7 | Turn Auto-trim off and press Ease until the sheet is all the way out | The meter reads "100% eased"; the state reads "Luffing · trim in (W)" in full | |
| 18.8 | On a phone (or a narrow window) look at the dock | Nothing cut off or overlapping; the paused notice is clear of the dock | |
| 18.9 | Sail past the Royal Dart, beside the Lower Ferry's slipway in Kingswear | Cream render, a low roof on deep white eaves; the splayed bay on the river front with two balconies, thin white columns and a grey tented canopy; ROYAL DART BARS on a navy band; a navy base on stone at the water | |
| 18.10 | Look at the wing north of it and the passenger pier | A white wing with large first-floor windows over a loggia of white columns; a white lattice-truss gangway from the loggia down to a pontoon where the passenger ferry berths; the gangway steeper at low water | |
| 18.11 | Look up the slipway to the top of the Square | A stone building with brick arches and a cream one with round-headed windows facing the river (note if they are the wrong way round or in the wrong place) | |

## 19. The interface, the sea and the sky (5 Nov 2026, second review) (15 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 19.1 | Choose the helm view from the camera list, then press A and D at once; do the same for top-down and drone | The boat turns each time; pressing D does not switch to the drone view | |
| 19.2 | Look at the hull close to, in the chase view | Straight, crisp blue and red bands at the waterline and a straight blue stripe under the deck edge; no saw-tooth | |
| 19.3 | Open Race | Today's challenge on top; "Where" with Start Bay chosen; the river, an RDYC course and the library beside it | |
| 19.4 | On a laptop, look at the helm console at the bottom | Four modules side by side (MAIN, JIB, HELM, BOAT), two rows tall, little empty space, the water showing through; hold A or D: it does not grow or shrink; let a sheet right out: its state turns amber and Trim glows | |
| 19.4b | On the laptop you use, in the chase and the top-down views, at your usual window size | The console is one slim band along the bottom edge (about 75 px), the whole Squib in view above it; no line of text along the bottom of the screen; More → Layers and sources starts with the session's summary | |
| 19.4a | On a phone (or a window under 700 px wide) in a race, choose Expert and turn Auto crew off | The console: the sails one above the other, the helm and the boat side by side, Flat and Hike inside their box; the instruments and the race panel scroll above it, never over it; ▾ on a tab above the console's corner | |
| 19.5 | Look at the minimap and zoom it in and out | The scale (300 m, 625 m or 1.7 km) under the map, not on it | |
| 19.6 | On the deployed site, a few hours after the merge, free sail with live conditions on a cloudy or rainy day | Overcast sky, soft light, rain when the forecast has it | |
| 19.6a | On the river in 18 kn and then 25 kn (Scenario), chase and helm views | No white spots or twinkling flecks across the water; at 25 kn the chop's crests whiten a little, as lace on the crests | |
| 19.7 | Start Bay in 15 kn or more (Scenario, or live on a breezy day) | White horses across the bay; surf on the beaches with an onshore wind | |
| 19.8 | Sail into a moored boat or a pontoon at 2 kn, then into the jetty at full speed | At 2 kn a scuff or a gouge on the hull where she touched, no leak; at full speed a crunch, a hole in the bow drawn where she struck, chips flying, the damage report showing the hole, the water coming in (L/min) and her bow going down | |
| 19.9 | With a hole in the main hull (a hard knock on the side), watch the water inside; press Stuff the hole | The crew bail (one stops hiking); she gets heavier and more tender; after about 20 s the hole is stuffed and most of the flow stops | |
| 19.10 | Hit something hard at the bow, or knock the windward side by the mast | The forestay parts and the mast falls aft, or the shroud breaks and the mast falls to leeward: the mast broken at the deck and lying with the sails in the water, dragging her round | |
| 19.11 | Keep sailing holed until she fills | She settles lower and lower; awash on her buoyancy tanks with the deck under ("Awash"); with a buoyancy tank holed too she sinks and lies on the bottom ("Sunk"), and Start again restarts | |

## Accepting the build

- **Accepted** if every row passes or has only notes the owner is content to carry (OUTSTANDING_ISSUES.md lists the known ones).
- **Rejected** if any row fails. Each failure becomes an item for the next round.
- Return the completed tables (or a copy of this file) with the screenshots and replays.
