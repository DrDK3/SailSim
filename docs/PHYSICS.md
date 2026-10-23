# Physics model (Phase 3)

- **Status:** a 4-DOF sailing model (surge, sway, yaw, roll) with a hinged main boom, running in a fixed 100 Hz step. It sails in a seeded, spatially varying wind field, with tide. On the River Dart it adds a bottom it can ground on and a provisional channel-following tidal stream.
- **Code:** `src/sim/` (pure TypeScript: no DOM, Three.js or React; this is enforced by ESLint and a separate `tsconfig.sim.json`).
- **Parameters:** every value is listed with its source and confidence tag in [`PARAMETERS.md`](PARAMETERS.md), which is generated from the data files.

> **Validation status:** the principal dimensions, mass and sail areas come from class sources (tags S/S(p)). Every hydrodynamic and aerodynamic coefficient is an **estimate (tag E)**. No Squib performance data has been found, so the speeds, angles and times the model produces are **model output, not validated predictions**. The tests check internal consistency and physical plausibility only.

## 1. Frames and conventions

| Item | Convention |
|---|---|
| World | North-East-Down metres, origin at the RDYC clubhouse footprint centroid (50.34801° N, 3.57339° W). Horizontal coordinates are a Transverse Mercator projection about that point (`geo/projection.ts`, Krüger series; matches PROJ to < 1 mm, see `GEODATA.md`), shared by the River Dart data, the Met Office grid and everything else |
| Heights | Metres above Ordnance Datum Newlyn (ODN). Tide heights are above chart datum (CD), 2.62 m below ODN at Dartmouth (S) |
| Body | x forward, y to starboard |
| Heading ψ | Compass bearing, clockwise from north |
| Velocities u, v, r | **Through the water** (surge, sway, yaw rate) |
| Heel φ, roll rate p | > 0 means heeled (heeling) to starboard |
| Sail angle β | Angle of the chord (mast → clew) from the centreline; > 0 means set to **port** (as on starboard tack) |
| Rudder δ | > 0 means trailing edge to starboard, which turns the bow to starboard. Helm input +1 = full starboard |
| Yaw moment N | > 0 turns the bow to starboard |
| Wind direction | FROM, degrees true. Current "set" = direction it flows TOWARDS |
| Units | SI internally; knots and degrees only in the UI, scenarios and CSV |

## 2. Kinematics: water versus ground

```
V_water (world) = R(ψ)·[u, v]
V_ground        = V_water + C(x, y, t)          current enters here only
STW = |[u, v]|,  SOG/COG from V_ground,  leeway = atan2(v, u)
```

Test 7 checks that adding a current leaves STW unchanged, gives SOG = |V_water + C| to 1e-9, and offsets the track by C·t.

## 3. Wind

```
W_g   true wind over ground (Environment)          W_w = W_g − C   (instruments: TWS/TWA)
A     = W_g − V_ground = W_w − V_water             (apparent wind, body frame A = (a_x, a_y))
AWA   = atan2(−a_y, −a_x)                          (> 0 = from starboard)
```

**Heeled sail plane:** the athwartships component is scaled by cos φ: A_e = (a_x, a_y·cos φ). This is the usual "effective angle" approach.

**Wind field:** see §14. Tests and the polar use uniform steady wind (`uniformEnvironment`); the app uses a `WindField` with seeded gusts, shifts and puffs over either a uniform or a gridded (Met Office UKV) base wind.

**Motion-induced airflow (Phase 2):** each sail sees the apparent wind minus the velocity of its centre of effort caused by the boat's own motion:

```
v_CE,x = −r·y_CE + ω·arm·sin β
v_CE,y =  r·x_CE·cos φ + p·h_CE − ω·arm·cos β        (ω = boom swing rate, arm = ceChordFrac·foot)
A_local = (a_x − v_CE,x,  a_y·cos φ − v_CE,y)
```

The roll term is what damps rolling: a mast swinging to leeward meets extra airflow from leeward, which reduces the heeling force. The yaw and swing terms damp yaw and boom motion in the same way. No separate aerodynamic damping coefficients are needed.

## 4. Sails (`boat/coefficients.ts`, `boat/forces.ts`)

### Sail angle

The sail angle β follows the sheet:
- The sail blows out to leeward until the sheet stops it, so its target is `side·min(|AWA_e|, sheet limit)`.
- If the sheet is eased beyond the wind, the sail streams (luffs).
- With the wind on the boom side (by the lee), the target is the sheet limit, so the boom stays out.

