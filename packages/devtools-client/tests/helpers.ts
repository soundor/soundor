import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startDevToolsServer,
  type DevToolsServer,
} from '@soundor/devtools-server';
import { startSimulatedRuntime } from '@soundor/devtools-server/testing';
import { Window as TestWindow, HTMLElement as TestElement } from 'happy-dom';
import { flushSync } from 'react-dom';
import { afterEach, expect } from 'vitest';
import { WebSocket } from 'ws';

import { startInspector } from '../src/inspector';

const dashboard = await readFile(
  new URL('../index.html', import.meta.url),
  'utf8',
);

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
export async function until(
  predicate: () => boolean,
  timeout = 4000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
export async function setup(diagnostics = false) {
  const root = await mkdtemp(join(tmpdir(), 'soundor-inspector-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = await startDevToolsServer({
    projectRoot: root,
    port: 0,
  });
  cleanup.push(() => server.close());
  const native = await target(server, 'Gain Plugin', diagnostics);
  return { server, native, page: await page(server) };
}
export async function target(
  server: DevToolsServer,
  name = 'Gain Plugin',
  diagnostics = false,
) {
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
    name,
    diagnostics,
  });
  cleanup.push(() => runtime.close());
  return runtime;
}
export async function page(server: DevToolsServer, ticket = false) {
  const win = new TestWindow({
    url: ticket ? server.browserLaunchUrl() : server.url,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
    },
  });
  win.document.write(dashboard);
  let cookie = '';
  Object.defineProperty(win, 'fetch', {
    value: async (url: string, init: RequestInit = {}) => {
      const response = await fetch(new URL(url, server.url), {
        ...init,
        headers: { ...init.headers, Origin: server.url, Cookie: cookie },
      });
      const value = response.headers.get('set-cookie');
      if (value) cookie = value.split(';')[0]!;
      return response;
    },
  });
  const sockets: WebSocket[] = [];
  class BrowserSocket extends WebSocket {
    constructor(url: string) {
      super(url, { origin: server.url, headers: { Cookie: cookie } });
      sockets.push(this);
    }
  }
  Object.defineProperty(win, 'WebSocket', { value: BrowserSocket });
  const dispose = startInspector(win as unknown as Window & typeof globalThis);
  cleanup.push(async () => {
    dispose();
    await win.happyDOM.abort();
    win.close();
  });
  const get = (id: string) =>
    win.document.getElementById(id)! as unknown as TestElement;
  const click = (id: string) =>
    flushSync(() => (get(id) as unknown as HTMLButtonElement).click());
  const text = (id: string) => get(id).textContent;
  const search = (query: string) => {
    (get('search') as unknown as HTMLInputElement).value = query;
    flushSync(() =>
      get('search').dispatchEvent(new win.Event('input', { bubbles: true })),
    );
  };
  if (!ticket) {
    await until(() => !get('auth').hidden);
    const { browserKey } = JSON.parse(
      await readFile(server.descriptorPath, 'utf8'),
    );
    (get('key') as unknown as HTMLInputElement).value = browserKey;
    get('auth').dispatchEvent(
      new win.Event('submit', { cancelable: true, bubbles: true }),
    );
  }
  await until(() => text('status').includes('Connected'));
  return {
    win,
    get,
    click,
    text,
    search,
    dispose,
    sockets,
    async ready() {
      await until(() => !!win.document.querySelector('[data-node-id="1"]'));
    },
    async select(id = '3') {
      search(id);
      await until(() => !!win.document.querySelector(`[data-node-id="${id}"]`));
      (
        win.document.querySelector(
          `[data-node-id="${id}"]`,
        ) as unknown as HTMLElement
      ).click();
      await until(() => text('details').includes(` / ${id}`));
    },
    async control() {
      click('control');
      await until(() => text('ownership').includes('You control'));
    },
  };
}
