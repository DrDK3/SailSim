"""Shared helpers for the scheduled live-data ingest (Phase 6): HTTP with retries, S3 listing, atomic JSON output.

Network failures are expected (a host down, a model run late). Callers catch IngestError and keep the
previously published file, so the app falls back on its own staleness rules (docs/DEPLOYMENT.md).
"""
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "squib-dart-sim-ingest/1 (+https://github.com; static site data job)"


class IngestError(RuntimeError):
    """The data could not be fetched or failed validation; nothing should be published."""


def http_get(url, timeout=60, headers=None, attempts=3, method="GET"):
    """GET (or HEAD) with retries and exponential backoff on network errors and 5xx/429 responses."""
    last = None
    for i in range(attempts):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(2 ** i)
    raise IngestError(f"GET {url} failed after {attempts} attempts: {last}")


def exists(url, timeout=30):
    """True when a HEAD request succeeds (404/403 mean absent)."""
    try:
        http_get(url, timeout=timeout, method="HEAD", attempts=2)
        return True
    except urllib.error.HTTPError:
        return False


def s3_list(bucket, prefix, delimiter=None):
    """List S3 keys (or common prefixes when delimiter is given) of a public bucket, following pagination."""
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


def write_json_atomic(path, data):
    """Write JSON next to the target and rename, so a reader never sees a half-written file."""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, separators=(",", ":"))
            f.write("\n")
        os.chmod(tmp, 0o644)  # published as a static file
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def iso_z(t):
    """UTC datetime as 2026-10-22T07:15:00Z."""
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")
