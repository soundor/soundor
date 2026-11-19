/** One plugin's Rust controller, in its own main-thread WASM instance. */
import { stateFieldValue, stateJson } from '@soundor/runtime-sdk/client';

import type { WebHostContext } from './context';
import type { WebNativeMethod } from './manifest';
import { nativeArguments, nativeResult, nativeTypes } from './native-values';
import { encodeNative, decodeNative, decodeNativeEvent } from './native-wire';

interface Exports {
  readonly memory: WebAssembly.Memory;
  soundor_web_controller_instance_descriptor(): number;
  soundor_web_controller_instance_descriptor_size(): number;
  soundor_web_controller_descriptor(): number;
  soundor_web_controller_descriptor_size(): number;
  soundor_web_controller_create(): number;
  soundor_web_controller_destroy(handle: number): void;
  soundor_web_controller_input(handle: number, size: number): number;
  soundor_web_controller_output(handle: number): number;
  soundor_web_controller_output_size(handle: number): number;
  soundor_web_controller_call(
    handle: number,
    method: number,
    operation: number,
  ): number;
  soundor_web_controller_run(handle: number): number;
  soundor_web_controller_operation(handle: number): number;
  soundor_web_controller_cancel(handle: number, operation: number): void;
  soundor_web_controller_resources(handle: number): void;
  soundor_web_controller_midi_enabled(): number;
  soundor_web_controller_midi_active(handle: number, active: number): void;
  soundor_web_controller_midi_take(handle: number): void;
  soundor_web_controller_midi_receive(handle: number, reset: number): number;
}
interface Pending {
  resolve(bytes: Uint8Array): void;
  reject(error: Error): void;
}

export class WasmController {
  #exports: Exports | undefined;
  get #wasm(): Exports {
    if (this.#exports === undefined)
      throw new Error('The plugin instance shut down');
    return this.#exports;
  }
  readonly #handle: number;
  readonly #channel = new MessageChannel();
  readonly #pending = new Map<number, Pending>();
  readonly #resources = new Map<number, Uint8Array>();
  readonly #listeners = new Set<(index: number, bytes: Uint8Array) => void>();
  #midiSend: ((bytes: number) => void) | undefined;
  #midiDropped = 0n;
  #next = 0;
  #generation = 0;
  #closed = false;
  #trapped = false;
  #busy = false;
  #queued = false;
  #serviceResult = new Uint8Array();

