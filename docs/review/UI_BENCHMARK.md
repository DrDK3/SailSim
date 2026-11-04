# UI review against best-in-class practice: engagement and retention

Owner review, 4 Nov 2026: *"The top bar of the UI needs to be improved, where there is too much blank space … this indicates the need for a UI review against best-in-class standards for engagement and retention in sims such as this."*

This review compares the simulator with published guidance on onboarding and retention, and with what comparable sailing and racing simulators do. It feeds Package 2 round B and later packages. **It is a desk review.** No players were tested, and no comparable product was run here. Claims about other products come only from the sources listed, and some of those are user opinions; they are marked as such.

## 1. What good practice says

| # | Principle | Source |
|---|---|---|
| G1 | Teach the essentials, get to the fun quickly, and leave players wanting more. Onboarding covers the controls and the **core loop**. | Roblox developer docs |
| G2 | The first thing a player touches should be the most engaging mechanic. | Unity, "10 first-time user experience tips" |
| G3 | Introduce systems gradually and space them across sessions, so each return feels fresh. | Acagamic, onboarding techniques |
| G4 | Clear goals and feedback. Players who don't know their progress or next step drop off. | Certainly.io, game onboarding |
| G5 | End onboarding on a moment of accomplishment, and show what lies ahead. | Roblox developer docs |
| G6 | Segment players by skill, and measure completion and drop-off. | Unity; Certainly.io |
| G7 | HUD: show status rather than raw data, keep it minimal, and let players choose what they see. Racers turn parts off to concentrate. | SimXPro guide; GTPlanet and Overtake.gg forums (user opinions) |
| G8 | Short sessions with rankings and challenges. Virtual Regatta Inshore races last 5 or 10 minutes; a lobby shows race categories (custom games, challenges, championships); there are rankings and challenge leaderboards. Users ask for a better HUD. | Virtual Regatta news and app listing (2022–23; current app may differ); app-store reviews (opinions) |

## 2. Where the simulator stands

| Area | Today | Against the guidance | Change |
|---|---|---|---|
| **Top bar** | Since round A it was capped beside the instruments, so on laptop screens it wrapped onto two rows with blank space (the owner's screenshot) | Clutter and wasted space distract (G7) | **Done in this round:** one row sized to its content. As space shrinks, the activity shows as its icon and Reset loses its label, then the spacing tightens, then everything goes behind a Menu button as on a phone. Race, Library and Scenario always stay on the bar |
| First visit | Welcome hub with four routes; one steering question | Good (G1). The first action is choosing a route, not sailing (G2) | Round B: "Sail now" as the first, largest action; the lesson starts in the water within 10 s |
| Lessons | One long tutorial (U9) | Too much at once (G3); no end moment (G5) | Round B: six short lessons (§8.1 of the review), each ending with a result card and a "next lesson" prompt |
| Goals and feedback | The coach's briefing and debrief; results table | Feedback exists (G4); no visible progress | Round B: lesson ticks and personal bests (best race time, best start), kept in this browser |
| Session length | Quick races take about 15–25 minutes | Comparable products use 5–10 minute races (G8) | Round B: a "short course" option of about 5 minutes (one beat and one run) |
| HUD | Instruments, race panel, coach, dock, minimap; parts can be hidden | Mostly good (G7); status words already lead ("Stalled · ease the main") | Round B: interface levels (Learn, Club, Expert) choose what shows by default |
| Challenges and rankings | None | A main retention driver in comparable products (G8) | **Needs a service.** Shared leaderboards need a server and storage (paid or free-tier infrastructure; decision D8's backend could host it). Without one: local personal bests and a daily seeded challenge that is the same for everyone on the same day, with no shared table |
| Measurement | None | G6 | **Needs a service or consent.** Analytics need a provider and a privacy notice; not proposed without the owner's decision |

## 3. Recommendations, in order

1. **Done:** the one-row top bar (above).
2. **Round B:** "Sail now" first, then six short lessons with result cards (G1–G5).
3. **Round B:** interface levels and a short-course quick race (G7, G8).
4. **Round B:** personal bests and a daily seeded challenge, kept in the browser (no service needed).
5. **Decision for the owner:** shared leaderboards and analytics need a server, storage and a privacy notice. Their costs belong with decision D8 (live-data backend).

## Sources

- Roblox Creator Documentation, "Onboarding": https://create.roblox.com/docs/production/game-design/onboarding
- Unity, "10 first-time user experience tips for games": https://unity.com/how-to/10-first-time-user-experience-tips-games
- Acagamic, "Don't spook the newbies: 5 proven game onboarding techniques" (2023): https://acagamic.com/newsletter/2023/04/04/dont-spook-the-newbies-unveiling-5-proven-game-onboarding-techniques/
- Certainly.io, "Why great onboarding wins in online games": https://www.certainly.io/blog/why-great-onboarding-wins-in-online-games-(and-how-to-nail-it)
- SimXPro, "SimHub overlays for streaming: clean layouts": https://simxpro.com/blogs/guides/simhub-overlays-for-streaming-clean-layouts-for-obs-without-distractions
- GTPlanet forum, "HUD caveats" (user opinions): https://www.gtplanet.net/forum/threads/hud-caveats.392146/latest
- Overtake.gg forum, "Simracer = One Man Army" (user opinions): https://overtake.gg/threads/simracer-one-man-army.155855/
- Virtual Regatta, "New update for Virtual Regatta Inshore" (2022): https://www.virtualregatta.com/en/news/new-update-for-virtual-regatta-inshore/
- Virtual Regatta Inshore, App Store listing and reviews (opinions): https://apps.apple.com/us/app/-/id1182301199
- NW Yachting, on Virtual Regatta Inshore race lengths: https://nwyachting.com/?p=22383
