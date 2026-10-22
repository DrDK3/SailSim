"""PROVISIONAL channel-following tidal stream pattern (shape only; magnitude is set at run time).

Tidal-prism continuity on the wet cells at mid-tide: when the tide falls at a uniform rate, every wet cell of
the harbour sheds its share of water, and water from upriver (beyond the domain) drains through the northern
boundary. Depth-averaged flow is taken as potential flow, so the flux through each cell face is
T·Δφ with T the face depth:  Σ_j T_ij (φ_i − φ_j) = s_i,  φ = 0 on the seaward edges of the domain.
The ebb velocity is −∇φ. The result is normalised so that the mean speed across the entrance (castle to
castle) is 1; the app multiplies it by the entrance stream from the tide timing (docs/PHYSICS.md §14).

A second field carries only river outflow (inflow at the northern boundary, no harbour sources).
Assumptions (all E): mid-tide water level +0.1 m ODN; cells shallower than 0.3 m are dry; the upstream prism
(Dittisham to Totnes, beyond the domain) is 2.5 km² of water surface; flood is the reverse of ebb.
"""
import numpy as np
from scipy import ndimage
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from bathymetry import entrance
from common import CELL, GRID_E, GRID_N, N_MAX

FACTOR = 2  # current grid = 2 x 2 elevation cells
MID_TIDE_ODN = 0.1
DRY_DEPTH = 0.3
UPSTREAM_PRISM_M2 = 2.5e6
PARAMS = dict(grid_factor=FACTOR, mid_tide_level_odn=MID_TIDE_ODN, dry_depth_m=DRY_DEPTH, upstream_prism_m2=UPSTREAM_PRISM_M2)


def coarsen(a, f):
    ny, nx = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:ny, :nx].reshape(ny // f, f, nx // f, f).mean(axis=(1, 3))


def solve(h, wet, source, dirichlet):
    ny, nx = h.shape
    idx = -np.ones(h.shape, dtype=np.int64)
    unknown = wet & ~dirichlet
    idx[unknown] = np.arange(unknown.sum())
    rows, cols, vals = [], [], []
    diag = np.zeros(unknown.sum())
    for dy, dx in ((0, 1), (1, 0)):
        a = (slice(0, ny - dy), slice(0, nx - dx))
        b = (slice(dy, ny), slice(dx, nx))
        both = wet[a] & wet[b]
        t = np.where(both, 2 * h[a] * h[b] / np.maximum(h[a] + h[b], 1e-9), 0.0)
        ia, ib = idx[a], idx[b]
        for i_self, i_other in ((ia, ib), (ib, ia)):
            m = both & (i_self >= 0)
            np.add.at(diag, i_self[m], t[m])
            m2 = m & (i_other >= 0)
            rows.append(i_self[m2]); cols.append(i_other[m2]); vals.append(-t[m2])
    A = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(len(diag), len(diag)))
    A = A + sp.diags(diag)
    phi_u = spla.spsolve(A.tocsc(), source[unknown])
    phi = np.zeros(h.shape)
    phi[unknown] = phi_u
    return phi


def velocity(phi, wet, cell):
    gn, ge = np.gradient(np.where(wet, phi, np.nan), cell)
    # One-sided at the shore: np.gradient returns NaN next to dry cells; fall back to zero there.
    ve, vn = -np.nan_to_num(ge), -np.nan_to_num(gn)
    return np.where(wet, ve, 0.0), np.where(wet, vn, 0.0)


def entrance_mean_speed(ve, vn, ge, gn):
    a, b = entrance()
    pts = [a + (b - a) * f for f in np.linspace(0.02, 0.98, 60)]
    sp_ = []
    for e, n in pts:
        j = int(np.argmin(abs(gn - n)))
        i = int(np.argmin(abs(ge - e)))
        s = np.hypot(ve[j, i], vn[j, i])
        if s > 0:
            sp_.append(s)
    return float(np.mean(sp_))


def build(elev, water):
    f = FACTOR
    cell = CELL * f
    z = coarsen(elev, f)
    in_water = coarsen(water.astype(float), f) > 0.5
    ge = coarsen(GRID_E[None, :].repeat(len(GRID_N), 0), f)[0]
    gn = coarsen(GRID_N[:, None].repeat(len(GRID_E), 1), f)[:, 0]
    h = np.maximum(MID_TIDE_ODN - z, 0.0)
    wet = (h > DRY_DEPTH) & in_water
    a, b = entrance()
    E, N = np.meshgrid(ge, gn)
    mid = (a + b) / 2
    harbour = wet & (N > mid[1] - 30)  # north of (roughly) the entrance
    # Seaward boundary: wet cells on the domain edge south of the entrance.
    edge = np.zeros_like(wet)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True
    sea_edge = wet & edge & (N < mid[1] - 300)
    # Keep only water connected to the sea boundary (isolated pockets have no defined flow).
    lab, _ = ndimage.label(wet)
    wet &= np.isin(lab, np.unique(lab[sea_edge]))
    north = wet & (N > N_MAX - 1.5 * cell)
    area = cell * cell
    fields = {}
    for name, src in (
        ("tidal", np.where(harbour, area, 0.0) + np.where(north, UPSTREAM_PRISM_M2 / max(north.sum(), 1), 0.0)),
        ("river", np.where(north, 1.0 / max(north.sum(), 1), 0.0)),
    ):
        phi = solve(h, wet, src, sea_edge)
        ve, vn = velocity(phi, wet, cell)
        k = entrance_mean_speed(ve, vn, ge, gn)
        fields[name] = (ve / k, vn / k)
    meta = dict(cell=cell, nx=len(ge), ny=len(gn), e0=float(ge[0] - cell / 2), n0=float(gn[0] - cell / 2))
    return fields, wet, meta
