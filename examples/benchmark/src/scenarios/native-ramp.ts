import type { AnimationKeyframe, UiNode } from 'soundor:ui';

/** The unchanged PR 0 ramp, now repeated entirely by the native timeline. */
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
  const handle = node.animate([target(0), target(1)], {
    duration: 1000,
    easing: 'linear',
    fill: 'forwards',
    iterations: Infinity,
    direction: 'alternate',
  });
  handle.currentTime = (index % 10) * 100;
  return () => handle.cancel();
}
