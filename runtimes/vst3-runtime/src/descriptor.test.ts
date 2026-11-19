import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from '@soundor/config';
import { describe, expect, it } from 'vitest';

import { moduleInfo } from './bundle';
import { cratePackageName, renderCrate } from './crate';
import { classIds, describePlugin, parameterVstId } from './descriptor';
import { renderExpressionRuntime } from './expression-runtime';
import { findAdapter, linkArguments, VERSION_SCRIPT } from './link';
import { resolveVst3Options } from './options';

function config(source: Record<string, unknown>) {
  return resolveConfig({ runtimes: [], ...source });
}

const effect = config({
  plugin: {
    id: 'com.acme.ring',
    name: 'Ring',
    kind: 'effect',
    categories: ['modulation'],
    version: '1.2.3',
  },
  audio: {
    buses: {
      input: { direction: 'input', name: 'Input' },
      side: { direction: 'input', name: 'Sidechain', optional: true },
      output: { direction: 'output', name: 'Output' },
    },
    layouts: {
      mono: { input: 'mono', side: ['disabled', 'mono'], output: 'mono' },
      stereo: {
        input: 'stereo',
        side: ['disabled', 'stereo'],
        output: 'stereo',
      },
    },
    defaultLayout: 'stereo',
    defaultBuses: { side: 'disabled' },
    latency: { mode: 'fixed', samples: 64 },
  },
  midi: { input: true },
  editor: {
    width: 500,
    height: 300,
    resizable: true,
    maxWidth: 1000,
    maxHeight: 600,
  },
  parameterGroups: { main: { label: 'Main' } },
  parameters: {
    rate: {
      type: 'float32',
      label: 'Rate',
      min: 1,
      max: 2000,
      default: 30,
      unit: 'Hz',
      group: 'main',
    },
    on: { type: 'boolean', label: 'On', default: true },
    shape: {
      type: 'choice',
      label: 'Shape',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'square', label: 'Square' },
      ],
      default: 'square',
    },
    steps: { type: 'int32', label: 'Steps', min: -8, max: 8, default: 0 },
    meter: {
      type: 'float32',
      label: 'Meter',
      min: 0,
      max: 1,
      default: 0,
      access: 'readOnly',
    },
  },
  state: {
    name: { type: 'string', default: 'Init' },
    level: { type: 'float32', default: 0.1, audio: true },
    seed: { type: 'uint64', default: 3n },
  },
  presets: [
    {
      id: 'fast',
      name: 'Fast',
      parameters: { rate: 500, shape: 'sine' },
      state: { name: 'Fast' },
    },
  ],
  native: { streams: { peak: { type: 'float32' } } },
});

