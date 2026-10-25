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


def mosaic():
    """The z15 terrarium mosaic over the domain (metres ODN), its first tile indices and the tile sources."""
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
    return dict(z=mosaic, tx0=tx[0], ty0=ty[0], tiles=len(tx) * len(ty), sources=dict(sources))


def sample(m, e, n):
    """Bilinear sample of the mosaic at local (e, n) (arrays), in tile-pixel space (about 3 m at Dartmouth)."""
    lon, lat = TO_LL.transform(np.asarray(e, dtype=float), np.asarray(n, dtype=float))
    px, py = lonlat_to_tile(lon, lat)
    z = m["z"]
    px = (px - m["tx0"]) * 256 - 0.5
    py = (py - m["ty0"]) * 256 - 0.5
    ix = np.clip(np.floor(px).astype(int), 0, z.shape[1] - 2)
    iy = np.clip(np.floor(py).astype(int), 0, z.shape[0] - 2)
    fx = np.clip(px - ix, 0, 1)
    fy = np.clip(py - iy, 0, 1)
    return (z[iy, ix] * (1 - fx) * (1 - fy) + z[iy, ix + 1] * fx * (1 - fy)
            + z[iy + 1, ix] * (1 - fx) * fy + z[iy + 1, ix + 1] * fx * fy)


def build(m=None):
    """Terrain on the simulation grid (8 m cell centres), from the mosaic."""
    m = m or mosaic()
    E, N = np.meshgrid(GRID_E, GRID_N)
    z = sample(m, E, N)
    return z, dict(tiles=m["tiles"], zoom=Z, sources=m["sources"])
