import { afterEach } from 'vitest';

const createMemoryStorage = () => {
  let store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
};

const ensureStorageApi = (name) => {
  if (typeof window === 'undefined') return;
  const storage = window[name];
  const isValidStorage =
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' &&
    typeof storage.clear === 'function';

  if (!isValidStorage) {
    Object.defineProperty(window, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
};

ensureStorageApi('localStorage');
ensureStorageApi('sessionStorage');

afterEach(() => {
  if (typeof window !== 'undefined') {
    if (typeof window.localStorage?.clear === 'function') window.localStorage.clear();
    if (typeof window.sessionStorage?.clear === 'function') window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  }
});
