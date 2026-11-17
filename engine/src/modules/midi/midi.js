import { send, observe, events } from 'soundor:internal/midi';
let subscriptions = 0;
function subscribeBatch(listener) {
  if (typeof listener !== 'function')
    throw new TypeError('MIDI: expected listener');
  if (subscriptions === 128)
    throw new RangeError('MIDI: at most 128 subscriptions');
  if (subscriptions === 0) observe(true);
  subscriptions++;
  const remove = events.batch.subscribe(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    remove();
    if (--subscriptions === 0) observe(false);
  };
}
export const midi = Object.freeze({
  send,
  subscribeBatch,
  subscribe(listener, options) {
    if (typeof listener !== 'function')
      throw new TypeError('MIDI: expected listener');
    let active = true;
    const remove = subscribeBatch((batch) => {
      if (batch.reset && options && options.onReset)
        options.onReset(batch.dropped);
      for (const event of batch.events) {
        if (!active) return;
        listener(event);
      }
    });
    return () => {
      active = false;
      remove();
    };
  },
});
