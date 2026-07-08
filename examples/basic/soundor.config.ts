import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

export default defineSoundorConfig({
  runtimes: [
    juceRuntime({
      plugin: {
        formats: ['vst3', 'standalone'],
        pluginName: 'Soundor Basic',
      },
    }),
  ],
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
  ],
});
