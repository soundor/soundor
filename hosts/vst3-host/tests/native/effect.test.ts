// Fixture Gain: loading, errors, parameters, audio, buses, state, latency.
import { afterEach, describe, expect, test } from 'vitest';

import { Vst3HostError, launchHost } from '../../src/index.ts';
import {
  BYPASS,
  GAIN,
  LATENCY,
  PEAK,
  bundle,
  closeAll,
  constant,
  foreignBundle,
  launch,
  ramp,
} from './fixtures.ts';

afterEach(closeAll);

async function failure(promise: Promise<unknown>): Promise<Vst3HostError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Vst3HostError);
  return error as Vst3HostError;
}

describe('loading', () => {
  test('is ready with the plugin, its classes and its buses', async () => {
    const host = await launch('Fixture Gain');
    expect(host.identity).toMatchObject({ protocol: 1, mode: 'headless' });
    expect(host.info).toMatchObject({
      name: 'Fixture Gain',
      vendor: 'Soundor',
      separateController: true,
      sampleRate: 48000,
      blockSize: 512,
      processMode: 'realtime',
      latencySamples: 0,
      tailSamples: 0,
    });
    expect(host.info.classes.map((c) => c.name)).toEqual([
      'Fixture Gain',
      'Fixture Synth',
      'Fixture Broken',
    ]);
    expect(host.info.buses.audioInputs).toMatchObject([
      {
        name: 'Stereo In',
        type: 'main',
        channels: 2,
        arrangement: 'Stereo',
        active: true,
      },
      { name: 'Sidechain', type: 'aux', channels: 1, active: false },
    ]);
    expect(host.info.buses.audioOutputs).toMatchObject([
      { channels: 2, active: true },
    ]);
  });

  test('selects a class by id', async () => {
    const first = await launch('Fixture Gain');
    const byId = await launchHost({
      plugin: bundle,
      classId: first.info.classId,
    });
    expect(byId.info.name).toBe('Fixture Gain');
    await byId.close();
  });

  test.each([
    ['plugin-not-found', { plugin: '/nowhere/Missing.vst3' }],
    ['invalid-bundle', { plugin: import.meta.filename }],
    ['ambiguous-class', { plugin: bundle }],
    ['no-matching-class', { plugin: bundle, className: 'Fixture Reverb' }],
    ['initialization-failed', { plugin: bundle, className: 'Fixture Broken' }],
  ] as const)('reports %s', async (code, options) => {
    expect((await failure(launchHost(options))).code).toBe(code);
  });

  test('lists the classes to choose from', async () => {
    const error = await failure(launchHost({ plugin: bundle }));
    expect(error.details?.classes).toHaveLength(3);
  });

  test('keeps a plugin writing to stdout out of the protocol', async () => {
    const logs: string[] = [];
    const error = await failure(
      launchHost({
        plugin: bundle,
        className: 'Fixture Broken',
        onLog: (line) => logs.push(line),
      }),
    );
    // The protocol is intact: the failure is the plugin's, not a corrupt frame.
    expect(error.code).toBe('initialization-failed');
    // On Windows a plugin with its own C runtime writes to the stdout handle
    // the process started with, which the host has closed: the text is lost.
    expect(logs.includes('Fixture Broken writes to stdout')).toBe(
      process.platform !== 'win32',
    );
  });

  test('names the architectures of a plugin for another CPU', async () => {
    const error = await failure(launchHost({ plugin: foreignBundle() }));
    expect(error.code).toBe('incompatible-architecture');
    expect(error.message).toContain(`this host runs as ${process.arch}`);
    expect(error.details?.hostArchitecture).toBe(process.arch);
  });

  test('reports a missing executable', async () => {
    const error = await failure(
      launchHost({ plugin: bundle, executable: '/nowhere/soundor-vst3-host' }),
    );
    expect(error.code).toBe('executable-not-found');
  });
});

