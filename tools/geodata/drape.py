"""Terrain colour from a cloud-free Sentinel-2 L2A true-colour image (10 m), resampled to the local grid.

Contains modified Copernicus Sentinel data (via the Sentinel-2 COGs on AWS Open Data, Element 84).
"""
import os

import numpy as np
import pyproj
import rasterio
from rasterio.windows import from_bounds

from common import E_MAX, E_MIN, N_MAX, N_MIN, TO_LL, domain_lonlat_bounds

SCENE = "S2C_30UVA_20250712_0_L2A"  # 0.0015% cloud over the tile, no missing data
URL = f"/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/30/U/VA/2025/7/{SCENE}/TCI.tif"
CELL = 10.0
PARAMS = dict(scene=SCENE, band="TCI (true colour, 10 m)", cell_m=CELL, gamma=0.85, gain=1.15)


def build():
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    w, s, e, n = domain_lonlat_bounds(margin_m=100)
    with rasterio.open(URL) as src:
        to_utm = pyproj.Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        xs, ys = to_utm.transform([w, e, w, e], [s, s, n, n])
        win = from_bounds(min(xs), min(ys), max(xs), max(ys), src.transform).round_offsets().round_lengths()
        img = src.read(window=win).astype(np.float64)  # (3, h, w)
        tf = src.window_transform(win)
    nx = int(round((E_MAX - E_MIN) / CELL))
    ny = int(round((N_MAX - N_MIN) / CELL))
    ge = E_MIN + CELL * (np.arange(nx) + 0.5)
    gn = N_MIN + CELL * (np.arange(ny) + 0.5)
    E, N = np.meshgrid(ge, gn)
    lon, lat = TO_LL.transform(E, N)
    x, y = to_utm.transform(lon, lat)
    col, row = ~tf * (x, y)
    col -= 0.5
    row -= 0.5
    i0 = np.clip(np.floor(col).astype(int), 0, img.shape[2] - 2)
    j0 = np.clip(np.floor(row).astype(int), 0, img.shape[1] - 2)
    fx = np.clip(col - i0, 0, 1)
    fy = np.clip(row - j0, 0, 1)
    out = (img[:, j0, i0] * (1 - fx) * (1 - fy) + img[:, j0, i0 + 1] * fx * (1 - fy)
           + img[:, j0 + 1, i0] * (1 - fx) * fy + img[:, j0 + 1, i0 + 1] * fx * fy)
    rgb = np.clip(255 * (np.clip(out / 255.0, 0, 1) ** PARAMS["gamma"]) * PARAMS["gain"], 0, 255).astype(np.uint8)
    return np.flipud(np.moveaxis(rgb, 0, -1)), dict(nx=nx, ny=ny, cell=CELL)  # image rows north-to-south
