"""Tests for the live-data ingest (run: python -I -m unittest discover -s tools/ingest -p 'test_*.py').

The EA and UKHO responses below are SYNTHETIC fixtures written to the shapes in the providers' documentation
(the hosts are blocked in the development environment); they are not real readings or predictions.
"""
import datetime as dt
import json
import math
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harmonics  # noqa: E402
import index  # noqa: E402
import tide  # noqa: E402
import weather  # noqa: E402
from common import IngestError  # noqa: E402

UTC = dt.timezone.utc
EXAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "tide-snapshot.example.json")

EA_STATION = {
    "items": {
        "@id": "http://environment.data.gov.uk/flood-monitoring/id/stations/46154",
        "label": "Dartmouth",
        "measures": [
            {"@id": "http://environment.data.gov.uk/flood-monitoring/id/measures/46154-level-tidal_level-i-15_min-mAOD",
             "parameter": "level", "qualifier": "Tidal Level", "unitName": "mAOD", "period": 900},
        ],
    }
}
EA_READINGS = {
    "items": [
        {"dateTime": "2026-10-23T11:45:00Z", "value": 1.912},
        {"dateTime": "2026-10-23T11:30:00Z", "value": 1.874},
        {"dateTime": "2026-10-23T11:30:00Z", "value": 1.875},  # repeated timestamp: last wins
        {"dateTime": "2026-10-23T11:15:00Z", "value": "n/a"},   # bad value: skipped
        {"dateTime": "2026-10-23T11:00:00Z", "value": 1.801},
    ]
}
UKHO_STATIONS = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"Id": "0001", "Name": "Plymouth (Devonport)"}},
    {"type": "Feature", "properties": {"Id": "0099", "Name": "Dartmouth"}},
]}
UKHO_EVENTS = [
    {"EventType": "LowWater", "DateTime": "2026-10-23T06:01:00", "Height": 1.0},
    {"EventType": "HighWater", "DateTime": "2026-10-23T12:14:00", "Height": 4.5},
    {"EventType": "HighWater", "DateTime": "2026-10-23T12:40:00", "Height": 4.6},  # double HW: keep the higher
    {"EventType": "LowWater", "DateTime": "2026-10-23T18:26:00", "Height": 1.1},
]


class EaTests(unittest.TestCase):
    def test_measure_and_readings(self):
        m = tide.ea_tidal_measure(EA_STATION)
        self.assertTrue(m.endswith("46154-level-tidal_level-i-15_min-mAOD"))
        r = tide.ea_readings(EA_READINGS)
        self.assertEqual([v for _, v in r], [1.801, 1.875, 1.912])
        self.assertEqual(r[0][0].tzinfo, UTC)

    def test_implausible_level_is_refused(self):
        with self.assertRaises(IngestError):
            tide.ea_readings({"items": [{"dateTime": "2026-10-23T11:00:00Z", "value": 42.0}]})

    def test_no_tidal_measure(self):
        with self.assertRaises(IngestError):
            tide.ea_tidal_measure({"items": {"measures": [{"@id": "x-flow-m3_s", "qualifier": "Flow", "unitName": "m3/s"}]}})


class UkhoTests(unittest.TestCase):
    def test_station_and_events(self):
        self.assertEqual(tide.ukho_station_id(UKHO_STATIONS), "0099")
        ev = tide.ukho_events(UKHO_EVENTS)
        self.assertEqual([k for _, k, _ in ev], ["LW", "HW", "LW"])
        self.assertEqual(ev[1][2], 4.6)
        self.assertEqual(ev[0][0], dt.datetime(2026, 10, 23, 6, 1, tzinfo=UTC))


class SnapshotTests(unittest.TestCase):
    def test_snapshot_matches_the_app_format_example(self):
        events = tide.ukho_events(UKHO_EVENTS)
        readings = tide.ea_readings(EA_READINGS)
        snap = tide.build_snapshot(events, "UKHO ADMIRALTY UK Tidal API, station 0099 Dartmouth (official prediction)", readings,
                                   tide.ea_tidal_measure(EA_STATION), dt.datetime(2026, 10, 23, 12, 0, tzinfo=UTC))
        with open(EXAMPLE) as f:
            example = json.load(f)
        example.pop("_note")
        self.assertEqual(snap, example)  # the TypeScript test parses this same file (tests/sim/live.test.ts)

    def test_history_append_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            r = tide.ea_readings(EA_READINGS)
            self.assertEqual(tide.append_history(d, r), 3)
            self.assertEqual(tide.append_history(d, r), 0)
            self.assertEqual(tide.read_history(d), r)