describe('parameters', () => {
  test('are listed with stable ids, normalized and plain values', async () => {
    const host = await launch('Fixture Gain');
    const parameters = await host.getParameters();
    expect(parameters.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parameters[0]).toMatchObject({
      id: GAIN,
      title: 'Gain',
      units: 'x',
      normalized: 0.5,
      defaultNormalized: 0.5,
      flags: { canAutomate: true, readOnly: false },
    });
    expect(parameters[1]).toMatchObject({
      stepCount: 1,
      flags: { bypass: true },
      display: 'Off',
    });
    expect(parameters.find((p) => p.id === PEAK)?.flags.readOnly).toBe(true);
  });

  test('take normalized or plain values and reject others', async () => {
    const host = await launch('Fixture Gain');
    expect((await host.setParameter(GAIN, 0.25)).normalized).toBe(0.25);
    expect((await host.setParameter(LATENCY, { plain: 2 })).normalized).toBe(
      0.5,
    );
    expect((await failure(host.setParameter(GAIN, 1.5))).code).toBe(
      'invalid-request',
    );
    expect((await failure(host.setParameter(PEAK, 0.5))).code).toBe(
      'invalid-request',
    );
    expect((await failure(host.setParameter(999, 0.5))).code).toBe(
      'unknown-parameter',
    );
    expect((await failure(host.getParameter(999))).code).toBe(
      'unknown-parameter',
    );
  });
});

describe('processing', () => {
  test('applies gain, and a set parameter at the next call', async () => {
    const host = await launch('Fixture Gain');
    const input = ramp(300);
    const first = await host.process({ inputs: [[input, input]] });
    expect(first.outputs[0]![0]).toEqual(input); // gain 0.5 → × 1
    await host.setParameter(GAIN, 0.25);
    const second = await host.process({ inputs: [[input, input]] });
    expect(second.outputs[0]![1]![50]).toBeCloseTo(input[50]! * 0.5, 6);
  });

  test('automates sample-accurately across blocks', async () => {
    const host = await launch('Fixture Gain', { blockSize: 64 });
    const input = constant(200, 1);
    const result = await host.process({
      inputs: [[input, input]],
      parameterChanges: [
        { id: GAIN, value: 1, time: 100 },
        { id: GAIN, value: 0, time: 150 },
      ],
    });
    const left = result.outputs[0]![0]!;
    expect([left[99], left[100], left[149], left[150], left[199]]).toEqual([
      1, 2, 2, 0, 0,
    ]);
    // The processor's output parameter, per block, at the block's last frame.
    expect(
      result.parameterChanges.filter((c) => c.id === PEAK).map((c) => c.time),
    ).toEqual([63, 127, 191, 199]);
    expect((await host.getParameter(PEAK)).normalized).toBe(0);
  });

  test('is the same whatever the block size', async () => {
    const input = ramp(1000);
    const outputs = [];
    for (const blockSize of [1, 64, 4096]) {
      const host = await launch('Fixture Gain', { blockSize });
      const {
        outputs: [bus],
      } = await host.process({
        inputs: [[input, input]],
        parameterChanges: [{ id: GAIN, value: 0.75, time: 333 }],
      });
      outputs.push(bus![0]);
    }
    expect(outputs[1]).toEqual(outputs[0]);
    expect(outputs[2]).toEqual(outputs[0]);
  });

  test('gives silence for an omitted input and processes zero frames', async () => {
    const host = await launch('Fixture Gain');
    const result = await host.process({ frames: 32 });
    expect(result.outputs[0]![0]).toEqual(new Float32Array(32));
    const empty = await host.process({
      frames: 0,
      parameterChanges: [{ id: BYPASS, value: 1 }],
    });
    expect(empty.outputs[0]![0]).toHaveLength(0);
    expect((await host.getParameter(BYPASS)).normalized).toBe(1);
  });

  test('rejects malformed requests with what is wrong', async () => {
    const host = await launch('Fixture Gain');
    const one = constant(16, 1);
    const cases: [Parameters<typeof host.process>[0], RegExp][] = [
      [{ inputs: [[one]] }, /has 2 channels/],
      [{ inputs: [[one, constant(8, 1)]] }, /has 8 frames/],
      [{ inputs: [[one, one], [one]] }, /Sidechain.*inactive/],
      [{ inputs: [[one, one], null, [one]] }, /3 input buses/],
      [{}, /needs `frames`/],
      [
        { frames: 16, parameterChanges: [{ id: GAIN, value: 0.5, time: 16 }] },
        /time must be/,
      ],
      [
        { frames: 16, events: [{ type: 'noteOn', pitch: 60 }] },
        /no events on bus 0/,
      ],
      [{ frames: 16, transport: { tempo: 0 } }, /tempo must be/],
    ];
    for (const [request, message] of cases) {
      const error = await failure(host.process(request));
      expect(error.code).toBe('invalid-request');
      expect(error.message).toMatch(message);
    }
    // Still usable afterwards.
    expect((await host.process({ inputs: [[one, one]] })).frames).toBe(16);
  });

  test('negotiates mono buses and activates the sidechain', async () => {
    const host = await launch('Fixture Gain', {
      inputs: [{ channels: 1 }, { active: true }],
      outputs: [{ arrangement: 'mono' }],
    });
    expect(
      host.info.buses.audioInputs.map((b) => [b.channels, b.active]),
    ).toEqual([
      [1, true],
      [1, true],
    ]);
    const result = await host.process({
      inputs: [[constant(8, 0.25)], [constant(8, 0.5)]],
    });
    expect(result.outputs[0]).toHaveLength(1);
    expect(result.outputs[0]![0]![0]).toBe(0.75);
  });

  test('refuses an arrangement the plugin does not accept', async () => {
    const error = await failure(
      launchHost({
        plugin: bundle,
        className: 'Fixture Gain',
        inputs: [{ arrangement: '5.1' }],
      }),
    );
    expect(error.code).toBe('unsupported-configuration');
    expect(error.message).toMatch(/does not accept 5\.1 on audio input bus 0/);
  });

  test('reconfigures sample rate, block size and buses', async () => {
    const host = await launch('Fixture Gain');
    const info = await host.configure({
      sampleRate: 96000,
      blockSize: 32,
      outputs: [{ channels: 1 }],
      inputs: [{ channels: 1 }],
    });
    expect(info).toMatchObject({ sampleRate: 96000, blockSize: 32 });
    expect(info.buses.audioOutputs[0]!.channels).toBe(1);
    const failed = await failure(host.configure({ inputs: [{ channels: 6 }] }));
    expect(failed.code).toBe('unsupported-configuration');
    // The previous setup still works.
    expect(
      (await host.process({ inputs: [[constant(4, 1)]] })).outputs[0],
    ).toHaveLength(1);
  });
});

