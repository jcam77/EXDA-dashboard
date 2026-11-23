"""EXDA-Check B1-B5, B8 backend: full-resolution, explicit, recorded pressure processing.

Synthetic signals and a temporary project folder are used for everything that
writes. The week-27 test only reads one raw file and checks it is unchanged.
"""

import hashlib
import json
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
from modules import data_parser, daq_reader  # noqa: E402
from modules import pressure_analysis as pa  # noqa: E402

WK27_DAQ1 = (
    REPO_ROOT / "Projects" / "VH2D-Project-Wk-27-2026" / "Raw_Data" / "VH2D-Wk27-G01-08" / "DAQ-1"
    / "VH2D-Wk27-G01-08-DAQ-1.tpc5"
)


def pulse(fs=100_000.0, duration=0.02, peak=0.12, t_peak=0.01, offset=0.0):
    t = np.arange(int(duration * fs)) / fs - 0.005
    y = peak * np.exp(-((t - t_peak) / 0.001) ** 2) + offset
    return t, y


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ProcessingChainTests(unittest.TestCase):
    def test_full_resolution_peak_and_envelope_keeps_it(self):
        t, y = pulse()
        y[1234] = 0.5  # one-sample spike: index-picking decimation could miss it
        result = pa.analyze_pressure_signal(t, y, file_unit="bar", use_raw=True)
        self.assertAlmostEqual(float(result["metrics"]["pMax"]), 50.0, places=3)
        self.assertEqual(result["processing"]["samplesAnalysed"], t.size)
        self.assertEqual(result["processing"]["decimation"], "none (all samples used for metrics)")
        plot_max = max(point["p"] for point in result["plot_data"])
        self.assertAlmostEqual(plot_max, 50.0, places=6)

    def test_bar_converted_and_recorded(self):
        t, y = pulse(peak=0.1)
        result = pa.analyze_pressure_signal(t, y, file_unit="bar", use_raw=True)
        self.assertEqual(result["metrics"]["pressureUnit"], "kPa")
        self.assertAlmostEqual(float(result["metrics"]["pMax"]), 10.0, places=3)
        unit = result["processing"]["unit"]
        self.assertEqual((unit["input"], unit["origin"], unit["output"]), ("bar", "file header", "kPa"))
        self.assertEqual(result["processing"]["reference"]["reference"], "gauge")

    def test_voltage_channel_is_never_reported_as_kpa(self):
        t, y = pulse(peak=5.0)
        for selected in ("auto", "V"):
            result = pa.analyze_pressure_signal(t, y, file_unit="V", input_unit=selected, use_raw=True)
            self.assertEqual(result["metrics"]["pressureUnit"], "V")
            self.assertAlmostEqual(float(result["metrics"]["pMax"]), 5.0, places=3)
        with self.assertRaises(pa.PressureAnalysisError):
            pa.analyze_pressure_signal(t, y, file_unit="V", input_unit="bar", use_raw=True)

    def test_no_magnitude_guessing(self):
        t, y = pulse(peak=12000.0)  # gauge Pa, e.g. a CFD overpressure export
        unknown = pa.analyze_pressure_signal(t, y, use_raw=True)
        self.assertEqual(unknown["metrics"]["pressureUnit"], "raw")
        self.assertAlmostEqual(float(unknown["metrics"]["pMax"]), 12000.0, places=1)
        pa_gauge = pa.analyze_pressure_signal(t, y, input_unit="Pa", use_raw=True)
        self.assertAlmostEqual(float(pa_gauge["metrics"]["pMax"]), 12.0, places=3)  # not ~ -89 kPa

    def test_absolute_uses_measured_p0_and_never_101325(self):
        t, y = pulse(peak=10000.0, offset=100900.0)
        result = pa.analyze_pressure_signal(
            t, y, file_unit="Pa", reference="absolute", p0_pa=100900, p0_source="plan", use_raw=True)
        self.assertAlmostEqual(float(result["metrics"]["pMax"]), 10.0, places=3)
        self.assertEqual(result["processing"]["reference"]["p0Pa"], 100900.0)
        for missing in (None, "", "abc", 0):
            with self.subTest(p0=missing), self.assertRaises(pa.PressureAnalysisError):
                pa.analyze_pressure_signal(t, y, file_unit="Pa", reference="absolute", p0_pa=missing, use_raw=True)

    def test_baseline_is_opt_in_and_recorded(self):
        t, y = pulse(peak=0.1, offset=0.02)  # 2 kPa charge-amp offset
        off = pa.analyze_pressure_signal(t, y, file_unit="bar", use_raw=True)
        self.assertFalse(off["processing"]["baseline"]["applied"])
        self.assertAlmostEqual(float(off["metrics"]["pMax"]), 12.0, places=3)
        on = pa.analyze_pressure_signal(
            t, y, file_unit="bar", use_raw=True,
            baseline={"enabled": True, "method": "median", "start": -0.005, "end": -0.001})
        info = on["processing"]["baseline"]
        self.assertTrue(info["applied"])
        self.assertAlmostEqual(info["offset"], 2.0, places=3)
        self.assertGreater(info["samples"], 0)
        self.assertAlmostEqual(float(on["metrics"]["pMax"]), 10.0, places=3)
        with self.assertRaises(pa.PressureAnalysisError):
            pa.analyze_pressure_signal(t, y, file_unit="bar", use_raw=True,
                                       baseline={"enabled": True, "start": 1, "end": 2})

    def test_filter_errors_instead_of_silent_fallback(self):
        t, y = pulse(fs=10_000.0)
        with self.assertRaisesRegex(pa.PressureAnalysisError, "Nyquist"):
            pa.analyze_pressure_signal(t, y, file_unit="bar", cutoff=6000, order=4)
        for bad in (None, "", "abc", -5, 0):
            with self.subTest(cutoff=bad), self.assertRaises(pa.PressureAnalysisError):
                pa.analyze_pressure_signal(t, y, file_unit="bar", cutoff=bad, order=4)
        for bad in (0, 2.5, "x"):
            with self.subTest(order=bad), self.assertRaises(pa.PressureAnalysisError):
                pa.analyze_pressure_signal(t, y, file_unit="bar", cutoff=500, order=bad)

    def test_filter_and_resampling_recorded(self):
        t, y = pulse()
        uniform = pa.analyze_pressure_signal(t, y, file_unit="bar", cutoff=2000, order=4)
        filt = uniform["processing"]["filter"]
        self.assertTrue(filt["applied"])
        self.assertFalse(filt["resampled"])
        self.assertEqual((filt["order"], filt["cutoffHz"]), (4, 2000.0))
        self.assertAlmostEqual(filt["fsHz"], 100_000.0, places=3)

        picks = np.round(np.linspace(0, t.size - 1, t.size // 3 + 7)).astype(int)  # stride 3/4 mix
        stride = pa.analyze_pressure_signal(t[picks], y[picks], file_unit="bar", cutoff=2000, order=4)
        self.assertTrue(stride["processing"]["filter"]["resampled"])
        self.assertFalse(stride["processing"]["uniformTimeAxis"])

    def test_header_units_drive_auto(self):
        self.assertEqual(pa.unit_from_channel_label("A1 (0.A1) [bar]"), "bar")
        self.assertEqual(pa.unit_from_channel_label("A5 (0.A5) [V]"), "v")
        self.assertEqual(pa.unit_from_channel_label("p (Pa)"), "pa")
        self.assertEqual(pa.unit_from_channel_label("DAQ-2-Channel1"), "")
        content = "time,P1 [Pa],Trig [V]\n0,0,0\n1,5000,4.9\n2,1000,0\n"
        values, note, unit = data_parser.normalize_pressure_to_kpa([0, 5000, 1000], content=content)
        self.assertEqual(unit, "kPa")
        self.assertAlmostEqual(float(values[1]), 5.0)
        trig = pa.analyze_pressure_content(content, channel_index=1, use_raw=True)
        self.assertEqual(trig["metrics"]["pressureUnit"], "V")


class AnalyzePressureFileEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.project = Path(tempfile.mkdtemp(prefix="exda_pressure_test_"))
        run_dir = self.project / "Raw_Data" / "RUN-01" / "DAQ-X"
        run_dir.mkdir(parents=True)
        (self.project / "Plan").mkdir()
        t, y = pulse(peak=10000.0, offset=100900.0)
        lines = ["time,P1 [Pa],Trig [V]"] + [f"{a:.9f},{b:.6f},0" for a, b in zip(t, y)]
        self.data = run_dir / "run.csv"
        self.data.write_text("\n".join(lines), encoding="utf-8")
        self.write_plan("100900")

    def tearDown(self):
        shutil.rmtree(self.project, ignore_errors=True)

    def write_plan(self, p0):
        plan = {"planName": "P", "meta": {}, "experiments": [{"name": "RUN-01", "meta": {"p0": p0}}]}
        (self.project / "Plan" / "Experiment_Plan_v000.json").write_text(json.dumps(plan), encoding="utf-8")

    def post(self, **overrides):
        payload = {
            "projectPath": str(self.project),
            "path": "Raw_Data/RUN-01/DAQ-X/run.csv",
            "channelIndex": 0,
            "useRaw": True,
            "impulseDrop": 0.05,
            "pressureUnit": "auto",
            "pressureReference": "absolute",
        }
        payload.update(overrides)
        return self.client.post("/analyze_pressure_file", json=payload)

    def test_absolute_uses_plan_p0(self):
        response = self.post()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertAlmostEqual(float(body["metrics"]["pMax"]), 10.0, places=3)
        ref = body["processing"]["reference"]
        self.assertEqual(ref["p0Pa"], 100900.0)
        self.assertIn("RUN-01", ref["p0Source"])
        self.assertEqual(body["processing"]["source"]["run"], "RUN-01")

    def test_missing_plan_p0_is_an_error(self):
        self.write_plan("")
        response = self.post()
        self.assertEqual(response.status_code, 400)
        self.assertIn("P0", response.get_json()["error"])

    def test_invalid_settings_return_400(self):
        self.assertEqual(self.post(useRaw=False, cutoff="").status_code, 400)
        self.assertEqual(self.post(channelIndex=5).status_code, 400)


@unittest.skipUnless(WK27_DAQ1.exists(), "week-27 raw data not present")
class Week27FullResolutionTests(unittest.TestCase):
    def test_daq1_analysed_at_full_resolution_and_file_unchanged(self):
        before = sha256(WK27_DAQ1)
        client = flask_app.test_client()
        project = WK27_DAQ1.parents[3]
        rel = WK27_DAQ1.relative_to(project).as_posix()

        def run(channel, **extra):
            response = client.post("/analyze_pressure_file", json={
                "projectPath": str(project), "path": rel, "channelIndex": channel,
                "useRaw": True, "impulseDrop": 0.05, "pressureUnit": "auto", **extra,
            })
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            return response.get_json()

        a1 = run(0)
        self.assertEqual(a1["processing"]["samplesAnalysed"], 2_097_152)
        self.assertEqual(a1["processing"]["unit"]["input"], "bar")
        self.assertAlmostEqual(a1["processing"]["fsHz"], 1_000_000.0, places=3)
        t, y, _ = daq_reader.read_channel(str(WK27_DAQ1), 0)
        self.assertAlmostEqual(float(a1["metrics"]["pMax"]), float(np.max(y)) * 100.0, places=3)

        trigger = run(4)  # A5 [V]
        self.assertEqual(trigger["metrics"]["pressureUnit"], "V")
        self.assertEqual(sha256(WK27_DAQ1), before)


if __name__ == "__main__":
    unittest.main()
