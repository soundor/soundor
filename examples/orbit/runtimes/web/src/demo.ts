import type { WebAudioInput } from '@soundor/web-runtime/client';

/** An original, deterministic four-bar loop. No samples or external assets. */
export function demoLoop(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(2, rate * 8, rate);
  const left = buffer.getChannelData(0),
    right = buffer.getChannelData(1);
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 1073741823.5 - 1;
  };
  // Two short calls, each followed by three seconds of space for the answer.
  // Dense source material masks a delay, especially for a first-time listener.
  const starts = [0, 0.5, 1, 4, 4.5, 5];
  const notes = [57, 64, 69, 55, 62, 67];
  for (let note = 0; note < starts.length; note++) {
    const start = Math.round(starts[note]! * rate);
    const frequency = 440 * 2 ** ((notes[note]! - 69) / 12);
    for (let i = 0; i < rate * 0.3; i++) {
      const t = i / rate;
      let pluck = 0;
      // A bright pluck makes the Tone control audible across its range.
      for (let harmonic = 1; harmonic <= 8; harmonic++) {
        pluck +=
          (Math.sin(2 * Math.PI * frequency * harmonic * t) /
            harmonic ** 1.25) *
          Math.exp(-t * harmonic * 3);
      }
      const envelope = Math.min(1, t * 800) * Math.exp(-t * 20);
      const value =
        (pluck * 0.3 + noise() * Math.exp(-t * 180) * 0.08) * envelope;
      left[start + i] = value;
      right[start + i] = value;
    }
  }
  return buffer;
}

const buffers = new WeakMap<AudioContext, AudioBuffer>();

/** Registered with the shared host, not connected around the plugin's input. */
export const demoInput: WebAudioInput = {
  id: 'orbit-demo',
  label: 'Pluck phrase · 120 BPM',
  start({ context, destination, timeInSeconds }) {
    const buffer = buffers.get(context) ?? demoLoop(context);
    buffers.set(context, buffer);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    source.start(0, timeInSeconds % buffer.duration);
    return () => {
      source.stop();
      source.disconnect();
    };
  },
};
