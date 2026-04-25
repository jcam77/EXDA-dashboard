"""Generate clean/noisy reference CSV pairs for cross-platform filter validation."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[5]
DEFAULT_INPUT = (
    REPO_ROOT / "Projects" / "VH2D-Project" / "Raw_Data" / "expData" / "FMG" / "Pressure" / "Experimental_Data_001.csv"
)
DEFAULT_OUTDIR = REPO_ROOT / "backend" / "tests" / "reference_data"


def build_noisy_signal(t: np.ndarray, y: np.ndarray, seed: int, freqs_hz: list[float]) -> np.ndarray:
    """Apply deterministic multi-frequency sinusoidal + stochastic noise."""
    rng = np.random.default_rng(seed)
    phases = rng.uniform(0.0, 2.0 * math.pi, size=len(freqs_hz))
    base_amp = max(float(np.std(y)) * 0.25, 1e-4)

    noise = np.zeros_like(y, dtype=float)
    for idx, (freq_hz, phase) in enumerate(zip(freqs_hz, phases)):
        noise += (base_amp / (idx + 1)) * np.sin(2.0 * math.pi * freq_hz * t + phase)
    noise += 0.05 * base_amp * rng.standard_normal(len(y))
    return y + noise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to source CSV (time,pressure).")
    parser.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR, help="Output directory for generated reference data.")
    parser.add_argument("--seed", type=int, default=20260218, help="Random seed for deterministic noise.")
    parser.add_argument(
        "--freqs",
        type=float,
        nargs="+",
        default=[35.0, 70.0, 120.0],
        help="Noise frequencies (Hz) added to the source signal.",
    )
    args = parser.parse_args()

    input_path = args.input.resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    data = np.loadtxt(input_path, delimiter=",")
    if data.ndim != 2 or data.shape[1] < 2:
        raise ValueError(f"Expected at least 2 columns in {input_path}")

    t = data[:, 0]
    y = data[:, 1]
    y_noisy = build_noisy_signal(t, y, seed=args.seed, freqs_hz=list(args.freqs))

    outdir = args.outdir.resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    clean_path = outdir / "experimental_data_001_clean.csv"
    noisy_path = outdir / "experimental_data_001_noisy.csv"
    meta_path = outdir / "experimental_data_001_noisy_metadata.json"

    np.savetxt(clean_path, np.column_stack([t, y]), delimiter=",", fmt="%.12g")
    np.savetxt(noisy_path, np.column_stack([t, y_noisy]), delimiter=",", fmt="%.12g")
    meta = {
        "source": str(input_path),
        "seed": args.seed,
        "frequencies_hz": list(args.freqs),
        "rows": int(len(t)),
        "columns": ["time", "pressure"],
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"Wrote clean reference: {clean_path}")
    print(f"Wrote noisy reference: {noisy_path}")
    print(f"Wrote metadata:       {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
