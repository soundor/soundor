// The test plugin with a prebuilt engine, as a project builds it by default:
// engine-prebuilts.yml builds it against the archives it has just made.
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

import { parameters } from '../plugin/plugin';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.test.plugin-prebuilt',
    name: 'Soundor Test Plugin Prebuilt',
  },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'standalone'],
      engine: { mode: 'prebuilt' },
    }),
  ],
  parameters,
});
