"""Gas mixing: required inputs, record history and the read-only consistency check.

These tests never write under Projects/. Save tests use a temporary project
folder; tests that read real project data only read and verify checksums.
"""

import json
import shutil
import sys
import tempfile
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


def gas_record(run="G01-01", group="VH2D-Wk27-G01", **overrides):
    record = {
        "group": group,
        "runName": f"VH2D-Wk27-{run}",
        "targetVol": "16",
        "pChamberPa": "101500",
        "tChamberC": "22.1",
        "tChamberK": "295.25",
        "mfcFlowSlpm": "20",
        "mH2InjectedG": "10.88528",
        "results": {"m_H2_injected_g": 10.6926, "inputs": {"T_chamber_K": 295.25, "P_chamber_Pa": 101500}},
        "notes": "test day",
        "updatedAt": "2026-07-01T09:00:00Z",
    }
    record.update(overrides)
    return record


class GasMixingHistoryTests(unittest.TestCase):
    """Save endpoint keeps history; runs against a temporary project only."""

    def setUp(self):
        self.client = flask_app.test_client()
        self.project = Path(tempfile.mkdtemp(prefix="exda_gas_test_"))
        (self.project / "Reports").mkdir()
        self.gas_file = self.project / "Reports" / "gas_mixing.json"
        self.audit_file = self.project / "Reports" / "gas_mixing_audit.jsonl"

    def tearDown(self):
        shutil.rmtree(self.project, ignore_errors=True)

    def save(self, records, dosage=None):
        response = self.client.post("/save_gas_mixing", json={
            "projectPath": str(self.project),
            "records": records,
            "dosageModel": dosage or {"enabled": True, "a": "69.638", "b": "-0.2568"},
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return json.loads(self.gas_file.read_text(encoding="utf-8"))

    def audit_lines(self):
        if not self.audit_file.exists():
            return []
        return [json.loads(line) for line in self.audit_file.read_text(encoding="utf-8").splitlines()]

    def test_resave_keeps_previous_version(self):
        self.save([gas_record()])
        saved = self.save([gas_record(pChamberPa="100900", notes="edited", updatedAt="2026-11-23T10:00:00Z")])
        record = saved["records"][0]
        self.assertEqual(record["pChamberPa"], "100900")
        self.assertEqual(len(record["history"]), 1)
        first = record["history"][0]["record"]
        self.assertEqual(first["pChamberPa"], "101500")
        self.assertEqual(first["notes"], "test day")
        self.assertEqual(record["history"][0]["savedAt"], "2026-07-01T09:00:00Z")
        self.assertEqual([e["action"] for e in self.audit_lines() if e["runName"]], ["create", "update"])

    def test_first_version_survives_many_saves(self):
        self.save([gas_record()])
        for idx in range(3):
            saved = self.save([gas_record(notes=f"edit {idx}")])
        history = saved["records"][0]["history"]
        self.assertEqual(len(history), 3)
        self.assertEqual(history[0]["record"]["notes"], "test day")

    def test_unchanged_resave_adds_no_history(self):
        self.save([gas_record()])
        saved = self.save([gas_record(updatedAt="2026-11-23T10:00:00Z")])
        self.assertNotIn("history", saved["records"][0])
        self.assertEqual([e["action"] for e in self.audit_lines() if e["runName"]], ["create"])

    def test_client_cannot_replace_history(self):
        self.save([gas_record()])
        self.save([gas_record(notes="v2")])
        forged = gas_record(notes="v2", history=[])
        saved = self.save([forged])
        self.assertEqual(len(saved["records"][0]["history"]), 1)

    def test_delete_archives_record(self):
        self.save([gas_record(), gas_record(run="G01-02")])
        saved = self.save([gas_record()])
        self.assertEqual([r["runName"] for r in saved["records"]], ["VH2D-Wk27-G01-01"])
        self.assertEqual(saved["archivedRecords"][0]["record"]["runName"], "VH2D-Wk27-G01-02")
        self.assertIn("delete", [e["action"] for e in self.audit_lines()])
        # Archive persists across later saves.
        saved = self.save([gas_record(notes="later")])
        self.assertEqual(len(saved["archivedRecords"]), 1)

    def test_legacy_record_with_missing_keys_is_not_a_change(self):
        legacy = gas_record()
        self.gas_file.write_text(json.dumps({"records": [legacy]}), encoding="utf-8")
        saved = self.save([gas_record()])
        self.assertNotIn("history", saved["records"][0])

    def test_unreadable_file_is_not_overwritten(self):
        self.gas_file.write_text("{ not json", encoding="utf-8")
        response = self.client.post("/save_gas_mixing", json={
            "projectPath": str(self.project), "records": [gas_record()],
        })
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.gas_file.read_text(encoding="utf-8"), "{ not json")

    def test_dosage_model_change_is_audited(self):
        self.save([gas_record()])
        self.save([gas_record()], dosage={"enabled": True, "a": "70", "b": "0"})
        self.assertIn("dosage_model", [e["action"] for e in self.audit_lines()])


class GasMixingConsistencyCheckTests(unittest.TestCase):
    """Item 7: the check only reports; it never writes."""

    def test_each_check_on_synthetic_records(self):
        from modules import gas_mixing_checks

        records = [
            gas_record(run="A", tChamberK="295.25",
                       results={"inputs": {"T_chamber_K": 293.15, "P_chamber_Pa": 101500, "H2_volPct": 16, "MFC_setpoint_SLPM": 20}},
                       relativeHumidityPct="40"),
            gas_record(run="B", pChamberPa="101325", relativeHumidityPct="40",
                       results={"inputs": {"T_chamber_K": 295.25, "P_chamber_Pa": 101325, "H2_volPct": 16, "MFC_setpoint_SLPM": 20}}),
            gas_record(run="C", relativeHumidityPct="", results=None),
            gas_record(run="D", relativeHumidityPct="40", calibrationApplied="Yes", calibrationA="69.638",
                       calibrationB="-0.2568", targetVol="20", mH2InjectedG="13.9",
                       results={"inputs": {"T_chamber_K": 295.25, "P_chamber_Pa": 101500, "H2_volPct": 20, "MFC_setpoint_SLPM": 20}}),
        ]
        found = {(i["runName"].split("-")[-1], i["check"]) for i in gas_mixing_checks.check_gas_records(records)}
        self.assertIn(("A", "inputs_mismatch"), found)
        self.assertIn(("B", "possible_default_p"), found)
        self.assertIn(("C", "results_missing"), found)
        self.assertIn(("C", "missing_rh"), found)
        self.assertIn(("D", "calibration_mismatch"), found)
        self.assertNotIn(("B", "inputs_mismatch"), found)

    def test_calibration_consistent_record_passes(self):
        from modules import gas_mixing_checks

        record = gas_record(relativeHumidityPct="40", calibrationApplied="Yes", calibrationA="69.638",
                            calibrationB="-0.2568", targetVol="20", mH2InjectedG="13.670800000000002",
                            results={"inputs": {"T_chamber_K": 295.25, "P_chamber_Pa": 101500, "H2_volPct": 20, "MFC_setpoint_SLPM": 20}})
        self.assertEqual(gas_mixing_checks.check_gas_records([record]), [])

    @unittest.skipUnless((REPO_ROOT / "Projects" / "VH2D-Project-Wk-27-2026" / "Reports" / "gas_mixing.json").exists(),
                         "week-27 project data not present")
    def test_week27_report_matches_review_and_changes_no_files(self):
        import hashlib

        project = REPO_ROOT / "Projects" / "VH2D-Project-Wk-27-2026"
        watched = [project / "Reports" / "gas_mixing.json", *sorted((project / "Plan").glob("*.json"))]
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in watched}
        listing_before = sorted(p.name for p in (project / "Reports").iterdir())

        client = flask_app.test_client()
        response = client.get("/check_gas_mixing_records", query_string={"projectPath": str(project)})
        self.assertEqual(response.status_code, 200)
        report = response.get_json()
        found = {(i["source"], i["runName"].replace("VH2D-Wk27-", ""), i["check"], i["field"]) for i in report["issues"]}
        expected = {
            ("gas_mixing", "G01-01", "inputs_mismatch", "tChamberK"),
            ("gas_mixing", "G01-08", "inputs_mismatch", "pChamberPa"),
            ("gas_mixing", "G01-06", "possible_default_p", "pChamberPa"),
            ("gas_mixing", "G01-12", "possible_default_p", "pChamberPa"),
            ("gas_mixing", "G04-03", "possible_default_p", "pChamberPa"),
            ("plan", "G01-06", "possible_default_p0", "p0"),
            ("plan", "G01-12", "possible_default_p0", "p0"),
            ("plan", "G04-03", "possible_default_p0", "p0"),
            ("gas_mixing", "G00-01", "missing_rh", "relativeHumidityPct"),
        }
        self.assertEqual(found, expected)

        csv_response = client.get("/check_gas_mixing_records",
                                  query_string={"projectPath": str(project), "format": "csv"})
        self.assertEqual(csv_response.status_code, 200)
        self.assertIn("text/csv", csv_response.headers["Content-Type"])
        self.assertEqual(len(csv_response.get_data(as_text=True).strip().splitlines()), 1 + len(expected))

        after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in watched}
        self.assertEqual(before, after)
        self.assertEqual(listing_before, sorted(p.name for p in (project / "Reports").iterdir()))


if __name__ == "__main__":
    unittest.main()
