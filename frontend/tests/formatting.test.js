import { describe, expect, it } from 'vitest';
import { formatMassG, formatPressurePa, formatTempC, formatTempK, formatTimeS } from '../src/utils/formatting';

describe('output formatting (item 8)', () => {
  it('hides floating-point noise from the week-27 report', () => {
    expect(formatTempK('295.34999999999997')).toBe('295.35');
    expect(formatMassG('13.670800000000002')).toBe('13.671');
    expect(formatTempK(22.2 + 273.15)).toBe('295.35');
  });

  it('uses the agreed precision', () => {
    expect(formatTempC('22.1')).toBe('22.1');
    expect(formatPressurePa('101500.4')).toBe('101500');
    expect(formatTimeS('396.26')).toBe('396.3');
  });

  it('keeps blank blank and passes non-numeric text through', () => {
    expect(formatTempK('')).toBe('');
    expect(formatTempK(undefined)).toBe('');
    expect(formatPressurePa('n/a')).toBe('n/a');
  });
});
