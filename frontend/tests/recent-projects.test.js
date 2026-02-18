import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentProjects, recordRecentProject } from '../src/utils/recentProjects.js';

describe('recentProjects utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T07:00:00.000Z'));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a project with timestamp', () => {
    recordRecentProject('/tmp/project-a');

    const items = getRecentProjects();
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('/tmp/project-a');
    expect(items[0].lastOpened).toBe('2026-02-18T07:00:00.000Z');
  });

  it('moves existing project to the top without duplicates', () => {
    recordRecentProject('/tmp/project-a');
    vi.setSystemTime(new Date('2026-02-18T07:01:00.000Z'));
    recordRecentProject('/tmp/project-b');
    vi.setSystemTime(new Date('2026-02-18T07:02:00.000Z'));
    recordRecentProject('/tmp/project-a');

    const items = getRecentProjects();
    expect(items.map((item) => item.path)).toEqual(['/tmp/project-a', '/tmp/project-b']);
    expect(items[0].lastOpened).toBe('2026-02-18T07:02:00.000Z');
  });

  it('keeps only the most recent 12 projects', () => {
    for (let i = 0; i < 15; i += 1) {
      vi.setSystemTime(new Date(`2026-02-18T07:${String(i).padStart(2, '0')}:00.000Z`));
      recordRecentProject(`/tmp/project-${i}`);
    }

    const items = getRecentProjects();
    expect(items).toHaveLength(12);
    expect(items[0].path).toBe('/tmp/project-14');
    expect(items[11].path).toBe('/tmp/project-3');
  });
});
