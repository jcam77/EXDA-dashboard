"""Procedures/ listing and opening project items (Checklist safety procedures card).

Temporary project folders only. Opening is replaced by a stub, so no program
is started by the tests.
"""

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
from modules import procedures, project_manager  # noqa: E402


def touch(path: Path, data: bytes = b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class ProceduresListingTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="exda_proc_test_"))
        project_manager.initialize_project_structure(str(self.root))
        self.proc = self.root / "Procedures"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_documents_grouped_by_section_and_folder_with_formats(self):
        touch(self.proc / "SOPs" / "H2VD-SOP-002.pdf")
        touch(self.proc / "SOPs" / "H2VD-SOP-002.docx")
        touch(self.proc / "RAMS" / "H2VD-RAMS-Draft-003.pdf")
        touch(self.proc / "RAMS-Appendices" / "Appendix C — Risk Table" / "VH2D-RAMS-000.xlsx")
        touch(self.proc / "RAMS-Appendices" / "Appendix A — Chamber" / "Assembly.pdf")

        result = procedures.list_procedures(str(self.root))
        self.assertTrue(result["exists"])
        self.assertEqual(result["fileCount"], 5)
        docs = [(d["section"], d["group"], d["name"], [f["format"] for f in d["files"]]) for d in result["documents"]]
        self.assertEqual(docs, [
            ("RAMS", "", "H2VD-RAMS-Draft-003", ["PDF"]),
            ("RAMS-Appendices", "Appendix A — Chamber", "Assembly", ["PDF"]),
            ("RAMS-Appendices", "Appendix C — Risk Table", "VH2D-RAMS-000", ["XLSX"]),
            ("SOPs", "", "H2VD-SOP-002", ["PDF", "DOCX"]),  # PDF first: previewable
        ])
        sop = result["documents"][-1]["files"][0]
        self.assertEqual(sop["path"], "Procedures/SOPs/H2VD-SOP-002.pdf")
        self.assertTrue(sop["previewable"])

    def test_backup_lock_and_hidden_files_are_not_listed(self):
        touch(self.proc / "SOPs" / "SOP.pdf")
        touch(self.proc / "SOPs" / "SOP" / "Backup of SOP.docx")
        touch(self.proc / "SOPs" / "~$SOP.docx")
        touch(self.proc / "SOPs" / "._SOP.pdf")
        touch(self.proc / "SOPs" / ".DS_Store")
        result = procedures.list_procedures(str(self.root))
        self.assertEqual([d["name"] for d in result["documents"]], ["SOP"])
        self.assertEqual(result["fileCount"], 1)

    def test_empty_and_missing_folder(self):
        self.assertEqual(procedures.list_procedures(str(self.root))["documents"], [])
        shutil.rmtree(self.proc)
        result = procedures.list_procedures(str(self.root))
        self.assertFalse(result["exists"])
        self.assertEqual(result["documents"], [])

    def test_listing_changes_nothing(self):
        f = touch(self.proc / "RAMS" / "R.pdf", b"%PDF-1.4 data")
        before = sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*"))
        procedures.list_procedures(str(self.root))
        after = sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*"))
        self.assertEqual(before, after)
        self.assertEqual(f.read_bytes(), b"%PDF-1.4 data")


class ProceduresRoutesTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.root = Path(tempfile.mkdtemp(prefix="exda_proc_route_"))
        project_manager.initialize_project_structure(str(self.root))
        touch(self.root / "Procedures" / "SOPs" / "SOP-1.pdf", b"%PDF-1.4")
        self.outside = Path(tempfile.mkdtemp(prefix="exda_outside_"))
        touch(self.outside / "secret.txt")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.outside, ignore_errors=True)

    def test_list_route(self):
        data = self.client.get("/list_procedures", query_string={"projectPath": str(self.root)}).get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["documents"][0]["files"][0]["path"], "Procedures/SOPs/SOP-1.pdf")

    def test_preview_and_download_use_project_file_route(self):
        r = self.client.get("/project_artifact_file", query_string={"projectPath": str(self.root), "path": "Procedures/SOPs/SOP-1.pdf"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.mimetype, "application/pdf")
        r.close()
        r = self.client.get("/project_artifact_file", query_string={"projectPath": str(self.root),
                                                                    "path": "Procedures/SOPs/SOP-1.pdf", "download": "1"})
        self.assertIn("attachment", r.headers.get("Content-Disposition", ""))
        r.close()

    def test_open_item_inside_project(self):
        with mock.patch.object(project_manager, "open_folder", return_value=(True, "Opened")) as opener:
            r = self.client.post("/open_project_item", json={"projectPath": str(self.root), "path": "Procedures/SOPs/SOP-1.pdf"})
            self.assertEqual(r.status_code, 200)
            opener.assert_called_once()
            self.assertTrue(opener.call_args[0][0].endswith("Procedures/SOPs/SOP-1.pdf"))
            r = self.client.post("/open_project_item", json={"projectPath": str(self.root), "path": "Procedures"})
            self.assertEqual(r.status_code, 200)

    def test_open_item_outside_project_is_refused(self):
        with mock.patch.object(project_manager, "open_folder", return_value=(True, "Opened")) as opener:
            for path in (str(self.outside / "secret.txt"), "../" + self.outside.name + "/secret.txt"):
                r = self.client.post("/open_project_item", json={"projectPath": str(self.root), "path": path})
                self.assertEqual(r.status_code, 403, path)
            r = self.client.post("/open_project_item", json={"projectPath": str(self.root), "path": "Procedures/nope.pdf"})
            self.assertEqual(r.status_code, 404)
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
