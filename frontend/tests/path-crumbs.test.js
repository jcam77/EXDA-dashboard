import { describe, expect, it } from 'vitest';
import { folderName, pathCrumbs } from '../src/utils/pathCrumbs';

describe('folder picker path helpers', () => {
  it('splits macOS / Linux paths into clickable parts', () => {
    expect(pathCrumbs('/media/psf/EXDA-Projects')).toEqual([
      { label: '/', path: '/' },
      { label: 'media', path: '/media' },
      { label: 'psf', path: '/media/psf' },
      { label: 'EXDA-Projects', path: '/media/psf/EXDA-Projects' },
    ]);
    expect(pathCrumbs('/')).toEqual([{ label: '/', path: '/' }]);
  });

  it('splits Windows paths, keeping the drive root usable', () => {
    expect(pathCrumbs('C:\\Users\\me\\EXDA-Projects')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'me', path: 'C:\\Users\\me' },
      { label: 'EXDA-Projects', path: 'C:\\Users\\me\\EXDA-Projects' },
    ]);
    expect(pathCrumbs('E:\\')).toEqual([{ label: 'E:', path: 'E:\\' }]);
  });

  it('names the last folder on any system', () => {
    expect(folderName('/a/b/VH2D-Project-Wk-27-2026')).toBe('VH2D-Project-Wk-27-2026');
    expect(folderName('C:\\Users\\me\\Old Proj\\')).toBe('Old Proj');
    expect(folderName('')).toBe('');
  });

  it('gives nothing for an empty path', () => {
    expect(pathCrumbs('')).toEqual([]);
  });
});
