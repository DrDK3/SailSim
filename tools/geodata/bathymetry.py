"""Bed and terrain elevation on one grid (metres above Ordnance Datum Newlyn).

- Land (outside the tidal water mask): the DEM (EA LIDAR 2 m via Tilezen where available).
- Intertidal (inside the mask, DEM above the flattened LIDAR water surface, within 200 m of the shore, below
  +2.5 m ODN): the DEM. These are real LIDAR heights of mud, sand and rock exposed when the survey was flown.
- Subtidal (everything else inside the mask): PROVISIONAL. No legally usable survey is available (issue 4),
  so depth below chart datum follows a documented estimate: D = Dcap·(1 − exp(−d/L)), where d is the distance
  from the low-water edge. Dcap is 9 m inside the harbour and grows by 6 m per km seaward of the entrance
  (castle to castle), up to 25 m. ETOPO1 values in the tiles offshore (18–29 m) are only a plausibility check.
"""
import numpy as np
from scipy import ndimage

from common import CD_BELOW_ODN, CELL, GRID_E, GRID_N, TO_LOCAL

FLAT_LO, FLAT_HI = -2.6, -1.9  # LIDAR water-surface returns (the "flattened" water level at survey time)
INTERTIDAL_MAX_ODN = 2.5
INTERTIDAL_MAX_SHORE_DIST = 200.0
DCAP_HARBOUR = 9.0
L_EDGE = 35.0
DCAP_SLOPE_PER_M = 0.006
DCAP_MAX = 25.0
# Entrance line: Dartmouth Castle and Kingswear Castle (OSM building centroids via Overture).
DARTMOUTH_CASTLE = (50.34180, -3.56572)
KINGSWEAR_CASTLE = (50.34202, -3.55986)

PARAMS = dict(
    flattened_water_band_odn=[FLAT_LO, FLAT_HI], intertidal_max_odn=INTERTIDAL_MAX_ODN,
    intertidal_max_shore_distance_m=INTERTIDAL_MAX_SHORE_DIST, depth_cap_harbour_m=DCAP_HARBOUR,
    edge_length_scale_m=L_EDGE, depth_cap_slope_seaward_per_m=DCAP_SLOPE_PER_M, depth_cap_max_m=DCAP_MAX,
    chart_datum_below_odn_m=CD_BELOW_ODN,
)


def entrance():
    a = TO_LOCAL.transform(DARTMOUTH_CASTLE[1], DARTMOUTH_CASTLE[0])
    b = TO_LOCAL.transform(KINGSWEAR_CASTLE[1], KINGSWEAR_CASTLE[0])
    return np.array(a), np.array(b)  # (e, n)


def build(dem, water):
    """Returns (elevation ODN, class grid: 0 land, 1 intertidal LIDAR, 2 subtidal provisional)."""
    shore_dist = ndimage.distance_transform_edt(water) * CELL  # distance from land, inside the water
    intertidal = water & (dem > FLAT_HI) & (dem < INTERTIDAL_MAX_ODN) & (shore_dist <= INTERTIDAL_MAX_SHORE_DIST)
    subtidal = water & ~intertidal
    d = ndimage.distance_transform_edt(subtidal) * CELL  # from the low-water edge
    # Seaward distance beyond the entrance line (0 inside the harbour).
    a, b = entrance()
    mid = (a + b) / 2
    t = (b - a) / np.linalg.norm(b - a)
    seaward = np.array([t[1], -t[0]])  # normal to the line
    if seaward[1] > 0:
        seaward = -seaward  # the sea is to the south
    E, N = np.meshgrid(GRID_E, GRID_N)
    s = (E - mid[0]) * seaward[0] + (N - mid[1]) * seaward[1]
    beyond = np.where(s > 0, np.hypot(E - mid[0], N - mid[1]), 0.0)
    dcap = np.minimum(DCAP_HARBOUR + DCAP_SLOPE_PER_M * beyond, DCAP_MAX)
    depth_cd = dcap * (1 - np.exp(-d / L_EDGE))
    elev = np.where(subtidal, -CD_BELOW_ODN - depth_cd, dem)
    elev = np.where(intertidal, np.minimum(dem, INTERTIDAL_MAX_ODN), elev)
    cls = np.where(subtidal, 2, np.where(intertidal, 1, 0)).astype(np.uint8)
    return elev, cls
