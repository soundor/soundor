import type { InputResult, Modifier, Params } from '@soundor/devtools-protocol';

import { DriverError } from './errors';
import type { CallOptions } from './transport';

export type { InputResult, Modifier };
export type MouseButton = 'left' | 'middle' | 'right';

/** Synthetic input commands, sent with control of the target, one at a time. */
export interface InputHost {
  send<
    M extends
      | 'Input.dispatchPointer'
      | 'Input.dispatchWheel'
      | 'Input.dispatchKey'
      | 'Input.typeText',
  >(
    method: M,
    params: Params<M>,
    options?: CallOptions,
  ): Promise<InputResult>;
}

export interface PointerOptions extends CallOptions {
  /** The button that goes down or up (`left` by default). */
  button?: MouseButton;
  /** Modifier keys held besides those held with `keyboard.down()`. */
  modifiers?: Modifier[];
}

export interface WheelOptions extends CallOptions {
  /** Where, in the view's logical pixels; the pointer's position by default. */
  x?: number;
  y?: number;
  /** Pixels to scroll right (negative: left). */
  deltaX?: number;
  /** Pixels to scroll down (negative: up). */
  deltaY?: number;
  modifiers?: Modifier[];
}

const MODIFIERS = new Set<string>(['Shift', 'Control', 'Alt', 'Meta']);
const MAX_TEXT = 1024;

function options(options: CallOptions | undefined): CallOptions {
  return {
    ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options?.signal ? { signal: options.signal } : {}),
  };
}

function position(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new DriverError('INVALID_OPTIONS', 'x and y must be finite numbers');
}

/**
 * The target's synthetic pointer: a mouse of its own, beside the real one,
 * in the view's logical pixels. Input goes through the engine's own hit
 * testing, capture and event dispatch, as a real mouse's does.
 */
export class Pointer {
  readonly #host: InputHost;
  #at: { x: number; y: number } | undefined;

  constructor(host: InputHost) {
    this.#host = host;
  }

  /** Where the pointer last went, if anywhere. */
  get position(): { x: number; y: number } | undefined {
    return this.#at && { ...this.#at };
  }

  async move(
    x: number,
    y: number,
    { modifiers, ...call }: Omit<PointerOptions, 'button'> = {},
  ): Promise<InputResult> {
    position(x, y);
    const result = await this.#host.send(
      'Input.dispatchPointer',
      { action: 'move', x, y, ...(modifiers ? { modifiers } : {}) },
      options(call),
    );
    this.#at = { x, y };
    return result;
  }

  /** Presses a button where the pointer is. */
  async down({
    button,
    modifiers,
    ...call
  }: PointerOptions = {}): Promise<InputResult> {
    return this.#host.send(
      'Input.dispatchPointer',
      {
        action: 'down',
        ...(button ? { button } : {}),
        ...(modifiers ? { modifiers } : {}),
      },
      options(call),
    );
  }

  /** Releases a button where the pointer is. */
  async up({
    button,
    modifiers,
    ...call
  }: PointerOptions = {}): Promise<InputResult> {
    return this.#host.send(
      'Input.dispatchPointer',
      {
        action: 'up',
        ...(button ? { button } : {}),
        ...(modifiers ? { modifiers } : {}),
      },
      options(call),
    );
  }

  /** Moves to a point, presses and releases there, in one step. */
  async click(
    x: number,
    y: number,
    { button, modifiers, ...call }: PointerOptions = {},
  ): Promise<InputResult> {
    position(x, y);
    const result = await this.#host.send(
      'Input.dispatchPointer',
      {
        action: 'click',
        x,
        y,
        ...(button ? { button } : {}),
        ...(modifiers ? { modifiers } : {}),
      },
      options(call),
    );
    this.#at = { x, y };
    return result;
  }

  /**
   * Ends the pointer's press without a click (a `pointercancel`), as when a
   * platform takes the mouse away.
   */
  async cancel(call?: CallOptions): Promise<InputResult> {
    const result = await this.#host.send(
      'Input.dispatchPointer',
      { action: 'cancel' },
      options(call),
    );
    this.#at = undefined;
    return result;
  }

  /** Scrolls a wheel at a point (the pointer's, by default). */
  async wheel({
    x,
    y,
    deltaX = 0,
    deltaY = 0,
    modifiers,
    ...call
  }: WheelOptions = {}): Promise<InputResult> {
    const at = x !== undefined && y !== undefined ? { x, y } : this.#at;
    if (!at || (x === undefined) !== (y === undefined))
      throw new DriverError(
        'INVALID_OPTIONS',
        'Give the wheel x and y, or move the pointer first',
      );
    position(at.x, at.y);
    position(deltaX, deltaY);
    return this.#host.send(
      'Input.dispatchWheel',
      { ...at, deltaX, deltaY, ...(modifiers ? { modifiers } : {}) },
      options(call),
    );
  }

  /** @internal Forgets the position, when the target reloads. */
  forget(): void {
    this.#at = undefined;
  }
}

