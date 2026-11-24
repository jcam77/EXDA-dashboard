"""EXDA-Check C3 (checklist snapshot per run) and C4 (run overrides follow renames).

Temporary project folders only.
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
from modules import project_manager  # noqa: E402


class ChecklistSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_checklist_test_"))
        (self.root / "Reports").mkdir()
        project_manager.write_project_marker(str(self.root))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def save(self, run, checked, note=""):
        return self.client.post("/save_checklist_snapshot", json={
            "projectPath": str(self.root),
            "runName": run,
            "note": note,
            "items": [{"id": "vent", "text": "1.1 Ventilation OFF", "checked": checked},
                      {"id": "leak", "text": "3.2 Leak test", "checked": True}],
            "signOff": {"responsibleName": "A. Person", "initials": "LU", "finalConfirm": checked},
        })

    def test_snapshots_are_per_run_timestamped_and_append_only(self):
        self.assertEqual(self.save("G01-01", False).status_code, 200)
        self.assertEqual(self.save("G01-01", True, "before ignition").status_code, 200)
        self.assertEqual(self.save("G01-02", True).status_code, 200)

        r = self.client.get("/get_checklist_snapshots", query_string={"projectPath": str(self.root), "runName": "G01-01"})
        snaps = r.get_json()["snapshots"]
        self.assertEqual(len(snaps), 2)
        self.assertEqual((snaps[0]["completed"], snaps[1]["completed"]), (1, 2))
        self.assertTrue(snaps[1]["allChecked"])
        self.assertEqual(snaps[1]["note"], "before ignition")
        self.assertEqual(snaps[0]["items"][0], {"id": "vent", "text": "1.1 Ventilation OFF", "checked": False})
        self.assertRegex(snaps[0]["savedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")

        # The first snapshot is unchanged and the previous file versions are in History.
        stored = json.loads((self.root / "Reports" / "checklist_runs.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["snapshotsByRun"]["G01-01"][0], snaps[0])
        self.assertEqual(len(list((self.root / "History" / "Reports__checklist_runs.json").iterdir())), 2)

    def test_run_is_required(self):
        response = self.save("", True)
        self.assertEqual(response.status_code, 400)
        self.assertFalse((self.root / "Reports" / "checklist_runs.json").exists())


class RunOverrideRenameTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_override_test_"))
        (self.root / "Reports").mkdir()
        project_manager.write_project_marker(str(self.root))
        mapping = {
            "selectedGroup": "G04-01",
            "groupNotes": {"G04-01": "P7 re-mounted"},
            "mappingsByGroup": {"G04": [{"id": "s1", "sensorId": "P7"}], "G04-01": [{"id": "s2", "sensorId": "P7"}]},
        }
        (self.root / "Reports" / "sensors_mapping.json").write_text(json.dumps(mapping), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_override_key_follows_run_rename(self):
        response = self.client.post("/rename_run_metadata_references", json={
            "projectPath": str(self.root),
            "renamePairs": [{"oldName": "G04-01", "newName": "G05-01"}],
            "oldGroup": "G04", "newGroup": "G05",
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["runOverridesRenamed"], 1)
        stored = json.loads((self.root / "Reports" / "sensors_mapping.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(stored["mappingsByGroup"]), ["G05", "G05-01"])
        self.assertEqual(stored["groupNotes"]["G05-01"], "P7 re-mounted")
        self.assertEqual(stored["selectedGroup"], "G05-01")


if __name__ == "__main__":
    unittest.main()
