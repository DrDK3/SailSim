"""Feasibility spike: near-real-time wind for the lower Dart from Met Office open data on AWS.

Two independent sources, kept separate and labelled:

  * MODEL  - Met Office UKV 2 km deterministic forecast (s3://met-office-atmospheric-model-data,
             eu-west-2), 15-minute steps, 10 m wind speed / direction / gust. Gridded, so it
             covers the Dart itself. It is a forecast, not a measurement, and arrives 3-6 h after
             the model run time.
  * OBSERVED - Met Office UK land surface observations (s3://met-office-land-observations-data,
             eu-west-2), 1-minute means published in hourly batches (~1-2 h latency). The
             nearest stations are 35-45 km from Kingswear, so they show the regional wind,
             not the local Dart wind. The feed has no gust parameter.

Both datasets: British Crown copyright, the Met Office, CC BY-SA 4.0.

Usage:
    python -I live_conditions.py OUT_JSON [--at 2026-10-22T07:15Z]
"""
import argparse
import csv
import datetime as dt
import io
import json
import math
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import netCDF4
import numpy as np
import pyproj

MODEL_BUCKET = "https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com"
OBS_BUCKET = "https://met-office-land-observations-data.s3.eu-west-2.amazonaws.com"
MS_TO_KN = 1.0 / 0.514444

# Simulation area (lon/lat) and named sample points
AREA = (-3.70, 50.25, -3.45, 50.42)
POINTS = {
    "rdyc_kingswear": (50.34801, -3.57339),
    "dart_entrance": (50.3350, -3.5550),
    "start_bay_offshore": (50.3000, -3.5500),
    "dittisham_reach": (50.3800, -3.5900),
}
STATIONS = ("plymouth_mountbatten", "exeter_airport_no_2")
RDYC = POINTS["rdyc_kingswear"]


def http_get(url, timeout=60):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def list_keys(bucket, prefix, delimiter=None):
    """List S3 keys (or common prefixes when delimiter is given), following pagination."""
    out, token = [], None
    while True:
        q = f"{bucket}/?list-type=2&prefix={urllib.parse.quote(prefix)}"
        if delimiter:
            q += f"&delimiter={delimiter}"
        if token:
            q += f"&continuation-token={urllib.parse.quote(token)}"
        body = http_get(q).decode()
        tag = "Prefix" if delimiter else "Key"
        out += [m for m in re.findall(f"<{tag}>([^<]+)</{tag}>", body) if m != prefix]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not m:
            return out
        token = m.group(1)


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def circular_mean_std(degrees):
    s = np.mean(np.sin(np.radians(degrees)))
    c = np.mean(np.cos(np.radians(degrees)))
    r = min(1.0, math.hypot(s, c))
    return math.degrees(math.atan2(s, c)) % 360, math.degrees(math.sqrt(-2 * math.log(r))) if r > 0 else 180.0


# ---------------------------------------------------------------- model (UKV)

