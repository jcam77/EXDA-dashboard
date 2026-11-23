"""Gas mixing: required inputs, record history and the read-only consistency check.

These tests never write under Projects/. Save tests use a temporary project
folder; tests that read real project data only read and verify checksums.
"""

import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import gas_mixing  # noqa: E402


def full_calc_payload(**overrides):
    payload = {
        "H2_volPct": "16",
        "P_chamber_Pa": "101500",
        "T_chamber_K": "295.25",
        "MFC_setpoint_SLPM": "20",
        "L_m": "0.9",
        "W_m": "0.9",
        "H_m": "0.9",
        "Vol_Pipes_m3": "0",
        "HotwireAssembly_m3": "0",
        "WeldedParts_m3": "0",
        "Bolts_m3": "0",
    }
    payload.update(overrides)
    return payload


class GasMixingRequiredInputsTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()

    def test_complete_payload_echoes_exact_inputs(self):
        result = gas_mixing.calculate_h2_mfc_fill(full_calc_payload())
        self.assertAlmostEqual(result["inputs"]["T_chamber_K"], 295.25)
        self.assertAlmostEqual(result["inputs"]["P_chamber_Pa"], 101500.0)

    def test_missing_measured_inputs_are_rejected_not_defaulted(self):
        required_keys = [
            "P_chamber_Pa", "T_chamber_K", "H2_volPct", "MFC_setpoint_SLPM",
            "L_m", "W_m", "H_m",
            "Vol_Pipes_m3", "HotwireAssembly_m3", "WeldedParts_m3", "Bolts_m3",
        ]
        for key in required_keys:
            for blank in (None, "", "   "):
                with self.subTest(key=key, blank=blank):
                    payload = full_calc_payload()
                    if blank is None:
                        payload.pop(key)
                    else:
                        payload[key] = blank
                    with self.assertRaises(ValueError):
                        gas_mixing.calculate_h2_mfc_fill(payload)

    def test_ambient_pressure_fallback_removed(self):
        payload = full_calc_payload()
        payload.pop("P_chamber_Pa")
        payload["ambPressure"] = "1.01325"
        with self.assertRaises(ValueError):
            gas_mixing.calculate_h2_mfc_fill(payload)

    def test_api_returns_400_for_blank_pressure_or_temperature(self):
        for key in ("P_chamber_Pa", "T_chamber_K"):
            with self.subTest(key=key):
                response = self.client.post("/calculate_gas_mix", json=full_calc_payload(**{key: ""}))
                self.assertEqual(response.status_code, 400)
                body = response.get_json()
                self.assertFalse(body["success"])
                self.assertIn("required", body["error"])
                self.assertNotIn("293.15", response.get_data(as_text=True))
                self.assertNotIn("101325", response.get_data(as_text=True))

    def test_standard_constants_still_default(self):
        result = gas_mixing.calculate_h2_mfc_fill(full_calc_payload())
        self.assertAlmostEqual(result["inputs"]["T_std_K"], 298.15)
        self.assertAlmostEqual(result["inputs"]["P_std_Pa"], 101325.0)


if __name__ == "__main__":
    unittest.main()
