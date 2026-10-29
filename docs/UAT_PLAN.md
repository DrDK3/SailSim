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

## 7. Conditions and weather (10 min)

| # | Do | Expect | Pass / Fail / Note |
|---|---|---|---|
| 7.1 | Library → Wind against tide | Short steep waves in the entrance; spray into a classic cockpit | |
| 7.2 | Library → Fog, Rain, Evening | Visibility, rain streaks and sunset light look right; colours are not washed out | |
| 7.3 | Scenario → Tide manual; set a low tide and sail near the edge | The boat grounds where the drying areas are; no start is placed on the mud | |
| 7.4 | Library → the Met Office replay | Wind follows the forecast, labelled as model output with its age | |

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

## Accepting the build

- **Accepted** if every row passes or has only notes the owner is content to carry (OUTSTANDING_ISSUES.md lists the known ones).
- **Rejected** if any row fails. Each failure becomes an item for the next round.
- Return the completed tables (or a copy of this file) with the screenshots and replays.
