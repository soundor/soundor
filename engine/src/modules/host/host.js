// soundor:host — what the plugin knows about its host: the plugin's identity,
// the audio setup, and the transport. Snapshots are plain, immutable data read
// on the UI thread; nothing here touches the audio thread.

import {
  hostSnapshot,
  pluginId,
  pluginName,
  pluginVersion,
  hostEnvironment,
  setHostListener,
} from 'soundor:internal/platform';
import { reportError } from 'soundor:internal/web/console';

function freeze(snapshot) {
  if (snapshot.transport !== null) {
    Object.freeze(snapshot.transport.timeSignature);
    if (snapshot.transport.timecode) Object.freeze(snapshot.transport.timecode);
    Object.freeze(snapshot.transport);
  }
  if (snapshot.track) Object.freeze(snapshot.track);
  return Object.freeze(snapshot);
}

export const plugin = Object.freeze({
  id: pluginId,
  name: pluginName,
  version: pluginVersion,
});
export const environment = Object.freeze(hostEnvironment);

/** The latest snapshot; replaced (never changed) when the host state changes. */
let latest = null;

/**
 * The current host state: sample rate, block size, host name, transport. The
 * same object until the state changes, so it works as a store snapshot (e.g.
 * React's useSyncExternalStore(subscribe, snapshot)).
 */
export function getHostState() {
  latest ??= freeze(hostSnapshot());
  return latest;
}

const listeners = new Set();

/**
 * Calls `listener` with the new snapshot whenever the host state changes —
 * while the transport plays, once per frame. Returns an unsubscribe function.
 */
export function subscribeHostState(listener) {
  if (typeof listener !== 'function')
    throw new TypeError('subscribeHostState() expects a function');
  const entry = { listener };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

setHostListener((next) => {
  const frozen = freeze(next);
  latest = frozen;
  for (const { listener } of [...listeners]) {
    try {
      listener(frozen);
    } catch (error) {
      reportError(error);
    }
  }
});
