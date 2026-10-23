"""Scheduled live-weather ingest for the simulator (Phase 6). Writes live/latest.json (schema squib-weather/2).

Sources (both British Crown copyright, the Met Office, CC BY-SA 4.0; public S3, no keys):
  * MODEL  - Met Office UKV 2 km deterministic forecast. 10 m wind (speed, direction, gust) on a grid over the
             sailing area every 15 minutes for the next HORIZON_MIN minutes, so a session can follow the
             forecast's changes; and, hourly, the sky: total and low cloud, visibility, precipitation and
             rain rate, fog fraction, air temperature and sea-level pressure, at RDYC and as area means.
             A forecast, not a measurement; runs arrive 3-6 h after their run time.
  * OBSERVED - Met Office land observations (1-minute means in hourly batches). The nearest stations are
             35-45 km from Kingswear: they show the regional wind and its direction scatter, not the Dart.

Schema squib-weather/2 keeps every squib-weather/1 field (model.valid, points, grid at the first step), so
older app builds still read it, and adds model.steps, model.sky and model.horizon.

Usage:
    python -I tools/ingest/weather.py OUT_JSON [--at 2026-10-22T07:15Z] [--horizon-min 120] [--no-obs]
Exit status: 0 = written; 3 = no model run covers the time yet (nothing written; keep the old file);
1 = error (nothing written).
"""
import argparse
import csv
import datetime as dt
import io
import math
import os
import sys
import tempfile

import netCDF4
import numpy as np
import pyproj

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import IngestError, exists, http_get, iso_z, s3_list, write_json_atomic  # noqa: E402

SCHEMA = "squib-weather/2"
MODEL_BUCKET = "https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com"
OBS_BUCKET = "https://met-office-land-observations-data.s3.eu-west-2.amazonaws.com"
MS_TO_KN = 1.0 / 0.514444
LICENCE = "British Crown copyright, the Met Office, CC BY-SA 4.0"

AREA = (-3.70, 50.25, -3.45, 50.42)  # lon/lat box of the sailing area
POINTS = {
    "rdyc_kingswear": (50.34801, -3.57339),
    "dart_entrance": (50.3350, -3.5550),
    "start_bay_offshore": (50.3000, -3.5500),
    "dittisham_reach": (50.3800, -3.5900),
}
RDYC = POINTS["rdyc_kingswear"]
STATIONS = ("plymouth_mountbatten", "exeter_airport_no_2")
STEP_MIN = 15
SKY_EVERY_MIN = 60

# Sky variables: output name, UKV file, conversion from the file's units, decimals.
SKY_VARS = (
    ("cloud_total", "cloud_amount_of_total_cloud", lambda a: a, 2),          # fraction 0-1
    ("cloud_low", "cloud_amount_of_low_cloud", lambda a: a, 2),              # fraction 0-1
    ("visibility_m", "visibility_at_screen_level", lambda a: a, 0),          # m
    ("precip_mm_h", "precipitation_rate", lambda a: a * 3.6e6, 2),           # m s-1 (water) -> mm/h
    ("rain_mm_h", "rainfall_rate", lambda a: a * 3.6e6, 2),                  # m s-1 -> mm/h
    ("fog_fraction", "fog_fraction_at_screen_level", lambda a: a, 2),        # fraction 0-1
    ("air_temp_c", "temperature_at_screen_level", lambda a: a - 273.15, 1),  # K -> degC
    ("mslp_hpa", "pressure_at_mean_sea_level", lambda a: a / 100.0, 1),      # Pa -> hPa
)


