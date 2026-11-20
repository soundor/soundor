import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.midi',
    name: 'Soundor MIDI Lab',
    kind: 'instrument',
    categories: ['synth'],
  },
  midi: { input: true, output: false },
  audio: {
    buses: { output: { direction: 'output', name: 'Output' } },
    layouts: { stereo: { output: 'stereo' } },
    defaultLayout: 'stereo',
  },
  editor: { width: 680, height: 600 },
  runtimes: [vst3Runtime(), webRuntime()],
  native: {
    types: { MidiStats: { struct: { events: 'uint32', resets: 'uint32' } } },
    methods: {
      stats: { returns: 'MidiStats' },
      playNote: {
        args: { note: 'uint8', down: 'boolean' },
        returns: 'boolean',
      },
    },
  },
});
