/**
 * The plugin the client tests run: one parameter of every type. Its
 * manifest and `soundor:*` declarations sit next to this file, generated
 * (`UPDATE_FIXTURES=1 vitest run fixtures`) and checked by fixtures.test.ts.
 */
export const fixtureConfig = {
  plugin: { id: 'com.example.fixture', name: 'Fixture' },
  runtimes: [],
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    steps: { type: 'int32', label: 'Steps', min: 1, max: 8, default: 4 },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
    mode: {
      type: 'choice',
      label: 'Mode',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'warm', label: 'Warm' },
        { value: 'hot', label: 'Hot' },
      ],
      default: 'warm',
    },
    // Even's: a log frequency in Hz and kHz, and a gain in 0.01 dB steps.
    frequency: {
      type: 'float32',
      label: 'Frequency',
      min: 20,
      max: 20000,
      default: 1000,
      mapping: 'log',
      unit: 'Hz',
      format: (e: any) =>
        e.if(
          e.gte(e.value, 1000),
          e.concat(e.fixed(e.div(e.value, 1000), 2), ' kHz'),
          e.concat(e.fixed(e.value, 0), ' Hz'),
        ),
      parse: (e: any) =>
        e.let(e.lower(e.trim(e.text)), (text: any) =>
          e.if(
            e.endsWith(text, 'khz'),
            e.map(e.parseFloat32(e.removeSuffix(text, 'khz')), (v: any) =>
              e.mul(v, 1000),
            ),
            e.parseFloat32(e.removeSuffix(text, 'hz')),
          ),
        ),
    },
    trim: {
      type: 'float32',
      label: 'Trim',
      min: -24,
      max: 24,
      default: 0,
      step: 0.01,
      unit: 'dB',
      access: 'manual',
    },
    reduction: {
      type: 'float32',
      label: 'Reduction',
      min: -60,
      max: 0,
      default: 0,
      unit: 'dB',
      access: 'readOnly',
    },
  },
  // Every kind of native type, sync and async: close to the JUCE runtime's
  // fixture (juce-runtime/src/native-codegen.test.ts), so the two runtimes'
  // tests can check the same behaviour.
  native: {
    types: {
      Analysis: { struct: { rms: 'float32', peaks: 'float32[]' } },
      Curve: { enum: ['linear', 'exponential'] },
      Point: { struct: { x: 'float64', y: 'float64' } },
      Preset: { struct: { name: 'string', gains: 'float32[]' } },
      Numbers: {
        struct: {
          i8: 'int8',
          u8: 'uint8',
          i16: 'int16',
          u16: 'uint16',
          i32: 'int32',
          u32: 'uint32',
          i64: 'int64',
          u64: 'uint64',
          f32: 'float32',
          f64: 'float64',
        },
      },
      Buffers: {
        struct: {
          i8: 'buffer<int8>',
          u8: 'buffer<uint8>',
          i16: 'buffer<int16>',
          u16: 'buffer<uint16>',
          i32: 'buffer<int32>',
          u32: 'buffer<uint32>',
          i64: 'buffer<int64>',
          u64: 'buffer<uint64>',
          f32: 'buffer<float32>',
          f64: 'buffer<float64>',
        },
      },
      Optionals: {
        struct: {
          slot: 'int32?',
          id: 'uint64?',
          name: 'string?',
          curve: 'Curve?',
          point: 'Point?',
          gains: 'float32[]?',
          samples: 'buffer<float32>?',
        },
      },
    },
    methods: {
      add: { args: { a: 'int32', b: 'int32' }, returns: 'int32' },
      analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
      scale: {
        args: { values: 'float64[]', factor: 'float64' },
        returns: 'float64[]',
      },
      invert: { args: { on: 'boolean' }, returns: 'boolean' },
      echo: { args: { data: 'buffer<uint8>' }, returns: 'buffer<uint8>' },
      echoUint8: { args: { value: 'uint8' }, returns: 'uint8' },
      echoInt64: { args: { value: 'int64' }, returns: 'int64' },
      echoUint64: { args: { value: 'uint64' }, returns: 'uint64' },
      echoFloat32: { args: { value: 'float32' }, returns: 'float32' },
      echoNumbers: { args: { numbers: 'Numbers' }, returns: 'Numbers' },
      echoBuffers: { args: { buffers: 'Buffers' }, returns: 'Buffers' },
      echoOptionals: { args: { optionals: 'Optionals' }, returns: 'Optionals' },
      firstPoint: { args: { points: 'Point[]?' }, returns: 'Point?' },
      sumWords: { args: { values: 'buffer<uint64>?' }, returns: 'uint64?' },
      setCurve: { args: { curve: 'Curve' } },
      setSolo: { args: { slot: 'int32?' } },
      solo: { returns: 'int32?' },
      loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
      applyPreset: { args: { preset: 'Preset' }, returns: 'void' },
      fail: {},
      failLater: { async: true },
    },
  },
} as const;
