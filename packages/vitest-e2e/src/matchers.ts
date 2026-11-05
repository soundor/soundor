import { isDriverError, Locator } from '@soundor/driver';

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
  }
}

const TIMEOUT = 5000;
// Between checks: short at first, as a locator's own waits are.
const DELAYS = [0, 20, 50, 100, 250];

interface MatcherContext {
  /** Under `.not`; Vitest may leave it out otherwise. */
  isNot?: boolean;
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
    const found = locator(received, 'toHaveText');
    const isNot = this.isNot === true;
    const budget = options.timeout ?? TIMEOUT;
    const deadline = Date.now() + budget;
    const has = (text: string | undefined) =>
      text !== undefined &&
      (typeof expected === 'string' ? text === expected : expected.test(text));
    let seen = 'it matches no node';
    for (let attempt = 1; ; ++attempt) {
      const nodes = await found.all({
        timeout: Math.max(deadline - Date.now(), 1000),
      });
      if (nodes.length === 1) {
        const { text } = nodes[0]!;
        if (has(text) !== isNot) return { pass: !isNot, message: () => '' };
        seen = `it has ${shown(text)}`;
      } else if (nodes.length > 1) {
        seen = `it matches ${nodes.length} nodes; make the query unique`;
      } else seen = 'it matches no node';
      const wait = DELAYS[Math.min(attempt, DELAYS.length - 1)]!;
      if (Date.now() + wait >= deadline) break;
      await new Promise((settled) => setTimeout(settled, wait));
    }
    const wanted = `${found} ${isNot ? 'not ' : ''}to have text ${shown(expected)}`;
    return {
      pass: isNot,
      message: () => `Expected ${wanted} within ${budget} ms: ${seen}`,
    };
  },
};
