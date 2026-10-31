import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.basic',
    name: 'Soundor Basic',
  },
  // Opens at 800×600; the user can resize it (between 480×400, where its
  // controls still fit, and 1600×1200), and the UI is laid out again at the
  // new size.
  editor: { width: 800, height: 600, minHeight: 400, resizable: true },
  // One plugin, two runtimes: the same UI (src/main.tsx) in a JUCE plugin
  // and in the browser.
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
      // The workspace engine: its local sources, which have no prebuilt release.
      engine: { mode: 'source' },
    }),
    webRuntime(),
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
