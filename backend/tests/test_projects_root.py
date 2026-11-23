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

    def test_older_installations_keep_the_app_projects_folder(self):
        self.assertEqual(projects_routes._projects_root_default(), str(self.app_dir / "Projects"))


if __name__ == "__main__":
    unittest.main()
