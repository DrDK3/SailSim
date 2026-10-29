# Technical architecture

Status: **implemented**. This began as the proposal approved before Phase 1; it is kept up to date as the build changes (last: photo round, 28 Oct 2026). Where a section still reads as a plan, the phase reports say what was built.

## 1. Principles

1. **The simulation core is pure TypeScript.** It has no DOM, no Three.js and no wall-clock time. The same code runs in the browser, in Node (tests and the scenario runner) and later in a Web Worker.
2. **Fixed physics timestep** (dt = 0.01 s, 100 Hz), independent of frame rate. The renderer interpolates between the last two physics states.
3. **Determinism.** All randomness comes from a seeded PRNG. Inputs are applied on step boundaries from an input log. The same seed and inputs give the same state. This also makes replays nearly free.
4. **Provenance everywhere.** Every boat parameter, map asset and course carries its source ID and confidence tag (V / S(p) / S / E / N, as defined in `RESEARCH_REPORT.md`). Loaders reject data without provenance.
5. **Data is separate from the engine.** Courses, boat specification, calibration coefficients and geodata are versioned JSON or binary assets, not code.

## 2. Stack and trade-offs

| Concern | Choice | Why, and what was rejected |
|---|---|---|
| Language | **TypeScript (strict)** | Type safety for the physics, frames and units. Shared between the browser and Node tests |
| Build | **Vite** | Fast dev server; static production build with no server needed |
| 3D | **Three.js** (imperative) | Mature, light, good water and terrain examples. **React Three Fiber** was rejected for the 3D layer: its strength is declarative, UI-heavy scenes, whereas ours is a procedurally driven, per-frame-updated scene owned by the game loop, where reconciliation adds indirection and overhead. **Babylon.js** is viable but heavier, and its built-in physics would not be used |
| UI | **React** for DOM overlays only (HUD, course editor, scenario setup, validation dashboard) | Forms and editors benefit from components. React never touches the 3D scene; it subscribes to sim snapshots at 10–20 Hz |
| Charts (dashboard) | **uPlot** | Tiny and fast for live time-series |
| Physics | **Custom sailing model**. No Rapier, Cannon or Ammo | General rigid-body engines solve contacts and joints, not lift, drag, added mass or hydrostatics. Sailing forces would all be custom anyway, and two integrators fighting is a common source of instability. Simple boat-to-boat and boat-to-shore collisions will be hand-coded (circle and polygon tests) |
| Tests | **Vitest** (unit, property and scenario), **Playwright** (end-to-end smoke tests in the preinstalled Chromium) | Fast, TypeScript-native |
| Geodata pipeline | **Python** offline scripts (pyarrow, shapely, pyproj, numpy), already proven in `research/geodata/` | Produces compact static assets. No runtime GIS in the browser |
| Hosting | **Static** (GitHub Pages or Cloudflare Pages) | No server; zero cost at hobby scale |

## 3. Reference frames and units

- **Storage:** WGS84 latitude/longitude for every geographic datum (marks, landmarks, routes).
- **World (simulation):** local **North-East-Down** metres. The origin is the RDYC clubhouse centroid (50.34801 N, 3.57339 W), projected with a transverse Mercator centred on the origin (scale error is negligible over the 10 km area). Conversion functions live in one module, with round-trip tests.
- **Body:** SNAME/Fossen convention: x forward, y starboard, z down. Heading ψ is a compass bearing (clockwise from north). Heel φ is positive to starboard.
- **Renderer:** Three.js y-up. One conversion function maps NED to Three.js; no other module knows about Three's axes.
- **Units:** SI internally (m, s, kg, rad). Knots and degrees only at the UI boundary.

## 4. Simulation core (`src/sim`)

### 4.1 State

| Phase | Degrees of freedom | State |
|---|---|---|
| 1 | 3-DOF | Position (N, E), heading ψ; velocities **through the water** u (surge), v (sway), r (yaw rate). Heel is quasi-static, from moment balance |
| 2 | 4-DOF | Adds dynamic roll (φ, p). **Implemented**; the main boom angle and rate are actuator states updated once per step (hinged body). Phase 3 adds bottom contact (grounding) from the River Dart elevation grid; no new states |
| Later | Optional | Pitch and heave as a visual or wave-response layer |

### 4.2 Kinematics: water versus ground

