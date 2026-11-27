/**
 * The plugin view in the browser: the root node's element, focus, and the
 * routing of the browser's input to Soundor events.
 *
 * Input follows the native runtime's Surface rule for rule, so plugin UIs
 * behave alike in both: a pressed pointer is captured by its target until
 * the last button is up; hover enters and leaves along the tree; a click
 * goes to the deepest node holding both press and release; pressing moves
 * focus to the nearest focusable node; Tab cycles focusable nodes; the
 * wheel scrolls the nearest scroll view that can; the secondary button
 * asks for a context menu (`contextmenu`). Hit testing is the
 * browser's (it honors `pointerEvents`), and text inputs edit natively.
 */

import {
  canHold,
  longPressed,
  LongPresses,
} from '../../../src/modules/ui/longPress.js';
import {
  compileModule,
  EngineCore,
  OVERLAY,
  ROOT,
  type CoreOptions,
  type ModuleSource,
} from '../core.ts';
import type { Baselines } from '../text.ts';
import { AnimationController } from './animation.ts';
import {
  AccessibilityActionEvent,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
} from './events.ts';
import { Listeners } from './listeners.ts';
import {
  createNode,
  nodeOf,
  UiNode,
  type ViewLink,
  type UiElement,
} from './node.ts';
import { updateSemantics } from './semantics.ts';
import { STYLESHEET } from './style.ts';
import type {
  Cursor,
  EditorSize,
  LayoutRect,
  NodeType,
  Style,
  ViewSize,
} from './types.ts';

export interface EngineOptions extends CoreOptions {
  /** The document the view is made in; the page's by default. */
  document?: Document;
  /**
   * The engine's module, compiled; by default the one Engine.load() last
   * loaded.
   */
  module?: WebAssembly.Module;
  /**
   * The URL of a bundled asset (an image node's source, an asset id), or
   * null where it names none: the runtime's to say. Images show nothing
   * without it.
   */
  assetUrl?: (id: string) => string | null;
}

/** The module Engine.load() loaded, which engines start from by default. */
let loaded: WebAssembly.Module | undefined;

/** Pixels a wheel line scrolls, as in the native runtime and browsers. */
const PIXELS_PER_LINE = 40;
/** Keys that pressed on their own do not show focus. */
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
]);

const STYLE_ID = 'soundor-ui-style';
/** How long a message stays in its live region: read by then. */
const ANNOUNCEMENT_MS = 7000;
type AnnouncePriority = 'polite' | 'assertive';

interface PointerState {
  captured: UiNode | null;
  suppressClick: boolean;
  /** macOS Control with the primary button: a secondary press, as natively. */
  controlClick: boolean;
  hovered: UiNode[];
  /** The last input, where hover is refreshed from. */
  last: globalThis.PointerEvent | null;
  /** In the view, as of the last input. */
  inside: boolean;
  /**
   * The element the browser's last press went to: while it is in the
   * document, the browser follows the release with its own `click`.
   */
  pressedElement: Element | null;
}

/**
 * A pointer click waiting for the browser's own: only the browser's `click`
 * says which of a series it is (its `detail`, by the platform's double-click
 * time and distance), and it comes right after the release.
 */
interface PendingClick {
  node: UiNode;
  release: globalThis.PointerEvent;
  timer: ReturnType<typeof setTimeout>;
  /** What the release does after its click, as natively (hover). */
  after: () => void;
}

const elementOf = (node: UiNode): UiElement => UiNode.elementOf(node);

/**
 * The plugin view: Soundor's engine in a browser. Its C++ core (the node tree,
 * styles, Yoga layout and text layout, compiled to WebAssembly) lays out what
 * plugin code builds with UiNodes, and this shows it as HTML elements,
 * placed where the engine says and drawn with CSS, routing the browser's
 * input to Soundor events. Each engine has its own module instance.
 */
export class Engine implements ViewLink {
  readonly animations: AnimationController;
  /** The view's element: the surface both roots fill, and take input on. */
  readonly rootElement: HTMLElement;
  /** The content. */
  readonly root: UiNode;
  /** The overlay layer: over all of the content, and hit before it. */
  readonly overlay: UiNode;
  readonly #pointers = new Map<number, PointerState>();
  readonly #committed = new WeakMap<UiNode, string>();
  readonly #controller = new AbortController();
  #focused: UiNode | null = null;
  /**
   * The context menu request the view made from input it saw (a secondary
   * press, a menu key, a touch hold), until the browser's own `contextmenu`
   * for that input answers it: canceled, it keeps the browser's menu away.
   * Any new press or key ends it.
   */
  #menu: { canceled: boolean } | null = null;
  /** The menu key held: what the browser sends meanwhile is its. */
  #menuKey: { key: string; canceled: boolean } | null = null;
  readonly gestures = new LongPresses();

