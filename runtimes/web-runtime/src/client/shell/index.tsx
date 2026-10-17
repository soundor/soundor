/**
 * The host page around the plugin, in Preact. The plugin is the page: its
 * viewport fills the stage (scaled down when the stage is smaller, as in a
 * docs iframe), and the host stays out of its way:
 *
 * - a dock floating under the plugin: audio on/off and volume, play/stop and
 *   the position, and the button that opens the panel;
 * - a side panel, closed by default: the transport's tempo, loop and time
 *   signature, the audio source and format, and the parameters.
 *
 * The plugin UI renders inside the viewport only, which Preact never
 * renders children into. The shell controls the page's one WebHost and
 * WebAudioHost; there is no second transport here.
 *
 * Two presentations: `demo` (for static builds and docs) and `dev` (what
 * `soundor dev` shows: the panel also inspects the host state, and remembers
 * whether it was open).
 */

import { render, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { WebAudioHost } from '../audio';
import type { WebHost } from '../host';
import type { ParameterStore } from '../parameters';
import { Dock } from './dock';
import { Panel } from './panel';
import { STYLE } from './style';

/** The plugin view's size in logical pixels, as the JUCE editor opens it. */
export const VIEW_SIZE = { width: 800, height: 600 } as const;

export type Presentation = 'demo' | 'dev';

export interface ShellOptions {
  readonly pluginName: string;
  readonly presentation: Presentation;
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
      render(null, element);
      element.remove();
      style.remove();
    },
  };
}

function Shell(options: ShellOptions) {
  const remember = options.presentation === 'dev';
  const [panelOpen, setPanelOpen] = useState(
    () => remember && readPanel() === 'open',
  );
  useEffect(() => {
    if (remember) writePanel(panelOpen ? 'open' : 'closed');
  }, [remember, panelOpen]);
  return (
    <>
      <Stage>
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
 * (an iframe in docs, the panel open).
 */
function Stage({ children }: { readonly children: ComponentChildren }) {
  const stage = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const fit = (): void => {
      const styles = getComputedStyle(element);
      const width =
        element.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const height =
        element.clientHeight -
        parseFloat(styles.paddingTop) -
        parseFloat(styles.paddingBottom);
      setScale(
        width > 0 && height > 0
          ? Math.min(1, width / VIEW_SIZE.width, height / VIEW_SIZE.height)
          : 1,
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <main ref={stage} class="soundor-stage">
      <div
        class="soundor-frame"
        style={{
          width: `${VIEW_SIZE.width * scale}px`,
          height: `${VIEW_SIZE.height * scale}px`,
        }}
      >
        <div
          class="soundor-viewport"
          style={{
            width: `${VIEW_SIZE.width}px`,
            height: `${VIEW_SIZE.height}px`,
            transform: scale === 1 ? '' : `scale(${scale})`,
          }}
        />
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
