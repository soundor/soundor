// The engine's C++ core in WebAssembly: one module instance per engine, its
// node tree and Yoga layout driven by batched commands (protocol.ts), its
// answers handed to whoever shows the tree (the DOM, `ui/`). No DOM here.

import {
  Answer,
  Command,
  CommandWriter,
  NodeKind,
  PROTOCOL_VERSION,
  RecordReader,
} from './protocol.ts';
import { cssFont, TextMeasurer } from './text.ts';

/** Where the engine's module comes from. */
export interface ModuleSource {
  /**
   * Where the module (`soundor-core.wasm`) is. Fetched and compiled once per
   * URL; later engines from the same URL reuse the compiled module.
   */
  wasmUrl?: string | URL;
  /** The module, compiled or as bytes, instead of `wasmUrl`. */
  wasm?: WebAssembly.Module | BufferSource;
}

/** A node's laid-out box, as the engine reported it. */
export interface Frame {
  /** Relative to the parent's border box. */
  readonly x: number;
  readonly y: number;
  /** Relative to the parent's padding box: an element's `left` and `top`. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Border widths: top, right, bottom, left. */
  readonly border: readonly [number, number, number, number];
  /** Padding: top, right, bottom, left. */
  readonly padding: readonly [number, number, number, number];
}

/** A line of a text node, relative to its border box. */
export interface Line {
  /** UTF-16 offsets into the text. */
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A text or input node's text, laid out by the engine. */
export interface TextLines {
  /** The CSS font it was measured in (cssFont()). */
  readonly font: string;
  readonly lineHeight: number;
  /** Where its content box starts, from the top of the view. */
  readonly contentTop: number;
  readonly lines: readonly Line[];
}

/** How far a node's content reaches (Surface::contentSize()), and how much shows. */
export interface Extent {
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export type NodeType = keyof typeof NodeKind;

/** Who is told what a layout changed. */
export interface CoreSink {
  frame(handle: number, frame: Frame): void;
  text(handle: number, lines: TextLines): void;
  extent(handle: number, extent: Extent): void;
}

/** The handles of the roots: the content, and the overlay layer. */
export const ROOT = 1;
export const OVERLAY = 2;

interface Exports {
  readonly memory: WebAssembly.Memory;
  _initialize(): void;
  soundor_engine_protocol?(): number;
  soundor_engine_create(browserText: number): number;
  soundor_engine_destroy(engine: number): void;
  soundor_engine_input(engine: number, size: number): number;
  soundor_engine_apply(engine: number, length: number): number;
  soundor_engine_nodes(engine: number): number;
}

const modules = new Map<string, Promise<WebAssembly.Module>>();

/** Compiles the module (once per URL). */
export async function compileModule(
  source: ModuleSource,
): Promise<WebAssembly.Module> {
  if (source.wasm instanceof WebAssembly.Module) return source.wasm;
  if (source.wasm) {
    try {
      return await WebAssembly.compile(source.wasm);
    } catch (cause) {
      throw new Error('The Soundor engine module is not valid WebAssembly', {
        cause,
      });
    }
  }
  if (source.wasmUrl === undefined)
    throw new TypeError(
      "The Soundor engine needs its module's wasmUrl or wasm",
    );
  const url = new URL(source.wasmUrl, globalThis.location?.href).href;
  let module = modules.get(url);
  if (!module) {
    module = fetchModule(url);
    modules.set(url, module);
    // A failure is not remembered: the next engine tries again.
    module.catch(() => modules.delete(url));
  }
  return module;
}

async function fetchModule(url: string): Promise<WebAssembly.Module> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`Could not load the Soundor engine from ${url}`, {
      cause,
    });
  }
  if (!response.ok)
    throw new Error(
      `Could not load the Soundor engine from ${url}: HTTP ${response.status}`,
    );
  try {
    // Compiled while it downloads, where the server says what it is.
    if (response.headers.get('content-type') === 'application/wasm')
      return await WebAssembly.compileStreaming(response);
    return await WebAssembly.compile(await response.arrayBuffer());
  } catch (cause) {
    throw new Error(`${url} is not the Soundor engine's WebAssembly`, {
      cause,
    });
  }
}

const decoder = new TextDecoder();

