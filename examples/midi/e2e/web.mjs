// A real built Web host: UI -> Rust/WASM -> UI and controller in Chromium.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../.soundor/dist/web/', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.css': 'text/css',
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const arp = pathname.startsWith('/arp/');
  const directory = arp
    ? fileURLToPath(
        new URL('../../midi-arpeggiator/.soundor/dist/web/', import.meta.url),
      )
    : root;
  const relative = arp ? pathname.slice(4) : pathname;
  const path = resolve(
    directory,
    `.${relative === '/' ? '/index.html' : relative}`,
  );
  if (!path.startsWith(directory)) return void response.writeHead(403).end();
  try {
    response
      .writeHead(200, {
        'content-type': types[extname(path)] ?? 'application/octet-stream',
      })
      .end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.midiPermissions = 0;
    navigator.requestMIDIAccess = () => {
      window.midiPermissions++;
      return Promise.reject(
        new DOMException('Test permission denied', 'NotAllowedError'),
      );
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText('MIDI Lab', { exact: true }).click();
  await expect(page.locator('.soundor-audio')).toHaveAttribute(
    'data-state',
    'running',
  );
  const key = page.getByRole('button', { name: 'Note 60', exact: true });
  await key.hover();
  await page.mouse.down();
  await expect(page.getByText(/"type":"noteOn".*"note":60/)).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText(/"type":"noteOff".*"note":60/)).toBeVisible();
  const controllerKey = page.getByRole('button', { name: 'Controller note' });
  await controllerKey.hover();
  await page.mouse.down();
  await expect(page.getByText(/"type":"noteOn".*controller$/)).toBeVisible();
  await page.mouse.up();
  await expect(
    page.getByText(/"type":"noteOn".*"velocity":0.*controller$/),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await page.getByText('Read controller monitor', { exact: true }).click();
      return Number(
        /Controller: (\d+) events/.exec(
          await page.locator('body').innerText(),
        )?.[1] ?? 0,
      );
    })
    .toBeGreaterThanOrEqual(4);
  assert.equal(
    await page.evaluate(() => window.midiPermissions),
    0,
    'Virtual notes must not request hardware permission',
  );
  await page.screenshot({ path: '/tmp/soundor-midi-lab.png' });
  await page.getByRole('button', { name: 'Host settings' }).click();
  await page.getByRole('button', { name: 'Connect MIDI devices' }).click();
  await expect(
    page.getByText('MIDI permission denied; virtual input still works.', {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => window.midiPermissions), 1);
  const unavailable = await browser.newPage();
  unavailable.on('pageerror', (error) => errors.push(error.message));
  await unavailable.addInitScript(() => {
    navigator.requestMIDIAccess = undefined;
  });
  await unavailable.goto(`http://127.0.0.1:${server.address().port}/arp/`);
  await unavailable.getByText('MIDI Arpeggiator', { exact: true }).click();
  await expect(unavailable.locator('.soundor-audio')).toHaveAttribute(
    'data-state',
    'running',
  );
  const arpKey = unavailable.getByRole('button', {
    name: 'Note 64',
    exact: true,
  });
  await arpKey.hover();
  await unavailable.mouse.down();
  await expect(
    unavailable.getByText(/"type":"noteOn".*"note":64/).first(),
  ).toBeVisible();
  await unavailable.mouse.up();
  await expect(
    unavailable.getByText(/"type":"noteOff".*"note":64/).first(),
  ).toBeVisible();
  await unavailable.getByRole('button', { name: 'Host settings' }).click();
  await unavailable
    .getByRole('button', { name: 'Connect MIDI devices' })
    .click();
  await expect(
    unavailable.getByText('Web MIDI unavailable; virtual input still works.', {
      exact: true,
    }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'Web MIDI Lab: UI and controller sends/publications, no implicit permission, permission denial, unsupported Web MIDI, audio-free arpeggiator and clean browser consoles',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
