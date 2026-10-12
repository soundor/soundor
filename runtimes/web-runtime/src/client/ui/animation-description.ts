import type { UiNode } from './node';
import type {
  AnimationComposition,
  AnimationDescription,
  AnimationEffect,
  AnimationKeyframe,
  AnimationOptions,
  AnimationPlaybackOptions,
} from './types';

export function effect(
  target: UiNode,
  keyframes: readonly AnimationKeyframe[],
  options: AnimationOptions = {},
): AnimationEffect {
  return Object.freeze({
    kind: 'effect',
    target,
    keyframes,
    options: Object.freeze({ ...options }),
  });
}
export function sequence(
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'sequence',
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function parallel(
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'parallel',
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function stagger(
  interval: number,
  children: readonly AnimationDescription[],
  options: AnimationPlaybackOptions = {},
): AnimationComposition {
  return Object.freeze({
    kind: 'stagger',
    stagger: interval,
    children: Object.freeze([...children]),
    options: Object.freeze({ ...options }),
  });
}
export function delay(
  duration: number,
  child?: AnimationDescription,
): AnimationDescription {
  const wait = Object.freeze({ kind: 'delay' as const, duration });
  return child === undefined ? wait : sequence([wait, child]);
}
export function repeat(
  child: AnimationDescription,
  iterations = Infinity,
  direction: AnimationOptions['direction'] = 'normal',
): AnimationComposition {
  return sequence([child], { iterations, direction });
}