describe('latency', () => {
  test('restarts the plugin and delays its output', async () => {
    const host = await launch('Fixture Gain');
    const restarts: string[][] = [];
    host.on('restart', (event) => restarts.push(event.reasons));
    await host.setParameter(LATENCY, 0.5);
    const impulse = new Float32Array(256);
    impulse[0] = 1;
    const result = await host.process({ inputs: [[impulse, impulse]] });
    expect(result.outputs[0]![0]!.indexOf(1)).toBe(128);
    expect(await host.getLatency()).toEqual({
      latencySamples: 128,
      tailSamples: 0,
    });
    expect(restarts).toContainEqual(['latencyChanged']);
  });

  test('reset clears what the plugin holds', async () => {
    const host = await launch('Fixture Gain');
    await host.setParameter(LATENCY, 0.25);
    await host.process({ inputs: [[constant(32, 1), constant(32, 1)]] });
    await host.reset();
    const after = await host.process({ frames: 64 });
    expect(after.outputs[0]![0]).toEqual(new Float32Array(64));
  });
});

describe('state', () => {
  test('round-trips through a fresh instance', async () => {
    const host = await launch('Fixture Gain');
    await host.setParameter(GAIN, 0.125);
    await host.setParameter(LATENCY, 0.25);
    const state = await host.getState();
    expect(state.component.byteLength).toBe(24);
    expect(state.controller.byteLength).toBe(8);

    const fresh = await host.recreate();
    expect(fresh.latencySamples).toBe(0);
    expect((await host.getParameter(GAIN)).normalized).toBe(0.5);

    await host.setState(state);
    expect((await host.getParameter(GAIN)).normalized).toBe(0.125);
    expect((await host.getParameter(LATENCY)).normalized).toBe(0.25);
    const impulse = new Float32Array(128);
    impulse[0] = 1;
    const result = await host.process({ inputs: [[impulse, impulse]] });
    expect(result.outputs[0]![0]!.indexOf(0.25)).toBe(64);
  });

  test('rejects state the plugin cannot read', async () => {
    const host = await launch('Fixture Gain');
    const error = await failure(
      host.setState({
        component: new Uint8Array(3),
        controller: new Uint8Array(0),
      }),
    );
    expect(error.code).toBe('plugin-error');
  });
});
