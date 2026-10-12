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
      native: {
        methods: {
          probe: { returns: 'number' },
          load: { returns: 'number', async: true },
        },
      },
    }),
  ],
  test: {
    environment: 'soundor',
    include: ['*.spec.tsx'],
    maxWorkers: 2,
    clearMocks: false,
  },
});
