// Pure helpers for the Gas Mixing page (EXDA-Check items 1, 2, 3, 5, 6).
//
// Rules:
// - Never substitute a default for a missing measured input (P, T, ...).
// - No pressure unit guessing: values are Pa unless a unit is chosen explicitly.
// - Results are only valid for the exact inputs the backend echoed back in
//   results.inputs; any difference makes them stale.

export const KELVIN_OFFSET = 273.15;

export const parseFiniteNumber = (value) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (normalized === '') return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

export const celsiusToKelvin = (celsiusValue) => {
  const celsius = parseFiniteNumber(celsiusValue);
  if (celsius === null) return null;
  return celsius + KELVIN_OFFSET;
};

// Missing K gives '' (never a default temperature).
export const kelvinToCelsiusString = (kelvinValue) => {
  const kelvin = parseFiniteNumber(kelvinValue);
  if (kelvin === null) return '';
  return (kelvin - KELVIN_OFFSET).toFixed(2);
};

// ---------------------------------------------------------------------------
// Pressure units (item 3)

export const PRESSURE_UNITS = {
  Pa: { label: 'Pa', factor: 1 },
  hPa: { label: 'hPa / mbar', factor: 100 },
  kPa: { label: 'kPa', factor: 1000 },
  bar: { label: 'bar', factor: 100000 },
};

export const PRESSURE_PLAUSIBLE_MIN_PA = 80000;
export const PRESSURE_PLAUSIBLE_MAX_PA = 120000;

// Round away binary noise (e.g. 1.01325 * 1e5 = 101324.99999999999).
const roundPa = (value) => Math.round(value * 1e6) / 1e6;

// Convert a value typed in `unit` to Pa. Returns null when blank/invalid.
export const toPa = (value, unit = 'Pa') => {
  const numeric = parseFiniteNumber(value);
  const spec = PRESSURE_UNITS[unit];
  if (numeric === null || !spec) return null;
  return roundPa(numeric * spec.factor);
};

// Convert Pa to a display string in `unit` ('' when blank/invalid).
export const fromPa = (paValue, unit = 'Pa') => {
  const pa = parseFiniteNumber(paValue);
  const spec = PRESSURE_UNITS[unit];
  if (pa === null || !spec) return '';
  return String(Math.round((pa / spec.factor) * 1e9) / 1e9);
};

// Plan P0 is stored in Pa. No unit guessing and no default: blank/invalid -> ''.
export const planP0ToPa = (p0Value) => {
  const numeric = parseFiniteNumber(p0Value);
  if (numeric === null || numeric <= 0) return '';
  return String(numeric);
};

export const pressureRangeWarning = (paValue) => {
  const pa = parseFiniteNumber(paValue);
  if (pa === null) return '';
  if (pa < PRESSURE_PLAUSIBLE_MIN_PA || pa > PRESSURE_PLAUSIBLE_MAX_PA) {
    return `${pa} Pa is outside the plausible range `
      + `${PRESSURE_PLAUSIBLE_MIN_PA / 1000}–${PRESSURE_PLAUSIBLE_MAX_PA / 1000} kPa. Check the unit.`;
  }
  return '';
};

// ---------------------------------------------------------------------------
// Calculation request and stale-result detection (item 1)

// Draft -> the exact payload sent to /calculate_gas_mix.
// `pChamberPa` in the draft is always Pa (conversion happens at input time).
export const buildCalcRequest = (draft) => {
  const tChamberK = celsiusToKelvin(draft.tChamberC);
  const tStdK = celsiusToKelvin(draft.tStdC);
  return {
    H2_volPct: draft.targetVol,
    P_chamber_Pa: draft.pChamberPa,
    T_chamber_K: tChamberK === null ? '' : String(tChamberK),
    MFC_setpoint_SLPM: draft.mfcFlowSlpm,
    L_m: draft.lM,
    W_m: draft.wM,
    H_m: draft.hM,
    Vol_Pipes_m3: draft.volPipesM3,
    HotwireAssembly_m3: draft.hotwireAssemblyM3,
    WeldedParts_m3: draft.weldedPartsM3,
    Bolts_m3: draft.boltsM3,
    T_std_K: tStdK === null ? '' : String(tStdK),
    P_std_Pa: draft.pStdPa,
    Ru: draft.ru,
    M_H2: draft.mH2,
  };
};

