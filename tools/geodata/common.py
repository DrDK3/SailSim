"""Shared settings for the geodata pipeline: domain, projection, grid, caching.

The local frame is Transverse Mercator about the RDYC origin. The app implements the same projection
(src/sim/geo/projection.ts) and a test checks the two agree to under a millimetre.
"""
import os
import urllib.request

import numpy as np
import pyproj

ORIGIN = (50.34801, -3.57339)  # lat, lon: RDYC clubhouse footprint centroid (OSM via Overture)
PROJ = f"+proj=tmerc +lat_0={ORIGIN[0]} +lon_0={ORIGIN[1]} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
TO_LOCAL = pyproj.Transformer.from_crs("EPSG:4326", PROJ, always_xy=True)  # (lon, lat) -> (e, n)
TO_LL = pyproj.Transformer.from_crs(PROJ, "EPSG:4326", always_xy=True)  # (e, n) -> (lon, lat)
GEOD = pyproj.Geod(ellps="WGS84")

# Simulation domain in local metres (inside the Overture extract bbox lon -3.62..-3.52, lat 50.30..50.39).
E_MIN, E_MAX = -3200.0, 3600.0
N_MIN, N_MAX = -5200.0, 4560.0
# Elevation grid (terrain and bed share one grid so what you see is what the keel feels).
CELL = 8.0
NX = int(round((E_MAX - E_MIN) / CELL))
NY = int(round((N_MAX - N_MIN) / CELL))
# Cell centres
GRID_E = E_MIN + CELL * (np.arange(NX) + 0.5)
GRID_N = N_MIN + CELL * (np.arange(NY) + 0.5)

# Chart datum at Dartmouth relative to Ordnance Datum Newlyn: CD = ODN - 2.62 m (secondary source; issue 14).
CD_BELOW_ODN = 2.62

CACHE = os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "geodata")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "geo")


def cached_get(url, name):
    """Download once into .cache/geodata (with response headers saved alongside)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
            headers = dict(r.headers)
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
        with open(path + ".headers", "w") as f:
            for k, v in headers.items():
                f.write(f"{k}: {v}\n")
    return path


def header(path, key):
    try:
        with open(path + ".headers") as f:
            for line in f:
                k, _, v = line.partition(": ")
                if k.lower() == key.lower():
                    return v.strip()
    except FileNotFoundError:
        pass
    return None


def domain_lonlat_bounds(margin_m=200.0):
    es = [E_MIN - margin_m, E_MAX + margin_m]
    ns = [N_MIN - margin_m, N_MAX + margin_m]
    lons, lats = [], []
    for e in np.linspace(es[0], es[1], 9):
        for n in np.linspace(ns[0], ns[1], 9):
            lon, lat = TO_LL.transform(e, n)
            lons.append(lon)
            lats.append(lat)
    return min(lons), min(lats), max(lons), max(lats)
