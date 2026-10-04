// soundor:host — what the plugin knows about its host: the plugin's identity,
// the audio setup, and the transport. Snapshots are plain, immutable data read
// on the UI thread; nothing here touches the audio thread.

import {
  hostSnapshot,
  pluginId,
  pluginName,
  setHostListener,
} from 'soundor:internal/platform';
import { reportError } from 'soundor:internal/web/console';

function freeze(snapshot) {
  if (snapshot.transport !== null) {
    Object.freeze(snapshot.transport.timeSignature);
    Object.freeze(snapshot.transport);
  }
  return Object.freeze(snapshot);
}

export const plugin = Object.freeze({ id: pluginId, name: pluginName });

/** The current host state: sample rate, block size, host name, transport. */
export function snapshot() {
  return freeze(hostSnapshot());
}

const listeners = new Set();

/**
 * Calls `listener` with the new snapshot whenever the host state changes —
 * while the transport plays, once per frame. Returns an unsubscribe function.
 */
export function subscribe(listener) {
  if (typeof listener !== 'function')
    throw new TypeError('subscribe() expects a function');
  const entry = { listener };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

setHostListener((next) => {
  const frozen = freeze(next);
  for (const { listener } of [...listeners]) {
    try {
      listener(frozen);
    } catch (error) {
      reportError(error);
    }
  }
});
