"""Rewrite live/index.json (schema squib-live-index/1) from the files present in the live directory, so the
app requests only files that exist. Bundled replay entries already in the index are kept.

Usage:
    python -I tools/ingest/index.py LIVE_DIR
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import iso_z, write_json_atomic  # noqa: E402

SCHEMA = "squib-live-index/1"
# Files the scheduled jobs write: path -> (kind, mode, label)
JOB_FILES = {
    "latest.json": ("weather", "live", "Met Office UKV forecast, updated every 30 minutes"),
    "tide.json": ("tide", "live", "Dartmouth tide: EA gauge and predictions, updated every 30 minutes"),
    "tide-predicted.json": ("tide", "replay", "Dartmouth tide predicted from harmonic constants derived from the EA gauge"),
}


def build_index(live_dir, now):
    path = os.path.join(live_dir, "index.json")
    old = []
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f).get("files", [])
    files = [e for e in old if e.get("path") not in JOB_FILES and os.path.exists(os.path.join(live_dir, e.get("path", "")))]
    for name, (kind, mode, label) in JOB_FILES.items():
        p = os.path.join(live_dir, name)
        if not os.path.exists(p):
            continue
        with open(p) as f:
            generated = json.load(f).get("generated")
        files.insert(0, {"path": name, "kind": kind, "mode": mode, "generated": generated, "label": label})
    return {"schema": SCHEMA, "generated": iso_z(now), "files": files}


def main():
    live_dir = sys.argv[1]
    idx = build_index(live_dir, dt.datetime.now(dt.timezone.utc))
    write_json_atomic(os.path.join(live_dir, "index.json"), idx)
    print(f"index.json: {', '.join(f['path'] for f in idx['files'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