/** The JavaScript a module's instance calls: text measurement, and WASI's few. */
function imports(
  memory: () => WebAssembly.Memory,
  measurer: TextMeasurer | undefined,
): WebAssembly.Imports {
  const text = (pointer: number, length: number): string =>
    decoder.decode(new Uint8Array(memory().buffer, pointer, length));
  const unmeasured = (): never => {
    throw new Error('the engine measured text without a measurer');
  };
  return {
    soundor: {
      measure: (
        family: number,
        familyLength: number,
        size: number,
        weight: number,
        italic: number,
        string: number,
        length: number,
      ): number =>
        measurer
          ? measurer.measure(
              text(family, familyLength),
              size,
              weight,
              italic !== 0,
              text(string, length),
            )
          : unmeasured(),
      metrics: (
        family: number,
        familyLength: number,
        size: number,
        weight: number,
        italic: number,
        out: number,
      ): void => {
        const [ascent, descent] = measurer
          ? measurer.metrics(
              text(family, familyLength),
              size,
              weight,
              italic !== 0,
            )
          : unmeasured();
        const view = new DataView(memory().buffer);
        view.setFloat32(out, ascent, true);
        view.setFloat32(out + 4, descent, true);
      },
    },
    env: { emscripten_notify_memory_growth: (): void => {} },
    wasi_snapshot_preview1: {
      // The C++ runtime's diagnostics (an abort's message), to the console.
      fd_write: (
        fd: number,
        iovs: number,
        count: number,
        written: number,
      ): number => {
        const view = new DataView(memory().buffer);
        let total = 0;
        let message = '';
        for (let i = 0; i < count; i++) {
          const pointer = view.getUint32(iovs + i * 8, true);
          const length = view.getUint32(iovs + i * 8 + 4, true);
          message += text(pointer, length);
          total += length;
        }
        if (message.trim()) console.error(`[soundor engine] ${message.trim()}`);
        view.setUint32(written, total, true);
        return 0;
      },
      fd_close: (): number => 0,
      fd_seek: (): number => 70, // ESPIPE: nothing to seek
      clock_time_get: (
        _id: number,
        _precision: bigint,
        out: number,
      ): number => {
        new DataView(memory().buffer).setBigUint64(
          out,
          BigInt(Math.round(performance.now() * 1e6)),
          true,
        );
        return 0;
      },
    },
  };
}

export interface CoreOptions {
  /**
   * How text is measured: with the browser's fonts (the default where there
   * is a canvas), or with the engine's approximation (every character 0.55
   * em wide: what native layout tests use).
   */
  textMeasurement?: 'browser' | 'approximate';
}

/** Whether `measurement` can be the browser's here. */
function measurer(
  measurement: CoreOptions['textMeasurement'],
): TextMeasurer | undefined {
  if (measurement === 'approximate') return undefined;
  const measuring = TextMeasurer.create();
  if (measuring === null && measurement === 'browser')
    throw new Error(
      "text measurement needs a canvas: use textMeasurement: 'approximate' where there is none",
    );
  return measuring ?? undefined;
}

/**
 * One engine: its module instance, memory and C++ engine. Changes are
 * written as commands and run together by one call into the module, when
 * something needs the layout (layout()) or must be checked now (a style).
 */
export class EngineCore {
  #exports: Exports | null;
  readonly #engine: number;
  readonly #writer = new CommandWriter();
  readonly #reader = new RecordReader();
  readonly #measurer: TextMeasurer | undefined;
  #input = 0;
  #capacity = 0;
  readonly #free: number[] = [];
  #next = OVERLAY + 1;
  /** Commands wait to be run. */
  #pending = false;
  /** Something may lay out differently. */
  #dirty = true;
  #size: [number, number] = [-1, -1];
  #scale = 0;
  /** Who is told what each layout changed. */
  sink: CoreSink | null = null;
  /** Calls into the module so far, for tests and measurements: one per batch. */
  calls = 0;

