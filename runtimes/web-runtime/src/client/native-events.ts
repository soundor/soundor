/**
 * The events of `soundor:native` in the browser, delivered as the JUCE
 * runtime delivers them (`js/Events.h` in the engine): the project's
 * `runtimes/web/src/native.ts` publishes them through the generated
 * `events`, and the plugin UI's subscribers receive them later, never inside
 * the publishing call, in the order they were published.
 *
 * - A published value is checked against the event's fields and copied, as
 *   the native bindings convert one; a mismatch throws in the publisher.
 * - Bounded: the page holds at most {@link EVENT_CAPACITY} undelivered events
 *   and drops newer ones (the publisher returns false), reporting how many
 *   when it next delivers.
 * - The subscribers of one event receive the same value. Subscribing during a
 *   delivery takes effect from the next event; one removed during it is not
 *   called again. A subscriber that throws is reported; the others still run.
 */

import { hostContext } from './context';
import type { WebNativeEvent } from './manifest';
import { nativeEventValue, nativeTypes } from './native-values';
import { report } from './report';

/** Undelivered events the page holds, as a JUCE runtime context does. */
export const EVENT_CAPACITY = 1024;

interface Subscriber {
  readonly listener: (value: unknown) => void;
  active: boolean;
}

interface QueuedEvent {
  readonly index: number;
  readonly value: unknown;
}

let subscribers: Set<Subscriber>[] | undefined;
let queue: QueuedEvent[] = [];
let dropped = 0;
let scheduled = false;

function declared(): readonly WebNativeEvent[] {
  return hostContext().manifest.native.events;
}

function subscribersOf(index: number): Set<Subscriber> {
  subscribers ??= declared().map(() => new Set());
  return subscribers[index]!;
}

function deliver(): void {
  scheduled = false;
  const events = queue;
  queue = [];
  if (dropped > 0) {
    console.warn(
      `soundor:native: ${dropped} events were dropped: the UI did not take them in time (it holds ${EVENT_CAPACITY})`,
    );
    dropped = 0;
  }
  for (const { index, value } of events) {
    for (const subscriber of [...subscribersOf(index)]) {
      if (!subscriber.active) continue;
      try {
        subscriber.listener(value);
      } catch (error) {
        report(error);
      }
    }
  }
}

/** The `events` `soundor:native` exports: one subscribable event per name. */
export function nativeEvents(): Readonly<
  Record<string, { subscribe(listener: (value: unknown) => void): () => void }>
> {
  return Object.freeze(
    Object.fromEntries(
      declared().map((event, index) => [
        event.name,
        Object.freeze({
          subscribe(listener: (value: unknown) => void): () => void {
            if (typeof listener !== 'function') {
              throw new TypeError(
                `events.${event.name}.subscribe() expects a function, got ${listener === null ? 'null' : typeof listener}`,
              );
            }
            const subscriber: Subscriber = { listener, active: true };
            subscribersOf(index).add(subscriber);
            return () => {
              subscriber.active = false;
              subscribersOf(index).delete(subscriber);
            };
          },
        }),
      ]),
    ),
  );
}

/**
 * The publishers the generated `events` of the project's native contract
 * are: one per declared event, returning whether the page took it.
 */
export function nativeEventPublishers(): Readonly<
  Record<string, (value?: unknown) => boolean>
> {
  return Object.freeze(
    Object.fromEntries(
      declared().map((event, index) => [
        event.name,
        (value?: unknown) => publish(event, index, value),
      ]),
    ),
  );
}

function publish(
  event: WebNativeEvent,
  index: number,
  value: unknown,
): boolean {
  const checked = nativeEventValue(
    event,
    value,
    nativeTypes(hostContext().manifest.native.types),
  );
  if (queue.length >= EVENT_CAPACITY) {
    ++dropped;
    return false;
  }
  queue.push({ index, value: checked });
  if (!scheduled) {
    scheduled = true;
    setTimeout(deliver, 0);
  }
  return true;
}
