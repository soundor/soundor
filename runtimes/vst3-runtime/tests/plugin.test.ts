// The test plugin (tests/plugin), built by the VST3 runtime, in a real VST3
// host (@soundor/vst3-host): what a DAW does with it, checked by what comes
// out. `pnpm test:plugin` builds it first; the editor tests need an X
// display (CI runs them under xvfb-run).

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  launchHost,
  midiInput,
  midiOutput,
  type LaunchOptions,
  type ParameterInfo,
  type Vst3Host,
} from '@soundor/vst3-host';
import { afterEach, describe, expect, it } from 'vitest';

import { classIds, parameterVstId } from '../src/descriptor';

const plugin = fileURLToPath(
  new URL(
    './plugin/.soundor/dist/vst3/Soundor VST3 Test.vst3',
    import.meta.url,
  ),
);
const display =
  process.env['DISPLAY'] !== undefined && process.env['DISPLAY'] !== '';
// Instances.cpp, which `pnpm test:native` builds.
const instances = fileURLToPath(
  new URL(
    '../native/build/tests/tests/soundor_vst3_instances',
    import.meta.url,
  ),
);

const hosts: Vst3Host[] = [];
async function open(
  editor = false,
  processMode?: LaunchOptions['processMode'],
): Promise<Vst3Host> {
  if (!existsSync(plugin))
    throw new Error(
      `${plugin} is missing: run \`pnpm test:plugin\`, which builds it first.`,
    );
  const host = await launchHost({
    plugin,
    editor,
    processMode,
    sampleRate: 48000,
    blockSize: 256,
  });
  hosts.push(host);
  return host;
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

const FRAMES = 256;
function constant(value: number): Float32Array[] {
  return [
    new Float32Array(FRAMES).fill(value),
    new Float32Array(FRAMES).fill(value),
  ];
}
/** The last output sample of the main bus's first channel. */
async function output(host: Vst3Host, input = 0.5): Promise<number> {
  const result = await host.process({ inputs: [constant(input)] });
  return result.outputs[0]![0]![FRAMES - 1]!;
}
function parameter(parameters: ParameterInfo[], id: string): ParameterInfo {
  const found = parameters.find(
    (candidate) => candidate.id === parameterVstId(id),
  );
  if (found === undefined) throw new Error(`no parameter ${id}`);
  return found;
}
function document(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    version: number;
    parameters: Record<string, unknown>;
    state: Record<string, unknown>;
  };
}

