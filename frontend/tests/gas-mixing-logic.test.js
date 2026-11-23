import { describe, expect, it } from 'vitest';
import {
  applyDosageModel,
  buildCalcRequest,
  dosageModelsDiffer,
  fillTimeFields,
  findInputMismatches,
  fromPa,
  planP0ToPa,
  pressureRangeWarning,
  recordDosageModel,
  savedRecordResults,
  toPa,
} from '../src/utils/gasMixing';

const baseDraft = {
  targetVol: '16',
  pChamberPa: '101500',
  tChamberC: '22.1',
  mfcFlowSlpm: '20',
  lM: '0.9',
  wM: '0.9',
  hM: '0.9',
  volPipesM3: '0',
  hotwireAssemblyM3: '0',
  weldedPartsM3: '0',
  boltsM3: '0',
  tStdC: '25.00',
  pStdPa: '101325',
  ru: '8.314462618',
  mH2: '2.01588e-3',
};

// What the backend echoes in results.inputs for a given request.
const inputsFor = (draft) => {
  const req = buildCalcRequest(draft);
  return Object.fromEntries(Object.entries(req).map(([k, v]) => [k, Number(v)]));
};

describe('stale result detection (item 1)', () => {
  it('reports no mismatch when inputs equal the calculation inputs', () => {
    const results = { inputs: inputsFor(baseDraft) };
    expect(findInputMismatches(baseDraft, results)).toEqual([]);
  });

  it('flags a temperature edited after Calculate (G01-01 pattern)', () => {
    const results = { inputs: { ...inputsFor(baseDraft), T_chamber_K: 293.15 } };
    const mismatches = findInputMismatches(baseDraft, results);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].key).toBe('T_chamber_K');
    expect(mismatches[0].used).toBeCloseTo(293.15);
    expect(mismatches[0].current).toBeCloseTo(295.25);
  });

  it('flags a pressure edited after Calculate (G01-08 pattern)', () => {
    const draft = { ...baseDraft, pChamberPa: '100900' };
    const results = { inputs: { ...inputsFor(draft), P_chamber_Pa: 101325 } };
    expect(findInputMismatches(draft, results).map((m) => m.key)).toEqual(['P_chamber_Pa']);
  });

  it('treats a blanked input as a change', () => {
    const results = { inputs: inputsFor(baseDraft) };
    const keys = findInputMismatches({ ...baseDraft, tChamberC: '' }, results).map((m) => m.key);
    expect(keys).toContain('T_chamber_K');
  });

  it('treats results without recorded inputs as stale', () => {
    expect(findInputMismatches(baseDraft, { m_H2_injected_g: 10 })).toHaveLength(1);
  });

  it('accepts 22.2 °C against the stored 295.34999999999997 K', () => {
    const draft = { ...baseDraft, tChamberC: '22.2' };
    const results = { inputs: { ...inputsFor(draft), T_chamber_K: 295.34999999999997 } };
    expect(findInputMismatches(draft, results)).toEqual([]);
  });

  it('sends T as °C + 273.15 and never defaults it', () => {
    expect(buildCalcRequest({ ...baseDraft, tChamberC: '' }).T_chamber_K).toBe('');
    expect(Number(buildCalcRequest(baseDraft).T_chamber_K)).toBeCloseTo(295.25);
  });
});

describe('pressure units (items 2 and 3)', () => {
  it('does not guess units: 1013 stays 1013 Pa', () => {
    expect(planP0ToPa('1013')).toBe('1013');
    expect(toPa('1013', 'Pa')).toBe(1013);
  });

  it('converts only through an explicit unit', () => {
    expect(toPa('1013.25', 'hPa')).toBe(101325);
    expect(toPa('101.325', 'kPa')).toBe(101325);
    expect(toPa('1.01325', 'bar')).toBe(101325);
    expect(fromPa('101325', 'hPa')).toBe('1013.25');
    expect(fromPa('101325', 'bar')).toBe('1.01325');
  });

  it('returns blank for missing plan P0 instead of 101325', () => {
    expect(planP0ToPa('')).toBe('');
    expect(planP0ToPa(undefined)).toBe('');
    expect(planP0ToPa('abc')).toBe('');
    expect(toPa('', 'Pa')).toBeNull();
  });

  it('warns outside 80–120 kPa', () => {
    expect(pressureRangeWarning('1013')).toMatch(/outside/);
    expect(pressureRangeWarning('101325000')).toMatch(/outside/);
    expect(pressureRangeWarning('101325')).toBe('');
    expect(pressureRangeWarning('')).toBe('');
  });
});

