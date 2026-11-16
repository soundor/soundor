export default {
  plugin: { id: 'com.test.watch', name: 'Watch' },
  runtimes: [],
  parameters: {
    gain: { label: 'Gain', type: 'float32', min: 0, max: 10, default: 1 },
  },
};
