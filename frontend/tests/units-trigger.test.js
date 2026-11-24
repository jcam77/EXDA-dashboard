import { describe, expect, it } from 'vitest';
import { isVoltageOrTrigger } from '../src/utils/units';

describe('trigger / voltage channels in the peak table', () => {
  it('voltage units and trigger roles are not ticked by default', () => {
    expect(isVoltageOrTrigger({}, 'v')).toBe(true);
    expect(isVoltageOrTrigger({}, 'mv')).toBe(true);
    expect(isVoltageOrTrigger({ role: 'trigger' }, 'raw')).toBe(true);
  });

  it('pressure channels are ticked by default', () => {
    expect(isVoltageOrTrigger({ role: 'pressure' }, 'bar')).toBe(false);
    expect(isVoltageOrTrigger({}, 'kpa')).toBe(false);
    expect(isVoltageOrTrigger({ role: 'signal' }, 'raw')).toBe(false);
  });
});