The sheet limit runs from `sheetMin` (hard in) to `sheetMax` (main against the shrouds).

**Main boom: a hinged body (Phase 2).** The main boom is no longer driven towards a target; it swings under the torques acting on it (`stepBoom`, four sub-steps per 10 ms step):

```
I_b·ω̇ = Q_aero + Q_gravity − c_b·ω
Q_aero    = arm·(F_x·sin β − F_y,plane·cos β)      (sail force at the CE, including the motion-induced airflow)
Q_gravity = −m_b·g·sin φ·cos β                     (heeled, the boom falls to leeward)
I_b = 22 kg·m², m_b = 18 kg·m, c_b = 8 N·m·s       (all E)
```

The sheet is a **one-sided** constraint: |β| ≤ sheet limit. It stops the boom going further out, never pulls it in. When the boom hits the limit while moving outwards, its rate reverses with restitution 0.15 (E) and a "fetched up" event is recorded with the impact rate. With the sheet eased beyond the wind the boom weathervanes and the sail luffs. The jib stays kinematic: it changes side quickly through the foretriangle (first-order lag, gain 12/s, rate limit 150°/s).

### Tack and gybe (which side each sail is on)

**Tacks and gybes are not commands**: they happen because the heading changes the apparent wind.

- **Tack:** head to wind the boom weathervanes to the centreline and blows across as the bow passes through the wind.
- **Gybe (main):** with the wind from astern a rigid flat sail model would keep pressing the boom further out (forwards) even by the lee. A real, twisted sail flips (the leech goes first) and drives the boom across. The model represents this: when the wind is more than `byTheLee` (15°, E) by the lee **and** the plain aerodynamic torque is pushing the boom outwards, the chord-normal component of the sail force is reversed (`mainInverted`). The boom then accelerates across under the hinge dynamics until the sheet stops it on the other side. Gravity when heeled and the sheet length shape the swing: a crash gybe with the sheet fully eased reaches about 310°/s; with the sheet half in, about 140°/s.
- **Side:** `mainSide` follows the sign of the boom angle (±0.5° deadband). The jib uses the kinematic hysteresis (`byTheLee` 5°).

### Incidence

The incidence ι is the angle between the effective airflow and the chord (|ι| > 90° means the flow reaches the leech first).

### Coefficients against |ι|

| Regime | Behaviour |
|---|---|
| Luffing | Below `alphaLuffStart`, C_L = 0 and C_D = `cdFlap`. Smooth transition to fully drawing at `alphaFull`. The values (main 6°→13°, jib 5°→11°) are larger than for a flat foil because a cambered sail's luff entry angle sits several degrees above the chord line |
| Drawing | C_L = C_Lmax·sin(π/2·min(ι/α_peak, 1)) and C_D = C_D0 + C_L²/(π·AR_eff) |
| Post-stall | Blends smoothly (over `stallWidth`) into Hoerner's flat-plate model: C_N = C_N90·sin ι/(0.56 + 0.44·sin ι), C_L = C_N·cos ι, C_D = C_D0 + C_N·sin ι. So downwind the sails act as drag devices |

### Sail interaction

- The jib's downwash reduces the main's incidence by `6°·C_L,jib`.
- The main's upwash increases the jib's by `3°·C_L,main`.
- Both are weighted by max(0, cos AWA), so the effect fades by a beam reach.

This is why the main backwinds when pinching (qualitatively documented in the sail-interaction literature; magnitudes are estimates).

**Jib blanketing:** beyond AWA 140° the jib's effectiveness falls linearly to 0.3 dead downwind.

### Force and centre of effort

- **Force:** lift is perpendicular to the effective apparent wind, on the leeward side; drag acts along it. q = ½ρ_air|A_e|²·S. The horizontal side force is the sail-plane side force × cos φ.
- **Centre of effort:** pivot (mast or tack) + `ceChordFrac`·foot along the chord. Laterally it moves with the boom and the heel (CE height·sin φ), so the drive acting at a heeled CE produces weather helm.

**Windage:** C_DA = 0.55 m² of drag along the apparent wind.

## 5. Underwater lifting surfaces

Two elements:
- **keel + canoe body**, lumped as one "lateral" element;
- **rudder**.

