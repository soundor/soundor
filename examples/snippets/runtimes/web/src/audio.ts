// The plugin's audio on the Web: a gain that follows the 'gain' parameter,
// passed by while 'bypass' is on. The snippets are about the UI.
import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { parameters } from 'soundor:parameters';

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  const follow = () =>
    gain.gain.setTargetAtTime(
      parameters.bypass.get() ? 1 : parameters.gain.get(),
      context.currentTime,
      0.01,
    );

  follow();
  const unsubscribe = [
    parameters.gain.subscribe(follow),
    parameters.bypass.subscribe(follow),
  ];
  input.connect(gain);
  gain.connect(output);

  return () => {
    for (const stop of unsubscribe) stop();
    input.disconnect();
    gain.disconnect();
  };
};
