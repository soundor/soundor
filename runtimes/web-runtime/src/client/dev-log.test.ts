// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forwardLogs } from './dev-log';
import type { UiLogEntry } from './protocol';

let stop = (): void => {};
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

function forward(): UiLogEntry[] {
  const entries: UiLogEntry[] = [];
  for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  stop = forwardLogs((entry) => entries.push(entry));
  return entries;
}

describe('forwardLogs', () => {
  it('copies console calls with their levels', () => {
    const entries = forward();
    console.log('gain', 0.5, { a: 1 });
    console.warn('careful');
    console.debug('detail');
    console.debug('[vite] connected.');
    expect(entries).toEqual([
      { level: 'info', message: 'gain 0.5 {"a":1}' },
      { level: 'warn', message: 'careful' },
      { level: 'debug', message: 'detail' },
    ]);
  });

  it('sends stacks without the dev server cache queries', () => {
    const entries = forward();
    const error = new Error('boom');
    error.stack =
      'Error: boom\n    at f (http://localhost:5173/@fs/p/.soundor/ui/development/bundle.js?t=171:3:7)';
    console.error(error);
    expect(entries[0]).toEqual({
      level: 'error',
      message:
        'Error: boom\n    at f (http://localhost:5173/@fs/p/.soundor/ui/development/bundle.js:3:7)',
    });
  });

  it('copies uncaught errors and rejections', () => {
    const entries = forward();
    dispatchEvent(
      new ErrorEvent('error', { error: new TypeError('bad'), message: 'bad' }),
    );
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: 'nope' });
    dispatchEvent(rejection);
    expect(entries.map((entry) => entry.level)).toEqual(['error', 'error']);
    expect(entries[0]!.message).toMatch(/^Uncaught TypeError: bad/);
    expect(entries[1]!.message).toBe('Uncaught (in promise) nope');
  });

  it('restores the console when stopped', () => {
    const entries = forward();
    stop();
    console.warn('after');
    expect(entries).toEqual([]);
  });
});
