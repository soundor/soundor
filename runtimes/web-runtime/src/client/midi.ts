import type {
  ProcessorNode,
  WorkletMessage,
} from '@soundor/engine/web/processor';
/** Host MIDI routing; hardware access is requested only by an explicit host action. */
import {
  createMidi,
  decodeMidi,
  encodeMidi,
} from '@soundor/runtime-sdk/client';
import type { Midi, MidiMessage, MidiSendResult } from 'soundor:midi';

import type { WasmController } from './wasm-controller';

export interface MidiDevice {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: string;
}
export type MidiPermission =
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'error';
export class WebMidiHost {
  readonly api: Midi;
  readonly #bridge;
  readonly #capabilities;
  readonly #navigator;
  #access: MIDIAccess | undefined;
  #input: string | null = null;
  #output: string | null = null;
  #processor: ProcessorNode | undefined;
  #controller: WasmController | undefined;
  #context: AudioContext | undefined;
  #observed = false;
  #removeStateChange: (() => void) | undefined;
  #disposed = false;
  #permission: MidiPermission = 'prompt';
  #error: string | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(
    capabilities: { input?: boolean; output?: boolean } = {},
    browser:
      | Pick<Navigator, 'requestMIDIAccess'>
      | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  ) {
    this.#capabilities = capabilities;
    this.#navigator = browser;
    this.#bridge = createMidi({
      send: (bytes) => this.#send(bytes, 2),
      observe: (enabled) => {
        this.#observed = enabled;
        this.#observe();
      },
      reportError: (error) => console.error('MIDI subscriber:', error),
    });
    this.api = this.#bridge.midi;
  }
  get inputEnabled(): boolean {
    return !!this.#capabilities.input;
  }
  get outputEnabled(): boolean {
    return !!this.#capabilities.output;
  }
  get outputTiming(): 'none' | 'timestamped' | 'immediate' {
    const output = this.#output
      ? this.#access?.outputs.get(this.#output)
      : undefined;
    return !output
      ? 'none'
      : typeof (output as MIDIOutput & { clear?: () => void }).clear ===
          'function'
        ? 'timestamped'
        : 'immediate';
  }
  get permission(): MidiPermission {
    return this.#permission;
  }
  get error(): string | undefined {
    return this.#error;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get input(): string | null {
    return this.#input;
  }
  get output(): string | null {
    return this.#output;
  }
  get inputs(): readonly MidiDevice[] {
    return this.#devices(this.#access?.inputs);
  }
  get outputs(): readonly MidiDevice[] {
    return this.#devices(this.#access?.outputs);
  }
  #devices(ports: MIDIInputMap | MIDIOutputMap | undefined): MidiDevice[] {
    return ports
      ? [...ports.values()].map((port) => ({
          id: port.id,
          name: port.name ?? port.id,
          manufacturer: port.manufacturer ?? '',
          state: port.state,
        }))
      : [];
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
  async requestAccess(): Promise<MidiPermission> {
    if (this.#disposed) throw new Error('MIDI host shut down');
    if (this.#access) return 'granted';
    if (!this.#navigator?.requestMIDIAccess) {
      this.#permission = 'unsupported';
      this.#changed();
      return this.#permission;
    }
    try {
      const access = await this.#navigator.requestMIDIAccess({ sysex: false });
      if (this.#disposed) return 'error';
      this.#access = access;
      this.#permission = 'granted';
      access.onstatechange = () => {
        if (
          this.#input &&
          access.inputs.get(this.#input)?.state !== 'connected'
        )
          this.reset();
        this.#bindInput();
        if (this.#output) this.#silenceOutput();
        this.#changed();
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      this.#permission =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : 'error';
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.#changed();
    return this.#permission;
  }
  selectInput(id: string | null): void {
    if (this.#disposed) throw new Error('MIDI host shut down');
    if (id !== null && !this.#capabilities.input)
      throw new Error('Host MIDI input is disabled in soundor.config.ts');
    if (id !== null && !this.#access?.inputs.has(id))
      throw new Error('Unknown MIDI input');
    if (this.#access)
      for (const port of this.#access.inputs.values())
        port.onmidimessage = null;
    this.reset();
    this.#input = id;
    this.#bindInput();
    this.#changed();
  }
  selectOutput(id: string | null): void {
    if (this.#disposed) throw new Error('MIDI host shut down');
    if (id !== null && !this.#capabilities.output)
      throw new Error('Host MIDI output is disabled in soundor.config.ts');
    if (id !== null && !this.#access?.outputs.has(id))
      throw new Error('Unknown MIDI output');
    this.#silenceOutput();
    this.#output = id;
    this.#silenceOutput();
    this.#changed();
  }
  #bindInput(): void {
    if (!this.#access) return;
    for (const port of this.#access.inputs.values())
      port.onmidimessage =
        port.id === this.#input
          ? (event) => {
              if (!event.data) return;
              try {
                // Device callbacks describe already-arrived input. Deliver at the
                // earliest render quantum; arbitrary browser tasks cannot backdate it.
                const context = this.#context;
                let offset = 0;
                if (context && Number.isFinite(event.timeStamp)) {
                  const nextBlock =
                    Math.ceil(
                      (context.currentTime * context.sampleRate) / 128,
                    ) * 128;
                  const at =
                    context.currentTime * context.sampleRate +
                    ((event.timeStamp - performance.now()) *
                      context.sampleRate) /
                      1000;
                  offset = Math.max(0, Math.round(at - nextBlock));
                  if (offset >= 128)
                    throw new RangeError(
                      'MIDI timestamp is beyond the next render block',
                    );
                }
                this.inject(decodeMidi(event.data), offset);
              } catch (error) {
                // Unsupported system/SysEx messages are outside v1. A channel-data
                // decoding error requests recovery rather than retaining held notes.
                if ((event.data[0] ?? 0) < 0xf0) {
                  this.reset();
                  console.error('Invalid MIDI input:', error);
                }
              }
            }
          : null;
  }
  /** Virtual host input, without permissions or hardware. Internal UI sends use api.send. */
  inject(message: MidiMessage, sampleOffset = 0): MidiSendResult {
    const bytes = encodeMidi(message);
    if (!this.#capabilities.input) return 'inactive';
    return this.#send(bytes, 1, sampleOffset);
  }
  #send(bytes: Uint8Array, source: number, offset = 0): MidiSendResult {
    const packed = bytes[0]! | (bytes[1]! << 8) | ((bytes[2] ?? 0) << 16);
    return this.#processor?.sendMidi(packed, source, offset) ?? 'inactive';
  }
  attach(
    processor: ProcessorNode,
    context: AudioContext,
    controller?: WasmController,
  ): void {
    this.#processor = processor;
    this.#context = context;
    this.#controller = controller;
    const update = () => {
      controller?.connectMidi(
        context.state === 'running'
          ? (bytes) => {
              if (processor.sendMidi(bytes, 3) !== 'sent') this.reset();
            }
          : undefined,
      );
      if (context.state !== 'running') this.reset();
    };
    context.addEventListener?.('statechange', update);
    this.#removeStateChange = () =>
      context.removeEventListener?.('statechange', update);
    update();
    this.#observe();
    this.reset();
  }
  #observe(): void {
    this.#processor?.observeMidi(
      this.#observed || (this.#controller?.wantsMidi ?? false),
      !!this.#capabilities.output,
    );
  }
  detach(): void {
    this.#removeStateChange?.();
    this.#removeStateChange = undefined;
    this.#controller?.connectMidi(undefined);
    this.reset();
    this.#processor = undefined;
    this.#context = undefined;
    this.#controller = undefined;
  }
  reset(): void {
    if (this.#disposed) return;
    this.#processor?.reset();
    this.#bridge.receive({ events: [], dropped: 0, reset: true });
    this.#silenceOutput();
  }
  #silenceOutput(): void {
    const port = this.#output
      ? this.#access?.outputs.get(this.#output)
      : undefined;
    if (port?.state !== 'connected') return;
    try {
      // clear() is not implemented by every Web MIDI browser.
      (port as MIDIOutput & { clear?: () => void }).clear?.();
      for (let channel = 0; channel < 16; channel++) {
        port.send([0xb0 | channel, 64, 0]);
        port.send([0xb0 | channel, 120, 0]);
        port.send([0xb0 | channel, 123, 0]);
      }
    } catch (error) {
      this.#error = String(error);
    }
  }
  receive(batch: Extract<WorkletMessage, { type: 'midi' }>): void {
    if (this.#disposed) return;
    this.#controller?.receiveMidi(
      batch.publications,
      batch.reset ? 0 : batch.publicationCount,
      batch.reset,
    );
    const events = [];
    if (!batch.reset)
      for (let i = 0; i < batch.publicationCount; i++) {
        const word = batch.publications[i * 2 + 1]!;
        const kind = word & 0xf0;
        const message = decodeMidi(
          kind === 0xc0 || kind === 0xd0
            ? [word & 255, (word >> 8) & 127]
            : [word & 255, (word >> 8) & 127, (word >> 16) & 127],
        );
        const source = word >>> 24;
        events.push({
          message,
          sampleOffset: batch.publications[i * 2]!,
          ...(source
            ? {
                source:
                  source === 1
                    ? ('host' as const)
                    : source === 2
                      ? ('ui' as const)
                      : ('controller' as const),
              }
            : {}),
        });
      }
    this.#bridge.receive({
      events,
      dropped: batch.dropped,
      reset: batch.reset,
    });
    if (batch.reset) {
      this.#silenceOutput();
      return;
    }
    const output = this.#output
      ? this.#access?.outputs.get(this.#output)
      : undefined;
    const context = this.#context;
    if (
      !output ||
      output.state !== 'connected' ||
      !context ||
      !this.#capabilities.output
    )
      return;
    const clock = context.getOutputTimestamp?.();
    const base = clock?.contextTime
      ? clock.performanceTime! + (batch.time - clock.contextTime) * 1000
      : performance.now() + (batch.time - context.currentTime) * 1000;
    try {
      for (let i = 0; i < batch.outputCount; i++) {
        const word = batch.output[i * 2 + 1]!;
        const kind = word & 0xf0;
        const bytes =
          kind === 0xc0 || kind === 0xd0
            ? [word & 255, (word >> 8) & 127]
            : [word & 255, (word >> 8) & 127, (word >> 16) & 127];
        if (this.outputTiming === 'immediate') {
          output.send(bytes);
          continue;
        }
        output.send(
          bytes,
          Math.max(
            performance.now(),
            base + (batch.output[i * 2]! / context.sampleRate) * 1000,
          ),
        );
      }
    } catch (error) {
      this.#error = String(error);
      this.#silenceOutput();
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.detach();
    this.#disposed = true;
    if (this.#access) {
      this.#access.onstatechange = null;
      for (const port of this.#access.inputs.values())
        port.onmidimessage = null;
    }
    this.#bridge.dispose();
    this.#listeners.clear();
  }
}
