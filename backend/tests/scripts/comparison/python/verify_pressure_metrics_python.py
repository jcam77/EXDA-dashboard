"""Export Python pressure metrics for comparison against Octave results."""

from __future__ import annotations

import csv
from pathlib import Path
import sys

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from modules import pressure_analysis  # noqa: E402

REFERENCE_DATA_DIR = REPO_ROOT / "backend" / "tests" / "reference_data"
RESULTS_DIR = REPO_ROOT / "backend" / "tests" / "results"

INPUTS = {
    "clean_raw": REFERENCE_DATA_DIR / "experimental_data_001_clean.csv",
    "noisy_raw": REFERENCE_DATA_DIR / "experimental_data_001_noisy.csv",
    "noisy_filtered": REFERENCE_DATA_DIR / "experimental_data_001_noisy.csv",
}
OUTPUT_CSV = RESULTS_DIR / "pressure_metrics_python.csv"


def csv_to_content(path: Path) -> str:
    """Convert CSV columns to parser-compatible whitespace format."""
    data = np.loadtxt(path, delimiter=",")
    if data.ndim != 2 or data.shape[1] < 2:
        raise ValueError(f"Expected at least two columns in {path}")
    lines = [f"{float(t):.12g} {float(p):.12g}" for t, p in data[:, :2]]
    return "\n".join(lines)


def metric_row(content: str, use_raw: bool) -> dict[str, float | str]:
    """Run pressure analysis and return full-precision metrics."""
    t, val = pressure_analysis.parse_data_content(content)
    if t is None or val is None:
        raise RuntimeError("Parse Error")

    if np.max(np.abs(val)) > 1000:
        val = (val - 101325.0) / 1000.0

    if use_raw:
        t_proc, p_proc = t, val
    else:
        t_proc, p_proc = pressure_analysis.apply_butterworth(t, val, cutoff_hz=20.0, order=4)

    p_max, t_max, impulse, status = pressure_analysis.calculate_metrics(t_proc, p_proc, user_setting=0.05)
    return {
        "pMax": float(p_max),
        "tMax": float(t_max),
        "impulse": float(impulse),
        "status": str(status),
    }


def main() -> int:
    for label, path in INPUTS.items():
        if not path.exists():
            raise FileNotFoundError(f"Missing input for {label}: {path}")

    rows: list[list[str]] = []
    for series, path in INPUTS.items():
        content = csv_to_content(path)
        metrics = metric_row(content, use_raw=(series != "noisy_filtered"))
        rows.append(
            [
                series,
                f"{float(metrics['pMax']):.5f}",
                f"{float(metrics['tMax']):.5f}",
                f"{float(metrics['impulse']):.5f}",
                str(metrics["status"]),
            ]
        )

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["series", "pMax", "tMax", "impulse", "status"])
        writer.writerows(rows)

    print(f"Wrote Python pressure metrics: {OUTPUT_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
