// `soundor:host` in the browser: the plugin's identity and the Web host's
// state. Read-only: the host controls its transport, the plugin observes it.

import { hostContext } from '../context';
import type { HostSnapshot } from '../host';

const { host } = hostContext();

/** This plugin's identity, from soundor.config. */
export const plugin = hostContext().plugin;

/** The current host state; the same object until the state changes. */
export function snapshot(): HostSnapshot {
  return host.snapshot();
}

/**
 * Calls `listener` whenever the host state changes (every frame while
 * playing). Returns an unsubscribe function.
 */
export function subscribe(
  listener: (snapshot: HostSnapshot) => void,
): () => void {
  return host.subscribe(listener);
}

export type { HostSnapshot, Transport } from '../host';
