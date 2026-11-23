"""Read-only consistency report for gas mixing records (EXDA-Check item 7).

This module only inspects data it is given. It never writes, corrects or
migrates anything: inconsistencies are reported, not repaired.

Checks per gas mixing record:
- inputs_mismatch:     a stored input differs from the input the saved results
                       were calculated with (results.inputs)
- possible_default_p:  chamber pressure exactly 101325 Pa
- possible_default_t:  chamber temperature exactly 293.15 K / 20.00 °C
- missing_rh:          relative humidity missing
- calibration_mismatch: calibrationApplied = Yes but mH2InjectedG differs from
                       a*x + b computed with the record's own a and b
- results_missing:     no saved calculation results

Checks per plan run:
- possible_default_p0 / possible_default_t0: plan P0 exactly 101325 Pa or
  T0 exactly 293.15 K.
"""

from __future__ import annotations

import csv
import re
import io

KELVIN_OFFSET = 273.15
STANDARD_P_PA = 101325.0
STANDARD_T_K = 293.15

# (record key, results.inputs key, label, unit)
_COMPARED_INPUTS = [
    ("targetVol", "H2_volPct", "Target H2", "vol.%"),
    ("pChamberPa", "P_chamber_Pa", "Chamber pressure", "Pa"),
    ("tChamberK", "T_chamber_K", "Chamber temperature", "K"),
    ("mfcFlowSlpm", "MFC_setpoint_SLPM", "MFC setpoint", "SLPM"),
    ("lM", "L_m", "Length L", "m"),
    ("wM", "W_m", "Width W", "m"),
    ("hM", "H_m", "Height H", "m"),
    ("volPipesM3", "Vol_Pipes_m3", "Pipes volume", "m3"),
    ("hotwireAssemblyM3", "HotwireAssembly_m3", "Hotwire assembly volume", "m3"),
    ("weldedPartsM3", "WeldedParts_m3", "Welded parts volume", "m3"),
    ("boltsM3", "Bolts_m3", "Bolts volume", "m3"),
]

REPORT_COLUMNS = ["source", "group", "runName", "check", "field", "stored", "expected", "detail"]


def _num(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (list, tuple)):
        value = value[0] if len(value) == 1 else None
        if value is None:
            return None
    try:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        number = float(text)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _same(a, b, rel=1e-9):
    if a is None or b is None:
        return a is b
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


def _stored_t_k(record):
    """Stored chamber temperature in K (tChamberK, else tChamberC + 273.15)."""
    kelvin = _num(record.get("tChamberK"))
    if kelvin is not None:
        return kelvin
    celsius = _num(record.get("tChamberC"))
    return None if celsius is None else celsius + KELVIN_OFFSET


def _issue(source, record, check, field="", stored="", expected="", detail=""):
    return {
        "source": source,
        "group": str(record.get("group") or "").strip(),
        "runName": str(record.get("runName") or record.get("name") or "").strip(),
        "check": check,
        "field": field,
        "stored": "" if stored is None else str(stored),
        "expected": "" if expected is None else str(expected),
        "detail": detail,
    }


