// One id per loaded browser tab/window. Kept in memory only: a duplicated
// tab copies sessionStorage, so storing it there would give both tabs the
// same id. The backend uses it so only one window edits a project at a time.
import { getBackendBaseUrl } from './backendUrl';

const makeId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

let currentId = makeId();
// The id of this page. Read it when needed: it is renewed when the browser
// restores the page from its back/forward cache (the old id was retired when
// the page was hidden).
export const getClientId = () => currentId;
export const renewClientId = () => {
  currentId = makeId();
  return currentId;
};
export const CLIENT_HEADER = 'X-EXDA-Client';

const isBackendUrl = (url) => {
  const text = typeof url === 'string' ? url : (url && typeof url.url === 'string' ? url.url : '');
  const base = getBackendBaseUrl();
  return Boolean(text && base && text.startsWith(base));
};

// Adds the window id to every request to the EXDA backend.
export const installClientIdOnFetch = () => {
  if (typeof window === 'undefined' || window.__exdaClientFetchInstalled) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!isBackendUrl(input)) return originalFetch(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has(CLIENT_HEADER)) headers.set(CLIENT_HEADER, currentId);
    return originalFetch(input, { ...init, headers });
  };
  window.__exdaClientFetchInstalled = true;
};
