import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { snapshot, subscribe } from 'soundor:host';
import { parameters } from 'soundor:parameters';

import { demoEnabled, demoLoop, subscribeDemo } from './demo';
// Vite supplies the URL of the separately bundled worklet, not its module exports.
// oxlint-disable-next-line import/default
import processorUrl from './processor.ts?worker&url';

export const setupAudio: WebAudioSetup = async ({ context, input, output }) => {
  await context.audioWorklet.addModule(processorUrl);
  const effect = new AudioWorkletNode(context, 'orbit-delay', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const external = context.createGain();
  external.gain.value = demoEnabled() ? 0 : 1;
  input.connect(external);
  external.connect(effect);
  effect.connect(output);
  const loop = demoLoop(context);
  let source: AudioBufferSourceNode | null = null;
  let bpm = snapshot().transport?.bpm ?? 120;
  const update = () => {
    const beat = parameters.sync.get()
      ? 60 / Math.max(20, Math.min(400, bpm))
      : 0.5;
    effect.port.postMessage({
      times: [
        parameters.time1.get(),
        parameters.time2.get(),
        parameters.time3.get(),
      ].map((value) => value * beat),
      levels: [
        parameters.level1.get(),
        parameters.level2.get(),
        parameters.level3.get(),
      ],
      feedback: parameters.feedback.get(),
      tone: parameters.tone.get(),
      motion: parameters.motion.get(),
      spread: parameters.spread.get(),
      mix: parameters.mix.get(),
      hold: parameters.hold.get(),
      bypass: parameters.bypass.get(),
    });
  };
  const select = () => {
    external.gain.setTargetAtTime(
      demoEnabled() ? 0 : 1,
      context.currentTime,
      0.015,
    );
    const playing = snapshot().transport?.playing ?? false;
    if (playing && demoEnabled() && !source) {
      source = context.createBufferSource();
      source.buffer = loop;
      source.loop = true;
      source.connect(effect);
      source.start(
        0,
        (snapshot().transport?.timeInSeconds ?? 0) % loop.duration,
      );
    } else if ((!playing || !demoEnabled()) && source) {
      source.stop();
      source.disconnect();
      source = null;
    }
  };
  const off = Object.values(parameters).map((parameter) =>
    parameter.subscribe(update),
  );
  off.push(
    subscribe(() => {
      const next = snapshot().transport?.bpm ?? 120;
      if (bpm !== next) {
        bpm = next;
        update();
      }
      select();
    }),
    subscribeDemo(select),
  );
  update();
  select();
  return () => {
    off.forEach((unsubscribe) => unsubscribe());
    source?.stop();
    source?.disconnect();
    input.disconnect(external);
    external.disconnect();
    effect.disconnect();
    effect.port.close();
  };
};
