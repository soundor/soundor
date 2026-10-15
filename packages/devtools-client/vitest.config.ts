import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    setupFiles: ['./tests/dom-setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
