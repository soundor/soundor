/**
 * The page's Web host context. A page (or iframe) runs one plugin, so one
 * context backs every `soundor:*` module, the host UI and the user's Web
 * code. It is created on first use from the generated manifest, so a module
 * that imports `soundor:parameters` works whatever loads first.
 */

import { Engine } from '@soundor/engine/web';
import engineSource from 'soundor:internal/engine';
import manifest from 'soundor:internal/manifest';
import { behaviors } from 'soundor:internal/parameters';

import { assetUrl } from './assets';
import { WebHost, type WebHostOptions } from './host';
import { readManifest, type WebManifest } from './manifest';
import { WebMidiHost } from './midi';
import {
  createParameterStore,
  type ParameterBehavior,
  type ParameterStore,
} from './parameters';
import { isAssetId } from './protocol';
import { ApplicationState } from './state';
import type { WasmController } from './wasm-controller';

export interface WebHostContext {
  controller: WasmController | undefined;
  midi: WebMidiHost;
  readonly manifest: WebManifest;
  /** The plugin's identity, frozen, as `soundor:host` exports it. */
  readonly plugin: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly parameters: ParameterStore;
  readonly host: WebHost;
  readonly state: ApplicationState;
}

/** Creates a context; pages use the one {@link hostContext} returns. */
export function createHostContext(
  manifest: WebManifest,
  options: WebHostOptions = {},
  parameterBehaviors: readonly ParameterBehavior[] = behaviors,
): WebHostContext {
  manifest = readManifest(manifest);
  const parameters = createParameterStore(
    manifest.parameters,
    parameterBehaviors,
  );
  return {
    manifest,
    controller: undefined,
    midi: new WebMidiHost(manifest.midi),
    plugin: Object.freeze({
      ...manifest.plugin,
      version: manifest.plugin.version ?? '0.1.0',
    }),
    parameters,
    state: new ApplicationState(manifest, parameters),
    host: new WebHost(options),
  };
}

let current: WebHostContext | undefined;
let view: Engine | undefined;
let engine: Promise<unknown> | undefined;

/**
 * Loads the engine's WebAssembly (once): the Web host does before anything
 * uses soundor:ui.
 */
export function loadEngine(): Promise<unknown> {
  engine ??= Engine.load(engineSource);
  return engine;
}

/**
 * This page's plugin view: Soundor's engine, which soundor:ui is. Created on
 * first use (it needs the DOM, and the engine loaded).
 */
export function uiView(): Engine {
  view ??= new Engine({
    // Bundled assets, next to the page; any other id shows nothing.
    assetUrl: (id) => (isAssetId(id) ? assetUrl(id) : null),
  });
  return view;
}

/** This page's context. */
export function hostContext(): WebHostContext {
  current ??= createHostContext(manifest);
  return current;
}
