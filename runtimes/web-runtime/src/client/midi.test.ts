import type {
  ProcessorNode,
  WorkletMessage,
} from '@soundor/engine/web/processor';
import { expect, it, vi } from 'vitest';

import { WebMidiHost } from './midi';

function audio() {
  const processor = {
    sendMidi: vi.fn<ProcessorNode['sendMidi']>(() => 'sent'),
    observeMidi: vi.fn<ProcessorNode['observeMidi']>(),
    reset: vi.fn<() => void>(),
  };
  const context = {
    currentTime: 2,
    sampleRate: 48000,
    getOutputTimestamp: () => ({ contextTime: 2, performanceTime: 1000 }),
  };
  return {
    processor,
    context,
    attach: (host: WebMidiHost) =>
      host.attach(
        processor as unknown as ProcessorNode,
        context as AudioContext,
      ),
  };
}
function devices() {
  const input = {
    id: 'keys',
    name: 'Keys',
    manufacturer: 'Test',
    state: 'connected',
    onmidimessage: null as ((event: MIDIMessageEvent) => void) | null,
  };
  const output = {
    id: 'synth',
    name: 'Synth',
    manufacturer: 'Test',
    state: 'connected',
    send: vi.fn<(bytes: number[], time?: number) => void>(),
    clear: vi.fn<() => void>(),
  };
  const access = {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null as (() => void) | null,
  };
  const requestMIDIAccess = vi
    .fn<Navigator['requestMIDIAccess']>()
    .mockResolvedValue(access as unknown as MIDIAccess);
  return { input, output, access, requestMIDIAccess };
}
it('virtual UI and controller routes do not require permissions or host input', () => {
  const requestMIDIAccess = vi.fn<Navigator['requestMIDIAccess']>();
  const host = new WebMidiHost({}, { requestMIDIAccess });
  const a = audio();
  a.attach(host);
  expect(
    host.api.send({ type: 'noteOn', channel: 1, note: 60, velocity: 0 }),
  ).toBe('sent');
  expect(a.processor.sendMidi).toHaveBeenCalledWith(0x3c90, 2, 0);
  expect(
    host.inject({ type: 'noteOn', channel: 1, note: 60, velocity: 100 }),
  ).toBe('inactive');
  expect(requestMIDIAccess).not.toHaveBeenCalled();
  host.detach();
  expect(
    host.api.send({ type: 'noteOff', channel: 1, note: 60, velocity: 0 }),
  ).toBe('inactive');
  host.dispose();
});
it('reports unsupported and denied Web MIDI without breaking virtual MIDI', async () => {
  const unsupported = new WebMidiHost(
    {},
    {} as Pick<Navigator, 'requestMIDIAccess'>,
  );
  expect(await unsupported.requestAccess()).toBe('unsupported');
  const requestMIDIAccess = vi
    .fn<Navigator['requestMIDIAccess']>()
    .mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
  const denied = new WebMidiHost({}, { requestMIDIAccess });
  expect(await denied.requestAccess()).toBe('denied');
  const a = audio();
  a.attach(denied);
  expect(
    denied.api.send({ type: 'programChange', channel: 16, program: 127 }),
  ).toBe('sent');
  denied.dispose();
  unsupported.dispose();
});
it('enumerates explicit routes and recovers on input disconnection', async () => {
  const d = devices();
  const host = new WebMidiHost({ input: true, output: true }, d);
  const a = audio();
  a.attach(host);
  expect(await host.requestAccess()).toBe('granted');
  expect(host.inputs[0]?.id).toBe('keys');
  expect(host.outputs[0]?.id).toBe('synth');
  expect(host.output).toBeNull();
  expect(d.output.send).not.toHaveBeenCalled();
  host.selectInput('keys');
  d.input.onmidimessage?.({
    data: Uint8Array.of(0x9f, 127, 0),
  } as MIDIMessageEvent);
  expect(a.processor.sendMidi).toHaveBeenLastCalledWith(0x7f9f, 1, 0);
  const before = a.processor.reset.mock.calls.length;
  d.input.state = 'disconnected';
  d.access.onstatechange?.();
  expect(a.processor.reset.mock.calls.length).toBeGreaterThan(before);
  host.dispose();
  expect(d.input.onmidimessage).toBeNull();
});
it('routes explicit output using audio/device clocks and clears notes on reset', async () => {
  const d = devices();
  const host = new WebMidiHost({ output: true }, d);
  const a = audio();
  a.attach(host);
  await host.requestAccess();
  host.selectOutput('synth');
  d.output.send.mockClear();
  const output = new Uint32Array([24, 0x643c90]);
  const batch: Extract<WorkletMessage, { type: 'midi' }> = {
    type: 'midi',
    output,
    outputCount: 1,
    publications: new Uint32Array(),
    publicationCount: 0,
    dropped: 0,
    reset: false,
    time: 2,
  };
  host.receive(batch);
  expect(d.output.send).toHaveBeenCalledExactlyOnceWith(
    [0x90, 60, 100],
    expect.any(Number),
  );
  host.receive({ ...batch, reset: true });
  expect(d.output.clear).toHaveBeenCalled();
  expect(d.output.send).toHaveBeenCalledWith([0xbf, 120, 0]);
  host.dispose();
});
it('requires host capabilities only for selected physical/virtual host routes', async () => {
  const d = devices();
  const host = new WebMidiHost({}, d);
  await host.requestAccess();
  expect(() => host.selectInput('keys')).toThrow('Host MIDI input is disabled');
  expect(() => host.selectOutput('synth')).toThrow(
    'Host MIDI output is disabled',
  );
  host.dispose();
});
