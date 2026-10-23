"""Lossless packing of the River Dart Int16 grids for download: i16-gradient-zigzag-planes-gzip/1.

Each plane of ny rows x nx values is replaced by its difference from the gradient prediction
left + up - up-left (missing neighbours are 0), wrapped to 16 bits and zigzag-coded; the codes are written
as a plane of low bytes then a plane of high bytes, and gzipped (mtime 0, so the output is reproducible).
The app unpacks it in src/sim/geo/pack.ts; the values are unchanged.

    python -I tools/geodata/pack.py public/geo     # pack elevation.bin and current.bin, update the manifest

build.py calls pack_grid() directly.
"""
import gzip
import json
import os
import sys

import numpy as np

PACKING = "i16-gradient-zigzag-planes-gzip/1"


def pack_grid(values, nx, ny):
    """values: Int16 array of whole ny x nx planes. Returns the gzipped packed bytes."""
    a = np.asarray(values, dtype=np.int16).reshape(-1, ny, nx).astype(np.int32)
    left = np.zeros_like(a)
    left[:, :, 1:] = a[:, :, :-1]
    up = np.zeros_like(a)
    up[:, 1:, :] = a[:, :-1, :]
    ul = np.zeros_like(a)
    ul[:, 1:, 1:] = a[:, :-1, :-1]
    r = ((a - (left + up - ul)) & 0xFFFF).astype(np.uint16).view(np.int16).astype(np.int32)
    z = ((r << 1) ^ (r >> 15)) & 0xFFFF
    flat = z.ravel()
    planes = np.concatenate([(flat & 0xFF).astype(np.uint8), (flat >> 8).astype(np.uint8)])
    return gzip.compress(planes.tobytes(), compresslevel=9, mtime=0)


def unpack_grid(data, nx, ny):
    """Inverse of pack_grid (for checking): returns the Int16 values."""
    raw = np.frombuffer(gzip.decompress(data), dtype=np.uint8)
    n = raw.size // 2
    z = raw[:n].astype(np.int32) | (raw[n:].astype(np.int32) << 8)
    r = (z >> 1) ^ -(z & 1)
    r = r.reshape(-1, ny, nx)
    v = np.zeros_like(r)
    for y in range(ny):
        for_row = r[:, y, :]
        up = v[:, y - 1, :] if y > 0 else np.zeros_like(for_row)
        # v[x] = r[x] + v[x-1] + up[x] - up[x-1]  =>  v = cumsum(r + up - up shifted) along x
        up_prev = np.zeros_like(up)
        up_prev[:, 1:] = up[:, :-1]
        row = np.cumsum(for_row + up - up_prev, axis=1)
        v[:, y, :] = ((row + 32768) & 0xFFFF) - 32768  # wrap to Int16, as the encoder did
    return v.ravel().astype(np.int16)


def pack_files(geo_dir):
    path = os.path.join(geo_dir, "manifest.json")
    with open(path) as f:
        m = json.load(f)
    for key, out_name in (("elevation", "elevation.i16z"), ("current", "current.i16z")):
        spec = m[key]
        if spec.get("packing"):
            print(f"{key}: already packed ({spec['file']})", file=sys.stderr)
            continue
        src = os.path.join(geo_dir, spec["file"])
        values = np.fromfile(src, dtype="<i2")
        packed = pack_grid(values, spec["nx"], spec["ny"])
        if not np.array_equal(unpack_grid(packed, spec["nx"], spec["ny"]), values):
            raise SystemExit(f"{key}: packing is not lossless")
        with open(os.path.join(geo_dir, out_name), "wb") as f:
            f.write(packed)
        os.remove(src)
        print(f"{key}: {values.nbytes} -> {len(packed)} bytes ({out_name})", file=sys.stderr)
        spec["file"] = out_name
        spec["packing"] = PACKING
    with open(path, "w") as f:
        json.dump(m, f, indent=1)


if __name__ == "__main__":
    pack_files(sys.argv[1] if len(sys.argv) > 1 else "public/geo")
