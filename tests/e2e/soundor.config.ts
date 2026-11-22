// The plugin of Soundor's end-to-end regression suite (e2e/): one of each
// thing the engine and the VST3 runtime do between a host and a plugin's UI,
// each with an effect a test can see, read or hear. It is not an example:
// keep it plain, and change it only with the tests that rely on it.
import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.e2e',
    name: 'Soundor E2E',
    kind: 'effect',
    categories: ['utility'],
    vendor: { name: 'Soundor', website: 'https://soundor.dev' },
  },
  audio: {
    buses: {
      input: { direction: 'input', name: 'Input' },
      output: { direction: 'output', name: 'Output' },
    },
    layouts: { stereo: { input: 'stereo', output: 'stereo' } },
    defaultLayout: 'stereo',
  },
  // Laid out again at every size (src/app/app.tsx fills the view).
  editor: {
    width: 720,
    height: 540,
    minWidth: 480,
    minHeight: 360,
    maxWidth: 1440,
    maxHeight: 1080,
    resizable: true,
  },
  runtimes: [vst3Runtime(), webRuntime({ inputs: './web/inputs.ts' })],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 2, default: 1 },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'invert', label: 'Invert' },
      ],
      default: 'clean',
    },
    bypass: {
      type: 'boolean',
      label: 'Bypass',
      default: false,
      role: 'bypass',
    },
  },
  // `note` is the UI's, saved with the session; `level` the processor's too.
  state: {
    note: { type: 'string', default: '' },
    level: { type: 'float32', default: 1, audio: true },
  },
  presets: [
    { id: 'unity', name: 'Unity' },
    {
      id: 'quiet-invert',
      name: 'Quiet invert',
      parameters: { gain: 0.5, mode: 'invert' },
      state: { note: 'Quiet invert', level: 0.5 },
    },
  ],
  native: {
    methods: {
      // Synchronous, with the controller's local store.
      reverse: { args: { text: 'string' }, returns: 'string' },
      // Async: counted on the control thread, settled later.
      countLater: { returns: 'int32', async: true },
    },
    // Sent by countLater once it counted.
    events: { counted: { count: 'int32' } },
    // The processor's last block: its peak, and its first samples.
    streams: {
      peak: { type: 'float32' },
      scope: { type: 'buffer<float32>', maxLength: 64 },
    },
  },
});
