// The analyzer on the Web: the host's input passes through an AnalyserNode,
// read every animation frame and published to the UI through the same
// channels the JUCE plugin publishes from its audio thread.
import type { WebAudioSetup } from '@soundor/web-runtime/client';

import { channels } from '../../../.soundor/generated/runtimes/web/native';

/** As soundor.config declares `spectrum` (maxLength: 128). */
const BANDS = 128;

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -96;
  input.connect(analyser);
  analyser.connect(output);

  // Bands spaced evenly in pitch from 20 Hz to 20 kHz, as the JUCE plugin's.
  const bins = analyser.frequencyBinCount;
  const nyquist = context.sampleRate / 2;
  const high = Math.min(20000, nyquist);
  const starts = Array.from({ length: BANDS + 1 }, (_, band) =>
    Math.min(
      bins,
      Math.max(
        1,
        Math.round(((20 * (high / 20) ** (band / BANDS)) / nyquist) * bins),
      ),
    ),
  );
  const decibels = new Float32Array(bins);
  const samples = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(BANDS);

  let frame = 0;
  const read = () => {
    analyser.getFloatFrequencyData(decibels);
    for (let band = 0; band < BANDS; band++) {
      const first = starts[band]!;
      const last = Math.max(first + 1, starts[band + 1]!);
      let level = -96;
      for (let bin = first; bin < last && bin < bins; bin++)
        level = Math.max(level, decibels[bin]!);
      spectrum[band] = level;
    }
    // Copied by the channel: `spectrum` is reused next frame.
    channels.spectrum.publish(spectrum);

    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    channels.peak.publish(
      peak > 0 ? Math.max(-96, 20 * Math.log10(peak)) : -96,
    );
    frame = requestAnimationFrame(read);
  };
  frame = requestAnimationFrame(read);

  return () => {
    cancelAnimationFrame(frame);
    input.disconnect();
    analyser.disconnect();
  };
};
