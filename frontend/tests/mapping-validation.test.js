import { describe, expect, it } from 'vitest';
import { applySensorTypeRules, validateSensorAgainstList } from '../src/utils/sensorValidation';
import { resolveMappingForRun } from '../src/utils/runOverrides';

const base = {
  id: 'a', sensorId: 'P1', measuredQuantity: 'pressure', daqSystem: 'DAQ-1', daqChannel: 'A1',
  serialNumber: '123', sensitivity: '-12.5', sensitivityUnit: 'pC/bar', locationLabel: 'wall',
  x: '0', y: '0.5', z: '1', coordinateUnit: 'm', coordinateOrigin: 'o', mountingMethod: 'flush',
  isActive: true, isTriggerChannel: false, calibrationDate: '2026-01-01', model: '601A',
};

describe('sensor validation (EXDA-Check C5)', () => {
  it('accepts a complete pressure sensor', () => {
    expect(validateSensorAgainstList(base, [base], 'a')).toEqual({ errors: [], warnings: [] });
  });
  it('rejects a trigger channel with pressure quantity or a sensitivity', () => {
    const trig = { ...base, sensorId: 'Trig-3', isTriggerChannel: true, triggerMethod: 'Camera' };
    const { errors } = validateSensorAgainstList(trig, [trig], 'a');
    expect(errors.join(' ')).toMatch(/voltage/);
    expect(errors.join(' ')).toMatch(/no sensitivity/);
  });
  it('flags an unticked trigger-like sensor', () => {
    const r = validateSensorAgainstList({ ...base, sensorId: 'Trig-3' }, [], 'a');
    expect(r.warnings.join(' ')).toMatch(/looks like a trigger/);
  });
  it('rejects pC/bar on a concentration sensor', () => {
    const h2s = { ...base, sensorId: 'D2-H2S', measuredQuantity: 'concentration', sensitivity: '', sensitivityUnit: 'pC/bar' };
    expect(validateSensorAgainstList(h2s, [h2s], 'a').errors.join(' ')).toMatch(/concentration sensor cannot have sensitivity unit "pC\/bar"/);
  });
  it('warns when the model holds the serial number and on duplicate coordinates', () => {
    const p2 = { ...base, id: 'b', sensorId: 'P2', model: '6266801', serialNumber: '6266801' };
    const r = validateSensorAgainstList(p2, [base, p2], 'b');
    expect(r.warnings).toContain('Model field holds the serial number');
    expect(r.warnings.join(' ')).toMatch(/Same coordinates as P1/);
  });
  it('requires a location for an active sensor', () => {
    const r = validateSensorAgainstList({ ...base, locationLabel: '' }, [], 'a');
    expect(r.errors).toContain('Location label missing for an active sensor');
  });
  it('editor rules clear pressure fields for triggers and non-pressure sensors', () => {
    const trig = applySensorTypeRules(base, { isTriggerChannel: true });
    expect([trig.measuredQuantity, trig.sensitivity, trig.sensitivityUnit, trig.mountingMethod]).toEqual(['voltage', '', '', 'N/A']);
    expect(applySensorTypeRules(base, { measuredQuantity: 'concentration' }).sensitivityUnit).toBe('');
  });
});

describe('per-run mapping overrides (EXDA-Check C4)', () => {
  const groupOf = (run) => run.replace(/-\d+$/, '');
  it('uses the run override when present, else the group', () => {
    const keys = ['VH2D-Wk27-G01', 'VH2D-Wk27-G01-02'];
    expect(resolveMappingForRun('VH2D-Wk27-G01-01', keys, groupOf)).toEqual({ key: 'VH2D-Wk27-G01', source: 'group' });
    expect(resolveMappingForRun('VH2D-Wk27-G01-02', keys, groupOf)).toEqual({ key: 'VH2D-Wk27-G01-02', source: 'run override' });
    expect(resolveMappingForRun('VH2D-Wk27-G09-01', keys, groupOf).source).toBe('none');
  });
});
