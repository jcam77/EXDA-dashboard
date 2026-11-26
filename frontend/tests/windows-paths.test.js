import { describe, expect, it } from 'vitest';
import { folderName } from '../src/utils/pathCrumbs';
import { buildServerAuxCandidates, isSimulationCaseFile } from '../src/features/workspace/dataImportRules';

describe('Windows paths', () => {
  it('shows only the folder name on the Projects page chips', () => {
    expect(folderName('C:\\Users\\me\\Desktop\\EXDA\\EXDA-Projects')).toBe('EXDA-Projects');
    expect(folderName('C:\\Users\\me\\Desktop\\EXDA\\EXDA-Projects-Demo\\')).toBe('EXDA-Projects-Demo');
    expect(folderName('/home/me/EXDA/EXDA-Projects')).toBe('EXDA-Projects');
  });

  it('recognises simulation probe files with backslashes', () => {
    expect(isSimulationCaseFile({ path: 'C:\\run\\case1\\postProcessing\\pTProbes\\0\\p' })).toBe(true);
    expect(isSimulationCaseFile({ path: '/run/case1/postProcessing/pTProbes/0/p' })).toBe(true);
    expect(isSimulationCaseFile({ path: 'C:\\run\\case1\\postProcessing\\other\\0\\p' })).toBe(false);
  });

  it('builds the auxiliary file paths from a Windows path', () => {
    const win = buildServerAuxCandidates('C:\\run\\case1\\postProcessing\\pTProbes\\0\\p');
    const posix = buildServerAuxCandidates('C:/run/case1/postProcessing/pTProbes/0/p');
    expect(win).toEqual(posix);
    expect(win.toaCandidates[0]).toBe('C:/run/case1/postProcessing/TOAProbs/0/b');
  });
});
