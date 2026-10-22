# Physics model (Phase 1)

- **Status:** a 3-DOF sailing model (surge, sway, yaw) with quasi-static heel, running in a fixed 100 Hz step.
- **Code:** `src/sim/` (pure TypeScript: no DOM, Three.js or React; this is enforced by ESLint and a separate `tsconfig.sim.json`).
- **Parameters:** every value is listed with its source and confidence tag in [`PARAMETERS.md`](PARAMETERS.md), which is generated from the data files.

> **Validation status:** the principal dimensions, mass and sail areas come from class sources (tags S/S(p)). Every hydrodynamic and aerodynamic coefficient is an **estimate (tag E)**. No Squib performance data has been found, so the speeds, angles and times the model produces are **model output, not validated predictions**. The tests check internal consistency and physical plausibility only.

## 1. Frames and conventions

| Item | Convention |
|---|---|
| World | North-East-Down metres. The origin is arbitrary in Phase 1 (RDYC in Phase 3) |
| Body | x forward, y to starboard |
| Heading ψ | Compass bearing, clockwise from north |
| Velocities u, v, r | **Through the water** (surge, sway, yaw rate) |
| Heel φ | > 0 means heeled to starboard |
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

**Phase 1 wind:** uniform and steady (`uniformEnvironment`). Gusts, shifts, spatial variation and live Met Office data come in Phases 2–3 (see `LIVE_WEATHER.md`).

## 4. Sails (`boat/coefficients.ts`, `boat/forces.ts`)

### Sail angle

The sail angle β follows the sheet:
- The sail blows out to leeward until the sheet stops it, so its target is `side·min(|AWA_e|, sheet limit)`.
- If the sheet is eased beyond the wind, the sail streams (luffs).
- With the wind on the boom side (by the lee), the target is the sheet limit, so the boom stays out.

The sheet limit runs from `sheetMin` (hard in) to `sheetMax` (main against the shrouds). The boom approaches its target as a first-order lag (gain 6/s), with a rate limit of 150°/s. The jib responds twice as fast.

### Tack and gybe (which side each sail is on)

The side switches as soon as the apparent wind crosses to the sail's side (a tack). Near dead astern, the boom stays until the wind is more than `byTheLee` (main 15°, jib 5°, both E) by the lee (a gybe).

So **tacks and gybes are not commands**: they happen because the heading changes the apparent wind. Phase 1 uses this kinematic hysteresis for the gybe trigger; Phase 2 replaces it with hinged-boom dynamics.

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
- Keel: v_local = v + r·x_lat.
- Rudder: v_local = v·(1 − ε) + r·x_r, where ε = 0.5 (E) is the **flow straightening** by the keel's downwash.

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

## 7. Rigid-body dynamics (3-DOF with added mass)

```
m11·u̇ = X + m22·v·r          m11 = m(1 + 0.05)
m22·v̇ = Y − m11·u·r          m22 = m(1 + 0.70)
I66·ṙ = N                     I66 = m(0.27·LOA)²(1 + 0.60)
ṅ, ė = R(ψ)[u, v] + C;  ψ̇ = r
```

- **Mass:** m = 680 kg minimum boat mass (S(p)) + 2 × 80 kg crew (E). All added-mass fractions are E.
- **Munk moment:** omitted. The forward lateral centre stands in for the canoe body's destabilising contribution.
- **Integration:** RK4 at dt = 0.01 s.
- **Per-step updates:** actuators (rudder, sails, crew) and heel are updated once per step before integration, and held constant within the step.

## 8. Heel (quasi-static)

**Equilibrium angle φ_eq** (four fixed-point iterations):

```
Σ_sails F_y,plane·(h_CE + d_CLR) + windage + m_crew·g·y_crew·cos φ = m·g·GM·sin φ
GM = 0.8 m (E),  d_CLR = 0.45 m (E)
```

**Lag:** φ relaxes to φ_eq with a 0.8 s first-order lag. Dynamic roll arrives in Phase 2.

