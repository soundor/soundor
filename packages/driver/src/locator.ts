import type {
  DebugNode,
  DebugTree,
  HitTest,
  NodeRef,
} from '@soundor/devtools-protocol';

import { DriverError, isDriverError } from './errors';
import type {
  InputResult,
  Keyboard,
  Modifier,
  MouseButton,
  Pointer,
} from './input';
import type { CallOptions } from './transport';

/** What a locator finds: a query, resolved against the live tree each time. */
export type Selector =
  /** The node whose `debugId` prop is this. */
  | { debugId: string }
  /**
   * A node exposed to assistive technology with this role (`button`,
   * `adjustable`, …), and this accessible name if given.
   */
  | { role: string; name?: string; exact?: boolean }
  /** A text or input node showing this text. */
  | { text: string; exact?: boolean };

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a locator needs from its Driver. */
export interface LocatorHost {
  getTree(options?: CallOptions): Promise<DebugTree>;
  getNode(ref: NodeRef, options?: CallOptions): Promise<DebugNode>;
  getLayout(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
  getStyles(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
  getAccessibility(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>>;
  hitTest(x: number, y: number, options?: CallOptions): Promise<HitTest>;
  focus(ref: NodeRef, options?: CallOptions): Promise<void>;
  readonly pointer: Pointer;
  readonly keyboard: Keyboard;
  /** The Driver's command timeout: how long an action waits by default. */
  timeout(): number;
}

/**
 * Options of an action on a locator. `timeout` bounds the whole action,
 * including waiting for the node to become actionable.
 */
export interface ActionOptions extends CallOptions {
  /**
   * Where in the node's box, from its top-left corner, in logical pixels;
   * its center by default.
   */
  position?: { x: number; y: number };
  modifiers?: Modifier[];
}

export interface ClickOptions extends ActionOptions {
  button?: MouseButton;
}

export interface DragOptions extends ActionOptions {
  /** Logical pixels to move right (negative: left). */
  deltaX?: number;
  /** Logical pixels to move down (negative: up). */
  deltaY?: number;
  /** Pointer moves on the way (5 by default). */
  steps?: number;
}

export interface ScrollOptions extends ActionOptions {
  deltaX?: number;
  deltaY?: number;
}

/** Where an action happens: the node, and a point of the view on it. */
interface Target {
  node: DebugNode;
  x: number;
  y: number;
}

// Between actionability checks: short at first, then at most 250 ms.
const RETRY_DELAYS = [0, 20, 50, 100, 250];

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DriverError('CANCELLED', 'The action was cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DriverError('CANCELLED', 'The action was cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// A node can go between finding it and reading it (a re-render, a reload):
// reads are safe to retry, from the query.
const ATTEMPTS = 3;

function text(value: string | undefined, wanted: string, exact = true) {
  if (value === undefined) return false;
  return exact
    ? value === wanted
    : value.toLowerCase().includes(wanted.toLowerCase());
}

export function matches(node: DebugNode, selector: Selector): boolean {
  if ('debugId' in selector) return node.debugId === selector.debugId;
  if ('role' in selector) {
    const accessibility = node.accessibility ?? {};
    if (accessibility['exposed'] === false) return false;
    if (accessibility['role'] !== selector.role) return false;
    const name = accessibility['name'];
    return (
      selector.name === undefined ||
      text(
        typeof name === 'string' ? name : undefined,
        selector.name,
        selector.exact,
      )
    );
  }
  return text(node.text, selector.text, selector.exact);
}

export function describe(selector: Selector): string {
  if ('debugId' in selector)
    return `getByDebugId(${JSON.stringify(selector.debugId)})`;
  const exact = selector.exact === false ? ', exact: false' : '';
  if ('role' in selector)
    return `getByRole(${JSON.stringify(selector.role)}${selector.name === undefined ? '' : `, { name: ${JSON.stringify(selector.name)}${exact} }`})`;
  return `getByText(${JSON.stringify(selector.text)}${exact ? ', { exact: false }' : ''})`;
}

/**
 * A lazy query for one node of the selected target. It holds no node
 * reference: every call finds the node again in the live tree, so it follows
 * re-renders and reloads, and fails when the node is gone or not unique.
 */
export class Locator {
  readonly #host: LocatorHost;
  readonly selector: Readonly<Selector>;

  constructor(host: LocatorHost, selector: Selector) {
    this.#host = host;
    this.selector = Object.freeze({ ...selector });
  }

  toString(): string {
    return describe(this.selector);
  }

  /** The matching nodes of a current tree snapshot (summaries). */
  async all(options?: CallOptions): Promise<DebugNode[]> {
    const tree = await this.#host.getTree(options);
    return tree.nodes.filter((node) => matches(node, this.selector));
  }

  /** How many nodes match now. */
  async count(options?: CallOptions): Promise<number> {
    return (await this.all(options)).length;
  }

  /** The unique matching node now, with all its details. */
  async getNode(options?: CallOptions): Promise<DebugNode> {
    for (let attempt = 1; ; ++attempt) {
      const ref = await this.#find(options);
      try {
        const node = await this.#host.getNode(ref, options);
        // Read again if it changed into something else in between.
        if (matches(node, this.selector) || attempt === ATTEMPTS) return node;
      } catch (error) {
        if (
          attempt === ATTEMPTS ||
          !(
            isDriverError(error, 'STALE_NODE') ||
            isDriverError(error, 'GENERATION_CHANGED')
          )
        )
          throw error;
      }
    }
  }

  /** Its box, in the view's logical pixels (as `getBoundingClientRect()`). */
  async getBounds(options?: CallOptions): Promise<Bounds> {
    return (await this.getNode(options)).bounds;
  }

  async getLayout(options?: CallOptions): Promise<Record<string, unknown>> {
    return this.#read((ref) => this.#host.getLayout(ref, options), options);
  }

  async getStyles(options?: CallOptions): Promise<Record<string, unknown>> {
    return this.#read((ref) => this.#host.getStyles(ref, options), options);
  }

  async getAccessibility(
    options?: CallOptions,
  ): Promise<Record<string, unknown>> {
    return this.#read(
      (ref) => this.#host.getAccessibility(ref, options),
      options,
    );
  }

  /**
   * Waits until the node can take pointer input at a point, as a user's
   * pointer would reach it: unique, visible, enabled, with a size, inside
   * the view, and not covered by another node there.
   */
  async #actionable(options: ActionOptions = {}): Promise<Target> {
    const budget = options.timeout ?? this.#host.timeout();
    const deadline = Date.now() + budget;
    const call = (): CallOptions => ({
      timeout: Math.max(
        1,
        Math.min(deadline - Date.now(), this.#host.timeout()),
      ),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let reason = 'was not found';
    let lastError: DriverError | undefined;
    for (let attempt = 0; ; ++attempt) {
      try {
        const node = await this.getNode(call());
        const { bounds } = node;
        const states = node.accessibility?.['states'];
        const offset = options.position ?? {
          x: bounds.width / 2,
          y: bounds.height / 2,
        };
        const x = bounds.x + offset.x;
        const y = bounds.y + offset.y;
        if (!node.visible) reason = 'is not visible';
        else if (bounds.width <= 0 || bounds.height <= 0)
          reason = 'has no size';
        else if (
          typeof states === 'object' &&
          states !== null &&
          (states as Record<string, unknown>)['disabled'] === true
        )
          reason = 'is disabled';
        else {
          const hit = await this.#host.hitTest(x, y, call());
          if (hit.path.includes(node.ref.id)) return { node, x, y };
          reason = hit.node
            ? `is covered at (${x}, ${y}) by node ${hit.node.id}`
            : `is outside the view at (${x}, ${y})`;
        }
        lastError = undefined;
      } catch (error) {
        // Not there (yet), or re-rendered meanwhile: look again. Several
        // matches, a lost target or a cancellation end the wait.
        if (
          !isDriverError(error) ||
          ![
            'ELEMENT_NOT_FOUND',
            'STALE_NODE',
            'GENERATION_CHANGED',
            'TIMEOUT',
          ].includes(error.code)
        )
          throw error;
        lastError = error;
      }
      const wait =
        RETRY_DELAYS[Math.min(attempt + 1, RETRY_DELAYS.length - 1)]!;
      if (Date.now() + wait >= deadline) break;
      await sleep(wait, options.signal);
    }
    if (lastError?.code === 'ELEMENT_NOT_FOUND')
      throw new DriverError(
        'ELEMENT_NOT_FOUND',
        `${lastError.message} (waited ${budget} ms)`,
      );
    throw new DriverError(
      'ELEMENT_NOT_ACTIONABLE',
      `${this} ${lastError ? lastError.message : reason} (waited ${budget} ms)`,
    );
  }

  #call(options: ActionOptions): CallOptions {
    return options.signal ? { signal: options.signal } : {};
  }

  /**
   * Clicks the node: waits until it is actionable, then moves the pointer
   * there, presses and releases, through the engine's normal dispatch.
   * Never repeated once input was sent.
   */
  async click(options: ClickOptions = {}): Promise<InputResult> {
    const { x, y } = await this.#actionable(options);
    return this.#host.pointer.click(x, y, {
      ...this.#call(options),
      ...(options.button ? { button: options.button } : {}),
      ...(options.modifiers ? { modifiers: options.modifiers } : {}),
    });
  }

  /** Moves the pointer over the node, once it is actionable. */
  async hover(options: ActionOptions = {}): Promise<InputResult> {
    const { x, y } = await this.#actionable(options);
    return this.#host.pointer.move(x, y, {
      ...this.#call(options),
      ...(options.modifiers ? { modifiers: options.modifiers } : {}),
    });
  }

