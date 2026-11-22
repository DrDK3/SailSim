# Fixes and small additions after the next round

Requested 21 Nov 2026 (the owner's "SailSim: fixes and small additions after the next round", from the review of
21 Nov 2026). One branch, `fixes-21nov`, and one draft pull request ([#46](https://github.com/DrDK3/SailSim/pull/46)). Section numbers are the request's.

**Software rendering only.** Every screenshot and every frame here comes from Chromium's software renderer
(SwiftShader) in a container: nothing was seen on a real GPU or a real phone. Nothing is validated: "measured" means
measured in the model, not against a Squib on the water. **No physics changed** (§4): no coefficient or force; the
golden traces and `npm run envelope` are identical before and after.

## 1. What changed, item by item

### §2.1 The spinnaker call no longer survives a restart

**Before:** a restart without new controls (Reset, Apply in Conditions, starting a quick race, the river card's
Restart) carried every control over except the helm, so a spinnaker hoist called before it was carried into the new
run and the crew hoisted at the start.

**Now:** such a restart clears the spinnaker calls (hoist and pole gybe) and keeps every other control
(`carriedInput` in `src/app/controller.ts`). A replay still starts from its own recorded controls.

**Evidence:** `tests/sim/spinRestart.test.ts` (6 tests); 4 of them fail on `main` (the hoist at the new start), all
pass now.

### §2.2 Rule 18 penalties behind a switch, off by default

**Now:** `markRoomPenalties` (Settings → Advanced), **off**. Off, a contact at a mark is ruled and penalised under rules
10–13, as before package F, and the incident says: "Rule 18 (simplified, advisory): X should have given mark-room. No
penalty applied until the club has reviewed this rule." The pre-round ruling stands. On, package F's ruling: the boat
owing mark-room is at fault under rule 18.2. **The AI is unchanged**: it keeps clear at marks as package F made it,
either way.

- A race's recording carries the setting only when on (`markRoomPenalties: true`); a replay rules as the race was
  sailed, whatever the viewer's switch. Older recordings (no field) replay with it off: as before package F. A race
  recorded under package F's rule while it was live (part of 21 Nov 2026) and penalised under rule 18 would replay with
  the advisory ruling instead, and its replay says where it diverges, as for any recording from another build.
- `docs/RACING.md` "Simplified rule 18" says so.

**Evidence:** `tests/sim/markRoomPenalties.test.ts` (7 tests); the default case fails on `main` (it penalises under
rule 18), all pass now.

### §2.3 A spinnaker table for the coach, the laylines and the AI

**Before:** the AI's target table (`src/sim/ai/polarData.ts`) was the boat without a spinnaker (issue 261). A boat
running under spinnaker was scored by the coach against it, so a steady run at the spinnaker's best angle scored
110–117% of "target" (6–12 kn), and the laylines on a run were drawn at the angles without one.

**Now:**

- **The table:** `src/sim/ai/polarDataSpin.ts` (`npx tsx tools/ai-polar.ts --spin`): the same model sailed with the
  spinnaker set and drawing, by the crew's own policy, for two minutes at each point. Aft of 90° and up to 20 kn each
  point takes the faster of the two; elsewhere it is the table without one. Neither table sends a boat nearer dead
  downwind than 175°. Model output with the spinnaker's estimated coefficients (E). A staleness test regenerates a
  point and compares.
- **The coach:** a boat that carries the spinnaker is judged against the spinnaker table, and the debrief names the
  table it judged by ("model polar with the spinnaker set, E" or "model polar without a spinnaker, E"). The spinnaker
  advice uses the table's angle.
- **The laylines** on a run: at the spinnaker table's angle when the boat carries one.
- **The AI** steers by the spinnaker table only while racing in 20 kn or less, where it flies its spinnaker. Before the
  start and above 20 kn it keeps the table without one: the first version used it everywhere and moved the AI's
  pre-start timing (5-boat clean races 98 → 97, every new failure at the start); that version is superseded.
- **Recorded races re-sail as sailed:** a race with spinnakers now records `aiSpinPolar: true`, and its replay steers
  the AI by the spinnaker table; a recording without it (every race recorded before) replays with the AI on the table
  without one, as it was sailed. A 700 s race with three AI boats under spinnakers, recorded on `main`, replays here
  with all 70 of its checkpoints matching; forced onto the new table, the same recording diverges at 370 s (on the
  run). The club table's verifier re-sails through the same replay.
- **The weekly targets** use it only from the next ISO week boundary after release: **2026-W49** (Monday 30 Nov 2026,
  Europe/London; `AI_SPIN_POLAR_FROM_WEEK` in `src/app/weekly.ts`), never mid-week. Until then the week's fleet carries
  the spinnaker but steers by the table without one, as when the week began. **If this is merged on or after
  30 Nov 2026, move that constant to the week after the merge** (issue 272).

**Evidence:**

- `tests/sim/spinPolar.test.ts` (16 tests): a steady two-minute run at the spinnaker table's best angle scores
  **100%** (the test asks 95–105%), against **117%, 111% and 110%** at 6, 8 and 12 kn when judged by the table without
  one (the old behaviour, kept as a test); the table chosen by whether the boat carries a spinnaker, in a race, in the
  app and in the weekly targets before W49; the laylines' angle; a recording's flag written and honoured, and a
  recording without it replayed on the old table (both fail without the flag).
- **The reference race hash** (`npx tsx tools/race-hash.ts`, no spinnaker): **33623f273ed1c7bd** on `main` and after:
  unchanged. Its spinnaker variant (`--spinnaker`, added here: the same race with every boat carrying one):
  **33623f273ed1c7bd → 65151f915dd394bc**. On `main` it equals the race without (no boat hoists within its 400 s, the
  AI's downwind leg not reached under its old table timing); now the AI's downwind angles under spinnaker differ, as
  intended: AI and coach data, not physics.
- **AI trials** (`npm run ai:trials -- --first 101 --runs 100`, seeds 101–200, never used for tuning; "clean" is a race
  with no contact and every boat finishing):

| Fleet | `main` | After |
|---|---|---|
| 5 boats, no spinnakers | 98 of 100 | **98**: all 100 races identical to package F's final run |
| 10 boats, no spinnakers | 81 of 100 | **81**: all 100 races identical but one contact's ruling (seed 134, not clean either way: "did not give mark-room (rule 18.2)" is now "did not keep clear (rule 10)", the advisory default of §2.2) |
| 5 boats, spinnakers (`--spinnaker`) | 98 of 100 | **99** (contacts 2 → 1; the one left is the pre-start contact on seed 122, as on `main`) |
| 10 boats, spinnakers | 85 of 100 | **88** (contacts 27 → 19; mark touches 3 → 0; the 6 pre-start contacts on the same seeds as on `main`) |

The request's bar, "no fall in clean races from today's 98 and 81 of 100", is met for the races it names (no
spinnakers): the same races. With spinnakers, where the change acts, clean races rose at both sizes (98 → 99, 85 → 88);
within the noise of 100 races, but no fall. The superseded first version (the table before the start too) gave 97 and
85: its one lost 5-boat race was at the start, which is why the AI now keeps the table without one until the gun.

### §2.4 The overlay's VMG, the phone's pills, Learn's wind in words

- **The teaching overlay's VMG** is the instruments' (`vmgShown`: upwind or downwind by the true wind angle, never a
  negative number); before, it showed the raw signed figure ("VMG −1.6 kn") beside instruments saying "VMG downwind
  1.6 kn". `src/app/vmgShown.ts`, used by both; `tests/render/teaching.test.ts` compares them (fails on `main`).
- **Phone pills:** on a phone upright the sails' state words were cut off ("Luf…", "Dra…" at 390 px). The state now
  takes its own line under the sail's name and toggle, the module's width; a long Learn phrase may wrap. At 360 px the
  helm's words were cut too ("Str…"): they take their own line under the tiller. At 360, 390 and 430 px and at every
  level, every word a pill or the helm can show measures `scrollWidth <= clientWidth`, every sailing control is at
  least 44 px, and the 3D view keeps at least half the screen's height (`tests/e2e/fixes21.spec.ts`; fails on `main`).
  At Expert on a phone the instruments stay a compact strip (Expert opened them all over the water before).
- **Learn's wind in words**, in bands: from ahead (within 20° of the bow), from ahead on your left or right side
  (20–70°), from your left or right side (70–110°), from behind on your left or right side (110–160°), from behind
  (160–180°), with "dead ahead" and "dead behind" within 5° (bands E: chosen for teaching, not from a source). The
  number stays alongside, small: "Wind: from your right side (109°)". Club and Expert keep "TWA 109° stbd".
  `src/app/windWords.ts`; `tests/sim/instrumentWords.test.ts` and the e2e.

Screenshots: `docs/img/fixes-21nov/phone-{360,390,430}-learn.jpg`, `overlay-vmg-learn.jpg`, `learn-wind-words.png`,
`club-wind-twa.png` (made by `node tools/fixes21-shots.mjs docs/img/fixes-21nov`).

### §3.1 Feature switches

Settings → Advanced, kept in this browser (`squib.flag.<name>`; a private window gets the defaults):

| Switch | Default | Off |
|---|---|---|
| Spinnaker | on | No spinnaker anywhere: races, the weekly course, free sailing and the AI fleets sail without one, as before package B |
| River data joins a run in progress | on | When the River Dart data arrives, the run restarts with it, as before package A |
| Plain words at Learn | on (at Learn) | Learn uses the same words as Club, as before package A |
| Learn map | on | No Learn map in Settings or the welcome, as before package D |
| Mark-room penalties (rule 18, simplified) | **off** | Rule 18 advisory (§2.2) |

A replay recorded with the spinnaker still sails with it when the switch is off (it re-sails as recorded).
**Evidence:** `tests/sim/flags.test.ts` (each switch off and on, defaults, storage blocked, the spinnaker and river
behaviours off), `tests/sim/markRoomPenalties.test.ts`, and the e2e (the five switches axe-clean with text ≥ 12 px;
plain words off and on; the Learn map menu item with the switch on and off).

These are per-browser switches for the owner and testers, not a site-wide setting: switching a feature off for every
visitor still needs a one-line change of its default in `src/app/flags.ts` (issue 274).

### §3.2 Bests keyed by the rules

Bests for the weekly course, its long course and today's challenge are now keyed with the ruleset
(`weekly:2026-W48:r2`, `weekly:2026-W48:long:r2`, `challenge:2026-11-21:r2`; `RULESET` in `src/app/bests.ts`). A best
under an older key (sailed before the spinnaker and rule 18) still loads and is shown apart, "Earlier rules (not
compared)" in the social panel and "Under earlier rules: m:ss (not compared)" in Quick race; it never beats or is beaten
by a time under the new rules. The Learn map counts it as done. **Evidence:** `tests/sim/rulesetBests.test.ts`.

### §3.3 Look up as a toggle

Settings → "Look up: hold / toggle" (default hold, as before). Toggled, one press of T or the button looks up and stays
up; the next looks back; the button is `aria-pressed`. Reduced motion cuts straight there and back in both modes.
**Evidence:** `tests/sim/lookUpToggle.test.ts` (both modes, the window losing the keys, reduced motion) and the e2e
(the button pressed and announced, reduced motion).

### §3.4 The helm view upwind

The helm's eye 0.10 m higher and 0.08 m further outboard (within the side deck), and the default field of view 74°
(was 68°; a browser that chose its own keeps it). A setting, "Crew in helm view: shown / faded" (default shown),
labelled a presentation choice: faded draws the crew see-through (30%). In the test's view on a beat the crew cover
**27%** of the picture (36% before). **Evidence:** `tests/render/helmViewCrew.test.ts`, `tests/render/helmEye.test.ts`
and the e2e screenshot test on both tacks: `docs/img/fixes-21nov/helm-{starboard,port}-crew-{shown,faded}.jpg`.

### §3.5 Where the spinnaker sets

A geometric test on both gybes and on a broad reach (`tests/render/spinnakerSet.test.ts`): the full spinnaker's
centroid is forward of the forestay and on the pole's side, and the pole's outer end is to windward, forward of the
mast. Screenshots for a sailor to check, from astern, abeam (the pole's side) and ahead on each gybe, at a fixed scene
(10 kn from 225°, steady, a broad run, 30 s after the hoist call): `docs/img/fixes-21nov/spinnaker-{starboard,port}-
{astern,abeam,ahead}.jpg` (`node tools/spinnaker-shots.mjs`). No physics changed.

### §3.6 The hero and the social card

`npm run media` now makes the hero (1600 × 900) and the social card (1200 × 630) from an AI fleet running under
spinnaker in Start Bay: a quick race on the short course (six AI boats, seed 21, 11 kn from 225°, steady), when most of
the fleet has set its spinnaker, a fixed camera on their quarter. **The Balanced preset**, drawn at twice the size and
scaled down in the browser. The caption stays ("simulator output, not a photograph"). The marks' name labels are hidden
with the rest of the interface.

- **The trailer's poster** is now its own frame at 2 s (`public/media/poster.jpg`), so the landing page's hero and the
  poster differ. The trailer stays as it was, at the lowest preset.
- The river card that was `social-card.jpg` is kept as `social-river.jpg`. The page metadata's alt texts describe the
  new card.
- **Future videos go to a GitHub Release**, not the repository (docs/DEPLOYMENT.md); the trailer already committed
  stays (no history rewritten).

### §3.7 A post-deploy check

`.github/workflows/post-deploy-check.yml` runs after each successful deploy and every Monday at 06:00 London time (two
UTC schedules; the job keeps the one that is 06:00 in London), or by hand. `tools/post-deploy-check.mjs`, in
Playwright: the live site reaches a sailable state (after waiting until Pages serves the deployed commit), the social
card, the manifest and its icons return 200, `landing.html` loads with its hero drawn, and on Mondays `weekly/` holds
this week's targets. It only reads; a failed check fails the run. Documented in docs/DEPLOYMENT.md §3.

**Evidence:** run locally against a copy of the build: all 13 checks pass; with the card removed and last week's
targets file, 2 fail and it exits 1; with another commit expected, it fails on the build. The week it looks for is held
to the app's own by `tests/sim/postDeployWeek.test.ts` (every 7 hours through 2026–2027, the clock changes, midnight in
London). **Not run on GitHub**: `workflow_run` and `schedule` workflows run only from `main`, and this environment's
network does not reach the live site.

## §4 Verification

| Check | Result |
|---|---|
| Every fix's test fails on `main`, passes after | §2.1: 4 of 6 fail on `main`. §2.2: the default case fails (it penalised under rule 18). §2.3: the table does not exist on `main`; the old scoring is kept as a test (110–117%). §2.4: the overlay test and the phone e2e fail on `main` (cut pills); the helm's "Str…" at 360 px was seen in this round's own first screenshot, then fixed and added to the e2e. All pass after |
| Golden traces | Identical: `npm run golden:update` regenerated the four plain traces with only their "generated" date changed, and the two spinnaker traces byte-for-byte; the committed files were restored |
| `npm run envelope` | Byte-identical to `main`'s |
| Reference race hash | `tools/race-hash.ts`: 33623f273ed1c7bd before and after. With spinnakers (`--spinnaker`): 33623f273ed1c7bd → 65151f915dd394bc, explained in §2.3 |
| `ai:trials` | §2.3's table |
| Old data loads | Older bests (no ruleset) load and are shown apart (`rulesetBests.test.ts`); a spinnaker race recorded on `main` re-sails here with every checkpoint matching (the AI on its old table, §2.3); recordings without the new rule-18 flag replay with rule 18 advisory, and with the flag as recorded (`markRoomPenalties.test.ts`); a replay with the spinnaker sails with it when the switch is off (`flags.test.ts`); older settings without the new preferences read as before (`lookUpToggle.test.ts`, `helmViewCrew.test.ts`); the existing replay, link and scenario tests all pass |
| Each switch switches cleanly | `flags.test.ts` (each off, on and back to its default; storage blocked), the e2e (Settings → Advanced; plain words; the Learn map) |
| Screenshots | `docs/img/fixes-21nov/`: phone pills at 360, 390 and 430 px; the overlay's VMG; the Learn wind words (and Club's TWA); the helm view on both tacks, crew shown and faded; the spinnaker from astern, abeam and ahead on both gybes; `public/media/hero.jpg`, `public/social-card.jpg` and `public/media/poster.jpg` |
| axe-core; text ≥ 12 px; reduced motion | The feature switches axe-clean (WCAG 2.1 A/AA) with text ≥ 12 px; the landing page axe-clean (`share.spec.ts`); look up with reduced motion cuts, held and toggled |
| Typecheck, lint, unit tests | `npm run typecheck`, `npm run lint`: clean. `npx vitest run`: 147 files, 983 tests, all pass |
| Browser tests here | `tests/e2e/fixes21.spec.ts` (10 tests) and `tests/e2e/share.spec.ts` (2): 12 of 12 pass (11 min, software rendering). The whole browser suite is CI's |
| CI on the pull request | CI runs on every push to it: its checks are on the pull request, and its description records the result |

