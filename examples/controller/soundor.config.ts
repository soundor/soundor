import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

// A ring modulator whose controller is Rust (lib/src/controller.rs): the
// UI's native methods, a counter kept between calls, async methods that
// compute a wavetable off the control thread and publish it to the
// processor, and a scheduled update cancelled when it waits too long.
export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.controller',
    name: 'Soundor Controller',
    kind: 'effect',
    categories: ['modulation'],
  },
  audio: {
    buses: {
      input: { direction: 'input', name: 'Input' },
      output: { direction: 'output', name: 'Output' },
    },
    layouts: {
      mono: { input: 'mono', output: 'mono' },
      stereo: { input: 'stereo', output: 'stereo' },
    },
    defaultLayout: 'stereo',
  },
  editor: { width: 560, height: 420 },
  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] }), webRuntime()],
  parameters: {
    rate: {
      type: 'float32',
      label: 'Rate',
      min: 1,
      max: 2000,
      default: 30,
      unit: 'Hz',
    },
    depth: { type: 'float32', label: 'Depth', min: 0, max: 1, default: 1 },
  },
  // Saved with the plugin, in History: the wavetable's shape, which the
  // controller sets once it published one.
  state: { shape: { type: 'Shape', default: 'sine' } },
  native: {
    types: {
      Shape: { enum: ['sine', 'triangle', 'square', 'saw'] },
      Stats: {
        struct: { clicks: 'int32', loads: 'uint64', lastShape: 'Shape?' },
      },
    },
    methods: {
      // Synchronous: inside the JavaScript call, with the local store.
      click: { returns: 'int32' },
      stats: { returns: 'Stats' },
      // Async: a promise, the work on the controller's worker.
      clickLater: { returns: 'int32', async: true },
      loadTable: {
        args: { shape: 'Shape', size: 'uint32' },
        returns: 'uint32',
        async: true,
      },
    },
    // The wavetable the processor modulates with, which the controller
    // publishes (and `prepare` too, the first time).
    resources: { wavetable: { type: 'buffer<float32>' } },
  },
});
