/** The browser host: one Rust controller on the main thread, its Rust
 * processor in a separate AudioWorklet, and the shared TypeScript UI. */

import {
  presentation as defaultPresentation,
  sendLog,
} from 'soundor:internal/dev';
import processorWasm from 'soundor:internal/processor';
import { hasUi, loadUi } from 'soundor:internal/ui';

import { WebAudioHost, type WebAudioInput } from './audio';
import { processorState } from './audio-state';
import { hostContext, loadEngine, uiView } from './context';
import { forwardLogs } from './dev-log';
import { validateInputs, type WebInput } from './input';
import { nativeStreamPublishers } from './native-streams';
import { playgroundScript, startPlayground } from './playground';
import { report } from './report';
import { createShell, EMBED_PARAM, type Presentation } from './shell';
import { WasmController } from './wasm-controller';

export interface WebHostOptions {
  /** Where the host renders: by default `#soundor`, or else `<body>`. */
  readonly container?: HTMLElement;
  /** Custom sources listed in the host panel's Audio → Input selector. */
  readonly audioInputs?: readonly WebAudioInput[];
  /** Complete input list used by the managed host. */
  readonly inputs?: readonly WebInput[];
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
  /** Restore parameter and state defaults and persist them. */
  reset(): void;
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
  if (options.inputs !== undefined) validateInputs(options.inputs);
  if (sendLog !== undefined && !forwarding) {
    forwarding = true;
    forwardLogs(sendLog);
  }
  const container =
    options.container ?? document.getElementById('soundor') ?? document.body;
  const context = hostContext();
  await context.state.ready;
  if (processorWasm === undefined)
    throw new Error(
      'Missing lib/ WebAssembly: rebuild the plugin with soundor build web',
    );
  const wasm = Uint8Array.from(atob(processorWasm), (char) =>
    char.charCodeAt(0),
  );
  const controller = new WasmController(
    await WebAssembly.compile(wasm),
    context,
  );
  context.controller = controller;
  const audio = new WebAudioHost(context.host, {
    audio: context.manifest.audio,
    inputs: options.audioInputs,
    configuredInputs: options.inputs,
    defaultInput: options.defaultAudioInput,
    loadProcessor: async () => {
      if (processorWasm === undefined) return undefined;
      const streams = context.manifest.native.streams;
      const publishers = nativeStreamPublishers();
      return {
        wasm: Uint8Array.from(atob(processorWasm), (char) =>
          char.charCodeAt(0),
        ),
        resources: controller,
        parameters: context.parameters.list,
        streams,
        publishStream: (index, value) => {
          const stream = streams[index];
          if (stream !== undefined) publishers[stream.name]?.publish(value);
        },
        state: processorState(context.state.store),
      };
    },
  });
  // The plugin view, measured again when the shell scales it: the engine,
  // whose WebAssembly loads first.
  try {
    await loadEngine();
    const view = uiView();
    const shell = createShell(container, {
      pluginName: context.plugin.name,
      presentation: options.presentation ?? pagePresentation(),
      editor: context.manifest.editor,
      onScale: () => view.measure(),
      onGeometry: (geometry) => view.setGeometry(geometry),
      host: context.host,
      parameters: context.parameters,
      parameterGroups: context.manifest.parameterGroups,
      audio,
    });

    // The plugin view fills the viewport; soundor:ui renders into it, and its
    // requestEditorSize() resizes it as the viewport's handle does.
    view.mount(shell.viewport);
    view.setEditorRequester((size) => shell.requestEditorSize(size));

    const failed = (title: string, error: unknown): void => {
      shell.showMessage(
        title,
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      );
      report(error);
    };

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
        'Add src/index.tsx to the project to give it one.',
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
      reset: () => context.state.reset(),
      dispose: () => {
        context.state.store.resetGestures();
        void context.state.flush();
        controller.dispose();
        context.controller = undefined;
        audio.dispose();
        view.rootElement.remove();
        view.setEditorRequester(null);
        shell.remove();
      },
    };
  } catch (error) {
    controller.dispose();
    context.controller = undefined;
    audio.dispose();
    throw error;
  }
}

function pagePresentation(): Presentation {
  if (defaultPresentation === 'dev') return 'dev';
  return new URL(window.location.href).searchParams.has(EMBED_PARAM)
    ? 'embed'
    : defaultPresentation;
}

export type {
  WebAudioCleanup,
  WebAudioInput,
  WebAudioInputContext,
  WebAudioInputInfo,
} from './audio';
// The generated `events` and `streams` of runtimes/web's native contract.
export { nativeStreamPublishers } from './native-streams';
export { nativeEventPublishers } from './native-events';
export type { Presentation } from './shell';
export type { PlaygroundHost, PlaygroundScript } from './playground';
export type { WebEditor, WebManifest, WebParameterInfo } from './manifest';
