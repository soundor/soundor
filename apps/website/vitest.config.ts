import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['{src,plugins,scripts,playground}/**/*.test.ts'],
  },
});
