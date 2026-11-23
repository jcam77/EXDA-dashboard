"""Report exports get a timestamped name and never overwrite an earlier export.

All exports run against a temporary project folder; nothing under Projects/ is
touched.
"""

import re
import shutil
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from routes import state  # noqa: E402


STAMP_RE = r"\d{4}-\d{2}-\d{2}_\d{6}"


class UniqueExportPathTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="exda_report_names_"))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_name_has_date_and_time_without_colons(self):
        now = datetime(2026, 11, 23, 14, 32, 5)
        path = state._unique_export_path(str(self.dir), "P_Metadata_Report", "pdf", now=now)
        self.assertEqual(Path(path).name, "P_Metadata_Report_2026-11-23_143205.pdf")
        self.assertNotIn(":", Path(path).name)

    def test_same_second_gets_a_suffix_and_never_reuses_a_name(self):
        now = datetime(2026, 11, 23, 14, 32, 5)
        names = []
        for _ in range(3):
            path = state._unique_export_path(str(self.dir), "P_DAQ_Systems", "csv", now=now)
            Path(path).write_text("x", encoding="utf-8")
            names.append(Path(path).name)
        self.assertEqual(names, [
            "P_DAQ_Systems_2026-11-23_143205.csv",
            "P_DAQ_Systems_2026-11-23_143205_2.csv",
            "P_DAQ_Systems_2026-11-23_143205_3.csv",
        ])


class ExportEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.project = Path(tempfile.mkdtemp(prefix="exda_report_export_"))
        self.reports = self.project / "Reports"
        self.reports.mkdir()
        self.name = self.project.name

    def tearDown(self):
        shutil.rmtree(self.project, ignore_errors=True)

    def export(self, route, **extra):
        payload = {"projectPath": str(self.project), "format": "csv", **extra}
        response = self.client.post(route, json=payload)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body.get("success"), body)
        return Path(body["path"])

    def test_two_exports_produce_two_files_and_keep_old_date_only_file(self):
        legacy = self.reports / f"{self.name}_DAQ_Systems_2026-07-01.csv"
        legacy.write_text("legacy report\n", encoding="utf-8")

        first = self.export("/export_daq_artifact", daqSystems=[])
        first_content = first.read_bytes()
        second = self.export("/export_daq_artifact", daqSystems=[])

        self.assertNotEqual(first, second)
        self.assertTrue(first.exists() and second.exists())
        self.assertEqual(first.read_bytes(), first_content)
        self.assertEqual(legacy.read_text(encoding="utf-8"), "legacy report\n")
        for path in (first, second):
            self.assertRegex(path.name, rf"^{re.escape(self.name)}_DAQ_Systems_{STAMP_RE}(_\d+)?\.csv$")

    def test_every_report_export_is_timestamped(self):
        cases = [
            ("/export_metadata_report_artifact", {}, "Metadata_Report"),
            ("/export_daq_artifact", {"daqSystems": []}, "DAQ_Systems"),
            ("/export_sensors_mapping_artifact", {"sensors": []}, "Sensors_Mapping"),
            ("/export_cameras_mapping_artifact", {"cameras": []}, "Cameras_Mapping"),
            ("/export_gas_mixing_artifact", {"records": []}, "Gas_Mixing"),
        ]
        for route, extra, kind in cases:
            with self.subTest(route=route):
                path = self.export(route, **extra)
                self.assertEqual(path.parent, self.reports)
                self.assertRegex(path.name, rf"^{re.escape(self.name)}_{kind}_{STAMP_RE}(_\d+)?\.csv$")

    def test_plan_export_is_timestamped(self):
        path = self.export("/export_plan_artifact", planName="Experiment_Plan_v000", experiments=[])
        self.assertEqual(path.parent, self.project / "Plan")
        self.assertRegex(path.name, rf"^Experiment_Plan_v000_{STAMP_RE}(_\d+)?\.csv$")

    def test_latest_report_lookup_prefers_newest_export(self):
        legacy = self.reports / f"{self.name}_DAQ_Systems_2026-07-01.csv"
        legacy.write_text("legacy report\n", encoding="utf-8")
        newest = self.export("/export_daq_artifact", daqSystems=[])
        response = self.client.get("/latest_report_artifact", query_string={
            "projectPath": str(self.project), "kind": "daq", "format": "csv",
        })
        body = response.get_json()
        self.assertTrue(body.get("found"), body)
        self.assertEqual(body["filename"], newest.name)


if __name__ == "__main__":
    unittest.main()
