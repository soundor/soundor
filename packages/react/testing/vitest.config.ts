import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      runtime: { state: { historyCounter: { type: 'int32', default: 0 } } },
    }),
  ],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
