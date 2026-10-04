/**
 * `soundor dev` shows the plugin's console in the terminal, whatever runs
 * the plugin. In the browser, console calls and uncaught errors are copied
 * to it (they still appear in the browser's own console).
 */

import type { UiLogEntry } from './protocol';

const METHODS = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
} as const;

/** Copies the console to `send` until the returned function is called. */
export function forwardLogs(send: (entry: UiLogEntry) => void): () => void {
  const post = (level: UiLogEntry['level'], message: string): void => {
    try {
      send({ level, message: withoutQueries(message) });
    } catch {
      // The terminal is a convenience; the page must not fail for it.
    }
  };
  const originals = Object.keys(METHODS).map((method) => {
    const name = method as keyof typeof METHODS;
    const original = console[name];
    console[name] = (...data: unknown[]) => {
      original.apply(console, data);
      const message = data.map(describe).join(' ');
      // Vite's client talks about its own connection; that is not the plugin.
      if (!message.startsWith('[vite]')) post(METHODS[name], message);
    };
    return () => {
      console[name] = original;
    };
  });
  const onError = (event: ErrorEvent): void =>
    post('error', `Uncaught ${describe(event.error ?? event.message)}`);
  const onRejection = (event: PromiseRejectionEvent): void =>
    post('error', `Uncaught (in promise) ${describe(event.reason)}`);
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  return () => {
    for (const restore of originals) restore();
    removeEventListener('error', onError);
    removeEventListener('unhandledrejection', onRejection);
  };
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    return value.stack?.includes(value.message)
      ? value.stack
      : `${head}\n${value.stack ?? ''}`.trim();
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Stack frames name the dev server's URLs, which carry cache-busting queries
 * (`bundle.js?t=…:3:7`); without them the terminal maps frames to sources.
 */
function withoutQueries(message: string): string {
  return message.replace(/(\.[cm]?js)\?[^:\s)]*/g, '$1');
}
