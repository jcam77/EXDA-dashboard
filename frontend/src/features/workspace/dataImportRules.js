const SIMULATION_CASE_PATH_RE = /pTProbes\/.*\/p$/i;

const toLowerPath = (value) => String(value || '').toLowerCase();

export const getFileRelativePath = (file) => file?.webkitRelativePath || file?.path || '';

export const isSimulationCaseFile = (file) => SIMULATION_CASE_PATH_RE.test(getFileRelativePath(file));

export const isFileInFolder = (file, folderPath) => {
  if (!folderPath) return true;
  if (file?.webkitRelativePath) return file.webkitRelativePath.startsWith(folderPath);
  if (file?.path) return file.path.startsWith(folderPath);
  return false;
};

export const countSimulationCases = (files, folderPath = '') =>
  (Array.isArray(files) ? files : []).filter(
    (file) => isFileInFolder(file, folderPath) && isSimulationCaseFile(file)
  ).length;

export const countFilesInFolder = (files, folderPath = '') =>
  (Array.isArray(files) ? files : []).filter((file) => isFileInFolder(file, folderPath)).length;

export const buildServerAuxCandidates = (mainPath) => {
  const dir = String(mainPath || '').substring(0, String(mainPath || '').lastIndexOf('/'));
  const postProcessingBaseMatch = String(mainPath || '').match(/^(.*\/postProcessing)\//i);
  const postProcessingBase = postProcessingBaseMatch ? postProcessingBaseMatch[1] : dir;

  return {
    toaCandidates: [
      `${postProcessingBase}/TOAProbs/0/b`,
      `${postProcessingBase}/TOAProbs/0/T`,
      `${postProcessingBase}/toaprobs`,
      `${dir}/toaprobs`,
    ],
    ventCandidates: [
      `${postProcessingBase}/ventTOAProb/0/b`,
      `${postProcessingBase}/ventTOAProb/0/p`,
      `${postProcessingBase}/venttoaprob`,
      `${dir}/venttoaprob`,
    ],
  };
};

const pickFileByPriority = (files, predicates) => {
  for (const predicate of predicates) {
    const found = files.find((file) => {
      const rel = toLowerPath(file?.webkitRelativePath);
      return predicate(rel);
    });
    if (found) return found;
  }
  return null;
};

export const findBrowserAuxFiles = (sessionFiles, simulationPath) => {
  const relPath = String(simulationPath || '');
  const postProcessingRoot = relPath.replace(/\/pTProbes\/[^/]+\/p$/i, '');
  const normalizedRoot = toLowerPath(postProcessingRoot);
  const files = Array.isArray(sessionFiles) ? sessionFiles : [];

  const toaFile = pickFileByPriority(files, [
    (rel) => rel.startsWith(normalizedRoot) && /\/toaprobs\/[^/]+\/b$/i.test(rel),
    (rel) => rel.startsWith(normalizedRoot) && /\/toaprobs\/[^/]+\/t$/i.test(rel),
    (rel) => rel.startsWith(normalizedRoot) && rel.includes('/toaprobs/'),
    (rel) => rel.includes('toaprobs'),
  ]);

  const ventFile = pickFileByPriority(files, [
    (rel) => rel.startsWith(normalizedRoot) && /\/venttoaprob\/[^/]+\/b$/i.test(rel),
    (rel) => rel.startsWith(normalizedRoot) && rel.includes('/venttoaprob/'),
    (rel) => rel.includes('venttoaprob'),
  ]);

  return { toaFile, ventFile };
};
