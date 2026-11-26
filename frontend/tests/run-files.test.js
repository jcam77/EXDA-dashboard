import { describe, expect, it } from 'vitest';
import { filesInRunFolder, linkedRunFiles, missingLinkedFiles, toPosixPath } from '../src/utils/runFiles';

describe('run card data files', () => {
  it('uses "/" whatever the operating system', () => {
    expect(toPosixPath('VH2D-Wk27-G00-02\\DAQ-1\\VH2D-Wk27-G00-02-DAQ-1.tpc5'))
      .toBe('VH2D-Wk27-G00-02/DAQ-1/VH2D-Wk27-G00-02-DAQ-1.tpc5');
    expect(toPosixPath(' a//b ')).toBe('a/b');
    expect(toPosixPath(null)).toBe('');
  });

  it('finds the run folder files in a Windows listing (backslashes)', () => {
    const listing = [
      'VH2D-Wk27-G00-02\\DAQ-1\\VH2D-Wk27-G00-02-DAQ-1.tpc5',
      'VH2D-Wk27-G00-02\\H2BGA\\bga.csv',
      'VH2D-Wk27-G00-03\\DAQ-1\\other.tpc5',
      'VH2D-Wk27-G00-021\\DAQ-1\\not-this-run.tpc5',
    ];
    expect(filesInRunFolder(listing, 'VH2D-Wk27-G00-02')).toEqual([
      'VH2D-Wk27-G00-02/DAQ-1/VH2D-Wk27-G00-02-DAQ-1.tpc5',
      'VH2D-Wk27-G00-02/H2BGA/bga.csv',
    ]);
    expect(filesInRunFolder(listing, '')).toEqual([]);
  });

  it('matches links saved on macOS with files listed on Windows', () => {
    const stored = ['VH2D-Wk27-G00-02/DAQ-1/VH2D-Wk27-G00-02-DAQ-1.tpc5'];
    const runFolder = filesInRunFolder(['VH2D-Wk27-G00-02\\DAQ-1\\VH2D-Wk27-G00-02-DAQ-1.tpc5'], 'VH2D-Wk27-G00-02');
    expect(missingLinkedFiles(stored, runFolder)).toEqual([]);
  });

  it('reports links whose file is not in the run folder, without dropping them', () => {
    const stored = ['R1/DAQ-1/a.tpc5', 'R1\\DAQ-1\\a.tpc5', 'R1/DAQ-1/gone.tpc5'];
    expect(linkedRunFiles(stored)).toEqual(['R1/DAQ-1/a.tpc5', 'R1/DAQ-1/gone.tpc5']);
    expect(missingLinkedFiles(stored, ['R1/DAQ-1/a.tpc5'])).toEqual(['R1/DAQ-1/gone.tpc5']);
  });
});
