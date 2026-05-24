"""Gas mixing calculations (MATLAB-equivalent H2 MFC fill model)."""

from __future__ import annotations

import numpy as np

DEFAULT_RU = 8.314462618
DEFAULT_M_H2 = 2.01588e-3  # kg/mol
DEFAULT_CHAMBER_VOLUME_M3 = 0.9 * 0.9 * 0.9
DEFAULT_T_CHAMBER_K = 293.15
DEFAULT_T_STD_K = 298.15
DEFAULT_P_STD_PA = 101325.0
DEFAULT_AMB_PRESSURE_BAR = 1.01325
DEFAULT_L_M = 0.9
DEFAULT_W_M = 0.9
DEFAULT_H_M = 0.9


def _as_1d_numeric(value, var_name: str) -> np.ndarray:
    arr = np.asarray(value if isinstance(value, (list, tuple, np.ndarray)) else [value], dtype=float).reshape(-1)
    if arr.size == 0:
        raise ValueError(f"{var_name} must not be empty")
    return arr


def _expand_to_cases(value, n_cases: int, var_name: str) -> np.ndarray:
    arr = _as_1d_numeric(value, var_name)
    if arr.size == 1:
        return np.full(n_cases, float(arr[0]), dtype=float)
    if arr.size != n_cases:
        raise ValueError(f"{var_name} must be a scalar or have the same length as H2_volPct")
    return arr.astype(float)


def _json_scalar_or_list(values):
    arr = np.asarray(values).reshape(-1)
    cleaned = [None if not np.isfinite(v) else float(v) for v in arr]
    return cleaned[0] if len(cleaned) == 1 else cleaned


def _pick_value(payload: dict, *keys, default=None):
    for key in keys:
        if key in payload and payload.get(key) is not None:
            return payload.get(key)
    return default


