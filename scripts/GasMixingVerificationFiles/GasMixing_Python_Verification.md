# Gas Mixing Python Verification (MATLAB Reference)

This document explains how the EXDA Python gas-mixing calculation is verified against the MATLAB reference implementation in this same folder:

- `H2_MFC_Fill_Calculator_v000.m`
- `AuxFcn_H2_MFC_FillCalculator_000.m`

Python implementation:

- `backend/modules/gas_mixing.py`
- Main function: `calculate_h2_mfc_fill(payload)`

## 1) Verification Scope

The verification checks that Python and MATLAB produce equivalent values for:

- Corrected chamber volume
- Required H2 injected mass (g)
- Required H2 injected volume (L, chamber conditions)
- Required H2 standard volume (L, standard conditions)
- Estimated fill time (s, min)

for the same input set and unit conventions.

## 2) Input Mapping (MATLAB -> Python)

Use the same physical meaning and units:

- `H2_volPct` -> `H2_volPct` or `targetVol` (vol%)
- `P_chamber_Pa` -> `P_chamber_Pa` (Pa)
- `T_chamber_K` -> `T_chamber_K` (K)
- `MFC_setpoint_SLPM` -> `MFC_setpoint_SLPM` or `mfcFlowSlpm` (SLPM)
- `L_m`, `W_m`, `H_m` -> chamber dimensions (m)
- `Vol_Pipes_m3`, `HotwireAssembly_m3`, `WeldedParts_m3`, `Bolts_m3` -> volume corrections (m^3)
- `T_std_K` -> standard temperature (K)
- `P_std_Pa` -> standard pressure (Pa)
- `Ru` -> gas constant (J/mol/K)
- `M_H2` -> hydrogen molar mass (kg/mol)

## 3) Equation Set Used in Python

Python follows the same ideal-gas workflow as the MATLAB reference:

1. `x_H2 = H2_volPct / 100`
2. `n_total = (P_chamber * V_chamber) / (Ru * T_chamber)`
3. `n_H2 = x_H2 * n_total`
4. `m_H2_kg = n_H2 * M_H2`
5. `m_H2_g = 1000 * m_H2_kg`
6. `V_H2_injected = (n_H2 * Ru * T_chamber) / P_chamber`
7. `V_H2_std = (n_H2 * Ru * T_std) / P_std`
8. `MFC_std_m3_s = MFC_setpoint_SLPM * 1e-3 / 60`
9. `InjectionTime_s = V_H2_std / MFC_std_m3_s`
10. `InjectionTime_min = InjectionTime_s / 60`

## 4) Chamber Volume Correction

Python computes:

`V_chamber_corrected_m3 = (L*W*H) + Vol_Pipes + HotwireAssembly - WeldedParts - Bolts`

This corrected volume is then used in the gas-mixing equations unless an explicit `V_chamber_m3` override is provided.

## 5) Units and Conventions

- Pressure in **Pa**
- Temperature in **K**
- Geometry/corrections in **m^3**
- Display volumes often in **L**
- MFC setpoint in **SLPM** (standard L/min)

Important: if pressure is entered in bar at UI level, convert to Pa before verification.

## 6) Practical MATLAB vs Python Check

Recommended workflow:

1. Use one fixed input case in MATLAB script.
2. Use the same exact input in EXDA Gas Mixing.
3. Compare:
   - `m_H2_injected_g`
   - `V_H2_injected_L`
   - `V_H2_std_L`
   - `InjectionTime_s`
4. Accept if relative error is within agreed tolerance (typical: <= 0.5% for operational use, or tighter if needed).

## 7) Suggested Verification Record (Badge)

For traceability in project documentation, record:

- `MATLAB Verified Badge`: `ON` when the Python implementation has been checked against MATLAB reference calculations
- `Verification Reference File`: e.g. `scripts/GasMixingVerificationFiles/H2_MFC_Fill_Calculator_v000.m`
- `Verification Reference File (Auxiliary)`: e.g. `scripts/GasMixingVerificationFiles/AuxFcn_H2_MFC_FillCalculator_000.m`
- `Verified by`
- `Date/Time (Europe/Stockholm)`
- `Input set ID`
- `Max relative error (%)`
- `Pass/Fail`

## 8) Notes

- This verification file is descriptive and does not replace scripted numerical regression tests.
- If equations or defaults change in `backend/modules/gas_mixing.py`, update this file and re-run verification.