**Inflow angle:** for each element, from its local velocity (u, v_local), rotated by the rudder angle for the rudder.
- Keel: v_local = v + r·x_lat − p·d_CLR (rolling to starboard swings the keel to port).
- Rudder: v_local = v·(1 − ε) + r·x_r − p·d_rudder, where ε = 0.5 (E) is the **flow straightening** by the keel's downwash.

The roll terms make the keel and rudder resist rolling (hydrodynamic roll damping), in the same way the sails do above the water.

**Coefficients** (valid for all α):
- Attached flow: C_L = C_Lmax·tanh(a·sin α·cos α / C_Lmax), with a from the Helmbold aspect-ratio slope, and induced drag C_L²/(π·AR·e).
- This blends after stall into the flat-plate model.
- Profile drag is carried in the hull friction (total wetted area).
- Horizontal force is scaled by cos φ.

**Effective lateral centre:** x_lat = +0.9 m forward of the CG (E).
- The canoe body produces its side force well forward, so the hydrodynamic centre lies ahead of the geometric one.
- With the keel lumped at the CG, the model showed **lee helm**: unrealistic, because boats are designed for slight weather helm.
- With x_lat = 0.9 m and ε = 0.5, the boat carries about 1° of weather helm close-hauled in 10 kn and about 3° in 15 kn.
- With the helm centred, it rounds up slowly and settles at about 32° TWA.
- This is calibration against general design practice, not against Squib data.

## 6. Hull

- **Resistance:** R = (R_F + R_R)·(1 + 0.5·φ²)
  - **Friction R_F:** ITTC-1957 friction line on the total wetted area (6.2 + 1.1 + 0.45 m², E) × form factor 1.12 (E). Re uses 0.7·LWL.
  - **Residuary R_R:** R_R = m·g·f(Fn), from a **parametric table (E)** shaped like moderate-displacement hull data. The Delft series (DSYHS) regression planned in the architecture is **deferred**: its coefficient tables and the Squib hull parameters (LCB, Cp and so on) are not available. The table steepens beyond Fn ≈ 0.4 (≈5.5 kn), the displacement "hull speed".
- **Cross-flow drag:** quadratic, integrated in 10 strips along the LWL with canoe-body draft 0.3 m (E). This gives sway and yaw damping at low speed (drifting, in irons).
- **Linear yaw damping:** 200 N·m·s (E).

## 7. Rigid-body dynamics (4-DOF with added mass)

```
m11·u̇ = X + m22·v·r          m11 = m(1 + 0.05)
m22·v̇ = Y − m11·u·r          m22 = m(1 + 0.70)
I66·ṙ = N                     I66 = m(0.27·LOA)²(1 + 0.60)
I44·ṗ = K                     I44 = m(0.85 m)²(1 + 0.20)
ṅ, ė = R(ψ)[u, v] + C;  ψ̇ = r;  φ̇ = p
```

Roll is not coupled into the surge/sway/yaw added-mass terms (a standard simplification for manoeuvring models of this kind).

- **Mass:** m = 680 kg minimum boat mass (S(p)) + 2 × 80 kg crew (E). All added-mass fractions are E.
- **Munk moment:** omitted. The forward lateral centre stands in for the canoe body's destabilising contribution.
- **Integration:** RK4 at dt = 0.01 s.
- **Per-step updates:** the environment (gusts) advances once, then the actuators (rudder, auto-trim, main boom, jib, crew) are updated once before integration and held constant within the step. The state integrated by RK4 is (n, e, ψ, u, v, r, φ, p).

## 8. Roll (dynamic, Phase 2)

**Roll moment about the waterline:**

```
K = K_sails + K_foils + K_crew + K_righting + K_damping
K_sails    = F_y,plane,main·h_CE,main + F_y,plane,jib·h_CE,jib + F_windage·h_windage
K_foils    = −F_y,plane,keel·d_CLR − F_y,plane,rudder·d_rudder
K_crew     = m_crew·g·y_crew·cos φ
K_righting = −m·g·GZ(φ)
K_damping  = −220·p                                (linear structural/viscous term, E)
```

**Righting arm GZ(φ):** an estimated table (E) with initial slope GM = 0.8 m (E), maximum about 0.46 m at 50–60°, and vanishing stability near 115°. It is the shape typical of a ballasted keelboat; no Squib stability curve has been found (`MISSING_INFORMATION.md`).

**Roll damping** comes mostly from the motion-induced airflow at the sails (§3) and the sway of the keel and rudder (§5). The small linear term covers hull and structural damping.

