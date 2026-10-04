/**
 * The plugin the client tests run: one parameter of every type. Its
 * manifest and `soundor:*` declarations sit next to this file, generated
 * (`UPDATE_FIXTURES=1 vitest run fixtures`) and checked by fixtures.test.ts.
 */
export const fixtureConfig = {
  plugin: { id: 'com.example.fixture', name: 'Fixture' },
  runtimes: [],
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    { type: 'int', id: 'steps', label: 'Steps', min: 1, max: 8, default: 4 },
    { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    {
      type: 'enum',
      id: 'mode',
      label: 'Mode',
      values: ['clean', 'warm', 'hot'],
      default: 'warm',
    },
  ],
} as const;
