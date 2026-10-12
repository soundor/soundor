/** Temporary compatibility adapter; component tests migrate in the adoption PR. */
import { createTestRuntime, print as printNode } from '@soundor/test-runtime';
export {
  TestNode as FakeNode,
  TestEvent as FakeEvent,
  TestAnimation as FakeAnimation,
  fire,
} from '@soundor/test-runtime';
const runtime = createTestRuntime();
export const root = runtime.root;
export const overlayRoot = runtime.overlayRoot;
export const pressables = runtime.pressables;
export const focusedNode = () => runtime.focusedNode();
export const pressKey = (key: string, init: Record<string, unknown> = {}) =>
  runtime.pressKey(key, init);
const animationHistory = new WeakMap<
  ReturnType<typeof runtime.create>,
  ReturnType<ReturnType<typeof runtime.create>['animate']>[]
>();
function tracked(
  type: Parameters<typeof runtime.create>[0],
  style?: Record<string, unknown>,
) {
  const node = runtime.create(type, style),
    history: ReturnType<typeof node.animate>[] = [];
  const animate = node.animate.bind(node);
  node.animate = (...args) => {
    const animation = animate(...args);
    history.push(animation);
    return animation;
  };
  Object.defineProperty(node, 'animations', { value: history });
  animationHistory.set(node, history);
  return node;
}
export const createView = (style?: Record<string, unknown>) =>
  tracked('view', style);
export const createText = () => tracked('text');
export const createImage = () => tracked('image');
export const createScrollView = () => tracked('scroll');
export const createTextInput = () => tracked('input');
export const createCanvas = () => tracked('canvas');
export const pressable = (...args: Parameters<typeof runtime.pressable>) =>
  runtime.pressable(...args);
export const print = (node = root) => printNode(node);
export function reset() {
  for (const node of runtime.nodes.values())
    animationHistory.get(node)?.splice(0);
  for (const child of root.children) child.remove();
  for (const child of overlayRoot.children) child.remove();
  runtime.moveFocus(null);
  runtime.pointerCancel();
  runtime.animations.forEach((animation) => animation.cancel());
  runtime.animations.clear();
  runtime.clock.clear();
  runtime.keys.clear();
}
