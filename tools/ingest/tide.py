"""Scheduled live-tide ingest for the simulator (Phase 6). Writes live/tide.json (the app's TideSnapshot format,
src/sim/env/tide.ts) and appends the gauge readings to a history used to derive harmonic constants.

NOT YET RUN AGAINST THE REAL SERVICES: both hosts are blocked in the development environment. The request
and response shapes follow the providers' published documentation and are covered by fixture tests
(tools/ingest/test_ingest.py); the first scheduled run must be checked (docs/DEPLOYMENT.md, "First run").

Sources:
  * MEASURED height - Environment Agency real-time flood-monitoring API, station 46154 "Dartmouth" (15-min
    tidal level, mAOD). No key. Open Government Licence v3 ("contains Environment Agency data").
  * PREDICTED HW/LW - UKHO ADMIRALTY UK Tidal API (Discovery tier), station "Dartmouth". Needs a key, read
    from the UKHO_API_KEY environment variable (a CI secret; never in the app). Without a key, the job's own
    harmonic predictions (tools/ingest/harmonics.py, derived from the EA gauge) are used and labelled so.

Heights above chart datum = mAOD + CD_OFFSET_M (2.62 m, provisional: docs/MISSING_INFORMATION.md C8).

Usage:
    python -I tools/ingest/tide.py OUT_JSON [--history DIR] [--predicted PATH] [--hours 48]
Exit status: 0 = written; 3 = no predictions available (nothing written); 1 = error (nothing written).
"""
import argparse
import csv
import datetime as dt
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import IngestError, http_get, iso_z, write_json_atomic  # noqa: E402

EA = "https://environment.data.gov.uk/flood-monitoring"
EA_STATION = "46154"
UKHO = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1"
UKHO_STATION_NAME = "Dartmouth"
CD_OFFSET_M = 2.62
EA_ATTRIBUTION = "Contains Environment Agency data, Open Government Licence v3.0"
UKHO_ATTRIBUTION = "Tidal predictions © Crown copyright, UK Hydrographic Office (ADMIRALTY UK Tidal API)"


def parse_time(s):
    """ISO time to an aware UTC datetime. Times without a zone are taken as UTC (as both APIs document)."""
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


# ------------------------------------------------------------ EA gauge

def ea_tidal_measure(station_json):
    """The 15-minute tidal-level measure (mAOD) of an EA station document."""
    items = station_json.get("items", station_json)
    measures = items.get("measures", [])
    if isinstance(measures, dict):
        measures = [measures]
    for m in measures:
        mid = m.get("@id", "") if isinstance(m, dict) else str(m)
        qual = (m.get("qualifier", "") if isinstance(m, dict) else "").lower()
        unit = (m.get("unitName", "") if isinstance(m, dict) else "")
        if ("tidal" in qual or "tidal_level" in mid) and ("mAOD" in unit or mid.endswith("mAOD")):
            return mid
    raise IngestError(f"station {EA_STATION}: no tidal-level mAOD measure among {len(measures)} measures")


def ea_readings(readings_json):
    """[(time, mAOD)] sorted by time, from an EA readings document; bad values skipped."""
    out = []
    for r in readings_json.get("items", []):
        try:
            v = float(r["value"])
            out.append((parse_time(r["dateTime"]), v))
        except (KeyError, TypeError, ValueError):
            continue
    out.sort()
    # The EA sometimes repeats a timestamp: keep the last value.
    dedup = {}
    for t, v in out:
        dedup[t] = v
    readings = sorted(dedup.items())
    for t, v in readings:
        if not -6.0 <= v <= 6.0:
            raise IngestError(f"gauge value {v} mAOD at {t} outside any plausible Dartmouth level")
    return readings


def fetch_gauge(hours):
    station = json.loads(http_get(f"{EA}/id/stations/{EA_STATION}"))
    measure = ea_tidal_measure(station)
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    url = f"{measure}/readings?_sorted&_limit=2000&since={since:%Y-%m-%dT%H:%M:%SZ}"
    return measure, ea_readings(json.loads(http_get(url)))


# ------------------------------------------------------------ UKHO predictions

def ukho_station_id(stations_json, name=UKHO_STATION_NAME):
    feats = stations_json.get("features", stations_json if isinstance(stations_json, list) else [])
    for f in feats:
        p = f.get("properties", f)
        if str(p.get("Name", "")).strip().lower() == name.lower():
            return str(p["Id"])
    raise IngestError(f"UKHO: no station named {name}")


def ukho_events(events_json):
    """[(time, 'HW'|'LW', height m CD)] from a UKHO TidalEvents list."""
    out = []
    for e in events_json:
        kind = {"HighWater": "HW", "LowWater": "LW"}.get(e.get("EventType"))
        if kind is None or e.get("Height") is None:
            continue
        out.append((parse_time(e["DateTime"]), kind, float(e["Height"])))
    out.sort()
    return alternate(out)


