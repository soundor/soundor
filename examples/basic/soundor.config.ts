import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.basic',
    name: 'Soundor Basic',
  },
  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] })],
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
