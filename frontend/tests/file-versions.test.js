import { describe, expect, it } from 'vitest';
import { FILE_KINDS, baseVersionFor, forgetVersions, isStoreConflict, rememberVersion } from '../src/utils/fileVersions';

describe('file versions (outdated-copy protection)', () => {
  it('remembers per project and kind, and forgets on close', () => {
    expect(baseVersionFor('/p', FILE_KINDS.gas)).toBeUndefined();
    rememberVersion('/p', FILE_KINDS.gas, 'abc');
    rememberVersion('/q', FILE_KINDS.gas, 'xyz');
    rememberVersion('/p', FILE_KINDS.plan('Plan_v000.json'), '');
    expect(baseVersionFor('/p', FILE_KINDS.gas)).toBe('abc');
    expect(baseVersionFor('/p', FILE_KINDS.plan('plan_V000.JSON'))).toBe('');
    forgetVersions('/p');
    expect(baseVersionFor('/p', FILE_KINDS.gas)).toBeUndefined();
    expect(baseVersionFor('/q', FILE_KINDS.gas)).toBe('xyz');
  });
  it('ignores missing versions', () => {
    rememberVersion('/r', FILE_KINDS.daq, undefined);
    expect(baseVersionFor('/r', FILE_KINDS.daq)).toBeUndefined();
  });
  it('recognises refused saves', () => {
    expect(isStoreConflict({ status: 409 }, { conflict: true })).toBe(true);
    expect(isStoreConflict({ status: 423 }, { locked: true })).toBe(true);
    expect(isStoreConflict({ status: 500 }, { error: 'x' })).toBe(false);
  });
});
