# Calibration workflow

**Status:** the tools and tests exist. **No calibration has been done**, because no measured Squib performance data has been found (see `MISSING_INFORMATION.md`, items B2–B5). Every hydrodynamic and aerodynamic coefficient keeps tag **E** until this workflow is run on real observations.

## What calibration can and cannot do

The model has more than 80 estimated coefficients. A season of GPS and wind logs constrains only a few combinations of them. The workflow therefore fits **a few dimensionless multipliers on groups of coefficients** ("knobs"), never individual coefficients. Each knob has a physical meaning and a plausible range:

| Knob | Scales | Range searched | Constrained mainly by |
|---|---|---|---|
| `sailLift` | main and jib C_L,max | 0.7–1.3 | Upwind speed and heel |
| `residuary` | the residuary-resistance table | 0.5–2.0 | Reaching and running speed near hull speed (Fn > 0.3) |
| `friction` | the friction form factor | 0.8–1.6 | Light-air speed (Fn < 0.25) |
| `righting` | the GZ curve (and GM) | 0.6–1.5 | Upwind heel for a known crew position |

Things that observations of steady sailing **cannot** calibrate: roll inertia, boom inertia, added masses, gust statistics. These need dedicated tests (a roll-decay video, a timed gybe) or stay estimated.

## 1. Collect observations

One row per **settled** condition: the boat on a steady heading and trim for at least 60 s, with a steady wind.

| Column | Meaning | Required |
|---|---|---|
| `tws_kn`, `twa_deg` | True wind speed and angle **relative to the water** (correct a masthead or committee-boat anemometer for current and height) | Yes |
| `stw_kn` | Speed through the water (log, or GPS SOG corrected for the tidal stream) | One of these three |
| `heel_deg` | Mean heel (phone inclinometer, or measured from video) | One of these three |
| `leeway_deg` | Difference between heading and track through the water | One of these three |
| `weight` | Relative confidence (default 1) | No |
| `source` | Boat, date, instrument and leg, e.g. `RDYC Squib "Name", 2027-05-14, GPS + handheld anemometer, leg 3` | **Yes: rows without a source are rejected** |

Template: [`data/observations/TEMPLATE.csv`](../data/observations/TEMPLATE.csv). Lines starting with `#` are comments.

Good sources, in order of value:
1. Two Squibs of known crew weight sailing alongside (tuning runs), one carrying a calibrated wind instrument.
2. Race GPS tracks plus the committee boat's wind log, using only long, steady legs, and correcting for the tidal stream.
3. Published class performance data (none found so far).

The data must be measured. Values estimated by sailors ("about 5 knots upwind") may be used only with a low weight and a source saying so.

## 2. Compare the model with the observations

```bash
npm run calibrate -- data/observations/my-log.csv
```

For each observation, the tool runs the model to a steady state with the same procedure as the polar (autopilot holding the TWA, max-drive sheet setting, flat water, 120 s). It prints a table of model − observed residuals and the RMS for speed, heel and leeway. Each point takes about 1 s.

Residual patterns point to the knob to use:

| Pattern | Likely cause | Knob |
|---|---|---|
| Model fast upwind, with heel about right | Too much sail drive | `sailLift` |
| Model heels too much upwind at the right speed | Stability too low | `righting` |
| Model fast only near hull speed (reaching, 12+ kn) | Too little wave resistance | `residuary` |
| Model fast in light air on every point of sail | Too little friction | `friction` |
| Model points higher than observed | Lift/drag balance or the luff thresholds | Not a knob: review the sail coefficients (issue 16) |

## 3. Fit

```bash
npm run calibrate -- data/observations/my-log.csv --fit sailLift,righting
```

- **Method:** coordinate descent with a golden-section line search on each knob, over its range. It is deterministic.
- **Cost:** the weighted sum of squared residuals, each divided by a typical measurement uncertainty (0.1 kn, 1° heel, 0.5° leeway).
- **Fit few knobs:** use no more knobs than the observations can separate. Upwind points constrain `sailLift` and `righting`; reaching and running points constrain the resistance knobs.

The tool prints the multipliers, the cost before and after, and the residual table after the fit. It warns when:
- a knob ended **at the edge of its range**: it cannot explain the data, and widening the range would hide a model error;
- a knob is **insensitive**: across its whole range it changes the cost by less than 1%, so the observations do not constrain it. Do not adopt such a value.

## 4. Adopt (by hand)

The tool never writes data files. To adopt a result:

1. Multiply the affected values in `data/boats/squib/calibration.json`.
2. Change their tag to **C** (calibrated) and set `source` to the observation file and the date of the fit; keep the old value in `note`.
3. Commit the observation file under `data/observations/` with its own provenance.
4. Run `npm run params` (regenerates `PARAMETERS.md`), `npm run golden:update` (the golden traces will change) and `npm test`.
5. Record the before and after RMS in the commit message and in the phase report.

## 5. Check the workflow itself

`tests/sim/calibration.test.ts` checks the workflow on **synthetic** data:

| Test | What it shows |
|---|---|
| Self-consistency | Observations generated by the model itself with the residuary table × 1.4 ([`tests/fixtures/observations-SYNTHETIC-residuary1.4.csv`](../tests/fixtures/observations-SYNTHETIC-residuary1.4.csv), labelled SYNTHETIC). Starting from × 1.0, the fit recovers × 1.400 (test tolerance ± 0.02) and the cost falls from about 21 to 0.0001 |
| Insensitive knob | A downwind point (the boat is upright) cannot constrain `righting`: flagged insensitive |
| Knob at bound | 3 kn on a 12 kn beam reach cannot be explained by any `residuary` within 0.5–2.0: flagged at the bound |
| Parser | Rows without a source, or with non-numeric values, are rejected; the template has no data rows |

Recovering a known multiplier shows that the fitting machinery works. It does **not** show that the model structure is right: with real data, look at the residuals after the fit. Structured residuals (for example, always fast at one wind angle) mean a modelling error, not a coefficient to tune.