class HarmonicsTests(unittest.TestCase):
    """A synthetic gauge record (known constituents plus 2 cm noise): the pipeline must predict held-back days."""

    @classmethod
    def setUpClass(cls):
        t0 = dt.datetime(2026, 8, 1, tzinfo=UTC)
        n = 96 * 45
        cls.times = [t0 + dt.timedelta(minutes=15 * k) for k in range(n)]
        hrs = np.arange(n) / 4.0
        w = lambda period_h: 2 * math.pi / period_h  # noqa: E731
        rng = np.random.default_rng(3)
        cls.truth = staticmethod(lambda h: (0.1 + 1.6 * np.cos(w(12.4206012) * h - 1.0) + 0.55 * np.cos(w(12.0) * h - 2.0)  # noqa: E731
                               + 0.3 * np.cos(w(12.65834751) * h) + 0.12 * np.cos(w(6.210300601) * h - 0.5)
                               + 0.07 * np.cos(w(23.93447213) * h) + 0.06 * np.cos(w(25.81933871) * h - 1.2)))
        cls.heights = cls.truth(hrs) + rng.normal(0, 0.02, n)
        rows = list(zip(cls.times, cls.heights.tolist()))
        cls.constants, cls.predicted = harmonics.derive(rows, t0 + dt.timedelta(days=45), days=10)

    def test_held_back_days_are_predicted_to_the_noise_level(self):
        v = self.constants["validation"]
        self.assertLess(v["rms_m"], 0.03)
        self.assertLess(v["max_abs_m"], 0.12)
        names = [c["name"] for c in self.constants["constituents"][:3]]
        self.assertEqual(names, ["M2", "S2", "N2"])

    def test_events_alternate_and_match_the_true_curve(self):
        ev = self.predicted["predictions"]["events"]
        self.assertGreater(len(ev), 30)
        self.assertTrue(all(a["type"] != b["type"] for a, b in zip(ev, ev[1:])))
        t0 = self.times[0]
        for e in ev[:20]:
            t = dt.datetime.fromisoformat(e["time"].replace("Z", "+00:00"))
            h = (t - t0).total_seconds() / 3600
            # Event heights are on chart datum; the true curve at the event time is an extremum (slope ~ 0).
            self.assertAlmostEqual(e["heightCD"] - tide.CD_OFFSET_M, float(self.truth(np.array([h]))[0]), delta=0.06)
            slope = float((self.truth(np.array([h + 0.05])) - self.truth(np.array([h - 0.05])))[0] / 0.1)
            self.assertLess(abs(slope), 0.3)  # m/h; the mid-tide rate is about 1.3 m/h

    def test_too_short_a_record_is_refused(self):
        with self.assertRaises(ValueError):
            harmonics.derive(list(zip(self.times[:96 * 20], self.heights[:96 * 20].tolist())), self.times[-1], days=5)


class WeatherAndIndexTests(unittest.TestCase):
    def test_weather_validation_refuses_bad_values(self):
        grid = [[1.0, 2.0], [3.0, 4.0]]
        good = {"model": {"available": True, "grid": {"lat": grid}, "steps": [
            {"valid": "2026-10-23T14:00Z", "speed_kn": grid, "gust_kn": grid, "wind_from_deg": grid}], "sky": []}}
        weather.validate(good)
        bad = json.loads(json.dumps(good))
        bad["model"]["steps"][0]["speed_kn"] = [[1.0, 2.0], [3.0, 400.0]]
        with self.assertRaises(IngestError):
            weather.validate(bad)

    def test_index_lists_only_present_files(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "index.json"), "w") as f:
                json.dump({"schema": index.SCHEMA, "files": [
                    {"path": "replay.json", "kind": "weather", "mode": "replay"},
                    {"path": "gone.json", "kind": "weather", "mode": "replay"}]}, f)
            for name in ("replay.json", "latest.json"):
                with open(os.path.join(d, name), "w") as f:
                    json.dump({"generated": "2026-10-23T14:05:00Z"}, f)
            idx = index.build_index(d, dt.datetime(2026, 10, 23, 14, 6, tzinfo=UTC))
            self.assertEqual([e["path"] for e in idx["files"]], ["latest.json", "replay.json"])
            self.assertEqual(idx["files"][0]["mode"], "live")


if __name__ == "__main__":
    unittest.main()