## 2. What was not done, and why

- **The post-deploy check was not run on GitHub** (§3.7): `workflow_run` and `schedule` workflows run only from the
  default branch, the request forbids running workflows by hand, and this environment's network does not reach the
  live site. It was run locally against a copy of the build, passing and failing as it should (issue 275).
- **The live site after the last deploy was not looked at** for the same reason (the proxy refuses the Pages host).
- **The trailer was not re-rendered** (allowed: it stays at the lowest preset); only its poster is new.
- **No site-wide feature switch** (§3.1): the switches are per browser, without a server (issue 274).
- **The AI does not use the spinnaker table above 20 kn or before the start** (§2.3): it does not fly the spinnaker
  above 20 kn, and using the table before the start moved its start timing (the first version).
- **20-boat fleets were not re-measured**, as in package F; the 10-boat target of 90% clean (package F) was not
  pursued here: this round changes only what the AI steers by downwind.
- **One pull request**, not two: §3 stayed small enough.
- **Nothing was checked on a real phone, tablet or GPU** (#32).

## 3. Needs people

1. **A sailor's check of the spinnaker screenshots** (§3.5): `docs/img/fixes-21nov/spinnaker-*.jpg`. Is the set
   position, the pole's angle and the sail's shape right for a Squib? (Issue 273.)
2. **Instructors' review of rule 18** before `markRoomPenalties` is switched on (§2.2; docs/RACING.md "Simplified
   rule 18"; issue 271).
3. **#28 A validation session with Squib sailors** (docs/STATUS.md): nothing in the simulator is validated. This round
   adds to its questions: the spinnaker table's downwind angles (§2.3, model output: in 8 kn the best VMG with the
   spinnaker at 156° true, without it 166°), the helm view's eye and field of view (§3.4), and the Learn wind bands
   (§2.4, E).
