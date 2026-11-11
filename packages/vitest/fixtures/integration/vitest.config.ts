import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      runtime: {
        state: { selected: { type: 'string?', default: null } },
        parameters: {
          gain: {
            type: 'float32',
            label: 'Gain',
            min: 0,
            max: 1,
            default: 0.5,
          },
        },
      },
      native: {
        methods: {
          probe: { returns: 'float64' },
          load: { returns: 'float64', async: true },
        },
      },
    }),
  ],
  test: {
    environment: 'soundor',
    include: ['*.spec.tsx'],
    maxWorkers: 2,
    clearMocks: false,
    server: { deps: { inline: ['conditional-ui-inline'] } },
  },
});
