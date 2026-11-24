import { describe, expect, it } from 'vitest';
import { formatPeakValue, stripUnitSuffix, unitSuffix } from '../src/utils/peakFormat';

describe('peak table formatting', () => {
  it('uses fixed decimals per unit so columns line up', () => {
    expect(formatPeakValue(20.93, 'kPa')).toBe('20.930');
    expect(formatPeakValue(0.90236, 'kPa')).toBe('0.902');
    expect(formatPeakValue(0.2093, 'bar')).toBe('0.20930');
    expect(formatPeakValue(5.0395, 'V')).toBe('5.040');
    expect(formatPeakValue(NaN, 'kPa')).toBe('—');
    expect(formatPeakValue(12.3456789, 'raw')).toBe('12.346');
  });

  it('separates the channel name from the recorded unit', () => {
    expect(stripUnitSuffix('A1 (0.A1) [bar]')).toBe('A1 (0.A1)');
    expect(unitSuffix('A1 (0.A1) [bar]')).toBe('bar');
    expect(stripUnitSuffix('DAQ-2-Channel1')).toBe('DAQ-2-Channel1');
    expect(unitSuffix('DAQ-2-Channel1')).toBe('');
  });
});
