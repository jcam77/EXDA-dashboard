import { describe, expect, it } from 'vitest';
import { projectPickerStart, readSavedProjectFolders } from '../src/utils/pickerStart';

const folders = ['/data/EXDA/EXDA-Projects', '/data/EXDA/EXDA-Projects-Demo'];

describe('project picker start folder', () => {
  it('starts in the projects folder that holds the last project', () => {
    expect(projectPickerStart('/data/EXDA/EXDA-Projects-Demo/DEMO-003/Demo-VH2D-Project', folders))
      .toBe('/data/EXDA/EXDA-Projects-Demo');
    expect(projectPickerStart('/data/EXDA/EXDA-Projects/EMP2X/Wk27', folders)).toBe('/data/EXDA/EXDA-Projects');
  });

  it('uses the default projects folder for a project outside the projects folders', () => {
    // e.g. an old copy of EXDA in an unrelated folder, since moved or deleted
    expect(projectPickerStart('/sim/run/PostProcessing/apps/EXDA-dashboard-v0.2/Projects/VH2D', folders)).toBe('');
    expect(projectPickerStart('', folders)).toBe('');
    expect(projectPickerStart(null, folders)).toBe('');
    expect(projectPickerStart('/data/EXDA/EXDA-Projects/Wk27', [])).toBe('');
  });

  it('does not mistake a folder with a longer name for its parent', () => {
    expect(projectPickerStart('/data/EXDA/EXDA-Projects-Old/Wk27', ['/data/EXDA/EXDA-Projects'])).toBe('');
  });

  it('prefers the innermost projects folder', () => {
    expect(projectPickerStart('/data/EXDA/EXDA-Projects/EMP2X/Wk27', ['/data/EXDA', '/data/EXDA/EXDA-Projects/']))
      .toBe('/data/EXDA/EXDA-Projects/');
  });

  it('handles Windows paths', () => {
    expect(projectPickerStart('C:\\EXDA\\EXDA-Projects\\Wk27', ['c:/exda/exda-projects'])).toBe('c:/exda/exda-projects');
  });

  it('reads the projects folders saved by the Projects page', () => {
    const storage = { getItem: () => JSON.stringify(['/a', { path: '/b', mode: 'root' }, { path: '/c/P1', mode: 'project' }]) };
    expect(readSavedProjectFolders(storage)).toEqual(['/a', '/b']);
    expect(readSavedProjectFolders({ getItem: () => 'not json' })).toEqual([]);
    expect(readSavedProjectFolders(null)).toEqual([]);
  });
});
