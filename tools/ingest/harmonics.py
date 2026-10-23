"""Derive tidal harmonic constants for Dartmouth from the EA gauge history, validate them on held-back days,
and write a year of predicted HW/LW events (Phase 6). Run by the scheduled job (weekly).

Method: UTide (Codiga 2011; Python port, MIT licence), ordinary least squares with nodal corrections, the
constituents resolvable in the record (Rayleigh criterion). Validation: fit on all but the last
HOLDOUT_DAYS, predict those days, and report the RMS and largest error against the gauge.

The result is labelled "derived from EA observations; not an official UKHO prediction". The app uses its
HW/LW events (cosine curve between them, as for any event list), so shallow-water distortion of the curve
between events is not shown even though the constants include it.

Usage:
    python -I tools/ingest/harmonics.py HISTORY_DIR OUT_CONSTANTS_JSON OUT_PREDICTED_JSON [--days 400]
Exit status: 0 = written; 3 = not enough data (nothing written); 1 = error.
"""
import argparse
import datetime as dt
import os
import sys

import numpy as np
import utide

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import IngestError, iso_z, write_json_atomic  # noqa: E402
from tide import CD_OFFSET_M, EA_ATTRIBUTION, read_history  # noqa: E402

LAT = 50.3512  # EA 46154 Dartmouth gauge
MIN_DAYS = 29  # a lunar month: separates M2, S2, N2, K1, O1
HOLDOUT_DAYS = 7
MAX_GAP_H = 6  # longer gaps are left as gaps (not interpolated)


def fit(times, heights):
    t = np.array([np.datetime64(x.replace(tzinfo=None)) for x in times])
    return utide.solve(t, np.asarray(heights, dtype=float), lat=LAT, method="ols", conf_int="linear", verbose=False)


def predict(coef, times):
    t = np.array([np.datetime64(x.replace(tzinfo=None)) for x in times])
    return utide.reconstruct(t, coef, verbose=False).h


def extrema(times, h):
    """HW/LW events from a 6-minute prediction: local maxima/minima, refined by a parabola through 3 points."""
    out = []
    step = (times[1] - times[0]).total_seconds()
    for i in range(1, len(h) - 1):
        if (h[i] > h[i - 1] and h[i] >= h[i + 1]) or (h[i] < h[i - 1] and h[i] <= h[i + 1]):
            a, b, c = h[i - 1], h[i], h[i + 1]
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if den != 0 else 0.0
            peak = b - 0.25 * (a - c) * off
            out.append((times[i] + dt.timedelta(seconds=off * step), "HW" if den < 0 else "LW", float(peak)))
    # Shallow-water double peaks (the Channel's "double high water" stand): keep alternating extremes.
    events = []
    for e in out:
        if events and events[-1][1] == e[1]:
            if (e[1] == "HW" and e[2] > events[-1][2]) or (e[1] == "LW" and e[2] < events[-1][2]):
                events[-1] = e
            continue
        events.append(e)
    return events


def derive(rows, now, days):
    times = [t for t, _ in rows]
    heights = [v for _, v in rows]
    span_days = (times[-1] - times[0]).total_seconds() / 86400
    if len(rows) < 96 * MIN_DAYS * 0.8 or span_days < MIN_DAYS + HOLDOUT_DAYS:
        raise ValueError(f"need at least {MIN_DAYS + HOLDOUT_DAYS} days of readings; have {span_days:.1f} days ({len(rows)} readings)")
    cut = times[-1] - dt.timedelta(days=HOLDOUT_DAYS)
    train = [(t, v) for t, v in rows if t <= cut]
    test = [(t, v) for t, v in rows if t > cut]
    coef_v = fit([t for t, _ in train], [v for _, v in train])
    err = np.array([v for _, v in test]) - predict(coef_v, [t for t, _ in test])
    coef = fit(times, heights)  # final constants from the whole record
    hind = np.array(heights) - predict(coef, times)
    order = np.argsort(-np.asarray(coef.A))
    constants = {
        "schema": "squib-tide-harmonics/1",
        "generated": iso_z(now),
        "station": "EA 46154 Dartmouth",
        "datum": "mAOD (add cdOffsetM for chart datum)",
        "cdOffsetM": CD_OFFSET_M,
        "method": "UTide (Python), OLS, nodal corrections, Rayleigh-resolvable constituents",
        "record": {"from": iso_z(times[0]), "to": iso_z(times[-1]), "readings": len(rows), "days": round(span_days, 1)},
        "mean_m": round(float(coef.mean), 3),
        "constituents": [{"name": str(coef.name[i]), "amp_m": round(float(coef.A[i]), 4), "phase_deg": round(float(coef.g[i]), 2)} for i in order],
        "validation": {
            "holdout_days": HOLDOUT_DAYS,
            "rms_m": round(float(np.sqrt(np.mean(err ** 2))), 3),
            "max_abs_m": round(float(np.max(np.abs(err))), 3),
            "hindcast_rms_m": round(float(np.sqrt(np.mean(hind ** 2))), 3),
            "note": "Errors include surge and river effects, which no harmonic prediction contains.",
        },
        "attribution": EA_ATTRIBUTION,
    }
    start = now.replace(minute=0, second=0, microsecond=0) - dt.timedelta(days=2)
    grid = [start + dt.timedelta(minutes=6 * k) for k in range(int(days * 240))]
    ev = extrema(grid, predict(coef, grid))
    v = constants["validation"]
    source = (f"Harmonic prediction derived from EA Dartmouth gauge observations ({constants['record']['days']} days; "
              f"held-back {HOLDOUT_DAYS}-day RMS {v['rms_m']} m). Not an official UKHO prediction")
    predicted = {
        "kind": "replay",
        "generated": iso_z(now),
        "predictions": {"source": source, "events": [{"time": iso_z(t), "type": k, "heightCD": round(h + CD_OFFSET_M, 2)} for t, k, h in ev]},
        "attribution": EA_ATTRIBUTION,
    }
    return constants, predicted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("history_dir")
    ap.add_argument("out_constants")
    ap.add_argument("out_predicted")
    ap.add_argument("--days", type=int, default=400)
    args = ap.parse_args()
    rows = read_history(args.history_dir)
    try:
        constants, predicted = derive(rows, dt.datetime.now(dt.timezone.utc), args.days)
    except ValueError as e:
        print(f"Not enough data: {e} (nothing written)")
        return 3
    except IngestError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    write_json_atomic(args.out_constants, constants)
    write_json_atomic(args.out_predicted, predicted)
    v = constants["validation"]
    print(f"Wrote {args.out_constants}: {len(constants['constituents'])} constituents from {constants['record']['days']} days; "
          f"held-back RMS {v['rms_m']} m, max {v['max_abs_m']} m. {len(predicted['predictions']['events'])} events to {args.out_predicted}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
