// The plugin the JUCE integration job builds, with the engine compiled from
// the workspace's sources.
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

import { parameters } from './plugin';

export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.test.plugin', name: 'Soundor Test Plugin' },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
      engine: { mode: 'source' },
    }),
  ],
  parameters,
});
