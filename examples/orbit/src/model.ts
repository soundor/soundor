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

/**
 * Device pixels per logical pixel for a canvas buffer at the view's `scale`
 * (the editor's zoom included), at most 4. Exactly that, so each pixel of the
 * buffer is one of the display's: anything else is resampled, and soft. A resized
 * buffer is cleared and drawn again, as often as an editor being dragged changes
 * the scale.
 */
export const bufferDensity = (scale: number) => Math.min(4, scale);

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
