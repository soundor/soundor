/**
 * The page's Web host context. A page (or iframe) runs one plugin, so one
 * context backs every `soundor:*` module, the host UI and the user's Web
 * code. It is created on first use from the generated manifest, so a module
 * that imports `soundor:parameters` works whatever loads first.
 */

import manifest from 'soundor:internal/manifest';
import { behaviors } from 'soundor:internal/parameters';

import { WebHost, type WebHostOptions } from './host';
import { readManifest, type WebManifest } from './manifest';
import {
  createParameterStore,
  type ParameterBehavior,
  type ParameterStore,
} from './parameters';
import { ApplicationState } from './state';
import { UiView } from './ui/view';

export interface WebHostContext {
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
let view: UiView | undefined;

/** This page's plugin view, created on first use (it needs the DOM). */
export function uiView(): UiView {
  view ??= new UiView();
  return view;
}

/** This page's context. */
export function hostContext(): WebHostContext {
  current ??= createHostContext(manifest);
  return current;
}
