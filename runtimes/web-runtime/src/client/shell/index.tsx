/**
 * The host page around the plugin, in Preact. The plugin is the page: its
 * viewport is centred on the stage at the config's editor size (scaled down
 * when the stage is smaller, as in a docs iframe; a resizable one has a
 * handle at its corner), and the host stays out of its way:
 *
 * - a dock floating under the plugin: mute and volume, play/stop and the
 *   position, and the button that opens the panel (audio starts with the
 *   page's first gesture, wherever it is);
 * - a side panel, closed by default: the transport's tempo, loop and time
 *   signature, the audio source and format, and the parameters.
 *
 * The plugin UI renders inside the viewport only, which Preact never
 * renders children into. The shell controls the page's one WebHost and
 * WebAudioHost; there is no second transport here.
 *
 * Three presentations: `demo` (for static builds and docs), `dev` (what
 * `soundor dev` shows: the panel also inspects the host state, and remembers
 * whether it was open) and `embed` (a static build opened with `?embed`, as
 * a docs page's snippet: the plugin view fills the page, with no dock or
 * panel).
 */

import { render, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { WebAudioHost } from '../audio';
import type { WebHost } from '../host';
import type { WebEditor } from '../manifest';
import type { ParameterStore } from '../parameters';
import { Dock } from './dock';
import { startAudioOnGesture } from './gesture';
import { Panel } from './panel';
import {
  canResize,
  constrainSize,
  ResizeHandle,
  type Size,
  viewLayout,
} from './resize';
import { STYLE } from './style';

export type Presentation = 'demo' | 'dev' | 'embed';

/** What the shell says of the plugin view it shows. */
export interface ViewGeometry {
  /** The plugin viewport's size in the editor's logical pixels, whole. */
  readonly editor: Size;
  /**
   * The part of the view always shown, in its logical pixels; null for all
   * of it (anything but a view that scales with fit 'cover').
   */
  readonly safeArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /**
   * Whether the plugin can ask for another editor size (requestEditorSize):
   * a resizable editor whose limits allow one, unless the page owns its
   * size (`embed`).
   */
  readonly resizable: boolean;
  /**
   * CSS pixels per editor pixel: below 1 where the stage scales the editor
   * down to fit, 1 otherwise.
   */
  readonly fit: number;
}

/** The URL parameter that opens a static build in the `embed` presentation. */
export const EMBED_PARAM = 'embed';

export interface ShellOptions {
  readonly pluginName: string;
  readonly presentation: Presentation;
  /**
   * The plugin view's size and resize limits: the manifest's `editor`, as
   * the JUCE editor opens. Ignored by `embed`, which fills the page.
   */
  readonly editor: WebEditor;
  /**
   * Called when the shell scales the plugin viewport (to fit the stage),
   * which no ResizeObserver sees: the view measures itself again.
   */
  readonly onScale?: () => void;
  /**
   * Called with the editor's size (the plugin viewport's, in its logical
   * pixels) and the view's safe area whenever either changes, before the
   * page is painted.
   */
  readonly onGeometry?: (geometry: ViewGeometry) => void;
  readonly host: WebHost;
  readonly parameters: ParameterStore;
  readonly audio: WebAudioHost;
}

export interface HostShell {
  readonly element: HTMLElement;
  /** Where the plugin UI renders. */
  readonly viewport: HTMLElement;
  /** Shows a notice over the viewport (no UI, a UI that failed). */
  showMessage(title: string, detail?: string): void;
  /** Removes the notices showMessage() showed. */
  clearMessages(): void;
  /**
   * Resizes the plugin viewport as its handle would, to `size` (in the
   * editor's logical pixels) held to the editor's limits and the stage's
   * room: what the plugin's requestEditorSize() asks. Returns that size,
   * or null where the plugin cannot ask (ViewGeometry's `resizable`). The
   * viewport is resized with the next render.
   */
  requestEditorSize(size: Size): Size | null;
  remove(): void;
}

/** Where the stage takes the plugin's size requests, while it can. */
interface EditorRequests {
  current: ((size: Size) => Size) | null;
}

/** Where `dev` remembers whether the panel was open. */
const PANEL_KEY = 'soundor:web-host:panel';
const PANEL_ID = 'soundor-panel';
const PANEL_TOGGLE_ID = 'soundor-panel-toggle';

/** Renders the host page into `container` and connects its controls. */
export function createShell(
  container: HTMLElement,
  options: ShellOptions,
): HostShell {
  const document = container.ownerDocument;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const element = document.createElement('div');
  element.className = 'soundor-host';
  element.dataset['presentation'] = options.presentation;
  container.append(element);
  const requests: EditorRequests = { current: null };
  render(<Shell {...options} requests={requests} />, element);
  const viewport = element.querySelector<HTMLElement>('.soundor-viewport')!;
  const stopListening = startAudioOnGesture(document, options.audio);

  return {
    element,
    viewport,
    showMessage(title, detail) {
      const message = document.createElement('div');
      message.className = 'soundor-message';
      render(
        <>
          <strong>{title}</strong>
          {detail === undefined ? null : <pre>{detail}</pre>}
        </>,
        message,
      );
      viewport.append(message);
    },
    requestEditorSize(size) {
      return requests.current === null ? null : requests.current(size);
    },
    clearMessages() {
      for (const message of viewport.querySelectorAll(
        ':scope > .soundor-message',
      )) {
        render(null, message);
        message.remove();
      }
    },
    remove() {
      stopListening();
      render(null, element);
      element.remove();
      style.remove();
    },
  };
}

function Shell(options: ShellOptions & { readonly requests: EditorRequests }) {
  if (options.presentation === 'embed') {
    return (
      <Stage
        editor={options.editor}
        requests={options.requests}
        onScale={options.onScale}
        onGeometry={options.onGeometry}
        fill
      />
    );
  }
  const remember = options.presentation === 'dev';
  const [panelOpen, setPanelOpen] = useState(
    () => remember && readPanel() === 'open',
  );
  useEffect(() => {
    if (remember) writePanel(panelOpen ? 'open' : 'closed');
  }, [remember, panelOpen]);
  return (
    <>
      <Stage
        editor={options.editor}
        requests={options.requests}
        onScale={options.onScale}
        onGeometry={options.onGeometry}
      >
        <Dock
          host={options.host}
          audio={options.audio}
          panelId={PANEL_ID}
          toggleId={PANEL_TOGGLE_ID}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
        />
      </Stage>
      <Panel
        id={PANEL_ID}
        open={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          document.getElementById(PANEL_TOGGLE_ID)?.focus();
        }}
        pluginName={options.pluginName}
        host={options.host}
        audio={options.audio}
        parameters={options.parameters}
        inspect={options.presentation === 'dev'}
      />
    </>
  );
}

