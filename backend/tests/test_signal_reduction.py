"""Peak-preserving preview: a short peak or clipping must never disappear from the plot.

Synthetic signals and temporary files only.
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
from modules import signal_reduction, tpc5_parser  # noqa: E402

FS = 1_000_000.0  # 1 MHz, like DAQ-1


def spiky_signal(n=200_000, spike_at=123_457, spike=7.5):
    """Flat noise-free baseline with one single-sample spike (index picking misses it)."""
    t = np.arange(n) / FS
    y = np.zeros(n)
    y[spike_at] = spike
    return t, y


class EnvelopeTests(unittest.TestCase):
    def test_single_sample_peak_is_kept(self):
        _t, y = spiky_signal()
        picked = y[np.linspace(0, y.size - 1, 2000, dtype=np.int64)]
        self.assertEqual(picked.max(), 0.0, "uniform picking misses the spike (the old behaviour)")
        kept = y[signal_reduction.envelope_row_indices(y, 2000)]
        self.assertEqual(kept.max(), 7.5)

    def test_clipped_plateau_and_minimum_are_kept(self):
        y = np.sin(np.linspace(0, 20 * np.pi, 100_000)) * 12.0
        y = np.clip(y, -3.0, 10.0)  # clipped at both ends
        kept = y[signal_reduction.envelope_row_indices(y, 1000)]
        self.assertEqual(kept.max(), 10.0)
        self.assertEqual(kept.min(), -3.0)

    def test_each_channel_keeps_its_own_extremes(self):
        n = 50_000
        y = np.zeros((n, 3))
        y[1_234, 0] = 5.0
        y[40_001, 1] = -4.0
        y[7, 2] = 9.0
        idx = signal_reduction.envelope_row_indices(y, 500)
        reduced = y[idx]
        self.assertEqual(reduced[:, 0].max(), 5.0)
        self.assertEqual(reduced[:, 1].min(), -4.0)
        self.assertEqual(reduced[:, 2].max(), 9.0)

    def test_row_count_is_bounded_and_ends_are_kept(self):
        rng = np.random.default_rng(1)
        for channels in (1, 2, 4, 8):
            y = rng.normal(size=(300_000, channels))
            idx = signal_reduction.envelope_row_indices(y, 2000)
            self.assertLessEqual(idx.size, 2 * 2000 + 2, channels)
            self.assertEqual(idx[0], 0)
            self.assertEqual(idx[-1], 299_999)
            self.assertTrue(np.all(np.diff(idx) > 0), "sorted, no duplicates")

    def test_short_signal_and_no_limit_keep_everything(self):
        y = np.arange(10.0)
        self.assertEqual(signal_reduction.envelope_row_indices(y, 2000).tolist(), list(range(10)))
        self.assertEqual(signal_reduction.envelope_row_indices(np.zeros(5000), 0).size, 5000)

    def test_gaps_do_not_break_the_reduction(self):
        y = np.zeros(10_000)
        y[100:200] = np.nan
        y[5_000] = 3.0
        kept = y[signal_reduction.envelope_row_indices(y, 200)]
        self.assertEqual(np.nanmax(kept), 3.0)


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()

    def content(self, n=20_000):
        t, y = spiky_signal(n=n, spike_at=12_345)
        lines = ["time,P1 [bar]"] + [f"{ti:.9g},{yi:.6g}" for ti, yi in zip(t, y)]
        return "\n".join(lines)

    def test_preview_keeps_the_peak_and_reports_real_numbers(self):
        data = self.client.post("/preview_multichannel", json={"content": self.content(), "maxPoints": 500}).get_json()
        peak = max(row["ch_0"] for row in data["plotData"])
        self.assertEqual(peak, 7.5)
        summary = data["summary"]
        self.assertEqual(summary["totalSamples"], 20_000)
        self.assertAlmostEqual(summary["samplingRateHz"], FS, delta=1.0)
        self.assertEqual(summary["reduction"], signal_reduction.ENVELOPE_METHOD)
        self.assertTrue(summary["downsampleApplied"])

    def test_reader_reported_rate_and_count_win(self):
        source = {"totalSamples": 2_000_000, "samplingRateHz": 1_000_000.0, "reduction": signal_reduction.ENVELOPE_METHOD}
        content = "time,P1 [bar]\n" + "\n".join(f"{i * 0.001:.6g},{i % 7}" for i in range(400))
        data = self.client.post("/preview_multichannel",
                                json={"content": content, "maxPoints": 2000, "sourceInfo": source}).get_json()
        summary = data["summary"]
        self.assertEqual(summary["totalSamples"], 2_000_000)
        self.assertEqual(summary["samplingRateHz"], 1_000_000.0)
        self.assertEqual(summary["reduction"], signal_reduction.ENVELOPE_METHOD)
        self.assertTrue(summary["downsampleApplied"])


class TextWindowTests(unittest.TestCase):
    """CSV/TXT files with a time window get the same peak-preserving reduction."""

    def test_windowed_text_keeps_the_peak(self):
        from routes import state as state_routes

        t, y = spiky_signal(n=50_000, spike_at=31_234)
        content = "\n".join(["time,H2 [vol%]"] + [f"{ti:.9g},{yi:.6g}" for ti, yi in zip(t, y)])
        info = {}
        windowed, err = state_routes._apply_time_window_to_text_content(content, time_start=0.01, time_end=0.045,
                                                                         max_samples=300, info=info)
        self.assertIsNone(err)
        values = [float(line.split(",")[1]) for line in windowed.splitlines()[1:]]
        self.assertEqual(max(values), 7.5)
        self.assertEqual(info["totalSamples"], 35_001)
        self.assertAlmostEqual(info["samplingRateHz"], FS, delta=1.0)
        self.assertEqual(info["reduction"], signal_reduction.ENVELOPE_METHOD)


@unittest.skipIf(tpc5_parser.h5py is None, "h5py not installed")
class Tpc5ReaderTests(unittest.TestCase):
    """A synthetic TraNET file: 1 MHz, one single-sample spike."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="exda_tpc5_test_"))
        self.path = self.dir / "run.tpc5"
        h5py = tpc5_parser.h5py
        raw = np.zeros(1_000_000, dtype=np.int16)
        raw[654_321] = 30_000
        with h5py.File(self.path, "w") as handle:
            channel = handle.create_group("measurements/00000001/channels/00000001")
            channel.attrs["name"] = "P1"
            channel.attrs["physicalUnit"] = "bar"
            channel.attrs["binToVoltFactor"] = 0.001
            channel.attrs["binToVoltConstant"] = 0.0
            channel.attrs["voltToPhysicalFactor"] = 0.25
            channel.attrs["voltToPhysicalConstant"] = 0.0
            block = channel.create_group("blocks/00000001")
            block.attrs["sampleRateHertz"] = FS
            block.attrs["triggerSample"] = 0
            block.attrs["triggerTimeSeconds"] = 0.0
            block.create_dataset("raw", data=raw)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_reader_keeps_the_spike_and_reports_the_real_rate(self):
        info = {}
        content, err = tpc5_parser.tpc5_to_content(str(self.path), max_samples=2000, info=info)
        self.assertIsNone(err)
        values = [float(line.split(",")[1]) for line in content.splitlines()[1:]]
        self.assertAlmostEqual(max(values), 30_000 * 0.001 * 0.25)  # 7.5 bar
        self.assertEqual(info["totalSamples"], 1_000_000)
        self.assertEqual(info["samplingRateHz"], FS)
        self.assertEqual(info["reduction"], signal_reduction.ENVELOPE_METHOD)
        self.assertLessEqual(info["returnedRows"], 4002)

    def test_full_resolution_returns_every_sample(self):
        info = {}
        content, err = tpc5_parser.tpc5_to_content(str(self.path), max_samples=0, info=info)
        self.assertIsNone(err)
        self.assertEqual(info["returnedRows"], 1_000_000)
        self.assertEqual(info["reduction"], "none")
        self.assertEqual(len(content.splitlines()) - 1, 1_000_000)


if __name__ == "__main__":
    unittest.main()
