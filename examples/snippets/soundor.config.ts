import { defineSoundorConfig } from '@soundor/config';
import { webRuntime } from '@soundor/web-runtime';

// The plugin the docs' snippets run in: one parameter of every type, a gain
// on the audio, and a UI (src/main.tsx) that shows one snippet at a time.
// Only the web runtime: the snippets live in the docs.
export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.snippets',
    name: 'Soundor Snippets',
  },
  runtimes: [webRuntime()],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
    voices: { type: 'int32', label: 'Voices', min: 1, max: 8, default: 4 },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'warm', label: 'Warm' },
        { value: 'bright', label: 'Bright' },
      ],
      default: 'clean',
    },
  },
});