def check_gas_records(records):
    issues = []
    for record in records or []:
        if not isinstance(record, dict):
            continue
        results = record.get("results") if isinstance(record.get("results"), dict) else None
        inputs = results.get("inputs") if results and isinstance(results.get("inputs"), dict) else None

        if not results:
            issues.append(_issue("gas_mixing", record, "results_missing",
                                 detail="No saved calculation results."))
        elif not inputs:
            issues.append(_issue("gas_mixing", record, "inputs_mismatch", "results.inputs",
                                 detail="Saved results have no recorded calculation inputs."))
        else:
            for record_key, input_key, label, unit in _COMPARED_INPUTS:
                stored = _stored_t_k(record) if record_key == "tChamberK" else _num(record.get(record_key))
                used = _num(inputs.get(input_key))
                if stored is None and used is None:
                    continue
                if not _same(stored, used):
                    issues.append(_issue(
                        "gas_mixing", record, "inputs_mismatch", record_key, stored, used,
                        f"{label}: stored {stored if stored is not None else '(missing)'} {unit}, "
                        f"results calculated with {used if used is not None else '(missing)'} {unit}.",
                    ))

        pressure = _num(record.get("pChamberPa"))
        if pressure is not None and _same(pressure, STANDARD_P_PA, rel=0):
            issues.append(_issue("gas_mixing", record, "possible_default_p", "pChamberPa", record.get("pChamberPa"),
                                 detail="Chamber pressure is exactly 101325 Pa (possibly a default, not a measurement)."))
        t_k = _stored_t_k(record)
        t_c = _num(record.get("tChamberC"))
        if (t_k is not None and abs(t_k - STANDARD_T_K) < 1e-9) or (t_c is not None and abs(t_c - 20.0) < 1e-9):
            issues.append(_issue("gas_mixing", record, "possible_default_t", "tChamberK",
                                 record.get("tChamberK") or record.get("tChamberC"),
                                 detail="Chamber temperature is exactly 293.15 K / 20.00 °C (possibly a default)."))

        if _num(record.get("relativeHumidityPct")) is None:
            issues.append(_issue("gas_mixing", record, "missing_rh", "relativeHumidityPct",
                                 record.get("relativeHumidityPct"), detail="Relative humidity is missing."))

        if str(record.get("calibrationApplied") or "").strip().lower() == "yes":
            a = _num(record.get("calibrationA"))
            b = _num(record.get("calibrationB"))
            target = _num(record.get("targetVol"))
            injected = _num(record.get("mH2InjectedG"))
            basis = str(record.get("calibrationTargetBasis") or "fraction_0_1").strip()
            if None in (a, b, target):
                issues.append(_issue("gas_mixing", record, "calibration_mismatch", "calibrationA/B",
                                     detail="Calibration marked as applied but a, b or target is missing."))
            else:
                x = target / 100.0 if basis == "fraction_0_1" else target
                expected = a * x + b
                if injected is None or abs(injected - expected) > 1e-6:
                    issues.append(_issue(
                        "gas_mixing", record, "calibration_mismatch", "mH2InjectedG", injected, expected,
                        f"mH2InjectedG = {injected} g, but a·x + b with the record's a = {a}, b = {b}, "
                        f"x = {x} gives {expected} g.",
                    ))
    return issues


def check_plan_runs(experiments):
    issues = []
    for experiment in experiments or []:
        if not isinstance(experiment, dict):
            continue
        meta = experiment.get("meta") if isinstance(experiment.get("meta"), dict) else {}
        p0 = _num(meta.get("p0"))
        if p0 is not None and _same(p0, STANDARD_P_PA, rel=0):
            issues.append(_issue("plan", experiment, "possible_default_p0", "p0", meta.get("p0"),
                                 detail="Plan P0 is exactly 101325 Pa (possibly a default, not a measurement)."))
        t0 = _num(meta.get("t0"))
        if t0 is not None and abs(t0 - STANDARD_T_K) < 1e-9:
            issues.append(_issue("plan", experiment, "possible_default_t0", "t0", meta.get("t0"),
                                 detail="Plan T0 is exactly 293.15 K (possibly a default)."))
    return issues


RUN_GROUP_RE = re.compile(r"^(.*)-(\d+)(?:-[Rr]\d+)?$")


def run_group(name):
    match = RUN_GROUP_RE.match(str(name or "").strip())
    return match.group(1) if match else str(name or "").strip()


def check_plan_meta(plan_meta, experiments):
    """Group objectives that belong to no run group (e.g. left over from a rename)."""
    issues = []
    objectives = (plan_meta or {}).get("groupObjectives") if isinstance(plan_meta, dict) else None
    if not isinstance(objectives, dict):
        return issues
    groups = {run_group(e.get("name")) for e in experiments or [] if isinstance(e, dict)}
    for key in sorted(objectives):
        if key not in groups:
            issues.append(_issue("plan", {"group": key}, "orphan_group_objective", "meta.groupObjectives", key,
                                 detail=f"Group objective '{key}' matches no run group in the plan "
                                        "(possibly left over from a group rename). Not changed."))
    return issues


def build_report(gas_records, plan_experiments, plan_meta=None):
    issues = check_gas_records(gas_records) + check_plan_runs(plan_experiments) + check_plan_meta(plan_meta, plan_experiments)
    summary = {}
    for issue in issues:
        summary[issue["check"]] = summary.get(issue["check"], 0) + 1
    return {
        "issues": issues,
        "summary": summary,
        "recordsChecked": len([r for r in gas_records or [] if isinstance(r, dict)]),
        "planRunsChecked": len([e for e in plan_experiments or [] if isinstance(e, dict)]),
    }


def report_to_csv(report) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=REPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for issue in report.get("issues", []):
        writer.writerow(issue)
    return buffer.getvalue()
