// The plugin the VST3 runtime's tests build (tests/plugin.test.ts) and CI
// validates with pluginval: one of each thing the runtime translates between
// VST3 and Soundor, each with an effect the tests can hear or read.
import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.test.vst3',
    name: 'Soundor VST3 Test',
    kind: 'effect',
    categories: ['utility'],
    vendor: { name: 'Soundor', website: 'https://soundor.dev' },
    version: '1.2.3',
  },
  audio: {
    buses: {
      input: { direction: 'input', name: 'Input' },
      output: { direction: 'output', name: 'Output' },
    },
    layouts: {
      stereo: { input: 'stereo', output: 'stereo' },
      mono: { input: 'mono', output: 'mono' },
    },
    defaultLayout: 'stereo',
    latency: { mode: 'fixed', samples: 32 },
    tail: { mode: 'dynamic' },
  },
  // MIDI in and out: the processor echoes notes an octave up.
  midi: { input: true, output: true },
  editor: {
    width: 320,
    height: 240,
    minWidth: 200,
    minHeight: 150,
    maxWidth: 640,
    maxHeight: 480,
    resizable: true,
  },
  runtimes: [vst3Runtime()],
  parameterGroups: { tone: { label: 'Tone' } },
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 2,
      default: 1,
      unit: 'x',
      group: 'tone',
    },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'invert', label: 'Invert' },
      ],
      default: 'clean',
    },
    steps: { type: 'int8', label: 'Steps', min: -4, max: 4, default: 0 },
    bypass: {
      type: 'boolean',
      label: 'Bypass',
      default: false,
      role: 'bypass',
    },
    peak: {
      type: 'float32',
      label: 'Peak',
      min: 0,
      max: 4,
      default: 0,
      access: 'readOnly',
    },
  },
  // `level` scales the output (0.25 is unity): the processor reads it.
  state: {
    label: { type: 'string', default: 'Init' },
    hostSnapshot: { type: 'string', default: '' },
    level: { type: 'float32', default: 0.25, audio: true },
    pattern: { type: 'int32[]', default: [1, 2, 3], audio: true, maxLength: 8 },
  },
  presets: [
    {
      id: 'loud',
      name: 'Loud',
      parameters: { gain: 2, mode: 'invert' },
      state: { label: 'Loud' },
    },
    {
      id: 'quiet',
      name: 'Quiet',
      parameters: { gain: 0.5 },
      state: { label: 'Quiet' },
    },
  ],
  native: {
    methods: { twice: { args: { value: 'int32' }, returns: 'int32' } },
    events: { doubled: { value: 'int32' } },
    streams: { level: { type: 'float32' } },
  },
});
