/** Shared by JS baselines and future native implementations. Seconds, linear easing. */
export const ANIMATION_DURATION = 1;
export const ANIMATION_STEP = 1 / 60;
export const ANIMATION_COUNTS = [1, 50, 500] as const;

/** Repeating triangular ramp, with deterministic offsets across controls. */
export function animationValue(time: number, index: number): number {
  const phase = (((time / ANIMATION_DURATION + (index % 10) / 10) % 2) + 2) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export function animationOpacity(time: number, index: number): number {
  return 0.25 + 0.75 * animationValue(time, index);
}