def fetch_ukho(key, days=7):
    hdr = {"Ocp-Apim-Subscription-Key": key}
    sid = ukho_station_id(json.loads(http_get(f"{UKHO}/Stations?name={UKHO_STATION_NAME}", headers=hdr)))
    return sid, ukho_events(json.loads(http_get(f"{UKHO}/Stations/{sid}/TidalEvents?duration={days}", headers=hdr)))


def alternate(events):
    """Keep events alternating HW/LW (the app requires it): of two in a row of the same kind keep the extreme."""
    out = []
    for e in events:
        if out and out[-1][1] == e[1]:
            keep_new = e[2] > out[-1][2] if e[1] == "HW" else e[2] < out[-1][2]
            if keep_new:
                out[-1] = e
            continue
        out.append(e)
    return out


# ------------------------------------------------------------ history (for harmonics.py)

def append_history(history_dir, readings):
    """Append readings to monthly CSVs (time, mAOD), de-duplicated by time. Returns rows added."""
    os.makedirs(history_dir, exist_ok=True)
    by_month = {}
    for t, v in readings:
        by_month.setdefault(f"{t:%Y-%m}", []).append((t, v))
    added = 0
    for month, rows in by_month.items():
        path = os.path.join(history_dir, f"dartmouth-{month}.csv")
        have = {}
        if os.path.exists(path):
            with open(path) as f:
                for r in csv.DictReader(f):
                    have[r["time"]] = float(r["mAOD"])
        for t, v in rows:
            k = iso_z(t)
            if k not in have:
                added += 1
            have[k] = v
        with open(path + ".tmp", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["time", "mAOD"])
            for k in sorted(have):
                w.writerow([k, f"{have[k]:.3f}"])
        os.replace(path + ".tmp", path)
    return added


def read_history(history_dir):
    rows = []
    for path in sorted(glob.glob(os.path.join(history_dir, "dartmouth-*.csv"))):
        with open(path) as f:
            rows += [(parse_time(r["time"]), float(r["mAOD"])) for r in csv.DictReader(f)]
    return sorted(dict(rows).items())


# ------------------------------------------------------------ main

def build_snapshot(events, source, readings, measure, now):
    if len(events) < 2:
        raise IngestError("fewer than two predicted events")
    snap = {
        "kind": "live",
        "generated": iso_z(now),
        "predictions": {"source": source, "events": [{"time": iso_z(t), "type": k, "heightCD": round(h, 2)} for t, k, h in events]},
        "attribution": EA_ATTRIBUTION,
    }
    if readings:
        snap["gauge"] = {
            "source": "Environment Agency flood-monitoring API",
            "station": f"{EA_STATION} Dartmouth (measure {measure.rsplit('/', 1)[-1]})",
            "cdOffsetM": CD_OFFSET_M,
            "readings": [{"time": iso_z(t), "mAOD": round(v, 3)} for t, v in readings],
        }
    if "UKHO" in source:
        snap["attribution"] += "; " + UKHO_ATTRIBUTION
    return snap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_json")
    ap.add_argument("--history", help="directory of monthly gauge CSVs to append to")
    ap.add_argument("--predicted", help="harmonic predictions (tide-predicted.json from harmonics.py), used without a UKHO key")
    ap.add_argument("--hours", type=int, default=48, help="hours of gauge readings to publish")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    readings, measure = [], ""
    try:
        measure, readings = fetch_gauge(args.hours)
        print(f"EA gauge: {len(readings)} readings, latest {iso_z(readings[-1][0]) if readings else 'none'}")
        if args.history and readings:
            print(f"history: {append_history(args.history, readings)} new readings in {args.history}")
    except Exception as e:  # the gauge is optional: predictions alone are still useful
        print(f"EA gauge unavailable: {e}", file=sys.stderr)
    events, source = [], ""
    key = os.environ.get("UKHO_API_KEY", "").strip()
    try:
        if key:
            sid, events = fetch_ukho(key)
            source = f"UKHO ADMIRALTY UK Tidal API, station {sid} Dartmouth (official prediction)"
        elif args.predicted and os.path.exists(args.predicted):
            with open(args.predicted) as f:
                pred = json.load(f)
            window = [e for e in pred["predictions"]["events"] if now - dt.timedelta(days=1) <= parse_time(e["time"]) <= now + dt.timedelta(days=7)]
            events = alternate([(parse_time(e["time"]), e["type"], float(e["heightCD"])) for e in window])
            source = pred["predictions"]["source"]
        if not events:
            print("No predictions: no UKHO_API_KEY and no harmonic predictions (nothing written)")
            return 3
        snap = build_snapshot(events, source, readings, measure, now)
    except IngestError as e:
        print(f"ERROR: {e} (nothing written)", file=sys.stderr)
        return 1
    write_json_atomic(args.out_json, snap)
    print(f"Wrote {args.out_json}: {len(events)} events from {source}; {len(readings)} gauge readings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
