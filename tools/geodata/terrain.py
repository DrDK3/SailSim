"""Terrain from Tilezen terrarium tiles (AWS open data), resampled to the local grid.

At Dartmouth the z15 tiles come from the Environment Agency LIDAR Composite DTM 2 m (OGL v3); the source
rasters are named per tile in the `x-amz-meta-x-imagery-sources` header, which we record for provenance.
"""
import collections
import io
import math

import numpy as np
from PIL import Image

from common import GRID_E, GRID_N, TO_LL, cached_get, domain_lonlat_bounds, header

Z = 15
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def lonlat_to_tile(lon, lat, z=Z):
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def build():
    w, s, e, n = domain_lonlat_bounds()
    x0, y1 = lonlat_to_tile(w, s)
    x1, y0 = lonlat_to_tile(e, n)
    tx = range(int(math.floor(x0)), int(math.floor(x1)) + 1)
    ty = range(int(math.floor(y0)), int(math.floor(y1)) + 1)
    mosaic = np.zeros((len(ty) * 256, len(tx) * 256), dtype=np.float64)
    sources = collections.Counter()
    for j, y in enumerate(ty):
        for i, x in enumerate(tx):
            p = cached_get(URL.format(z=Z, x=x, y=y), f"terrarium-{Z}-{x}-{y}.png")
            rgb = np.asarray(Image.open(p).convert("RGB")).astype(np.float64)
            mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
            for src in (header(p, "x-amz-meta-x-imagery-sources") or "unknown").split(","):
                sources[src.strip().split("/")[0]] += 1
    # Sample at the local grid cell centres (bilinear in tile-pixel space).
    E, N = np.meshgrid(GRID_E, GRID_N)
    lon, lat = TO_LL.transform(E, N)
    px, py = lonlat_to_tile(lon, lat)
    px = (px - tx[0]) * 256 - 0.5
    py = (py - ty[0]) * 256 - 0.5
    ix = np.clip(np.floor(px).astype(int), 0, mosaic.shape[1] - 2)
    iy = np.clip(np.floor(py).astype(int), 0, mosaic.shape[0] - 2)
    fx = np.clip(px - ix, 0, 1)
    fy = np.clip(py - iy, 0, 1)
    z = (mosaic[iy, ix] * (1 - fx) * (1 - fy) + mosaic[iy, ix + 1] * fx * (1 - fy)
         + mosaic[iy + 1, ix] * (1 - fx) * fy + mosaic[iy + 1, ix + 1] * fx * fy)
    return z, dict(tiles=len(tx) * len(ty), zoom=Z, sources=dict(sources))
