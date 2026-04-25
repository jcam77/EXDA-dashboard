"""Export Python EWT peak metrics for comparison against Octave results."""

from __future__ import annotations

import csv
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from modules import ewt_analysis

REFERENCE_DATA_DIR = REPO_ROOT / "backend" / "tests" / "reference_data"
RESULTS_DIR = REPO_ROOT / "backend" / "tests" / "results"
INPUT_CSV = REFERENCE_DATA_DIR / "experimental_data_001_noisy.csv"
OUTPUT_CSV = RESULTS_DIR / "ewt_peak_metrics_python.csv"


def csv_to_content(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> int:
    if not ewt_analysis.HAS_EWT:
        raise RuntimeError("Python ewtpy package is not available. Install ewtpy before running EWT alignment export.")
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Missing EWT input fixture: {INPUT_CSV}")

    content = csv_to_content(INPUT_CSV)
    result = ewt_analysis.analyze_ewt_content(content, num_modes=5, max_points=2000, knee_modes=8)
    if result.get("error"):
        raise RuntimeError(f"EWT analysis failed: {result['error']}")

    rows = result.get("energy") or []
    if not rows:
        raise RuntimeError("EWT analysis returned no energy rows.")

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["mode", "peak_hz", "energy_pct"])
        for row in rows:
            writer.writerow(
                [
                    int(row.get("mode", 0)),
                    f"{float(row.get('peakHz', 0.0)):.5f}",
                    f"{float(row.get('pct', 0.0)):.5f}",
                ]
            )

    print(f"Wrote Python EWT reference: {OUTPUT_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
