"""EXDA-Check B6 (H2S logs) and B7 (BGA units). Never writes under Projects/."""

import glob
import hashlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import app as flask_app  # noqa: E402
from modules import data_parser, h2s_parser  # noqa: E402

WK27 = REPO_ROOT / "Projects" / "VH2D-Project-Wk-27-2026"

DEVICE_HEADER = "Device address\tDevice ID\tFactory Device ID\tFirmware\tMeasurement mode\tGain\tSpeed\tY_AH_Cal (-)\tTF_Cal (V/W)\tTemp_Cal (°C)\t\t\t"
DEVICE_VALUES = "FF46\tD2\t12J692\t C3.8\tH2   \t1.005\tNorm \t 0.999466\t21.182169\t23.924849\t\t"
COLUMNS = "Iteration\tTime\tOutput (%)\tTsens (°C)\tAlarm\t\t"


def block(rows):
    lines = [DEVICE_HEADER, DEVICE_VALUES, COLUMNS]
    lines += [f"{i}\t{t}\t{v}\t27.1\t0" for i, (t, v) in enumerate(rows)]
    return lines


def write_latin1(path, lines):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes("\r\n".join(lines).encode("latin-1") + b"\r\n")


class H2SParserTests(unittest.TestCase):
    def test_two_recordings_are_split_not_joined(self):
        text = "\r\n".join(
            block([("16:18:45.67", "0.04"), ("16:18:45.97", "0.05")])
            + block([("16:56:43.83", "1.20"), ("16:56:44.13", "1.30"), ("16:56:44.43", "1.25")])
        )
        blocks = h2s_parser.parse_h2s_text(text)
        self.assertEqual([b["rowCount"] for b in blocks], [2, 3])
        self.assertEqual(blocks[1]["timeStart"], "16:56:43.83")
        self.assertAlmostEqual(blocks[1]["elapsed"][-1], 0.6, places=6)
        self.assertEqual(blocks[0]["device"]["Factory Device ID"], "12J692")
        self.assertEqual(blocks[0]["device"]["TF_Cal (V/W)"], "21.182169")
        self.assertEqual(blocks[0]["columns"][0], {"label": "Output (%)", "name": "Output", "unit": "%"})
        with self.assertRaisesRegex(h2s_parser.H2SParseError, "2 recordings"):
            h2s_parser.select_block(blocks)
        self.assertIs(h2s_parser.select_block(blocks, 1), blocks[1])

    def test_empty_first_recording_and_duplicates(self):
        rows = [("10:00:00.00", "0.1"), ("10:00:00.30", "0.2")]
        blocks = h2s_parser.parse_h2s_text("\r\n".join(block([]) + block(rows) + block(rows)))
        summaries = h2s_parser.block_summaries(blocks)
        self.assertTrue(summaries[0]["empty"])
        self.assertEqual(summaries[2]["duplicateOf"], 1)
        with self.assertRaisesRegex(h2s_parser.H2SParseError, "2 recordings"):
            h2s_parser.select_block(blocks)

    def test_midnight_rollover_and_content(self):
        blocks = h2s_parser.parse_h2s_text("\r\n".join(block([("23:59:59.90", "1"), ("00:00:00.20", "2")])))
        self.assertAlmostEqual(blocks[0]["elapsed"][1], 0.3, places=6)
        content = h2s_parser.block_to_content(blocks[0])
        self.assertTrue(content.startswith("time [s],Output [%],Tsens [°C],Alarm"))
        t, y, names, err = data_parser.parse_multichannel_content(content)
        self.assertIsNone(err)
        self.assertEqual(names[0], "Output [%]")


class H2SEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = flask_app.test_client()
        self.project = Path(tempfile.mkdtemp(prefix="exda_h2s_test_"))
        first = [("16:18:45.67", "0.04"), ("16:18:45.97", "0.05")]
        write_latin1(self.project / "Raw_Data" / "R-07" / "H2S" / "a.txt", block(first))
        write_latin1(self.project / "Raw_Data" / "R-08" / "H2S" / "b.txt",
                     block(first) + block([("16:56:43.83", "1.2"), ("16:56:44.13", "1.3")]))

    def tearDown(self):
        shutil.rmtree(self.project, ignore_errors=True)

    def test_read_requires_a_choice_and_flags_copy_from_other_run(self):
        q = {"projectPath": str(self.project), "path": "Raw_Data/R-08/H2S/b.txt"}
        r = self.client.get("/read_project_file", query_string=q)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(len(r.get_json()["h2sBlocks"]), 2)
        r = self.client.get("/read_project_file", query_string={**q, "block": "1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["h2sBlock"], 1)
        self.assertEqual(len(r.get_json()["content"].splitlines()), 3)
        info = self.client.get("/h2s_blocks", query_string=q).get_json()
        self.assertEqual(info["blocks"][0]["identicalElsewhere"], ["Raw_Data/R-07/H2S/a.txt (recording 1)"])
        self.assertEqual(info["blocks"][1]["identicalElsewhere"], [])


class BgaUnitTests(unittest.TestCase):
    def test_conc_tc_is_labelled_ppm_and_logged_stamps_kept(self):
        content = "\n".join([
            "Title;", "Time;Conc5_TC",
            "01.07.2026 16:59:54;166161.31",
            "01.07.2026 16:59:55;169141.5",
            "01.07.2026 16:59:55;169200.0",   # repeated second
            "01.07.2026 16:59:57;170440.06",  # skipped second
        ])
        t, y, names, err = data_parser.parse_multichannel_content(content)
        self.assertIsNone(err)
        self.assertEqual(list(t), [0.0, 1.0, 1.0, 3.0])
        self.assertEqual(list(y[:, 0]), [166161.31, 169141.5, 169200.0, 170440.06])
        r = flask_app.test_client().post("/preview_multichannel", json={"content": content, "maxPoints": 100})
        channel = r.get_json()["channels"][0]
        self.assertEqual((channel["unit"], channel["role"]), ("ppm", "concentration"))
        self.assertIn("ppm", channel["unitSource"])


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@unittest.skipUnless((WK27 / "Raw_Data").is_dir(), "week-27 raw data not present")
class Week27H2STests(unittest.TestCase):
    def test_all_week27_h2s_files_load_and_multiblock_files_are_split(self):
        files = sorted(glob.glob(str(WK27 / "Raw_Data" / "*" / "H2S" / "*.txt")))
        self.assertGreater(len(files), 0)
        before = {f: _sha(f) for f in files}
        multi = {}
        for path in files:
            blocks = h2s_parser.parse_h2s_text(h2s_parser.read_text(path))
            self.assertTrue(any(b["rowCount"] > 0 for b in blocks), path)
            self.assertTrue(all(b["skippedRows"] == 0 for b in blocks), path)
            if len(blocks) > 1:
                multi[os.path.basename(path)] = len(blocks)
        for run in ("G01-08", "G01-017", "G05-01", "G05-06"):
            self.assertTrue(any(run in name for name in multi), f"{run} should have several recordings")
        self.assertEqual({f: _sha(f) for f in files}, before)


if __name__ == "__main__":
    unittest.main()