**Results (free decay, no wind):** the period is 2.10 s against the small-angle theory 2π·√(I44/(m·g·GM)) = 2.09 s. In still air the peaks decay 15° → 9.6° → 6.4° → 4.3°: the foils and the linear term damp it; in wind, the sails add much more.

**Static equilibrium (diagnostic):** `heelEquilibrium` finds by bisection the angle where the sail heeling moment (arm = CE height + CLR depth) and the crew balance m·g·GZ(φ). The dynamic heel settles to within 1° of it in steady wind (8.8° against 9.0° at 10 kn; 28.2° against 28.7° at 15 kn, close-hauled with auto trim and auto crew).

**Crew position:**
- Manual: the crew sit to windward at the "hike" setting.
- Auto crew (default on): they move athwartships to cancel the heeling moment, within ±0.8 m.
- They move at 0.6 m/s.

**Effects of heel:**
- reduces the effective apparent wind in the sail plane (cos φ);
- moves the CE to leeward, producing weather helm;
- reduces foil horizontal forces (cos φ);
- adds resistance.

**Helm balance (diagnostic):** the rudder angle that would give zero yaw moment at the current state, found by bisection. It is shown in the instruments and dashboard as weather helm (> 0) or lee helm (< 0). Close-hauled (TWA 40°) it is 1.2° weather in 10 kn and 3.4° in 15 kn.

## 9. Controls and assists

| Control | Behaviour |
|---|---|
| Helm | Moves the rudder at up to 70°/s towards helm × 35° |
| Sheets | 0 = hard in … 1 = fully eased |
| Auto-trim assist | Behaves like a crew watching telltales: eases when the effective incidence is above target (main 20°, jib 16°), trims when it falls below. Full range in about 3 s; lets the sheet run when the flow is leech-first. Default: jib auto, main manual |
| Auto crew | See §8 |
| Max-drive trim helper (`optimalSheets`) | Scans the sheet settings for maximum drive at the current state. Used by tests and scenarios, not in normal play |
| Autopilot (`autopilotHelm`) | A PD controller on heading or TWA, output to the helm only. Used by tests, scenarios and future AI boats |

## 10. Determinism and reproducibility

- **No hidden inputs:** no wall-clock time and no unseeded randomness in `src/sim` (ESLint forbids `Math.random` and `Date.now` there).
- **Input log:** inputs are sampled at step boundaries and recorded in `inputLog`.
- **Same engine:** the same inputs give a bit-identical state hash (FNV-1a over the IEEE-754 bits).
- **Gusts are deterministic too:** the wind field has its own seeded RNG (`math/rng.ts`), advanced exactly once per step by the simulation that owns the environment. The determinism probe runs with moderate gusts and the tidal stream.
- **Across JavaScript engines:** V8 12.4 (Node 22) and V8 14.1 (Chromium 141) differ in the last bit of `Math.sin`, `Math.cos` and `Math.pow`. Runs therefore agree to within tolerance rather than bit-for-bit: the worst state difference after 600 s of tacking and gybing, with gusts and tidal stream, was **2.8×10⁻¹⁴**. The test tolerance is 1×10⁻⁶.
- **Later option:** if bit-exact cross-browser replays are needed, a deterministic maths library (fdlibm port) can replace those three functions.

## 11. Test rigs (test-only options)

| Option | What it does |
|---|---|
| `lockHeading` | Captive test: yaw frozen, surge and sway free. Used to show the boat cannot sail within 15° of the wind (criterion 8) |
| `testThrust` | A constant towing force, used to hold speed for the rudder sweep (criterion 6) |

## 12. Model outputs (not validated)

Steady speed through the water, autopilot holding TWA, max-drive trim, 2 crew (auto crew), flat water, 150 s per point. Generated by `npm run polar`; the app's **Polar** panel computes the same table in a Web Worker (it uses 120 s per point; the results agree to 0.01 kn).

