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
 * reach this page's host. Audio starts with the page's first gesture.
 *
 * A static build opened with `?embed` shows the plugin alone, filling the
 * page (a docs page's snippet), and with `?playground=<script>` runs the code
 * that script is sent instead of the plugin UI (see `playground.ts`).
 */

import {
  presentation as defaultPresentation,
  sendLog,
} from 'soundor:internal/dev';
import { hasUi, loadUi } from 'soundor:internal/ui';

import { WebAudioHost, type WebAudioInput, type WebAudioSetup } from './audio';
import { hostContext, uiView } from './context';
import { forwardLogs } from './dev-log';
import { installNative } from './native';
import { playgroundScript, startPlayground } from './playground';
import { report } from './report';
import { createShell, EMBED_PARAM, type Presentation } from './shell';

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
  /** Custom sources listed in the host panel's Audio → Input selector. */
  readonly audioInputs?: readonly WebAudioInput[];
  /**
   * Initially selected custom input, 'oscillator' (default), or 'none'.
   * Microphone and file inputs require explicit selection in the panel.
   */
  readonly defaultAudioInput?: string;
  /**
   * 'demo': the plugin, a dock and a settings panel. 'dev': with an
   * inspector. 'embed': the plugin alone, filling the page. By default 'dev'
   * under `soundor dev`, and in a build 'embed' when the page's URL has
   * `?embed`, 'demo' otherwise.
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
    inputs: options.audioInputs,
    defaultInput: options.defaultAudioInput,
    loadSetup:
      options.audio === undefined ? undefined : () => loadSetup(options.audio!),
  });
  const shell = createShell(container, {
    pluginName: context.plugin.name,
    presentation: options.presentation ?? pagePresentation(),
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

  let playground: URL | null = null;
  try {
    playground = playgroundScript(new URL(window.location.href));
  } catch (error) {
    failed('The playground could not start.', error);
  }
  if (playground !== null) {
    // The playground runs the code it is sent, not the project's UI.
    try {
      await startPlayground(playground, shell);
    } catch (error) {
      failed('The playground could not start.', error);
    }
  } else if (!hasUi) {
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

function pagePresentation(): Presentation {
  if (defaultPresentation === 'dev') return 'dev';
  return new URL(window.location.href).searchParams.has(EMBED_PARAM)
    ? 'embed'
    : defaultPresentation;
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
  WebAudioInput,
  WebAudioInputContext,
  WebAudioInputInfo,
  WebAudioSetup,
  WebAudioSetupContext,
} from './audio';
export type { Presentation } from './shell';
export type { PlaygroundHost, PlaygroundScript } from './playground';
export type { WebManifest, WebParameterInfo } from './manifest';
