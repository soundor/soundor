import {
  getTestRuntime,
  semanticSnapshot,
  type TestNode,
} from '@soundor/test-runtime';
import { vi } from 'vitest';

import { direct, type UpdateWrapper } from '../async';
import { resolveNode, type NodeTarget } from '../queries';
import type { PointerOptions } from './fire';

export interface PointerAction extends PointerOptions {
  target?: NodeTarget;
  keys?: string;
}
export interface UserOptions {
  /** Advance a test's Node timer delay, when configured. */ advanceTimers?: (
    delay: number,
  ) => unknown | Promise<unknown>;
  delay?: number;
}
const modifiers: Record<string, string> = {
  Shift: 'shiftKey',
  Control: 'ctrlKey',
  Alt: 'altKey',
  Meta: 'metaKey',
};
export function createUser(
  options: UserOptions = {},
  wrap: UpdateWrapper = direct,
) {
  const runtime = getTestRuntime();
  let pointerTarget: TestNode | null = null;
  let hovered: TestNode | null = null;
  const hover = (node: TestNode) => {
    if (hovered === node) return;
    if (hovered?.isConnected)
      runtime.fire(hovered, 'pointerleave', { ...init(), relatedTarget: node });
    runtime.fire(node, 'pointerenter', { ...init(), relatedTarget: hovered });
    hovered = node;
  };
  if (
    options.delay !== undefined &&
    (!Number.isFinite(options.delay) || options.delay < 0)
  )
    throw new RangeError('userEvent delay must be finite and nonnegative');
  const init = () =>
    Object.fromEntries(
      Object.entries(modifiers).map(([key, field]) => [
        field,
        runtime.keys.has(key),
      ]),
    );
  const active = () => {
    if (getTestRuntime() !== runtime)
      throw new Error('This userEvent session belongs to an earlier test');
  };
  const eligible = (node: TestNode) => {
    active();
    runtime.assertNode(node);
    if (!node.isConnected)
      throw new Error('Cannot interact with a detached Soundor node');
    const hidden = semanticSnapshot([runtime.root, runtime.overlayRoot]).hidden;
    return !hidden.has(node) && !node.accessibility.state?.disabled;
  };
  async function step(action: () => void) {
    active();
    if (options.delay && vi.isFakeTimers() && !options.advanceTimers)
      throw new Error(
        'userEvent with fake timers and delay requires advanceTimers',
      );
    await wrap(action);
    if (options.delay) {
      await wrap(async () => {
        if (options.advanceTimers) await options.advanceTimers(options.delay!);
        else
          await new Promise<void>((resolve) =>
            setTimeout(resolve, options.delay),
          );
      });
    }
  }
  async function keyDown(key: string, code = key) {
    await step(() => {
      const repeat = runtime.keys.has(key);
      if (
        runtime.focusedNode()?.accessibility.state?.disabled &&
        key !== 'Tab' &&
        !modifiers[key]
      )
        return;
      const event = runtime.pressKey(key, {
        ...init(),
        ...(modifiers[key] ? { [modifiers[key]]: true } : {}),
        repeat,
        code,
      });
      const node = runtime.focusedNode();
      if (
        !event.defaultPrevented &&
        node?.type === 'input' &&
        !node.accessibility.state?.disabled &&
        key.length > 0 &&
        [...key].length === 1 &&
        !runtime.keys.has('Control') &&
        !runtime.keys.has('Meta') &&
        !runtime.keys.has('Alt')
      )
        runtime.fire(node, 'beforeinput', {
          data: runtime.keys.has('Shift') ? key.toUpperCase() : key,
          inputType: 'insertText',
        });
    });
  }
  async function keyUp(key: string, code = key) {
    await step(() => {
      runtime.releaseKey(key, {
        code,
        ...init(),
        ...(modifiers[key] ? { [modifiers[key]]: false } : {}),
      });
    });
  }
  function keyDescriptor(value: string, physical: boolean) {
    const key =
      physical && /^Key[A-Z]$/.test(value)
        ? value.slice(3).toLowerCase()
        : physical && /^Digit[0-9]$/.test(value)
          ? value.slice(5)
          : value === 'Space'
            ? ' '
            : value === 'BraceLeft'
              ? '{'
              : value === 'BracketLeft'
                ? '['
                : value;
    const code = physical
      ? value
      : /^[a-zA-Z]$/.test(key)
        ? `Key${key.toUpperCase()}`
        : /^[0-9]$/.test(key)
          ? `Digit${key}`
          : key === ' '
            ? 'Space'
            : modifiers[key]
              ? `${key === 'Control' ? 'Control' : key}Left`
              : key;
    return { key, code };
  }
  async function keyboard(text: string) {
    for (let index = 0; index < text.length;) {
      const character = String.fromCodePoint(text.codePointAt(index)!);
      if (
        (character === '{' || character === '[') &&
        text[index + 1] !== character
      ) {
        const end = text.indexOf(character === '{' ? '}' : ']', index + 1);
        if (end < 0)
          throw new Error(
            `Unclosed keyboard descriptor at ${index}; double the delimiter for literal text`,
          );
        let body = text.slice(index + 1, end);
        const released = body.startsWith('/'),
          held = body.endsWith('>');
        if (released) body = body.slice(1);
        if (held) body = body.slice(0, -1);
        if (!body || (released && held))
          throw new Error('Invalid keyboard descriptor');
        const { key, code } = keyDescriptor(body, character === '[');
        if (released) {
          if (runtime.keys.has(key)) await keyUp(key, code);
        } else {
          await keyDown(key, code);
          if (!held) await keyUp(key, code);
        }
        index = end + 1;
      } else {
        const { key, code } = keyDescriptor(character, false);
        await keyDown(key, code);
        await keyUp(key, code);
        index +=
          text[index + 1] === character &&
          (character === '{' || character === '[')
            ? 2
            : character.length;
      }
    }
  }

  async function pointer(actions: PointerAction | readonly PointerAction[]) {
    for (const action of Array.isArray(actions) ? actions : [actions]) {
      active();
      const node = action.target ? resolveNode(action.target) : pointerTarget;
      if (!node)
        throw new Error(
          'The first pointer action requires a target; simulated hit testing has no geometry',
        );
      if (!eligible(node)) continue;
      pointerTarget = node;
      const { target: _target, keys, ...data } = action;
      if (data.pointerType && data.pointerType !== 'mouse')
        throw new Error(
          'Stateful user.pointer currently supports a mouse; use fireEvent for pen or touch events',
        );
      if (!keys) {
        await step(() => {
          if (!runtime.pointer.down) hover(node);
          runtime.pointerMove(node, { ...init(), isPrimary: true, ...data });
        });
        continue;
      }
      const match = /^\[(\/)?(MouseLeft|MouseRight|MouseMiddle)(>)?\]$/.exec(
        keys,
      );
      if (!match)
        throw new Error(`Unsupported Soundor pointer descriptor: ${keys}`);
      const button = { MouseLeft: 0, MouseRight: 2, MouseMiddle: 1 }[
        match[2]!
      ]!;
      if (match[1])
        await step(() => {
          runtime.pointerUp(node, {
            ...init(),
            isPrimary: true,
            ...data,
            button,
          });
          if (!runtime.pointer.down) hover(node);
        });
      else {
        await step(() => {
          if (!runtime.pointer.down) hover(node);
          runtime.pointerDown(node, {
            ...init(),
            isPrimary: true,
            ...data,
            button,
          });
        });
        if (!match[3])
          await step(() => {
            runtime.pointerUp(node, {
              ...init(),
              isPrimary: true,
              ...data,
              button,
            });
            if (!runtime.pointer.down) hover(node);
          });
      }
    }
  }
  async function click(target: NodeTarget) {
    const node = resolveNode(target);
    if (!eligible(node)) return;
    await pointer([{ target: node }, { target: node, keys: '[MouseLeft]' }]);
  }
  async function type(target: NodeTarget, text: string) {
    const node = resolveNode(target);
    if (node.type !== 'input')
      throw new TypeError('user.type requires a Soundor TextInput');
    if (!eligible(node)) return;
    await click(node);
    // Literal typing never treats braces or brackets as keyboard descriptors.
    for (const character of text) {
      await keyDown(character);
      await keyUp(character);
    }
  }
  return {
    click,
    press: async (target: NodeTarget) => {
      const node = resolveNode(target);
      if (!eligible(node)) return;
      if (!node.focusable)
        throw new Error('user.press requires a focusable Soundor control');
      await step(() => {
        node.focus();
      });
      await keyboard('{Enter}');
    },
    type,
    clear: async (target: NodeTarget) => {
      const node = resolveNode(target);
      if (node.type !== 'input')
        throw new TypeError('user.clear requires a Soundor TextInput');
      if (!eligible(node)) return;
      await click(node);
      await step(() => {
        node.select();
      });
      await keyboard('{Backspace}');
    },
    keyboard,
    tab: async (options: { shift?: boolean } = {}) => {
      const held = runtime.keys.has('Shift');
      if (options.shift && !held) await keyDown('Shift');
      await keyboard('{Tab}');
      if (options.shift && !held) await keyUp('Shift');
    },
    pointer,
  };
}
export const userEvent = {
  setup: (options?: UserOptions) => createUser(options),
};