| TWA | 6 kn: STW (heel) | 10 kn: STW (heel) | 15 kn: STW (heel) |
|---|---|---|---|
| 35° | 2.98 (0°) | 4.38 (6°) | 5.03 (24°) |
| 40° | 3.33 (0°) | 4.67 (8°) | 5.17 (27°) |
| 45° | 3.61 (0°) | 4.91 (9°) | 5.32 (28°) |
| 52° | 3.91 (0°) | 5.10 (8°) | 5.59 (28°) |
| 60° | 4.17 (0°) | 5.29 (7°) | 5.84 (24°) |
| 75° | 4.35 (0°) | 5.53 (3°) | 6.30 (16°) |
| 90° | 4.38 (0°) | 5.57 (0°) | 6.56 (8°) |
| 110° | 4.20 (0°) | 5.40 (0°) | 6.40 (0°) |
| 135° | 3.36 (0°) | 4.85 (0°) | 5.77 (0°) |
| 150° | 2.81 (0°) | 4.32 (0°) | 5.47 (0°) |
| 165° | 2.62 (0°) | 4.14 (0°) | 5.28 (0°) |
| 175° | 2.50 (0°) | 3.98 (0°) | 5.16 (0°) |

The values changed by at most 0.05 kn from Phase 1: in steady wind the dynamic roll settles to almost the same heel as the Phase 1 lag model.

**Other model outputs** (printed by the tests as `[model output]` lines):

| Output | 6 kn | 10 kn | 15 kn |
|---|---|---|---|
| Tack: minimum speed, % of entry | 53% | 54% | 55% |
| Tack: head to wind after | 4.8 s | 3.3 s | 3.0 s |
| Tack: 90% of entry speed regained after | 27.3 s | 13.6 s | 9.2 s |
| Helm balance close-hauled (TWA 40°) | | 1.2° weather | 3.4° weather |
| Gybe: boom crosses at (bearing away at 1°/s) | | 10.7° by the lee | |
| Gybe: peak boom rate, sheet eased / half in | | 314°/s / 140°/s | |

- **Pointing (captive test, 10 kn):** steady forward speed needs at least 22° heading-TWA from rest, or 18° with way on. Leeway of 5–7° adds to the track angle.
- **Gust response (12 kn, shifty preset, fixed crew):** heel standard deviation 7.7° over 120 s; 0.000° in steady wind.
- **Known optimism:** pointing is probably a few degrees too high, and upwind heel at 15 kn (about 28°) is high because neither the max-drive trim nor the auto-trim depowers as a sailor would (no traveller, kicker or twist).

## 13. Known simplifications

| Simplification | Planned replacement |
|---|---|
| No pitch or heave in the physics; the 3D view adds a cosmetic wave response | — |
| Waves are visual only (wind-against-tide steepens them visually); no added resistance or wave forces | — |
| The jib is kinematic (rate-limited lag), not a hinged body | Only if needed: its swing is short and fast |
| Roll not coupled into the surge/sway/yaw added-mass terms | — |
| The GZ curve and the roll inertia are estimates; the ballast mass (S) is not used directly | Stability data or an inclining/heel test |
| No sail twist, camber or depowering controls (kicker, cunningham, outhaul, traveller) | — |
| No spinnaker | — |
| Residuary resistance is a parametric curve | Delft series (DSYHS) when data allows |
| No wind gradient (the same wind at all heights) | — |
| Munk moment omitted (represented by the forward lateral centre) | — |
| Wind is horizontal and the same at every height; no wind shadow from land | Phase 3 (terrain-based sheltering, if data allows) |
| The River Dart stream pattern is a model on estimated depths; offshore alongshore streams are not modelled | Measured currents (C4) or a hydrodynamic model |
| No heave or pitch when aground: the boat does not lift or lean on the bottom | — |
| Moorings, pontoons and ferries are not obstacles | Phase 5 (collisions) |

## 14. Environment (Phase 2, `src/sim/env/`)

### Wind field (`wind.ts`)

**wind(n, e, t) = base(n, e) × gust factor, rotated by the shift:**

| Component | Model | Parameters (presets steady / moderate / shifty, all E) |
|---|---|---|
| Base wind | Uniform (manual), or the Met Office UKV 2 km grid: u/v components interpolated bilinearly in grid-index space, using a least-squares affine map from local metres to grid indices. Outside the grid, edge values | — |
| Oscillating shifts | Ornstein–Uhlenbeck process, started from its stationary distribution (no warm-up) | SD 0 / 5 / 10°, correlation time 120 / 180 / 90 s |
| Persistent shift | Linear trend | 0°/min by default |
| Speed fluctuation | Ornstein–Uhlenbeck, fraction of the mean | SD 0 / 8 / 15%, correlation time 40 / 40 / 30 s |
| Puffs | Poisson arrivals over a 2.5 km disc; Gaussian patches that grow, drift downwind at 90% of the base speed, and die. Each adds speed and a direction offset | 0 / 0.6 / 1.5 per km² per min; core +25% / +35%; radius 120 / 90 m; direction SD 6 / 10°; lifetime 120 / 90 s |

