"""Outdated-copy protection (409) and one writer per project (423).

Temporary project folders only. "Another app" is simulated by writing a lock
file with a different instance id and a fresh heartbeat.
"""

import json
import os
import shutil
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import project_store  # noqa: E402


def make_project():
    root = Path(tempfile.mkdtemp(prefix="exda_conc_test_"))
    for folder in ("Plan", "Reports", "Raw_Data"):
        (root / folder).mkdir()
    return root


def other_app_lock(root, heartbeat_age=0.0, host="lab-pc", pid=999999):
    lock = {
        "instanceId": "someone-else",
        "user": "colleague",
        "host": host,
        "pid": pid,
        "acquiredAt": "2026-11-23T13:55:58",
        "heartbeatAt": "2026-11-23T13:55:58",
        "heartbeatEpoch": time.time() - heartbeat_age,
    }
    (root / ".exda.lock").write_text(json.dumps(lock), encoding="utf-8")


class OutdatedCopyTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = make_project()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def get(self, route):
        return self.client.get(route, query_string={"projectPath": str(self.root)}).get_json()

    def post(self, route, body):
        return self.client.post(route, json={"projectPath": str(self.root), **body})

    def test_second_window_with_old_copy_is_refused(self):
        first = self.post("/save_daq_systems", {"daqSystems": [{"id": "DAQ-1", "notes": "a"}]}).get_json()
        version_window_a = self.get("/get_daq_systems")["version"]
        version_window_b = self.get("/get_daq_systems")["version"]
        self.assertEqual(first["version"], version_window_a)

        saved_a = self.post("/save_daq_systems", {"daqSystems": [{"id": "DAQ-1", "notes": "from A"}],
                                                   "baseVersion": version_window_a})
        self.assertEqual(saved_a.status_code, 200)

        stale_b = self.post("/save_daq_systems", {"daqSystems": [{"id": "DAQ-1", "notes": "from B"}],
                                                   "baseVersion": version_window_b})
        self.assertEqual(stale_b.status_code, 409)
        body = stale_b.get_json()
        self.assertTrue(body["conflict"])
        self.assertIn("changed elsewhere", body["error"])
        stored = json.loads((self.root / "Reports" / "daq_systems.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["daqSystems"][0]["notes"], "from A")

    def test_bookkeeping_only_changes_do_not_conflict(self):
        self.post("/save_checklist_state", {"checklistState": {"vent": True}})
        version = self.get("/get_project_state")["checklistVersion"]
        self.post("/save_checklist_state", {"checklistState": {"vent": True}})  # only updatedAt changes
        again = self.post("/save_checklist_state", {"checklistState": {"vent": False}, "baseVersion": version})
        self.assertEqual(again.status_code, 200, again.get_data(as_text=True))

    def test_new_file_expects_empty_version(self):
        version = self.get("/get_sensors_mapping")["version"]
        self.assertEqual(version, "")
        ok = self.post("/save_sensors_mapping", {"mappingsByGroup": {"G01": []}, "baseVersion": version})
        self.assertEqual(ok.status_code, 200)
        again = self.post("/save_sensors_mapping", {"mappingsByGroup": {"G02": []}, "baseVersion": ""})
        self.assertEqual(again.status_code, 409)

    def test_plan_save_checks_version(self):
        content = json.dumps({"planName": "P", "meta": {}, "experiments": [{"name": "R-01", "meta": {"p0": "100900"}}]})
        first = self.post("/save_plan", {"filename": "P.json", "content": content}).get_json()
        state = self.get("/get_project_state")
        self.assertEqual((state["planFile"], state["planVersion"]), ("P.json", first["version"]))
        newer = content.replace("100900", "101000")
        self.assertEqual(self.post("/save_plan", {"filename": "P.json", "content": newer,
                                                  "baseVersion": state["planVersion"]}).status_code, 200)
        older = content.replace("100900", "99999")
        r = self.post("/save_plan", {"filename": "P.json", "content": older, "baseVersion": state["planVersion"]})
        self.assertEqual(r.status_code, 409)
        self.assertIn("101000", (self.root / "Plan" / "P.json").read_text(encoding="utf-8"))

    def test_gas_mixing_save_checks_version(self):
        record = {"group": "G01", "runName": "R-01", "pChamberPa": "100900"}
        first = self.post("/save_gas_mixing", {"records": [record]}).get_json()
        self.assertEqual(self.get("/get_gas_mixing")["version"], first["version"])
        self.assertEqual(self.post("/save_gas_mixing", {"records": [record], "baseVersion": "outdated"}).status_code, 409)


class ProjectLockTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = make_project()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def lock(self, action, **extra):
        return self.client.post("/project_lock", json={"projectPath": str(self.root), "action": action, **extra}).get_json()

    def test_acquire_heartbeat_release(self):
        self.assertTrue(self.lock("acquire")["owned"])
        self.assertTrue((self.root / ".exda.lock").exists())
        self.assertTrue(self.lock("heartbeat")["owned"])
        self.assertFalse(self.lock("release")["locked"])
        self.assertFalse((self.root / ".exda.lock").exists())

    def test_other_app_makes_this_one_read_only(self):
        other_app_lock(self.root)
        status = self.lock("acquire")
        self.assertFalse(status["owned"])
        self.assertEqual(status["holder"]["host"], "lab-pc")
        r = self.client.post("/save_checklist_state", json={"projectPath": str(self.root), "checklistState": {"a": True}})
        self.assertEqual(r.status_code, 423)
        self.assertTrue(r.get_json()["locked"])
        self.assertFalse((self.root / "Reports" / "checklist_state.json").exists())
        r = self.client.post("/rename_run_data_folders", json={
            "projectPath": str(self.root), "renamePairs": [{"oldName": "A-01", "newName": "B-01"}]})
        self.assertEqual(r.status_code, 423)

    def test_stale_or_dead_lock_is_replaced_and_take_over_is_logged(self):
        other_app_lock(self.root, heartbeat_age=project_store.LOCK_STALE_SECONDS + 5)
        self.assertTrue(self.lock("acquire")["owned"])

        other_app_lock(self.root, host=socket.gethostname(), pid=999999)  # same PC, process gone
        self.assertTrue(self.lock("acquire")["owned"])

        other_app_lock(self.root)
        self.assertFalse(self.lock("acquire")["owned"])
        self.assertTrue(self.lock("acquire", force=True)["owned"])
        log = (self.root / "History" / "change_log.jsonl").read_text(encoding="utf-8")
        self.assertIn("project_lock_taken_over", log)

    def test_no_lock_file_means_writes_allowed(self):
        self.assertFalse(os.path.exists(self.root / ".exda.lock"))
        r = self.client.post("/save_checklist_state", json={"projectPath": str(self.root), "checklistState": {"a": True}})
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
