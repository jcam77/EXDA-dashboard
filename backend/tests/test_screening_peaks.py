"""Screening peak table: max and time of max per selected channel inside a required
time range, from every sample. Temporary folders only.
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import project_manager, screening_peaks  # noqa: E402


class PeakFunctionTests(unittest.TestCase):
    def test_range_is_required_and_ordered(self):
        for start, end in ((None, 1), (0, None), ("", ""), ("a", 1), (float("nan"), 1)):
            with self.assertRaises(screening_peaks.PeakRangeError):
                screening_peaks.parse_range(start, end)
        with self.assertRaises(screening_peaks.PeakRangeError):
            screening_peaks.parse_range(0.5, 0.5)
        self.assertEqual(screening_peaks.parse_range("0.1", 0.2), (0.1, 0.2))

    def test_peak_inside_range_ignores_late_noise(self):
        t = np.arange(0, 2.0, 1e-5)
        y = np.zeros_like(t)
        y[np.searchsorted(t, 0.0503)] = 0.21     # the event
        y[np.searchsorted(t, 1.8)] = 0.95        # late-time spike, outside the range
        peak = screening_peaks.peak_in_range(t, y, 0.0, 0.5)
        self.assertEqual(peak["max"], 0.21)
        self.assertAlmostEqual(peak["tMax"], 0.0503, places=6)
        self.assertEqual(peak["samples"], 50_001)
        whole = screening_peaks.peak_in_range(t, y, 0.0, 2.0)
        self.assertEqual(whole["max"], 0.95, "whole record would pick the late spike")

    def test_range_without_samples_gives_no_value(self):
        t = np.arange(0, 1.0, 0.01)
        self.assertEqual(screening_peaks.peak_in_range(t, np.ones_like(t), 5.0, 6.0),
                         {"max": None, "tMax": None, "samples": 0})

    def test_gaps_are_skipped(self):
        t = np.arange(10.0)
        y = np.array([0, 1, np.nan, 3, 2, np.nan, 0, 0, 0, 0], dtype=float)
        peak = screening_peaks.peak_in_range(t, y, 0, 9)
        self.assertEqual((peak["max"], peak["tMax"], peak["samples"]), (3.0, 3.0, 8))


class ChannelPeaksRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_peaks_test_"))
        (self.root / "Plan").mkdir()
        project_manager.write_project_marker(str(self.root))
        run = self.root / "Raw_Data" / "Run-01"
        run.mkdir(parents=True)
        t = np.arange(0, 1.0, 1e-4)
        p1 = np.zeros_like(t)
        p1[np.searchsorted(t, 0.0421)] = 0.35
        p1[np.searchsorted(t, 0.9)] = 2.0      # late spike
        p2 = np.zeros_like(t)
        p2[np.searchsorted(t, 0.0455)] = 0.18
        trigger = np.where(t > 0.04, 5.0, 0.0)
        lines = ["time,P1 [bar],P2 [bar],Trigger [V]"] + [
            f"{a:.6g},{b:.6g},{c:.6g},{d:.6g}" for a, b, c, d in zip(t, p1, p2, trigger)
        ]
        self.file = run / "run.csv"
        self.file.write_text("\n".join(lines), encoding="utf-8")
        self.before = self.file.read_bytes()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def post(self, **body):
        base = {"projectPath": str(self.root), "path": "Raw_Data/Run-01/run.csv"}
        return self.client.post("/channel_peaks", json={**base, **body})

    def test_selected_channels_in_range(self):
        data = self.post(windowStart=0.0, windowEnd=0.1, channelIndices=[0, 1]).get_json()
        self.assertTrue(data["success"], data)
        rows = {row["name"]: row for row in data["channels"]}
        self.assertEqual(set(rows), {"P1 [bar]", "P2 [bar]"}, "trigger not requested, not calculated")
        self.assertEqual(rows["P1 [bar]"]["max"], 0.35)
        self.assertAlmostEqual(rows["P1 [bar]"]["tMax"], 0.0421, places=6)
        self.assertEqual(rows["P1 [bar]"]["fileUnit"], "bar")
        self.assertEqual(rows["P2 [bar]"]["max"], 0.18)
        self.assertTrue(data["fullResolution"])
        self.assertEqual(self.file.read_bytes(), self.before, "the data file is only read")

    def test_range_and_selection_are_required(self):
        self.assertEqual(self.post(channelIndices=[0]).status_code, 400)
        self.assertEqual(self.post(windowStart=0.2, windowEnd=0.1, channelIndices=[0]).status_code, 400)
        self.assertEqual(self.post(windowStart=0.0, windowEnd=0.1, channelIndices=[]).status_code, 400)
        self.assertEqual(self.post(windowStart=0.0, windowEnd=0.1, channelIndices=[9]).status_code, 400)

    def test_files_outside_the_project_are_refused(self):
        outside = self.client.post("/channel_peaks", json={
            "projectPath": str(self.root), "path": "/etc/hosts",
            "windowStart": 0, "windowEnd": 1, "channelIndices": [0]})
        self.assertEqual(outside.status_code, 403)


if __name__ == "__main__":
    unittest.main()
