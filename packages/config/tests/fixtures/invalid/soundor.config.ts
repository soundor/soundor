// Semantically invalid (out-of-range default, a default that is no option) to exercise
// end-to-end validation failure. Plain object so the invalid shape is allowed;
// the runtime is structurally valid so validation reaches the parameter issues.
const noop = async () => {};
const runtime = {
  id: 'juce',
  init: noop,
  gen: noop,
  dev: noop,
  build: noop,
  doctor: async () => ({ checks: [] }),
};

export default {
  plugin: { id: 'com.example.invalid', name: 'Invalid' },
  runtimes: [{ id: 'juce', runtime }],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 5 },
    mode: {
      type: 'choice',
      options: [{ value: 'a', label: 'A' }],
      default: 'b',
    },
  },
};
