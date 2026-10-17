/**
 * Playground mode: the host runs plugin UI code it is sent instead of the
 * project's built UI, so a page can edit a plugin's code and see it run (the
 * Soundor website's editor).
 *
 * The page opens the host with `?playground=<script>`. The script, from the
 * page's own origin, brings what the code needs besides the host (React,
 * `@soundor/react`, a TypeScript compiler) and sets `soundorPlayground`; the
 * host gives it its `soundor:*` modules, as `globalThis.__soundorModules`
 * before the script runs (a bundle of `@soundor/react` reads `soundor:ui`
 * there) and to `start()`. The script then talks to its parent page.
 */

import * as native from 'soundor:native';

import * as fs from './modules/fs';
import * as host from './modules/host';
import * as parameters from './modules/parameters';
import * as storage from './modules/storage';
import * as ui from './modules/ui';

/** The query parameter naming the playground script. */
export const PLAYGROUND_PARAM = 'playground';

/** What the host gives the playground script. */
export interface PlaygroundHost {
  /** The host's `soundor:*` modules, by specifier. */
  readonly modules: Readonly<Record<string, unknown>>;
  /** Shows a notice over the plugin (a compile or runtime error). */
  showMessage(title: string, detail?: string): void;
  /** Removes the notices. */
  clearMessages(): void;
}

/** What the playground script sets as `globalThis.soundorPlayground`. */
export interface PlaygroundScript {
  start(host: PlaygroundHost): void;
}

declare global {
  var __soundorModules: Readonly<Record<string, unknown>> | undefined;
  var soundorPlayground: PlaygroundScript | undefined;
}

/**
 * The playground script `url`'s query names, or null outside playground
 * mode. A script from another origin is refused: a link must not be able to
 * run someone else's code on this page.
 */
export function playgroundScript(url: URL): URL | null {
  const value = url.searchParams.get(PLAYGROUND_PARAM);
  if (value === null) return null;
  const script = new URL(value, url);
  if (script.origin !== url.origin) {
    throw new Error(
      `The playground script must come from this page's origin (${url.origin}), not ${script.origin}`,
    );
  }
  return script;
}

/** Loads a classic script; the default way to load the playground script. */
function loadScript(url: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = url.href;
    element.onload = () => resolve();
    element.onerror = () =>
      reject(new Error(`The playground script ${url.href} failed to load`));
    document.head.append(element);
  });
}

/** Loads the playground script and starts it with this host. */
export async function startPlayground(
  script: URL,
  shell: Pick<PlaygroundHost, 'showMessage' | 'clearMessages'>,
  load: (url: URL) => Promise<void> = loadScript,
): Promise<void> {
  const modules = Object.freeze({
    'soundor:fs': fs,
    'soundor:host': host,
    'soundor:native': native,
    'soundor:parameters': parameters,
    'soundor:storage': storage,
    'soundor:ui': ui,
  });
  globalThis.__soundorModules = modules;
  await load(script);
  const playground = globalThis.soundorPlayground;
  if (typeof playground?.start !== 'function') {
    throw new Error(
      `${script.href} did not set soundorPlayground: it is not a playground script`,
    );
  }
  playground.start({
    modules,
    showMessage: (title, detail) => shell.showMessage(title, detail),
    clearMessages: () => shell.clearMessages(),
  });
}
