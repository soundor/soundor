import type { AnimationKeyframe, UiAnimation, UiNode } from 'soundor:ui';

/** Same PR 0 ramp. PR 1 uses completion-only submissions; PR 2 can own repetition. */
export function nativeOpacityRamp(node: UiNode, index: number): () => void {
  return nativeRamp(node, index, (value) => ({ opacity: 0.25 + 0.75 * value }));
}

export function transformValue(value: number): AnimationKeyframe {
  return {
    transform: [{ translateY: value * 12 }, { scale: 0.95 + value * 0.05 }],
  };
}

export function nativeTransformRamp(node: UiNode, index: number): () => void {
  return nativeRamp(node, index, transformValue);
}

function nativeRamp(
  node: UiNode,
  index: number,
  target: (value: number) => AnimationKeyframe,
): () => void {
  let stopped = false;
  let handle: UiAnimation | undefined;
  const run = (up: boolean, duration: number) => {
    if (stopped) return;
    handle = node.animate([target(up ? 1 : 0)], {
      duration,
      easing: 'linear',
      fill: 'forwards',
    });
    handle.finished.then(
      () => run(!up, 1000),
      () => {},
    );
  };
  run(true, (1 - (index % 10) / 10) * 1000);
  return () => {
    stopped = true;
    handle?.cancel();
  };
}
