"""Raw_Data and Literature listings give paths relative to their folder with
"/" on every operating system, so plans saved on macOS/Linux ("run/DAQ-1/x")
match the files listed on Windows. Temporary folders only.
"""

import ntpath
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


class RawDataListingTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="exda_rawlist_test_"))
        self.root = self.base / "Campaign"
        (self.root / "Plan").mkdir(parents=True)
        project_manager.write_project_marker(str(self.root))
        run = self.root / "Raw_Data" / "VH2D-G00-02" / "DAQ-1"
        run.mkdir(parents=True)
        (run / "VH2D-G00-02-DAQ-1.tpc5").write_bytes(b"x")
        (run / "._VH2D-G00-02-DAQ-1.tpc5").write_bytes(b"mac metadata")
        lit = self.root / "Literature" / "Venting"
        lit.mkdir(parents=True)
        (lit / "paper.pdf").write_bytes(b"%PDF")
        self.client = flask_app.test_client()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_raw_data_paths_use_forward_slashes(self):
        data = self.client.get("/list_raw_data", query_string={"projectPath": str(self.root)}).get_json()
        self.assertEqual(data["files"], ["VH2D-G00-02/DAQ-1/VH2D-G00-02-DAQ-1.tpc5"])

    def test_windows_separators_are_converted(self):
        # Simulate Windows: relpath answers with backslashes and os.sep is "\\".
        with mock.patch("routes.state.os.sep", "\\"), \
                mock.patch("routes.state.os.path.relpath",
                           side_effect=lambda path, start: ntpath.join(*Path(path).relative_to(start).parts)):
            data = self.client.get("/list_raw_data", query_string={"projectPath": str(self.root)}).get_json()
        self.assertEqual(data["files"], ["VH2D-G00-02/DAQ-1/VH2D-G00-02-DAQ-1.tpc5"])

    def test_literature_paths_use_forward_slashes(self):
        data = self.client.get("/list_research_pdfs", query_string={"projectPath": str(self.root)}).get_json()
        self.assertEqual(data["files"], ["Venting/paper.pdf"])


if __name__ == "__main__":
    unittest.main()
