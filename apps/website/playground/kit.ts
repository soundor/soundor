/**
 * The playground script: what an example host loads in playground mode
 * (`@soundor/web-runtime`'s `?playground=`) to run the code the docs page's
 * editor sends it. Built once for every example by `build-playground.ts`, as
 * a classic script whose `soundor:*` imports read the host's modules.
 *
 * It brings React and `@soundor/react`, one copy shared by every file the
 * code is made of, and replaces the previous run's UI with each new one.
 */

import * as SoundorReact from '@soundor/react';
import type { PlaygroundHost } from '@soundor/web-runtime/client';
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';

import { CodeError, run } from './modules.ts';
import { isPlaygroundMessage, type ResultMessage } from './protocol.ts';

/** The roots the code rendered, unmounted before the next run. */
const roots = new Set<SoundorReact.Root>();

/** `@soundor/react`, recording the roots the code creates. */
const tracked: typeof SoundorReact = {
  ...SoundorReact,
  createRoot: (...args: Parameters<typeof SoundorReact.createRoot>) => {
    const root = SoundorReact.createRoot(...args);
    roots.add(root);
    return root;
  },
  render: (element: React.ReactNode) => {
    const root = SoundorReact.render(element);
    roots.add(root);
    return root;
  },
};

function describe(error: unknown): string {
  if (error instanceof CodeError) return error.located;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function start(host: PlaygroundHost): void {
  const libraries = {
    react: React,
    'react/jsx-runtime': JsxRuntime,
    '@soundor/react': tracked,
    ...host.modules,
  };
  // Only the page that embeds this host, on this site, may send it code.
  const parent = window.parent;
  const send = (
    message: ResultMessage | { type: 'soundor:playground:ready' },
  ) => parent.postMessage(message, window.location.origin);

  const fail = (title: string, error: unknown): void => {
    const detail = describe(error);
    host.showMessage(title, detail);
    send({ type: 'soundor:playground:result', error: detail });
  };

  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== window.location.origin) {
      return;
    }
    const message: unknown = event.data;
    if (
      !isPlaygroundMessage(message) ||
      message.type !== 'soundor:playground:run'
    ) {
      return;
    }
    for (const root of roots) root.unmount();
    roots.clear();
    host.clearMessages();
    try {
      run(message.files, message.entry, libraries);
      send({ type: 'soundor:playground:result', error: null });
    } catch (error) {
      fail('Your code did not run.', error);
    }
  });

  // Errors after the run: in a render, an effect or an event handler.
  window.addEventListener('error', (event) =>
    fail('Your code threw an error.', event.error ?? event.message),
  );
  window.addEventListener('unhandledrejection', (event) =>
    fail('Your code threw an error.', event.reason),
  );

  send({ type: 'soundor:playground:ready' });
}

globalThis.soundorPlayground = { start };
