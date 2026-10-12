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
export const createView = (style?: Record<string, unknown>) =>
  runtime.create('view', style);
export const createText = () => runtime.create('text');
export const createImage = () => runtime.create('image');
export const createScrollView = () => runtime.create('scroll');
export const createTextInput = () => runtime.create('input');
export const createCanvas = () => runtime.create('canvas');
export const pressable = (...args: Parameters<typeof runtime.pressable>) =>
  runtime.pressable(...args);
export const print = (node = root) => printNode(node);
export function reset() {
  for (const child of root.children) child.remove();
  for (const child of overlayRoot.children) child.remove();
  runtime.moveFocus(null);
  runtime.pointerCancel();
  runtime.animations.forEach((animation) => animation.cancel());
  runtime.animations.clear();
  runtime.clock.clear();
  runtime.keys.clear();
}
