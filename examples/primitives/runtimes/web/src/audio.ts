// The plugin's audio on the Web: plain Web Audio nodes between the host's
// input and output, here a gain that follows the 'gain' parameter.
// soundor:parameters is the same parameter the plugin UI moves.
import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { parameters } from 'soundor:parameters';

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  const follow = (value: number) =>
    gain.gain.setTargetAtTime(value, context.currentTime, 0.01);

  gain.gain.value = parameters.gain.get();
  const unsubscribe = parameters.gain.subscribe(follow);
  input.connect(gain);
  gain.connect(output);

  return () => {
    unsubscribe();
    input.disconnect();
    gain.disconnect();
  };
};
