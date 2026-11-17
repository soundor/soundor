import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      runtime: {
        state: { historyCounter: { type: 'int32', default: 0 } },
        presets: [
          {
            id: 'warm',
            name: 'Warm',
            parameters: {},
            state: { historyCounter: 1 },
          },
          {
            id: 'bright',
            name: 'Bright',
            parameters: {},
            state: { historyCounter: 2 },
          },
        ],
      },
      native: { streams: { level: { type: 'float32' } } },
    }),
  ],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