describe('the VST3 test plugin', () => {
  it('describes itself: classes, buses, MIDI, latency', async () => {
    const host = await open();
    const info = await host.getInfo();
    const ids = classIds('dev.soundor.test.vst3');
    expect(info).toMatchObject({
      name: 'Soundor VST3 Test',
      vendor: 'Soundor',
      version: '1.2.3',
      classId: ids.processor,
      separateController: true,
      hasController: true,
      latencySamples: 32,
      factory: { vendor: 'Soundor', url: 'https://soundor.dev' },
    });
    expect(info.subCategories).toEqual(['Fx', 'Tools']);
    expect(info.buses.audioInputs).toMatchObject([
      { name: 'Input', type: 'main', channels: 2 },
    ]);
    expect(info.buses.audioOutputs).toMatchObject([
      { name: 'Output', type: 'main', channels: 2 },
    ]);
    expect(info.buses.eventInputs).toHaveLength(1);
    expect(info.buses.eventOutputs).toHaveLength(1);
    const manifest = JSON.parse(
      readFileSync(`${plugin}/Contents/Resources/moduleinfo.json`, 'utf8'),
    ) as { Classes: { CID: string }[] };
    expect(manifest.Classes.map((entry) => entry.CID)).toEqual([
      ids.processor,
      ids.controller,
    ]);
  });

  it('reports the Rust processor tail with the editor closed', async () => {
    const host = await open();
    expect((await host.getInfo()).tailSamples).toBe(48000);

    await host.setParameter(parameterVstId('gain'), { plain: 0.5 });
    await output(host);
    expect((await host.getInfo()).tailSamples).toBe(24000);

    await host.setParameter(parameterVstId('gain'), { plain: 0 });
    await host.setParameter(parameterVstId('steps'), { plain: -1 });
    await output(host);
    expect((await host.getInfo()).tailSamples).toBe(24000);

    await host.setParameter(parameterVstId('steps'), { plain: 0 });
    await output(host);
    expect((await host.getInfo()).tailSamples).toBe(0);
  });

  it("gives the host the parameters, with the config's text and flags", async () => {
    const host = await open();
    const parameters = await host.getParameters();
    const gain = parameter(parameters, 'gain');
    expect(gain).toMatchObject({
      title: 'Gain',
      units: 'x',
      stepCount: 0,
      plain: 1,
    });
    expect(gain.flags).toMatchObject({
      canAutomate: true,
      readOnly: false,
      bypass: false,
    });
    expect(gain.normalized).toBeCloseTo(0.5);
    expect(gain.display).toMatch(/^1(\.0+)?( ?x)?$/);
    expect(parameter(parameters, 'mode')).toMatchObject({
      stepCount: 1,
      display: 'Clean',
    });
    expect(parameter(parameters, 'mode').flags.list).toBe(true);
    expect(parameter(parameters, 'steps')).toMatchObject({
      stepCount: 8,
      plain: 0,
    });
    expect(parameter(parameters, 'bypass').flags.bypass).toBe(true);
    expect(parameter(parameters, 'peak').flags).toMatchObject({
      readOnly: true,
      canAutomate: false,
    });
    // The factory presets as a program list's selector; MIDI controllers as hidden parameters.
    expect(
      parameters.filter((candidate) => candidate.flags.programChange),
    ).toHaveLength(1);
    expect(
      parameters.filter((candidate) => candidate.flags.hidden),
    ).toHaveLength(16 * 131);
    // Text the host types, parsed by the parameter's own expression.
    await host.setParameter(parameterVstId('mode'), { plain: 1 });
    expect((await host.getParameter(parameterVstId('mode'))).display).toBe(
      'Invert',
    );
  });

  it('processes audio with the parameters the host automates', async () => {
    const host = await open();
    expect(await output(host)).toBeCloseTo(0.5);
    await host.setParameter(parameterVstId('gain'), { plain: 2 });
    expect(await output(host)).toBeCloseTo(1);
    await host.setParameter(parameterVstId('mode'), { plain: 1 });
    expect(await output(host)).toBeCloseTo(-1);
    await host.setParameter(parameterVstId('bypass'), { plain: 1 });
    expect(await output(host)).toBeCloseTo(0.5);
    // Changes inside a block, as automation sends them: the block's last value.
    const result = await host.process({
      inputs: [constant(0.25)],
      parameterChanges: [
        { id: parameterVstId('bypass'), value: 0, time: 0 },
        { id: parameterVstId('mode'), value: 0, time: 0 },
        { id: parameterVstId('gain'), value: 0.75, time: 10 },
      ],
    });
    expect(result.outputs[0]![1]![FRAMES - 1]).toBeCloseTo(0.25 * 1.5);
  });

  it('reports the read-only parameter the processing publishes', async () => {
    const host = await open();
    const result = await host.process({ inputs: [constant(0.4)] });
    const change = result.parameterChanges.find(
      (entry) => entry.id === parameterVstId('peak'),
    );
    expect(change?.value).toBeCloseTo(0.4 / 4);
  });

  it('takes MIDI in and gives it out, notes an octave up, controllers mapped', async () => {
    const host = await open();
    const result = await host.process({
      inputs: [constant(0)],
      events: [
        midiInput({
          message: { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
          sampleOffset: 7,
        }),
        midiInput({
          message: {
            type: 'controlChange',
            channel: 2,
            controller: 74,
            value: 64,
          },
          sampleOffset: 9,
        }),
        midiInput({
          message: { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
          sampleOffset: 100,
        }),
      ],
    });
    const messages = result.events
      .map(midiOutput)
      .filter((event) => event !== null);
    expect(messages).toEqual([
      expect.objectContaining({
        message: { type: 'noteOn', channel: 1, note: 72, velocity: 100 },
        sampleOffset: 7,
      }),
      expect.objectContaining({
        message: {
          type: 'controlChange',
          channel: 2,
          controller: 74,
          value: 64,
        },
        sampleOffset: 9,
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'noteOff',
          channel: 1,
          note: 72,
        }),
        sampleOffset: 100,
      }),
    ]);
  });

  it('saves and restores its state: parameters and persistent state, in a new instance', async () => {
    const host = await open();
    await host.setParameter(parameterVstId('gain'), { plain: 1.5 });
    const saved = await host.getState();
    const json = document(saved.component);
    expect(json).toMatchObject({
      version: 1,
      parameters: { gain: 1.5, mode: 'clean', steps: 0, bypass: false },
      state: { label: 'Init', level: 0.25, pattern: [1, 2, 3] },
    });
    // A project reopened: a new instance, the saved state.
    await host.recreate();
    expect(await output(host)).toBeCloseTo(0.5);
    await host.setState(saved);
    expect((await host.getParameter(parameterVstId('gain'))).plain).toBeCloseTo(
      1.5,
    );
    expect(await output(host)).toBeCloseTo(0.75);
    // Persistent state the processor reads: `level` doubled doubles the output.
    const louder = { ...json, state: { ...json.state, level: 0.5 } };
    await host.setState({
      component: new TextEncoder().encode(JSON.stringify(louder)),
      controller: saved.controller,
    });
    expect(await output(host)).toBeCloseTo(1.5);
    expect(document((await host.getState()).component).state).toMatchObject({
      level: 0.5,
    });
  });

  it('refuses a state that is not its own', async () => {
    const host = await open();
    await host.setParameter(parameterVstId('gain'), { plain: 0.5 });
    await expect(
      host.setState({
        component: new TextEncoder().encode('{"version":9}'),
        controller: new Uint8Array(),
      }),
    ).rejects.toThrow(/rejected the state/);
    expect(await output(host)).toBeCloseTo(0.25);
  });

  it("loads a factory preset from the host's program list", async () => {
    const host = await open();
    const parameters = await host.getParameters();
    const program = parameters.find(
      (candidate) => candidate.flags.programChange,
    )!;
    await host.setParameter(program.id, { normalized: 0 });
    expect((await host.getParameter(parameterVstId('gain'))).plain).toBeCloseTo(
      2,
    );
    expect((await host.getParameter(parameterVstId('mode'))).display).toBe(
      'Invert',
    );
    expect(await output(host)).toBeCloseTo(-1);
  });

  it('runs instances independently', async () => {
    const [first, second] = await Promise.all([open(), open()]);
    await first!.setParameter(parameterVstId('gain'), { plain: 2 });
    await second!.setParameter(parameterVstId('gain'), { plain: 0.5 });
    expect(await output(first!)).toBeCloseTo(1);
    expect(await output(second!)).toBeCloseTo(0.25);
  });

  it('exports only its three VST3 entry points', () => {
    const result = spawnSync(
      'nm',
      [
        '-D',
        '--defined-only',
        `${plugin}/Contents/x86_64-linux/Soundor VST3 Test.so`,
      ],
      {
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const symbols = result.stdout
      .trim()
      .split('\n')
      .map((line) => line.split(' ').pop());
    expect(symbols.sort()).toEqual([
      'GetPluginFactory',
      'ModuleEntry',
      'ModuleExit',
    ]);
  });

  it.runIf(existsSync(instances))(
    'shares one process with its other instances and another build of itself',
    () => {
      // Another binary of the plugin (another version, as the process sees it).
      const directory = mkdtempSync(join(tmpdir(), 'soundor-vst3-'));
      try {
        const copy = join(directory, 'Soundor VST3 Copy.vst3');
        cpSync(plugin, copy, { recursive: true });
        renameSync(
          join(copy, 'Contents/x86_64-linux/Soundor VST3 Test.so'),
          join(copy, 'Contents/x86_64-linux/Soundor VST3 Copy.so'),
        );
        const result = spawnSync(instances, [plugin, copy], {
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
        expect(result.stdout).toContain('4 instances of 2 modules: ok');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(display)(
    'reports the host and offline processing to the editor',
    async () => {
      const host = await open(true, 'offline');
      await host.openEditor();
      await host.process({
        inputs: [constant(0.5)],
        transport: { playing: true, tempo: 135 },
      });
      await expect
        .poll(async () => {
          const snapshot = document((await host.getState()).component).state[
            'hostSnapshot'
          ];
          return typeof snapshot === 'string' && snapshot
            ? JSON.parse(snapshot)
            : null;
        })
        .toMatchObject({
          hostName: 'Soundor VST3 Host',
          sampleRate: 48000,
          blockSize: 256,
          samplePrecision: 'float32',
          processingMode: 'offline',
          transport: { playing: true, bpm: 135 },
        });
    },
  );

  it.runIf(display)(
    'opens, resizes and closes its editor, again and again',
    async () => {
      const host = await open(true);
      for (let round = 0; round < 2; round++) {
        const opened = await host.openEditor();
        expect(opened).toMatchObject({
          open: true,
          width: 320,
          height: 240,
          resizable: true,
          platformType: 'X11EmbedWindowID',
        });
        await expect
          .poll(
            async () =>
              document((await host.getState()).component).state['label'],
          )
          .toBe('Doubled 42');
        // Audio goes on while it is open.
        expect(await output(host)).toBeCloseTo(0.5);
        expect(await host.resizeEditor(400, 300)).toMatchObject({
          width: 400,
          height: 300,
        });
        // Held to the config's limits.
        expect(await host.resizeEditor(2000, 2000)).toMatchObject({
          width: 640,
          height: 480,
        });
        expect(await host.closeEditor()).toMatchObject({ open: false });
      }
      expect(await output(host)).toBeCloseTo(0.5);
    },
  );
});
