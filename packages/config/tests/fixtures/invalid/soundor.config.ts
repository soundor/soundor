// Semantically invalid (duplicate id + out-of-range default) to exercise
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
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 5 },
    { type: 'bool', id: 'gain', label: 'Gain (dup)', default: false },
  ],
};
