// The engine in a browser: Soundor's C++ core (its node tree, Yoga layout and
// styles) compiled to WebAssembly, driven from JavaScript. Changes are
// written as commands and run together by one call into the module, which
// answers with what changed in the layout (protocol.ts).

import { DomAdapter } from './dom.ts';
import { Answer, Command, CommandWriter, RecordReader } from './protocol.ts';
import type { Frame, Line, NodeState, NodeType, Rect } from './state.ts';
import { cssFont, type Style } from './style.ts';
import { TextMeasurer } from './text.ts';

export interface EngineOptions {
  /**
   * Where the module (`soundor-core.wasm`) is. Fetched and compiled once per
   * URL; later engines from the same URL reuse the compiled module.
   */
  wasmUrl?: string | URL;
  /** The module, compiled or as bytes, instead of `wasmUrl`. */
  wasm?: WebAssembly.Module | BufferSource;
  /**
   * How text is measured: with the browser's fonts (the default where there
   * is a canvas), or with the engine's approximation (every character 0.55
   * em wide: what native layout tests use).
   */
  textMeasurement?: 'browser' | 'approximate';
}

interface Exports {
  readonly memory: WebAssembly.Memory;
  _initialize(): void;
  soundor_engine_create(browserText: number): number;
  soundor_engine_destroy(engine: number): void;
  soundor_engine_input(engine: number, size: number): number;
  soundor_engine_apply(engine: number, length: number): number;
  soundor_engine_nodes(engine: number): number;
}

const modules = new Map<string, Promise<WebAssembly.Module>>();

