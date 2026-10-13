import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      runtime: {
        parameters: [
          {
            id: 'gain',
            label: 'Gain',
            type: 'float',
            min: 0,
            max: 1,
            default: 0.5,
          },
        ],
      },
    }),
  ],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
