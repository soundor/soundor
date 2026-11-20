import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.benchmark',
    name: 'Soundor Benchmark',
  },
  // One plugin, two runtimes: the same UI (src/main.tsx) in a VST3 plugin
  // and in the browser.
  runtimes: [vst3Runtime(), webRuntime()],
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
  },
});
