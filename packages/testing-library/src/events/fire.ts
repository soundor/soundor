import { getTestRuntime, type TestEvent } from '@soundor/test-runtime';

import { resolveNode, type NodeTarget } from '../queries';
export interface Modifiers {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}
export interface PointerOptions extends Modifiers {
  clientX?: number;
  clientY?: number;
  offsetX?: number;
  offsetY?: number;
  /** How far the pointer moved since its previous event (a locked pointer's only change). */
  movementX?: number;
  movementY?: number;
  button?: number;
  buttons?: number;
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch' | '';
  pressure?: number;
  isPrimary?: boolean;
}
export interface KeyOptions extends Modifiers {
  key?: string;
  code?: string;
  repeat?: boolean;
}
export interface InputOptions {
  data?: string | null;
  inputType?: string;
}
export const fireEvent = Object.assign(
  (
    target: NodeTarget,
    type: string,
    options: Record<string, unknown> = {},
  ): TestEvent => getTestRuntime().fire(resolveNode(target), type, options),
  {
    pointerDown: (target: NodeTarget, options: PointerOptions = {}) =>
      getTestRuntime().pointerDown(resolveNode(target), { ...options }),
    pointerMove: (target: NodeTarget, options: PointerOptions = {}) =>
      getTestRuntime().pointerMove(resolveNode(target), { ...options }),
    pointerUp: (target: NodeTarget, options: PointerOptions = {}) =>
      getTestRuntime().pointerUp(resolveNode(target), { ...options }),
    pointerCancel: (target: NodeTarget) => {
      resolveNode(target);
      getTestRuntime().pointerCancel();
    },
    keyDown: (target: NodeTarget, options: KeyOptions = {}) =>
      getTestRuntime().fire(resolveNode(target), 'keydown', { ...options }),
    keyUp: (target: NodeTarget, options: KeyOptions = {}) =>
      getTestRuntime().fire(resolveNode(target), 'keyup', { ...options }),
    beforeInput: (target: NodeTarget, options: InputOptions = {}) =>
      getTestRuntime().fire(resolveNode(target), 'beforeinput', { ...options }),
    input: (target: NodeTarget, options: InputOptions = {}) =>
      getTestRuntime().fire(resolveNode(target), 'input', { ...options }),
    change: (target: NodeTarget) =>
      getTestRuntime().fire(resolveNode(target), 'change'),
    click: (target: NodeTarget, options: PointerOptions = {}) =>
      getTestRuntime().fire(resolveNode(target), 'click', { ...options }),
    focus: (target: NodeTarget) => resolveNode(target).focus(),
    blur: (target: NodeTarget) => resolveNode(target).blur(),
    accessibilityAction: (
      target: NodeTarget,
      options: { actionName: string; value?: string | number },
    ) =>
      getTestRuntime().fire(resolveNode(target), 'accessibilityaction', {
        ...options,
      }),
  },
);
