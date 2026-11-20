import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.analyzer',
    name: 'Soundor Analyzer',
  },
  editor: { width: 720, height: 400 },
  runtimes: [vst3Runtime(), webRuntime()],
  native: {
    // What the plugin's audio code keeps publishing and the UI draws: the
    // latest only, once a frame, never a queue (soundor:native `streams`).
    streams: {
      // The spectrum in decibels, one value per band, low to high.
      spectrum: { type: 'buffer<float32>', maxLength: 128 },
      // The block's peak, in decibels.
      peak: { type: 'float32' },
    },
  },
});
