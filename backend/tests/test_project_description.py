"""Project description (Plan/project_description.json): standard fields stay
comparable across projects, extra fields are per project, saves are safe.

Temporary folders only.
"""

import json
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import project_description as pd  # noqa: E402
from modules import project_manager  # noqa: E402


def sample(**standard):
    return {"standard": standard, "extra": []}


class ValidateTests(unittest.TestCase):
    def test_empty_description_has_every_standard_field(self):
        clean = pd.validate({})
        self.assertEqual(list(clean["standard"]), list(pd.FIELD_IDS))
        self.assertEqual(clean["standard"]["methods"], [])
        self.assertEqual(clean["standard"]["research_questions"], "")

    def test_tags_are_trimmed_and_deduplicated_ignoring_case(self):
        clean = pd.validate(sample(measured_quantities=["  pressure ", "Pressure", "flame  arrival", ""]))
        self.assertEqual(clean["standard"]["measured_quantities"], ["pressure", "flame arrival"])

    def test_standard_fields_cannot_be_invented(self):
        with self.assertRaises(pd.DescriptionError):
            pd.validate(sample(my_own_field="x"))

    def test_extra_fields_need_unique_names_that_differ_from_standard_ones(self):
        ok = pd.validate({"extra": [{"id": "vent", "label": "Vent configuration", "value": " 0.5 m2 "}]})
        self.assertEqual(ok["extra"], [{"id": "vent", "label": "Vent configuration", "value": "0.5 m2"}])
        for extra in (
            [{"id": "a", "label": "", "value": ""}],
            [{"id": "a", "label": "Ignition", "value": ""}, {"id": "b", "label": "ignition", "value": ""}],
            [{"id": "a", "label": "Methods", "value": ""}],
            [{"id": "methods", "label": "Something", "value": ""}],
            [{"id": "bad id!", "label": "Something", "value": ""}],
        ):
            with self.assertRaises(pd.DescriptionError, msg=extra):
                pd.validate({"extra": extra})


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.base = Path(tempfile.mkdtemp(prefix="exda_description_test_"))
        self.root = self.base / "Campaign"
        (self.root / "Plan").mkdir(parents=True)
        project_manager.write_project_marker(str(self.root))
        self.file = self.root / "Plan" / "project_description.json"

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def get(self, root=None):
        return self.client.get("/get_project_description", query_string={"projectPath": str(root or self.root)})

    def save(self, description, base_version=None, root=None):
        body = {"projectPath": str(root or self.root), "description": description}
        if base_version is not None:
            body["baseVersion"] = base_version
        return self.client.post("/save_project_description", json=body)

    def test_new_project_shows_empty_fields_without_writing_a_file(self):
        data = self.get().get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["source"], "empty")
        self.assertEqual(data["version"], "")
        self.assertEqual([f["id"] for f in data["fields"]], list(pd.FIELD_IDS))
        self.assertFalse(self.file.exists())

    def test_save_reload_and_history(self):
        first = self.save(sample(methods=["vented explosion"]), base_version="").get_json()
        self.assertTrue(first["success"])
        second = self.save(sample(methods=["vented explosion", "DAQ characterisation"]),
                           base_version=first["version"]).get_json()
        self.assertTrue(second["success"])
        data = self.get().get_json()
        self.assertEqual(data["description"]["standard"]["methods"], ["vented explosion", "DAQ characterisation"])
        self.assertEqual(json.loads(self.file.read_text(encoding="utf-8"))["schema"], pd.SCHEMA)
        kept = list((self.root / "History" / "Plan__project_description.json").iterdir())
        self.assertEqual(len(kept), 1, "the first version is kept in History/")
        log = (self.root / "History" / "change_log.jsonl").read_text(encoding="utf-8")
        self.assertIn("save_project_description", log)

    def test_outdated_copy_is_refused(self):
        first = self.save(sample(keywords=["P2X"]), base_version="").get_json()
        self.save(sample(keywords=["P2X", "venting"]), base_version=first["version"])
        stale = self.save(sample(keywords=["old"]), base_version=first["version"])
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.get().get_json()["description"]["standard"]["keywords"], ["P2X", "venting"])

    def test_locked_project_refuses_save(self):
        lock = {"instanceId": "someone-else", "user": "colleague", "host": "lab-pc", "pid": 1,
                "heartbeatEpoch": time.time()}
        (self.root / ".exda.lock").write_text(json.dumps(lock), encoding="utf-8")
        self.assertEqual(self.save(sample(keywords=["x"])).status_code, 423)
        self.assertFalse(self.file.exists())

    def test_damaged_file_is_reported_not_replaced(self):
        self.file.write_text("{not json", encoding="utf-8")
        response = self.get()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.file.read_text(encoding="utf-8"), "{not json")

    def test_invalid_description_is_refused(self):
        response = self.save(sample(unknown=["x"]))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.file.exists())

    def test_ordinary_folder_is_refused(self):
        plain = self.base / "Not-A-Project"
        plain.mkdir()
        self.assertEqual(self.get(plain).status_code, 400)
        self.assertEqual(self.save(sample(), root=plain).status_code, 400)

    def test_suggestions_come_from_other_projects_most_used_first(self):
        other_a = self.base / "Other-A"
        other_b = self.base / "Other-B"
        for other, quantities in ((other_a, ["pressure", "flame arrival"]), (other_b, ["Pressure"])):
            (other / "Plan").mkdir(parents=True)
            project_manager.write_project_marker(str(other))
            self.assertTrue(self.save(sample(measured_quantities=quantities), root=other).get_json()["success"])
        self.save(sample(measured_quantities=["only in the current project"]))
        with mock.patch("routes.project_description._projects_root_default", return_value=str(self.base / "none")):
            data = self.client.get("/project_description_suggestions",
                                   query_string={"projectPath": str(self.root)}).get_json()
        self.assertEqual(data["suggestions"]["measured_quantities"],
                         [{"value": "pressure", "count": 2}, {"value": "flame arrival", "count": 1}])
        self.assertEqual(data["projectsSearched"], 2)

    def test_projects_list_can_search_description_values(self):
        self.save({"standard": {"facility": ["VH2D chamber"]},
                   "extra": [{"id": "x1", "label": "Ignition source", "value": "spark"}]})
        data = self.client.get("/list_projects", query_string={"path": str(self.base)}).get_json()
        text = data["projects"][0]["descriptionText"]
        for word in ("VH2D chamber", "Ignition source", "spark"):
            self.assertIn(word, text)


