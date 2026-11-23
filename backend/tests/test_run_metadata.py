"""EXDA-Check C6 (informational project path) and C7 (actual ignition time).

Temporary project folders for writes; the week-27 check only reads.
"""

import hashlib
import json
import os
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
from modules import project_manager  # noqa: E402
from routes import state  # noqa: E402

WK27 = REPO_ROOT / "Projects" / "VH2D-Project-Wk-27-2026"


class ProjectPathTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="exda_status_test_"))
        (self.root / "Plan").mkdir()
        status = {"project_name": "X", "project_path": "/media/psf/old/VM/path", "created_at": "2026-06-01"}
        (self.root / "Plan" / "project_status.json").write_text(json.dumps(status), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_stored_path_is_informational_and_updated_on_open(self):
        status = project_manager.ensure_project_status(str(self.root))
        self.assertEqual(status["project_path"], str(self.root))
        self.assertIn("Not used to locate files", status["project_path_note"])
        self.assertEqual(status["created_at"], "2026-06-01")


class IgnitionTimeTests(unittest.TestCase):
    def test_plan_export_includes_actual_ignition_time(self):
        rows = state._build_plan_export_rows([{
            "name": "G03-02",
            "meta": {"actualIgnitionTime": "2026-07-02T18:50:35+02:00", "actualIgnitionTimeSource": "logbook"},
        }])
        self.assertEqual(rows[0]["actual_ignition_time"], "2026-07-02T18:50:35+02:00")
        self.assertEqual(rows[0]["actual_ignition_time_source"], "logbook")

    def test_bad_run_name_rejected(self):
        client = flask_app.test_client()
        root = tempfile.mkdtemp(prefix="exda_ign_test_")
        try:
            r = client.get("/run_time_candidates", query_string={"projectPath": root, "runName": "../x"})
            self.assertEqual(r.status_code, 400)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    @unittest.skipUnless((WK27 / "Raw_Data" / "VH2D-Wk27-G03-02").is_dir(), "week-27 raw data not present")
    def test_week27_candidates_state_source_and_zone_and_change_nothing(self):
        run_dir = WK27 / "Raw_Data" / "VH2D-Wk27-G03-02"
        files = sorted(p for p in run_dir.rglob("*") if p.is_file())
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.suffix.lower() != ".seq"}
        r = flask_app.test_client().get("/run_time_candidates", query_string={
            "projectPath": str(WK27), "runName": "VH2D-Wk27-G03-02"})
        data = r.get_json()
        self.assertTrue(data["success"])
        mf4 = [c for c in data["candidates"] if c["source"] == "MF4 recording start"]
        self.assertEqual(len(mf4), 1)
        from datetime import datetime, timezone
        as_utc = datetime.fromisoformat(mf4[0]["value"]).astimezone(timezone.utc)
        self.assertEqual(as_utc.strftime("%Y-%m-%dT%H:%M:%S"), "2026-07-02T16:50:35")
        self.assertTrue(all(c["timezone"] for c in data["candidates"] if c["source"] != "unreadable"))
        after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in before}
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
