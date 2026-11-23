// EXDA-Check C4: a mapping named exactly like a run overrides its group mapping.
export const resolveMappingForRun = (runName, mappingKeys, getGroupFromRunName) => {
  const keys = new Set((mappingKeys || []).map((key) => String(key)));
  const run = String(runName || '').trim();
  if (keys.has(run)) return { key: run, source: 'run override' };
  const group = getGroupFromRunName(run);
  if (group && keys.has(group)) return { key: group, source: 'group' };
  return { key: '', source: 'none' };
};
