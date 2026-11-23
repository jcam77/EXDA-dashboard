"""EXDA-Check C2: run-folder renames are previewed, all-or-nothing and logged.

Temporary project folders only.
"""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from routes import state  # noqa: E402

PAIRS = [{"oldName": "G04-01", "newName": "G05-01"}, {"oldName": "G04-02", "newName": "G05-02"}]


class RenameRunFoldersTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_rename_test_"))
        for run in ("G04-01", "G04-02"):
            folder = self.root / "Raw_Data" / run / "DAQ-1"
            folder.mkdir(parents=True)
            (folder / "data.tpc5").write_bytes(b"x")
        (self.root / "Clean_Data" / "G04-01").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def post(self, **extra):
        return self.client.post("/rename_run_data_folders", json={"projectPath": str(self.root), "renamePairs": PAIRS, **extra})

    def raw_runs(self):
        return sorted(p.name for p in (self.root / "Raw_Data").iterdir())

    def log(self):
        path = self.root / "History" / "change_log.jsonl"
        return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    def test_dry_run_lists_moves_and_changes_nothing(self):
        body = self.post(dryRun=True).get_json()
        self.assertTrue(body["dryRun"])
        moves = {(m["root"], m["from"], m["to"], m["files"]) for m in body["planned"]}
        self.assertEqual(moves, {
            ("Raw_Data", "G04-01", "G05-01", 1),
            ("Raw_Data", "G04-02", "G05-02", 1),
            ("Clean_Data", "G04-01", "G05-01", 0),
        })
        self.assertEqual(self.raw_runs(), ["G04-01", "G04-02"])
        self.assertEqual(self.log(), [])

    def test_conflict_moves_nothing(self):
        (self.root / "Raw_Data" / "G05-02").mkdir()
        response = self.post()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.raw_runs(), ["G04-01", "G04-02", "G05-02"])
        self.assertEqual(response.get_json()["conflicts"][0]["reason"], "target_exists")

    def test_failure_part_way_rolls_back(self):
        real_move = shutil.move
        calls = {"n": 0}

        def flaky_move(src, dst):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("disk full")
            return real_move(src, dst)

        with mock.patch.object(state.shutil, "move", side_effect=flaky_move):
            response = self.post()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.raw_runs(), ["G04-01", "G04-02"])
        self.assertTrue((self.root / "Clean_Data" / "G04-01").exists())
        self.assertEqual(self.log()[-1]["kind"], "failed_rolled_back")

    def test_success_moves_all_and_logs(self):
        response = self.post(context={"oldGroup": "G04", "newGroup": "G05"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.raw_runs(), ["G05-01", "G05-02"])
        self.assertTrue((self.root / "Raw_Data" / "G05-01" / "DAQ-1" / "data.tpc5").exists())
        entry = self.log()[-1]
        self.assertEqual(entry["action"], "rename_run_folders")
        self.assertEqual(len(entry["moves"]), 3)
        self.assertEqual(entry["context"], {"oldGroup": "G04", "newGroup": "G05"})


if __name__ == "__main__":
    unittest.main()
