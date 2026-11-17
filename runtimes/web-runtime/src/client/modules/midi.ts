import type { Midi } from 'soundor:midi';

import { hostContext } from '../context';
/** Resolve the current instance for each operation, including after host restart. */
export const midi: Midi = {
  send: (message) => hostContext().midi.api.send(message),
  subscribe: (listener, options) =>
    hostContext().midi.api.subscribe(listener, options),
  subscribeBatch: (listener) => hostContext().midi.api.subscribeBatch(listener),
};
