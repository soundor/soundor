import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/setup.ts'],
    provide: {
      soundorE2E: { vst3: '/project/My Plugin.vst3', root: '/project' },
    },
  },
});
