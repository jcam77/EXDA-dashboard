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

describe('window id on backend requests', () => {
  it('adds the id header only to backend URLs', async () => {
    const seen = [];
    window.fetch = async (input, init) => { seen.push([String(input), new Headers(init?.headers).get('X-EXDA-Client')]); return new Response('{}'); };
    window.__exdaClientFetchInstalled = false;
    const { installClientIdOnFetch, getClientId, renewClientId } = await import('../src/utils/clientId');
    const { getBackendBaseUrl } = await import('../src/utils/backendUrl');
    installClientIdOnFetch();
    await window.fetch(`${getBackendBaseUrl()}/save_plan`, { method: 'POST' });
    await window.fetch('https://example.org/x');
    const first = getClientId();
    expect(seen[0][1]).toBe(first);
    expect(seen[1][1]).toBeNull();
    expect(first).toMatch(/.{8,}/);

    // A page restored from the back/forward cache gets a new id, used from then on.
    const renewed = renewClientId();
    expect(renewed).not.toBe(first);
    await window.fetch(`${getBackendBaseUrl()}/save_plan`, { method: 'POST' });
    expect(seen[2][1]).toBe(renewed);
  });
});
