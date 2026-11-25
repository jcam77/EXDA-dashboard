// Where the Open / Create Project pickers start: always in a projects folder,
// never at an old project path (a project that was moved or deleted would
// otherwise make the picker fall back to some unrelated parent folder).
//
// - If the last opened project lies inside one of the projects folders listed
//   on the Projects page, start in that projects folder.
// - Otherwise return '' : the backend then answers with the default projects
//   folder (EXDA-Projects next to the app).

const normalize = (path) => {
  const text = String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows paths (C:/...) are case-insensitive.
  return /^[a-zA-Z]:\//.test(text) ? text.toLowerCase() : text;
};

const isInside = (child, parent) => child === parent || child.startsWith(`${parent}/`);

export const readSavedProjectFolders = (storage) => {
  try {
    const raw = JSON.parse(storage?.getItem('projectsFoldersList') || '[]');
    return (Array.isArray(raw) ? raw : [])
      .map((item) => (typeof item === 'string' ? { path: item, mode: 'root' } : item))
      .filter((item) => item?.path && (item.mode || 'root') === 'root')
      .map((item) => item.path);
  } catch {
    return [];
  }
};

export const projectPickerStart = (lastProjectPath, projectsFolders = []) => {
  const last = normalize(lastProjectPath);
  if (!last) return '';
  // The innermost projects folder that holds the last project.
  const matches = projectsFolders
    .filter(Boolean)
    .filter((folder) => isInside(last, normalize(folder)))
    .sort((a, b) => normalize(b).length - normalize(a).length);
  return matches[0] || '';
};
