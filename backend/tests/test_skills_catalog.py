"""Team list of technical skills (EXDA-Projects/exda-skills.json). Temporary folders only."""

import json
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
from modules import project_description as pd  # noqa: E402
from modules import skills_catalog as sc  # noqa: E402


class SkillsCatalogTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="exda_skills_test_"))
        self.env = mock.patch.dict(os.environ, {"EXDA_PROJECTS_ROOT": str(self.root)})
        self.env.start()
        self.client = flask_app.test_client()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def test_default_list_is_used_without_writing_a_file(self):
        data = self.client.get("/skills_catalog").get_json()
        self.assertEqual(data["source"], "default")
        self.assertIn("CFD (OpenFOAM)", sc.skill_names(data["catalog"]))
        self.assertFalse((self.root / sc.CATALOG_FILENAME).exists())

    def test_default_names_are_unique(self):
        names = [n.lower() for n in sc.skill_names(sc.default_catalog())]
        self.assertEqual(len(names), len(set(names)))

    def test_adding_a_skill_writes_the_list_with_who_and_when(self):
        res = self.client.post("/add_skill_to_catalog", json={"name": "  Schlieren   imaging ", "category": "instrumentation and daq"})
        self.assertTrue(res.get_json()["success"])
        saved = json.loads((self.root / sc.CATALOG_FILENAME).read_text(encoding="utf-8"))
        category = next(c for c in saved["categories"] if c["name"] == "Instrumentation and DAQ")
        added = category["skills"][-1]
        self.assertEqual(added["name"], "Schlieren imaging")
        self.assertTrue(added["addedBy"])
        self.assertTrue(added["addedAt"])
        # the built-in skills are all still there
        for name in sc.skill_names(sc.default_catalog()):
            self.assertIn(name, sc.skill_names(saved))
        self.assertEqual(self.client.get("/skills_catalog").get_json()["source"], "file")

    def test_a_new_category_can_be_made(self):
        self.client.post("/add_skill_to_catalog", json={"name": "Laser diagnostics", "category": "Optics"})
        saved = json.loads((self.root / sc.CATALOG_FILENAME).read_text(encoding="utf-8"))
        self.assertEqual(saved["categories"][-1]["name"], "Optics")

    def test_duplicates_and_empty_names_are_refused(self):
        res = self.client.post("/add_skill_to_catalog", json={"name": "cfd (openfoam)", "category": "Optics"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Numerical simulation", res.get_json()["error"])
        self.assertEqual(self.client.post("/add_skill_to_catalog", json={"name": " ", "category": "Optics"}).status_code, 400)
        self.assertEqual(self.client.post("/add_skill_to_catalog", json={"name": "X", "category": ""}).status_code, 400)
        self.assertFalse((self.root / sc.CATALOG_FILENAME).exists())

    def test_a_damaged_list_is_reported_not_replaced(self):
        path = self.root / sc.CATALOG_FILENAME
        path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.client.get("/skills_catalog").status_code, 500)
        self.assertEqual(self.client.post("/add_skill_to_catalog", json={"name": "A", "category": "B"}).status_code, 400)
        self.assertEqual(path.read_text(encoding="utf-8"), "{not json")

    def test_technical_skills_is_a_standard_capability_field(self):
        field = next(f for f in pd.STANDARD_FIELDS if f["id"] == "technical_skills")
        self.assertEqual(field["catalog"], "skills")
        self.assertIn("technical_skills", pd.CAPABILITY_FIELD_IDS)
        clean = pd.validate({"standard": {"technical_skills": ["CFD (OpenFOAM)", "cfd (openfoam)", "Own skill"]}})
        # names outside the list are kept (a project shared from another team stays intact)
        self.assertEqual(clean["standard"]["technical_skills"], ["CFD (OpenFOAM)", "Own skill"])


if __name__ == "__main__":
    unittest.main()