describe('saved records keep their own calibration (item 5)', () => {
  const record = {
    targetVol: '16',
    calibrationEnabled: 'Yes',
    calibrationApplied: 'Yes',
    calibrationTargetBasis: 'fraction_0_1',
    calibrationA: '69.638',
    calibrationB: '-0.2568',
    mH2InjectedG: '10.88528',
    injectionTimeS: '396.3',
    results: { m_H2_injected_g: 10.6926, InjectionTime_s: 386.8, inputs: {} },
  };

  it('reads a and b from the record, not the global model', () => {
    expect(recordDosageModel(record).a).toBe('69.638');
    const global = { enabled: true, targetBasis: 'fraction_0_1', a: '70', b: '0' };
    expect(dosageModelsDiffer(recordDosageModel(record), global)).toBe(true);
    expect(dosageModelsDiffer(recordDosageModel(record), { enabled: true, a: '69.638', b: '-0.2568' })).toBe(false);
  });

  it('shows the saved corrected mass and fill time', () => {
    const shown = savedRecordResults(record);
    expect(shown.correction.applied).toBe(true);
    expect(shown.correction.correctedMassG).toBeCloseTo(10.88528);
    expect(shown.correction.correctedFillTimeS).toBeCloseTo(396.3);
    expect(shown.correction.a).toBeCloseTo(69.638);
  });

  it('applies the model as a*x + b on the fraction basis', () => {
    const out = applyDosageModel({ m_H2_injected_g: 10, InjectionTime_s: 100 }, '20', {
      enabled: true, targetBasis: 'fraction_0_1', a: '69.638', b: '-0.2568',
    });
    expect(out.correction.correctedMassG).toBeCloseTo(13.6708, 6);
  });
});

describe('fill time fields (item 6)', () => {
  it('records both fill times and which one goes on the MFC', () => {
    const results = {
      InjectionTime_s: 386.8,
      correction: { applied: true, correctedFillTimeS: 396.3 },
    };
    expect(fillTimeFields(results)).toEqual({
      fillTimeEstimated_s: '386.8',
      fillTimeCorrected_s: '396.3',
      fillTimeAppliedOnMfc: 'corrected',
    });
    expect(fillTimeFields({ InjectionTime_s: 386.8, correction: { applied: false } }).fillTimeAppliedOnMfc)
      .toBe('estimated');
  });
});

describe('standard temperature constant (regression)', () => {
  it('a new run with the default Tstd is not reported as stale after calculating', async () => {
    const { STANDARD_T_C, findInputMismatches, buildCalcRequest } = await import('../src/utils/gasMixing');
    const draft = {
      targetVol: '16', pChamberPa: '100900', tChamberC: '21.4', mfcFlowSlpm: '20',
      lM: '1', wM: '1', hM: '1', volPipesM3: '0', hotwireAssemblyM3: '0', weldedPartsM3: '0', boltsM3: '0',
      tStdC: STANDARD_T_C, pStdPa: '101325', ru: '8.314462618', mH2: '2.01588e-3',
    };
    const req = buildCalcRequest(draft);
    const inputs = Object.fromEntries(Object.entries(req).map(([k, v]) => [k, Number(v)]));
    expect(inputs.T_std_K).toBeCloseTo(298.15, 9);
    expect(findInputMismatches(draft, { inputs })).toEqual([]);
    expect(findInputMismatches({ ...draft, tStdC: '' }, { inputs }).map((m) => m.key)).toEqual(['T_std_K']);
  });
});