  constructor(
    module: WebAssembly.Module,
    readonly context: WebHostContext,
    private readonly publishEvent?: (index: number, value: unknown) => boolean,
  ) {
    try {
      const instance = new WebAssembly.Instance(module, {
        soundor_controller: {
          wake: () => this.#wake(),
          service: (op: number, index: number, ptr: number, len: number) =>
            this.#service(op, index, ptr, len),
          read_service_result: (ptr: number) =>
            new Uint8Array(
              this.#wasm.memory.buffer,
              ptr,
              this.#serviceResult.length,
            ).set(this.#serviceResult),
        },
      });
      this.#exports = instance.exports as unknown as Exports;
      const exports = this.#exports;
      const required = [
        'instance_descriptor',
        'instance_descriptor_size',
        'descriptor',
        'descriptor_size',
        'create',
        'destroy',
        'input',
        'output',
        'output_size',
        'call',
        'run',
        'operation',
        'cancel',
        'resources',
      ];
      const missing = required.filter(
        (name) =>
          typeof (exports as unknown as Record<string, unknown>)[
            `soundor_web_controller_${name}`
          ] !== 'function',
      );
      if (
        missing.length > 0 ||
        !(exports.memory instanceof WebAssembly.Memory)
      ) {
        this.#closePorts();
        throw new Error(
          `Missing Rust controller exports (${missing.join(', ')}): use soundor::export!(PluginProcessor, PluginController) and rebuild lib/`,
        );
      }
      const expected = context.manifest.controller;
      const built = new Uint8Array(
        exports.memory.buffer,
        exports.soundor_web_controller_descriptor(),
        exports.soundor_web_controller_descriptor_size(),
      );
      if (
        expected === undefined ||
        built.length !== expected.length ||
        built.some((byte, index) => byte !== expected[index])
      ) {
        this.#closePorts();
        throw new Error(
          'The Rust controller was built from another generated contract: run soundor gen and rebuild lib/',
        );
      }
      const metadata = new TextDecoder().decode(
        new Uint8Array(
          exports.memory.buffer,
          exports.soundor_web_controller_instance_descriptor(),
          exports.soundor_web_controller_instance_descriptor_size(),
        ),
      );
      if (
        metadata !==
        JSON.stringify([
          (context.manifest.resources ?? []).map((r) => [r.name, r.element]),
          context.manifest.parameters.map((p) => [p.id, p.type, p.access]),
          [context.manifest.plugin.id, context.manifest.plugin.name],
          context.manifest.presets ?? [],
          context.manifest.state ?? { fields: [], types: [] },
        ])
      ) {
        this.#closePorts();
        throw new Error(
          'The Rust controller instance contract differs: regenerate and rebuild lib/',
        );
      }
      this.#handle = exports.soundor_web_controller_create();
      if (this.#handle === 0) {
        this.#closePorts();
        throw new Error('Could not initialize Rust controller stores');
      }
      this.#channel.port1.onmessage = () => this.#pump();
      // Resource delivery is separate from method completion, including when
      // an async method publishes before awaiting its next operation.
    } catch (error) {
      this.#closePorts();
      throw error;
    }
  }

  call(method: WebNativeMethod, args: readonly unknown[]): unknown {
    const manifest = this.context.manifest;
    const types = nativeTypes(manifest.native.types);
    const values = nativeArguments(method, args, types);
    const index = manifest.native.methods.findIndex(
      (item) => item.name === method.name,
    );
    if (index < 0) throw new Error(`Unknown native method: ${method.name}`);
    const bytes = encodeNative(
      values,
      method.args.map((arg) => arg.type),
      manifest.native.types,
    );
    const decode = (bytes: Uint8Array) =>
      nativeResult(
        method,
        decodeNative(bytes, method.returns, manifest.native.types),
        types,
      );
    if (!method.async)
      return decode(this.#invoke(() => this.#call(index, 0, bytes)));
    if (this.#next === 0xffffffff)
      throw new Error('Rust controller operation identifiers exhausted');
    const operation = ++this.#next;
    const generation = this.#generation;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(operation, { resolve, reject });
      try {
        this.#invoke(() => this.#call(index, operation, bytes));
      } catch (error) {
        this.#pending.delete(operation);
        reject(error);
      }
    }).then((bytes) => {
      if (this.#closed) throw new Error('The plugin instance shut down');
      if (generation !== this.#generation)
        throw new Error('The UI context was disposed');
      return decode(bytes);
    });
  }

  /** Cancels the calls of a disposed UI context without destroying stores. */
  cancelCalls(): void {
    this.#generation++;
    this.#invoke(() => {
      for (const [operation, pending] of this.#pending) {
        this.#wasm.soundor_web_controller_cancel(this.#handle, operation);
        pending.reject(new Error('The UI context was disposed'));
      }
      this.#pending.clear();
    });
  }

  /** Sends current publications immediately and each replacement once. */
  subscribeResources(
    listener: (index: number, bytes: Uint8Array) => void,
  ): () => void {
    if (this.#closed) throw new Error('The plugin instance shut down');
    for (const [index, bytes] of this.#resources)
      listener(index, bytes.slice());
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get wantsMidi(): boolean {
    return !!this.#wasm.soundor_web_controller_midi_enabled?.();
  }
  connectMidi(send: ((bytes: number) => void) | undefined): void {
    this.#midiSend = send;
    this.#invoke(() =>
      this.#wasm.soundor_web_controller_midi_active?.(
        this.#handle,
        Number(send !== undefined),
      ),
    );
  }
  receiveMidi(records: Uint32Array, count: number, reset: boolean): void {
    if (!this.wantsMidi || this.#closed) return;
    this.#invoke(() => {
      const ptr = this.#wasm.soundor_web_controller_input(
        this.#handle,
        count * 8,
      );
      new Uint8Array(this.#wasm.memory.buffer, ptr, count * 8).set(
        new Uint8Array(records.buffer, records.byteOffset, count * 8),
      );
      if (
        !this.#wasm.soundor_web_controller_midi_receive(
          this.#handle,
          Number(reset),
        )
      )
        throw new Error('Invalid controller MIDI batch');
    });
    this.#wake();
  }
  dispose(): void {
    if (this.#closed) return;
    if (this.#busy) throw new Error('Reentrant Rust controller destruction');
    this.#closed = true;
    this.#closePorts();
    for (const pending of this.#pending.values())
      pending.reject(new Error('The plugin instance shut down'));
    this.#pending.clear();
    this.#listeners.clear();
    this.#resources.clear();
    try {
      if (!this.#trapped)
        this.#wasm.soundor_web_controller_destroy(this.#handle);
    } finally {
      this.#exports = undefined;
      if (this.context.controller === this) this.context.controller = undefined;
    }
  }

  #closePorts(): void {
    this.#channel.port1.close();
    this.#channel.port2.close();
  }
  #invoke<T>(body: () => T): T {
    if (this.#closed) throw new Error('The plugin instance shut down');
    if (this.#busy) throw new Error('Reentrant Rust controller execution');
    this.#busy = true;
    try {
      const value = body();
      this.#publications();
      return value;
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) this.#trapped = true;
      throw error;
    } finally {
      this.#busy = false;
      if (this.#trapped) this.dispose();
    }
  }
  #output(): Uint8Array {
    return new Uint8Array(
      this.#wasm.memory.buffer,
      this.#wasm.soundor_web_controller_output(this.#handle),
      this.#wasm.soundor_web_controller_output_size(this.#handle),
    ).slice();
  }
  #call(method: number, operation: number, bytes: Uint8Array): Uint8Array {
    const ptr = this.#wasm.soundor_web_controller_input(
      this.#handle,
      bytes.length,
    );
    new Uint8Array(this.#wasm.memory.buffer, ptr, bytes.length).set(bytes);
    const status = this.#wasm.soundor_web_controller_call(
      this.#handle,
      method,
      operation,
    );
    const result = this.#output();
    if (status !== 0) throw new Error(new TextDecoder().decode(result));
    return result;
  }
  #wake(): void {
    if (this.#queued || this.#closed) return;
    this.#queued = true;
    this.#channel.port2.postMessage(null);
  }
  #pump(): void {
    this.#queued = false;
    if (this.#closed) return;
    // One WASM turn per event-loop task: self-waking futures cannot starve
    // rendering, input or other plugin instances through a microtask loop.
    try {
      const again = this.#invoke(() => {
        const status = this.#wasm.soundor_web_controller_run(this.#handle);
        if (status === 2 || status === 3) {
          const operation = this.#wasm.soundor_web_controller_operation(
            this.#handle,
          );
          const pending = this.#pending.get(operation);
          this.#pending.delete(operation);
          if (status === 2) pending?.resolve(this.#output());
          else
            pending?.reject(
              new Error(new TextDecoder().decode(this.#output())),
            );
        }
        if (status === 4)
          throw new Error('Reentrant Rust controller execution');
        return status !== 0;
      });
      if (again) this.#wake();
    } catch (error) {
      for (const pending of this.#pending.values())
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      this.#pending.clear();
      this.dispose();
    }
  }
  #publications(): void {
    this.#wasm.soundor_web_controller_resources(this.#handle);
    const bytes = this.#output();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const index = view.getUint32(offset, true);
      const count = view.getUint32(offset + 4, true);
      const resource = this.context.manifest.resources?.[index];
      if (resource === undefined)
        throw new Error('Unknown Rust processor resource');
      const size = resource.element.endsWith('64')
        ? 8
        : resource.element.endsWith('32')
          ? 4
          : resource.element.endsWith('16')
            ? 2
            : 1;
      const end = offset + 8 + count * size;
      if (end > bytes.length)
        throw new Error('Truncated Rust processor resource');
      const payload = bytes.slice(offset + 4, end);
      this.#resources.set(index, payload);
      for (const listener of this.#listeners) listener(index, payload.slice());
      offset = end;
    }
    if (this.#wasm.soundor_web_controller_midi_take !== undefined) {
      this.#wasm.soundor_web_controller_midi_take(this.#handle);
      const midi = this.#output();
      const view = new DataView(midi.buffer, midi.byteOffset, midi.byteLength);
      if (midi.length >= 8) {
        const dropped = view.getBigUint64(0, true);
        if (dropped !== this.#midiDropped) {
          this.#midiDropped = dropped;
          this.context.midi.reset();
        }
        for (let offset = 8; offset + 8 <= midi.length; offset += 8)
          this.#midiSend?.(view.getUint32(offset + 4, true) & 0xffffff);
      }
    }
  }
  #service(op: number, index: number, ptr: number, length: number): number {
    const { parameters, state, manifest } = this.context;
    const memory = this.#wasm.memory.buffer;
    const text = () =>
      new TextDecoder().decode(new Uint8Array(memory, ptr, length));
    try {
      if (op === 6) {
        const event = manifest.native.events[index];
        if (
          this.#closed ||
          event === undefined ||
          this.publishEvent === undefined
        )
          return 0;
        const value = decodeNativeEvent(
          new Uint8Array(memory, ptr, length),
          event.fields,
          manifest.native.types,
        );
        return Number(this.publishEvent(index, value));
      }
      if (op === 0) {
        const p = parameters.list[index]!;
        const value = p.get();
        return p.info.type === 'boolean'
          ? Number(value)
          : p.info.type === 'choice'
            ? p.info.options.findIndex((option) => option.value === value)
            : (value as number);
      }
      if (op === 1) {
        const p = parameters.list[index]!;
        const value = new DataView(memory).getFloat64(ptr, true);
        p.set(
          p.info.type === 'boolean'
            ? value >= 0.5
            : p.info.type === 'choice'
              ? p.info.options[Math.round(value)]!.value
              : value,
        );
        return 0;
      }
      if (op === 4) {
        const h = parameters.history;
        if (index === 2) return Number(h.canUndo());
        if (index === 3) return Number(h.canRedo());
        if (index === 0) h.undo();
        else if (index === 1) h.redo();
        else return -1;
        return 0;
      }
      if (op === 2 || op === 3) {
        const name = manifest.state?.fields[index]?.name;
        const field = name === undefined ? undefined : state.store.fields[name];
        if (field === undefined) throw new Error('Unknown state field');
        if (op === 2)
          this.#serviceResult = new TextEncoder().encode(
            stateJson(field.get()),
          );
        else {
          field.set(
            stateFieldValue(
              state.store.schema,
              state.store.schema.fields[index]!,
              JSON.parse(text()),
              `state.${name}`,
              true,
            ),
          );
          this.#serviceResult = new Uint8Array();
        }
      } else if (op === 5) {
        state.presets.factory.load(text());
        this.#serviceResult = new Uint8Array();
      } else throw new Error('Unknown controller service');
      return this.#serviceResult.length;
    } catch (error) {
      if (op === 6) return 0;
      if (op === 0) return NaN;
      if (op === 1 || op === 4) return -1;
      this.#serviceResult = new TextEncoder().encode(
        (error instanceof Error ? error.message : String(error)) ||
          'Controller service failed',
      );
      return -this.#serviceResult.length;
    }
  }
}