  suppressPointerClick(id: number): void {
    const state = this.#pointers.get(id);
    if (state !== undefined) state.suppressClick = true;
  }
  /**
   * Whether the focused node shows its focus, and whether the last input
   * was the keyboard's (or assistive technology's) rather than a pointer
   * press: what focus moved now would show. As the native runtime decides.
   */
  #focusShown = false;
  #keyboardModality = true;
  /** Set while the view moves DOM focus itself. */
  #movingFocus = false;
  /** Whether the last pointerdown kept the browser's default (focus, caret). */
  #nativeDown = false;
  #pendingClick: PendingClick | null = null;
  #clipboard = '';
  /** announce()'s live regions, and the messages they still hold. */
  readonly #liveRegions: Record<AnnouncePriority, HTMLElement>;
  readonly #announced = new Set<ReturnType<typeof setTimeout>>();
  /** Whether the ARIA is to be brought up to date. */
  #semanticsPending = false;
  /** The pointer whose cursor shows (the mouse), and the cursor shown. */
  #cursorPointer = 1;
  #cursor: Cursor = 'default';
  /** The node holding the pointer lock, and the pointer it holds. */
  #lock: { node: UiNode; pointerId: number } | null = null;
  /** The frame hover is to be refreshed in, if any. */
  #hoverFrame: number | null = null;
  #resizes: ResizeObserver | null = null;
  readonly #layoutListeners = new Set<() => void>();
  /** The latest size(); replaced (never changed) when the size changes. */
  #size: ViewSize = Object.freeze({
    width: 0,
    height: 0,
    scale: 1,
    safeArea: Object.freeze({ x: 0, y: 0, width: 0, height: 0 }),
  });
  /** The size subscribers were last told of (size() may be newer). */
  #notifiedSize = this.#size;
  readonly #sizeListeners = new Listeners<ViewSize>();
  /** What the host says of the view: its safe area (null: all of it). */
  #safeArea: LayoutRect | null = null;
  /** The editor's size, as the host last said; replaced when it changes. */
  #editorSize: EditorSize = Object.freeze({
    width: 0,
    height: 0,
    resizable: false,
  });
  readonly #editorListeners = new Listeners<EditorSize>();
  readonly #visibilityListeners = new Listeners<boolean>();
  #visibility = true;
  readonly #visibilityChanged = () => {
    const next = this.isVisible();
    if (next === this.#visibility) return;
    this.#visibility = next;
    this.#visibilityListeners.notify(next);
  };
  readonly #focusListeners = new Listeners<boolean>();
  #focus = false;
  readonly #focusChanged = () => {
    const next = this.isFocused();
    if (next === this.#focus) return;
    this.#focus = next;
    this.#focusListeners.notify(next);
  };
  /** CSS pixels per editor pixel, as the host last said. */
  #editorFit = 1;
  /** Where requestEditorSize() goes: the host's viewport. */
  #requestEditorSize:
    | ((size: { width: number; height: number }) => {
        width: number;
        height: number;
      } | null)
    | null = null;

  readonly core: EngineCore;
  readonly #assetUrl: (id: string) => string | null;
  /** The node of each handle the engine reports, while plugin code keeps it. */
  readonly #handles = new Map<number, WeakRef<UiNode>>();
  /** Releases a node in the engine once plugin code no longer has it. */
  readonly #finalizer = new FinalizationRegistry<number>((handle) => {
    this.#handles.delete(handle);
    this.core.release(handle);
  });
  /** A layout is to run before the next paint. */
  #layoutQueued = false;
  /** The size and scale the view is laid out at, as last measured. */
  #layoutSize: ViewSize = this.#size;
  #disposed = false;

  /**
   * Compiles the engine's module (once per URL) and keeps it as the one
   * engines start from by default: then `new Engine()` is synchronous.
   */
  static async load(source: ModuleSource): Promise<WebAssembly.Module> {
    loaded = await compileModule(source);
    return loaded;
  }

  /** Loads the module (once per URL) and starts an engine. */
  static async create(
    options: ModuleSource & EngineOptions = {},
  ): Promise<Engine> {
    const module =
      options.module ??
      (options.wasm !== undefined || options.wasmUrl !== undefined
        ? await compileModule(options)
        : loaded);
    return new Engine({ ...options, module });
  }

  /** Whether a module was loaded for engines to start from. */
  static get loaded(): boolean {
    return loaded !== undefined;
  }

  constructor(options: EngineOptions = {}) {
    const document = options.document ?? globalThis.document;
    const module = options.module ?? loaded;
    if (module === undefined)
      throw new Error(
        "The Soundor engine's WebAssembly is not loaded: await Engine.load({ wasmUrl }) before starting an engine",
      );
    this.core = new EngineCore(module, options);
    this.#assetUrl = options.assetUrl ?? (() => null);
    this.core.sink = {
      frame: (handle, frame) => {
        const node = this.#handles.get(handle)?.deref();
        if (node !== undefined) UiNode.placed(node, frame);
      },
      text: (handle, lines) => {
        const node = this.#handles.get(handle)?.deref();
        if (node !== undefined) UiNode.textLaidOut(node, lines);
      },
      extent: (handle, extent) => {
        const node = this.#handles.get(handle)?.deref();
        if (node !== undefined) UiNode.extended(node, extent);
      },
    };
    this.animations = new AnimationController(document.defaultView, (style) =>
      this.core.checkStyle(style),
    );
    if (document.getElementById(STYLE_ID) === null) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLESHEET;
      document.head.append(style);
    }
    this.rootElement = document.createElement('div');
    this.rootElement.className = 'sd-surface';
    this.rootElement.tabIndex = -1;
    this.rootElement.style.touchAction = 'none';
    this.root = createNode(this, 'view', {
      element: document.createElement('div'),
      handle: ROOT,
      overlay: false,
    });
    this.overlay = createNode(this, 'view', {
      element: document.createElement('div'),
      handle: OVERLAY,
      overlay: true,
    });
    const liveRegion = (priority: AnnouncePriority) => {
      const region = document.createElement('div');
      region.className = 'sd-live';
      region.setAttribute('aria-live', priority);
      region.setAttribute('aria-relevant', 'additions');
      return region;
    };
    this.#liveRegions = {
      polite: liveRegion('polite'),
      assertive: liveRegion('assertive'),
    };
    this.rootElement.append(
      elementOf(this.root),
      elementOf(this.overlay),
      this.#liveRegions.polite,
      this.#liveRegions.assertive,
    );
    this.#listen();
    this.#visibility = this.isVisible();
    document.addEventListener('visibilitychange', this.#visibilityChanged);
    this.#focus = this.isFocused();
    document.defaultView?.addEventListener('focus', this.#focusChanged);
    document.defaultView?.addEventListener('blur', this.#focusChanged);
    // A font arriving changes what text measures.
    document.fonts?.addEventListener('loadingdone', this.#fontsChanged, {
      signal: this.#controller.signal,
    });
  }

  readonly #fontsChanged = (): void => {
    if (this.#disposed) return;
    this.core.fontsChanged();
    this.layoutChanged();
  };

  baselines(font: string, size: number, lineHeight: number): Baselines | null {
    return (
      this.core.measurer?.baselines(
        this.rootElement.ownerDocument,
        font,
        size,
        lineHeight,
      ) ?? null
    );
  }

  register(node: UiNode, handle: number): void {
    this.#handles.set(handle, new WeakRef(node));
    if (handle !== ROOT && handle !== OVERLAY)
      this.#finalizer.register(node, handle);
  }

  assetUrl(id: string): string | null {
    return id === '' ? null : this.#assetUrl(id);
  }

  pixelScale(): number {
    return this.#layoutSize.scale > 0 ? this.#layoutSize.scale : 1;
  }

  layoutChanged(): void {
    if (this.#layoutQueued || this.#disposed) return;
    this.#layoutQueued = true;
    // After what the plugin is doing now, and always before a paint.
    queueMicrotask(() => {
      this.#layoutQueued = false;
      this.flushLayout();
    });
  }

  /**
   * Has the engine lay the view out, if anything changed, and places its
   * elements: what `layout` and the like read. Each root fills the view, on
   * its own: the overlay is not in the content's flow.
   */
  flushLayout(): void {
    if (this.#disposed || !this.core.dirty) return;
    this.core.layout();
    for (const listener of [...this.#layoutListeners]) listener();
  }

  /** Calls `listener` after each layout; returns what stops it. */
  onLayout(listener: () => void): () => void {
    this.#layoutListeners.add(listener);
    return () => this.#layoutListeners.delete(listener);
  }

  /** Shows the view in `container` (the host's plugin viewport). */
  mount(container: HTMLElement): void {
    container.append(this.rootElement);
    this.measure();
  }

  /** Detaches the view and its input listeners. */
  dispose(): void {
    this.gestures.clear();
    this.animations.dispose();
    this.#resizes?.disconnect();
    this.#sizeListeners.clear();
    this.#editorListeners.clear();
    this.#visibilityListeners.clear();
    this.#focusListeners.clear();
    this.rootElement.ownerDocument.defaultView?.removeEventListener(
      'focus',
      this.#focusChanged,
    );
    this.rootElement.ownerDocument.defaultView?.removeEventListener(
      'blur',
      this.#focusChanged,
    );
    this.rootElement.ownerDocument.removeEventListener(
      'visibilitychange',
      this.#visibilityChanged,
    );
    if (this.#hoverFrame !== null)
      this.rootElement.ownerDocument.defaultView?.cancelAnimationFrame(
        this.#hoverFrame,
      );
    this.#controller.abort();
    if (this.#pendingClick !== null) clearTimeout(this.#pendingClick.timer);
    this.#pendingClick = null;
    for (const timer of this.#announced) clearTimeout(timer);
    this.#announced.clear();
    this.rootElement.remove();
    this.#disposed = true;
    this.#handles.clear();
    this.core.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  createNode(type: NodeType): UiNode {
    return createNode(this, type);
  }

  /** A new, detached view: a box laid out with flexbox. */
  createView(style?: Style): UiNode {
    const node = this.createNode('view');
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached text node. */
  createText(text = '', style?: Style): UiNode {
    const node = this.createNode('text');
    if (text !== '') node.text = text;
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached image showing a bundled asset. */
  createImage(source = '', style?: Style): UiNode {
    const node = this.createNode('image');
    if (source !== '') node.source = source;
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A root vector viewport; the shapes in it have no nodes of their own. */
  createSvg(style?: Style): UiNode {
    const node = this.createNode('svg');
    if (style !== undefined) node.style = style;
    return node;
  }

  /**
   * A new, detached canvas: pixels code draws with getContext('2d'), 300 by
   * 150 until its width and height say otherwise. Its box is that size in
   * logical pixels unless its style sizes it.
   */
  createCanvas(style?: Style): UiNode {
    const node = this.createNode('canvas');
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached single-line text input. It is focusable. */
  createTextInput(
    options: { value?: string; placeholder?: string; style?: Style } = {},
  ): UiNode {
    const node = this.createNode('input');
    if (options.value !== undefined) node.value = options.value;
    if (options.placeholder !== undefined)
      node.placeholder = options.placeholder;
    if (options.style !== undefined) node.style = options.style;
    return node;
  }

  /** CSS pixels per logical pixel: the host may scale the viewport. */
  scale(): number {
    const width = this.rootElement.offsetWidth;
    if (width === 0) return 1;
    return this.rootElement.getBoundingClientRect().width / width || 1;
  }

  /**
   * The view's size in logical pixels, and device pixels per logical pixel:
   * measured, but the same frozen object until one of them changes.
   */
  size(): ViewSize {
    const window = this.rootElement.ownerDocument.defaultView;
    const width = this.rootElement.offsetWidth;
    const height = this.rootElement.offsetHeight;
    const scale = (window?.devicePixelRatio ?? 1) * this.scale();
    const safe = this.#safeArea ?? { x: 0, y: 0, width, height };
    const size = this.#size;
    const known = size.safeArea;
    if (
      width !== size.width ||
      height !== size.height ||
      scale !== size.scale ||
      safe.x !== known.x ||
      safe.y !== known.y ||
      safe.width !== known.width ||
      safe.height !== known.height
    ) {
      this.#size = Object.freeze({
        width,
        height,
        scale,
        safeArea: Object.freeze({ ...safe }),
      });
    }
    return this.#size;
  }

  isVisible(): boolean {
    return this.rootElement.ownerDocument.visibilityState !== 'hidden';
  }

  subscribeVisibility(listener: (visible: boolean) => void): () => void {
    return this.#visibilityListeners.add(listener, 'subscribeVisibility()');
  }

  isFocused(): boolean {
    return this.rootElement.ownerDocument.hasFocus();
  }

  subscribeFocus(listener: (focused: boolean) => void): () => void {
    return this.#focusListeners.add(listener, 'subscribeFocus()');
  }

  /** The editor's size in logical pixels; the same object until it changes. */
  editorSize(): EditorSize {
    return this.#editorSize;
  }

  /**
   * Calls `listener` with the new editorSize() whenever the host says the
   * editor has another size. Returns a function that unsubscribes.
   */
  subscribeEditorSize(listener: (size: EditorSize) => void): () => void {
    return this.#editorListeners.add(listener, 'subscribeEditorSize()');
  }

  /**
   * The host's word on the view: the size of the editor it shows it in,
   * whether the plugin can ask for another, CSS pixels per editor pixel,
   * and its safe area (null: all of it). Tells subscribers of what changed:
   * the view's size first, as it is measured again, then the editor's.
   */
  setGeometry(geometry: {
    readonly editor: { readonly width: number; readonly height: number };
    readonly safeArea: LayoutRect | null;
    readonly resizable?: boolean;
    readonly fit?: number;
  }): void {
    const { editor, safeArea, resizable = false, fit = 1 } = geometry;
    this.#safeArea = safeArea === null ? null : { ...safeArea };
    this.#editorFit = fit > 0 ? fit : 1;
    this.measure();
    const known = this.#editorSize;
    if (
      editor.width === known.width &&
      editor.height === known.height &&
      resizable === known.resizable
    )
      return;
    this.#editorSize = Object.freeze({
      width: editor.width,
      height: editor.height,
      resizable,
    });
    this.#editorListeners.notify(this.#editorSize);
  }

  /** Where requestEditorSize() sends a checked, whole size: the host. */
  setEditorRequester(
    request:
      | ((size: { width: number; height: number }) => {
          width: number;
          height: number;
        } | null)
      | null,
  ): void {
    this.#requestEditorSize = request;
  }

  /**
   * Asks the host for another editor size, checked and rounded as the native
   * runtime does. Returns the size asked of the host (held to the editor's
   * limits), or null where the editor's size cannot be asked for.
   */
  requestEditorSize(
    width: unknown,
    height: unknown,
  ): { readonly width: number; readonly height: number } | null {
    const w = requestedSide(width, 'width');
    const h = requestedSide(height, 'height');
    if (!this.#editorSize.resizable || this.#requestEditorSize === null)
      return null;
    const asked = this.#requestEditorSize({ width: w, height: h });
    return asked === null
      ? null
      : Object.freeze({ width: asked.width, height: asked.height });
  }

  /**
   * Calls `listener` with the new size() whenever the view's size or scale
   * changes. Returns a function that unsubscribes.
   */
  subscribeSize(listener: (size: ViewSize) => void): () => void {
    return this.#sizeListeners.add(listener, 'subscribeViewSize()');
  }

  /**
   * Measures the view again and tells subscribers if it changed: the view
   * does on a resize or a new pixel density; the host calls it when it
   * scales the view, which no observer sees.
   */
  measure(): void {
    const size = this.size();
    if (size !== this.#layoutSize && !this.#disposed) {
      // Edges are on device pixels: at another scale, all of them move.
      this.core.setScale(size.scale > 0 ? size.scale : 1);
      this.core.setSize(size.width, size.height);
      this.#layoutSize = size;
      this.layoutChanged();
    }
    if (size === this.#notifiedSize) return;
    this.#notifiedSize = size;
    this.#sizeListeners.notify(size);
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  focusedNode(): UiNode | null {
    if (this.#focused !== null && !this.#focused.isConnected)
      this.#focused = null;
    return this.#focused;
  }

  focusVisible(): boolean {
    return this.focusedNode() !== null && this.#focusShown;
  }

  /**
   * Moves focus to `node` (or nowhere), firing blur then focus, and
   * focusvisiblechange to each whose focusVisible changes. A node that is
   * not focusable or not in the tree is ignored.
   */
  focus(node: UiNode | null, moveDomFocus = true): void {
    if (
      node !== null &&
      (!node.focusable || !node.isConnected || node.inputDisabled)
    )
      return;
    const previous = this.focusedNode();
    if (previous === node) return;
    const wasShown = previous !== null && this.#focusShown;
    this.#focused = node;
    // Text inputs show focus however they got it, as in browsers.
    this.#focusShown =
      node !== null && (this.#keyboardModality || node.type === 'input');
    const shown = this.#focusShown;
    if (moveDomFocus) {
      this.#movingFocus = true;
      try {
        // The view keeps the keyboard when no node has focus.
        (node === null ? this.rootElement : elementOf(node)).focus({
          preventScroll: true,
        });
      } finally {
        this.#movingFocus = false;
      }
    }
    if (previous !== null) {
      previous.dispatchEvent(
        new FocusEvent('blur', { composed: true, relatedTarget: node }),
      );
      if (wasShown && previous.isConnected)
        previous.dispatchEvent(
          new FocusEvent('focusvisiblechange', { composed: true }),
        );
      if (previous.type === 'input') this.#commit(previous);
    }
    if (node !== null && this.#focused === node && node.isConnected) {
      if (node.type === 'input' && !this.#committed.has(node))
        this.#committed.set(node, node.value);
      node.dispatchEvent(
        new FocusEvent('focus', {
          composed: true,
          relatedTarget: previous,
          focusVisible: shown,
        }),
      );
      if (
        shown &&
        this.#focused === node &&
        this.#focusShown &&
        node.isConnected
      )
        node.dispatchEvent(
          new FocusEvent('focusvisiblechange', {
            composed: true,
            focusVisible: true,
          }),
        );
    }
  }

  /** Shows the focused node's focus, from a key press on. */
  #showFocus(): void {
    const node = this.focusedNode();
    if (node === null || this.#focusShown) return;
    this.#focusShown = true;
    node.dispatchEvent(
      new FocusEvent('focusvisiblechange', {
        composed: true,
        focusVisible: true,
      }),
    );
  }

  #moveFocus(backwards: boolean): boolean {
    // Every focusable node, so that Tab from one that is not a Tab stop goes
    // on from where it is in the tree.
    const order: UiNode[] = [];
    const collect = (node: UiNode): void => {
      if (
        node.style.display === 'none' ||
        UiNode.semanticsOf(node).state.disabled
      )
        return;
      if (node.focusable) order.push(node);
      for (const child of node.children) collect(child);
    };
    collect(this.root);
    collect(this.overlay);
    const next = nextTabStop(order, this.focusedNode(), backwards);
    if (next === null) return false;
    this.focus(next);
    return true;
  }

  /** An input's `change`: its value differs from when it last reported. */
  #commit(input: UiNode): void {
    if (this.#committed.get(input) === input.value) return;
    this.#committed.set(input, input.value);
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  // ── Accessibility ──────────────────────────────────────────────────────────

  /** Brings the ARIA up to date once the current task's changes are done. */
  semanticsChanged(): void {
    // Focus and capture follow input eligibility immediately; ARIA can batch.
    if (this.focusedNode()?.inputDisabled) this.focus(null);
    for (const [id, state] of this.#pointers) {
      const { captured, last } = state;
      if (!captured?.inputDisabled || last === null) continue;
      state.captured = null;
      state.pressedElement = null;
      this.#endLock(id);
      captured.dispatchEvent(
        this.#pointerEvent('pointercancel', captured, last, true, false),
      );
    }
    if (this.#semanticsPending) return;
    this.#semanticsPending = true;
    queueMicrotask(() => this.updateSemantics());
  }

  /** Sets the view's ARIA to match its nodes now. */
  updateSemantics(): void {
    this.#semanticsPending = false;
    updateSemantics([this.root, this.overlay]);
    // The tree or a style changed, so the cursor may have too, and what is
    // under a pointer once the browser lays it out.
    this.#updateCursor();
    this.#hoverChanged();
  }

  // ── Pointer lock ─────────────────────────────────────────────────────────

  /**
   * Locks the mouse or pen pressing `node` (or a node in it) to `node`, as
   * the native runtime does: the browser locks the view's element, which gets
   * every move, and the view routes them to `node`.
   */
  requestPointerLock(node: UiNode): Promise<void> {
    const element = this.rootElement;
    const document = element.ownerDocument;
    const pressing = [...this.#pointers].find(
      ([, state]) =>
        state.captured !== null &&
        state.last?.pointerType !== 'touch' &&
        node.contains(state.captured),
    );
    if (pressing === undefined || !node.isConnected || node.inputDisabled) {
      return Promise.reject(
        new DOMException(
          'requestPointerLock(): no press of this node to lock',
          'NotAllowedError',
        ),
      );
    }
    const [pointerId, state] = pressing;
    state.captured = node;
    this.#lock = { node, pointerId };
    if (document.pointerLockElement === element) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const settle = (locked: boolean) => {
        document.removeEventListener('pointerlockchange', changed);
        document.removeEventListener('pointerlockerror', refused);
        if (locked) return resolve();
        if (this.#lock?.node === node) this.#lock = null;
        reject(
          new DOMException(
            'requestPointerLock(): the browser refused the lock',
            'NotAllowedError',
          ),
        );
      };
      const changed = () => settle(document.pointerLockElement === element);
      const refused = () => settle(false);
      document.addEventListener('pointerlockchange', changed);
      document.addEventListener('pointerlockerror', refused);
      try {
        // A promise in current browsers, nothing in older ones (the events
        // say how it went then).
        const result = element.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(refused);
      } catch {
        refused();
      }
    });
  }

  /** Ends the pointer lock, if any: the pointer shows again where it began. */
  /**
   * Has assistive technology speak `message` (soundor:ui's announce()): a
   * new entry of an ARIA live region, polite or assertive, which screen
   * readers read as it is added (so a repeated message is spoken again),
   * removed once read.
   */
  announce(message: string, options: { priority?: AnnouncePriority } = {}) {
    if (typeof message !== 'string')
      throw new TypeError(
        `message: expected a string, got ${describe(message)}`,
      );
    if (typeof options !== 'object' || options === null)
      throw new TypeError(
        `announce options must be an object, got ${describe(options)}`,
      );
    const priority = options.priority ?? 'polite';
    if (priority !== 'polite' && priority !== 'assertive')
      throw new TypeError(
        `announce: priority must be 'polite' or 'assertive', got ${describe(priority)}`,
      );
    if (message === '' || this.#disposed) return;
    const entry = this.rootElement.ownerDocument.createElement('div');
    entry.textContent = message;
    this.#liveRegions[priority].append(entry);
    const timer = setTimeout(() => {
      this.#announced.delete(timer);
      entry.remove();
    }, ANNOUNCEMENT_MS);
    this.#announced.add(timer);
  }

  exitPointerLock(): void {
    this.#endLock();
  }

  /** The node holding the pointer lock, if any. */
  pointerLockNode(): UiNode | null {
    const lock = this.#lock;
    if (lock === null) return null;
    if (
      !lock.node.isConnected ||
      this.#pointers.get(lock.pointerId)?.captured !== lock.node
    ) {
      this.#endLock();
      return null;
    }
    return lock.node;
  }

  /** Ends the lock (of `pointerId` only, when given). */
  #endLock(pointerId?: number): void {
    if (pointerId !== undefined && this.#lock?.pointerId !== pointerId) {
      // A lock its node let go of (removed) still ends with the press.
      if (this.#lock !== null) return;
    }
    this.#lock = null;
    const document = this.rootElement.ownerDocument;
    if (document.pointerLockElement === this.rootElement)
      document.exitPointerLock();
  }

  /** Refreshes hover in the next frame, once. */
  /**
   * Measures the view again when the page's pixel density changes (browser
   * zoom, a display of another density), which resizes nothing an observer
   * sees. A media query matches one density: a new one is made each time.
   */
  #watchDensity(): void {
    const window = this.rootElement.ownerDocument.defaultView;
    if (typeof window?.matchMedia !== 'function') return;
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    query.addEventListener(
      'change',
      () => {
        this.measure();
        this.#watchDensity();
      },
      { once: true, signal: this.#controller.signal },
    );
  }

  #hoverChanged(): void {
    const window = this.rootElement.ownerDocument.defaultView;
    if (this.#hoverFrame !== null || window === null) return;
    this.#hoverFrame = window.requestAnimationFrame(() => {
      this.#hoverFrame = null;
      this.refreshHover();
    });
  }

  /**
   * Hover follows what changed under pointers that did not move, as in
   * browsers and the native runtime: each mouse or pen in the view and not
   * pressed is hit-tested again where it is, and pointerleave/pointerenter
   * fire as for a move (no pointermove).
   */
  refreshHover(): void {
    for (const state of [...this.#pointers.values()]) {
      const last = state.last;
      if (last === null || !state.inside || state.captured !== null) continue;
      if (last.pointerType === 'touch') continue;
      const hit = this.#hitTest(last);
      const path = this.#pathTo(hit);
      const hovered = state.hovered.filter((node) => node.isConnected);
      if (
        path.length === hovered.length &&
        path.every((node, i) => node === hovered[i])
      )
        continue;
      this.#updateHover(state, last, hit);
    }
    this.#updateCursor();
  }

  /**
   * The cursor the mouse shows, as in the native runtime: the style's of the
   * node holding the pointer, or else of the deepest it hovers, or of their
   * nearest ancestor with one; a text input's 'text', and the arrow where
   * none has one.
   */
  cursor(): Exclude<Cursor, 'auto'> {
    const state = this.#pointers.get(this.#cursorPointer);
    let node: UiNode | null = null;
    if (state?.captured?.isConnected) node = state.captured;
    else node = state?.hovered.findLast((at) => at.isConnected) ?? null;
    for (; node !== null; node = node.parent) {
      const cursor = node.style.cursor ?? 'auto';
      if (cursor !== 'auto') return cursor;
      if (node.type === 'input') return 'text';
    }
    return 'default';
  }

  /** Shows cursor() over the view: every node's element inherits it. */
  #updateCursor(): void {
    const cursor = this.cursor();
    if (cursor === this.#cursor) return;
    this.#cursor = cursor;
    this.rootElement.style.cursor = cursor;
  }

  /**
   * A click no pointer made (detail 0): assistive technology activating an
   * element. It becomes the `activate` accessibility action of the nearest
   * element offering one, as natively. Pointer clicks are the view's own,
   * from its press and release, so a press is never delivered twice; and
   * what the browser does natively (focusing an input) stays the browser's.
   */
  #click(event: MouseEvent): void {
    event.stopPropagation();
    if (event.detail !== 0) {
      this.#browserClicked(event.detail);
      return;
    }
    // Assistive technology moves focus as the keyboard does: shown.
    this.#keyboardModality = true;
    for (
      let node = nodeOf(event.target as Element | null, this.rootElement);
      node !== null;
      node = node.parent
    ) {
      if (node.inputDisabled) {
        event.preventDefault();
        return;
      }
      const { actions } = UiNode.semanticsOf(node);
      if (!actions.some((action) => action.name === 'activate')) continue;
      const action = new AccessibilityActionEvent('accessibilityaction', {
        bubbles: true,
        cancelable: true,
        composed: true,
        actionName: 'activate',
      });
      if (!node.dispatchEvent(action)) event.preventDefault();
      return;
    }
  }

  /**
   * The browser's click for the release a click is waiting on: it is
   * dispatched now, with the browser's count.
   */
  #browserClicked(detail: number): void {
    const pending = this.#pendingClick;
    if (pending === null) return;
    this.#pendingClick = null;
    clearTimeout(pending.timer);
    this.#dispatchClick(pending.node, pending.release, detail);
    pending.after();
  }

  /** A click the browser does not count: one on its own. */
  #flushClick(): void {
    const pending = this.#pendingClick;
    if (pending === null) return;
    this.#pendingClick = null;
    clearTimeout(pending.timer);
    this.#dispatchClick(pending.node, pending.release, 1);
    pending.after();
  }

  /** A `click`, and for the second of a series a `dblclick`, as natively. */
  #dispatchClick(
    node: UiNode,
    release: globalThis.PointerEvent,
    detail: number,
  ): void {
    if (!node.isConnected || node.inputDisabled) return;
    node.dispatchEvent(
      this.#pointerEvent('click', node, release, true, true, null, detail),
    );
    if (detail === 2 && node.isConnected && !node.inputDisabled) {
      node.dispatchEvent(
        this.#pointerEvent('dblclick', node, release, true, true, null, detail),
      );
    }
  }

  // ── Clipboard ──────────────────────────────────────────────────────────────

  /** The system clipboard where the page may use it, else the page's own. */
  async readClipboard(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return this.#clipboard;
    }
  }

  async writeClipboard(text: string): Promise<void> {
    this.#clipboard = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Not allowed here (an iframe, an insecure page): the page keeps it.
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  #listen(): void {
    const element = this.rootElement;
    const options = { signal: this.#controller.signal };
    // After the UI handles a mouse's (or pen's) input, its cursor.
    const pointer =
      (handle: (event: globalThis.PointerEvent) => void) =>
      (event: globalThis.PointerEvent) => {
        // Known while the UI handles it (requestPointerLock() reads its type).
        const state = this.#state(event.pointerId);
        state.last = event;
        state.inside = event.type !== 'pointerleave';
        handle(event);
        if (event.pointerType !== 'touch')
          this.#cursorPointer = event.pointerId;
        this.#updateCursor();
      };
    element.addEventListener(
      'pointerdown',
      pointer((e) => this.#pointerDown(e)),
      options,
    );
    element.addEventListener(
      'pointermove',
      pointer((e) => this.#pointerMove(e)),
      options,
    );
    element.addEventListener(
      'pointerup',
      pointer((e) => this.#pointerUp(e)),
      options,
    );
    element.addEventListener(
      'pointercancel',
      pointer((e) => this.#pointerCancel(e)),
      options,
    );
    element.addEventListener(
      'pointerleave',
      pointer((e) => this.#pointerLeave(e)),
      options,
    );
    // A resized view lays out again under the pointer, and tells its size
    // subscribers (measured after layout, before the frame is painted).
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    if (Observer !== undefined) {
      this.#resizes = new Observer(() => {
        this.#hoverChanged();
        this.measure();
      });
      this.#resizes.observe(element);
    }
    this.#watchDensity();
    // A press the view did not capture (a text input's) can move and end
    // outside it; inside, the view's own listeners have it.
    const window = element.ownerDocument.defaultView;
    const outside =
      (handle: (event: globalThis.PointerEvent) => void) =>
      (event: globalThis.PointerEvent) => {
        if (element.contains(event.target as Node | null)) return;
        if (this.#pointers.get(event.pointerId)?.captured == null) return;
        handle(event);
      };
    for (const [type, handle] of [
      ['pointermove', (e: globalThis.PointerEvent) => this.#pointerMove(e)],
      ['pointerup', (e: globalThis.PointerEvent) => this.#pointerUp(e)],
      ['pointercancel', (e: globalThis.PointerEvent) => this.#pointerCancel(e)],
    ] as const) {
      window?.addEventListener(type, outside(pointer(handle)), options);
    }
    // Escape, or the page losing focus, ends the browser's lock.
    element.ownerDocument.addEventListener(
      'pointerlockchange',
      () => {
        if (element.ownerDocument.pointerLockElement !== element)
          this.#lock = null;
      },
      options,
    );
    // Scroll views scroll natively, moving their content under the pointer.
    element.addEventListener(
      'scroll',
      () => {
        this.gestures.clear();
        this.#hoverChanged();
      },
      {
        ...options,
        capture: true,
      },
    );
    // The browser's own press handling (focus, text selection) is the
    // view's, except placing the caret in a text input.
    element.addEventListener(
      'mousedown',
      (e) => {
        if (!this.#nativeDown) e.preventDefault();
      },
      options,
    );
    element.addEventListener('click', (e) => this.#click(e), options);
    // Soundor's own dblclick comes from the browser's click count.
    element.addEventListener('dblclick', (e) => e.stopPropagation(), options);
    element.addEventListener(
      'contextmenu',
      (e) => this.#contextMenu(e),
      options,
    );
    element.addEventListener('wheel', (e) => this.#wheel(e), {
      ...options,
      passive: false,
    });
    element.addEventListener('keydown', (e) => this.#key(e, true), options);
    element.addEventListener('keyup', (e) => this.#key(e, false), options);
    element.addEventListener(
      'beforeinput',
      (e) => this.#beforeInput(e),
      options,
    );
    element.addEventListener('input', (e) => this.#input(e), options);
    element.addEventListener('change', (e) => e.stopPropagation(), options);
    element.addEventListener('focusin', (e) => this.#focusIn(e), options);
    element.addEventListener('focusout', (e) => this.#focusOut(e), options);
  }

  #hitTest(event: MouseEvent): UiNode | null {
    const document = this.rootElement.ownerDocument;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit === null || !this.rootElement.contains(hit)) return null;
    return nodeOf(hit, this.rootElement);
  }

  #pathTo(node: UiNode | null): UiNode[] {
    const path: UiNode[] = [];
    for (let at = node; at !== null; at = at.parent) path.unshift(at);
    return path;
  }

  #pointerEvent(
    type: string,
    target: UiNode,
    event: MouseEvent,
    bubbles: boolean,
    cancelable: boolean,
    relatedTarget: UiNode | null = null,
    detail = 0,
  ): PointerEvent {
    const root = this.rootElement.getBoundingClientRect();
    const scale = this.scale();
    const x = (event.clientX - root.left) / scale;
    const y = (event.clientY - root.top) / scale;
    const local = UiNode.localPoint(target, x, y);
    const pointer = event as globalThis.PointerEvent;
    return new PointerEvent(type, {
      bubbles,
      cancelable,
      composed: true,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      clientX: x,
      clientY: y,
      offsetX: local.x,
      offsetY: local.y,
      // The screen in the editor's pixels: the page's CSS pixels over the
      // stage's fit (not the view's zoom, which a resize changes).
      screenX: (event.screenX ?? x) / this.#editorFit,
      screenY: (event.screenY ?? y) / this.#editorFit,
      // The browser's, in CSS pixels; synthetic events may have none.
      movementX: (event.movementX ?? 0) / scale,
      movementY: (event.movementY ?? 0) / scale,
      button: this.#button(event),
      buttons: this.#buttons(event),
      pointerId: pointer.pointerId ?? 1,
      pointerType: (pointer.pointerType ?? 'mouse') as 'mouse',
      pressure: pointer.pressure ?? (event.buttons !== 0 ? 0.5 : 0),
      isPrimary: true,
      relatedTarget,
      detail,
    });
  }

  /** Control-click's button is the secondary one, through its release. */
  #button(event: MouseEvent): number {
    const id = (event as globalThis.PointerEvent).pointerId ?? 1;
    return event.button === 0 && this.#pointers.get(id)?.controlClick === true
      ? 2
      : event.button;
  }

  #buttons(event: MouseEvent): number {
    const id = (event as globalThis.PointerEvent).pointerId ?? 1;
    return (event.buttons & 1) !== 0 &&
      this.#pointers.get(id)?.controlClick === true
      ? (event.buttons & ~1) | 2
      : event.buttons;
  }

  #state(pointerId: number): PointerState {
    let state = this.#pointers.get(pointerId);
    if (state === undefined) {
      state = {
        captured: null,
        suppressClick: false,
        controlClick: false,
        hovered: [],
        last: null,
        inside: false,
        pressedElement: null,
      };
      this.#pointers.set(pointerId, state);
    }
    if (state.captured !== null && !state.captured.isConnected)
      state.captured = null;
    return state;
  }

  #updateHover(state: PointerState, event: MouseEvent, target: UiNode | null) {
    const path = this.#pathTo(target);
    state.hovered = state.hovered.filter((node) => node.isConnected);
    let common = 0;
    while (
      common < path.length &&
      common < state.hovered.length &&
      path[common] === state.hovered[common]
    )
      ++common;
    const left = state.hovered.slice(common);
    state.hovered = path;
    // Leave from the innermost node out, enter from the outermost in.
    for (const node of [...left].reverse()) {
      node.dispatchEvent(
        this.#pointerEvent('pointerleave', node, event, false, false, target),
      );
    }
    for (let i = common; i < path.length; ++i) {
      const node = path[i]!;
      if (!node.isConnected) break;
      node.dispatchEvent(
        this.#pointerEvent(
          'pointerenter',
          node,
          event,
          false,
          false,
          left.at(-1) ?? null,
        ),
      );
    }
  }

  #pointerDown(event: globalThis.PointerEvent): void {
    this.#menu = this.#menuKey = null;
    this.gestures.cancel(event.pointerId);
    // A click still waiting goes first: its browser click never came.
    this.#flushClick();
    // Focus a press moves is not shown (focusVisible()).
    this.#keyboardModality = false;
    const state = this.#state(event.pointerId);
    if (state.captured === null) {
      state.pressedElement = event.target as Element | null;
      // On macOS, Control with the primary button is the secondary one.
      state.controlClick = event.button === 0 && event.ctrlKey && this.#mac();
    }
    const hit = this.#hitTest(event);
    if (state.captured === null) this.#updateHover(state, event, hit);
    const target = state.captured ?? hit;
    this.#nativeDown = false;
    if (target === null) return;
    // The secondary button asks for a context menu, as natively: after its
    // pointerdown, canceled or not. The browser's own contextmenu answers.
    const secondary = this.#button(event) === 2;
    if (target.inputDisabled) {
      event.preventDefault();
      if (secondary) this.#menu = { canceled: true };
      return;
    }
    // Implicit capture until the last button is up, from before the
    // listeners run, so they can lock it (a node they remove lets go).
    if (state.captured === null) {
      state.captured = target;
      state.suppressClick = false;
    }
    const press = this.#pointerEvent('pointerdown', target, event, true, true);
    const allowed = target.dispatchEvent(press);
    if (state.captured?.isConnected !== true) state.captured = null;
    if (!allowed || target.inputDisabled) {
      event.preventDefault();
      if (state.captured !== null) this.#capture(event.pointerId);
      if (secondary) this.#requestPointerMenu(target, event);
      return;
    }
    // Focus goes to the nearest focusable node, or nowhere.
    let focusTarget: UiNode | null = null;
    for (let at: UiNode | null = target; at !== null; at = at.parent) {
      if (at.focusable) {
        focusTarget = at;
        break;
      }
    }
    // A text input keeps the browser's press, which places the caret.
    this.#nativeDown =
      focusTarget !== null && focusTarget === target && target.type === 'input';
    // The browser's own press (selecting text) needs the moves itself:
    // Firefox sends them to the element holding the pointer. Soundor still
    // routes them to the pressed node, and a release outside the view
    // arrives through the window.
    if (!this.#nativeDown) this.#capture(event.pointerId);
    this.focus(focusTarget?.isConnected ? focusTarget : null);
    if (secondary) this.#requestPointerMenu(target, event);
    if (!canHold(target, press.button, press.buttons, event.pointerType))
      return;
    this.gestures.start(
      event.pointerId,
      target,
      press.pageX,
      press.pageY,
      () => {
        if (state.captured !== target || this.pointerLockNode() !== null)
          return;
        const consumed = longPressed(
          event.pointerType,
          (type) => target.dispatchEvent(new PointerEvent(type, press)),
          () => target.isConnected && !target.inputDisabled,
        );
        if (consumed) state.suppressClick = true;
        // A touch hold's menu request, which the browser's (Android's) answers.
        if (event.pointerType === 'touch') this.#menu = { canceled: consumed };
      },
    );
  }

  /** A secondary press's request, at the pressed node and the pointer. */
  #requestPointerMenu(target: UiNode, event: globalThis.PointerEvent): void {
    const canceled =
      !target.isConnected ||
      target.inputDisabled ||
      !target.dispatchEvent(
        this.#pointerEvent('contextmenu', target, event, true, true),
      );
    this.#menu = { canceled };
  }

  #mac(): boolean {
    const navigator = this.rootElement.ownerDocument.defaultView?.navigator;
    return /^Mac/.test(navigator?.platform ?? '');
  }

  /** Keeps the pointer's input on the view until it is released. */
  #capture(pointerId: number): void {
    try {
      this.rootElement.setPointerCapture(pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured.
    }
  }

  #pointerMove(event: globalThis.PointerEvent): void {
    const scale = this.scale();
    const root = this.rootElement.getBoundingClientRect();
    this.gestures.move(
      event.pointerId,
      (event.clientX - root.left) / scale,
      (event.clientY - root.top) / scale,
      event.buttons,
    );
    const state = this.#state(event.pointerId);
    const hit = this.#hitTest(event);
    const target = state.captured ?? hit;
    if (state.captured === null) this.#updateHover(state, event, hit);
    if (target === null) return;
    const allowed = target.dispatchEvent(
      this.#pointerEvent('pointermove', target, event, true, true),
    );
    if (!allowed) event.preventDefault();
  }

  #pointerUp(event: globalThis.PointerEvent): void {
    this.gestures.cancel(event.pointerId);
    const state = this.#state(event.pointerId);
    const pressed = state.captured;
    const hit = this.#hitTest(event);
    const target = pressed ?? hit;
    if (target !== null && !target.inputDisabled) {
      target.dispatchEvent(
        this.#pointerEvent('pointerup', target, event, true, true),
      );
    }
    if (event.buttons !== 0) return;
    const stillPressed = state.captured === pressed;
    state.captured = null;
    this.#endLock(event.pointerId);
    try {
      this.rootElement.releasePointerCapture(event.pointerId);
    } catch {
      // Not captured.
    }
    // A click goes to the deepest node holding both press and release.
    const released = this.#hitTest(event);
    let common: UiNode | null = null;
    if (
      this.#button(event) === 0 &&
      !state.suppressClick &&
      stillPressed &&
      pressed?.isConnected &&
      !pressed.inputDisabled &&
      released !== null &&
      !released.inputDisabled
    ) {
      const from = this.#pathTo(pressed);
      const to = this.#pathTo(released);
      for (
        let i = 0;
        i < from.length && i < to.length && from[i] === to[i];
        ++i
      )
        common = from[i]!;
    }
    const hover = () => this.#updateHover(state, event, this.#hitTest(event));
    const waits =
      common !== null && this.#releaseClick(state, common, event, hover);
    state.pressedElement = null;
    if (!waits) hover();
  }

  /**
   * The click a release makes. A real release (trusted) of an element still
   * in the document is followed at once by the browser's own click, which
   * says its count: it waits for that, or for the end of the task, should
   * the browser not send it, and so does `after`. Any other is a click on
   * its own. Returns whether it waits.
   */
  #releaseClick(
    state: PointerState,
    node: UiNode,
    release: globalThis.PointerEvent,
    after: () => void,
  ): boolean {
    if (!release.isTrusted || state.pressedElement?.isConnected !== true) {
      this.#dispatchClick(node, release, 1);
      return false;
    }
    this.#flushClick();
    this.#pendingClick = {
      node,
      release,
      timer: setTimeout(() => this.#flushClick(), 0),
      after,
    };
    return true;
  }

  /**
   * The browser's `contextmenu`. Every input the view sees makes its own
   * request (a secondary press, a menu key, a touch hold), so the browser's
   * only answers it: canceled, the browser's menu stays away. One that comes
   * from a pointer or a key the view made no request for (outside its nodes,
   * a touch held in a text input) is the browser's own. One that comes from
   * neither is assistive technology's (#requestMenu).
   */
  #contextMenu(event: MouseEvent): void {
    event.stopPropagation();
    const pointer = event as globalThis.PointerEvent;
    // A browser can recognize a touch hold before the view's timer.
    if (pointer.pointerId !== undefined)
      this.gestures.nativeHold(pointer.pointerId);
    // While a menu key is held, anything the browser sends is the key's.
    const menu = this.#menu ?? this.#menuKey;
    if (menu !== null) {
      if (this.#menuKey === null) this.#menu = null;
      if (menu.canceled) event.preventDefault();
      return;
    }
    // A hold with a delay of its own goes on: no browser menu meanwhile.
    if (
      pointer.pointerId !== undefined &&
      this.gestures.pending(pointer.pointerId)
    ) {
      event.preventDefault();
      return;
    }
    const pressed = [...this.#pointers.values()].some(
      (state) => state.captured !== null,
    );
    if (pointer.pointerType || pressed) return;
    const target =
      nodeOf(event.target as Element | null, this.rootElement) ??
      this.focusedNode();
    if (
      target !== null &&
      !target.inputDisabled &&
      !this.#requestMenu(target, event)
    )
      event.preventDefault();
  }

  /**
   * A request the browser made without a pointer or a key the view saw:
   * assistive technology's, as ARIA has no action for it. It is the
   * `showContextMenu` action of the nearest element offering one, whose
   * default is the `contextmenu` event (as natively); without one, an
   * ordinary request to `target`. Returns false when it was canceled.
   */
  #requestMenu(target: UiNode, event: MouseEvent): boolean {
    for (let node: UiNode | null = target; node !== null; node = node.parent) {
      if (node.inputDisabled) return false;
      const { actions } = UiNode.semanticsOf(node);
      if (!actions.some((action) => action.name === 'showContextMenu'))
        continue;
      this.#keyboardModality = true;
      const action = new AccessibilityActionEvent('accessibilityaction', {
        bubbles: true,
        cancelable: true,
        composed: true,
        actionName: 'showContextMenu',
      });
      if (!node.dispatchEvent(action)) return false;
      if (!node.isConnected || node.inputDisabled) return true;
      return node.dispatchEvent(this.#anchoredContextMenu(node, event));
    }
    return target.dispatchEvent(this.#anchoredContextMenu(target, event));
  }

  #anchoredContextMenu(
    target: UiNode,
    event: MouseEvent | globalThis.KeyboardEvent,
  ) {
    const box = target.getBoundingClientRect();
    const x = box.x;
    const y = box.y + box.height;
    const local = UiNode.localPoint(target, x, y);
    return new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      offsetX: local.x,
      offsetY: local.y,
      pointerId: -1,
      button: -1,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  }

  #pointerCancel(event: globalThis.PointerEvent): void {
    this.gestures.cancel(event.pointerId);
    const state = this.#state(event.pointerId);
    const target = state.captured;
    state.captured = null;
    this.#endLock(event.pointerId);
    if (target !== null) {
      target.dispatchEvent(
        this.#pointerEvent('pointercancel', target, event, true, false),
      );
    }
    this.#updateHover(state, event, null);
    this.#pointers.delete(event.pointerId);
  }

  #pointerLeave(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    if (state.captured === null) this.#updateHover(state, event, null);
  }

  #wheel(event: globalThis.WheelEvent): void {
    const target = this.#hitTest(event);
    if (target === null) return;
    if (target.inputDisabled) {
      event.preventDefault();
      return;
    }
    const base = this.#pointerEvent('wheel', target, event, true, true);
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      clientX: base.clientX,
      clientY: base.clientY,
      offsetX: base.offsetX,
      offsetY: base.offsetY,
      buttons: event.buttons,
      pointerType: 'mouse',
      isPrimary: true,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode as 0 | 1 | 2,
    });
    if (!target.dispatchEvent(wheel)) {
      event.preventDefault();
      return;
    }
    // With Control it is a zoom, the browser's (a trackpad's pinch arrives
    // as one): never a scroll, and left to the browser unless plugin code
    // took it above.
    if (event.ctrlKey) return;
    // The default action: scroll the nearest scroll view that can.
    const unit =
      event.deltaMode === 1
        ? PIXELS_PER_LINE
        : event.deltaMode === 2
          ? this.rootElement.offsetHeight
          : 1;
    let deltaX = event.deltaX * unit;
    let deltaY = event.deltaY * unit;
    if (event.shiftKey && deltaX === 0) [deltaX, deltaY] = [deltaY, deltaX];
    if (target.inputDisabled || this.#scrollBy(target, deltaX, deltaY))
      event.preventDefault();
  }

  #scrollBy(target: UiNode, deltaX: number, deltaY: number): boolean {
    for (let node: UiNode | null = target; node !== null; node = node.parent) {
      if (!UiNode.scrolls(node) || node.style.display === 'none') continue;
      const before = { x: node.scrollLeft, y: node.scrollTop };
      node.scrollTo(before.x + deltaX, before.y + deltaY);
      if (node.scrollLeft === before.x && node.scrollTop === before.y) continue;
      // Told at once, and not again by the browser's own event.
      UiNode.scrolled(node);
      return true;
    }
    return false;
  }

  #key(event: globalThis.KeyboardEvent, down: boolean): void {
    if (event.isComposing) return;
    if (this.#menuKey !== null && event.key === this.#menuKey.key) {
      // Its repeats answer as its press did; its release ends that, while
      // the request waits on the browser's menu (Windows' comes on release).
      if (this.#menuKey.canceled) event.preventDefault();
      if (!down) this.#menuKey = null;
      if (event.repeat || !down) return;
    } else if (down) this.#menu = this.#menuKey = null;
    const shortcut = event.ctrlKey || event.altKey || event.metaKey;
    // Using the keyboard shows focus, as browsers do: not a shortcut, nor a
    // modifier pressed on its own.
    if (down && !shortcut && !MODIFIER_KEYS.has(event.key)) {
      this.#keyboardModality = true;
      this.#showFocus();
    }
    const focused = this.focusedNode();
    const target = focused ?? this.root;
    const menuKey =
      !shortcut &&
      (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey));
    const allowed =
      target.inputDisabled ||
      target.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        }),
      );
    // The menu keys ask the focused node for a menu: keydown's default.
    // With nothing focused there is no request, but the browser's menu for
    // this key is still the key's, not assistive technology's.
    if (down && menuKey) {
      let canceled = !allowed;
      if (allowed && focused?.isConnected && !focused.inputDisabled)
        canceled = !focused.dispatchEvent(
          this.#anchoredContextMenu(focused, event),
        );
      // Canceled, the key is too, and with it the browser's menu: nothing
      // is left to answer. Otherwise the browser's menu answers it.
      this.#menu = canceled ? null : { canceled };
      this.#menuKey = { key: event.key, canceled };
      if (canceled) event.preventDefault();
      return;
    }
    if (!allowed) {
      event.preventDefault();
      return;
    }
    if (!down) return;
    if (event.key === 'Tab' && !shortcut) {
      event.preventDefault();
      this.#moveFocus(event.shiftKey);
    } else if (
      event.key === 'Enter' &&
      target.type === 'input' &&
      !target.inputDisabled
    ) {
      this.#commit(target);
    }
  }

  #beforeInput(event: globalThis.InputEvent): void {
    const node = nodeOf(event.target as Element, this.rootElement);
    if (node?.inputDisabled) {
      event.preventDefault();
      return;
    }
    // Text arriving at an input; deletions and the like are its own edits.
    if (node?.type !== 'input' || !event.inputType.startsWith('insert')) return;
    if (event.data === null || event.data === '') return;
    const allowed = node.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: event.data,
        inputType: 'insertText',
      }),
    );
    if (!allowed) event.preventDefault();
  }

  #input(event: Event): void {
    event.stopPropagation();
    const node = nodeOf(event.target as Element, this.rootElement);
    if (node?.type !== 'input' || node.inputDisabled) return;
    const native = event as globalThis.InputEvent;
    node.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: native.data ?? null,
        inputType: native.inputType ?? 'insertText',
      }),
    );
  }

  /** Focus the browser moved itself (it should not, but stay in step). */
  #focusIn(event: globalThis.FocusEvent): void {
    if (this.#movingFocus) return;
    const node = nodeOf(event.target as Element, this.rootElement);
    if (node?.inputDisabled) {
      const previous = this.focusedNode();
      this.#movingFocus = true;
      try {
        (previous === null ? this.rootElement : elementOf(previous)).focus({
          preventScroll: true,
        });
      } finally {
        this.#movingFocus = false;
      }
      return;
    }
    if (node !== null && node.focusable && node !== this.focusedNode()) {
      // Not a press (the view moves that focus itself): assistive
      // technology, or the browser's keyboard. Shown.
      this.#keyboardModality = true;
      this.focus(node, false);
    }
  }

  /** Focus leaving the plugin (to the host page) blurs the focused node. */
  #focusOut(event: globalThis.FocusEvent): void {
    if (this.#movingFocus) return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && this.rootElement.contains(next)) return;
    this.gestures.clear();
    this.#menu = this.#menuKey = null;
    this.focus(null, false);
  }
}

