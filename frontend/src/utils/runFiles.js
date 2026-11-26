// Raw data files of a run (Plan run card). Paths are relative to Raw_Data/ and
// always use "/" (as stored in the plan), whatever the operating system, so a
// plan made on macOS/Linux works on Windows and the other way round.

// "VH2D-G00-02\\DAQ-1\\x.tpc5" -> "VH2D-G00-02/DAQ-1/x.tpc5"
export const toPosixPath = (value) => String(value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');

// Files below Raw_Data/<run>/ (paths as listed by the backend).
export const filesInRunFolder = (rawDataFiles, runName) => {
  const cleanName = toPosixPath(runName);
  if (!cleanName) return [];
  const prefix = `${cleanName}/`;
  return (Array.isArray(rawDataFiles) ? rawDataFiles : []).map(toPosixPath).filter((path) => path.startsWith(prefix));
};

// The run's linked files, normalised and without duplicates.
export const linkedRunFiles = (dataFiles) => {
  const seen = new Set();
  return (Array.isArray(dataFiles) ? dataFiles : []).map(toPosixPath).filter((path) => {
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
};

// Linked files that are not found in the run folder on this computer. They
// are kept (never dropped on save); the user can unlink them on purpose.
export const missingLinkedFiles = (dataFiles, runFolderFiles) => {
  const present = new Set((runFolderFiles || []).map(toPosixPath));
  return linkedRunFiles(dataFiles).filter((path) => !present.has(path));
};
