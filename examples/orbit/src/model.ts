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
    detail: 'A little rhythm. A lot of space.',
    times: [0.75, 1.5, 2.25],
    levels: [0.8, 0.55, 0.35],
    feedback: 0.48,
    tone: 0.55,
    motion: 0.18,
    spread: 0.75,
    mix: 0.35,
    sync: true,
  },
  {
    name: 'Warm magnetic',
    detail: 'Soft edges. Unsteady memories.',
    times: [0.38, 0.76, 1.14],
    levels: [0.85, 0.5, 0.25],
    feedback: 0.58,
    tone: 0.28,
    motion: 0.45,
    spread: 0.4,
    mix: 0.32,
    sync: false,
  },
  {
    name: 'Drifting space',
    detail: 'Let a small sound become a place.',
    times: [1, 1.75, 2.75],
    levels: [0.6, 0.7, 0.55],
    feedback: 0.76,
    tone: 0.4,
    motion: 0.65,
    spread: 1,
    mix: 0.55,
    sync: true,
  },
  {
    name: 'Close conversation',
    detail: 'Three voices, just behind yours.',
    times: [0.18, 0.27, 0.42],
    levels: [0.65, 0.45, 0.25],
    feedback: 0.18,
    tone: 0.65,
    motion: 0.08,
    spread: 0.6,
    mix: 0.25,
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
