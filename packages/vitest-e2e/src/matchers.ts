import { basename, dirname, join } from 'node:path';

import { isDriverError, Locator, type DebugNode } from '@soundor/driver';
import { inject } from 'vitest';

import { resultsDir } from './results';
import {
  compareScreenshot,
  type ScreenshotMatcherOptions,
  type UpdateMode,
} from './screenshot';

/** Options of the locator matchers. */
export interface MatcherOptions {
  /** Milliseconds to keep checking before failing (5000 by default). */
  timeout?: number;
}

declare module 'vitest' {
  interface Matchers<
    // oxlint-disable-next-line no-unused-vars -- Matchers must keep Vitest's type parameters.
    R extends void | Promise<void> = void | Promise<void>,
    // oxlint-disable-next-line no-unused-vars
    T = unknown,
  > {
    /** One matching node, visible; retries until it is, or `timeout`. */
    toBeVisible(options?: MatcherOptions): Promise<void>;
    /** No matching node, or one not visible; retries until so, or `timeout`. */
    toBeHidden(options?: MatcherOptions): Promise<void>;
    /** The node's own text is this (equal), or matches this; retries until
        it does, or `timeout`. */
    toHaveText(
      expected: string | RegExp,
      options?: MatcherOptions,
    ): Promise<void>;
    /** The node is checked; retries until it is, or `timeout`. */
    toBeChecked(options?: MatcherOptions): Promise<void>;
    /** The node is not disabled; retries until so, or `timeout`. */
    toBeEnabled(options?: MatcherOptions): Promise<void>;
    /** The node has keyboard focus; retries until it does, or `timeout`. */
    toHaveFocus(options?: MatcherOptions): Promise<void>;
    /** A plugin's view, or a locator's node, looks as the saved image does;
        retries until it does, or `timeout`. Saved beside the test the first
        time, and again with Vitest's `-u`. */
    toMatchScreenshot(
      name?: string,
      options?: ScreenshotMatcherOptions,
    ): Promise<void>;
  }
}

const TIMEOUT = 5000;
// Between checks: short at first, as a locator's own waits are.
const DELAYS = [0, 20, 50, 100, 250];

interface MatcherContext {
  /** Under `.not`; Vitest may leave it out otherwise. */
  isNot?: boolean;
  testPath?: string | undefined;
  currentTestName?: string | undefined;
  snapshotState?: object;
}

interface Reading {
  ok: boolean;
  seen: string;
}

function locator(received: unknown, matcher: string): Locator {
  if (!(received instanceof Locator))
    throw new TypeError(
      `${matcher} expects a locator, such as plugin.getByText("Gain")`,
    );
  return received;
}

/** Waits for the state wanted, or under `.not` for its opposite. */
async function state(
  context: MatcherContext,
  received: Locator,
  wanted: 'visible' | 'hidden',
  options: MatcherOptions,
) {
  const opposite = wanted === 'visible' ? 'hidden' : 'visible';
  try {
    await received.waitFor({
      state: context.isNot ? opposite : wanted,
      timeout: options.timeout ?? TIMEOUT,
    });
    return { pass: !context.isNot, message: () => '' };
  } catch (error) {
    if (!isDriverError(error, 'TIMEOUT')) throw error;
    const { message } = error;
    return { pass: context.isNot === true, message: () => message };
  }
}

function shown(value: string | RegExp | undefined): string {
  return value === undefined ? 'no text' : JSON.stringify(String(value));
}

/** Keeps reading the one matching node until it is as wanted, or `timeout`. */
async function eventually(
  context: MatcherContext,
  found: Locator,
  wanted: string,
  options: MatcherOptions,
  read: (node: DebugNode, timeout: number) => Reading | Promise<Reading>,
) {
  const isNot = context.isNot === true;
  const budget = options.timeout ?? TIMEOUT;
  const deadline = Date.now() + budget;
  const remaining = () => Math.max(deadline - Date.now(), 1000);
  let seen = 'it matches no node';
  for (let attempt = 1; ; ++attempt) {
    try {
      const nodes = await found.all({ timeout: remaining() });
      if (nodes.length === 1) {
        const reading = await read(nodes[0]!, remaining());
        if (reading.ok !== isNot) return { pass: !isNot, message: () => '' };
        seen = reading.seen;
      } else if (nodes.length > 1) {
        seen = `it matches ${nodes.length} nodes; make the query unique`;
      } else seen = 'it matches no node';
    } catch (error) {
      // The tree changed under it: the next look sees the new one.
      if (
        !isDriverError(error) ||
        ![
          'STALE_NODE',
          'GENERATION_CHANGED',
          'ELEMENT_NOT_FOUND',
          'AMBIGUOUS_ELEMENT',
          'TIMEOUT',
        ].includes(error.code)
      )
        throw error;
      seen = error.message;
    }
    const wait = DELAYS[Math.min(attempt, DELAYS.length - 1)]!;
    if (Date.now() + wait >= deadline) break;
    await new Promise((settled) => setTimeout(settled, wait));
  }
  return {
    pass: isNot,
    message: () =>
      `Expected ${found} ${isNot ? 'not ' : ''}${wanted} within ${budget} ms: ${seen}`,
  };
}

