import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSharedFetchCache, fetchJsonShared } from '../src/utils/sharedFetch';

const fakeFetch = () => {
  let n = 0;
  const impl = vi.fn(async () => {
    n += 1;
    const body = { success: true, n };
    return { json: async () => body };
  });
  return impl;
};

describe('shared backend reads', () => {
  beforeEach(() => clearSharedFetchCache());

  it('sends identical requests that run at the same time only once', async () => {
    const impl = fakeFetch();
    const [a, b] = await Promise.all([
      fetchJsonShared('/list_projects?path=A', { fetchImpl: impl }),
      fetchJsonShared('/list_projects?path=A', { fetchImpl: impl }),
    ]);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('reuses a fresh answer, but not for a different request', async () => {
    const impl = fakeFetch();
    await fetchJsonShared('/list_projects?path=A', { fetchImpl: impl });
    await fetchJsonShared('/list_projects?path=A', { fetchImpl: impl });
    await fetchJsonShared('/list_projects?path=B', { fetchImpl: impl });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('asks again when forced, when the answer is old, or after a change', async () => {
    const impl = fakeFetch();
    await fetchJsonShared('/x', { fetchImpl: impl });
    const forced = await fetchJsonShared('/x', { fetchImpl: impl, force: true });
    expect(forced.n).toBe(2);
    const old = await fetchJsonShared('/x', { fetchImpl: impl, maxAgeMs: 0 });
    expect(old.n).toBe(3);
    clearSharedFetchCache();
    const afterChange = await fetchJsonShared('/x', { fetchImpl: impl });
    expect(afterChange.n).toBe(4);
  });

  it('does not keep failed requests', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); });
    await expect(fetchJsonShared('/y', { fetchImpl: failing })).rejects.toThrow('offline');
    const impl = fakeFetch();
    await expect(fetchJsonShared('/y', { fetchImpl: impl })).resolves.toMatchObject({ success: true });
  });
});
