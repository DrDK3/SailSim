"""Phase 0 feasibility spike: sample Tilezen/Mapzen terrarium terrain tiles at Dart landmarks.

Tiles are public on AWS (s3://elevation-tiles-prod). The response metadata header
`x-amz-meta-x-imagery-sources` names the source rasters; for Dartmouth this is
`uk_lidar/LIDAR-DTM-2M-SX85.tif` (Environment Agency LIDAR Composite DTM 2 m, OGL v3).

Usage:
    python -I probe_terrain.py
"""
import io
import math
import urllib.request

import numpy as np
from PIL import Image

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Positions are OSM/Overture building or feature centroids (see landmarks_extracted.json)
POINTS = {
    "Royal Dart Yacht Club": (-3.57339, 50.34801),
    "Dartmouth Castle": (-3.56572, 50.34180),
    "Kingswear Castle": (-3.55986, 50.34202),
    "Mid-river off Dartmouth": (-3.57450, 50.35050),
    "Britannia Royal Naval College": (-3.58278, 50.35722),
}


def tile_coords(lon, lat, z):
    n = 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch(z, x, y):
    with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=30) as r:
        sources = r.headers.get("x-amz-meta-x-imagery-sources")
        rgb = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB")).astype(float)
    # terrarium encoding: (R * 256 + G + B / 256) - 32768 metres
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768, sources


def main():
    z = 15
    for name, (lon, lat) in POINTS.items():
        fx, fy = tile_coords(lon, lat, z)
        elev, sources = fetch(z, int(fx), int(fy))
        px, py = int((fx % 1) * 256), int((fy % 1) * 256)
        print(f"{name:32s} {elev[py, px]:7.2f} m   sources={sources}")
    res = math.cos(math.radians(50.35)) * 2 * math.pi * 6378137 / (256 * 2**z)
    print(f"ground resolution at z{z}: {res:.2f} m/pixel")


if __name__ == "__main__":
    main()
