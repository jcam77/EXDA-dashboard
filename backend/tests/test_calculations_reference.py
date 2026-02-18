"""Reference checks for backend calculations and API/module consistency."""

import math
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import ewt_analysis  # noqa: E402
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
