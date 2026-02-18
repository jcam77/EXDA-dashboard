"""Reference checks for backend calculations and API/module consistency."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import ewt_analysis, pressure_analysis  # noqa: E402
from modules.plot_interpolation import aggregate_plot_data  # noqa: E402
from modules.pressure_analysis import analyze_pressure_content  # noqa: E402


PRESSURE_SIGNAL = "\n".join(
    [
        "0 0",
        "1 1",
        "2 3",
        "3 5",
        "4 4",
        "5 3",
        "6 2",
        "7 1",
    ]
)

EXPERIMENTAL_SIGNAL_PATH = (
    REPO_ROOT / "Projects" / "VH2D-Project" / "Raw_Data" / "expData" / "FMG" / "Pressure" / "Experimental_Data_001.csv"
)
VERIFICATION_CLEAN_FIXTURE = REPO_ROOT / "backend" / "tests" / "reference_data" / "experimental_data_001_clean.csv"
VERIFICATION_NOISY_FIXTURE = REPO_ROOT / "backend" / "tests" / "reference_data" / "experimental_data_001_noisy.csv"


def _as_content(t, y):
    """Render numeric vectors to parser-compatible text."""
    return "\n".join(f"{float(tx):.9f} {float(py):.9f}" for tx, py in zip(t, y))


class CalculationReferenceTests(unittest.TestCase):
    """Golden/reference checks for core backend calculation behavior."""

    def test_pressure_metric_definitions(self):
        """Validate pMax/tMax/impulse behavior at multiple cutoff values."""
        at_peak = analyze_pressure_content(PRESSURE_SIGNAL, use_raw=True, impulse_drop=1.0)
        half_peak = analyze_pressure_content(PRESSURE_SIGNAL, use_raw=True, impulse_drop=0.5)

        self.assertEqual(float(at_peak["metrics"]["pMax"]), 5.0)
        self.assertEqual(float(at_peak["metrics"]["tMax"]), 3.0)
        self.assertAlmostEqual(float(at_peak["metrics"]["impulse"]), 6.5, places=4)
        self.assertIn("100.0% Pmax", at_peak["metrics"]["status"])

        self.assertAlmostEqual(float(half_peak["metrics"]["impulse"]), 17.0, places=4)
        self.assertIn("50.0% Pmax", half_peak["metrics"]["status"])

    def test_api_pressure_matches_module_output(self):
        """Verify /analyze_pressure returns values consistent with module logic."""
        payload = {
            "content": PRESSURE_SIGNAL,
            "cutoff": 100,
            "order": 4,
            "useRaw": True,
            "impulseDrop": 0.5,
        }
        expected = analyze_pressure_content(
            payload["content"],
            cutoff=payload["cutoff"],
            order=payload["order"],
            impulse_drop=payload["impulseDrop"],
            use_raw=payload["useRaw"],
        )

        flask_app.testing = True
        with flask_app.test_client() as client:
            response = client.post("/analyze_pressure", json=payload)
            self.assertEqual(response.status_code, 200)
            actual = response.get_json()

        self.assertAlmostEqual(float(actual["metrics"]["pMax"]), float(expected["metrics"]["pMax"]), places=6)
        self.assertAlmostEqual(float(actual["metrics"]["tMax"]), float(expected["metrics"]["tMax"]), places=6)
        self.assertAlmostEqual(float(actual["metrics"]["impulse"]), float(expected["metrics"]["impulse"]), places=6)
        self.assertEqual(actual["metrics"]["status"], expected["metrics"]["status"])

    def test_calculation_verification_endpoint_shape(self):
        """Verify verification endpoint returns plot and metric payloads."""
        if not VERIFICATION_CLEAN_FIXTURE.exists() or not VERIFICATION_NOISY_FIXTURE.exists():
            self.skipTest("verification data missing; generate with backend/tests/scripts/auxiliary/python/generate_reference_data.py")

        flask_app.testing = True
        with flask_app.test_client() as client:
            response = client.get("/calculation_verification?decayPercent=50&cutoffHz=20&order=4")
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()

        self.assertTrue(payload.get("success"))
        self.assertIn("plotData", payload)
        self.assertTrue(len(payload["plotData"]) > 10)
        self.assertIn("pythonMetrics", payload)
        self.assertIn("clean_raw", payload["pythonMetrics"])
        self.assertIn("noisy_raw", payload["pythonMetrics"])
        self.assertIn("noisy_filtered", payload["pythonMetrics"])

    def test_plot_interpolation_is_visualization_only(self):
        """Ensure aggregation changes plotting grid only, not source metrics."""
        before = analyze_pressure_content(PRESSURE_SIGNAL, use_raw=True, impulse_drop=0.5)["metrics"]

        payload = {
            "activeTab": "pressure_analysis",
            "series": [
                {
                    "displayName": "SeriesA",
                    "plotData": [
                        {"t": 0.0, "p": 0.0},
                        {"t": 3.0, "p": 5.0},
                        {"t": 7.0, "p": 1.0},
                    ],
                }
            ],
        }
        plot_points = aggregate_plot_data(payload)
        self.assertGreater(len(plot_points), 10)
        self.assertIn("time", plot_points[0])
        self.assertIn("SeriesA", plot_points[0])

        after = analyze_pressure_content(PRESSURE_SIGNAL, use_raw=True, impulse_drop=0.5)["metrics"]
        self.assertEqual(before, after)

    def test_api_aggregate_matches_module(self):
        """Verify /aggregate_plot response equals module interpolation output."""
        payload = {
            "activeTab": "pressure_analysis",
            "series": [
                {
                    "displayName": "SeriesA",
                    "plotData": [
                        {"t": 0.0, "p": 0.0},
                        {"t": 3.0, "p": 5.0},
                        {"t": 7.0, "p": 1.0},
                    ],
                }
            ],
        }
        expected = aggregate_plot_data(payload)

        flask_app.testing = True
        with flask_app.test_client() as client:
            response = client.post("/aggregate_plot", json=payload)
            self.assertEqual(response.status_code, 200)
            actual = response.get_json()["plotData"]

        self.assertEqual(len(actual), len(expected))
        self.assertEqual(actual[0].keys(), expected[0].keys())
        self.assertTrue(math.isclose(actual[-1]["time"], expected[-1]["time"], rel_tol=0.0, abs_tol=1e-9))

    def test_ewt_peak_frequency_metadata_shape(self):
        """Check EWT mode/peak metadata structure when EWT backend is available."""
        if not ewt_analysis.HAS_EWT:
            self.skipTest("ewtpy not installed; skipping EWT decomposition checks.")

        fs = 500.0
        total_samples = 1000
        lines = []
        for i in range(total_samples):
            t = i / fs
            y = 2000.0 * math.sin(2 * math.pi * 20.0 * t) + 800.0 * math.sin(2 * math.pi * 80.0 * t)
            lines.append(f"{t:.6f} {101325.0 + y:.6f}")
        content = "\n".join(lines)

        result = ewt_analysis.analyze_ewt_content(content, num_modes=5, max_points=300, knee_modes=8)
        self.assertNotIn("error", result)
        self.assertIn("energy", result)
        self.assertGreater(len(result["energy"]), 0)
        for row in result["energy"]:
            self.assertIn("peakHz", row)
            self.assertIsInstance(row["peakHz"], (int, float))
            self.assertGreaterEqual(row["peakHz"], 0.0)
        self.assertIn("summary", result)
        self.assertIn("suggestedFilter", result["summary"])

    def test_butterworth_recovers_reference_from_multifrequency_noise(self):
        """Validate that low-pass filtering pulls noisy data back toward a known reference trace."""
        if pressure_analysis.signal is None:
            self.skipTest("scipy unavailable; Butterworth filtering cannot be validated.")
        if not EXPERIMENTAL_SIGNAL_PATH.exists():
            self.skipTest(f"reference file missing: {EXPERIMENTAL_SIGNAL_PATH}")

        data = np.loadtxt(EXPERIMENTAL_SIGNAL_PATH, delimiter=",")
        t_raw = data[:, 0]
        y_raw = data[:, 1]
        t, y_ref = pressure_analysis.apply_butterworth(t_raw, y_raw, cutoff_hz=20.0, order=4)
        rng = np.random.default_rng(20260218)

        freqs_hz = [35.0, 70.0, 120.0]
        phases = rng.uniform(0.0, 2.0 * math.pi, size=len(freqs_hz))
        base_amp = max(float(np.std(y_ref)) * 0.4, 1e-4)
        noise = np.zeros_like(y_ref, dtype=float)
        for idx, (freq_hz, phase) in enumerate(zip(freqs_hz, phases)):
            noise += (base_amp / (idx + 1)) * np.sin(2.0 * math.pi * freq_hz * t + phase)
        noise += 0.1 * base_amp * rng.standard_normal(len(y_ref))
        y_noisy = y_ref + noise

        t_filt, y_filt = pressure_analysis.apply_butterworth(t, y_noisy, cutoff_hz=20.0, order=4)
        y_ref_filt_grid = np.interp(t_filt, t, y_ref)
        y_noisy_filt_grid = np.interp(t_filt, t, y_noisy)

        rmse_noisy = float(np.sqrt(np.mean((y_noisy_filt_grid - y_ref_filt_grid) ** 2)))
        rmse_filt = float(np.sqrt(np.mean((y_filt - y_ref_filt_grid) ** 2)))
        self.assertLess(
            rmse_filt,
            rmse_noisy * 0.5,
            msg=f"Expected filtering RMSE improvement, got noisy={rmse_noisy:.6g} filtered={rmse_filt:.6g}",
        )

        raw_result = analyze_pressure_content(_as_content(t, y_noisy), cutoff=20, order=4, use_raw=True, impulse_drop=0.5)
        filt_result = analyze_pressure_content(_as_content(t, y_noisy), cutoff=20, order=4, use_raw=False, impulse_drop=0.5)
        self.assertNotIn("error", raw_result)
        self.assertNotIn("error", filt_result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
