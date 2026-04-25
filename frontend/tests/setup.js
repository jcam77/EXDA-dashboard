import { afterEach } from 'vitest';

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  }
});