- **From data:** with Met Office data, "from data" starts from the moderate preset. It sets the speed fluctuation SD to (G/U − 1)/3.5 and the puff strength to 0.7·(G/U − 1), where G/U is the UKV gust/mean ratio at the RDYC grid point. It sets the shift SD to the 1-minute direction scatter of the observing station in the snapshot (Plymouth Mountbatten), clamped to 2–15°. Both are heuristics (E): a 2 km cell includes land, and the station is about 40 km away. The notes shown in the app say which values were used.
- **Seed:** every random number comes from one seeded generator, advanced once per step, so a scenario and seed reproduce exactly.
- **Display:** puffs are drawn as darker, rougher patches on the water ("cat's paws"), from the same puff list the physics uses.

### Tide height (`tide.ts`)

- **Event tide:** cosine interpolation between alternating HW/LW events (heights above chart datum). Outside the event list it repeats with the M2 half-period and says so in the notes.
- **Manual tide:** one HW time and HW/LW heights entered from tide tables; the curve is extended at the M2 period (12 h 25 min).
- **Tide snapshot:** the format produced by the live ingest (UKHO predictions plus the latest Environment Agency gauge reading). The gauge-minus-prediction residual is added as a constant surge. Live fetching needs network access (`LIVE_TIDES.md`); the test fixture is labelled SYNTHETIC.
- **Outputs:** height, rising/falling, hours since HW, next HW/LW, rate (m/h), and the normalised rate of change in [−1, 1].

### Tidal stream (`current.ts`): PROVISIONAL