async function compile(options: EngineOptions): Promise<WebAssembly.Module> {
  if (options.wasm instanceof WebAssembly.Module) return options.wasm;
  if (options.wasm) {
    try {
      return await WebAssembly.compile(options.wasm);
    } catch (cause) {
      throw new Error('The Soundor engine module is not valid WebAssembly', {
        cause,
      });
    }
  }
  if (options.wasmUrl === undefined)
    throw new TypeError('Engine.create() needs wasmUrl or wasm');
  const url = new URL(options.wasmUrl, globalThis.location?.href).href;
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

function disposedError(): Error {
  return new Error('the engine is disposed');
}

/** Each engine: its own module instance, memory and C++ engine. */
class Core {
  readonly root: NodeState;
  readonly nodes = new Map<number, NodeState>();
  readonly wrappers = new WeakMap<NodeState, EngineNode>();
  #exports: Exports | null;
  #engine: number;
  #writer = new CommandWriter();
  #input = 0;
  #capacity = 0;
  #styles: { index: number; node: NodeState; style: Style }[] = [];
  #free: number[] = [];
  #next = 2;
  #dirty = true;
  #scheduled = false;
  #dom: DomAdapter | null = null;
  #size: [number, number] = [0, 0];

  constructor(exports: Exports, engine: number) {
    this.#exports = exports;
    this.#engine = engine;
    this.root = this.#state(1, 'view');
  }

  get disposed(): boolean {
    return this.#exports === null;
  }

  get dom(): DomAdapter | null {
    return this.#dom;
  }

  get size(): readonly [number, number] {
    return this.#size;
  }

  #state(handle: number, type: NodeType): NodeState {
    const state: NodeState = {
      handle,
      type,
      style: {},
      committed: {},
      text: '',
      parent: null,
      children: [],
      frame: null,
      lines: null,
      released: false,
      element: null,
    };
    this.nodes.set(handle, state);
    return state;
  }

  #live(): Exports {
    if (!this.#exports) throw disposedError();
    return this.#exports;
  }

  #changed(): void {
    this.#dirty = true;
    // Mounted, the DOM follows by itself: once, after the current task's changes.
    if (this.#dom && !this.#scheduled) {
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (this.#exports && this.#dirty) this.flush();
      });
    }
  }

  create(type: NodeType): NodeState {
    this.#live();
    const handle = this.#free.pop() ?? this.#next++;
    const state = this.#state(handle, type);
    this.#writer.command(Command.Create);
    this.#writer.word(handle);
    this.#writer.word(type === 'view' ? 0 : 1);
    this.#dom?.create(state);
    this.#changed();
    return state;
  }

  release(node: NodeState): void {
    this.#live();
    if (node === this.root) throw new Error('the root cannot be released');
    if (node.released) return;
    // As natively: detached from its parent, its children from it.
    if (node.parent) this.remove(node.parent, node);
    for (const child of node.children) {
      child.parent = null;
      this.#dom?.remove(child);
    }
    node.children = [];
    node.released = true;
    this.nodes.delete(node.handle);
    this.#writer.command(Command.Release);
    this.#writer.word(node.handle);
    this.#free.push(node.handle);
    this.#dom?.release(node);
    this.#changed();
  }

  insert(parent: NodeState, child: NodeState, before: NodeState | null): void {
    this.#live();
    for (const node of [parent, child, before])
      if (node?.released) throw new Error('the node was released');
    if (parent.type !== 'view') throw new TypeError('only views have children');
    if (child === this.root) throw new TypeError('the root has no parent');
    if (before === child) return;
    if (before && before.parent !== parent)
      throw new Error('the node to insert before is not a child of this node');
    for (let at: NodeState | null = parent; at; at = at.parent)
      if (at === child) throw new Error('a node cannot contain itself');
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    const index = before
      ? parent.children.indexOf(before)
      : parent.children.length;
    parent.children.splice(index, 0, child);
    child.parent = parent;
    this.#writer.command(Command.Insert);
    this.#writer.word(parent.handle);
    this.#writer.word(child.handle);
    this.#writer.word(before?.handle ?? 0);
    this.#dom?.insert(parent, child, before);
    this.#changed();
  }

  remove(parent: NodeState, child: NodeState): void {
    this.#live();
    if (child.parent !== parent)
      throw new Error('the node is not a child of this node');
    parent.children.splice(parent.children.indexOf(child), 1);
    child.parent = null;
    this.#writer.command(Command.Remove);
    this.#writer.word(parent.handle);
    this.#writer.word(child.handle);
    this.#dom?.remove(child);
    this.#changed();
  }

  setStyle(node: NodeState, style: Style): void {
    this.#live();
    if (node.released) throw new Error('the node was released');
    node.style = style;
    const index = this.#writer.command(Command.Style);
    this.#writer.word(node.handle);
    this.#writer.style(style);
    this.#styles.push({ index, node, style });
    this.#changed();
  }

  setText(node: NodeState, text: string): void {
    this.#live();
    if (node.released) throw new Error('the node was released');
    if (node.type !== 'text') throw new TypeError('only text nodes have text');
    node.text = text;
    this.#writer.command(Command.Text);
    this.#writer.word(node.handle);
    this.#writer.text(text);
    this.#changed();
  }

  setSize(width: number, height: number): void {
    this.#live();
    if (this.#size[0] === width && this.#size[1] === height) return;
    this.#size = [width, height];
    this.#writer.command(Command.Size);
    this.#writer.real(width);
    this.#writer.real(height);
    this.#changed();
  }

  setScale(scale: number): void {
    this.#live();
    this.#writer.command(Command.Scale);
    this.#writer.real(scale);
    this.#changed();
  }

  /**
   * Runs the changes and lays out: one call into the module. Throws the first
   * change the engine refused (a TypeError for an invalid style, which leaves
   * the node's style as it was); the others are made.
   */
  flush(): void {
    const exports = this.#live();
    if (!this.#dirty) return;
    this.#dirty = false;
    const writer = this.#writer;
    writer.command(Command.Layout);
    if (writer.length > this.#capacity) {
      this.#input = exports.soundor_engine_input(this.#engine, writer.length);
      if (this.#input === 0) throw new Error('the engine is out of memory');
      this.#capacity = writer.length;
    }
    new Uint8Array(exports.memory.buffer, this.#input, writer.length).set(
      writer.bytes,
    );
    const length = writer.length;
    const styles = this.#styles;
    writer.reset();
    this.#styles = [];
    const answer = exports.soundor_engine_apply(this.#engine, length);
    if (answer === 0) throw new Error('the engine failed (out of memory?)');
    const errors = new Map<number, Error>();
    // The memory may have grown while it ran: read it as it is now.
    const reader = new RecordReader(exports.memory.buffer, answer);
    while (!reader.done) {
      const kind = reader.word();
      if (kind === Answer.Error) {
        const index = reader.word();
        const type = reader.word();
        const message = reader.text();
        errors.set(
          index,
          type === 1 ? new TypeError(message) : new Error(message),
        );
      } else if (kind === Answer.Frame) {
        const node = this.nodes.get(reader.word());
        const frame: Frame = {
          x: reader.real(),
          y: reader.real(),
          left: reader.real(),
          top: reader.real(),
          width: reader.real(),
          height: reader.real(),
          border: [reader.real(), reader.real(), reader.real(), reader.real()],
        };
        if (!node) continue;
        node.frame = frame;
        this.#dom?.frame(node, frame);
      } else if (kind === Answer.Text) {
        const node = this.nodes.get(reader.word());
        const size = reader.real();
        const weight = reader.word();
        const italic = reader.word() !== 0;
        const font = cssFont(reader.text(), size, weight, italic);
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
        if (!node) continue;
        node.lines = { font, lines };
        this.#dom?.lines(node, node.lines);
      } else
        throw new Error(`the engine answered with an unknown record ${kind}`);
    }
    for (const { index, node, style } of styles) {
      if (!errors.has(index)) {
        node.committed = style;
        this.#dom?.style(node);
      } else if (node.style === style) node.style = node.committed;
    }
    const first = [...errors.keys()].sort((a, b) => a - b)[0];
    if (first !== undefined) throw errors.get(first);
  }

  get engineNodes(): number {
    this.flush();
    return this.#live().soundor_engine_nodes(this.#engine);
  }

  mount(container: HTMLElement): void {
    this.#live();
    if (this.#dom) throw new Error('the engine is mounted already');
    const resize = (width: number, height: number): void => {
      if (!this.#exports) return;
      this.setSize(width, height);
      // Snapped to the display's pixels, as natively.
      this.setScale(globalThis.devicePixelRatio || 1);
      // Laid out before the browser paints the resized container.
      this.flush();
    };
    this.#dom = new DomAdapter(
      container,
      this.root,
      this.nodes.values(),
      resize,
    );
    resize(...this.#dom.contentSize());
  }

  unmount(): void {
    this.#dom?.dispose(this.nodes.values());
    this.#dom = null;
  }

  dispose(): void {
    if (!this.#exports) return;
    this.unmount();
    this.#exports.soundor_engine_destroy(this.#engine);
    this.#exports = null;
    for (const node of this.nodes.values()) node.released = true;
    this.nodes.clear();
  }
}

/**
 * Soundor's engine in WebAssembly: a tree of views and text, laid out by
 * the same C++ and Yoga as a plugin's, shown with HTML elements once
 * mounted. Experimental.
 */
export class Engine {
  readonly #core: Core;
  /** The tree's root: it fills the engine's size (the container, mounted). */
  readonly root: EngineNode;

  private constructor(core: Core) {
    this.#core = core;
    this.root = wrap(core, core.root);
  }

  /** Loads the module (once per URL) and starts an engine. */
  static async create(options: EngineOptions): Promise<Engine> {
    const module = await compile(options);
    const textMeasurement =
      options.textMeasurement ??
      (typeof OffscreenCanvas === 'function' || typeof document === 'object'
        ? 'browser'
        : 'approximate');
    const measurer =
      textMeasurement === 'browser' ? new TextMeasurer() : undefined;
    let memory: WebAssembly.Memory | undefined;
    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(
        module,
        imports(() => memory!, measurer),
      );
    } catch (cause) {
      throw new Error('Could not start the Soundor engine', { cause });
    }
    const exports = instance.exports as unknown as Exports;
    if (typeof exports.soundor_engine_create !== 'function')
      throw new Error('The module is not the Soundor engine');
    memory = exports.memory;
    exports._initialize();
    const engine = exports.soundor_engine_create(measurer ? 1 : 0);
    if (engine === 0)
      throw new Error('Could not start the Soundor engine: out of memory');
    return new Engine(new Core(exports, engine));
  }

  createView(style?: Style): EngineNode {
    const node = wrap(this.#core, this.#core.create('view'));
    if (style) node.style = style;
    return node;
  }

  createText(text = '', style?: Style): EngineNode {
    const node = wrap(this.#core, this.#core.create('text'));
    if (text) node.text = text;
    if (style) node.style = style;
    return node;
  }

  /** The size the root fills, in CSS pixels: the container's while mounted. */
  get size(): { readonly width: number; readonly height: number } {
    const [width, height] = this.#core.size;
    return { width, height };
  }

  setSize(width: number, height: number): void {
    this.#core.setSize(width, height);
  }

  /** Device pixels per CSS pixel: layout snaps to them. Mounted: the display's. */
  setScale(scale: number): void {
    this.#core.setScale(scale);
  }

  /**
   * Makes the changes so far and lays out, now. Mounted, the engine does
   * this by itself after the changes of a task; a node's `layout` does it
   * when it needs to. Throws the first change the engine refused.
   */
  flush(): void {
    this.#core.flush();
  }

  /**
   * Shows the tree in `container`, as HTML elements filling it, laid out
   * again whenever it resizes. One container at a time.
   */
  mount(container: HTMLElement): void {
    this.#core.mount(container);
  }

  /** Removes the elements from the container; the tree stays. */
  unmount(): void {
    this.#core.unmount();
  }

  /** The element mounted in the container (the root's), or null. */
  get element(): HTMLElement | null {
    return this.#core.dom ? this.#core.root.element : null;
  }

  /** The number of nodes the engine holds, its root included. */
  get nodeCount(): number {
    return this.#core.engineNodes;
  }

  get disposed(): boolean {
    return this.#core.disposed;
  }

  /**
   * Destroys the engine now: its C++ state, its elements and its observers.
   * Its nodes can no longer be used; calling it again does nothing.
   */
  dispose(): void {
    this.#core.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

const token = Symbol('EngineNode');
const states = new WeakMap<EngineNode, NodeState>();

function wrap(core: Core, state: NodeState): EngineNode {
  let node = core.wrappers.get(state);
  if (!node) {
    node = new EngineNode(token, { core, state });
    core.wrappers.set(state, node);
    states.set(node, state);
  }
  return node;
}

function stateOf(core: Core, node: EngineNode): NodeState {
  const state = states.get(node);
  if (!state || core.wrappers.get(state) !== node)
    throw new TypeError('the node belongs to another engine');
  return state;
}

/** A view or a text node of an Engine. */
export class EngineNode {
  readonly #core: Core;
  readonly #state: NodeState;

  /** Nodes are made by their engine (createView(), createText()). */
  constructor(key: symbol, internal: object) {
    if (key !== token) throw new TypeError('nodes are created by an Engine');
    ({ core: this.#core, state: this.#state } = internal as {
      core: Core;
      state: NodeState;
    });
  }

  get type(): NodeType {
    return this.#state.type;
  }

  /** The style asked for: the engine checks it when it next lays out. */
  get style(): Style {
    return this.#state.style;
  }

  set style(style: Style) {
    this.#core.setStyle(this.#state, style);
  }

  /** A text node's text. */
  get text(): string {
    return this.#state.text;
  }

  set text(text: string) {
    this.#core.setText(this.#state, String(text));
  }

  get parent(): EngineNode | null {
    return this.#state.parent ? wrap(this.#core, this.#state.parent) : null;
  }

  get children(): readonly EngineNode[] {
    return this.#state.children.map((child) => wrap(this.#core, child));
  }

  appendChild(child: EngineNode): EngineNode {
    this.#core.insert(this.#state, stateOf(this.#core, child), null);
    return child;
  }

  /** Inserts `child` before `before` (null: at the end), moving it from where it was. */
  insertBefore(child: EngineNode, before: EngineNode | null): EngineNode {
    this.#core.insert(
      this.#state,
      stateOf(this.#core, child),
      before ? stateOf(this.#core, before) : null,
    );
    return child;
  }

  removeChild(child: EngineNode): EngineNode {
    this.#core.remove(this.#state, stateOf(this.#core, child));
    return child;
  }

  /** Removes the node from its parent, if it has one. */
  remove(): void {
    if (this.#state.parent) this.#core.remove(this.#state.parent, this.#state);
  }

  /**
   * Destroys the node: detached from its parent, and its children from it
   * (they live on). It can no longer be used.
   */
  release(): void {
    this.#core.release(this.#state);
  }

  get released(): boolean {
    return this.#state.released;
  }

  /**
   * Its box relative to its parent's (border box to border box), laid out
   * now if anything changed. Zero until it is first laid out in the tree.
   */
  get layout(): Rect {
    if (!this.#core.disposed) this.#core.flush();
    const frame = this.#state.frame;
    return frame
      ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
      : { x: 0, y: 0, width: 0, height: 0 };
  }

  /** A text node's lines as laid out (UTF-16 offsets, boxes relative to the node). */
  get lines(): readonly Line[] {
    if (!this.#core.disposed) this.#core.flush();
    return this.#state.lines?.lines ?? [];
  }

  /** Its element while the engine is mounted, or null. */
  get element(): HTMLElement | null {
    return this.#state.element;
  }
}
