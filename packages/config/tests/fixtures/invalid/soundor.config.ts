// Semantically invalid (duplicate id + out-of-range default) to exercise
// end-to-end validation failure. Plain object so the invalid shape is allowed.
export default {
  runtimes: [{ id: 'juce' }],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 5 },
    { type: 'bool', id: 'gain', label: 'Gain (dup)', default: false },
  ],
};
