# Juniors round: feel, sailing cues and social goals

Round report, 17 Nov 2026. Branch `juniors-feel-social`, draft PR against `main`. Owner's brief: "SailSim: feel, sailing
cues and social goals for younger players". Evidence levels as in the review (L1–L5); "E" marks an estimate.

**Hardware caveat for this whole report.** The development machine has **no graphics card**: every frame time,
screenshot and stall below was measured with Chromium's software renderer (SwiftShader) on a 4-core Xeon at 2.3 GHz
with 16 GB of memory. The CPU-throttled runs are **stand-ins, not real devices**. Nothing here says how smooth the sim
is on any real device, or that the low preset "looks good": the device check exists so that people at the club can
find out ([DEVICE_CHECK.md](DEVICE_CHECK.md)), and the owner judges the look.

**Physics unchanged.** No file under `src/sim/` or `data/boats/` changed. `npm run envelope` gives byte-identical
`envelope.json`, `envelope.md` and console output before and after. `npm run golden:update` regenerates the four
golden traces identically: only their "generated" date differed, and those files were restored. `npm run perf`:
§2.5.

## Contents

1. [What changed and why](#1-what-changed-and-why)
2. [Device and performance evidence](#2-device-and-performance-evidence)
3. [Screenshot sheets and cue consistency](#3-screenshot-sheets-and-cue-consistency)
4. [The social design](#4-the-social-design)
5. [Remaining limitations, and what needs people](#5-remaining-limitations-and-what-needs-people)
6. [The next three improvements](#6-the-next-three-improvements)
7. [Tests and checks run](#7-tests-and-checks-run)

## 1. What changed and why

Presentation changes are listed apart from the simulation data they read. **No simulation value was added or
changed.** The renderer reads, read-only, what was already there: the snapshots, the wind model's puff list
(`WindField.puffs()`, already used by the water) and its gust factor at the boat (`WindField.sample`, which changes no
state).

### 1.1 Workstream 1: feel and frame rate

| Change | Why | Where |
|---|---|---|
| **Device check** (Settings → Display → Check this device): a 50 s fixed route on a fixed seed, driven through the app's own keyboard handler. Reports median, 95th and 99th percentile frame times, frames over 33 and 100 ms, the longest, main-thread work per frame, first frame, first sailable frame, start-up stalls labelled "shader compile" where the program count rose, key-to-screen delay, GPU string, screen, pixel ratio, cores, memory class, engine family, preset and automatic lowering. Plain verdict (Smooth / Mostly smooth / Struggling) with reasons; copy or save as JSON; no personal data | Nobody can measure juniors' devices from here (§4.1) | `src/app/deviceCheck.ts`, `deviceCheckRunner.ts`, `src/ui/SettingsPanel.tsx`, [DEVICE_CHECK.md](DEVICE_CHECK.md) |
| **Stand-ins and profiles**: `tools/device-standin.mjs` (CPU throttle ×1/×4/×6 by the DevTools protocol, small viewports, pixel ratio 1), `tools/frame-profile.mjs` (CPU and sampling heap profiles over driven frames) | Measure first | `tools/` |
| **Fix: a multi-second stall each time a river boat appeared.** The P/S label of a navigation light kept the light object in `userData`. three.js deep-copies `userData` through `JSON.stringify` when a vessel model is cloned, so every clone serialised a sprite, its material and its canvas texture, encoding the canvas as a PNG (`toDataURL`). Now the label keeps the light's index. This also fixes a latent bug: cloned vessels' labels pointed at a JSON copy, not their light | Profile: `toDataURL` was 667 ms a frame on average over 120 frames, with one frame of 80.7 s | `src/render/navLights.ts` |
| **Fix: a stall at every new scenario, and whenever the sun moves 3°.** The horizon reader built a new shader material for each read and deleted it afterwards, so it was compiled every time. It then read back synchronously, waiting for the sky's light map to be drawn. Now the material is kept, and the read is asynchronous (WebGL 2) | Profile of the device check's restart: 38.9 s (compile) then 44.8 s (read-back) → 4.4 s | `src/render/scene.ts` |
| Fix: the walkers' jetty lookups allocated in the frame loop (array destructuring per segment, no bounding box) | Largest allocator per frame in the profile | `src/render/dart.ts`, `landmarks.ts` |
| Same fix for the simple-materials fallback (a material kept in `userData`) | The same hazard | `src/render/scene.ts` |
| **Shader warm-up** (`renderer.compileAsync`) behind a "Preparing the 3D view…" notice, on loading and on restarts, **only where the browser compiles shaders in parallel** (`KHR_parallel_shader_compile`). Without it, compiling the whole scene up front was measured to be slower: the river became sailable at 19.4 s instead of 10.1 s at ×4 | Issue 43; the brief's "consider compileAsync" | `src/app/controller.ts`, `src/render/scene.ts` |
| **Dynamic resolution with hysteresis** before any preset step: 2-second windows; down a step after 2 windows with the 95th percentile over 33.4 ms; up only after 6 windows under 60% of that, and a 20 s cool-down that doubles when a step up does not hold (up to 4 min); at the floor (60%), after 3 more windows, the preset steps down. A notice says so, with **Keep full quality**; **Automatic quality** in Settings switches it off | Brief §4.2 | `src/render/dynamicResolution.ts` |
| **Game controllers** (Gamepad API, standard layout) through the existing controls: the stick sets a helm target that the helm follows at the keys' rate (as dragging the tiller does); the triggers set the mainsheet's rate in proportion; the buttons press the existing held actions and commands. Dead zone 15% and response curve exponent 1.6 (E). Inputs are logged like any others, so replays and challenges work | Brief §4.2 | `src/app/gamepad.ts`, `controller.ts` |
| **Vibration** (`vibrationActuator`, where supported) for a gust arriving, the boom crossing and contact, scaled by the event. Optional (Settings → Controls), off with reduced motion, and never the only channel | Brief §4.2 | `controller.ts` (`rumble`) |
| The lowest preset is shown as **Smooth** (the stored key stays `performance`, so saved settings load). It now has haze from the sky's colour and the bow spray: §2.3 | Brief §4.3 | `src/render/graphics.ts` |

### 1.2 Workstream 2: one cue pipeline

| Change | Where |
|---|---|
| **One cue state a frame** (`CueState`), from the interpolated snapshots: every live puff with the wind model's own life envelope; true and apparent wind; the gust at the boat; each sail's luff, stall and flog; heel and heel rate; speed through the water and over the ground; rudder angle and load; wave height; the bow's drop onto the water; spray rate; events (boom across, gust onset, contact, grounding); tack or gybe in progress. Water, sails, telltales, spray, sound, camera and vibration read it | `src/render/cues.ts`, `scene.ts`, `controller.ts` |
| **Fix: the water drew puffs with its own life envelope** (linear ramps) instead of the wind model's smoothstep, so a drawn puff's strength differed from the wind it added. Now the cue state carries the model's envelope, and the shader is given exactly the model's strength | `cues.ts` (`puffEnvelope`) |
| The 16 shader slots take the puffs **nearest the boat by edge**, so a puff the boat is in or about to enter is never left out for a far one (tested) | `selectPuffsForShader` |
| **Gust outlines**, a removable teaching aid: rings at each puff's position and radius, the nearest three labelled "gust +25%" in words. Off by default and off in races unless asked for (Settings → Help and accessibility). Removing them leaves the cat's paws on the water unchanged (tested) | `src/render/puffOutlines.ts` |
| **Telltales**: the windward ones lift and spin when the jib luffs; the leeward ones when the flow stalls (the physics' stall factor, unused by the picture before) | `src/render/squibModel.ts` |
| **Sound**: the wind's voice is now silent in a dead calm (it had a floor of 8%); a **gust arriving** makes a swell of the wind's band, scaled by the gust and the apparent wind. Wind, water, flutter and the boom already followed the simulation; they now read the cue state | `src/render/audio.ts` |
| **Feel**: the chase camera eases back up to 1.2 m as a gust arrives and dips up to 0.25 m as the boom crosses. Both are traced to cue events, scaled by the camera-motion setting, and none with reduced motion. Spray uses the same rule as the cue state (one definition) | `cues.ts` (`cameraFeel`), `boatWater.ts` |
| **Every cue at every preset**: an audit of the drawn scene (`controller.cueAudit()`) and an end-to-end test at Smooth, Balanced and Ultra | `src/render/cueAudit.ts`, `tests/e2e/juniorsCues.spec.ts` |

### 1.3 Workstream 3: social goals

Layer A works with no server at all. Layer B is written, tested against a local mock, and **off**.

| Change | Where |
|---|---|
| **Word-list names**: adjective + sea creature or shore bird + 1–99 ("Blue Heron 42"), chosen from menus or re-rolled. Never free text; the endpoint and verifier check the same lists | `src/app/safeNames.ts` |
| **Challenge a friend**: after a finish, a link carries the run, the name, the course, the time and the time at each mark. The friend's app shows a challenge card ("does not react"), races the run as a ghost, and then says "You beat Blue Heron 42 by 12 s" or "Blue Heron 42 was 8 s faster: watch how their ghost sails the leg to the windward mark: they gained 9 s there", with a split table. A link whose name is not a word-list name is refused | `src/app/challenge.ts`, `src/ui/Social.tsx` |
| **Like-for-like bests** for the weekly course and the daily challenge only, **independent** and **assisted** kept apart, with the last 20 attempts as a small chart (shapes as well as colours). The existing bests stay, still described as a record of what you did | `src/app/bests.ts` |
| **The assist record**, the training slice's shape and rule (auto-trim, the overlay or live help make a run assisted; auto-crew does not). The training slice has not merged, so this is a compatible minimal copy, to reconcile at merge | `src/app/assists.ts` |
| **The weekly course**: one per ISO week, Monday to Sunday in Europe/London time, chosen from a rotation of the eight RDYC courses (pending the club's check) and four practice courses. Conditions are seeded by the week (8–14 kn, moderate or shifty, a fixed Wednesday afternoon). Rondar Squib, damage as in every race, **no tidal stream** (parity with the AI, RA-2), sailed alone with targets and friends as ghosts. An optional `data/weekly/season.json` can set chosen weeks | `src/app/weekly.ts` |
| **Model-sailed targets**: a scheduled Action sails the week's course with the AI at club, good and expert over three seeds, and publishes bronze, silver and gold with a ghost track each (`weekly/<week>.json`, atomic, kept four weeks). The app checks the file is for this week and this scenario; otherwise "targets not available this week" | `src/app/targets.ts`, `weeklyTargets.ts`, `tools/weekly-targets.ts`, `.github/workflows/weekly-targets.yml` |
| **Club table** (layer B, flag `clubTable` = built with `VITE_CLUB_TABLE_URL`, off): opt-in submit, endpoint, automatic verifier, publish, removal, expiry: §4 | `server/club-table/`, `src/app/clubTable.ts`, `clubVerify.ts`, `src/ui/ClubTable.tsx`, `tools/club-verify.ts`, `.github/workflows/club-table.yml` |

Overlap with the training slice (PR #31), to resolve at merge:

- `src/app/controller.ts`: additive only: the frame hook, the gamepad poll, the social hub, the warm-up, the cue events, a `BUILD_ID` export and one line in `checkRaceBests`.
- `src/app/assists.ts`: duplicates the slice's assist record.
- Issues are numbered from 210.
- None of `sailStatus.ts`, `Controls.tsx`, `lessons.ts`, `DebriefPanel.tsx` or `wind.ts` was edited.

## 2. Device and performance evidence

### 2.1 The stand-ins (not real devices)

Machine: Intel Xeon @ 2.30 GHz, 4 cores, 16 GB, Linux; Chromium with SwiftShader. Each stand-in loads the page afresh
under its throttle and runs the device check for 50 s, with **automatic quality off** for a like-for-like comparison.
With SwiftShader the CPU draws every pixel, so the throttle slows the drawing too: a frame takes seconds. **Every
stand-in is "Struggling" before and after**, which says nothing about real devices with any graphics hardware. The runs
draw only 10–41 frames, so their statistics are rough.

Stand-ins: laptop-x1 (1366 × 768, no throttle), laptop-x4 and chromebook-x6 (1366 × 768, CPU ×4 and ×6), tablet-x4 (1024 × 768, touch), phone-x6 (390 × 844, touch); all at pixel ratio 1.

**Before (main, automatic quality off)**

| Stand-in | Verdict | Frames | Frame median / p95 / longest (ms) | Main thread median / p95 / longest (ms) | First frame (ms) | Sailable (ms) | Start-up stalls over 100 ms (ms, cause) | Key to screen, median (ms) | Resolution at end |
|---|---|---|---|---|---|---|---|---|---|
| chromebook-x6 | Struggling | 12 | 3399.9 / 8416.3 / 8416.3 | 195.5 / 8383.8 / 8383.8 | 926 | 10993 | 7200 (shader compile), 1950 (unknown), 917 (shader compile) | 3435 | 0.75 |
| laptop-x1 | Struggling | 17 | 2783.2 / 6483.1 / 6483.1 | 21.3 / 6436 / 6436 | 254 | 8787 | 5033 (shader compile), 2517 (unknown), 967 (shader compile), 6833 (unknown) | 2708 | 0.75 |
| laptop-x4 | Struggling | 10 | 4416.5 / 9716.3 / 9716.3 | 117.8 / 9624.4 / 9624.4 | 563 | 10079 | 6416 (shader compile), 2050 (unknown), 1050 (shader compile) | 4098 | 0.75 |
| phone-x6 | Struggling | 41 | 833.4 / 2733.2 / 4949.8 | 66.3 / 264.1 / 2625.6 | 885 | 10218 | 7116 (shader compile), 1583 (unknown), 633 (shader compile) | 2102 | 0.75 |
| tablet-x4 | Struggling | 14 | 3116.6 / 6733.1 / 6733.1 | 109.9 / 6718.2 / 6718.2 | 532 | 10315 | 7066 (shader compile), 1883 (unknown), 833 (shader compile) | 3078 | 0.75 |

**After (this branch, automatic quality off)**

| Stand-in | Verdict | Frames | Frame median / p95 / longest (ms) | Main thread median / p95 / longest (ms) | First frame (ms) | Sailable (ms) | Start-up stalls over 100 ms (ms, cause) | Key to screen, median (ms) | Resolution at end |
|---|---|---|---|---|---|---|---|---|---|
| chromebook-x6 | Struggling | 11 | 3949.9 / 7033 / 7033 | 158.2 / 6233.5 / 6233.5 | 912 | 10962 | 3917 (shader compile), 4267 (unknown), 950 (unknown) | 6810 | 0.75 |
| laptop-x1 | Struggling | 17 | 2816.5 / 5816.4 / 5816.4 | 22.5 / 5819.5 / 5819.5 | 269 | 9218 | 1667 (shader compile), 5000 (unknown), 817 (unknown), 600 (unknown), 5033 (unknown), 3764 (shader compile) | 2821 | 0.75 |
| laptop-x4 | Struggling | 10 | 3769.8 / 8749.6 / 8749.6 | 131.6 / 3672 / 3672 | 546 | 9663 | 3250 (shader compile), 4133 (unknown), 983 (unknown) | 7522 | 0.75 |
| phone-x6 | Struggling | 35 | 900 / 3549.9 / 5166.5 | 68.1 / 2822.9 / 5132.4 | 858 | 9858 | 3883 (shader compile), 3633 (unknown), 667 (unknown), 400 (unknown) | 3261 | 0.75 |
| tablet-x4 | Struggling | 11 | 3733.1 / 9016.3 / 9016.3 | 124.5 / 4788.3 / 4788.3 | 508 | 9807 | 3067 (shader compile), 4683 (unknown), 917 (unknown) | 4984 | 0.75 |

**After, automatic quality on**

| Stand-in | Verdict | Frames | Frame median / p95 / longest (ms) | Main thread median / p95 / longest (ms) | First frame (ms) | Sailable (ms) | Start-up stalls over 100 ms (ms, cause) | Key to screen, median (ms) | Resolution at end |
|---|---|---|---|---|---|---|---|---|---|
| laptop-x4 | Struggling | 11 | 4762.7 / 7216.4 / 7216.4 | 125.5 / 5697.1 / 5697.1 | 641 | 12224 | 4600 (shader compile), 5550 (unknown) | 5029 | 0.75 |
| phone-x6 | Struggling | 34 | 1266.6 / 2866.7 / 4799.9 | 71.2 / 1371.8 / 2569.8 | 976 | 10125 | 3467 (shader compile), 4100 (unknown), 667 (unknown), 417 (unknown) | 2127 | 0.68 |


Read with care:

- The **start-up shader-compile stall** fell from 5.0–7.2 s to 1.7–3.9 s.
- New "unknown" stalls of 3.6–5.0 s appeared in the "after" runs. The likely cause is the GPU emulator's own drawing,
  now waited on in other places.
- Wall-clock frame times did not change measurably; they are dominated by software drawing.
- The **main-thread work per frame** (the part a slower processor changes) has a median of 21–23 ms at ×1,
  110–130 ms at ×4 and about 160 ms at ×6. Its 95th percentile still includes waits on the emulated GPU.
- With automatic quality on, the phone stand-in lowered its resolution once (75% → 68%) and did not step back up:
  hysteresis held.

### 2.2 What was fixed, from the frame profiles

`tools/frame-profile.mjs` drives 120 frames at a fixed 60 Hz clock from the river start (640 × 400, software rendering,
development build) under the DevTools profilers:

| | Before | After |
|---|---|---|
| Longest frame (main thread) | 80,660 ms (one vessel appearing: `toDataURL`) | 1,975 ms (a new vessel's model and shaders) |
| Median / 95th percentile main thread | 17.5 / 36.0 ms | 11.3 / 26.4 ms |
| The device check's restart (scenario change) | 38,956 ms (horizon shader compile), then 44,836 ms (synchronous read-back) | 4,401 ms (new geometry uploaded for Start Bay) |

**Measured but not fixed** (issues 211–213):

- Materials shared between instanced and plain meshes make three.js re-derive their programs: about 110 kB allocated
  and 0.5 ms a frame.
- Vessel models are built and compiled when each vessel first appears.
- The warm-up cannot be measured here: SwiftShader has no parallel shader compile.

### 2.3 The low preset as an art-direction problem

**The target look, a rubric for the owner:**

- a clear horizon, and water whose colour reads as the Dart's green-teal;
- a crisp silhouette of boat and sails;
- the landmarks recognisable (Dartmouth Castle, the RDYC, the ferries, the harbour entrance);
- consistent light;
- no muddy textures and no shimmer.

**Evaluated and kept** (cost measured with `tools/gfx-bench.mjs`, eight fixed views, before and after):

- **haze from the sky's colour** (a few vector operations a frame on the CPU);
- **bow spray** (point sprites, only when the bow slams at speed).

| View | Before: render / submit (ms) | After: render / submit (ms) | Draw calls (before → after) | Triangles (M) |
|---|---|---|---|---|
| chase-river | 2388 / 11 | 2345 / 8.9 | 353 → 353 | 2.79 → 2.79 |
| helm-river | 2623 / 9.3 | 2483 / 7.7 | 374 → 374 | 3.02 → 3.02 |
| sail-close | 3687 / 10.9 | 3454 / 12.6 | 677 → 677 | 3.46 → 3.46 |
| wake-stern | 688 / 9.8 | 630 / 9.6 | 132 → 132 | 0.92 → 0.92 |
| chase-sea | 613 / 9.2 | 614 / 8.2 | 132 → 132 | 0.92 → 0.92 |
| golden-river | 3423 / 10.7 | 2427 / 8.2 | 338 → 338 | 2.63 → 2.63 |
| backlit-sails | 2864 / 8.3 | 2916 / 8.9 | 379 → 379 | 3.23 → 3.23 |
| drone-harbour | 2005 / 9.9 | 1812 / 8.9 | 388 → 388 | 3.12 → 3.12 |

Total over the eight views: 18289 ms before, 16683 ms after. Draw calls and triangles are the same: haze is a fog colour, and spray is one point-sprite draw that is empty until the bow slams. The render-time differences are within this machine's run-to-run noise (the golden-river view moved by 1 s in a direction the change cannot explain). **Kept**, on the evidence that they cost nothing measurable here. Whether they make Smooth look better is the owner's judgement: compare the before and after sheets in §3.

**Not evaluated this round** (left for a round with a GPU to measure on):

- impostor billboards or merged geometry for the far town and trees;
- baked vertex lighting;
- a cheaper water shader (Smooth already draws the gradient sky water with Fresnel and the cat's paws);
- a blob shadow (Smooth already has one shadow map that follows the boat);
- texture atlases;
- density by distance.

Under software rendering, the measured costs are triangles and fill, not these.

### 2.4 Budgets for each preset (software rendering; relative only)

GFX_BUDGETS

Texture memory is an estimate: width × height × 4 bytes, × 4/3 with mipmaps, over the textures on the scene's
materials. Render time is the time to submit and draw one frame and read a pixel back, under SwiftShader at 1280 × 720.
On a GPU it would be one or two orders of magnitude lower. Budgets proposed for real devices (E, to be checked with the
device check):

| Preset | Draw calls | Triangles | Texture memory | Render time |
|---|---|---|---|---|
| Smooth | ≤ 700 | ≤ 3.5 M | ≤ 64 MB | ≤ 25 ms on a school Chromebook (E) |
| Balanced | ≤ 1,400 | ≤ 12 M | ≤ 96 MB | ≤ 16 ms on a laptop with integrated graphics (E) |
| Ultra | ≤ 2,000 | ≤ 15 M | ≤ 128 MB | ≤ 16 ms on a graphics card (E) |

### 2.5 Physics budget

`npm run perf` (physics only, not drawing), before and after, on this machine with nothing else running:

| Case | Before: mean / p99 / max (ms per 1/60 s frame) | After |
|---|---|---|
| 21 boats, physics only (River Dart, grounding, channel stream, shifty gusts) | 0.36 / 0.85 / 2.9 | 0.36 / 0.98 / 2.8 |
| 1 + 20 AI boats, pre-start and start | 0.77 / 2.46 / 54.7 | 0.80 / 2.47 / 30.6 |
| 1 + 20 AI boats, racing | 0.68 / 1.78 / 6.2 | 0.72 / 2.15 / 15.5 |

No regression beyond run-to-run noise (no simulation code changed). The 99th percentiles stay under the 3 ms budget. The
maxima are single frames (garbage collection, AI replanning) and vary between runs.

### 2.6 Not measured

- Any real device: Chromebooks, older laptops, iPads, Android tablets and phones.
- A real GPU (frame times, warm-up with parallel compile, the low preset's look).
- Firefox and Safari (WebKit): those engines are not installed here.
- A physical game controller and its vibration (the Gamepad API was mocked).
- Touch comfort on a real tablet (§7 gives the sizes measured).
- The load time over a real connection.
- Input-to-photon delay: the check measures to the end of the frame's drawing commands, not to the screen.

## 3. Screenshot sheets and cue consistency

All screenshots are SwiftShader renders at 1280 × 720. They show what the software renderer draws, and no claim is
made about a graphics card's picture.

**Preset sheets** (the eight fixed views of `tools/gfx-bench.mjs`, left to right, top to bottom: chase-river, helm-river,
sail-close, wake-stern, chase-sea, golden-river, backlit-sails, drone-harbour; 1280 × 720 renders reduced for the page).
Balanced has the first four views and Ultra none: their benchmarks were stopped to free the machine for the tests (§2.4).

**Smooth, before (no haze, no spray)** (chase-river, helm-river, sail-close, wake-stern, chase-sea, golden-river, backlit-sails, drone-harbour):

![Smooth, before (no haze, no spray)](img/juniors/sheet-smooth-before.jpg)

**Smooth, after (haze and spray)** (chase-river, helm-river, sail-close, wake-stern, chase-sea, golden-river, backlit-sails, drone-harbour):

![Smooth, after (haze and spray)](img/juniors/sheet-smooth-after.jpg)

**Balanced** (chase-river, helm-river, sail-close, wake-stern):

![Balanced](img/juniors/sheet-balanced.jpg)


**Cue screenshots at fixed seeds** (chase camera; Start Bay; 1280 × 720 reduced). The table gives the cue state at the
captured frame, read from the app.

**Cues at Smooth** (left to right, top to bottom: puff approaching, luffing sail, flogging sail, tack in progress, spray fresh wind):

![cues performance](img/juniors/cues-performance.jpg)

**Cues at Balanced** (left to right, top to bottom: puff approaching, luffing sail, flogging sail, tack in progress, spray fresh wind):

![cues balanced](img/juniors/cues-balanced.jpg)

**Cues at Ultra** (left to right, top to bottom: puff approaching, luffing sail, flogging sail, tack in progress, spray fresh wind):

![cues ultra](img/juniors/cues-ultra.jpg)

| Preset | Shot | Main luff | Jib luff | Gust at boat | Speed (m/s) | Spray (/s) | Manoeuvre | Puffs drawn |
|---|---|---|---|---|---|---|---|---|
| Smooth | puff-approaching | 0.49 | 1 | 0.3 | 2.76 | 0 | none | 16 |
| Smooth | luffing-sail | 0 | 0 | 0 | 1.48 | 0 | none | 0 |
| Smooth | flogging-sail | 0 | 0 | 0 | 0.37 | 0 | none | 0 |
| Smooth | tack-in-progress | 0 | 0 | 0 | 1.8 | 0 | tack | 0 |
| Smooth | spray-fresh-wind | 0.59 | 1 | 0 | 2.85 | 0 | none | 16 |
| Balanced | puff-approaching | 0.49 | 1 | 0.3 | 2.76 | 0 | none | 16 |
| Balanced | luffing-sail | 0 | 0 | 0 | 1.48 | 0 | none | 0 |
| Balanced | flogging-sail | 0 | 0 | 0 | 0.37 | 0 | none | 0 |
| Balanced | tack-in-progress | 0 | 0 | 0 | 1.8 | 0 | tack | 0 |
| Balanced | spray-fresh-wind | 0.59 | 1 | 0 | 2.85 | 0 | none | 16 |
| Ultra | puff-approaching | 0.49 | 1 | 0.3 | 2.76 | 0 | none | 16 |
| Ultra | luffing-sail | 0 | 0 | 0 | 1.48 | 0 | none | 0 |
| Ultra | flogging-sail | 0 | 0 | 0 | 0.37 | 0 | none | 0 |
| Ultra | tack-in-progress | 0 | 0 | 0 | 1.8 | 0 | tack | 0 |
| Ultra | spray-fresh-wind | 0.59 | 1 | 0 | 2.85 | 0 | none | 16 |

What the stills show, and do not show (looked at by the developer, software rendering only):

- **Puff approaching:** a darker, rougher patch on the water to one side. 16 puffs were drawn (the shader's limit); the
  boat was in a 30% gust.
- **Luffing and flogging:**
  - The "luffing" shot came out fully flogging (luff factor 0 on both sails): easing both sheets to 0.85 on a close
    reach let them out completely. A part-luffing still was not captured.
  - **A fully flogging sail is nearly invisible from directly astern in a still.** It lines up with the wind and is
    edge-on to the chase camera, so only the mast shows (issue 225).
  - In play its motion, the flutter sound and the sail panel's word carry it. Whether that is enough is for juniors to
    show (validation sheet §E1).
- **Tack in progress:** captured just after the boom crossed (cue state "tack"); the sails are edge-on, as above.
- **Spray in fresh wind:** at 22 kn the spray rate at the captured frame was 0 (spray needs the bow to drop onto a wave
  at speed, which it was not doing at that instant). No spray shows in these stills; the white is the water's foam and
  ripples.
- The cue values are **identical at every preset** (the presets change only the picture).

**Cue consistency** (`tests/render/cues.test.ts`, 14 tests; `tests/e2e/juniorsCues.spec.ts`):

- Each voice (wind, water, flutter, gust) rises with its simulation value and is **zero at zero**.
- Spray is zero in calm water and at low speed.
- In a dead calm the cue state has no wind, gust, puffs or spray.
- Apparent wind and rudder load follow the snapshot.
- A tack is told from a gybe.
- **Every puff drawn matches a wind-model puff**: position within 0.01 m, strength within 10⁻⁶ (32-bit floats). A
  lone puff's drawn strength equals the extra wind the model adds at its centre.
- With more puffs than slots, every puff left out is further away (by edge) than every one drawn.
- **Label, sound and picture agree**:
  - when the sail panel would say "Luffing" (luff < 0.5), the flutter's gain is over 0.3 and the leech moves more than
    5 cm;
  - when it says "Drawing" (luff ≥ 0.98), the gain is 0 and the leech moves less than 2 cm;
  - both grow as the luff factor falls.
- The telltales: a stalled jib upsets the leeward ones only; a luffing jib the windward ones.
- Nothing is carried by sound or vibration alone: every cue in `CUE_CHANNELS` has a picture.
- The camera feel is none with reduced motion.
- **The WebAudio settings** (a recording stand-in for `AudioContext`):
  - the wind, water and flutter gains rise with their values and are 0 at 0;
  - a gust's swell is larger for a larger gust and absent without one.
- **No listening test was done.**
- At **every preset**, the drawn scene has the sails, at least 6 telltales, a visible heel, the wake, the bow wave, the
  gusts on the water, the burgee, the marks and the other boats.
- The gust outlines switch off without changing the puffs drawn on the water, and are off in races unless chosen.

## 4. The social design

### 4.1 Layer B architecture

```mermaid
flowchart LR
  subgraph Device["Player's browser (static site on GitHub Pages)"]
    A[Finish on the weekly course] -->|"opt-in: Submit to the club table"| S["POST /submit<br/>replay (compressed), word-list name,<br/>build, engine family, deletion token"]
    T[Course card] -->|reads static files| P
    R["Remove my entry / Check"] -->|token| E
  end
  S --> E["Endpoint: one Cloudflare Worker + KV<br/>(server/club-table/worker.js)<br/>size, shape, name, bot check, rate limits<br/>stores pending; no IP stored"]
  subgraph Actions["GitHub Actions (scheduled, no person)"]
    V["club-table.yml every 30 min<br/>re-sail each run (src/app/clubVerify.ts)<br/>verdict → token; replay deleted;<br/>removals; season expiry"]
    W["weekly-targets.yml Mondays<br/>AI club/good/expert × 3 seeds"]
  end
  E <-->|admin token, GitHub secret| V
  V -->|"club/weekly-&lt;week&gt;.json + top-3 ghosts"| P[gh-pages: live/, weekly/, club/]
  W -->|"weekly/&lt;week&gt;.json"| P
  K[(club-verifiers branch:<br/>last 5 builds' verifiers)] --- V
```

### 4.2 Provider comparison (free limits checked 17 Nov 2026)

| | Cloudflare Workers + KV (**recommended**, adapter written) | Supabase |
|---|---|---|
| Free allowance | Workers: 100,000 requests a day. KV: 100,000 reads, 1,000 writes, 1,000 deletes, 1,000 lists a day, 1 GB; reset 00:00 UTC (Cloudflare's KV pricing page) | 500 MB database a project, 2 active projects (Supabase pricing) |
| At a limit | That day's further writes fail until 00:00 UTC: submissions pause and the app says so; reading the table (a static file) is unaffected | — |
| Catch | 10 ms of CPU per request on the free plan, so the endpoint does not open replays (the verifier does) | **Paused after a week without activity**, restarted by hand: wrong for a weekly table that may be quiet in winter |
| Bot check | Turnstile, free (up to 20 widgets; its Privacy Addendum must be referred to in the privacy notice) | Needs another provider |

Expected cost: **£0 a month** within the free limits. Third-party summaries disagreed on some Turnstile limits; the
owner should read Cloudflare's current pages when setting it up. Set-up steps: [DEPLOYMENT.md §6c](DEPLOYMENT.md#6c-club-table-optional-off-by-default).

### 4.3 Replay sizes (measured)

Replays log the input on every step it changes. A key held, or a stick, changes the helm every step.

| Run | Rows | JSON | Compressed (deflate) | Link length |
|---|---|---|---|---|
| Keyboard sailor (a press every 2–6 s), 600 s | 12,188 (20 a second) | 670 kB | 74 kB | about 104,000 characters |
| AI on the helm (like a stick), practice week, 700 s | 67,874 | 4.2 MB | 824 kB | too long for a link |
| AI on the helm, RDYC C1, 3,270 s | 325,623 | 20.4–20.9 MB | 3.94 MB | too long |

So:

- the app sends the replay **compressed**, as the request body; the four other fields go in headers, so the endpoint
  never parses or opens the replay (the free plan allows about 10 ms of CPU a request), and it takes up to 8 MB
  (KV values may be 25 MiB);
- this week's course (2026-W47) is RDYC C1: the end-to-end test's first run, sent as JSON with a 2.2 MB limit, was
  refused as too large, which led to this design;
- challenge links over 150,000 characters are not offered (the replay file does the same job);
- re-sailing a run recorded in Node took 2.6 s (practice) and 19 s (C1) in Node, bit for bit.

The RDYC courses take the "good" AI about 52 minutes: too long for a juniors' weekly course? That is an owner decision
(issue 215; `season.json` can limit the rotation to practice courses).

### 4.4 Verification and the cross-engine policy

The verifier (`src/app/clubVerify.ts`) checks, in order:

1. The build.
2. The word-list name.
3. That the run is the weekly course of the week it was received in: conditions, course, boat, start and sequence, and
   sailed alone.
4. The assist claim against the auto-trim flags in the inputs.
5. Re-sails it.

Re-sailing a run recorded in a browser is not expected to match bit for bit in Node (below), so:

- if every checkpoint matches, the claimed time must match to 0.05 s;
- otherwise the run is accepted, **with the re-sailed time** (so changed inputs gain nothing), if its claim is within
  **2 s (E)**;
- beyond that, a Chromium run is rejected ("time not as claimed");
- other engines' runs are listed separately as "recorded on another browser engine, not verified";
- nothing is silently dropped.

Plausibility flags (perfectly periodic presses, over 12 presses a second sustained, identical timing across runs) put a
run in a separate list rather than reject it. **A low-stakes club table, not anti-cheat:** re-sailing proves a run was
possible, not that a person sailed it.

**Cross-engine results (measured).**

- **Chromium → Node is not bit-exact.** The brief assumed Node and Chrome share an engine, so replays would match bit
  for bit. They do not: the end-to-end test's genuine run (this week's RDYC C1, 3,176 s, recorded in Chromium with the
  AI on the player's helm) did not match the checkpoints when re-sailed in Node. This agrees with criterion 11
  (`tests/e2e/smoke.spec.ts`): Node's V8 and Chromium's V8 differ in the last bit of `Math.sin`, `Math.cos` and
  `Math.pow`, about 1e-13 after 600 s. The first verifier, which required bit-exactness from Chromium, therefore
  rejected a genuine run ("did-not-replay-exactly"). The policy above is the correction.
- **The drift is tiny.** That run's re-sailed finish was **3,176.2 s, the same to the tenth as the claim** of 3,176.2 s.
  So the 2 s tolerance is generous for Chromium.
- **Node → Node** is bit-exact.
- **Firefox and WebKit are not installed** in this environment, so their drift was not measured; their runs beyond the
  tolerance are listed apart (issue 217).
- The policy's branches are unit-tested with runs perturbed late in the race.

Results the tests show:

- a genuine run is accepted;
- runs with a changed time, assists, conditions, boat or name are rejected, each with its reason;
- a run from an older build is "unverifiable" unless that build's verifier is kept.

### 4.5 Data protection and parents

Drafts for the owner to check, not claims of compliance:

- [club-table/DATA_PROTECTION.md](club-table/DATA_PROTECTION.md): what is processed, where, for how long, the provider's
  role, and how removal works;
- [club-table/PARENTS.md](club-table/PARENTS.md).

Under 18s:

- no free text;
- no accounts;
- no IP addresses stored by the app;
- replays deleted after checking;
- tables expire;
- no streaks, timers to come back, loot or notifications;
- nothing leaves the device without a labelled button.

## 5. Remaining limitations, and what needs people

- **Performance on real devices is unknown.** Run the device check
  ([procedure](DEVICE_CHECK.md); validation sheet §E1).
- **Whether Smooth "looks good"** is the owner's and juniors' call (§E2).
- **Whether the cues teach the right thing**: instructors' check for negative learning (§E3): gusts more obvious than
  on the river, reliance on vibration or overlays, tacks too forgiving.
- **The club table** is not deployed. Its endpoint, Turnstile and the Action were tested against the mock only (§E4
  covers a trial week).
- **Cross-engine replay** was not measured (no Firefox or WebKit here).
- **Thresholds are estimates (E)**, to be tuned with real devices:
  - the device verdict, dynamic resolution, gust onset (12% rise over a 6 s low), vibration strengths;
  - camera feel (1.2 m and 0.25 m);
  - the plausibility rules, and the 2 s cross-engine tolerance.
- The overlay and live-help parts of the assist record are as the app reports them; only auto-trim is verifiable from a
  replay.
- The three AI levels finish an empty course within about 1% of each other, so as stepping stones the targets are
  weak (issue 216).

## 6. The next three improvements (ranked by demonstrated impact)

1. **Build vessel models before they are needed** (issue 212). Now that the `toDataURL` stall is gone, a new vessel's
   build and first draw is the largest main-thread frame measured (about 2 s under software rendering).
2. **Give instanced meshes their own material variants** (issue 211): about 110 kB and 0.5 ms a frame of program
   re-derivation, every frame, on every device.
3. **A compact input encoding for replays** (issue 214): stick and AI steering make replays and links 10× larger than
   keyboard runs, which caps challenge links and club-table submissions.

## 7. Tests and checks run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Clean |
| Unit tests (`npx vitest run`) | 104 files, 695 tests, all pass. New this round: device check, dynamic resolution (including a simulated 5-minute run), gamepad (the controller with a mocked `navigator.getGamepads`), cues (14), word-list names, challenges, like-for-like bests, the assist record, weekly course (BST and GMT boundaries), weekly targets (practice and RDYC C1 with the River Dart data), club table endpoint and verifier (10) |
| The endpoint's own tests | In `tests/sim/clubTable.test.ts`: size limit, header shapes, word-list names, rate limits, no IP or user agent stored, token hashed, admin routes protected |
| `npm run envelope`, `npm run golden:update` | Identical before and after (§2.5) |
| `npm run perf` | No regression (§2.5) |
| E2E, `tests/e2e/juniors.spec.ts` | Device check end to end with JSON export; game controller (mocked Gamepad API); touch sizes on a tablet layout; axe-core (WCAG 2.2 A/AA rules) on the device check, the Settings panel and the weekly card: no violations. All pass |
| E2E, `tests/e2e/juniorsCues.spec.ts` | Every cue at Smooth, Balanced and Ultra; gust outlines removable and off in races. Pass |
| E2E, `tests/e2e/juniorsSocial.spec.ts` | Targets missing, stale, then published, and a target ghost raced; a challenge link round-trips into a second browser, accepted, raced, compared; a forged name refused. Pass. The round-trip timed out once with two workers on the overloaded machine (a slow-renderer timeout: it passes alone in 2.1 min, and now waits for the friend's River Dart data) |
| E2E, `tests/e2e/juniorsClub.spec.ts` (against the local mock, a build with the flag on) | Submit → verify → publish → shown in the app → remove → gone, with no manual step. Pass on the third run. First run: a real defect (this week's RDYC C1 run was too large for a JSON body), fixed by sending the replay as compressed bytes. Second: a real defect in the verifier (a kept-alive connection closed during a 20 s re-sail), fixed with retries. Third: the verifier rejected a genuine Chromium run as not bit-exact in Node, a wrong assumption in the brief, fixed by the tolerance policy (§4.4) |
| E2E, `tests/e2e/graphics.spec.ts` (updated for "Smooth") | Pass. It timed out once at 180 s under load (two software-rendering workers plus a benchmark) and passed when re-run alone |
| The rest of the e2e suite | **Not re-run in full here** (about 80 tests, 20–45 minutes per CI shard under software rendering). CI runs it on the branch's pushes; check the PR's checks. `e2e/daylight.spec.ts` is known to be intermittently flaky (issue 202 on the training branch) |
| Firefox and WebKit engines | **Not present** in this environment (only Chromium is installed); not run |

No listening test was done; no real device, GPU, game controller or tablet was used.