def model_file(run, valid, var):
    lead = valid - run
    hours, minutes = divmod(int(lead.total_seconds()) // 60, 60)
    return (f"{MODEL_BUCKET}/uk-deterministic-2km/{run:%Y%m%dT%H%MZ}/"
            f"{valid:%Y%m%dT%H%MZ}-PT{hours:04d}H{minutes:02d}M-{var}.nc")


def find_model_run(valid):
    """Newest run that already has a 10 m wind file for the valid time."""
    runs = []
    for day in (valid.date(), valid.date() - dt.timedelta(days=1)):
        for p in list_keys(MODEL_BUCKET, f"uk-deterministic-2km/{day:%Y%m%d}", delimiter="/"):
            m = re.search(r"(\d{8}T\d{4}Z)/$", p)
            if m:
                runs.append(dt.datetime.strptime(m.group(1), "%Y%m%dT%H%MZ").replace(tzinfo=dt.timezone.utc))
    for run in sorted((r for r in runs if r <= valid), reverse=True):
        req = urllib.request.Request(model_file(run, valid, "wind_speed_at_10m"), method="HEAD")
        try:
            urllib.request.urlopen(req, timeout=30)
            return run
        except urllib.error.HTTPError:
            continue
    return None


def read_field(run, valid, var):
    with tempfile.NamedTemporaryFile(suffix=".nc") as f:
        f.write(http_get(model_file(run, valid, var)))
        f.flush()
        ds = netCDF4.Dataset(f.name)
        field = next(v for v in ds.variables.values() if v.ndim == 2)
        gm = ds.variables[field.grid_mapping]
        crs = pyproj.CRS.from_cf({k: gm.getncattr(k) for k in gm.ncattrs()})
        return (np.array(field[:], dtype=float), np.array(ds.variables["projection_x_coordinate"][:]),
                np.array(ds.variables["projection_y_coordinate"][:]), crs)


def model_conditions(valid):
    run = find_model_run(valid)
    if run is None:
        return {"available": False, "reason": f"no UKV run yet covers {valid:%Y-%m-%dT%H:%MZ}"}
    speed, xs, ys, crs = read_field(run, valid, "wind_speed_at_10m")
    direction = read_field(run, valid, "wind_direction_at_10m")[0]
    gust = read_field(run, valid, "wind_gust_at_10m")[0]
    to_grid = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    to_ll = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

    def cell(lat, lon):
        x, y = to_grid.transform(lon, lat)
        return int(np.abs(ys - y).argmin()), int(np.abs(xs - x).argmin())

    points = {}
    for name, (lat, lon) in POINTS.items():
        i, j = cell(lat, lon)
        points[name] = {
            "lat": lat, "lon": lon,
            "wind_from_deg": round(float(direction[i, j]), 1),
            "speed_kn": round(float(speed[i, j]) * MS_TO_KN, 1),
            "gust_kn": round(float(gust[i, j]) * MS_TO_KN, 1),
        }

    # gridded subset over the simulation area, for a spatially varying wind field
    i0, j0 = cell(AREA[1], AREA[0])
    i1, j1 = cell(AREA[3], AREA[2])
    ii, jj = slice(min(i0, i1), max(i0, i1) + 1), slice(min(j0, j1), max(j0, j1) + 1)
    gx, gy = np.meshgrid(xs[jj], ys[ii])
    glon, glat = to_ll.transform(gx, gy)
    return {
        "available": True,
        "kind": "forecast model (not measured)",
        "source": "Met Office UKV 2 km deterministic, via AWS Open Data",
        "licence": "British Crown copyright, the Met Office, CC BY-SA 4.0",
        "run": f"{run:%Y-%m-%dT%H:%MZ}",
        "valid": f"{valid:%Y-%m-%dT%H:%MZ}",
        "lead": str(valid - run),
        "points": points,
        "grid": {
            "lat": np.round(glat, 5).tolist(), "lon": np.round(glon, 5).tolist(),
            "wind_from_deg": np.round(direction[ii, jj], 1).tolist(),
            "speed_kn": np.round(speed[ii, jj] * MS_TO_KN, 1).tolist(),
            "gust_kn": np.round(gust[ii, jj] * MS_TO_KN, 1).tolist(),
        },
    }


# ------------------------------------------------------------- observations

def latest_obs_key(station, now):
    for back in range(0, 8):
        t = now - dt.timedelta(hours=back)
        keys = [k for k in list_keys(OBS_BUCKET, f"{t:%Y%m%d%H}") if f"/{station}_" in k]
        if keys:
            return sorted(keys)[-1]
    return None


def observed_conditions(now):
    out = []
    for station in STATIONS:
        key = latest_obs_key(station, now)
        if key is None:
            out.append({"station": station, "available": False})
            continue
        rows = list(csv.DictReader(io.StringIO(http_get(f"{OBS_BUCKET}/{key}").decode()), delimiter="|"))
        good = [r for r in rows if r["wind_speed_near_surface_1_minute_mean"]
                and r["wind_direction_near_surface_1_minute_mean"]]
        if not good:
            out.append({"station": station, "available": False})
            continue
        spd = np.array([float(r["wind_speed_near_surface_1_minute_mean"]) for r in good])
        wdir = np.array([float(r["wind_direction_near_surface_1_minute_mean"]) for r in good])
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
                "air_temperature_c": last["air_temperature_near_surface_1_minute_mean"] or None,
                "visibility_m": last["meteorological_optical_range_horizontal_1_minute_mean"] or None,
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
        "licence": "British Crown copyright, the Met Office, CC BY-SA 4.0",
        "note": "1-minute means; no gust parameter in this feed",
        "stations": out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_json")
    ap.add_argument("--at", help="UTC time, e.g. 2026-10-22T07:15Z (default: now)")
    args = ap.parse_args()
    now = (dt.datetime.strptime(args.at, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
           if args.at else dt.datetime.now(dt.timezone.utc))
    valid = now.replace(second=0, microsecond=0, minute=(now.minute // 15) * 15)
    result = {
        "generated": f"{dt.datetime.now(dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ}",
        "requested_time": f"{now:%Y-%m-%dT%H:%MZ}",
        "model": model_conditions(valid),
        "observed": observed_conditions(now),
    }
    with open(args.out_json, "w") as f:
        json.dump(result, f, indent=1)
    m = result["model"]
    if m["available"]:
        for name, p in m["points"].items():
            print(f"MODEL {m['valid']} (run {m['run']}) {name:20s} {p['wind_from_deg']:5.0f}°  "
                  f"{p['speed_kn']:4.1f} kn  gust {p['gust_kn']:4.1f} kn")
    else:
        print("MODEL unavailable:", m["reason"])
    for s in result["observed"]["stations"]:
        if s["available"]:
            h = s["hour_1min_stats"]
            print(f"OBS   {s['latest']['time']} {s['station'][:28]:28s} {s['distance_from_rdyc_km']:5.1f} km  "
                  f"latest {s['latest']['wind_from_deg']:3d}° {s['latest']['speed']:4.1f}  "
                  f"hour mean {h['wind_from_mean_deg']:3d}° {h['speed_mean']:4.1f} "
                  f"(1-min range {h['speed_min']}-{h['speed_max_1min_mean']}, dir sd {h['direction_std_deg']}°)")


if __name__ == "__main__":
    main()
