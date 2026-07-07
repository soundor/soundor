import { defineSoundorConfig } from '@soundor/config';

import { fakeRuntime } from './fake-runtime';

export default defineSoundorConfig({
  runtimes: [
    { id: 'juce', options: { format: 'vst3' }, runtime: fakeRuntime('juce') },
  ],
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
    { type: 'int', id: 'voices', label: 'Voices', min: 1, max: 16, default: 4 },
    { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    {
      type: 'enum',
      id: 'mode',
      label: 'Mode',
      values: ['mono', 'stereo'],
      default: 'stereo',
    },
  ],
  nativeMethods: [{ name: 'render', input: 'Request', output: 'Result' }],
});
