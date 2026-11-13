import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.analyzer',
    name: 'Soundor Analyzer',
  },
  editor: { width: 720, height: 400 },
  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] }), webRuntime()],
  native: {
    // What the plugin's audio code keeps publishing and the UI draws: the
    // latest only, once a frame, never a queue (soundor:native `channels`).
    channels: {
      // The spectrum in decibels, one value per band, low to high.
      spectrum: { type: 'buffer<float32>', maxLength: 128 },
      // The block's peak, in decibels.
      peak: { type: 'float32' },
    },
  },
});
