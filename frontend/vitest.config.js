import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['frontend/tests/**/*.test.js'],
    exclude: ['**/._*', '**/.DS_Store'],
    restoreMocks: true,
    setupFiles: ['./frontend/tests/setup.js'],
  },
});
