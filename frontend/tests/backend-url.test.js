import { describe, expect, it } from 'vitest';

import { getBackendBaseUrl, getBackendPort } from '../src/utils/backendUrl.js';

describe('backendUrl utils', () => {
  it('uses default backend port when query param is missing', () => {
    window.history.replaceState({}, '', '/');
    expect(getBackendPort()).toBe('5000');
    expect(getBackendBaseUrl()).toBe('http://127.0.0.1:5000');
  });

  it('uses backendPort query param when provided', () => {
    window.history.replaceState({}, '', '/?backendPort=7001');
    expect(getBackendPort()).toBe('7001');
    expect(getBackendBaseUrl()).toBe('http://127.0.0.1:7001');
  });
});
