import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      native: {
        methods: {
          loadPreset: { returns: 'string', async: true },
          probe: { returns: 'number' },
        },
      },
      runtime: {
        parameters: [
          { id: 'enabled', label: 'Enabled', type: 'bool', default: true },
          {
            id: 'mode',
            label: 'Mode',
            type: 'enum',
            values: ['a', 'b'],
            default: 'a',
          },
          {
            id: 'voices',
            label: 'Voices',
            type: 'int',
            min: 1,
            max: 8,
            default: 2,
          },
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
