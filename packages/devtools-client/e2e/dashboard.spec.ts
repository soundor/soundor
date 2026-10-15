import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import { startDevToolsServer } from '@soundor/devtools-server';
import { startSimulatedRuntime } from '@soundor/devtools-server/testing';

import { developmentBackend } from '../dev/backend';

test('production assets, bootstrap, inspector controls, reload and reconnect', async ({
  page,
}) => {
  const server = await startDevToolsServer({
    projectRoot: '/gain-plugin',
    staticDir: fileURLToPath(new URL('../dist/', import.meta.url)),
  });
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(server.browserLaunchUrl());
    await expect(page.locator('#status')).toContainText('Connected');
    await expect(page).toHaveURL(server.url + '/');
    await expect(page.locator('#auth')).toBeHidden();
    await expect(page.locator('#targets')).toContainText('Gain Plugin');
    await expect(page.getByRole('tree')).toContainText('View');
    await page.getByRole('searchbox', { name: 'Search nodes' }).fill('gain');
    await page.locator('[data-node-id="3"]').click();
    await expect(page.locator('#details')).toContainText('adjustable');
    await page.screenshot({ path: test.info().outputPath('inspector.png') });
    await page.getByRole('button', { name: 'Request control' }).click();
    await expect(page.locator('#ownership')).toContainText('You control');
    await page.getByRole('button', { name: 'Select element' }).click();
    await expect(page.locator('#picker')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('#picker')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await runtime.reload();
    await expect(page.locator('#target-meta')).toContainText('generation 2');
    await page.reload();
    await expect(page.locator('#status')).toContainText('Connected');
    expect(errors).toEqual([]);
    expect(
      (await page.request.get(server.url + '/assets/not-found.js')).status(),
    ).toBe(404);
    await page.goto(server.url + '/inspect/tree');
    await expect(
      page.getByRole('heading', { name: 'Soundor DevTools' }),
    ).toBeVisible();
    await expect(page.locator('#status')).toContainText('Connected');
    const response = await page.request.get(server.url);
    expect(response.headers()['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
  } finally {
    await page.close();
    await runtime.close();
    await server.close();
  }
});

test.describe('Vite development', () => {
  test('standalone Vite development authenticates through its HTTP and WebSocket proxy', async ({
    page,
  }) => {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { port: 0 } });
    try {
      await vite.listen();
      // localhost and 127.0.0.1 are different browser origins. Bootstrap
      // must land on the explicitly trusted development origin.
      const address = vite.httpServer!.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing Vite listener');
      const origin = 'http://127.0.0.1:' + address.port;
      await page.goto('http://localhost:' + address.port + '/__connect');
      await expect(page.locator('#status')).toContainText('Connected');
      await expect(page.locator('#targets')).toContainText('Gain Plugin');
      await expect(page).toHaveURL(origin + '/');
      await expect(page.getByRole('tree')).toContainText('View');
      await page.getByRole('button', { name: 'Request control' }).click();
      await expect(page.locator('#ownership')).toContainText('You control');
    } finally {
      await page.close();
      await vite.close();
    }
  });

  test('attaches to an external backend without taking ownership of its runtime or shutdown', async ({
    page,
  }) => {
    const { createServer } = await import('vite');
    let backend: Awaited<ReturnType<typeof startDevToolsServer>> | undefined;
    let runtime: Awaited<ReturnType<typeof startSimulatedRuntime>> | undefined;
    let vite;
    try {
      vite = await createServer({
        configFile: false,
        root: fileURLToPath(new URL('../', import.meta.url)),
        server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: {} },
        plugins: [
          developmentBackend({
            endpoint: async (origin) => {
              backend = await startDevToolsServer({
                projectRoot: '/external-project',
                developmentOrigin: origin,
              });
              runtime = await startSimulatedRuntime({
                connection: backend.connection,
                name: 'External Gain',
              });
              return backend.connection.endpoint;
            },
          }),
        ],
      });
      await vite.listen();
      const address = vite.httpServer!.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing Vite listener');
      const origin = 'http://127.0.0.1:' + address.port;
      await page.goto(origin + '/__connect');
      if (!backend || !runtime)
        throw new Error('External backend was not initialized');
      const hash = new URL(backend.browserLaunchUrl()).hash;
      // Bootstrap is consumed on document startup, not a same-page hash change.
      await page.goto('about:blank');
      await page.goto(origin + '/' + hash);
      await expect(page.locator('#status')).toContainText('Connected');
      await expect(page).toHaveURL(origin + '/');
      await expect(page.locator('#targets')).toContainText('External Gain');
      await expect(page.locator('#targets option')).toHaveCount(1);
      await page.getByRole('button', { name: 'Request control' }).click();
      await expect(page.locator('#ownership')).toContainText('You control');
      await page.close();
      await vite.close();
      expect(
        (await fetch(backend.connection.endpoint + '/browser/session')).status,
      ).toBe(200);
      expect(runtime.failure).toBeUndefined();
    } finally {
      await page.close();
      await vite?.close();
      await runtime?.close();
      await backend?.close();
    }
  });
});
