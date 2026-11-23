import { describe, expect, it } from 'vitest';
import { convertValueByUnit, getChannelDisplayUnit, normalizeUnitToken } from '../src/utils/units';
import { describeProcessing, resultUnitLabel } from '../src/features/analysis/processingSummary';

describe('units (EXDA-Check B4/B5)', () => {
  it('converts Pa to kPa without a fixed 101325 offset', () => {
    expect(convertValueByUnit(12000, 'pa', true)).toBeCloseTo(12);
  });
  it('does not confuse mbar with bar', () => {
    expect(normalizeUnitToken('mbar')).toBe('mbar');
    expect(convertValueByUnit(50, 'mbar', true)).toBeCloseTo(5);
  });
  it('never labels an unknown or voltage channel as kPa', () => {
    expect(getChannelDisplayUnit({ unit: 'raw', role: 'pressure' }, 'raw', true)).toBe('raw');
    expect(getChannelDisplayUnit({ unit: 'V' }, 'v', true)).toBe('V');
  });
});

describe('processing record', () => {
  it('lists every processing step', () => {
    const lines = describeProcessing({
      source: { relativePath: 'Raw_Data/R/x.tpc5', channelName: 'A1 [bar]', run: 'R', fullResolution: true },
      samplesAnalysed: 2097152,
      fsHz: 1e6,
      unit: { input: 'bar', origin: 'file header', output: 'kPa', note: 'Converted bar -> kPa (x100).' },
      reference: { reference: 'absolute', note: 'Absolute -> gauge: subtracted P0 = 100900 Pa (plan).' },
      baseline: { applied: true, note: 'Baseline: subtracted mean 0.1 kPa.' },
      filter: { applied: true, type: 'Butterworth', order: 4, cutoffHz: 5000, fsHz: 1e6, resampled: false },
      impulseEndFraction: 0.05,
      warnings: [],
    });
    const text = lines.join('\n');
    expect(text).toContain('2097152');
    expect(text).toContain('full resolution');
    expect(text).toContain('P0 = 100900');
    expect(text).toContain('Baseline');
    expect(text).toContain('order 4');
    expect(text).toContain('Resampled: no');
  });
  it('reports mixed units instead of assuming kPa', () => {
    expect(resultUnitLabel([{ metrics: { pressureUnit: 'kPa' } }, { metrics: { pressureUnit: 'V' } }])).toBe('mixed: kPa, V');
    expect(resultUnitLabel([{ metrics: { pressureUnit: 'kPa' } }])).toBe('kPa');
  });
});
