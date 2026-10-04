/**
 * `@soundor/web-runtime/client`: the Web host, in the browser. A Web host
 * project's entry (`runtimes/web/src/main.ts`) starts it:
 *
 *   import { startSoundorWebHost } from '@soundor/web-runtime/client';
 *   await startSoundorWebHost();
 *
 * It renders the host page, then evaluates the plugin UI bundle the CLI
 * built, whose `soundor:*` imports reach this page's host context.
 */

import { sendLog } from 'soundor:internal/dev';
import { hasUi, loadUi } from 'soundor:internal/ui';

import { hostContext, uiView } from './context';
import { forwardLogs } from './dev-log';
import { report } from './report';
import { createShell } from './shell';

export interface WebHostOptions {
  /** Where the host renders: by default `#soundor`, or else `<body>`. */
  readonly container?: HTMLElement;
}

/** A running Web host. */
export interface WebHost {
  /** The host page's element. */
  readonly element: HTMLElement;
  /** Where the plugin UI renders. */
  readonly viewport: HTMLElement;
  /** Removes the host from the page. */
  dispose(): void;
}

let forwarding = false;

/**
 * Starts the Web host for this project's plugin. A plugin UI that fails to
 * load is reported (and shown in the viewport); the host keeps running.
 */
export async function startSoundorWebHost(
  options: WebHostOptions = {},
): Promise<WebHost> {
  if (sendLog !== undefined && !forwarding) {
    forwarding = true;
    forwardLogs(sendLog);
  }
  const container =
    options.container ?? document.getElementById('soundor') ?? document.body;
  const context = hostContext();
  const shell = createShell(container, context.plugin.name);

  // The plugin view fills the viewport; soundor:ui renders into it.
  const view = uiView();
  view.mount(shell.viewport);

  if (!hasUi) {
    shell.showMessage(
      'This plugin has no UI.',
      'Add src/main.tsx to the project to give it one.',
    );
  } else {
    try {
      await loadUi();
    } catch (error) {
      shell.showMessage(
        'The plugin UI failed to load.',
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      );
      report(error);
    }
  }

  return {
    element: shell.element,
    viewport: shell.viewport,
    dispose: () => {
      view.rootElement.remove();
      shell.remove();
    },
  };
}

export type { WebManifest, WebParameterInfo } from './manifest';