4. **#32 Real-device checks** (docs/STATUS.md): phones, tablets and a real GPU. The phone pills, the helm's words, the
   44 px controls and the view's share of the screen (§2.4) were measured in emulation at 360, 390 and 430 px only;
   the new hero and card (§3.6) at the Balanced preset in software.

## 4. The next three improvements, ranked by evidence

Ranked by how much measured evidence stands behind them.

1. **The AI's contacts in 10-boat fleets** (issues 42, 268). Measured on 100 seeds never used for tuning: 81 of 100
   races clean without spinnakers, 88 with them; the failures are categorised by seed (pre-start
   contacts, mark touches in a crowd, line-end touches just after the start). The start line's ends and the windward
   mark in a crowd are the next targets; the trials tool reproduces each seed.
2. **Real-device checks** (#32). This round found a cut-off label at 360 px only by looking at its own screenshots,
   after the pills' fix had passed its test: layout faults that emulation does not show are likely on real phones. The
   e2e measures (`scrollWidth`, 44 px, the view's share) are ready to run on a device farm or by hand.
3. **A validation session** (#28) on the downwind numbers. The coach's downwind score moved by 10–17 points with the
   table alone (§2.3), and the spinnaker's coefficients are estimates (issue 258): sailors' figures for a Squib's
   angles and speeds under spinnaker would anchor the coach, the laylines, the AI and the weekly targets at once.