/** The `states` of a node's accessibility: `checked` is named by the engine. */
async function states(
  found: Locator,
  timeout: number,
): Promise<Record<string, unknown>> {
  const { states: value } = await found.getAccessibility({ timeout });
  return (value ?? {}) as Record<string, unknown>;
}

// One test's unnamed screenshots, in order.
const unnamed = new Map<string, number>();

export const e2eMatchers = {
  async toBeVisible(
    this: MatcherContext,
    received: unknown,
    options: MatcherOptions = {},
  ) {
    return state(this, locator(received, 'toBeVisible'), 'visible', options);
  },

  async toBeHidden(
    this: MatcherContext,
    received: unknown,
    options: MatcherOptions = {},
  ) {
    return state(this, locator(received, 'toBeHidden'), 'hidden', options);
  },

  async toHaveText(
    this: MatcherContext,
    received: unknown,
    expected: string | RegExp,
    options: MatcherOptions = {},
  ) {
    return eventually(
      this,
      locator(received, 'toHaveText'),
      `to have text ${shown(expected)}`,
      options,
      ({ text }) => ({
        ok:
          text !== undefined &&
          (typeof expected === 'string'
            ? text === expected
            : expected.test(text)),
        seen: `it has ${shown(text)}`,
      }),
    );
  },

  async toBeChecked(
    this: MatcherContext,
    received: unknown,
    options: MatcherOptions = {},
  ) {
    const found = locator(received, 'toBeChecked');
    return eventually(
      this,
      found,
      'to be checked',
      options,
      async (_, time) => {
        const { checked } = await states(found, time);
        return {
          ok: checked === 'true' || checked === true,
          seen: `it is ${checked === undefined ? 'not a checkable node, or unset' : `checked: ${String(checked)}`}`,
        };
      },
    );
  },

  async toBeEnabled(
    this: MatcherContext,
    received: unknown,
    options: MatcherOptions = {},
  ) {
    const found = locator(received, 'toBeEnabled');
    return eventually(
      this,
      found,
      'to be enabled',
      options,
      async (_, time) => {
        const { disabled } = await states(found, time);
        return {
          ok: disabled !== true,
          seen: `it is ${disabled === true ? 'disabled' : 'enabled'}`,
        };
      },
    );
  },

  async toHaveFocus(
    this: MatcherContext,
    received: unknown,
    options: MatcherOptions = {},
  ) {
    return eventually(
      this,
      locator(received, 'toHaveFocus'),
      'to have focus',
      options,
      ({ focused }) => ({
        ok: focused,
        seen: `it ${focused ? 'has' : 'does not have'} focus`,
      }),
    );
  },

  async toMatchScreenshot(
    this: MatcherContext,
    received: unknown,
    name?: string,
    options: ScreenshotMatcherOptions = {},
  ) {
    const capture = (received as { screenshot?: unknown } | null | undefined)
      ?.screenshot;
    if (typeof capture !== 'function')
      throw new TypeError(
        'toMatchScreenshot expects a plugin or a locator, such as plugin.getByText("Gain")',
      );
    if (this.isNot)
      throw new TypeError(
        'toMatchScreenshot has no .not: an image can differ in too many ways to mean anything',
      );
    const file = this.testPath!;
    const test = this.currentTestName ?? basename(file);
    let image = name;
    if (image === undefined) {
      const count = (unnamed.get(test) ?? 0) + 1;
      unnamed.set(test, count);
      image = count === 1 ? test : `${test} ${count}`;
    }
    const safeName = image.replace(/[^\w.-]+/g, '-');
    const root = inject('soundorE2E')?.root ?? process.cwd();
    return compareScreenshot({
      ...options,
      capture: (call) =>
        (capture as Locator['screenshot']).call(received, call),
      baseline: join(
        dirname(file),
        '__screenshots__',
        basename(file),
        `${safeName}-${process.platform}.png`,
      ),
      results: join(resultsDir(root, file, test), safeName),
      // Vitest's -u, and no new snapshots on CI, as for its own snapshots.
      update:
        (this.snapshotState as { _updateSnapshot?: UpdateMode } | undefined)
          ?._updateSnapshot ?? (process.env['CI'] ? 'none' : 'new'),
    });
  },
};
