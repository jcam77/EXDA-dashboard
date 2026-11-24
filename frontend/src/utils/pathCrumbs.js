// Path helpers for EXDA's folder picker (paths come from the backend's OS).

// Last part of a path: "/a/b/Project" -> "Project", "C:\Users\X" -> "X".
export const folderName = (path) => String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';

// Clickable path parts: "/media/psf/X" -> [/, media, psf, X]; "C:\Users\X" -> [C:\, Users, X].
export const pathCrumbs = (path) => {
  if (!path) return [];
  const windows = /^[A-Za-z]:/.test(path) || path.includes('\\');
  const parts = path.split(/[\\/]/).filter(Boolean);
  const crumbs = windows ? [] : [{ label: '/', path: '/' }];
  let acc = '';
  parts.forEach((part, index) => {
    if (windows) acc = index === 0 ? `${part}\\` : `${acc.replace(/\\$/, '')}\\${part}`;
    else acc = `${acc}/${part}`;
    crumbs.push({ label: part, path: acc });
  });
  return crumbs;
};