/**
 * One side of a size requestEditorSize() is asked for, checked and whole:
 * any finite number, held to what the native runtime converts (1 to
 * 0x3FFFFFFF), then to the editor's limits by the host.
 */
function requestedSide(value: unknown, name: string): number {
  if (typeof value !== 'number')
    throw new TypeError(
      `requestEditorSize(): ${name} must be a number, got ${describe(value)}`,
    );
  if (!Number.isFinite(value))
    throw new RangeError(
      `requestEditorSize(): ${name} must be a finite number, got ${value}`,
    );
  return Math.min(Math.max(Math.round(value), 1), 0x3fffffff);
}

/** What a value is, as the native runtime's errors say it. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (
      (value as { constructor?: { name?: string } }).constructor?.name ??
      'object'
    );
  return typeof value;
}

/**
 * The Tab stop after (or before) `current` in `order`, every focusable node
 * in tree order, wrapping; from either end when `current` is not in it.
 * Null when none is a Tab stop. As natively (`Surface::moveFocus`).
 */
function nextTabStop(
  order: readonly UiNode[],
  current: UiNode | null,
  backwards: boolean,
): UiNode | null {
  const size = order.length;
  const at = current === null ? -1 : order.indexOf(current);
  let index = at < 0 ? (backwards ? 0 : size - 1) : at;
  for (let step = 0; step < size; step++) {
    index = (index + (backwards ? size - 1 : 1)) % size;
    if (order[index]!.tabStop) return order[index]!;
  }
  return null;
}