def model_file(run, valid, var):
    lead = valid - run
    hours, minutes = divmod(int(lead.total_seconds()) // 60, 60)
    return (f"{MODEL_BUCKET}/uk-deterministic-2km/{run:%Y%m%dT%H%MZ}/"
            f"{valid:%Y%m%dT%H%MZ}-PT{hours:04d}H{minutes:02d}M-{var}.nc")


def find_model_run(valid):
    """Newest run that already has the 10 m wind for the valid time."""
    runs = []
    for day in (valid.date(), valid.date() - dt.timedelta(days=1)):
        for p in s3_list(MODEL_BUCKET, f"uk-deterministic-2km/{day:%Y%m%d}", delimiter="/"):
            name = p.rstrip("/").rsplit("/", 1)[-1]
            try:
                runs.append(dt.datetime.strptime(name, "%Y%m%dT%H%MZ").replace(tzinfo=dt.timezone.utc))
            except ValueError:
                continue
    for run in sorted((r for r in runs if r <= valid), reverse=True):
        if exists(model_file(run, valid, "wind_speed_at_10m")):
            return run
    return None


class Field:
    """One UKV 2-D field with its projection, sub-set to the sailing area."""

    _cache = {}

    def __init__(self, run, valid, var):
        with tempfile.NamedTemporaryFile(suffix=".nc") as f:
            f.write(http_get(model_file(run, valid, var), timeout=120))
            f.flush()
            ds = netCDF4.Dataset(f.name)
            v = next(x for x in ds.variables.values() if x.ndim == 2)
            self.data = np.ma.filled(np.ma.asarray(v[:], dtype=float), np.nan)
            self.units = getattr(v, "units", "")
            xs = np.array(ds.variables["projection_x_coordinate"][:])
            ys = np.array(ds.variables["projection_y_coordinate"][:])
            gm = ds.variables[v.grid_mapping]
            key = tuple((k, str(gm.getncattr(k))) for k in gm.ncattrs())
            if key not in Field._cache:
                crs = pyproj.CRS.from_cf({k: gm.getncattr(k) for k in gm.ncattrs()})
                Field._cache[key] = (pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True),
                                     pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True))
            self.to_grid, self.to_ll = Field._cache[key]
            ds.close()
        self.xs, self.ys = xs, ys
        i0, j0 = self.cell(AREA[1], AREA[0])
        i1, j1 = self.cell(AREA[3], AREA[2])
        self.ii = slice(min(i0, i1), max(i0, i1) + 1)
        self.jj = slice(min(j0, j1), max(j0, j1) + 1)

    def cell(self, lat, lon):
        x, y = self.to_grid.transform(lon, lat)
        return int(np.abs(self.ys - y).argmin()), int(np.abs(self.xs - x).argmin())

    def at(self, lat, lon):
        i, j = self.cell(lat, lon)
        return float(self.data[i, j])

    def area(self):
        return self.data[self.ii, self.jj]

    def latlon(self):
        gx, gy = np.meshgrid(self.xs[self.jj], self.ys[self.ii])
        lon, lat = self.to_ll.transform(gx, gy)
        return lat, lon


def r(a, nd):
    return np.round(a, nd).tolist()


def wind_step(run, valid):
    speed = Field(run, valid, "wind_speed_at_10m")
    direction = Field(run, valid, "wind_direction_at_10m")
    gust = Field(run, valid, "wind_gust_at_10m")
    if "m s-1" not in speed.units or "m s-1" not in gust.units:
        raise IngestError(f"unexpected wind units: {speed.units!r}, {gust.units!r}")
    return speed, direction, gust


def sky_step(run, valid):
    out = {"valid": f"{valid:%Y-%m-%dT%H:%MZ}", "rdyc": {}, "area_mean": {}}
    for name, var, conv, nd in SKY_VARS:
        try:
            f = Field(run, valid, var)
        except Exception as e:  # one missing sky variable must not lose the wind
            out["rdyc"][name] = None
            out["area_mean"][name] = None
            print(f"  sky {var} at {valid:%H:%MZ} unavailable: {e}", file=sys.stderr)
            continue
        out["rdyc"][name] = round(float(conv(f.at(*RDYC))), nd)
        out["area_mean"][name] = round(float(conv(np.nanmean(f.area()))), nd)
    return out