- **Model:** uniform in space. Rate ∝ the normalised rate of change of the tide height: slack at HW and LW, strongest at mid-tide, as in a standing-wave estuary. Flood sets towards 330° (E), peak flood 1.5 kn and ebb 2.0 kn (E, from DHNA's "seldom exceeds 2 knots" at the entrance). An optional steady river outflow adds to the ebb.
- **Labelling:** the UI labels it "modelled"; it is **not measured current data**. Real streams in the Dart vary across the channel and around the bends; that spatial pattern belongs to Phase 3.
- **Kinematics:** the current enters only through V_ground (§2). Instrument TWS/TWA are relative to the water, so a current changes the wind the boat feels.

### River Dart: channel-following stream (`current.ts`, `dartStream`): PROVISIONAL

With the River Dart data, the stream can follow the channel instead of being uniform:

```
C(n, e, t) = −s_flood(t)·P_tidal(n, e) + U_river·P_river(n, e)
s_flood(t) = peakFlood·φ(t)  (φ ≥ 0, rising)   or   peakEbb·φ(t)  (φ < 0, falling)
```

- **Patterns:** P_tidal and P_river are the precomputed ebb-direction patterns (`GEODATA.md`). Each has unit mean speed across the entrance (castle to castle).
- **Phase:** φ(t) is the normalised rate of change of the tide height, as in the uniform model.
- **Peak rates:** they mean "mean speed across the entrance at mid-tide": default ebb 2.0 kn and flood 1.5 kn (E, guided by DHNA's "seldom exceeds 2 knots", S(p)).
- **Shape:** the pattern is about 1× the entrance speed off RDYC, up to about 2.2× in the narrowest reach, near zero in the creeks, and spreads out into Start Bay.
- **Labelling:** it is labelled "modelled" in the app.

### Water level

With the River Dart data the environment provides the water level in metres ODN. It is the tide height above CD minus 2.62 m, or 2.7 m CD (≈ mean level, E) when no tide is set. Water depth at a point = water level − bed elevation.

### Wind against tide

The environment flags it when the wind (direction it blows to) and the current are more than 120° apart, the current is over 0.5 kn and the wind over 8 kn. The flag only steepens and shortens the drawn waves and shows a chip in the instruments; there are no wave forces in the physics.

## 15. Grounding: contact with the bottom (`boat/contact.ts`)

With a seabed (the River Dart data), three points can touch the bottom:

| Point | Body x | Depth below the waterline |
|---|---|---|
| Keel tip | +0.1 m | 0.99 m (class draft, S) |
| Forefoot | +2.75 m | 0.15 m (E) |
| Rudder heel | −2.75 m | 0.8 m (E) |

**Penetration** at each point is `pen = depth·cos φ − (water level − bed)`. The keel tip also swings to windward as the boat heels. Each touching point (pen > 0) adds horizontal forces:

| Force | Value | Role |
|---|---|---|
| Ground load | `N = ρ g A_wp·pen·share`, capped at 2 × the point's share of the weight (A_wp = 4.8 m², E; shares keel 0.5, bow and stern 0.25) | Weight transferred to the ground as the water gets shallower |
| Friction | `μN` opposing the point's velocity over the ground, smoothed below 0.05 m/s (μ = 0.5, E) | Holds a grounded boat against the sails |
| Ploughing | `C·min(pen/0.05 m, 1)` times the velocity (C = 8000 N·s/m, E) | Stops a keel that runs into mud within a few seconds |
| Slope push | `N·min(slope, 1)` down the bed gradient | Pushes the boat back towards deeper water on a steep bank |

**Moments:** the forces act at the points, giving yaw (x × F_y) and roll (−F_y × depth).

**Consequences:**
- A boat that sails at a bank stops with the keel in about its own draft of water.
- Rising water floats it off; falling water grounds it.
- It cannot reach dry land: in tests steering at eight shore landmarks, the hull centre never reached ground above the water.

**Simplifications:** there is no heave or pitch, so the boat does not lift as it grounds. There is no damage model.

The 8 m elevation grid turns vertical quay walls into ramps about 8 m wide, so the boat grounds a few metres off a wall. The bed mid-channel is an estimate, so groundings there are only indicative. Near the shore the bed is LIDAR (`GEODATA.md`).

**Outputs:** the snapshot reports `depthAtKeel`, `grounded` and each point's clearance. The app shows the depth at the keel and an "Aground" warning.

## 16. Contact between boats, marks, moored boats and ferries (Phase 5, `race/fleet.ts`, `race/hull.ts`)

Boats in a race (or the user's boat alone, in free sailing) are stepped together by a `Fleet` that shares one environment.

- **Hull outline:** convex, 13 vertices. It uses the 3D model's estimated half-breadth curve: bow 2.95 m forward of the CG, beam 1.87 m at 55% of the length, transom 0.64 × half-beam.
- **Overlap:** found by the separating-axis test (polygons) or the closest point (circles: marks).
- **Force at the contact point:** F = max(0, k·depth − c·v_n)·n̂ − μ·F·tanh(|v_t|/0.1)·t̂, equal and opposite on the two bodies. It gives each boat a yaw moment about its CG.
- **Coefficients:** μ = 0.3. Hard bodies (boats, committee boat, moored boats, ferries): k = 2×10⁵ N/m, c = 5×10³ N s/m. Inflatable marks: k = 3×10⁴ N/m, c = 2×10³ N s/m. All estimates (E).
- **Timing:** forces are computed from the states at the start of the step and held over it (the `external` force of `Simulation`). The result does not depend on the order of the boats.
- **Fixed bodies:** marks, moored boats (a box l × l/3, lying to the stream or wind, downstream of the buoy) and ferries (moving on their timetable) do not respond.
- **Limits:** horizontal only. There is no roll, heave or damage from contact, and no rafting.
- **Measured:** a 3.7 m/s port–starboard collision overlaps by at most 14 cm, and the boats separate.
- **Determinism:** with no contact, `external` is null and the arithmetic is unchanged, so the golden traces are bit-identical.

**Fleet speed-ups (results unchanged):**
- the wind field samples only the puffs that can reach the fleet's bounding box (others contribute exactly zero there);
- puff life envelopes are cached once per step;
- tide evaluations are memoised (the tide is a pure function of time).

## 17. AI sail handling (Phase 5, `ai/sheets.ts`)

AI boats use the auto-trim assist. In addition, the main is eased in proportion to heel beyond 24° (full ease at 38°), at most 0.6 of the sheet travel per second, as a crew dumps the main. Without this, the model broaches when reaching in 20 kn or more (rudder saturated, 50–60° of heel). The same rule is used to compute the AI's target-speed table (`ai/polarData.ts`). That table is model output; for example it gives 10.4 kn at 105° in 25 kn of wind, because the estimated residuary-resistance table flattens above Fn 0.55 (OUTSTANDING_ISSUES 37).