class PlanFilesStayPlansTests(unittest.TestCase):
    """The description lives in Plan/ but is never taken for the experiment plan."""

    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_plan_vs_description_"))
        (self.root / "Plan").mkdir()
        project_manager.write_project_marker(str(self.root))
        plan = {"planName": "Experiment_Plan_v000", "meta": {"objective": "Real objective"},
                "experiments": [{"id": 1, "done": True}, {"id": 2, "done": False}]}
        (self.root / "Plan" / "Experiment_Plan_v000.json").write_text(json.dumps(plan), encoding="utf-8")
        time.sleep(0.05)
        # Saved after the plan, so it is the newest file in Plan/.
        self.client.post("/save_project_description", json={"projectPath": str(self.root), "description": sample(keywords=["P2X"])})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_overview_reads_the_plan_not_the_newer_description(self):
        summary = project_manager.get_project_plan_summary(str(self.root))
        self.assertEqual(summary["plan_name"], "Experiment_Plan_v000")
        self.assertEqual(summary["experiments_total"], 2)
        self.assertEqual(summary["objective"], "Real objective")

    def test_plan_list_leaves_out_the_description(self):
        data = self.client.get("/list_plan_files", query_string={"projectPath": str(self.root)}).get_json()
        names = [item.get("name") or item.get("fileName") or item for item in data["files"]]
        self.assertTrue(any("Experiment_Plan_v000" in str(name) for name in names), names)
        self.assertFalse(any("project_description" in str(name) for name in names), names)

    def test_non_plan_names_match_the_description_module(self):
        self.assertIn(pd.DESCRIPTION_FILENAME, project_manager.NON_PLAN_FILENAMES)


if __name__ == "__main__":
    unittest.main()