describe('descriptor', () => {
  const description = describePlugin(effect, resolveVst3Options({}));

  it('derives stable, distinct class ids from the plugin id', () => {
    const ids = classIds('com.acme.ring');
    expect(ids).toEqual(classIds('com.acme.ring'));
    expect(ids.processor).toMatch(/^[0-9A-F]{32}$/);
    expect(ids.processor).not.toBe(ids.controller);
    expect(classIds('com.acme.other').processor).not.toBe(ids.processor);
    expect(description.plugin.processorCid).toBe(ids.processor);
  });

  it('takes explicit class ids', () => {
    const processor = 'ABCDEF019182FAEB4967716550323174';
    const controller = 'ABCDEF011234ABCD4967716550323174';
    expect(
      describePlugin(
        effect,
        resolveVst3Options({ classIds: { processor, controller } }),
      ).plugin,
    ).toMatchObject({
      processorCid: processor,
      controllerCid: controller,
    });
  });

  it("hashes parameter ids as JUCE's VST3 wrapper does", () => {
    // juce::String("gain").hashCode() & 0x7fffffff
    expect(parameterVstId('gain')).toBe(3165055);
    expect(description.parameters.map((p) => p.vstId)).toEqual(
      ['rate', 'on', 'shape', 'steps', 'meter'].map(parameterVstId),
    );
  });

  it('describes identity, buses, layouts and MIDI', () => {
    expect(description.plugin).toMatchObject({
      id: 'com.acme.ring',
      name: 'Ring',
      vendor: 'acme',
      version: '1.2.3',
      subcategories: 'Fx|Modulation',
    });
    expect(description.audio.inputs).toEqual([
      { name: 'Input', initialChannels: 2, enabledChannels: 2 },
      { name: 'Sidechain', initialChannels: 0, enabledChannels: 1 },
    ]);
    expect(description.audio.layouts).toEqual([
      { name: 'mono', inputs: [[1], [0, 1]], outputs: [[1]] },
      { name: 'stereo', inputs: [[2], [0, 2]], outputs: [[2]] },
    ]);
    expect(description.audio.latency).toBe(64);
    expect(description.midi).toEqual({ input: true, output: false });
  });

  it('defaults to stereo and mono without an audio configuration', () => {
    const plain = describePlugin(
      config({ plugin: { id: 'a.b.c', name: 'C' } }),
      resolveVst3Options(undefined),
    );
    expect(plain.audio.layouts).toEqual([
      { name: 'stereo', inputs: [[2]], outputs: [[2]] },
      { name: 'mono', inputs: [[1]], outputs: [[1]] },
    ]);
  });

  it('describes parameters in plain units with their behaviour and step counts', () => {
    const [rate, on, shape, steps, meter] = description.parameters;
    expect(rate).toMatchObject({
      min: 1,
      max: 2000,
      default: 30,
      unit: 'Hz',
      stepCount: 0,
      group: 'main',
    });
    expect(rate!.semantics.toValue.kind).toBeDefined();
    expect(on).toMatchObject({ min: 0, max: 1, default: 1, stepCount: 1 });
    expect(shape).toMatchObject({ min: 0, max: 1, default: 1, stepCount: 1 });
    expect(shape!.choices).toEqual([
      { value: 'sine', label: 'Sine' },
      { value: 'square', label: 'Square' },
    ]);
    expect(steps).toMatchObject({ stepCount: 16 });
    expect(meter).toMatchObject({ access: 'readOnly' });
    expect(description.groups).toEqual([
      { id: 'main', label: 'Main', unit: 1 },
    ]);
    expect(description.contract).toEqual({
      parameters: 5,
      published: 1,
      streams: 1,
      stateSize: 4,
    });
  });

  it('describes state with JSON defaults and the audio snapshot', () => {
    expect(
      description.state.fields.map((field) => [
        field.name,
        field.default,
        field.audio,
      ]),
    ).toEqual([
      ['level', '0.10000000149011612', true],
      ['name', '"Init"', false],
      ['seed', '"3"', false],
    ]);
    expect(description.state.audio).toEqual({
      size: 4,
      fields: [{ name: 'level', kind: 'value', element: 'float32', offset: 0 }],
    });
  });

  it('describes complete presets, without read-only parameters', () => {
    const [preset] = description.presets;
    expect(preset!.parameters).toEqual({
      rate: 500,
      on: 1,
      shape: 0,
      steps: 0,
    });
    expect(preset!.state).toMatchObject({ name: '"Fast"', seed: '"3"' });
  });

  it('refuses two parameters sharing a VST3 id', () => {
    // "Aa" and "BB" hash alike in Java-style string hashing.
    const clash = config({
      plugin: { id: 'a.b.c', name: 'C' },
      parameters: {
        Aa: { type: 'float32', label: 'A', min: 0, max: 1, default: 0 },
        BB: { type: 'float32', label: 'B', min: 0, max: 1, default: 0 },
      },
    });
    expect(() => describePlugin(clash, resolveVst3Options({}))).toThrow(
      /same VST3 id/,
    );
  });

  it('writes moduleinfo.json as moduleinfotool does', () => {
    const info = moduleInfo(description);
    expect(info.Classes.map((entry) => [entry.CID, entry.Category])).toEqual([
      [description.plugin.processorCid, 'Audio Module Class'],
      [description.plugin.controllerCid, 'Component Controller Class'],
    ]);
    expect(info.Classes[0]!['Sub Categories']).toEqual(['Fx', 'Modulation']);
  });
});

