import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BACKEND_HOST,
  DEFAULT_BACKEND_PORT,
  getBackendBaseUrl,
  getBackendPort,
} from '../src/utils/backendUrl.js';

describe('backendUrl utils', () => {
  it('uses default backend port when query param is missing', () => {
    window.history.replaceState({}, '', '/');
    expect(getBackendPort()).toBe(DEFAULT_BACKEND_PORT);
    expect(getBackendBaseUrl()).toBe(`http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`);
  });

  it('uses backendPort query param when provided', () => {
    window.history.replaceState({}, '', '/?backendPort=7001');
    expect(getBackendPort()).toBe('7001');
    expect(getBackendBaseUrl()).toBe(`http://${DEFAULT_BACKEND_HOST}:7001`);
  });
});