def calculate_h2_mfc_fill(payload: dict) -> dict:
    """Compute H2 fill results using the same model as AuxFcn_H2_MFC_FillCalculator_000."""
    h2_raw = _pick_value(payload, "H2_volPct", "targetVol")
    if h2_raw is None:
        raise ValueError("H2_volPct (or targetVol) is required")

    H2_volPct = _as_1d_numeric(h2_raw, "H2_volPct")
    n_cases = H2_volPct.size

    L_m = float(_pick_value(payload, "L_m", "lengthM", default=DEFAULT_L_M))
    W_m = float(_pick_value(payload, "W_m", "widthM", default=DEFAULT_W_M))
    H_m = float(_pick_value(payload, "H_m", "heightM", default=DEFAULT_H_M))
    Vol_Pipes_m3 = float(_pick_value(payload, "Vol_Pipes_m3", "volPipesM3", default=0.0))
    HotwireAssembly_m3 = float(_pick_value(payload, "HotwireAssembly_m3", "hotwireAssemblyM3", default=0.0))
    WeldedParts_m3 = float(_pick_value(payload, "WeldedParts_m3", "weldedPartsM3", default=0.0))
    Bolts_m3 = float(_pick_value(payload, "Bolts_m3", "boltsM3", default=0.0))

    V_chamber_geom_m3 = L_m * W_m * H_m
    V_chamber_corrected_m3 = (
        V_chamber_geom_m3
        + Vol_Pipes_m3
        + HotwireAssembly_m3
        - WeldedParts_m3
        - Bolts_m3
    )

    V_chamber_m3 = _expand_to_cases(
        _pick_value(
            payload,
            "V_chamber_m3",
            "V_chamberCorrected_m3",
            "chamberVolumeM3",
            default=V_chamber_corrected_m3 if V_chamber_corrected_m3 > 0 else DEFAULT_CHAMBER_VOLUME_M3,
        ),
        n_cases,
        "V_chamber_m3",
    )
    T_chamber_K = _expand_to_cases(
        _pick_value(payload, "T_chamber_K", "chamberTempK", default=DEFAULT_T_CHAMBER_K),
        n_cases,
        "T_chamber_K",
    )

    if payload.get("P_chamber_Pa") is not None:
        P_chamber_Pa = _expand_to_cases(payload.get("P_chamber_Pa"), n_cases, "P_chamber_Pa")
    else:
        amb_pressure_bar = _pick_value(payload, "ambPressure", default=DEFAULT_AMB_PRESSURE_BAR)
        P_chamber_Pa = _expand_to_cases(np.asarray(amb_pressure_bar, dtype=float) * 1e5, n_cases, "P_chamber_Pa")

    T_std_K = float(_pick_value(payload, "T_std_K", "stdTempK", default=DEFAULT_T_STD_K))
    P_std_Pa = float(_pick_value(payload, "P_std_Pa", "stdPressurePa", default=DEFAULT_P_STD_PA))
    MFC_setpoint_SLPM = _expand_to_cases(
        _pick_value(payload, "MFC_setpoint_SLPM", "mfcSetpointSLPM", "mfcFlowSlpm", default=np.nan),
        n_cases,
        "MFC_setpoint_SLPM",
    )
    makePlot = bool(_pick_value(payload, "makePlot", default=False))
    Ru = float(_pick_value(payload, "Ru", "ru", default=DEFAULT_RU))
    M_H2 = float(_pick_value(payload, "M_H2", "mH2", default=DEFAULT_M_H2))

    x_H2 = H2_volPct / 100.0
    if L_m <= 0 or W_m <= 0 or H_m <= 0:
        raise ValueError("L_m, W_m, H_m must be greater than zero")
    if not np.all(V_chamber_m3 > 0):
        raise ValueError("V_chamber_m3 must be greater than zero")
    if not np.all(T_chamber_K > 0):
        raise ValueError("T_chamber_K must be greater than zero")
    if T_std_K <= 0:
        raise ValueError("T_std_K must be greater than zero")
    if not np.all(P_chamber_Pa > 0):
        raise ValueError("P_chamber_Pa must be greater than zero")
    if P_std_Pa <= 0:
        raise ValueError("P_std_Pa must be greater than zero")
    if not np.all((x_H2 > 0) & (x_H2 < 1)):
        raise ValueError("All hydrogen concentrations must be between 0 and 100 vol%")
    if Ru <= 0:
        raise ValueError("Ru must be a positive scalar")
    if M_H2 <= 0:
        raise ValueError("M_H2 must be a positive scalar")

    # Ideal gas law on the full chamber mixture:
    # n_total = (P * V) / (R * T)
    n_total_mol = (P_chamber_Pa * V_chamber_m3) / (Ru * T_chamber_K)
    # Hydrogen mole fraction from target concentration (vol% -> fraction)
    n_H2_mol = x_H2 * n_total_mol
    # Convert hydrogen moles to mass (kg), then to grams for user-facing output
    m_H2_kg = n_H2_mol * M_H2
    m_H2_injected_g = 1e3 * m_H2_kg

    # H2 volume at chamber conditions (actual injected gas volume in the vessel)
    V_H2_injected_m3 = (n_H2_mol * Ru * T_chamber_K) / P_chamber_Pa
    # Equivalent H2 volume at standard conditions (used with SLPM-based MFC timing)
    V_H2_std_m3 = (n_H2_mol * Ru * T_std_K) / P_std_Pa
    # Convert key volumes to liters for reporting/operations
    V_chamber_L = 1e3 * V_chamber_m3
    V_H2_injected_L = 1e3 * V_H2_injected_m3
    V_H2_std_L = 1e3 * V_H2_std_m3
    # MFC setpoint conversion: SLPM -> m^3/s at standard conditions
    MFC_setpoint_std_m3_s = MFC_setpoint_SLPM * 1e-3 / 60.0

    # Injection/fill time derived from standard-equivalent required volume and MFC setpoint
    InjectionTime_min = np.full_like(x_H2, np.nan, dtype=float)
    InjectionTime_s = np.full_like(x_H2, np.nan, dtype=float)
    valid_setpoint = np.isfinite(MFC_setpoint_std_m3_s) & (MFC_setpoint_std_m3_s > 0)
    InjectionTime_s[valid_setpoint] = V_H2_std_m3[valid_setpoint] / MFC_setpoint_std_m3_s[valid_setpoint]
    InjectionTime_min[valid_setpoint] = InjectionTime_s[valid_setpoint] / 60.0

    result_headers = [
        "V_chamber_L",
        "T_chamber_K",
        "P_chamber_Pa",
        "H2_volPct",
        "m_H2_injected_g",
        "V_H2_injected_L",
        "V_H2_std_L",
        "MFC_setpoint_SLPM",
        "InjectionTime_s",
        "InjectionTime_min",
    ]
    result_matrix = np.column_stack([
        V_chamber_L,
        T_chamber_K,
        P_chamber_Pa,
        H2_volPct,
        m_H2_injected_g,
        V_H2_injected_L,
        V_H2_std_L,
        MFC_setpoint_SLPM,
        InjectionTime_s,
        InjectionTime_min,
    ])

    return {
        "inputs": {
            "L_m": L_m,
            "W_m": W_m,
            "H_m": H_m,
            "V_chamber_geom_m3": V_chamber_geom_m3,
            "Vol_Pipes_m3": Vol_Pipes_m3,
            "HotwireAssembly_m3": HotwireAssembly_m3,
            "WeldedParts_m3": WeldedParts_m3,
            "Bolts_m3": Bolts_m3,
            "V_chamber_corrected_m3": V_chamber_corrected_m3,
            "V_chamber_m3": _json_scalar_or_list(V_chamber_m3),
            "T_chamber_K": _json_scalar_or_list(T_chamber_K),
            "P_chamber_Pa": _json_scalar_or_list(P_chamber_Pa),
            "H2_volPct": _json_scalar_or_list(H2_volPct),
            "T_std_K": T_std_K,
            "P_std_Pa": P_std_Pa,
            "MFC_setpoint_SLPM": _json_scalar_or_list(MFC_setpoint_SLPM),
            "makePlot": makePlot,
            "Ru": Ru,
            "M_H2": M_H2,
        },
        "headers": result_headers,
        "data": result_matrix.tolist(),
        "V_chamber_m3": _json_scalar_or_list(V_chamber_m3),
        "V_chamber_geom_m3": V_chamber_geom_m3,
        "V_chamber_corrected_m3": V_chamber_corrected_m3,
        "V_chamber_L": _json_scalar_or_list(V_chamber_L),
        "T_chamber_K": _json_scalar_or_list(T_chamber_K),
        "P_chamber_Pa": _json_scalar_or_list(P_chamber_Pa),
        "H2_volPct": _json_scalar_or_list(H2_volPct),
        "H2_fraction": _json_scalar_or_list(x_H2),
        "n_H2_mol": _json_scalar_or_list(n_H2_mol),
        "m_H2_kg": _json_scalar_or_list(m_H2_kg),
        "m_H2_injected_g": _json_scalar_or_list(m_H2_injected_g),
        "V_H2_injected_m3": _json_scalar_or_list(V_H2_injected_m3),
        "V_H2_std_m3": _json_scalar_or_list(V_H2_std_m3),
        "V_H2_injected_L": _json_scalar_or_list(V_H2_injected_L),
        "V_H2_std_L": _json_scalar_or_list(V_H2_std_L),
        "MFC_setpoint_SLPM": _json_scalar_or_list(MFC_setpoint_SLPM),
        "InjectionTime_s": _json_scalar_or_list(InjectionTime_s),
        "InjectionTime_min": _json_scalar_or_list(InjectionTime_min),
        "FillTime_s": _json_scalar_or_list(InjectionTime_s),
        "FillTime_min": _json_scalar_or_list(InjectionTime_min),
        "model": "AuxFcn_H2_MFC_FillCalculator_000 (Python equivalent)",
    }
