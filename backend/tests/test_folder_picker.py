"""Folder picker and project search.

- The picker's folder list never gets stuck (fallback=nearest).
- Pages listing projects never mistake another folder for the projects folder.
- Projects are found inside group folders (a bigger project with several campaigns).

Temporary folders only.
"""

import os
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
from modules import project_manager  # noqa: E402
from routes import projects as projects_routes  # noqa: E402


class ListDirectoriesTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_picker_test_"))
        (self.base / "Campaign-A").mkdir()
        (self.base / "Campaign-B").mkdir()
        (self.base / ".hidden").mkdir()
        (self.base / "notes.txt").write_text("x", encoding="utf-8")
        self.client = flask_app.test_client()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def get(self, path):
        return self.client.get("/list_directories", query_string={"path": path, "fallback": "nearest"}).get_json()

    def test_lists_only_visible_subfolders(self):
        data = self.get(str(self.base))
        self.assertTrue(data["success"])
        self.assertEqual([d["name"] for d in data["directories"]], ["Campaign-A", "Campaign-B"])
        self.assertEqual(data["parent"], str(self.base.parent))
        self.assertEqual(data["notice"], "")

    def test_project_folders_are_marked(self):
        project_manager.write_project_marker(str(self.base / "Campaign-B"))
        data = self.get(str(self.base))
        self.assertEqual({d["name"]: d["isProject"] for d in data["directories"]},
                         {"Campaign-A": False, "Campaign-B": True})
        self.assertFalse(data["isProject"])
        self.assertTrue(self.get(str(self.base / "Campaign-B"))["isProject"])

    def test_missing_folder_shows_nearest_existing_parent(self):
        data = self.get(str(self.base / "Campaign-A" / "gone" / "deeper"))
        self.assertTrue(data["success"])
        self.assertEqual(data["path"], str(self.base / "Campaign-A"))
        self.assertIn("Folder not found", data["notice"])

    def test_missing_default_projects_folder_falls_back_to_home(self):
        with mock.patch.object(projects_routes, "_projects_root_default", return_value=str(self.base / "nope")):
            data = self.get("")
        self.assertTrue(data["success"])
        self.assertEqual(data["path"], os.path.abspath(os.path.expanduser("~")))
        self.assertEqual(data["notice"], "")

    def test_without_fallback_a_missing_folder_is_not_found(self):
        res = self.client.get("/list_directories", query_string={"path": str(self.base / "gone")})
        self.assertEqual(res.status_code, 404)
        with mock.patch.object(projects_routes, "_projects_root_default", return_value=str(self.base / "nope")):
            res = self.client.get("/list_directories")
        self.assertEqual(res.status_code, 404)

    def test_quick_places_exist_and_include_projects_folder(self):
        with mock.patch.object(projects_routes, "_projects_root_default", return_value=str(self.base)):
            data = self.get(str(self.base))
        places = data["quickPlaces"]
        self.assertEqual(places[0], {"label": "EXDA projects", "path": str(self.base), "kind": "projects"})
        self.assertTrue(all(os.path.isdir(p["path"]) for p in places))
        self.assertEqual(len({os.path.normcase(p["path"]) for p in places}), len(places))


class ListProjectsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="exda_projects_test_"))
        self.make_project("Direct-Campaign")
        self.make_project("EMP2X-Experiments/VH2D-Project-Wk-22-2026")
        self.make_project("EMP2X-Experiments/VH2D-Project-Wk-27-2026")
        self.make_project("Programme/Phase-1/Campaign-3")   # 3 folders below the root: found
        self.make_project("A/B/C/Too-Deep")                 # 4 folders below the root: not searched
        self.make_project("Direct-Campaign/Plan/Nested-Inside-Project")
        (self.root / "Empty-Group").mkdir()
        (self.root / "Lookalike" / "Reports").mkdir(parents=True)        # standard names only: not a project
        (self.root / "Older-Campaign" / "Plan").mkdir(parents=True)       # made before the marker existed
        (self.root / "Older-Campaign" / "Plan" / "Experiment_Plan_v000.json").write_text("{}", encoding="utf-8")
        (self.root / ".hidden-group").mkdir()
        self.client = flask_app.test_client()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make_project(self, rel):
        (self.root / rel / "Plan").mkdir(parents=True, exist_ok=True)
        project_manager.write_project_marker(str(self.root / rel))

    def test_finds_projects_in_root_and_in_groups(self):
        data = self.client.get("/list_projects", query_string={"path": str(self.root)}).get_json()
        self.assertTrue(data["success"])
        found = [(p["group"], p["name"]) for p in data["projects"]]
        self.assertEqual(found, [
            ("", "Direct-Campaign"),
            ("EMP2X-Experiments", "VH2D-Project-Wk-22-2026"),
            ("EMP2X-Experiments", "VH2D-Project-Wk-27-2026"),
            ("", "Older-Campaign"),
            ("Programme/Phase-1", "Campaign-3"),
        ])
        for project in data["projects"]:
            self.assertTrue(project["status"])
        # The older project is recognised once and gets the marker file.
        self.assertIsNotNone(project_manager.read_project_marker(str(self.root / "Older-Campaign")))
        self.assertFalse((self.root / "Lookalike" / "exda-project.json").exists())

    def test_a_project_folder_itself_lists_only_itself(self):
        data = self.client.get("/list_projects", query_string={"path": str(self.root / "Direct-Campaign")}).get_json()
        self.assertEqual([(p["group"], p["name"]) for p in data["projects"]], [("", "Direct-Campaign")])

    def test_group_folders_are_left_untouched(self):
        self.client.get("/list_projects", query_string={"path": str(self.root)})
        self.assertEqual(sorted(p.name for p in (self.root / "EMP2X-Experiments").iterdir()),
                         ["VH2D-Project-Wk-22-2026", "VH2D-Project-Wk-27-2026"])
        self.assertEqual(list((self.root / "Empty-Group").iterdir()), [])

    def test_missing_root_is_not_found(self):
        res = self.client.get("/list_projects", query_string={"path": str(self.root / "gone")})
        self.assertEqual(res.status_code, 404)


class OpenProjectPathTests(unittest.TestCase):
    """Opening a folder never turns it into a project without confirmation."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_open_test_"))
        self.client = flask_app.test_client()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def open(self, path, **extra):
        return self.client.post("/open_project_path", json={"projectPath": str(path), **extra})

    def test_ordinary_folder_asks_first_and_stays_untouched(self):
        folder = self.base / "EMP2X-Experiments"
        (folder / "Campaign-1" / "Plan").mkdir(parents=True)
        res = self.open(folder)
        self.assertEqual(res.status_code, 409)
        self.assertTrue(res.get_json()["needsSetup"])
        self.assertEqual([p.name for p in folder.iterdir()], ["Campaign-1"])

    def test_confirmed_setup_creates_the_project_folders(self):
        folder = self.base / "New-Campaign"
        folder.mkdir()
        res = self.open(folder, createStructure=True)
        self.assertTrue(res.get_json()["success"])
        for sub in ("Plan", "Raw_Data", "Reports", "Procedures/SOPs"):
            self.assertTrue((folder / sub).is_dir(), sub)

    def test_existing_project_opens_and_gets_missing_folders(self):
        project = self.base / "Old-Campaign"
        (project / "Plan").mkdir(parents=True)
        (project / "Plan" / "Experiment_Plan_v000.json").write_text("{}", encoding="utf-8")
        res = self.open(project)
        self.assertTrue(res.get_json()["success"])
        self.assertTrue((project / "Procedures" / "RAMS").is_dir())
        self.assertIsNotNone(project_manager.read_project_marker(str(project)))


class ProjectMarkerTests(unittest.TestCase):
    """Only a genuine EXDA marker file makes a folder a project."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_marker_test_"))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_same_name_with_other_contents_does_not_count(self):
        for content in ('{"name": "something else"}', '{"schema": "exda-project/1"}', "not json", "[]"):
            (self.base / "exda-project.json").write_text(content, encoding="utf-8")
            self.assertFalse(project_manager.is_project_folder(str(self.base)), content)

    def test_existing_file_with_that_name_is_never_overwritten(self):
        (self.base / "exda-project.json").write_text("someone else's file", encoding="utf-8")
        self.assertFalse(project_manager.write_project_marker(str(self.base)))
        self.assertEqual((self.base / "exda-project.json").read_text(encoding="utf-8"), "someone else's file")

    def test_each_project_gets_its_own_id(self):
        a, b = self.base / "A", self.base / "B"
        a.mkdir()
        b.mkdir()
        project_manager.write_project_marker(str(a))
        project_manager.write_project_marker(str(b))
        self.assertNotEqual(project_manager.read_project_marker(str(a))["projectId"],
                            project_manager.read_project_marker(str(b))["projectId"])


if __name__ == "__main__":
    unittest.main()
