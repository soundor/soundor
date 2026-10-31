// The plugin the JUCE integration job builds, with the engine compiled from
// the workspace's sources.
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

import { parameters } from './plugin';

export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.test.plugin', name: 'Soundor Test Plugin' },
  // Resizable, so the editor resize test (EditorResize.cpp) can resize it;
  // the prebuilt test plugin keeps the default fixed 800×600.
  editor: {
    width: 640,
    height: 480,
    minWidth: 400,
    minHeight: 300,
    maxWidth: 1280,
    maxHeight: 960,
    resizable: true,
  },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
      engine: { mode: 'source' },
    }),
  ],
  parameters,
});