**Crew position:**
- Manual: the crew sit to windward at the "hike" setting.
- Auto crew (default on): they move athwartships to cancel the heeling moment, within ±0.8 m.
- They move at 0.6 m/s.

**Effects of heel:**
- reduces the effective apparent wind in the sail plane (cos φ);
- moves the CE to leeward, producing weather helm;
- reduces foil horizontal forces (cos φ);
- adds resistance.

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
- **Across JavaScript engines:** V8 12.4 (Node 22) and V8 14.1 (Chromium 141) differ in the last bit of `Math.sin`, `Math.cos` and `Math.pow`. Runs therefore agree to within tolerance rather than bit-for-bit: the worst state difference after 600 s of tacking and gybing was **5.7×10⁻¹⁴**. The test tolerance is 1×10⁻⁶.
- **Later option:** if bit-exact cross-browser replays are needed, a deterministic maths library (fdlibm port) can replace those three functions.

## 11. Test rigs (test-only options)

| Option | What it does |
|---|---|
| `lockHeading` | Captive test: yaw frozen, surge and sway free. Used to show the boat cannot sail within 15° of the wind (criterion 8) |
| `testThrust` | A constant towing force, used to hold speed for the rudder sweep (criterion 6) |

## 12. Model outputs (not validated)

Steady speed through the water, autopilot holding TWA, max-drive trim, 2 crew, flat water. Generated by `npm run polar`.

| TWA | 6 kn: STW (heel) | 10 kn: STW (heel) | 15 kn: STW (heel) |
|---|---|---|---|
| 35° | 2.98 (0°) | 4.37 (7°) | 5.05 (23°) |
| 40° | 3.33 (0°) | 4.66 (8°) | 5.20 (26°) |
| 45° | 3.61 (0°) | 4.91 (9°) | 5.37 (27°) |
| 52° | 3.91 (0°) | 5.10 (8°) | 5.62 (27°) |
| 60° | 4.17 (0°) | 5.29 (7°) | 5.87 (24°) |
| 75° | 4.35 (0°) | 5.53 (3°) | 6.30 (17°) |
| 90° | 4.38 (0°) | 5.57 (0°) | 6.56 (8°) |
| 110° | 4.20 (0°) | 5.40 (0°) | 6.40 (0°) |
| 135° | 3.36 (0°) | 4.85 (0°) | 5.77 (0°) |
| 150° | 2.81 (0°) | 4.32 (0°) | 5.46 (0°) |
| 165° | 2.62 (0°) | 4.14 (0°) | 5.28 (0°) |
| 175° | 2.47 (0°) | 3.94 (0°) | 5.12 (0°) |

**Other model outputs:**
- **Pointing (captive test, 10 kn):** steady forward speed needs at least 21° heading-TWA from rest, or 17° with way on. Leeway of 5–7° adds to the track angle.
- **Tack (10 kn):** speed falls to about 53% of entry; head to wind about 3.3 s after the helm goes over; 90% of speed regained after about 13 s.
- **Known optimism:** pointing is probably a few degrees too high, and upwind heel at 15 kn is high because the max-drive trim does not depower as a sailor would.

## 13. Known simplifications (Phase 1)

| Simplification | Planned replacement |
|---|---|
| Heel is quasi-static | Dynamic roll in Phase 2 |
| No pitch or heave in the physics; the 3D view adds a cosmetic wave response | — |
| Gybe triggered by a by-the-lee threshold | Hinged-boom dynamics in Phase 2 |
| No sail twist, camber or depowering controls (kicker, cunningham, outhaul, traveller) | — |
| No spinnaker | — |
| Residuary resistance is a parametric curve | Delft series (DSYHS) when data allows |
| No added resistance in waves; flat water | — |
| No wind gradient | — |
| Munk moment omitted (represented by the forward lateral centre) | — |
| The ballast mass (S) is not used directly; stability comes from an estimated GM | — |