  /**
   * Presses on the node, moves by `deltaX`/`deltaY` in steps, and releases:
   * a knob turned, a slider dragged. A failure after the press cancels it
   * (a `pointercancel`): no button stays down.
   */
  async drag(options: DragOptions = {}): Promise<InputResult> {
    const { x, y } = await this.#actionable(options);
    return this.#drag(
      { x, y },
      { x: x + (options.deltaX ?? 0), y: y + (options.deltaY ?? 0) },
      options,
    );
  }

  /** Drags the node onto the center of another locator's node. */
  async dragTo(
    target: Locator,
    options: Omit<DragOptions, 'deltaX' | 'deltaY'> = {},
  ): Promise<InputResult> {
    const from = await this.#actionable(options);
    const to = await target.getBounds(this.#call(options));
    return this.#drag(
      from,
      { x: to.x + to.width / 2, y: to.y + to.height / 2 },
      options,
    );
  }

  async #drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: DragOptions,
  ): Promise<InputResult> {
    const steps = options.steps ?? 5;
    if (!Number.isInteger(steps) || steps < 1 || steps > 100)
      throw new DriverError('INVALID_OPTIONS', 'steps is 1 to 100');
    const { pointer } = this.#host;
    const call = {
      ...this.#call(options),
      ...(options.modifiers ? { modifiers: options.modifiers } : {}),
    };
    await pointer.move(from.x, from.y, call);
    try {
      // Inside: a press cancelled in flight may still have reached the UI.
      await pointer.down(call);
      for (let step = 1; step <= steps; ++step)
        await pointer.move(
          from.x + ((to.x - from.x) * step) / steps,
          from.y + ((to.y - from.y) * step) / steps,
          call,
        );
      return await pointer.up(call);
    } catch (error) {
      // Not cancellable: the press must end.
      await pointer.cancel().catch(() => {});
      throw error;
    }
  }

  /** Scrolls the wheel over the node, once it is actionable. */
  async scroll(options: ScrollOptions = {}): Promise<InputResult> {
    const { x, y } = await this.#actionable(options);
    await this.#host.pointer.move(x, y, this.#call(options));
    return this.#host.pointer.wheel({
      ...this.#call(options),
      x,
      y,
      deltaX: options.deltaX ?? 0,
      deltaY: options.deltaY ?? 0,
      ...(options.modifiers ? { modifiers: options.modifiers } : {}),
    });
  }

  /**
   * Gives the node keyboard focus, as `node.focus()` does: it must be
   * focusable (a text input, a Pressable, a `focusable` view).
   */
  async focus(options: CallOptions = {}): Promise<void> {
    for (let attempt = 1; ; ++attempt) {
      const ref = await this.#find(options);
      try {
        await this.#host.focus(ref, options);
        return;
      } catch (error) {
        if (
          attempt === ATTEMPTS ||
          !(
            isDriverError(error, 'STALE_NODE') ||
            isDriverError(error, 'GENERATION_CHANGED')
          )
        )
          throw error;
      }
    }
  }

  /** Focuses the node, then presses a key on it (`Enter`, `Control+a`). */
  async press(key: string, options: CallOptions = {}): Promise<InputResult> {
    await this.focus(options);
    return this.#host.keyboard.press(key, options);
  }

  /** Focuses the node, then types text into it, a key press per character. */
  async type(text: string, options: CallOptions = {}): Promise<void> {
    await this.focus(options);
    await this.#host.keyboard.type(text, options);
  }

  async #read<T>(
    read: (ref: NodeRef) => Promise<T>,
    options: CallOptions | undefined,
  ): Promise<T> {
    for (let attempt = 1; ; ++attempt) {
      const ref = await this.#find(options);
      try {
        return await read(ref);
      } catch (error) {
        if (
          attempt === ATTEMPTS ||
          !(
            isDriverError(error, 'STALE_NODE') ||
            isDriverError(error, 'GENERATION_CHANGED')
          )
        )
          throw error;
      }
    }
  }

  /** The reference of the unique match in a fresh snapshot. */
  async #find(options?: CallOptions): Promise<NodeRef> {
    const tree = await this.#host.getTree(options);
    const found = tree.nodes.filter((node) => matches(node, this.selector));
    if (found.length === 1) return found[0]!.ref;
    if (found.length === 0)
      throw new DriverError(
        'ELEMENT_NOT_FOUND',
        `${this} matches no node${tree.truncated ? ` of the ${tree.nodes.length} in the (truncated) snapshot` : ''}`,
      );
    const listed = found
      .slice(0, 5)
      .map((node) => `${node.type} ${node.ref.id}`)
      .join(', ');
    throw new DriverError(
      'AMBIGUOUS_ELEMENT',
      `${this} matches ${found.length} nodes (${listed}${found.length > 5 ? ', …' : ''}); make the query unique`,
    );
  }
}
