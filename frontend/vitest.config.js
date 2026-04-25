import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

const defaultsPath = path.resolve(process.cwd(), 'config', 'exda-defaults.env');

function readDefaults() {
  try {
    const raw = fs.readFileSync(defaultsPath, 'utf-8');
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return acc;
      const [key, ...rest] = trimmed.split('=');
      acc[key.trim()] = rest.join('=').trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
}

const defaults = readDefaults();

export default defineConfig({
  define: {
    __EXDA_DEFAULT_BACKEND_HOST__: JSON.stringify(defaults.EXDA_DEFAULT_BACKEND_HOST || ''),
    __EXDA_DEFAULT_BACKEND_PORT__: JSON.stringify(defaults.EXDA_DEFAULT_BACKEND_PORT || ''),
  },
  test: {
    environment: 'jsdom',
    include: ['frontend/tests/**/*.test.js'],
    exclude: ['**/._*', '**/.DS_Store'],
    restoreMocks: true,
    setupFiles: ['./frontend/tests/setup.js'],
  },
});
