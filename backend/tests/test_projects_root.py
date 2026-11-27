"""Default projects folder: projects live outside the app folder.

Temporary folders only; the app root is patched to a fake app folder.
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
from routes import projects as projects_routes  # noqa: E402


class ProjectsRootTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_root_test_"))
        self.app_dir = self.base / "EXDA-dashboard"
        self.app_dir.mkdir()
        self.patch = mock.patch.object(projects_routes, "_app_root", return_value=str(self.app_dir))
        self.patch.start()
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("EXDA_PROJECTS_ROOT", None)

    def tearDown(self):
        self.env.stop()
        self.patch.stop()
        shutil.rmtree(self.base, ignore_errors=True)

    def test_folder_beside_the_app_is_the_default(self):
        beside = self.base / "EXDA-Projects"
        (beside / "Week-27").mkdir(parents=True)
        self.assertEqual(projects_routes._projects_root_default(), str(beside))
        data = flask_app.test_client().get("/list_directories").get_json()
        self.assertTrue(data["success"])
        self.assertEqual([d["name"] for d in data["directories"]], ["Week-27"])

    def test_environment_setting_wins(self):
        (self.base / "EXDA-Projects").mkdir()
        os.environ["EXDA_PROJECTS_ROOT"] = str(self.base / "elsewhere")
        self.assertEqual(projects_routes._projects_root_default(), str(self.base / "elsewhere"))

    def test_projects_folder_is_created_next_to_the_app(self):
        root = projects_routes._projects_root_default()
        self.assertEqual(root, str(self.base / "EXDA-Projects"))
        self.assertTrue((self.base / "EXDA-Projects").is_dir())
        self.assertFalse((self.app_dir / "Projects").exists())

    def test_empty_app_projects_folder_is_not_used(self):
        (self.app_dir / "Projects").mkdir()
        (self.app_dir / "Projects" / ".DS_Store").write_text("", encoding="utf-8")
        self.assertEqual(projects_routes._projects_root_default(), str(self.base / "EXDA-Projects"))

    def test_older_installations_keep_their_projects_inside_the_app(self):
        old = self.app_dir / "Projects" / "Week-27"
        (old / "Plan").mkdir(parents=True)
        (old / "Plan" / "Experiment_Plan_v000.json").write_text("{}", encoding="utf-8")
        self.assertEqual(projects_routes._projects_root_default(), str(self.app_dir / "Projects"))
        # Nothing is moved and no empty EXDA-Projects appears that would hide them.
        self.assertFalse((self.base / "EXDA-Projects").exists())
        self.assertTrue((old / "Plan" / "Experiment_Plan_v000.json").is_file())

    def test_projects_inside_the_app_folder_are_reported(self):
        (self.app_dir / "Projects" / "Week-27").mkdir(parents=True)
        data = flask_app.test_client().get("/list_directories").get_json()
        self.assertTrue(data["insideAppFolder"])
        self.assertEqual(data["recommendedProjectsRoot"], str(self.base / "EXDA-Projects"))

    def test_projects_next_to_the_app_are_not_reported(self):
        (self.base / "EXDA-Projects").mkdir()
        data = flask_app.test_client().get("/list_directories").get_json()
        self.assertFalse(data["insideAppFolder"])

    def test_a_folder_with_a_similar_name_is_not_inside_the_app(self):
        sibling = self.base / "EXDA-dashboard-old"
        sibling.mkdir()
        self.assertFalse(projects_routes._is_inside_app_folder(str(sibling)))


class ProjectFoldersTests(unittest.TestCase):
    """Standard project folders, including Procedures/ for safety documents."""

    PROCEDURES = ("Procedures/RAMS", "Procedures/RAMS-Appendices", "Procedures/SOPs", "Procedures/Other-Procedures")

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_folders_test_"))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_new_project_has_procedures_folders(self):
        from modules import project_manager

        ok, _msg, path = project_manager.create_project_structure(str(self.base), "New-Campaign")
        self.assertTrue(ok)
        for sub in self.PROCEDURES:
            self.assertTrue((Path(path) / sub).is_dir(), sub)

    def test_opening_older_project_adds_empty_procedures_and_keeps_files(self):
        from modules import project_manager

        old = self.base / "Old-Campaign"
        (old / "Plan").mkdir(parents=True)
        plan = old / "Plan" / "Experiment_Plan_v000.json"
        plan.write_text('{"planName": "Old"}', encoding="utf-8")
        (old / "Procedures" / "SOPs").mkdir(parents=True)
        sop = old / "Procedures" / "SOPs" / "SOP-01.pdf"
        sop.write_bytes(b"%PDF-1.4 existing")

        ok, _msg = project_manager.initialize_project_structure(str(old))
        self.assertTrue(ok)
        for sub in self.PROCEDURES:
            self.assertTrue((old / sub).is_dir(), sub)
        self.assertEqual(plan.read_text(encoding="utf-8"), '{"planName": "Old"}')
        self.assertEqual(sop.read_bytes(), b"%PDF-1.4 existing")
        self.assertEqual([p.name for p in (old / "Procedures" / "RAMS").iterdir()], [])

    def test_standard_folder_names_alone_do_not_make_a_project(self):
        from modules import project_manager

        (self.base / "P" / "Procedures").mkdir(parents=True)
        (self.base / "P" / "Reports").mkdir()
        self.assertFalse(project_manager.is_project_folder(str(self.base / "P")))

    def test_new_project_has_the_marker_file(self):
        from modules import project_manager

        ok, _msg, path = project_manager.create_project_structure(str(self.base), "Marked")
        self.assertTrue(ok)
        marker = project_manager.read_project_marker(path)
        self.assertEqual(marker["schema"], "exda-project/1")
        self.assertEqual(marker["name"], "Marked")
        self.assertTrue(project_manager.is_project_folder(path))


if __name__ == "__main__":
    unittest.main()
