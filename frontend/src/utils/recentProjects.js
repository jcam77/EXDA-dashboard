const RECENT_KEY = 'recentProjects';
const MAX_RECENTS = 12;

const readRecentProjects = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRecentProjects = (items) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(items));
};

export const recordRecentProject = (path) => {
  if (!path) return;
  const now = new Date().toISOString();
  const existing = readRecentProjects().filter((item) => item?.path && item.path !== path);
  const next = [{ path, lastOpened: now }, ...existing].slice(0, MAX_RECENTS);
  writeRecentProjects(next);
};

export const getRecentProjects = () => readRecentProjects();
