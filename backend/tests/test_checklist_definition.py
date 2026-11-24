"""Editable checklist definition per project (Reports/checklist.json).

Temporary project folders only.
"""

import copy
import json
import shutil
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
from modules import checklist_definition as cd, project_manager  # noqa: E402

# The checklist exactly as EXDA showed it before it became editable
# ("1.1: <text>"). Older projects without Reports/checklist.json must keep
# showing exactly this; change it only with a new built-in version.
PINNED_BEFORE_EDITABLE = [
    ("Facility & Environmental Prep", "warehouse", [
        ("vent", "1.1: Ventilation system is confirmed OFF [Proc.Ref. xxx]"),
        ("hatches", "1.2: All ceiling hatches are confirmed OPEN [Proc.Ref. xxx]"),
        ("cranes", "1.3: Overhead cranes are de-energized/OFF [Proc.Ref. xxx]"),
        ("neighbors", "1.4: DBI neighbors and personnel in the area informed [Proc.Ref. xxx]"),
        ("gate", "1.5: Façade Hall gate/safety tape 'DO NOT CROSS' in place [Proc.Ref. xxx]"),
    ]),
    ("Personnel & PPE (TBT)", "hard-hat", [
        ("phones", "2.1: NO mobile phones in the Façade Hall / Safe zone storage [Proc.Ref. xxx]"),
        ("ppe", "2.2: PPE: Hearing protection, safety boots, and FR clothing verified [Proc.Ref. xxx]"),
        ("stop", "2.3: 'Say Stop' policy briefed to all involved [Proc.Ref. xxx]"),
        ("firstaid", "2.4: Nearest First Aid kit located and 2+ first aiders present [Proc.Ref. xxx]"),
        ("batteries", "2.5: Lithium-Ion batteries inspected for shape changes [Proc.Ref. xxx]"),
    ]),
    ("Hardware & Supply Line", "cog", [
        ("blocks", "3.1: Mechanical blocks (2-3 per side) secured against tunnel [Proc.Ref. xxx]"),
        ("leak", "3.2: Soapy water leakage test completed on H2 supply line [Proc.Ref. xxx]"),
        ("v7", "3.3: Valve V7 confirmed OPEN for H2 adding to protect seal [Proc.Ref. xxx]"),
        ("cylinder", "3.4: Hydrogen cylinder secured in stable position [Proc.Ref. xxx]"),
        ("fan", "3.5: ATEX fan securely fixed and grounded [Proc.Ref. xxx]"),
    ]),
    ("Systems Shakedown", "activity", [
        ("pretest", "4.1: Dry shakedown (no H2) verified for sync, cameras, and spark [Proc.Ref. xxx]"),
        ("emergency", "4.2: Action cards for Ignitor/Fan failure reviewed by team [Proc.Ref. xxx]"),
        ("sensors", "4.3: Pressure and H2 sensors zeroed and signal verified [Proc.Ref. xxx]"),
    ]),
]


def numbered(definition):
    """What the page shows: 'g.i: text' per item, as (title, icon, [(id, label)])."""
    out = []
    for g, group in enumerate(definition["groups"], start=1):
        items = [(it["id"], f"{g}.{i}: {it['text']}") for i, it in enumerate(group["items"], start=1)]
        out.append((group["title"], group["icon"], items))
    return out


class DefinitionTests(unittest.TestCase):
    def test_builtin_is_exactly_the_checklist_before_it_became_editable(self):
        self.assertEqual(numbered(cd.BUILTIN_V1), PINNED_BEFORE_EDITABLE)

    def test_new_project_template_drops_only_the_proc_ref_placeholders(self):
        for (title, icon, items), (t2, i2, items2) in zip(numbered(cd.BUILTIN_V1), numbered(cd.NEW_PROJECT_TEMPLATE)):
            self.assertEqual((title, icon), (t2, i2))
            for (iid, label), (iid2, label2) in zip(items, items2):
                self.assertEqual(iid, iid2)
                self.assertEqual(label.replace(" [Proc.Ref. xxx]", ""), label2)
        self.assertNotIn("Proc.Ref", json.dumps(cd.NEW_PROJECT_TEMPLATE))

    def test_validation(self):
        good = copy.deepcopy(cd.BUILTIN_V1)
        self.assertEqual(cd.validate(good)["groups"][0]["items"][0]["id"], "vent")

        def broken(mutate):
            data = copy.deepcopy(cd.BUILTIN_V1)
            mutate(data)
            with self.assertRaises(cd.ChecklistError):
                cd.validate(data)

        broken(lambda d: d["groups"][0]["items"].append({"id": "vent", "text": "duplicate id"}))
        broken(lambda d: d["groups"][1].update(id="facility"))  # group id used twice
        broken(lambda d: d["groups"][0]["items"].append({"id": "new-1", "text": "   "}))
        broken(lambda d: d["groups"][0].update(title=""))
        broken(lambda d: d["groups"][0].update(icon="rocket"))
        broken(lambda d: d["groups"][0]["items"].append({"id": "final_confirm", "text": "reserved"}))
        broken(lambda d: d["groups"][0]["items"].append({"id": "bad id!", "text": "x"}))
        broken(lambda d: d.update(groups="not a list"))

    def test_empty_group_and_new_group_are_allowed(self):
        data = copy.deepcopy(cd.BUILTIN_V1)
        data["groups"].append({"id": "group-x1", "title": "Extra checks", "icon": "list-checks", "items": []})
        self.assertEqual(cd.validate(data)["groups"][-1]["items"], [])


class ChecklistRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.base = Path(tempfile.mkdtemp(prefix="exda_checklist_def_"))
        self.root = self.base / "Old-Project"
        (self.root / "Reports").mkdir(parents=True)
        (self.root / "Plan").mkdir()
        project_manager.write_project_marker(str(self.root))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def get(self, root=None):
        return self.client.get("/get_checklist", query_string={"projectPath": str(root or self.root)})

    def save(self, checklist, **extra):
        return self.client.post("/save_checklist", json={"projectPath": str(self.root), "checklist": checklist, **extra})

    def test_older_project_shows_builtin_and_gets_no_file(self):
        data = self.get().get_json()
        self.assertEqual(data["source"], "builtin")
        self.assertEqual(numbered(data["checklist"]), PINNED_BEFORE_EDITABLE)
        self.assertEqual(data["version"], "")
        self.assertFalse((self.root / "Reports" / "checklist.json").exists())

    def test_new_project_gets_its_own_checklist_file(self):
        ok, _msg, path = project_manager.create_project_structure(str(self.base), "New-Project")
        self.assertTrue(ok)
        data = self.get(path).get_json()
        self.assertEqual(data["source"], "project")
        self.assertNotIn("Proc.Ref", json.dumps(data["checklist"]))

    def test_save_reload_history_and_ticks_untouched(self):
        state = self.root / "Reports" / "checklist_state.json"
        state.write_text(json.dumps({"checklistState": {"vent": True}}), encoding="utf-8")
        edited = copy.deepcopy(cd.BUILTIN_V1)
        edited["groups"][0]["items"][0]["text"] = "Ventilation OFF (renamed)"
        edited["groups"].append({"id": "group-a1", "title": "Extra checks", "icon": "list-checks",
                                 "items": [{"id": "item-a1", "text": "Camera batteries charged"}]})
        first = self.save(edited, baseVersion="")
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        data = self.get().get_json()
        self.assertEqual(data["source"], "project")
        self.assertEqual(data["version"], first.get_json()["version"])
        self.assertEqual(data["checklist"]["groups"][-1]["items"][0]["text"], "Camera batteries charged")
        self.assertEqual(data["checklist"]["groups"][0]["items"][0]["id"], "vent")  # id kept -> tick kept

        time.sleep(0.01)
        edited["groups"][-1]["title"] = "Extra"
        second = self.save(edited, baseVersion=data["version"])
        self.assertEqual(second.status_code, 200)
        history = list((self.root / "History").rglob("*checklist.json*"))
        self.assertTrue(history, "previous version kept in History/")
        self.assertIn("save_checklist", (self.root / "History" / "change_log.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(json.loads(state.read_text(encoding="utf-8")), {"checklistState": {"vent": True}})

    def test_outdated_copy_and_invalid_checklist_are_refused(self):
        self.assertEqual(self.save(cd.BUILTIN_V1, baseVersion="").status_code, 200)
        r = self.save(cd.BUILTIN_V1, baseVersion="")  # a window that never saw the first save
        self.assertEqual(r.status_code, 409)
        bad = copy.deepcopy(cd.BUILTIN_V1)
        bad["groups"][0]["items"][0]["text"] = ""
        r = self.save(bad)
        self.assertEqual(r.status_code, 400)
        self.assertIn("has no text", r.get_json()["error"])

    def test_locked_project_refuses_save(self):
        lock = {"instanceId": "someone-else", "user": "colleague", "host": "lab-pc", "pid": 1,
                "heartbeatEpoch": time.time()}
        (self.root / ".exda.lock").write_text(json.dumps(lock), encoding="utf-8")
        self.assertEqual(self.save(cd.BUILTIN_V1).status_code, 423)
        self.assertFalse((self.root / "Reports" / "checklist.json").exists())

    def test_damaged_file_is_reported_not_replaced(self):
        path = self.root / "Reports" / "checklist.json"
        path.write_text("{not json", encoding="utf-8")
        r = self.get()
        self.assertEqual(r.status_code, 422)
        self.assertIn("cannot be read", r.get_json()["error"])
        self.assertEqual(path.read_text(encoding="utf-8"), "{not json")


if __name__ == "__main__":
    unittest.main()
