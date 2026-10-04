/** Reports an error from a callback like an uncaught one, without stopping. */
export function report(error: unknown): void {
  // Every browser has reportError(); test environments may not.
  if (typeof globalThis.reportError === 'function') reportError(error);
  else console.error(error);
}
