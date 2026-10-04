/**
 * `@soundor/web-runtime/client`: the Web host, in the browser. A Web host
 * project's entry (`runtimes/web/src/main.ts`) starts it:
 *
 *   import { startSoundorWebHost } from '@soundor/web-runtime/client';
 *   await startSoundorWebHost();
 */

import manifest from 'soundor:internal/manifest';

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

/** Starts the Web host for this project's plugin. */
export async function startSoundorWebHost(
  options: WebHostOptions = {},
): Promise<WebHost> {
  const container =
    options.container ?? document.getElementById('soundor') ?? document.body;
  const shell = createShell(container, manifest.plugin.name);
  return {
    element: shell.element,
    viewport: shell.viewport,
    dispose: () => shell.remove(),
  };
}

export type { WebManifest, WebParameterInfo } from './manifest';
