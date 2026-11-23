"""EXDA-Check C1: atomic writes, previous versions kept, change log.

Runs in temporary project folders only.
"""

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
from modules import project_store  # noqa: E402


class ProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="exda_store_test_"))
        (self.root / "Reports").mkdir()
        self.file = self.root / "Reports" / "thing.json"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def log(self):
        path = self.root / "History" / "change_log.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def copies(self):
        folder = self.root / "History" / "Reports__thing.json"
        return sorted(folder.iterdir()) if folder.exists() else []

    def test_first_version_stays_retrievable_and_changes_are_logged(self):
        project_store.save_json_tracked(str(self.root), str(self.file), {"updatedAt": "d1", "p0": "100900", "notes": "test day"})
        first_bytes = self.file.read_bytes()
        for value in ("101000", "101100", "101200"):
            project_store.save_json_tracked(str(self.root), str(self.file), {"updatedAt": "dx", "p0": value, "notes": "test day"})
        copies = self.copies()
        self.assertEqual(len(copies), 3)
        self.assertEqual(copies[0].read_bytes(), first_bytes)
        entries = self.log()
        self.assertEqual([e["kind"] for e in entries], ["created", "modified", "modified", "modified"])
        self.assertEqual(entries[1]["changes"], [{"path": "p0", "kind": "changed", "old": "100900", "new": "101000"}])
        self.assertTrue(entries[1]["historyCopy"].startswith("History/Reports__thing.json/"))
        self.assertIn("user", entries[1])
        self.assertIn("host", entries[1])

    def test_identical_or_bookkeeping_only_saves_add_nothing(self):
        project_store.save_json_tracked(str(self.root), str(self.file), {"updatedAt": "d1", "a": 1})
        project_store.save_json_tracked(str(self.root), str(self.file), {"updatedAt": "d1", "a": 1})
        project_store.save_json_tracked(str(self.root), str(self.file), {"updatedAt": "d2", "a": 1})
        self.assertEqual(self.copies(), [])
        self.assertEqual(len(self.log()), 1)
        self.assertEqual(json.loads(self.file.read_text())["updatedAt"], "d2")

    def test_list_items_matched_by_name(self):
        old = {"experiments": [{"name": "G01-01", "meta": {"p0": "1"}}, {"name": "G01-02", "meta": {"p0": "2"}}]}
        new = {"experiments": [{"name": "G01-02", "meta": {"p0": "2"}}, {"name": "G01-01", "meta": {"p0": "9"}}]}
        changes = project_store.diff_values(old, new)
        self.assertEqual([(c["path"], c["old"], c["new"]) for c in changes],
                         [("experiments[name=G01-01].meta.p0", "1", "9")])

    def test_atomic_write_leaves_no_temp_files_and_keeps_old_on_failure(self):
        project_store.write_json_atomic(str(self.file), {"a": 1})
        with self.assertRaises(TypeError):
            project_store.write_json_atomic(str(self.file), {"a": object()})
        self.assertEqual(json.loads(self.file.read_text()), {"a": 1})
        self.assertEqual([p.name for p in self.file.parent.iterdir()], ["thing.json"])

    def test_unreadable_previous_file_is_kept(self):
        self.file.write_text('{"truncated": ', encoding="utf-8")
        project_store.save_json_tracked(str(self.root), str(self.file), {"a": 1})
        self.assertEqual(self.copies()[0].read_text(encoding="utf-8"), '{"truncated": ')
        self.assertIn("not readable", self.log()[0]["kind"])


class EndpointHistoryTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_store_ep_"))
        for folder in ("Plan", "Reports", "Raw_Data"):
            (self.root / folder).mkdir()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_every_project_file_save_keeps_history(self):
        def post(route, body):
            response = self.client.post(route, json={"projectPath": str(self.root), **body})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

        sensor = {"id": "P1", "channel": "A1", "location": "wall"}
        for location in ("wall", "roof"):
            post("/save_sensors_mapping", {"mappingsByGroup": {"G01": [{**sensor, "location": location}]}})
            post("/save_daq_systems", {"daqSystems": [{"id": "DAQ-1", "notes": location}]})
            post("/save_checklist_state", {"checklistState": {"leak_check": location == "roof"}})
            plan = {"planName": "P", "meta": {}, "experiments": [{"name": "R-01", "meta": {"p0": location}}]}
            post("/save_plan", {"filename": "Experiment_Plan_v000.json", "content": json.dumps(plan)})

        history = self.root / "History"
        names = sorted(p.name for p in history.iterdir() if p.is_dir())
        self.assertEqual(names, [
            "Plan__Experiment_Plan_v000.json",
            "Reports__checklist_state.json",
            "Reports__daq_systems.json",
            "Reports__sensors_mapping.json",
        ])
        entries = [json.loads(l) for l in (history / "change_log.jsonl").read_text(encoding="utf-8").splitlines()]
        plan_change = [e for e in entries if e["file"] == "Plan/Experiment_Plan_v000.json" and e["kind"] == "modified"][0]
        self.assertEqual(plan_change["changes"][0]["path"], "experiments[name=R-01].meta.p0")
        self.assertEqual((plan_change["changes"][0]["old"], plan_change["changes"][0]["new"]), ("wall", "roof"))
        leftovers = [n for n in os.listdir(self.root / "Reports") if n.startswith(".tmp_")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
