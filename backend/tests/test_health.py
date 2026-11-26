"""The launchers check /exda_health to be sure EXDA (not another program) answers."""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app import app as flask_app  # noqa: E402


class HealthTests(unittest.TestCase):
    def test_health_identifies_exda(self):
        res = flask_app.test_client().get("/exda_health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["app"], "EXDA")

    def test_default_port_avoids_macos_airplay(self):
        env = (REPO_ROOT / "config" / "exda-defaults.env").read_text(encoding="utf-8")
        port = next(line.split("=", 1)[1].strip() for line in env.splitlines()
                    if line.startswith("EXDA_DEFAULT_BACKEND_PORT="))
        self.assertNotIn(port, {"5000", "7000"})  # used by AirPlay Receiver on macOS


if __name__ == "__main__":
    unittest.main()