/**
 * The plugin, centred at its size, or scaled down to fit a smaller stage
 * (an iframe in docs, the panel open). A resizable plugin has a handle at
 * its corner that changes its size within the editor's limits and the room
 * the stage has: the size its UI is laid out at, or with an editor that
 * scales, the size its layout (the editor's size) is drawn at, keeping its
 * aspect ratio unless told not to. Filling (`embed`), the plugin view is the
 * stage's size instead, whatever it is: the page owns the editor's size.
 */
function Stage({
  editor,
  requests,
  fill = false,
  onScale,
  onGeometry,
  children,
}: {
  readonly editor: WebEditor;
  readonly requests: EditorRequests;
  readonly fill?: boolean;
  readonly onScale?: (() => void) | undefined;
  readonly onGeometry?: ((geometry: ViewGeometry) => void) | undefined;
  readonly children?: ComponentChildren;
}) {
  const stage = useRef<HTMLElement>(null);
  // The view's size: the editor's, until the user resizes it. Its logical
  // size, or with an editor that scales, the size its layout is drawn at.
  const [size, setSize] = useState<Size>(() => ({
    width: editor.width,
    height: editor.height,
  }));
  // The stage's room for it in CSS pixels, once measured.
  const [room, setRoom] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const styles = getComputedStyle(element);
      const width =
        element.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const height =
        element.clientHeight -
        parseFloat(styles.paddingTop) -
        parseFloat(styles.paddingBottom);
      setRoom(width > 0 && height > 0 ? { width, height } : null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The editor: the size the handle sets, or filling, the page's (which
  // owns it, beyond the editor's maximum too). Not measured yet, filling:
  // shown at its configured size, nothing known.
  const shown: Size | null = fill ? room : size;
  const { zoom, layout, safeArea } = viewLayout(
    editor,
    shown ?? { width: editor.width, height: editor.height },
  );
  const fit =
    fill || room === null
      ? 1
      : Math.min(1, room.width / size.width, room.height / size.height);
  const scale = fit * zoom;
  useLayoutEffect(() => onScale?.(), [onScale, scale]);

  // The plugin's requests resize the viewport as the handle does: the same
  // size state, limits and room. Filling, the page owns the size.
  const resizable = !fill && canResize(editor);
  const roomRef = useRef(room);
  // The size, or the one a request asked for since the last render: the
  // answer is known at once, so requestEditorSize() returns it.
  const sizeRef = useRef(size);
  useLayoutEffect(() => {
    roomRef.current = room;
    sizeRef.current = size;
  });
  useLayoutEffect(() => {
    if (!resizable) return;
    // The parent supplies this mutable request slot for the host bridge.
    // oxlint-disable-next-line react/immutability
    requests.current = (wanted) => {
      const next = constrainSize(
        editor,
        wanted,
        roomRef.current,
        sizeRef.current,
      );
      sizeRef.current = next;
      setSize((current) =>
        next.width === current.width && next.height === current.height
          ? current
          : next,
      );
      return next;
    };
    return () => {
      requests.current = null;
    };
  }, [requests, editor, resizable]);

  const editorWidth = shown === null ? 0 : Math.round(shown.width);
  const editorHeight = shown === null ? 0 : Math.round(shown.height);
  const safeX = safeArea?.x ?? null;
  const safeY = safeArea?.y ?? null;
  const safeWidth = safeArea?.width ?? null;
  const safeHeight = safeArea?.height ?? null;
  useLayoutEffect(() => {
    onGeometry?.({
      editor: { width: editorWidth, height: editorHeight },
      safeArea:
        safeX === null ||
        safeY === null ||
        safeWidth === null ||
        safeHeight === null
          ? null
          : { x: safeX, y: safeY, width: safeWidth, height: safeHeight },
      resizable,
      fit,
    });
  }, [
    onGeometry,
    resizable,
    fit,
    editorWidth,
    editorHeight,
    safeX,
    safeY,
    safeWidth,
    safeHeight,
  ]);

  // A fixed editor filling the page is laid out at the page's size.
  if (fill && !editor.resizable) {
    return (
      <main ref={stage} class="soundor-stage soundor-fill">
        <div class="soundor-viewport" />
      </main>
    );
  }
  // The editor in CSS pixels, and its layout in the middle of it: bands
  // around it where the layout does not fill it (fit 'contain', in a shape
  // or a size it was not made for).
  const frame: Size = fill
    ? (room ?? { width: layout.width * scale, height: layout.height * scale })
    : { width: size.width * fit, height: size.height * fit };
  const bandX = (frame.width - layout.width * scale) / 2;
  const bandY = (frame.height - layout.height * scale) / 2;
  const letterboxed = Math.abs(bandX) >= 0.5 || Math.abs(bandY) >= 0.5;
  return (
    <main
      ref={stage}
      class={fill ? 'soundor-stage soundor-fill' : 'soundor-stage'}
    >
      <div
        class={
          letterboxed ? 'soundor-frame soundor-letterbox' : 'soundor-frame'
        }
        style={{ width: `${frame.width}px`, height: `${frame.height}px` }}
      >
        <div
          class="soundor-viewport"
          style={{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            left: letterboxed ? `${bandX}px` : '',
            top: letterboxed ? `${bandY}px` : '',
            transform: scale === 1 ? '' : `scale(${scale})`,
          }}
        />
        {resizable ? (
          <ResizeHandle
            editor={editor}
            size={size}
            scale={fit}
            room={room}
            onResize={(next) =>
              setSize((current) =>
                current.width === next.width && current.height === next.height
                  ? current
                  : next,
              )
            }
          />
        ) : null}
      </div>
      {children}
    </main>
  );
}

function readPanel(): string | null {
  try {
    return localStorage.getItem(PANEL_KEY);
  } catch {
    // Storage may be unavailable; the panel starts closed.
    return null;
  }
}

function writePanel(state: 'open' | 'closed'): void {
  try {
    localStorage.setItem(PANEL_KEY, state);
  } catch {
    // Storage may be unavailable; nothing is remembered.
  }
}
