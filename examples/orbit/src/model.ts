import { parameters } from 'soundor:parameters';

export const colors = ['#c0a5ff', '#bce977', '#f3a58e'] as const;
export const times = [
  parameters.time1,
  parameters.time2,
  parameters.time3,
] as const;
export const levels = [
  parameters.level1,
  parameters.level2,
  parameters.level3,
] as const;
export const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

// Times are quarter-note beats in sync mode, or multiples of 500 ms in free mode.
export function milliseconds(
  beats: number,
  sync: boolean,
  bpm: number,
): number {
  return beats * (sync ? 60000 / clamp(bpm, 20, 400) : 500);
}

export function beatLabel(beats: number): string {
  const names: Record<number, string> = {
    0.125: '1/32',
    0.25: '1/16',
    0.5: '1/8',
    0.75: '1/8 D',
    1: '1/4',
    1.5: '1/4 D',
    2: '1/2',
    3: '1/2 D',
  };
  return names[beats] ?? `${beats.toFixed(2)} beats`;
}

export const presets = [
  {
    name: 'Dotted satellites',
    detail: 'Listen for the repeats between phrases.',
    times: [0.75, 1.5, 2.25],
    levels: [0.8, 0.55, 0.35],
    feedback: 0.48,
    tone: 0.55,
    motion: 0.18,
    spread: 0.75,
    mix: 0.6,
    sync: true,
  },
  {
    name: 'Warm magnetic',
    detail: 'Short, dark repeats with a little tape drift.',
    times: [0.38, 0.76, 1.14],
    levels: [0.9, 0.3, 0.12],
    feedback: 0.32,
    tone: 0.28,
    motion: 0.65,
    spread: 0.3,
    mix: 0.6,
    sync: false,
  },
  {
    name: 'Drifting space',
    detail: 'Long, moving tails fill the gaps.',
    times: [1, 1.75, 2.75],
    levels: [0.7, 0.7, 0.7],
    feedback: 0.82,
    tone: 0.4,
    motion: 0.85,
    spread: 1,
    mix: 0.8,
    sync: true,
  },
  {
    name: 'Close conversation',
    detail: 'A tight, wide double instead of a long tail.',
    times: [0.125, 0.14, 0.18],
    levels: [0.85, 0.55, 0.85],
    feedback: 0.04,
    tone: 0.8,
    motion: 0.12,
    spread: 1,
    mix: 0.6,
    sync: false,
  },
] as const;

export function applyPreset(index: number): void {
  const preset = presets[index]!;
  times.forEach((parameter, i) => parameter.set(preset.times[i]!));
  levels.forEach((parameter, i) => parameter.set(preset.levels[i]!));
  for (const key of ['feedback', 'tone', 'motion', 'spread', 'mix'] as const)
    parameters[key].set(preset[key]);
  parameters.sync.set(preset.sync);
  parameters.hold.set(false);
}