  /** Starts an engine from the compiled module, synchronously. */
  constructor(module: WebAssembly.Module, options: CoreOptions = {}) {
    this.#measurer = measurer(options.textMeasurement);
    let memory: WebAssembly.Memory | undefined;
    let instance: WebAssembly.Instance;
    try {
      instance = new WebAssembly.Instance(
        module,
        imports(() => memory!, this.#measurer),
      );
    } catch (cause) {
      throw new Error('Could not start the Soundor engine', { cause });
    }
    const exports = instance.exports as unknown as Exports;
    if (typeof exports.soundor_engine_create !== 'function')
      throw new Error('The module is not the Soundor engine');
    const protocol = exports.soundor_engine_protocol?.();
    if (protocol !== PROTOCOL_VERSION)
      throw new Error(
        `The Soundor engine's module speaks protocol ${protocol ?? 'none'}; this @soundor/engine/web speaks ${PROTOCOL_VERSION}: use the module of the same engine version`,
      );
    memory = exports.memory;
    exports._initialize();
    const engine = exports.soundor_engine_create(this.#measurer ? 1 : 0);
    if (engine === 0)
      throw new Error('Could not start the Soundor engine: out of memory');
    this.#exports = exports;
    this.#engine = engine;
  }

  get disposed(): boolean {
    return this.#exports === null;
  }

  /** Whether a layout() would change anything. */
  get dirty(): boolean {
    return this.#dirty || this.#pending;
  }

  /** The text measurer, if text is the browser's. */
  get measurer(): TextMeasurer | undefined {
    return this.#measurer;
  }

  #live(): Exports {
    if (!this.#exports) throw new Error('the engine is disposed');
    return this.#exports;
  }

  #command(command: (typeof Command)[keyof typeof Command]): number {
    this.#live();
    this.#pending = true;
    this.#dirty = true;
    return this.#writer.command(command);
  }

  /** A new node's handle. */
  create(type: NodeType): number {
    const handle = this.#free.pop() ?? this.#next++;
    this.#command(Command.Create);
    this.#writer.word(handle);
    this.#writer.word(NodeKind[type]);
    return handle;
  }

  /** Destroys a node: detached from its parent, and its children from it. */
  release(handle: number): void {
    if (this.disposed) return;
    this.#command(Command.Release);
    this.#writer.word(handle);
    this.#free.push(handle);
  }

  insert(parent: number, child: number, before: number): void {
    this.#command(Command.Insert);
    this.#writer.word(parent);
    this.#writer.word(child);
    this.#writer.word(before);
  }

  remove(parent: number, child: number): void {
    this.#command(Command.Remove);
    this.#writer.word(parent);
    this.#writer.word(child);
  }

  /**
   * Sets a node's style, checked now: throws a TypeError naming the first
   * invalid property, and the node keeps the style it had.
   */
  style(handle: number, style: object): void {
    const index = this.#command(Command.Style);
    this.#writer.word(handle);
    this.#writer.style(style);
    this.#run(index);
  }

  /** Checks a style as the engine reads one, without setting it: throws a TypeError if it is invalid. */
  checkStyle(style: object): void {
    const index = this.#command(Command.Check);
    this.#writer.style(style);
    this.#run(index);
  }

  text(handle: number, text: string): void {
    this.#command(Command.Text);
    this.#writer.word(handle);
    this.#writer.text(text);
  }

  placeholder(handle: number, text: string): void {
    this.#command(Command.Placeholder);
    this.#writer.word(handle);
    this.#writer.text(text);
  }

  /** The natural size an image, canvas or SVG node is measured by. */
  natural(handle: number, width: number, height: number): void {
    this.#command(Command.Natural);
    this.#writer.word(handle);
    this.#writer.real(width);
    this.#writer.real(height);
  }

  /** The page's fonts changed: text is measured again. */
  fontsChanged(): void {
    this.#measurer?.reset();
    this.#command(Command.Fonts);
  }

  /** The size the roots fill, in logical pixels. */
  setSize(width: number, height: number): void {
    if (this.#size[0] === width && this.#size[1] === height) return;
    this.#size = [width, height];
    this.#command(Command.Size);
    this.#writer.real(width);
    this.#writer.real(height);
  }

  /** Device pixels per logical pixel: layout snaps to them. */
  setScale(scale: number): void {
    if (this.#scale === scale) return;
    this.#scale = scale;
    this.#command(Command.Scale);
    this.#writer.real(scale);
  }

  /**
   * Runs the changes and lays out, if anything changed: one call into the
   * module, its answers handed to the sink.
   */
  layout(): void {
    if (this.disposed || !this.dirty) return;
    this.#command(Command.Layout);
    this.#dirty = false;
    this.#run(-1);
  }

  /** A node's extent now, laid out first. */
  extent(handle: number): Extent {
    this.#command(Command.Layout);
    this.#dirty = false;
    this.#command(Command.Extent);
    this.#writer.word(handle);
    this.#dirty = false;
    let found: Extent | undefined;
    this.#run(-1, (at, extent) => {
      if (at === handle) found = extent;
    });
    return (
      found ?? {
        contentWidth: 0,
        contentHeight: 0,
        clientWidth: 0,
        clientHeight: 0,
      }
    );
  }

  /** The number of nodes the engine holds, its roots included. */
  get nodeCount(): number {
    const exports = this.#live();
    if (this.#pending) this.#run(-1);
    return exports.soundor_engine_nodes(this.#engine);
  }

  dispose(): void {
    if (!this.#exports) return;
    this.#exports.soundor_engine_destroy(this.#engine);
    this.#exports = null;
    this.sink = null;
  }

  /**
   * Runs what was written; throws the error of command `checked` (a style),
   * if it failed. Other errors are the engine refusing what the adapter
   * checked already: they are thrown too, after the answer was handed out.
   */
  #run(
    checked: number,
    extentOf?: (handle: number, extent: Extent) => void,
  ): void {
    const exports = this.#live();
    const writer = this.#writer;
    if (writer.length > this.#capacity) {
      this.#input = exports.soundor_engine_input(this.#engine, writer.length);
      if (this.#input === 0) throw new Error('the engine is out of memory');
      this.#capacity = writer.length;
    }
    // The reader's view of the memory, renewed if it grew.
    this.#reader.view(exports.memory.buffer).set(writer.bytes, this.#input);
    const length = writer.length;
    writer.reset();
    this.#pending = false;
    this.calls++;
    const answer = exports.soundor_engine_apply(this.#engine, length);
    if (answer === 0) throw new Error('the engine failed (out of memory?)');
    let refused: Error | undefined;
    let other: Error | undefined;
    // The memory may have grown while it ran: read it as it is now.
    const reader = this.#reader.read(exports.memory.buffer, answer);
    const sink = this.sink;
    while (!reader.done) {
      const kind = reader.word();
      if (kind === Answer.Error) {
        const index = reader.word();
        const type = reader.word();
        const message = reader.text();
        const error = type === 1 ? new TypeError(message) : new Error(message);
        if (index === checked) refused = error;
        else other ??= error;
      } else if (kind === Answer.Frame) {
        const handle = reader.word();
        const frame: Frame = {
          x: reader.real(),
          y: reader.real(),
          left: reader.real(),
          top: reader.real(),
          width: reader.real(),
          height: reader.real(),
          border: [reader.real(), reader.real(), reader.real(), reader.real()],
          padding: [reader.real(), reader.real(), reader.real(), reader.real()],
        };
        sink?.frame(handle, frame);
      } else if (kind === Answer.Text) {
        const handle = reader.word();
        const size = reader.real();
        const weight = reader.word();
        const italic = reader.word() !== 0;
        const font = cssFont(reader.text(), size, weight, italic);
        const lineHeight = reader.real();
        const contentTop = reader.real();
        const count = reader.word();
        const lines: Line[] = [];
        for (let i = 0; i < count; i++)
          lines.push({
            start: reader.word(),
            end: reader.word(),
            x: reader.real(),
            y: reader.real(),
            width: reader.real(),
            height: reader.real(),
          });
        sink?.text(handle, { font, lineHeight, contentTop, lines });
      } else if (kind === Answer.Extent) {
        const handle = reader.word();
        const extent: Extent = {
          contentWidth: reader.real(),
          contentHeight: reader.real(),
          clientWidth: reader.real(),
          clientHeight: reader.real(),
        };
        extentOf?.(handle, extent);
        sink?.extent(handle, extent);
      } else
        throw new Error(`the engine answered with an unknown record ${kind}`);
    }
    if (refused) throw refused;
    if (other) throw other;
  }
}