/** A key and the modifiers pressed with it: `Enter`, `Shift+Tab`, `Control+a`. */
export function parseShortcut(shortcut: string): {
  modifiers: string[];
  key: string;
} {
  const parts = shortcut.split('+');
  // "+" itself, alone or after modifiers ("Shift++").
  if (shortcut.endsWith('+') && parts.at(-2) === '') parts.splice(-2, 2, '+');
  const key = parts.pop() ?? '';
  if (!key || key.length > 32)
    throw new DriverError('INVALID_OPTIONS', `Invalid key "${shortcut}"`);
  for (const modifier of parts)
    if (!MODIFIERS.has(modifier))
      throw new DriverError(
        'INVALID_OPTIONS',
        `Invalid modifier "${modifier}" in "${shortcut}": use Shift, Control, Alt or Meta`,
      );
  return { modifiers: parts, key };
}

/**
 * The target's synthetic keyboard. Keys are `KeyboardEvent.key` values
 * ("a", "A", "Enter", "ArrowLeft", "Shift"); they go to the focused node,
 * and a printable key types its text when the UI does not handle it.
 */
export class Keyboard {
  readonly #host: InputHost;

  constructor(host: InputHost) {
    this.#host = host;
  }

  async down(key: string, call?: CallOptions): Promise<InputResult> {
    return this.#host.send(
      'Input.dispatchKey',
      { action: 'down', key },
      options(call),
    );
  }

  async up(key: string, call?: CallOptions): Promise<InputResult> {
    return this.#host.send(
      'Input.dispatchKey',
      { action: 'up', key },
      options(call),
    );
  }

  /**
   * Presses and releases a key, with modifiers held around it:
   * `press('Enter')`, `press('Control+a')`. A modifier pressed here is
   * released even when the press fails.
   */
  async press(shortcut: string, call?: CallOptions): Promise<InputResult> {
    const { modifiers, key } = parseShortcut(shortcut);
    const held: string[] = [];
    try {
      for (const modifier of modifiers) {
        // Before sending: a key cancelled in flight may still be down.
        held.push(modifier);
        await this.down(modifier, call);
      }
      return await this.#host.send(
        'Input.dispatchKey',
        { action: 'press', key },
        options(call),
      );
    } finally {
      // Released whatever happened (not cancellable: nothing stays held).
      for (const modifier of held.reverse())
        await this.up(modifier).catch(() => {});
    }
  }

  /** Types text, a key press per character, into the focused node. */
  async type(text: string, call?: CallOptions): Promise<void> {
    const characters = [...text];
    if (characters.length === 0)
      throw new DriverError('INVALID_OPTIONS', 'Nothing to type');
    for (let at = 0; at < characters.length; at += MAX_TEXT)
      await this.#host.send(
        'Input.typeText',
        { text: characters.slice(at, at + MAX_TEXT).join('') },
        options(call),
      );
  }
}