describe('options', () => {
  it('rejects unknown options and malformed ids', () => {
    expect(() => resolveVst3Options({ formats: ['vst3'] } as never)).toThrow(
      /unknown option 'formats'/,
    );
    expect(() =>
      resolveVst3Options({ classIds: { processor: 'x', controller: 'y' } }),
    ).toThrow(/32 hexadecimal/);
    expect(() => resolveVst3Options({ timeLimit: -1 })).toThrow(/timeLimit/);
    expect(resolveVst3Options({ timeLimit: false }).timeLimit).toBe(0);
    expect(resolveVst3Options({}).timeLimit).toBe(5000);
  });
});

describe('crate', () => {
  it("reads the project crate's package name", () => {
    expect(
      cratePackageName(
        '[package]\nname = "my-plugin" # mine\n[dependencies]\nname = "no"\n',
      ),
    ).toBe('my-plugin');
    expect(cratePackageName('[dependencies]\nname = "no"\n')).toBeUndefined();
  });

  it('links the project crate and embeds the UI', () => {
    const { cargo, lib } = renderCrate(
      {
        libManifest: '/p/lib/Cargo.toml',
        packageRoot: '/r',
        descriptor: '{}',
        controllerDescriptor: new Uint8Array(),
        files: [{ path: 'bundle.js.hbc', file: '/p/ui/bundle.js.hbc' }],
        uiDirectory: '',
        logFile: '',
      },
      'my-plugin',
    );
    expect(cargo).toContain(
      'plugin = { package = "my-plugin", path = "/p/lib" }',
    );
    expect(cargo).toContain('soundor-vst3 = { path = "/r/rust" }');
    expect(cargo).toContain('crate-type = ["staticlib"]');
    expect(lib).toContain('extern crate plugin as _;');
    expect(lib).toContain(
      'static FILE_0: &soundor_vst3::Aligned<[u8]> = &soundor_vst3::Aligned(*include_bytes!(r#"/p/ui/bundle.js.hbc"#));',
    );
    expect(lib).toContain(
      'soundor_vst3::File::new(r#"bundle.js.hbc"#, &FILE_0.0),',
    );
  });
});

describe('link', () => {
  it('links the adapter whole, then Rust and the engine, exporting only the entry points', () => {
    const args = linkArguments({
      output: '/b/P.so',
      versionScript: '/c/exports.map',
      adapter: '/a/libsoundor_vst3.a',
      rust: '/t/libplugin.a',
      engineLibraries: ['/e/libsoundor_runtime.a'],
      engineFlags: ['-ldl'],
      release: true,
    });
    const whole = args.indexOf('-Wl,--whole-archive');
    expect(args[whole + 1]).toBe('/a/libsoundor_vst3.a');
    expect(args[whole + 2]).toBe('-Wl,--no-whole-archive');
    expect(args.indexOf('/t/libplugin.a')).toBeGreaterThan(whole);
    expect(args.indexOf('/e/libsoundor_runtime.a')).toBeGreaterThan(
      args.indexOf('/t/libplugin.a'),
    );
    expect(args).toContain('-Wl,--version-script=/c/exports.map');
    expect(args).toContain('-static-libstdc++');
    expect(args).toContain(
      '-Wl,--exclude-libs,libplugin.a:libsoundor_runtime.a:libstdc++.a:libgcc.a:libgcc_eh.a:libsupc++.a',
    );
    expect(args).toContain('-Wl,--no-undefined');
    expect(args).toContain('-Wl,--gc-sections');
    expect(VERSION_SCRIPT).toMatch(
      /GetPluginFactory;\s*ModuleEntry;\s*ModuleExit;\s*local:\s*\*;/,
    );
  });

  it('refuses an adapter built against another engine', async () => {
    await expect(
      findAdapter('/nowhere', 'release', {
        version: '1.0.0',
        sourceFingerprint: 'x',
      }),
    ).rejects.toThrow(/prebuilt release adapter is missing/);
  });
});

describe('expression runtime', () => {
  it("is @soundor/expression's current cppRuntime() (pnpm gen:expression)", () => {
    const file = fileURLToPath(
      new URL('../native/src/generated/ExpressionRuntime.h', import.meta.url),
    );
    expect(readFileSync(file, 'utf8')).toBe(renderExpressionRuntime());
  });
});
