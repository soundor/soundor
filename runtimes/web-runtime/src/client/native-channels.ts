/**
 * The channels of `soundor:native` in the browser, with the JUCE runtime's
 * latest-value semantics (`js/Channels.h` in the engine): the project's
 * `runtimes/web` code publishes through the generated `channels`, and the
 * plugin UI receives the newest value once a frame.
 *
 * - A published value is checked against the channel's type; a buffer is
 *   copied (into the copy not yet delivered when there is one of its length)
 *   and refused, returning false, when longer than its `maxLength`.
 * - Latest only: a value replaces the one not yet delivered. Delivery runs
 *   on the next animation frame, so a hidden page delivers nothing and keeps
 *   one value per channel, never a queue.
 * - Each value is numbered (1 for the first); `get()` keeps the latest
 *   delivered, the same object until a newer one, and undefined before any.
 * - Subscribing during a delivery takes effect from the next value; one
 *   removed during it is not called again. A subscriber that throws is
 *   reported; the others still run.
 */

import { hostContext } from './context';
import type { WebNativeChannel } from './manifest';
import { nativeChannelValue } from './native-values';
import { report } from './report';

interface Subscriber {
  readonly listener: (value: unknown, sequence: number) => void;
  active: boolean;
}

interface ChannelState {
  readonly channel: WebNativeChannel;
  readonly subscribers: Set<Subscriber>;
  /** What get() returns. */
  value: unknown;
  /** Published, not yet delivered (only the newest). */
  pending: unknown;
  hasPending: boolean;
  /** Publications so far: the latest one's number. */
  published: number;
}

let states: ChannelState[] | undefined;
let scheduled = false;

function channelStates(): ChannelState[] {
  states ??= hostContext().manifest.native.channels.map((channel) => ({
    channel,
    subscribers: new Set(),
    value: undefined,
    pending: undefined,
    hasPending: false,
    published: 0,
  }));
  return states;
}

function deliver(): void {
  scheduled = false;
  for (const state of channelStates()) {
    if (!state.hasPending) continue;
    const value = state.pending;
    const sequence = state.published;
    state.value = value;
    state.pending = undefined;
    state.hasPending = false;
    for (const subscriber of [...state.subscribers]) {
      if (!subscriber.active) continue;
      try {
        subscriber.listener(value, sequence);
      } catch (error) {
        report(error);
      }
    }
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(deliver);
  else setTimeout(deliver, 16);
}

/** The `channels` `soundor:native` exports: one channel per name. */
export function nativeChannels(): Readonly<
  Record<
    string,
    {
      get(): unknown;
      subscribe(
        listener: (value: unknown, sequence: number) => void,
      ): () => void;
    }
  >
> {
  return Object.freeze(
    Object.fromEntries(
      channelStates().map((state) => [
        state.channel.name,
        // Closures, not methods: they work unbound
        // (useSyncExternalStore(channel.subscribe, channel.get)).
        Object.freeze({
          get: () => state.value,
          subscribe: (
            listener: (value: unknown, sequence: number) => void,
          ): (() => void) => {
            if (typeof listener !== 'function') {
              throw new TypeError(
                `channels.${state.channel.name}.subscribe() expects a function, got ${listener === null ? 'null' : typeof listener}`,
              );
            }
            const subscriber: Subscriber = { listener, active: true };
            state.subscribers.add(subscriber);
            return () => {
              subscriber.active = false;
              state.subscribers.delete(subscriber);
            };
          },
        }),
      ]),
    ),
  );
}

/**
 * The publishers the generated `channels` of the project's native contract
 * are: one `publish` per declared channel. A number's returns nothing; a
 * buffer's whether it fit.
 */
export function nativeChannelPublishers(): Readonly<
  Record<string, { publish(value: unknown): boolean | undefined }>
> {
  return Object.freeze(
    Object.fromEntries(
      channelStates().map((state) => [
        state.channel.name,
        Object.freeze({
          publish: (value: unknown) => publish(state, value),
        }),
      ]),
    ),
  );
}

type TypedArray = Float32Array | Float64Array | Int32Array | BigInt64Array;

function publish(state: ChannelState, value: unknown): boolean | undefined {
  const checked = nativeChannelValue(state.channel, value);
  if (state.channel.kind === 'number') {
    state.pending = checked;
  } else {
    const values = checked as TypedArray;
    if (values.length > state.channel.maxLength) return false;
    const pending = state.hasPending
      ? (state.pending as TypedArray)
      : undefined;
    // Reuses the copy nobody received yet; a delivered one is never changed.
    if (pending !== undefined && pending.length === values.length)
      (pending as Float32Array).set(values as Float32Array);
    else state.pending = values.slice();
  }
  state.hasPending = true;
  ++state.published;
  schedule();
  return state.channel.kind === 'buffer' ? true : undefined;
}
