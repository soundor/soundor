// Exercise the real Rust exports in two separate WASM instances. The audio
// side runs through the same WasmProcessor class as the AudioWorklet.
import 'fake-indexeddb/auto';
import { resolve } from 'node:path';

import { WasmProcessor } from '@soundor/engine/web/processor';
import { parseConfig } from '@soundor/runtime-sdk';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { webManifest } from '../codegen';
import { renderParameterBehaviors } from '../parameter-codegen';
import { createHostContext, type WebHostContext } from './context';
import type { WebManifest } from './manifest';
import type { ParameterBehavior } from './parameters';
import {
  buildFixture,
  contract,
  streams,
  parameters,
} from './processor/fixture/build';
import { WasmController } from './wasm-controller';

let module: WebAssembly.Module;
let manifest: WebManifest;
let behaviors: readonly ParameterBehavior[];
const instances: WasmController[] = [];
beforeAll(async () => {
  module = new WebAssembly.Module(buildFixture());
  const config = await parseConfig({
    path: resolve('../../packages/cli/rust/fixture/soundor.config.ts'),
  });
  // The ABI fixture also tests auxiliary native audio buses. They do not
  // affect the controller contract; this browser controller needs no audio.
  const { audio: _audio, ...webConfig } = config;
  manifest = webManifest(webConfig);
  behaviors = new Function(
    renderParameterBehaviors(config.parameters).replace(
      'export const behaviors =',
      'return',
    ),
  )() as ParameterBehavior[];
}, 300_000);
afterEach(() => {
  vi.unstubAllGlobals();
  for (const instance of instances.splice(0)) instance.dispose();
});
function instance(publishEvent?: (index: number, value: unknown) => boolean): {
  controller: WasmController;
  context: WebHostContext;
  call(name: string, ...args: unknown[]): unknown;
} {
  const context = createHostContext(manifest, {}, behaviors);
  const controller = new WasmController(module, context, publishEvent);
  instances.push(controller);
  return {
    context,
    controller,
    call: (name, ...args) =>
      controller.call(
        manifest.native.methods.find((m) => m.name === name)!,
        args,
      ),
  };
}

it('initializes isolated stores and keeps them across UI recreation', () => {
  const a = instance();
  const b = instance();
  expect(a.call('increment')).toBe(1);
  // UI consumers are disposable functions; the instance's stores persist.
  const remountedCall = a.call;
  expect(remountedCall('increment')).toBe(2);
  expect(b.call('increment')).toBe(1);
  a.controller.dispose();
  expect(() => a.call('increment')).toThrow('shut down');
});
it('settles async calls, schedules serial updates, and rejects Rust errors', async () => {
  const a = instance();
  const pending = a.call('incrementLater');
  expect(a.call('increment')).toBe(1); // schedule never executes inline
  await expect(pending).resolves.toBe(2);
  await expect(a.call('incrementLater')).resolves.toBe(3);
  await expect(a.call('fail', 'Rust failure')).rejects.toThrow('Rust failure');
});
it('uses the same parameter, state and History stores as the UI', () => {
  const a = instance();
  expect(
    a.context.parameters.history.transaction('Describe', () =>
      a.call('describe', 0.5, 18446744073709551615n, ['a', 'b']),
    ),
  ).toBe('18446744073709551615: 0.5 [a,b]');
  expect(a.context.parameters.list[0]!.get()).toBe(0.5);
  expect(a.context.state.store.fields['tags']!.get()).toEqual(['a', 'b']);
  a.context.parameters.history.undo();
  expect(a.context.state.store.fields['tags']!.get()).toEqual([]);
});
it('encodes enums, nullable values, structs, arrays and binary buffers', () => {
  const a = instance();
  expect(a.call('pick', null)).toBe('ease-in');
  expect(a.call('pick', 'linear')).toBe('linear');
  expect(a.call('analyze', new Float32Array([-0.75, 0.5]))).toEqual({
    peak: 0.75,
    points: [],
    label: null,
  });
});
it('decodes event payloads produced by the Rust controller', () => {
  const publish = vi.fn<(index: number, value: unknown) => boolean>(() => true);
  const a = instance(publish);
  a.call('analyze', new Float32Array([0.5, -0.75]));
  expect(publish.mock.calls).toEqual([
    [
      0,
      {
        label: 'analysis',
        curve: 'ease-in',
        samples: new Float32Array([0.5, -0.75]),
      },
    ],
    [1, {}],
  ]);
});

