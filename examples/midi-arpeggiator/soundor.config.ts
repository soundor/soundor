import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: {
    id: 'dev.soundor.midi-arpeggiator',
    name: 'Soundor MIDI Arpeggiator',
    kind: 'midiEffect',
    categories: ['utility'],
  },
  midi: { input: true, output: true },
  // A MIDI effect defaults to no audio buses. The browser supplies a silent
  // clock connection, so the same Rust processor still runs in AudioWorklet.
  editor: { width: 680, height: 560 },
  runtimes: [juceRuntime({ formats: ['vst3'] }), webRuntime()],
});