// Fields compared between the current draft and results.inputs.
// [request key, results.inputs key, label, unit]
const COMPARED_INPUTS = [
  ['H2_volPct', 'H2_volPct', 'Target H2', 'vol.%'],
  ['P_chamber_Pa', 'P_chamber_Pa', 'Chamber pressure', 'Pa'],
  ['T_chamber_K', 'T_chamber_K', 'Chamber temperature', 'K'],
  ['MFC_setpoint_SLPM', 'MFC_setpoint_SLPM', 'MFC setpoint', 'SLPM'],
  ['L_m', 'L_m', 'Length L', 'm'],
  ['W_m', 'W_m', 'Width W', 'm'],
  ['H_m', 'H_m', 'Height H', 'm'],
  ['Vol_Pipes_m3', 'Vol_Pipes_m3', 'Pipes volume', 'm³'],
  ['HotwireAssembly_m3', 'HotwireAssembly_m3', 'Hotwire assembly volume', 'm³'],
  ['WeldedParts_m3', 'WeldedParts_m3', 'Welded parts volume', 'm³'],
  ['Bolts_m3', 'Bolts_m3', 'Bolts volume', 'm³'],
  ['T_std_K', 'T_std_K', 'Standard temperature', 'K'],
  ['P_std_Pa', 'P_std_Pa', 'Standard pressure', 'Pa'],
  ['Ru', 'Ru', 'Ru', 'J/(mol·K)'],
  ['M_H2', 'M_H2', 'M_H2', 'kg/mol'],
];

const sameNumber = (a, b) => {
  if (a === null || b === null) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-9 * scale;
};

const scalarOf = (value) => (Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value);

// Returns [] when results are valid for the draft; otherwise one entry per
// difference: { key, label, unit, current, used }.
// Results without recorded inputs (legacy) are always reported as stale.
export const findInputMismatches = (draft, results) => {
  if (!results || typeof results !== 'object') return [];
  const used = results.inputs;
  if (!used || typeof used !== 'object') {
    return [{ key: 'inputs', label: 'Recorded calculation inputs', unit: '', current: '', used: 'missing' }];
  }
  const request = buildCalcRequest(draft);
  const mismatches = [];
  COMPARED_INPUTS.forEach(([requestKey, inputsKey, label, unit]) => {
    const current = parseFiniteNumber(request[requestKey]);
    const usedValue = parseFiniteNumber(scalarOf(used[inputsKey]));
    if (!sameNumber(current, usedValue)) {
      mismatches.push({ key: requestKey, label, unit, current, used: usedValue });
    }
  });
  return mismatches;
};

// ---------------------------------------------------------------------------
// Dosage (calibration) model (item 5)

export const normalizeDosageModel = (rawModel) => {
  const source = rawModel && typeof rawModel === 'object' ? rawModel : {};
  return {
    enabled: Boolean(source.enabled),
    modelType: 'linear_targetVol_to_mass',
    targetBasis: String(source.targetBasis || 'fraction_0_1'),
    a: String(source.a ?? ''),
    b: String(source.b ?? '0'),
    notes: String(source.notes ?? ''),
  };
};

// The model a saved record was computed with (from its own stored fields).
export const recordDosageModel = (record) => {
  const item = record && typeof record === 'object' ? record : {};
  return normalizeDosageModel({
    enabled: String(item.calibrationEnabled || '').trim().toLowerCase() === 'yes',
    targetBasis: item.calibrationTargetBasis || 'fraction_0_1',
    a: item.calibrationA ?? '',
    b: item.calibrationB ?? '',
    notes: item.calibrationNotes ?? '',
  });
};

export const dosageModelsDiffer = (left, right) => {
  const l = normalizeDosageModel(left);
  const r = normalizeDosageModel(right);
  if (l.enabled !== r.enabled || l.targetBasis !== r.targetBasis) return true;
  return !sameNumber(parseFiniteNumber(l.a), parseFiniteNumber(r.a))
    || !sameNumber(parseFiniteNumber(l.b), parseFiniteNumber(r.b));
};

