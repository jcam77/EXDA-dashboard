#!/usr/bin/env python3
"""Build the synthetic demo projects used for the user guide screenshots and videos.

Everything is synthetic (example names, serials and signals); no real
experiment data is used, because the guide is published with the app.

Usage (from the repository root):
  python3 docs/EXDA-User-Guide/tools/make_demo_project.py <output folder>

Creates <output folder>/EXDA-Projects/ with:
  VH2D-Demo-2026/                 the main demo project (3 runs done, 2 planned)
  EMP2X-Demo/VH2D-Demo-Wk22-2026  an earlier project in a group folder (its
  EMP2X-Demo/VH2D-Demo-Wk27-2026  description feeds the term suggestions)
An existing output folder is replaced.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from modules import gas_mixing, project_manager, project_store  # noqa: E402

try:
    import h5py
except Exception:  # pragma: no cover
    h5py = None

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover
    fitz = None

MAIN = "VH2D-Demo-2026"
FS_HZ = 200_000.0
T_START, T_END = -0.5, 1.5
CHANNELS = [("P1", "bar"), ("P2", "bar"), ("P3", "bar"), ("P4", "bar"), ("P5", "bar"), ("Trigger", "V")]
RUNS = [
    # name, H2 vol.%, planned date, done, peak bar, error note
    ("VH2D-Demo-G01-01", "16", "2026-12-01", True, 0.205, ""),
    ("VH2D-Demo-G01-02", "16", "2026-12-01", True, 0.198, ""),
    ("VH2D-Demo-G01-03", "16", "2026-12-02", True, 0.211, "DAQ-2 trigger not recorded (DAQ-1 complete)"),
    ("VH2D-Demo-G02-01", "20", "2026-12-03", False, 0.0, ""),
    ("VH2D-Demo-G02-02", "20", "2026-12-03", False, 0.0, ""),
]
CONDITIONS = {  # measured values per done run: p0 Pa, T0 °C, RH %
    "VH2D-Demo-G01-01": (100900, 18.6, 46),
    "VH2D-Demo-G01-02": (100850, 19.1, 47),
    "VH2D-Demo-G01-03": (100700, 20.4, 51),
}
GEOMETRY = {"lM": "0.9", "wM": "0.9", "hM": "0.9", "volPipesM3": "0.067",
            "hotwireAssemblyM3": "0", "weldedPartsM3": "0", "boltsM3": "0"}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    project_store.write_json_atomic(str(path), payload)


def pressure_trace(t, peak_bar, rng, delay):
    """Vented deflagration-like trace (gauge, bar): rise to a peak, ringing, decay, noise."""
    tp = 0.170 + delay
    rise = peak_bar * np.exp(-((t - tp) / 0.012) ** 2)
    ring = np.where(t > tp, 0.25 * peak_bar * np.exp(-(t - tp) / 0.03) * np.sin(2 * np.pi * 120 * (t - tp)), 0.0)
    drift = 0.004 * np.sin(2 * np.pi * 0.6 * t)
    noise = rng.normal(0.0, 0.0025, t.size)
    return rise + ring + drift + noise


def write_tpc5(path: Path, peak_bar: float, seed: int) -> list[str]:
    """Synthetic TraNET-style TPC5 file: 5 pressure channels (bar) and a trigger (V)."""
    if h5py is None:
        raise SystemExit("h5py is needed to write the demo TPC5 files (pip install h5py).")
    rng = np.random.default_rng(seed)
    n = int(round((T_END - T_START) * FS_HZ))
    t = T_START + np.arange(n) / FS_HZ
    trigger_sample = int(round(-T_START * FS_HZ))
    path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(path, "w") as handle:
        for index, (name, unit) in enumerate(CHANNELS, start=1):
            if unit == "V":
                values = np.where(t >= 0.0, 5.0, 0.0) + rng.normal(0, 0.01, n)
                volt_to_physical = 1.0
            else:
                ratio = [1.0, 0.48, 0.32, 0.41, 0.05][index - 1]
                values = pressure_trace(t, peak_bar * ratio, rng, delay=0.002 * index)
                if name == "P5":
                    values[np.searchsorted(t, 1.25)] = 1.6 * peak_bar  # late electrical spike
                volt_to_physical = 0.1  # 0.1 bar per volt
            bin_to_volt = 10.0 / 32768.0
            raw = np.clip(np.round(values / volt_to_physical / bin_to_volt), -32768, 32767).astype(np.int16)
            channel = handle.create_group(f"measurements/00000001/channels/{index:08d}")
            channel.attrs["name"] = f"{name}"
            channel.attrs["physicalUnit"] = unit
            channel.attrs["binToVoltFactor"] = bin_to_volt
            channel.attrs["binToVoltConstant"] = 0.0
            channel.attrs["voltToPhysicalFactor"] = volt_to_physical
            channel.attrs["voltToPhysicalConstant"] = 0.0
            block = channel.create_group("blocks/00000001")
            block.attrs["sampleRateHertz"] = FS_HZ
            block.attrs["triggerSample"] = trigger_sample
            block.attrs["triggerTimeSeconds"] = 0.0
            block.create_dataset("raw", data=raw)
    return [name for name, _ in CHANNELS]


def write_bga(path: Path, target_vol: float, start: datetime, seed: int) -> None:
    """Synthetic BGA log: three sampling points, concentration in ppm, one row per second."""
    rng = np.random.default_rng(seed)
    lines = ["Title;", "Time;Conc1_TC;Conc2_TC;Conc3_TC"]
    target_ppm = target_vol * 10_000
    for second in range(0, 600, 1):
        approach = 1 - np.exp(-second / 90)
        values = [target_ppm * approach * f + rng.normal(0, 120) for f in (1.0, 0.995, 1.004)]
        stamp = (start + timedelta(seconds=second)).strftime("%d.%m.%Y %H:%M:%S")
        lines.append(stamp + ";" + ";".join(f"{v:.2f}" for v in values))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_pdf(path: Path, title: str, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fitz is None:
        path.write_bytes(b"%PDF-1.4\n% placeholder\n")
        return
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 90), title, fontsize=18)
    for i, line in enumerate(lines):
        page.insert_text((72, 130 + 18 * i), line, fontsize=11)
    page.insert_text((72, 760), "Synthetic example document for the EXDA user guide.", fontsize=9)
    doc.save(str(path))
    doc.close()


def gas_record(group, run, target, p0, t0_c, rh, flow):
    t0_k = t0_c + 273.15
    payload = {"H2_volPct": target, "P_chamber_Pa": p0, "T_chamber_K": t0_k, "MFC_setpoint_SLPM": flow,
               "L_m": GEOMETRY["lM"], "W_m": GEOMETRY["wM"], "H_m": GEOMETRY["hM"],
               "Vol_Pipes_m3": GEOMETRY["volPipesM3"], "HotwireAssembly_m3": "0", "WeldedParts_m3": "0",
               "Bolts_m3": "0", "T_std_K": 298.15, "P_std_Pa": 101325, "Ru": 8.314462618, "M_H2": 2.01588e-3}
    results = gas_mixing.calculate_h2_mfc_fill(payload)
    return {
        "group": group, "runName": run, "targetVol": str(target), "relativeHumidityPct": str(rh),
        "pChamberPa": str(p0), "tChamberC": f"{t0_c:.1f}", "tChamberK": f"{t0_k:.2f}", "mfcFlowSlpm": str(flow),
        **GEOMETRY, "tStdC": "25.00", "tStdK": "298.15", "pStdPa": "101325", "ru": "8.314462618", "mH2": "2.01588e-3",
        "mH2InjectedG": f"{results['m_H2_injected_g']:.4f}", "vH2StdL": f"{results['V_H2_std_L']:.3f}",
        "vChamberCorrectedM3": f"{results['V_chamber_corrected_m3']:.5f}", "vChamberL": f"{results['V_chamber_L']:.2f}",
        "vH2InjectedL": f"{results['V_H2_injected_L']:.3f}", "injectionTimeS": f"{results['InjectionTime_s']:.1f}",
        "injectionTimeMin": f"{results['InjectionTime_min']:.3f}", "calibrationEnabled": "no",
        "results": results, "notes": "", "updatedAt": "2026-12-01 09:30:00",
    }


def build_main(projects: Path) -> None:
    ok, msg, root = project_manager.create_project_structure(str(projects), MAIN)
    if not ok:
        raise SystemExit(msg)
    root = Path(root)

    experiments, records = [], []
    for index, (name, h2, date, done, peak, error) in enumerate(RUNS):
        group = name.rsplit("-", 1)[0]
        data_files = []
        p0, t0, rh = CONDITIONS.get(name, ("", "", ""))
        if done:
            write_tpc5(root / "Raw_Data" / name / "DAQ-1" / f"{name}-DAQ-1.tpc5", peak, seed=index)
            write_bga(root / "Raw_Data" / name / "H2BGA" / f"H2BGA-{name}.csv", float(h2),
                      datetime(2026, 12, 1, 9 + index, 5, 0), seed=10 + index)
            data_files = [f"{name}/DAQ-1/{name}-DAQ-1.tpc5", f"{name}/H2BGA/H2BGA-{name}.csv"]
            records.append(gas_record(group, name, float(h2), p0, t0, rh, 20))
        else:
            (root / "Raw_Data" / name).mkdir(parents=True, exist_ok=True)
        experiments.append({
            "id": 1781000000000 + index, "name": name, "done": done,
            "notes": "Cables: DAQ-1 10 m." if done else "",
            "meta": {
                "h2": h2, "h2InjectedGrams": records[-1]["mH2InjectedG"] if done else "",
                "mfcFlowSlpm": "20", "p0": str(p0) if done else "", "t0": f"{t0 + 273.15:.2f}" if done else "",
                "ignition": "Back Wall", "vent": "Thin film", "plannedDate": date, "plannedDay": "",
                "isPreparation": False, "hasError": bool(error), "errorNote": error,
                "isCanceled": False, "canceledNote": "", "shortDescription": "", "dataFiles": data_files,
                "cfdHash": "", "recircStopToIgnitionSec": "300" if done else "",
            },
        })

    write_json(root / "Plan" / "Experiment_Plan_v000.json", {
        "planName": "Experiment_Plan_v000",
        "experiments": experiments,
        "meta": {
            "objective": "Vented H2 deflagrations, 16 and 20 vol.% H2, back-wall ignition",
            "description": "Example campaign for the user guide: peak over-pressure and its development for two "
                           "hydrogen concentrations with a thin-film vent.",
            "startDate": "2026-12-01", "deadline": "2026-12-05", "status": "active",
            "groupObjectives": {"VH2D-Demo-G01": "Baseline, 16 vol.% H2", "VH2D-Demo-G02": "Higher concentration, 20 vol.% H2"},
        },
    })
    write_json(root / "Plan" / "project_description.json", {
        "schema": "exda-project-description/1",
        "standard": {
            "research_questions": "How does the hydrogen concentration change the peak over-pressure of a vented deflagration?",
            "methods": ["vented explosion"], "measured_quantities": ["pressure", "H2 concentration"],
            "facility": ["VH2D chamber"], "fuels": ["H2-air"], "scale_conditions": "",
            "partners": [], "keywords": [],
        },
        "extra": [],
        "updatedAt": "2026-12-01 08:00:00",
    })
    write_json(root / "Reports" / "daq_systems.json", {"updatedAt": "2026-12-01 08:10:00", "daqSystems": [
        {"id": "daq-1", "name": "DAQ-1", "measuredQuantity": "pressure", "vendor": "Example Instruments",
         "model": "TR-2000", "serialNumber": "EX-1001", "samplingRateHz": "200000", "channelCount": "8",
         "owner": "LU", "lastCalibrationDate": "2026-06-01", "calibrationCertificateId": "CAL-EX-01",
         "location": "Control room", "isActive": True, "notes": ""},
        {"id": "daq-bga", "name": "H2BGA", "measuredQuantity": "concentration", "vendor": "Example Gas",
         "model": "BGA-3", "serialNumber": "EX-2001", "samplingRateHz": "1", "channelCount": "3",
         "owner": "LU", "lastCalibrationDate": "2026-05-15", "calibrationCertificateId": "CAL-EX-02",
         "location": "Gas cabinet", "isActive": True, "notes": ""},
    ]})
    sensors = []
    for i, (name, unit) in enumerate(CHANNELS, start=1):
        trigger = unit == "V"
        sensors.append({
            "id": f"s{i}", "sensorId": name, "measuredQuantity": "trigger" if trigger else "pressure",
            "daqSystem": "DAQ-1", "daqChannel": f"A{i}", "manufacturer": "Example Sensors",
            "model": "" if trigger else "PZ-10", "serialNumber": "" if trigger else f"EX-P{i:03d}",
            "sensitivity": "" if trigger else "-10.2", "sensitivityUnit": "" if trigger else "pC/bar",
            "locationLabel": "Ignition trigger" if trigger else f"Wall {i}", "x": "" if trigger else f"{0.15 * i:.2f}",
            "y": "" if trigger else "0.45", "z": "" if trigger else "0.90", "coordinateUnit": "m",
            "coordinateOrigin": "Chamber corner", "mountingMethod": "" if trigger else "Flush mount",
            "triggerMethod": "TTL" if trigger else "", "calibrationDate": "" if trigger else "2026-06-01",
            "calibrationCertificateId": "", "isActive": True, "isBlindSensor": False, "notes": "",
        })
    mappings = {"VH2D-Demo-G01": sensors, "VH2D-Demo-G02": [dict(s) for s in sensors]}
    write_json(root / "Reports" / "sensors_mapping.json", {
        "updatedAt": "2026-12-01 08:20:00", "selectedGroup": "VH2D-Demo-G01",
        "groupNotes": {"VH2D-Demo-G01": "Same sensor layout for all runs.", "VH2D-Demo-G02": ""},
        "mappingsByGroup": mappings,
    })
    camera = {"id": "c1", "cameraId": "CAM-1", "cameraType": "High-speed", "customCameraType": "",
              "model": "HS-500 (example)", "serialNumber": "EX-C001", "frameRate": "10000", "resolution": "1024 x 512",
              "shutterSpeed": "1/20000", "aperture": "f/2.8", "iso": "", "lensFocalLength": "50 mm",
              "fieldOfView": "Whole chamber, side view", "whiteBalance": "", "emissivity": "", "temperatureRange": "",
              "methodUsed": "Direct imaging", "customMethodUsed": "", "triggerMode": "External", "customTriggerMode": "",
              "triggerSource": "Ignition TTL", "customTriggerSource": "", "synchronizationNotes": "Same TTL as DAQ-1",
              "calibrationReference": "", "mountingLocation": "Side window", "x": "1.5", "coordinateUnit": "m",
              "coordinateOrigin": "Chamber corner", "isActive": True, "notes": ""}
    write_json(root / "Reports" / "cameras_mapping.json", {
        "updatedAt": "2026-12-01 08:25:00", "selectedGroup": "VH2D-Demo-G01", "groupNotes": {},
        "mappingsByGroup": {"VH2D-Demo-G01": [camera], "VH2D-Demo-G02": [dict(camera)]},
    })
    write_json(root / "Reports" / "gas_mixing.json", {
        "updatedAt": "2026-12-02 11:00:00",
        "verificationMeta": {"isMatlabVerified": True, "verificationRefFileA": "", "verificationRefFileB": ""},
        "dosageModel": {"enabled": False, "modelType": "linear_targetVol_to_mass", "targetBasis": "fraction_0_1",
                        "a": "", "b": "0", "notes": ""},
        "selectedGroup": "VH2D-Demo-G01", "selectedRunName": "VH2D-Demo-G01-01", "records": records,
    })
    write_pdf(root / "Procedures" / "RAMS" / "RAMS-VH2D-Demo.pdf", "Risk assessment and method statement",
              ["1. Scope of the test campaign", "2. Hazards and controls", "3. Emergency arrangements"])
    write_pdf(root / "Procedures" / "SOPs" / "SOP-01-Gas-filling.pdf", "SOP-01 Gas filling",
              ["1. Check the chamber is closed", "2. Start the MFC", "3. Monitor the BGA reading"])
    write_pdf(root / "Procedures" / "RAMS-Appendices" / "Appendix-A-Emergency-card.pdf", "Appendix A: Emergency card",
              ["Emergency stop: control desk", "Assembly point: car park"])


def build_group(projects: Path) -> None:
    group = projects / "EMP2X-Demo"
    group.mkdir(parents=True, exist_ok=True)
    for name, terms in (
        ("VH2D-Demo-Wk22-2026", {"methods": ["vented explosion", "DAQ characterisation"],
                                 "measured_quantities": ["pressure", "flame arrival"]}),
        ("VH2D-Demo-Wk27-2026", {"methods": ["vented explosion"], "measured_quantities": ["pressure", "H2 concentration"]}),
    ):
        ok, msg, root = project_manager.create_project_structure(str(group), name)
        if not ok:
            raise SystemExit(msg)
        write_json(Path(root) / "Plan" / "project_description.json", {
            "schema": "exda-project-description/1",
            "standard": {"research_questions": "", "methods": terms["methods"],
                         "measured_quantities": terms["measured_quantities"], "facility": ["VH2D chamber"],
                         "fuels": ["H2-air"], "scale_conditions": "", "partners": ["LU", "DBI"], "keywords": ["P2X"]},
            "extra": [], "updatedAt": "2026-06-01 08:00:00",
        })


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    out = Path(sys.argv[1]).resolve()
    projects = out / "EXDA-Projects"
    if projects.exists():
        shutil.rmtree(projects)
    projects.mkdir(parents=True)
    build_main(projects)
    build_group(projects)
    print(projects)


if __name__ == "__main__":
    main()
