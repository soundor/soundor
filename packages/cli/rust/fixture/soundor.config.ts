// The config the SDK's own tests run with: its src/plugin.rs is generated
// from it (UPDATE_GOLDEN=1 pnpm --filter soundor test), and covers every kind
// of parameter, read-only ones, both kinds of streams, the state the
// processing reads (and state it does not, of declared types too),
// resources, optional buses, presets, and native methods of every kind of
// type, synchronous and async, for the controller.
import { defineSoundorConfig } from '@soundor/config';

export default defineSoundorConfig({
  plugin: { id: 'dev.soundor.sdk-fixture', name: 'SDK Fixture' },
  runtimes: [],
  audio: {
    buses: {
      input: { direction: 'input', name: 'Input' },
      sidechain: { direction: 'input', name: 'Sidechain', optional: true },
      output: { direction: 'output', name: 'Output' },
    },
    layouts: {
      mono: { input: 'mono', sidechain: ['disabled', 'mono'], output: 'mono' },
      stereo: {
        input: 'stereo',
        sidechain: ['disabled', 'stereo'],
        output: 'stereo',
      },
      monoToStereo: { input: 'mono', sidechain: 'disabled', output: 'stereo' },
    },
    defaultLayout: 'stereo',
    defaultBuses: { sidechain: 'disabled' },
  },
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 2, default: 1 },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'warm', label: 'Warm' },
        { value: 'hard-clip', label: 'Hard clip' },
      ],
      default: 'warm',
    },
    steps: { type: 'int32', label: 'Steps', min: -4, max: 4, default: 0 },
    peak: {
      type: 'float32',
      label: 'Peak',
      min: -96,
      max: 0,
      default: -96,
      access: 'readOnly',
    },
  },
  state: {
    // UI-only: not in the processing's StateSnapshot.
    selectedTab: { type: 'int32', default: 0 },
    processingMode: { type: 'int32', default: 1, audio: true },
    enabled: { type: 'boolean', default: true, audio: true },
    depth: { type: 'float64', default: 0.25, audio: true },
    seed: { type: 'uint64', default: 7n, audio: true },
    pattern: {
      type: 'int32[]',
      default: [60, 64, 67],
      audio: true,
      maxLength: 8,
    },
    weights: { type: 'float32[]', default: [], audio: true, maxLength: 3 },
    selectedPreset: { type: 'string?', default: null },
    curve: { type: 'Curve', default: 'linear' },
    tags: { type: 'string[]', default: [], maxLength: 4 },
  },
  presets: [
    { id: 'warm', name: 'Warm', parameters: { mode: 'warm', gain: 1.5 } },
  ],
  native: {
    types: {
      Curve: { enum: ['linear', 'ease-in'] },
      Point: { struct: { x: 'float64', y: 'float64' } },
      Analysis: {
        struct: { peak: 'float32', points: 'Point[]', label: 'string?' },
      },
    },
    methods: {
      increment: { returns: 'int32' },
      reset: {},
      describe: {
        args: { gain: 'float32', id: 'uint64', tags: 'string[]' },
        returns: 'string',
      },
      analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
      pick: { args: { curve: 'Curve?' }, returns: 'Curve' },
      incrementLater: { returns: 'int32', async: true },
      loadTable: {
        args: { length: 'uint32' },
        returns: 'buffer<float32>',
        async: true,
      },
      fail: { args: { message: 'string' }, async: true },
    },
    events: {
      analysisReady: {
        label: 'string?',
        curve: 'Curve',
        samples: 'buffer<float32>',
      },
      ready: {},
    },
    streams: {
      level: { type: 'float32' },
      history: { type: 'buffer<float32>', maxLength: 8 },
    },
    resources: {
      wavetable: { type: 'buffer<float32>' },
      impulse: { type: 'buffer<float64>' },
    },
  },
});
