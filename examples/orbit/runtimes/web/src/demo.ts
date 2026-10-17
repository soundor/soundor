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
  for (let step = 0; step < 32; step++) {
    const start = Math.round(step * 0.25 * rate);
    const note = [57, 64, 69, 72, 55, 62, 67, 71][Math.floor(step / 4) % 8]!;
    const frequency = 440 * 2 ** ((note - 69) / 12);
    for (let i = 0; i < rate * 0.6 && start + i < left.length; i++) {
      const t = i / rate;
      const pluck =
        Math.sin(2 * Math.PI * frequency * t) +
        0.3 * Math.sin(4 * Math.PI * frequency * t);
      let value = pluck * Math.exp(-t * 12) * 0.16 * Math.min(1, t * 800);
      if (step % 4 === 0)
        value +=
          Math.sin(2 * Math.PI * (48 * t + 2 * (1 - Math.exp(-t * 32)))) *
          Math.exp(-t * 16) *
          0.3;
      if (step % 4 === 2) value += noise() * Math.exp(-t * 42) * 0.1;
      value += noise() * Math.exp(-t * 170) * (step % 2 === 0 ? 0.035 : 0.025);
      const pan = step % 2 === 0 ? 0.85 : 1;
      left[start + i]! += value * pan;
      right[start + i]! += value * (1.85 - pan);
    }
  }
  return buffer;
}

// These controls belong to the browser host, outside the portable plugin UI.
let useDemo = true;
const listeners = new Set<() => void>();
export const demoEnabled = () => useDemo;
export function setDemoEnabled(enabled: boolean) {
  useDemo = enabled;
  listeners.forEach((listener) => listener());
}
export function subscribeDemo(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