```
V_ground = R(ψ) · [u, v]  +  C(x, y, t)      ← current is added only here
STW      = |[u, v]|                           ← never includes current
SOG/COG  = |V_ground|, bearing(V_ground)
```

### 4.3 Wind and apparent wind

```
W_g(x, y, t)   true wind over ground (environment model)
W_w = W_g − C  true wind over water  → what boat instruments call TWS/TWA
A   = W_g − V_ground = W_w − V_through_water   (apparent wind)
```

With heel, the apparent wind is projected into the heeled sail plane. Instruments show both TWS/TWA (relative to water) and ground wind (in debug).

### 4.4 Forces (body frame, summed about the centre of gravity)

| Component | Model | Known inputs | Estimated (calibration file) |
|---|---|---|---|
| **Sails** (main, jib) | Each sail flies to leeward until the sheet stops it: δ = min(sheet limit, free angle). Angle of attack α = AWA_eff − δ − twist offset. Lift and drag come from tabulated C_L(α) and C_D(α), with **luffing** below α_luff (C_L collapses, flapping drag rises) and stall above α_stall. Lift acts perpendicular to the apparent wind and drag along it; force acts at each sail's centre of effort (CE) | Areas, mast and boom lengths | C_L and C_D tables (seeded from published generic sail coefficients), jib–main interaction, CE heights, twist, depowering |
| **Keel and hull lateral force** | Lift from leeway angle at the keel (including yaw-rate inflow). Lift slope from effective aspect ratio (doubled for the hull end-plate); stall; induced drag C_L²/(π·e·AR) | Draft | Planform, AR, efficiency e, hull lift share |
| **Rudder** | Same lifting-surface model, with inflow from local leeway (reduced by the keel's downwash, a flow-straightening factor), yaw rate and rudder angle. Stall at about 18° (estimated) | — | Area, AR, flow-straightening factor, stall angle |
| **Hull resistance** | Friction from ITTC-57 C_F with wetted area. Residuary: a parametric R_R/(m g) versus Froude number table in Phase 1; the Delft Systematic Yacht Hull Series regression is deferred until its coefficients and the hull parameters are sourced. Heel resistance increment | LWL, beam, displacement | Wetted area, prismatic coefficient, LCB, form factor |
| **Inertia** | Rigid-body mass plus added mass (surge, sway, yaw, roll) | Mass 680 kg plus crew | Radii of gyration, added-mass coefficients |
| **Damping** | Linear and quadratic yaw and roll damping | — | Coefficients |
| **Righting moment** (Phase 2) | Hydrostatic GZ(φ) curve plus crew moment W·y·cos φ (crew position control) | Ballast 375 kg | VCG, GZ curve, crew weight and positions |

Phenomena that **emerge** rather than being scripted:

- **Weather and lee helm** come from the longitudinal separation of the sails' CE from the centre of lateral resistance, plus the heel-induced drive offset. Helm balance is shown on the HUD.
- **Tacks and gybes** emerge from the turning dynamics. The sail angle follows the apparent-wind sign change. The boom is a hinged body (Phase 2) driven by aerodynamic moment and limited by the mainsheet, so gybes, including crash gybes, emerge naturally.
- **Speed loss in a tack** comes from rudder drag, loss of drive while luffing, and hull drag.

**Integrator:** RK4 at 100 Hz. The render loop uses an accumulator with a sub-step cap of 8 per frame and drops simulated time beyond that (logged).

### 4.5 Environment models (`src/sim/env`). Every model is labelled with its provenance in the UI.

| Model | Phase | Description | Status |
|---|---|---|---|
| Wind | 1–2 | Base TWS/TWD from a pluggable `WeatherSource` (Manual, **Live Met Office**, optional Open-Meteo or local station, Replay; see `LIVE_WEATHER.md`). Seeded gusts (puffs with spatial footprint, advected downwind). Oscillating and persistent shifts (Ornstein–Uhlenbeck processes). Gust and shift parameters can be derived from live data. A terrain-shadow and funnelling layer was considered for Phase 3 but not built: there is no defensible method without local wind measurements | Model (E) or live data, labelled |
| Tide height | 2–3 | Pluggable `TideSource`: Manual (HW and LW entry), **Live** (EA Dartmouth gauge plus UKHO HW/LW events), Derived (harmonic constants from EA gauge history), Replay. See `LIVE_TIDES.md` | Measured or official data where live, labelled |
| Current | 2–3 | Phase 2 (implemented): uniform, analytic test fields, and a provisional uniform tidal stream driven by the tide timing. Phase 3 (implemented): channel-following field C = s(t)·f(x,y). f comes from tidal-prism continuity (potential flow weighted by depth) on the River Dart grid, normalised at the entrance (`GEODATA.md`). s(t) follows the tide phase, with separate flood and ebb peaks. A river term has its own pattern; its rate is a scenario setting, because EA Austins Bridge flow is not reachable here. Peaks are scenario parameters (default 2 kn ebb at the entrance, per the DHNA statement) | **Provisional, not measured** |
| Depth | 3 | A provisional raster (deep channel tapering to the banks, constrained by the OSM shoreline) plus tide height. Grounding below the draft | **Provisional** |
| Waves | hi-fi | Sea state (`seaState.ts`): JONSWAP fetch-limited growth over the mapped land with the wind relative to the water, an effective fetch over the stream, and wave–current interaction (conserved absolute frequency and wave action, blocking). Drives the water surface and spray coming aboard (PHYSICS.md §19) | Model; limits and open-sea fetch E |
| Marinas | round 3 | `marinas.ts`: berths laid out on OSM's pontoons (finger berths in the marinas, alongside on the river's pontoons), never on drying ground, another pontoon or another boat; occupancy by season; a 2 m grid planner (Dijkstra from each marina's entrance) gives every berth its way out | Layout and occupancy E |
| Railway | round 3 | `railway.ts`: the line from Kingswear's buffer stops to the edge of the map (OSM), the loop for running round, the tunnel (inferred); trains from the operator's timetable (F9): arriving, the engine running round, departing; each vehicle on the chord between its bogies | Times sourced (one day's), moves E; visual only |
| River traffic | hi-fi | `traffic.ts`: ferries and Dart Marina's boats as speed profiles over their routes (harbour limit, crabbing into the stream, holding for ferries), the Lower Ferry's tug manoeuvre and published timetable, its berths moving down the slips with the tide (tug afloat, on one side all day) and its two units standing off to starboard to pass port to port, A* deep-water routes (`fairway.ts`), and boats leaving from and returning to their marina berths (`marinas.ts`). Solid in the fleet physics (PHYSICS.md §20) | Timetables partly sourced, sizes and speeds E |

## 5. Data assets

```
data/
  boats/squib/class-spec.json     ← known values; each with source id + tag
  boats/squib/calibration.json    ← estimated coefficients (tag E) with notes
  courses/verified/*.json         ← only from official documents; status workflow
  courses/practice/*.json         ← simulated courses, always labelled
  geo/…                           ← built by tools/geodata, plus provenance.json
```

As built: the River Dart data lives in `public/geo/` (GEODATA.md). Its two Int16 grids are packed losslessly for download (`*.i16z`, `src/sim/geo/pack.ts`), and `manifest.json` carries the provenance. Live and replay weather and tide files live in `public/live/`, listed by `live/index.json` (DEPLOYMENT.md).

### Course schema (outline)

```jsonc
{
  "id": "rdyc-river-W1",
  "category": "verified-club" | "simulated-practice",
  "status": "draft" | "pending-check" | "verified",   // verified requires `verification`
  "source": { "document": "RDYC Sailing Programme 2026", "page": "12", "diagram": "Course W1", "url": "…", "retrieved": "2026-…" },
  "verification": { "checkedBy": "…", "date": "…", "notes": "…" },
  "marks": [{ "id": "M1", "name": "…", "lat": 0, "lon": 0, "kind": "club|navigation|laid|virtual",
              "positionSource": "…", "positionConfidence": "V|S|E" }],
  "start": { "type": "line", "ends": ["CB", "M1"], "side": "…" },
  "sequence": [{ "mark": "M1", "rounding": "port" }, { "gate": ["G1", "G2"] }],
  "finish": { "type": "line", "ends": ["…", "…"] },
  "laps": 1, "shortening": "…", "restrictions": ["ferry-lower", "…"], "safetyNotes": ["…"]
}
```

A **course validator** runs in both CI and the editor. It checks that:

- marks are in water, at a provisional depth greater than the draft, at the reference tide;
- legs do not cross land;
- restriction polygons are not violated;
- verified courses carry a `verification` block.

## 6. Race logic (`src/sim/race`)

- **Line crossing:** segment intersection between consecutive physics positions of hull reference points (bow, stern), with sub-step time interpolation. This handles start and finish, OCS, and gates.
- **Mark rounding:** the RRS "string" test (rule 28.2). The boat's track, joined to the previous and next marks, must enclose the mark with the correct winding sign, in sequence. Loops that unwind are handled by the winding count.
- **Phase 5 (as built; details in [RACING.md](RACING.md)):**
  - `fleet.ts`: all boats share one environment. Each 10 ms step computes hull–hull, hull–mark, hull–moored-boat and hull–ferry contact forces from the states at the step start (penalty method, convex outlines in `hull.ts`). It passes each boat its force as `Simulation.external`, then steps every boat.
  - `committee.ts`: rule 26 sequence with P, U or black flag; X (29.1); First Substitute and restart (29.2; recall policy E); triangle rule (30.3, 30.4); finishing window and time limit (E); Appendix A low-point results.
  - `rules.ts`: tack, overlap, leeward, rules 13, 10, 11 and 12; rule 13 state per boat; penalty-turn tracking (44.2). Incidents on contact (Part 2, rule 31); rules 14, 15 and 16 are noted, not judged.
  - `session.ts`: one race, combining the fleet, the committee, a `CourseJudge` per boat (rebuilt after a general recall), the rules, the incidents and penalties, and the AI skippers. Deterministic.
  - `src/sim/ai/`: `AiSkipper` (tactics 5 Hz, collision-avoidance search, 20 Hz collision reflex, PD helm per step), AI sheet handling, and the AI target-speed polar (model output, generated).
  - Flagged *not an authoritative adjudication system*.
- **Hot-path conventions (since Phase 5):** each step must not allocate, because garbage-collection pauses set the p99 frame time.
  - **Force functions:** they take an optional `out` record. `Simulation` passes its own reusable records (forces, RK4 stage derivatives, stage state). Callers that keep a result (the UI's snapshot) get fresh objects.
  - **`hypot2`** (`src/sim/math/hypot.ts`) replaces `Math.hypot` in the physics and AI. It is bit-identical to V8's `Math.hypot`, which allocates.
  - **Input log:** AI boats run with `logInputs: false`.
  - **Rule:** any such change must keep the golden traces and the race hashes bit-identical.

## 7. Rendering (`src/render`)

- **Water:** custom shader on a dense radial mesh round the camera, drawn only near tidal water (the pipeline's water mask, so low ground inland stays dry). Green-teal as the owner's photographs show it. Eight Gerstner wave trains, weighted per place by a 32 × 32 field of the modelled sea state (height, peak wavelength, whitecaps, steepness), foam on compressed crests. Since the graphics round ([GRAPHICS_REPORT.md](GRAPHICS_REPORT.md)): each pixel's footprint along each train's direction decides which trains it can show (anisotropic, from the screen-space derivatives), and the slope of the finer ones becomes GGX roughness (no shimmer, cheaper far off); 13 short-crested wind-ripple trains (5 with simple water); the sky's own light from the environment map (PMREM) with Fresnel; a GGX sun glint that spreads into a glitter path; colour by depth over the bed grid at the tide (LIDAR near the shore, provisional mid-channel) with a wash at the water's edge. The displacement (`SEA_DISPLACE`) is shared with `boatWater.ts`: the wake (Kelvin arms, rudder stir), the hull foam and bow wave, and bow spray lie on the same waves, for every boat.
- **Terrain:** chunked heightmap meshes from EA LIDAR (8 m grid; 4 m over the towns) with a Sentinel-2 colour drape, and detail the 10 m drape cannot show: fine variation, rock on steep slopes, mud and shingle on the tidal foreshore (illustrative).
- **Woodland** (`trees.ts`): instanced trees where the drape shows woods (dark, green-dominant pixels) and a few hedgerow trees in fields; since the photo round also on steep valley sides where the drape is dark or spoiled, and garden trees and shrubs among the houses (kept off roads and footprints); off the foreshore; seeded by place, built in chunks round the camera, coarser further off (illustrative, E).
- **Landings and structures in the water** (fix round): `src/sim/env/landings.ts` lays the river boats at rest alongside their pier edges (in order, rafted when an edge is full, nudged clear of other piers) and `RiverTraffic` blends each trip into and out of those poses; `src/sim/env/structures.ts` finds the OSM buildings standing in the water, which `raceStructures` (`race/setup.ts`) adds to the piers the fleet meets, start slots avoid and the AI steers round (`Fleet.nearStructure`). The Hindostan, a moored ship OSM maps as a building, is drawn as a minehunter on her outline (`minehunterModel`, `shipOnFootprint`; `dart.ts` `buildShips`).
- **Quay walls** (`src/sim/env/quays.ts`, drawn by `quays.ts`; photo round): stone walls along the towns' waterfronts where houses stand, found from the 4 m ground and the footprints when the data loads (`geoLoader.ts`); the ground behind is filled to their tops before the roads are cut, and the fleet meets them as fixed piers.
- **Buildings:** OSM footprints extruded, merged per chunk, on bases from the LIDAR ground. Heights come from OSM where present, otherwise estimated by class (labelled). Roofs from the pipeline (OSM roof:shape, else inferred: terraces gabled along the street with party walls, hips, flat). Added detail is illustrative, not data:
  - gable-end walls, hips, chimney stacks, slate or tile courses;
  - windows drawn per fragment from each wall's coordinates, some lit after dark, none starting below the ground along the wall;
  - painted-render colours like the waterfronts'.
  - **Place labels** are decluttered on screen by priority (marks, landmarks, ferries).
- **Landmarks:** bespoke low-poly proxies (Dartmouth Castle, St Petrox, Kingswear Castle, RDYC, BRNC, St Saviour's), progressively improved.
- **Harbour furniture:** pontoons from OSM; trot moorings with instanced moored boats (positions provisional); ferries as kinematic agents on OSM routes. Since the realism round, pontoons and jetties are drawn in detail (`pontoons.ts`: floats, planked decks, fenders, cleats, guide piles and hoops, jetty piles and rails, gangways that follow the tide) and are solid in the physics (`src/sim/race/piers.ts`).
- **Watertight boats:** each boat's hull is an open shell sitting in the water. An invisible cap over its deck marks the boat in the stencil buffer, and the water skips marked pixels, so the sea is never drawn inside a hull. The cockpit well is a closed tub.
- **Crew** (`crew.ts`): each sailor is one skinned mesh with a skeleton, posed every frame by two-bone inverse kinematics from the physics' lateral crew position and its rate: sitting in, sitting out and leaning back to hike with feet under the toe straps, crouching under the boom while crossing in a tack or gybe. The helm's hand holds the tiller extension (which swings from the tiller's end to it) and the mainsheet; the crew holds the leeward jib sheet; the sheets run to their hands (illustrative). Passengers on the ferries are the same figure, posed once and baked into static geometry. Since the realism round each sailor follows the weight through a critically damped spring (the helm a beat behind), crouches only when going across the boat (the physics reports where the weight is bound, `crewTo`), leans for gusts, pulls the sheets in strokes, and changes hands on the extension by reaching for it; every target is eased and rate-limited. Figures are built to measured statures (men 1.75 m, women 1.61 m) and a man's or a woman's build; the helm's is a scenario option (appearance only).
- **Squib:** procedural hull from parametric sections (principal dimensions from class data; shape estimated) with boot top and sheer stripe, foil-section keel and rudder, tapered mast, spreaders, wire rigging, boom, kicker and mainsheet, deck fittings, a cockpit per type (`squibModel.ts`), RDYC on the transom and the RDYC burgee streaming in the apparent wind (`burgee.ts`). Sail cloth is canvas-drawn (`squibTextures.ts`). Sails are deformable meshes driven by physics angle, camber and twist. Static parts are built once per type and shared by every boat.
- **Berthed and moored boats** (`berthed.ts`): a few reduced-detail models (sloops with covered sails, motor cruisers; 800–1,100 triangles) instanced by material and scaled to each boat; plain hulls beyond 420 m (150 m on a software renderer). The marinas' and pontoons' berths and the trot moorings share them; a berth is empty while its boat is out.
- **Railway** (`railway.ts`): ballast, sleepers (instanced) and rails on every OSM line at the smoothed ground level, platforms with white coping, Kingswear's train shed (trusses, boarded sides, glazed ridge) and canopy on lattice piers, tunnel mouths; the train (a tank engine and seven coaches) placed from the timetable, with smoke when working and steam when standing.
- **River traffic:** `traffic.ts` draws the vessels the traffic model places, modelled with the vessel kit (`vessels.ts`: lofted hulls, superstructures with framed windows, rails, fendering, masts, cars, passengers; merged per material, built once per version and copied): the Lower Ferry's float and its tug (moved separately), the Higher Ferry and its cables, the Dartmouth Princess, the Cardiff Castle (the Totnes river boat; as the owner's photograph shows her since the fix round), launches, motor cruisers, yachts and RIBs, with wakes and navigation lights. Since the pre-UAT round also the paddle steamer **Kingswear Castle** (`paddleSteamerModel`: black hull, closed paddle boxes, buff funnel with coal smoke from `railway.ts`'s `Exhaust`), placed by `RiverTraffic` from her published cruise times (`steamerSailings` in `src/sim/env/traffic.ts`: berthed at the South Embankment between cruises, A* routes to her turning points).
- **Sun and shadows** (`sunlight.ts`): on a real graphics card, cascaded shadow maps (three cascades to 1.1 km) shade the boat crisply and the town, woods and hills too; under software rendering one shadow map follows the boat (`?quality=high|low` overrides). Every lit material is set up for the cascades before it is first drawn, keeping its own shader changes.
- **Surface detail without textures** (`bump.ts`): slate courses, render, grass, rock and leaf clumps as bump patterns computed in the shaders from position, fading with distance.
- **Riding the waves:** each boat takes the heave, pitch and part of the cross slope of the plane fitted to the drawn sea over its waterplane (visual only).
- **Cameras:** chase (wheel zoom 7–45 m); **scenic** (a slow low circle 24–36 m off, kept over the water); helm (first person, drag to look round ±150°, double-click to look ahead, wheel to zoom); orbit (follows the boat); **drone** (OrbitControls panning across the map, to 6 km, kept above the ground, follow or stay, back to the boat); top-down (`scene.ts`, `frames.ts`). Changes between chase, scenic, helm and top blend over 0.7 s; the camera-motion setting sets how much of the heave and heel the views follow (0: a level horizon).
- **Landmarks** (`landmarks.ts`): bespoke looks matched to OSM footprints by a point inside (BRNC, Dartmouth Castle, St Petrox, Kingswear Castle, RDYC, the Royal Dart Hotel, Dart Marina Hotel), the Noss marina buildings, and rules for churches (stone, tall windows, gable, west tower). The building shader draws window styles (sash, tall, slits, brick with stone bands, glazed, shopfronts) and doors; a `Kit` builds battlements, cornices and balustrades, towers (embattled, or a clock stage with a lead dome), turrets, a flagstaff, a veranda and balconies in one mesh. RDYC is its own model since the pre-UAT round (`rdyc.ts`, from the owner's photographs): in the clubhouse's own frame on OSM's cross-shaped footprint, a builder adds walls, gables, hips, the bay, turret, balcony, porch and sign, sea walls and the terrace (`rdycPlatformAt`, which the ground and the roads use) as per-material meshes with canvas textures (brick, slate, stone) built in the browser; windows glow after dark; the pontoon's gangway and dinghy racks come from `buildRdycPontoonGear`; the club's ensign flies at colours (`clubEnsign.ts`, `colours.ts`: 0800/0900 to sunset, UK local time). Flags and vanes (`vane.ts`): traffic ensigns fly with each boat's apparent wind; berthed yachts carry a masthead vane into the true wind.
- **Roads** (`roads.ts`, pre-UAT round): each OSM road becomes a smoothed profile (3 m samples in town, 6 m outside, Gaussian smoothing, lifted a little by class so crossing roads do not fight); the town's 4 m ground grid is cut down to the carriageway across each road's corridor so the road never sinks into it; the surface is drawn as tiles of carriageway, kerbs, pavements (in town), banks and retaining walls, with a shader for asphalt grain, patching, wheel tracks and anti-aliased markings (centre dashes, edge lines, double yellows; flags per road, cleared at junctions). `surfaceAt` (a 12 m spatial index) gives the road height to the cars. On a software renderer the vertical faces are left out.
- **Robotic marks** (`robotMark.ts`, pre-UAT round): turning marks and pin ends are robotic marks (an inflatable on twin pontoons with a thruster pod, GPS mast and light) carrying a sponsor's name; `sponsorsFor` deals the four sponsors in a random order seeded by the course, and the marks lie head to wind (`course.ts`).
- **Street life** (`population.ts`): cars on the road surfaces (`surfaceAt`); instanced moving cars on a road graph (keep left, random turn at junctions), parked cars, walkers on footways and pavements, people on quays (with the land) and pontoons (with the tide); fewer at night. Illustrative (E). The people (`people.ts`) are a jointed low-poly figure animated in the vertex shader per instance (gait phase and rate, activity: walking, standing, chatting, leaning on the rail, sitting on benches; heights 1.55–1.80 m); groups, watchers, sitters and ferry queues are placed from the standing spots and the ferry landings.
- **Vehicle ferry slipways** (`dart.ts`): concrete ramps at both ends of the Lower and Higher Ferry routes.
- **Environment, realism round:** the land shapes the wind (`src/sim/env/terrainWind.ts`: shelter and valley steering from the terrain) and the stream has local departures (`src/sim/env/streamAnomalies.ts`: faster over deep water, Start Bay's coastal stream, northerly ebb); damage from impacts and hard groundings (`src/sim/boat/damage.ts`); start slots in clear water (`src/sim/race/setup.ts`). See PHYSICS.md §21–22.
- **Debug overlays:** force vectors (sails, keel, rudder, hull, current, wind) drawn as 3D arrows.
- **Sky and weather (Phase 6, visual only):** the environment map is rebuilt from the sky as the sun moves, with the sun's disc hidden while it is built (pre-UAT round: the disc had lit the whole scene as a second sun), at a strength that follows daylight and cloud. The sun's position for the run's time and place (`src/sim/env/sun.ts`, NOAA algorithm) lights the scene, through twilight to night. A procedural cloud dome drifts with the wind. Fog density follows the visibility (Koschmieder). Rain streaks follow the rain rate. All come from a sky preset or the forecast's hourly sky fields; the physics never reads them. Since the graphics round the sky model is dimmed before tone mapping (the environment light compensated), the haze takes the sky's colour 3° above the horizon toward the view (read from a 16-pixel render whenever the sky is rebuilt), the clouds take the sun's colour, and four lighting presets (`src/app/lighting.ts`) pick the time from the sun's position on the scenario's date.
- **Sails and hull (graphics round):** the sails' depth, draft and twist follow the flatten control, the sheets and the apparent wind (`sailTrim`), a luffing sail flogs faster in more wind, and sunlight shows through the cloth (`materialFx.ts`, gated by a terrain ray toward the sun, since the shadow map would shadow a thin sail's own far face); the hull has a wet band at the waterline.
- **Graphics settings** (`graphics.ts`, `src/ui/SettingsPanel.tsx`): Performance, Balanced and Ultra presets (resolution scale, pixel-ratio cap, scenery and shadow detail, water detail, foam, spray, haze, camera motion), chosen from the renderer and kept in `localStorage`.
- **Sound** (`audio.ts`): Web Audio synthesis of wind, water, luffing sails, the boom and halyards, driven by the simulation's state once a frame; separate volumes and mute (U); never fed back into the simulation.

## 8. UI (`src/ui`)

| Element | Contents |
|---|---|
| HUD | Heading and compass, STW, SOG, COG, AWA/AWS, TWA/TWS, main and jib trim, heel, tack, tide height, current set and drift, next mark (bearing and distance), race clock |
| Minimap | Canvas 2D: drape image, navigation marks, ferries, the course, the other boats of the fleet (in their colours) |
| Race panel and results | Flags shown, countdown, leg, next mark, place in the fleet, penalty owed, fleet events; results table (low points) |
| Scenario setup | Wind, gusts, tide times and heights, current scale, start time, course, laps, start position; seed |
| Course editor | Map-based: add, move, inspect and sequence marks; rounding sides; gates; import and export JSON; live validator output |
| Validation dashboard | Live plots of STW, VMG, leeway, α per sail, heel, rudder angle, forces and moments. A headless **polar sweep** tool that plots *model-predicted* polars, labelled as model output |
| Library (Phase 6) | Built-in practice scenarios, the user's own (browser storage), scenario export and import (`squib-scenario/1`); save and open replays |
| Replay bar (Phase 6) | Replaces the sailing controls while a replay plays: progress, verification, speed ×1–×8, Take over |

**Onboarding and layout (UX_REVIEW.md):**
- **First visit:** a welcome dialog.
- **Interactive tutorial** (`src/app/tutorial.ts`): its own open-water scenario, eleven steps. Each goal is checked against the boat every 0.1 s of simulated time, and the tutorial moves on two seconds after a goal is met.
- **App bar (round 3):** few controls in view. Pause or Resume (the primary action), Reset, the camera, Library and Scenario, then a single **More** menu (sections: learn and plan, show, physics tools; a WAI-ARIA menu button) and Help.
- **Sailing dock:** two rows (sails left; helm, sheets and crew right), beside the minimap; a sail's advice shows only when it needs something done; the dock can be put away (remembered) and the keys still work.
- **Escape** closes any panel.
- **One side panel at a time.**
- **Reset** asks first in a race that has started.
- **Instruments:** compact by default on every screen (speed, compass, tack, heading, TWA, TWS, heel, VMG, depth); the rest and the conditions one click away, remembered. With a race, the race panel stacks under them on the left.
- **Phones:** a separate layout below 700 px.

Panels that open on demand (scenario, library, dashboard, polar, debug, layers, course editor, results, help) are loaded when first opened (`React.lazy`); three.js and React are separate chunks (PERFORMANCE.md).

**Replays** (`src/app/replay.ts`, schema `squib-replay/1`). A recording holds:
- the scenario, with its course inline and any live-data snapshot inside it;
- the input the user's boat was built with;
- the user's input log (one row per step where an input changed);
- a state hash every 1000 steps and at the end.

AI boats need no log: they are reproduced from the scenario's seed. Playback rebuilds the run and feeds the inputs through the same per-step controller hook as the keyboard. It compares every hash, so it either proves the replay matches bit for bit or names the first checkpoint where it diverged. A replay is expected to match only on the same browser engine and build (OUTSTANDING_ISSUES 17, 46).

**Controls:** keyboard, plus on-screen buttons for touch.

## 9. Testing (summary; criteria in `DEVELOPMENT_PLAN.md`)

| Layer | Tooling |
|---|---|
| Unit and property | Frames, apparent wind, coefficient tables, force signs, line and rounding geometry |
| Scenario | JSON scenario plus input script, run headless by `npm run scenario`. Produces CSV traces and is compared against golden traces with tolerances |
| Render units (`tests/render`) | The sailors' rig (reach, grip on the extension, hiking feet, heads below the boom), the traffic models (every kind builds within a triangle budget, ramps hinge, copies share geometry) |
| End-to-end smoke | Playwright: app loads, canvas renders, controls change state, no console errors, graceful errors when assets are missing |
| Performance | `npm run perf`: headless benchmark with 1 + 20 boats, physics only and a full AI race. Manual frame-rate check on reference hardware |
| AI acceptance | `npm run ai:trials`: 100 seeded AI races (parallel processes), clean-run rate and every contact |

## 10. Deployment and operations

| Topic | Plan |
|---|---|
| Build | `npm run build` produces static `dist/` (typecheck, Vite, then the secret check). Geodata assets load after the first frame, each with its own error state |
| Hosting | GitHub Pages or Cloudflare Pages (free). Optional custom domain, about £10 per year |
| Live weather and tide | **As built (Phase 6):** a scheduled GitHub Actions job (every 30 min by day, hourly at night) runs the Met Office and tide ingest. It publishes `live/latest.json`, `live/tide.json` and `live/index.json` beside the static site, and a weekly job derives harmonic constants. The app judges each file fresh, stale or expired, and falls back to bundled replays, then to manual. See DEPLOYMENT.md |
| Secrets | **No secrets in the client.** The UKHO key, if used, is a CI secret read only by the scheduled job, which publishes the predictions as a file, so no proxy is needed. `npm run build` fails if a secret's value or a credential pattern appears in `dist/` |
| Licence obligations | An in-app attribution panel: "© OpenStreetMap contributors (ODbL)", "Overture Maps Foundation", "© Environment Agency copyright and/or database right 2015 (OGL v3)", "Contains modified Copernicus Sentinel data". The derived coastline and building database must be offered under ODbL (share-alike). No Admiralty chart data without a licence |
