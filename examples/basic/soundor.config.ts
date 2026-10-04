import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.basic',
    name: 'Soundor Basic',
  },
  // One plugin, two runtimes: the same UI (src/main.tsx) in a JUCE plugin
  // and in the browser.
  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] }), webRuntime()],
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
