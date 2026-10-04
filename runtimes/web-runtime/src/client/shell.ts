/**
 * The host page around the plugin: a toolbar, the plugin's viewport and a
 * status bar. Plain DOM; the plugin UI renders inside the viewport only.
 */

/** The plugin view's size in logical pixels, as the JUCE editor opens it. */
export const VIEW_SIZE = { width: 800, height: 600 } as const;

export interface HostShell {
  readonly element: HTMLElement;
  /** Where the plugin UI renders. */
  readonly viewport: HTMLElement;
  /** Shows a notice over the viewport (no UI, a UI that failed). */
  showMessage(title: string, detail?: string): void;
  remove(): void;
}

const STYLE = `
body { margin: 0; background: #0e0f12; }
.soundor-host {
  display: flex; flex-direction: column; min-height: 100vh; margin: 0;
  background: #0e0f12; color: #c9ccd3;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.soundor-toolbar, .soundor-status {
  display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  background: #16171b;
}
.soundor-toolbar { border-bottom: 1px solid #24262c; }
.soundor-status { border-top: 1px solid #24262c; color: #8b8f98; font-size: 12px; }
.soundor-title { font-weight: 600; color: #f2f3f5; }
.soundor-stage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 16px; overflow: auto;
}
.soundor-message {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; padding: 24px;
  text-align: center; color: #8b8f98;
}
.soundor-message strong { color: #f2f3f5; font-size: 14px; }
.soundor-message pre {
  max-width: 100%; overflow: auto; margin: 0; text-align: left;
  white-space: pre-wrap; font-size: 12px; color: #ff8a80;
}
.soundor-viewport {
  position: relative; flex: none; overflow: hidden; background: #17181c;
  box-shadow: 0 0 0 1px #24262c, 0 8px 32px rgb(0 0 0 / 0.4);
}
`;

/** Renders the host page into `container`. */
export function createShell(
  container: HTMLElement,
  pluginName: string,
): HostShell {
  const document = container.ownerDocument;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const element = document.createElement('div');
  element.className = 'soundor-host';

  const toolbar = document.createElement('header');
  toolbar.className = 'soundor-toolbar';
  const title = document.createElement('span');
  title.className = 'soundor-title';
  title.textContent = pluginName;
  toolbar.append(title);

  const stage = document.createElement('main');
  stage.className = 'soundor-stage';
  const viewport = document.createElement('div');
  viewport.className = 'soundor-viewport';
  viewport.style.width = `${VIEW_SIZE.width}px`;
  viewport.style.height = `${VIEW_SIZE.height}px`;
  stage.append(viewport);

  const status = document.createElement('footer');
  status.className = 'soundor-status';
  status.textContent = 'Soundor Web';

  element.append(toolbar, stage, status);
  container.append(element);
  return {
    element,
    viewport,
    showMessage(title, detail) {
      const message = document.createElement('div');
      message.className = 'soundor-message';
      const heading = document.createElement('strong');
      heading.textContent = title;
      message.append(heading);
      if (detail !== undefined) {
        const body = document.createElement('pre');
        body.textContent = detail;
        message.append(body);
      }
      viewport.append(message);
    },
    remove() {
      element.remove();
      style.remove();
    },
  };
}
