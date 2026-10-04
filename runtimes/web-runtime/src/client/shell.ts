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
    remove() {
      element.remove();
      style.remove();
    },
  };
}
