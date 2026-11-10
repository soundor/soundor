import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    soundor({
      config: false,
      native: {
        methods: {
          loadPreset: { returns: 'string', async: true },
          probe: { returns: 'float64' },
        },
      },
      runtime: {
        parameters: {
          enabled: { type: 'boolean', label: 'Enabled', default: true },
          mode: {
            type: 'choice',
            label: 'Mode',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            default: 'a',
          },
          voices: {
            type: 'int32',
            label: 'Voices',
            min: 1,
            max: 8,
            default: 2,
          },
          gain: {
            type: 'float32',
            label: 'Gain',
            min: 0,
            max: 1,
            default: 0.5,
          },
        },
      },
    }),
  ],
  test: { environment: 'soundor', include: ['src/**/*.test.{ts,tsx}'] },
});