it('publishes actual controller resources into a separate processor instance', async () => {
  const a = instance();
  const processor = new WasmProcessor(module, contract, [1], [1], streams);
  processor.parameters.set(parameters(0.5));
  expect(processor.prepare(48000, 128)).toBe(0);
  const off = a.controller.subscribeResources((index, bytes) =>
    processor.publishResource(index, bytes),
  );
  await expect(a.call('loadTable', 23)).resolves.toEqual(
    Float32Array.from({ length: 23 }, (_, i) => i),
  );
  processor.process([new Float32Array(4)], [new Float32Array(4)], 4);
  expect(processor.streamChanges().find(([index]) => index === 0)?.[1]).toEqual(
    new Float32Array([0.5, 0, 1, 3, 23]),
  );
  await a.call('loadTable', 7);
  processor.process([new Float32Array(4)], [new Float32Array(4)], 4);
  const changed = processor.streamChanges().find(([index]) => index === 0);
  expect(changed).toBeDefined();
  expect((changed![1] as Float32Array)[4]).toBe(7);
  off();
  processor.destroy();
});
it('cancels queued schedules and pending futures when the UI or plugin closes', async () => {
  const a = instance();
  const pending = a.call('incrementLater');
  const rejected = Promise.resolve(pending).catch((error: unknown) => error);
  a.controller.cancelCalls();
  expect(await rejected).toMatchObject({
    message: 'The UI context was disposed',
  });
  expect(a.call('increment')).toBe(1);
  const waiting = a.call('loadTable', 0xffffffff);
  const closed = Promise.resolve(waiting).catch((error: unknown) => error);
  a.controller.dispose();
  expect(await closed).toMatchObject({
    message: 'The plugin instance shut down',
  });
});
it('refuses stale contracts before constructing stores', () => {
  const context = createHostContext(
    { ...manifest, controller: [0] },
    {},
    behaviors,
  );
  expect(() => new WasmController(module, context)).toThrow(
    'another generated contract',
  );
});

it('drops a schedule cancelled after polling but before its control turn', async () => {
  const turns: (() => void)[] = [];
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: null as (() => void) | null, close() {} };
      port2 = {
        postMessage: () => turns.push(() => this.port1.onmessage?.()),
        close() {},
      };
    },
  );
  const a = instance();
  const promise = Promise.resolve(a.call('incrementLater')).catch(
    (error: unknown) => error,
  );
  turns.shift()!(); // polls the Rust future, lazily queues its schedule
  a.controller.cancelCalls();
  while (turns.length > 0) turns.shift()!();
  expect(await promise).toMatchObject({
    message: 'The UI context was disposed',
  });
  expect(a.call('increment')).toBe(1); // the cancelled callback never ran
});

it('adapts typed History and factory preset services to the shared web stores', () => {
  const a = instance();
  a.context.parameters.list[0]!.set(0.25, { history: true });
  expect(a.context.parameters.history.canUndo()).toBe(true);
  a.call('reset');
  expect(a.context.state.presets.factory.list().map((p) => p.id)).toEqual([
    'warm',
  ]);
  expect(a.context.parameters.list[0]!.get()).toBe(0.5);
  expect(a.context.state.store.fields['selectedPreset']!.get()).toBe('Default');
  expect(a.context.parameters.history.canUndo()).toBe(true);
});

it('rejects a changed resource schema before creating the controller', () => {
  const context = createHostContext(
    { ...manifest, resources: [{ name: 'wavetable', element: 'float64' }] },
    {},
    behaviors,
  );
  expect(() => new WasmController(module, context)).toThrow(
    'instance contract differs',
  );
});
it('refuses reentrant calls from a service notification and remains usable', () => {
  const a = instance();
  const off = a.context.parameters.list[0]!.subscribe(() => {
    expect(() => a.call('increment')).toThrow('Reentrant');
  });
  a.call('describe', 0.25, 1n, []);
  off();
  expect(a.call('increment')).toBe(1);
});
it('rejects a settled result if its UI is disposed before promise delivery', async () => {
  const turns: (() => void)[] = [];
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: null as (() => void) | null, close() {} };
      port2 = {
        postMessage: () => turns.push(() => this.port1.onmessage?.()),
        close() {},
      };
    },
  );
  const a = instance();
  const result = Promise.resolve(a.call('incrementLater')).catch(
    (error: unknown) => error,
  );
  while (turns.length > 0) turns.shift()!();
  a.controller.cancelCalls();
  expect(await result).toMatchObject({
    message: 'The UI context was disposed',
  });
  expect(a.call('increment')).toBe(2); // a started callback completed normally
});

it('rejects stale parameter identities even when their counts match', () => {
  const parameters = manifest.parameters.map((p, i) =>
    i === 0 ? { ...p, id: 'renamedGain' } : p,
  );
  const context = createHostContext({ ...manifest, parameters }, {}, behaviors);
  expect(() => new WasmController(module, context)).toThrow(
    'instance contract differs',
  );
});
