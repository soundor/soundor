import { expect, it } from 'vitest';

import { createTestRuntime } from './runtime';
it('captures validated UI MIDI and explicitly publishes events without an audio implementation', () => {
  const runtime = createTestRuntime();
  const message = {
    type: 'noteOn' as const,
    channel: 16,
    note: 127,
    velocity: 0,
  };
  expect(runtime.midi.send(message)).toBe('sent');
  expect(runtime.takeMidiMessages()).toEqual([message]);
  expect(runtime.takeMidiMessages()).toEqual([]);
  const events: unknown[] = [];
  const stop = runtime.midi.subscribe((event) => events.push(event));
  runtime.emitMidi([{ message, sampleOffset: 17 }]);
  stop();
  runtime.emitMidi([{ message, sampleOffset: 18 }]);
  expect(events).toEqual([{ message, sampleOffset: 17 }]);
  runtime.dispose();
  expect(runtime.midi.send(message)).toBe('inactive');
});
