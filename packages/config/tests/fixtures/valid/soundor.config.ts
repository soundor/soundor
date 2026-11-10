import { defineSoundorConfig } from '@soundor/config';

import { fakeRuntime } from './fake-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.valid', name: 'Valid' },
  runtimes: [
    { id: 'juce', options: { format: 'vst3' }, runtime: fakeRuntime('juce') },
  ],
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: -24,
      max: 24,
      default: 0,
      step: 0.01,
      unit: 'dB',
    },
    voices: {
      type: 'int32',
      label: 'Voices',
      access: 'manual',
      min: 1,
      max: 16,
      default: 4,
    },
    bypass: { type: 'boolean', default: false },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'stereo', label: 'Stereo' },
      ],
      default: 'stereo',
    },
  },
  native: {
    methods: { render: { args: { request: 'string' }, returns: 'float64' } },
  },
});
