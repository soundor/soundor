// The web runtime's inputs for the E2E plugin: a custom one first (the
// default), then the built-in ones. e2e/web/audio-inputs.spec.ts switches
// between them.
import {
  audioFile,
  defineInput,
  microphone,
  oscillator,
} from '@soundor/web-runtime/input';

/** A steady tone, registered with the shared host like any input. */
export const tone = defineInput({
  id: 'e2e-tone',
  label: 'Test tone · 440 Hz',
  start({ context, destination }) {
    const source = context.createOscillator();
    source.frequency.value = 440;
    source.connect(destination);
    source.start();
    return () => {
      source.stop();
      source.disconnect();
    };
  },
});

export default [tone, oscillator(), audioFile(), microphone()];
