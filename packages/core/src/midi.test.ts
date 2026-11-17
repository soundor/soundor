import { expect, it } from 'vitest';

import { decodeMidi, encodeMidi } from './midi';

it('round trips every channel message, channel and boundary value', () => {
  for (let status = 0x80; status < 0xf0; status++) {
    for (const a of [0, 60, 127])
      for (const b of [0, 100, 127]) {
        const bytes = Uint8Array.from(
          status >> 4 === 12 || status >> 4 === 13
            ? [status, a]
            : [status, a, b],
        );
        expect(encodeMidi(decodeMidi(bytes))).toEqual(bytes);
      }
  }
  expect(decodeMidi([0x90, 60, 0])).toEqual({
    type: 'noteOn',
    channel: 1,
    note: 60,
    velocity: 0,
  });
});
it.each([
  [],
  [0xf0, 0, 0],
  [0x90, 128, 0],
  [0x90, -1, 0],
  [0x90, 60],
  [0x90, 60, NaN],
])('rejects invalid bytes %j', (...bytes) => {
  expect(() => decodeMidi(bytes)).toThrow('MIDI:');
});
it.each([0, 17, 1.5, NaN])('rejects invalid channel %s', (channel) => {
  expect(() =>
    encodeMidi({ type: 'noteOn', channel, note: 60, velocity: 100 }),
  ).toThrow('MIDI:');
});
it.each([-1, 128, 0.5, Infinity])('rejects invalid data %s', (velocity) => {
  expect(() =>
    encodeMidi({ type: 'noteOn', channel: 1, note: 60, velocity }),
  ).toThrow('MIDI:');
});

import { vi } from 'vitest';

import { createMidi } from './midi';

it('validates sends and reports transport overflow/inactivity', () => {
  const send = vi.fn<(bytes: Uint8Array) => 'full'>(() => 'full' as const);
  const bridge = createMidi({
    send,
    observe: vi.fn<() => void>(),
    reportError: vi.fn<() => void>(),
  });
  expect(
    bridge.midi.send({ type: 'noteOn', channel: 1, note: 60, velocity: 0 }),
  ).toBe('full');
  expect(send).toHaveBeenCalledWith(Uint8Array.of(0x90, 60, 0));
  expect(() =>
    bridge.midi.send({ type: 'pitchBend', channel: 1, value: 16384 }),
  ).toThrow('MIDI:');
  bridge.dispose();
  expect(
    bridge.midi.send({ type: 'noteOff', channel: 1, note: 60, velocity: 0 }),
  ).toBe('inactive');
  expect(send).toHaveBeenCalledTimes(1);
});
it('delivers batches, resets, explicit opt-in, errors and unsubscribe lifecycle', () => {
  const observe = vi.fn<() => void>();
  const reportError = vi.fn<() => void>();
  const bridge = createMidi({ send: () => 'sent', observe, reportError });
  const order: string[] = [];
  const un = bridge.midi.subscribe((event) => order.push(event.message.type), {
    onReset: () => order.push('reset'),
  });
  const failing = bridge.midi.subscribe(() => {
    throw new Error('subscriber failed');
  });
  bridge.receive({
    events: [
      {
        message: { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
        sampleOffset: 3,
      },
    ],
    dropped: 1,
    reset: true,
  });
  expect(order).toEqual(['reset', 'noteOn']);
  expect(reportError).toHaveBeenCalledExactlyOnceWith(
    new Error('subscriber failed'),
  );
  un();
  un();
  failing();
  expect(observe.mock.calls).toEqual([[true], [false]]);
  bridge.dispose();
  bridge.dispose();
  expect(() => bridge.midi.subscribe(() => {})).toThrow(
    'MIDI: instance shut down',
  );
});
it('does not deliver a queued batch to a listener removed during delivery', () => {
  const bridge = createMidi({
    send: () => 'sent',
    observe: vi.fn<() => void>(),
    reportError: vi.fn<() => void>(),
  });
  let remove = () => {};
  bridge.midi.subscribeBatch(() => remove());
  const listener = vi.fn<() => void>();
  remove = bridge.midi.subscribeBatch(listener);
  bridge.receive({ events: [], dropped: 0, reset: true });
  expect(listener).not.toHaveBeenCalled();
});
it('stops individual-event delivery when unsubscribed inside a batch', () => {
  const bridge = createMidi({
    send: () => 'sent',
    observe: vi.fn<() => void>(),
    reportError: vi.fn<() => void>(),
  });
  let calls = 0;
  let unsubscribe = () => {};
  unsubscribe = bridge.midi.subscribe(() => {
    calls++;
    unsubscribe();
  });
  const event = {
    message: { type: 'noteOff' as const, channel: 1, note: 60, velocity: 0 },
    sampleOffset: 0,
  };
  bridge.receive({ events: [event, event], dropped: 0, reset: false });
  expect(calls).toBe(1);
});
it('rolls back registration when the adapter refuses observation', () => {
  let attempts = 0;
  const observe = vi.fn<(enabled: boolean) => void>((enabled) => {
    if (enabled && attempts++ === 0) throw new Error('transport unavailable');
  });
  const bridge = createMidi({
    send: () => 'sent',
    observe,
    reportError: vi.fn<() => void>(),
  });
  expect(() => bridge.midi.subscribeBatch(() => {})).toThrow(
    'transport unavailable',
  );
  const remove = bridge.midi.subscribeBatch(() => {});
  expect(observe.mock.calls).toEqual([[true], [true]]);
  remove();
  expect(observe).toHaveBeenLastCalledWith(false);
});
