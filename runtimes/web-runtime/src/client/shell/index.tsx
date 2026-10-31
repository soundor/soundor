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
import { ResizeHandle, type Size } from './resize';
import { STYLE } from './style';

export type Presentation = 'demo' | 'dev' | 'embed';

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
  remove(): void;
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
  render(<Shell {...options} />, element);
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

function Shell(options: ShellOptions) {
  if (options.presentation === 'embed') {
    return <Stage editor={options.editor} fill />;
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
      <Stage editor={options.editor} onScale={options.onScale}>
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
 * its corner that changes its size, the size its UI is laid out at, within
 * the editor's limits and the room the stage has. Filling (`embed`), the
 * plugin view is the stage's size instead, whatever it is.
 */
function Stage({
  editor,
  fill = false,
  onScale,
  children,
}: {
  readonly editor: WebEditor;
  readonly fill?: boolean;
  readonly onScale?: (() => void) | undefined;
  readonly children?: ComponentChildren;
}) {
  const stage = useRef<HTMLElement>(null);
  // The view's logical size: the editor's, until the user resizes it.
  const [size, setSize] = useState<Size>(() => ({
    width: editor.width,
    height: editor.height,
  }));
  // The stage's room for it in CSS pixels, once measured.
  const [room, setRoom] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = stage.current;
    if (fill || element === null || typeof ResizeObserver === 'undefined') {
      return;
    }
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
  }, [fill]);

  const scale =
    fill || room === null
      ? 1
      : Math.min(1, room.width / size.width, room.height / size.height);
  useLayoutEffect(() => onScale?.(), [onScale, scale]);

  if (fill) {
    return (
      <main ref={stage} class="soundor-stage soundor-fill">
        <div class="soundor-viewport" />
      </main>
    );
  }
  return (
    <main ref={stage} class="soundor-stage">
      <div
        class="soundor-frame"
        style={{
          width: `${size.width * scale}px`,
          height: `${size.height * scale}px`,
        }}
      >
        <div
          class="soundor-viewport"
          style={{
            width: `${size.width}px`,
            height: `${size.height}px`,
            transform: scale === 1 ? '' : `scale(${scale})`,
          }}
        />
        {editor.resizable ? (
          <ResizeHandle
            editor={editor}
            size={size}
            scale={scale}
            room={room}
            onResize={setSize}
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
