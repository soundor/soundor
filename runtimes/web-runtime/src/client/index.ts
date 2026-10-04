/**
 * `@soundor/web-runtime/client`: the Web host, in the browser. A Web host
 * project's entry (`runtimes/web/src/main.ts`) starts it:
 *
 *   import { startSoundorWebHost } from '@soundor/web-runtime/client';
 *   await startSoundorWebHost({
 *     native: () => import('./native'),
 *     audio: () => import('./audio'),
 *   });
 *
 * It renders the host page, installs the project's native API, then
 * evaluates the plugin UI bundle the CLI built, whose `soundor:*` imports
 * reach this page's host. Audio starts with the first Play.
 */

import {
  presentation as defaultPresentation,
  sendLog,
} from 'soundor:internal/dev';
import { hasUi, loadUi } from 'soundor:internal/ui';

import { WebAudioHost, type WebAudioSetup } from './audio';
import { hostContext, uiView } from './context';
import { forwardLogs } from './dev-log';
import { installNative } from './native';
import { report } from './report';
import { createShell, type Presentation } from './shell';

export interface WebHostOptions {
  /** Where the host renders: by default `#soundor`, or else `<body>`. */
  readonly container?: HTMLElement;
  /**
   * Loads the project's `soundor:native` implementation (a module exporting
   * `native`). Loaded after the host exists, before the plugin UI.
   */
  readonly native?: () => Promise<unknown>;
  /** Loads the project's audio (a module exporting `setupAudio`). */
  readonly audio?: () => Promise<unknown>;
  /**
   * 'demo': toolbar, plugin and status. 'dev': with an inspector. By default
   * 'dev' under `soundor dev` and 'demo' in a build.
   */
  readonly presentation?: Presentation;
}

/** A running Web host. */
export interface WebHost {
  /** The host page's element. */
  readonly element: HTMLElement;
  /** Where the plugin UI renders. */
  readonly viewport: HTMLElement;
  /** Removes the host from the page and stops its audio. */
  dispose(): void;
}

let forwarding = false;

/**
 * Starts the Web host for this project's plugin. A native API or plugin UI
 * that fails to load is reported (and shown in the viewport); the host
 * keeps running.
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
  const audio = new WebAudioHost(context.host, {
    loadSetup:
      options.audio === undefined ? undefined : () => loadSetup(options.audio!),
  });
  const shell = createShell(container, {
    pluginName: context.plugin.name,
    presentation: options.presentation ?? defaultPresentation,
    host: context.host,
    parameters: context.parameters,
    audio,
  });

  // The plugin view fills the viewport; soundor:ui renders into it.
  const view = uiView();
  view.mount(shell.viewport);

  const failed = (title: string, error: unknown): void => {
    shell.showMessage(
      title,
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
    );
    report(error);
  };

  if (options.native !== undefined) {
    try {
      installNative(await options.native());
    } catch (error) {
      failed(
        'The native API (runtimes/web/src/native.ts) failed to load.',
        error,
      );
    }
  }

  if (!hasUi) {
    shell.showMessage(
      'This plugin has no UI.',
      'Add src/main.tsx to the project to give it one.',
    );
  } else {
    try {
      await loadUi();
    } catch (error) {
      failed('The plugin UI failed to load.', error);
    }
  }

  return {
    element: shell.element,
    viewport: shell.viewport,
    dispose: () => {
      audio.dispose();
      view.rootElement.remove();
      shell.remove();
    },
  };
}

async function loadSetup(load: () => Promise<unknown>): Promise<WebAudioSetup> {
  const module = (await load()) as {
    setupAudio?: unknown;
    default?: unknown;
  } | null;
  const setup = module?.setupAudio ?? module?.default;
  if (typeof setup !== 'function') {
    throw new TypeError(
      "runtimes/web/src/audio.ts must export its Web Audio setup as 'setupAudio'",
    );
  }
  return setup as WebAudioSetup;
}

export { defineHandle } from './native';
export type { WebNativeHandle, WebNativeHandleType } from './native';
export type {
  WebAudioCleanup,
  WebAudioSetup,
  WebAudioSetupContext,
} from './audio';
export type { Presentation } from './shell';
export type { WebManifest, WebParameterInfo } from './manifest';