def model_conditions(valid0, horizon_min):
    run = find_model_run(valid0)
    if run is None:
        return {"available": False, "reason": f"no UKV run yet covers {valid0:%Y-%m-%dT%H:%MZ}"}
    steps, first = [], None
    for k in range(horizon_min // STEP_MIN + 1):
        valid = valid0 + dt.timedelta(minutes=k * STEP_MIN)
        if k > 0 and not exists(model_file(run, valid, "wind_speed_at_10m")):
            break  # the run ends before the horizon: publish what there is
        speed, direction, gust = wind_step(run, valid)
        if first is None:
            first = (speed, direction, gust)
        steps.append({
            "valid": f"{valid:%Y-%m-%dT%H:%MZ}",
            "wind_from_deg": r(direction.area(), 1),
            "speed_kn": r(speed.area() * MS_TO_KN, 1),
            "gust_kn": r(gust.area() * MS_TO_KN, 1),
        })
    sky = []
    for k in range(0, horizon_min + 1, SKY_EVERY_MIN):
        valid = valid0 + dt.timedelta(minutes=k)
        if valid > valid0 + dt.timedelta(minutes=(len(steps) - 1) * STEP_MIN):
            break
        sky.append(sky_step(run, valid))
    speed, direction, gust = first
    lat, lon = speed.latlon()
    points = {}
    for name, (plat, plon) in POINTS.items():
        points[name] = {
            "lat": plat, "lon": plon,
            "wind_from_deg": round(direction.at(plat, plon), 1),
            "speed_kn": round(speed.at(plat, plon) * MS_TO_KN, 1),
            "gust_kn": round(gust.at(plat, plon) * MS_TO_KN, 1),
        }
    s0 = steps[0]
    return {
        "available": True,
        "kind": "forecast model (not measured)",
        "source": "Met Office UKV 2 km deterministic, via AWS Open Data",
        "licence": LICENCE,
        "run": f"{run:%Y-%m-%dT%H:%MZ}",
        "valid": s0["valid"],
        "lead": str(valid0 - run),
        "horizon": {"from": s0["valid"], "to": steps[-1]["valid"], "step_min": STEP_MIN},
        "points": points,
        "grid": {"lat": r(lat, 5), "lon": r(lon, 5), "wind_from_deg": s0["wind_from_deg"],
                 "speed_kn": s0["speed_kn"], "gust_kn": s0["gust_kn"]},
        "steps": steps,
        "sky": sky,
    }


# ------------------------------------------------------------- observations

def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def circular_mean_std(degrees):
    s = np.mean(np.sin(np.radians(degrees)))
    c = np.mean(np.cos(np.radians(degrees)))
    rr = min(1.0, math.hypot(s, c))
    return math.degrees(math.atan2(s, c)) % 360, math.degrees(math.sqrt(-2 * math.log(rr))) if rr > 0 else 180.0


def latest_obs_key(station, now):
    for back in range(0, 8):
        t = now - dt.timedelta(hours=back)
        keys = [k for k in s3_list(OBS_BUCKET, f"{t:%Y%m%d%H}") if f"/{station}_" in k]
        if keys:
            return sorted(keys)[-1]
    return None


def observed_conditions(now):
    out = []
    for station in STATIONS:
        try:
            key = latest_obs_key(station, now)
            rows = list(csv.DictReader(io.StringIO(http_get(f"{OBS_BUCKET}/{key}").decode()), delimiter="|")) if key else []
        except Exception as e:
            print(f"  observations {station} unavailable: {e}", file=sys.stderr)
            rows = []
        good = [x for x in rows if x.get("wind_speed_near_surface_1_minute_mean") and x.get("wind_direction_near_surface_1_minute_mean")]
        if not good:
            out.append({"station": station, "available": False})
            continue
        spd = np.array([float(x["wind_speed_near_surface_1_minute_mean"]) for x in good])
        wdir = np.array([float(x["wind_direction_near_surface_1_minute_mean"]) for x in good])
        dmean, dstd = circular_mean_std(wdir)
        lat, lon = float(rows[0]["latitude"]), float(rows[0]["longitude"])
        last = good[-1]
        out.append({
            "available": True,
            "station": rows[0]["name"],
            "lat": lat, "lon": lon,
            "distance_from_rdyc_km": round(haversine_km(RDYC, (lat, lon)), 1),
            "period": f"{good[0]['timestep']} .. {last['timestep']}",
            "latest": {
                "time": last["timestep"],
                "wind_from_deg": round(float(last["wind_direction_near_surface_1_minute_mean"])),
                "speed": round(float(last["wind_speed_near_surface_1_minute_mean"]), 1),
                "visibility_m": last.get("meteorological_optical_range_horizontal_1_minute_mean") or None,
            },
            "hour_1min_stats": {
                "speed_mean": round(float(spd.mean()), 1),
                "speed_min": round(float(spd.min()), 1),
                "speed_max_1min_mean": round(float(spd.max()), 1),
                "wind_from_mean_deg": round(dmean),
                "direction_std_deg": round(dstd, 1),
            },
            "speed_units": "knots (INFERRED, not yet confirmed from Met Office documentation)",
        })
    return {
        "kind": "measured observations (regional, not on the Dart)",
        "source": "Met Office UK land surface observations, via AWS Open Data",
        "licence": LICENCE,
        "note": "1-minute means; no gust parameter in this feed",
        "stations": out,
    }


# ---------------------------------------------------------------- checks

def validate(result):
    """Physical-range checks before anything is published. Raises IngestError."""
    m = result["model"]
    if not m.get("available"):
        return
    steps = m["steps"]
    if not steps:
        raise IngestError("no forecast steps")
    shape = np.array(m["grid"]["lat"]).shape
    if len(shape) != 2 or shape[0] < 2 or shape[1] < 2:
        raise IngestError(f"grid too small: {shape}")
    for s in steps:
        for k, lo, hi in (("speed_kn", 0, 150), ("gust_kn", 0, 200), ("wind_from_deg", 0, 360)):
            a = np.array(s[k], dtype=float)
            if a.shape != shape or not np.all(np.isfinite(a)) or a.min() < lo or a.max() > hi:
                raise IngestError(f"{k} at {s['valid']} out of range or wrong shape")
    for s in m["sky"]:
        for where in ("rdyc", "area_mean"):
            v = s[where]
            for k, lo, hi in (("cloud_total", 0, 1), ("cloud_low", 0, 1), ("fog_fraction", 0, 1),
                              ("visibility_m", 0, 2e5), ("precip_mm_h", 0, 500), ("air_temp_c", -40, 45)):
                x = v.get(k)
                if x is not None and not (lo <= x <= hi):
                    raise IngestError(f"sky {k}={x} at {s['valid']} out of range")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_json")
    ap.add_argument("--at", help="UTC time, e.g. 2026-10-22T07:15Z (default: now)")
    ap.add_argument("--horizon-min", type=int, default=120)
    ap.add_argument("--no-obs", action="store_true")
    args = ap.parse_args()
    now = (dt.datetime.strptime(args.at, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
           if args.at else dt.datetime.now(dt.timezone.utc))
    valid0 = now.replace(second=0, microsecond=0, minute=(now.minute // STEP_MIN) * STEP_MIN)
    try:
        model = model_conditions(valid0, args.horizon_min)
        if not model["available"]:
            print(f"MODEL unavailable: {model['reason']} (nothing written)")
            return 3
        result = {
            "schema": SCHEMA,
            "generated": iso_z(dt.datetime.now(dt.timezone.utc)),
            "requested_time": f"{now:%Y-%m-%dT%H:%MZ}",
            "model": model,
            "observed": {"stations": []} if args.no_obs else observed_conditions(now),
        }
        validate(result)
    except IngestError as e:
        print(f"ERROR: {e} (nothing written)", file=sys.stderr)
        return 1
    write_json_atomic(args.out_json, result)
    m = result["model"]
    p = m["points"]["rdyc_kingswear"]
    print(f"Wrote {args.out_json}: UKV run {m['run']}, {len(m['steps'])} wind steps {m['horizon']['from']} .. "
          f"{m['horizon']['to']}, {len(m['sky'])} sky steps. RDYC now {p['wind_from_deg']:.0f}° {p['speed_kn']} kn "
          f"(gust {p['gust_kn']}); cloud {m['sky'][0]['rdyc'].get('cloud_total')}, "
          f"visibility {m['sky'][0]['rdyc'].get('visibility_m')} m, rain {m['sky'][0]['rdyc'].get('rain_mm_h')} mm/h.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