export const applyDosageModel = (baseResults, targetVol, dosageModel) => {
  if (!baseResults || typeof baseResults !== 'object') return baseResults;
  const model = normalizeDosageModel(dosageModel);
  const out = { ...baseResults };
  const rawMass = parseFiniteNumber(baseResults.m_H2_injected_g);
  const rawFillS = parseFiniteNumber(baseResults.InjectionTime_s);
  const target = parseFiniteNumber(targetVol);
  const targetForModel = target === null
    ? null
    : (model.targetBasis === 'fraction_0_1' ? (target / 100.0) : target);
  const a = parseFiniteNumber(model.a);
  const b = parseFiniteNumber(model.b);

  if (!model.enabled || a === null || b === null || targetForModel === null) {
    out.correction = { enabled: Boolean(model.enabled), applied: false, reason: 'disabled_or_incomplete' };
    return out;
  }

  const correctedMass = (a * targetForModel) + b;
  const equation = model.targetBasis === 'fraction_0_1'
    ? 'H2_corrected_g = a * TargetVolFrac + b'
    : 'H2_corrected_g = a * TargetVolPct + b';
  if (!Number.isFinite(correctedMass) || correctedMass <= 0) {
    out.correction = { enabled: true, applied: false, reason: 'non_positive_corrected_mass' };
    return out;
  }

  const correctedFillS = (rawMass && rawMass > 0 && Number.isFinite(rawFillS))
    ? (rawFillS * (correctedMass / rawMass))
    : null;
  const correctedFillMin = Number.isFinite(correctedFillS) ? (correctedFillS / 60.0) : null;

  out.correction = {
    enabled: true,
    applied: true,
    modelType: model.modelType,
    targetBasis: model.targetBasis,
    equation,
    a,
    b,
    targetVolPct: target,
    targetForModel,
    correctedMassG: correctedMass,
    correctedFillTimeS: correctedFillS,
    correctedFillTimeMin: correctedFillMin,
  };
  return out;
};

// For a saved record: show the values exactly as saved (mass and fill time),
// computed with the record's own a, b. Nothing is recomputed with the
// current global model.
export const savedRecordResults = (record) => {
  if (!record || typeof record !== 'object' || !record.results) return null;
  const model = recordDosageModel(record);
  const out = applyDosageModel(record.results, record.targetVol, model);
  const applied = String(record.calibrationApplied || '').trim().toLowerCase() === 'yes';
  if (!applied) {
    out.correction = { enabled: model.enabled, applied: false, reason: 'not_applied_in_saved_record' };
    return out;
  }
  const savedMass = parseFiniteNumber(record.mH2CorrectedG ?? record.mH2InjectedG);
  const savedFillS = parseFiniteNumber(record.fillTimeCorrected_s ?? record.injectionTimeS);
  out.correction = {
    ...(out.correction || {}),
    applied: true,
    a: parseFiniteNumber(model.a),
    b: parseFiniteNumber(model.b),
    correctedMassG: savedMass ?? out.correction?.correctedMassG ?? null,
    correctedFillTimeS: savedFillS ?? out.correction?.correctedFillTimeS ?? null,
    correctedFillTimeMin: savedFillS !== null
      ? savedFillS / 60.0
      : (out.correction?.correctedFillTimeMin ?? null),
    fromSavedRecord: true,
  };
  return out;
};

// ---------------------------------------------------------------------------
// Fill times (item 6)

// Unambiguous fill-time fields for a new save. Old keys (injectionTimeS,
// results.InjectionTime_s/FillTime_s) are still written/read elsewhere.
export const fillTimeFields = (results) => {
  const estimated = parseFiniteNumber(results?.InjectionTime_s);
  const applied = Boolean(results?.correction?.applied);
  const corrected = applied ? parseFiniteNumber(results?.correction?.correctedFillTimeS) : null;
  return {
    fillTimeEstimated_s: estimated === null ? '' : String(estimated),
    fillTimeCorrected_s: corrected === null ? '' : String(corrected),
    fillTimeAppliedOnMfc: applied ? 'corrected' : 'estimated',
  };
};
