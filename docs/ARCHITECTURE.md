# Proposed technical architecture

Status: **proposal for approval**. Nothing below is implemented yet.

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
| 2 | 4-DOF | Adds dynamic roll (φ, p) |
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
| **Rudder** | Same lifting-surface model, with inflow from local leeway, yaw rate and rudder angle. Stall at 20–25° (estimated) | — | Area, AR, flow-straightening factor, stall angle |
| **Hull resistance** | Friction from ITTC-57 C_F with wetted area. Residuary from the Delft Systematic Yacht Hull Series regression as a function of Froude number. Heel resistance increment | LWL, beam, displacement | Wetted area, prismatic coefficient, LCB, form factor |
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
| Wind | 1–2 | Base TWS/TWD. Seeded gusts (puffs with spatial footprint, advected downwind). Oscillating and persistent shifts (Ornstein–Uhlenbeck processes). An optional terrain-shadow and funnelling layer in Phase 3 | Model (E) |
| Tide height | 3 | User enters HW and LW times and heights (from EasyTide or the tide tables); cosine or rule-of-twelfths interpolation | User-provided data |
| Current | 2–3 | Phase 2: uniform or analytic test fields. Phase 3: channel-following field C = s(t)·f(x,y). f follows the channel axis, scaled by cross-section; s(t) is the tidal-phase curve with ebb/flood asymmetry and a river-flow bias. Peaks are scenario parameters (default about 2 kn at the entrance, per the DHNA statement) | **Provisional, not measured** |
| Depth | 3 | A provisional raster (deep channel tapering to the banks, constrained by the OSM shoreline) plus tide height. Grounding below the draft | **Provisional** |
| Waves | 2/6 | Wind-sea visual parameterised by wind and fetch. A wind-against-current flag raises wave steepness | Visual (E) |

## 5. Data assets

```
data/
  boats/squib/class-spec.json     ← known values; each with source id + tag
  boats/squib/calibration.json    ← estimated coefficients (tag E) with notes
  courses/verified/*.json         ← only from official documents; status workflow
  courses/practice/*.json         ← simulated courses, always labelled
  geo/…                           ← built by tools/geodata, plus provenance.json
```

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
- **Phase 5:** start sequence (5-4-1-0 or per the SIs), individual and general recall, laps, results, and an RRS Part 2 subset (rules 10–18, simplified). This is flagged *not an authoritative adjudication system*.

## 7. Rendering (`src/render`)

- **Water:** custom shader with a sum of Gerstner waves driven by wind; sky reflection; wake ribbon and foam trail.
- **Terrain:** chunked heightmap meshes from EA LIDAR (3 m near, coarser far) with a Sentinel-2 colour drape.
- **Buildings:** OSM footprints extruded, merged per chunk. Heights come from OSM where present, otherwise estimated by class (labelled).
- **Landmarks:** bespoke low-poly proxies (Dartmouth Castle, St Petrox, Kingswear Castle, RDYC, BRNC, St Saviour's), progressively improved.
- **Harbour furniture:** pontoons from OSM; trot moorings with instanced moored boats (positions provisional); ferries as kinematic agents on OSM routes.
- **Squib:** procedural lofted hull from parametric sections (principal dimensions from class data; shape estimated), keel, rudder, rig and rigging lines. Sails are deformable meshes driven by physics angle, camber and twist, plus a luff-flutter vertex shader. The procedural hull can later be replaced by a modelled glTF file.
- **Cameras:** chase, helm/cockpit, free orbit, high-level course view.
- **Debug overlays:** force vectors (sails, keel, rudder, hull, current, wind) drawn as 3D arrows.

## 8. UI (`src/ui`)

| Element | Contents |
|---|---|
| HUD | Heading and compass, STW, SOG, COG, AWA/AWS, TWA/TWS, main and jib trim, heel, tack, tide height, current set and drift, next mark (bearing and distance), race clock |
| Minimap | Canvas 2D: coastline, marks, laylines, current arrows, AI boats |
| Scenario setup | Wind, gusts, tide times and heights, current scale, start time, course, laps, start position; seed |
| Course editor | Map-based: add, move, inspect and sequence marks; rounding sides; gates; import and export JSON; live validator output |
| Validation dashboard | Live plots of STW, VMG, leeway, α per sail, heel, rudder angle, forces and moments. A headless **polar sweep** tool that plots *model-predicted* polars, labelled as model output |

**Controls:** keyboard, plus on-screen buttons for touch.

## 9. Testing (summary; criteria in `DEVELOPMENT_PLAN.md`)

| Layer | Tooling |
|---|---|
| Unit and property | Frames, apparent wind, coefficient tables, force signs, line and rounding geometry |
| Scenario | JSON scenario plus input script, run headless by `npm run scenario`. Produces CSV traces and is compared against golden traces with tolerances |
| End-to-end smoke | Playwright: app loads, canvas renders, controls change state, no console errors, graceful errors when assets are missing |
| Performance | Headless physics benchmark with 1 + 20 boats. Manual frame-rate check on reference hardware |

## 10. Deployment and operations

| Topic | Plan |
|---|---|
| Build | `npm run build` produces static `dist/`. Geodata assets load lazily with progress and error states |
| Hosting | GitHub Pages or Cloudflare Pages (free). Optional custom domain, about £10 per year |
| Secrets | **No secrets in the client.** If the Admiralty Tidal API is adopted, it goes behind a serverless proxy (e.g. a Cloudflare Worker, free tier) holding the key. This is the only feature that would need an external service |
| Licence obligations | An in-app attribution panel: "© OpenStreetMap contributors (ODbL)", "Overture Maps Foundation", "© Environment Agency copyright and/or database right 2015 (OGL v3)", "Contains modified Copernicus Sentinel data". The derived coastline and building database must be offered under ODbL (share-alike). No Admiralty chart data without a licence |
