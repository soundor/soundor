import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_CAPTURES } from '@soundor/devtools-protocol';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { startDevToolsServer, type DevToolsServer } from './server';
import {
  SIMULATED_VIEW,
  startSimulatedBrowser,
  startSimulatedRuntime,
} from './testing';

const PNG = [0x89, 0x50, 0x4e, 0x47];
let root: string;
let server: DevToolsServer;
const cleanup: Array<() => Promise<unknown>> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-captures-'));
  server = await startDevToolsServer({ projectRoot: root, port: 0 });
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function session(options: { capture?: boolean } = {}) {
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
    ...options,
  });
  cleanup.push(() => runtime.close());
  const browser = await startSimulatedBrowser(server);
  cleanup.push(() => browser.close());
  return { runtime, browser };
}

it('delivers a capture as a bounded, authenticated binary resource', async () => {
  const { runtime, browser } = await session();
  // Captures read the view: no control needed.
  const response = await browser.request('Capture.screenshot', runtime.id);
  const capture = response.result as {
    id: string;
    width: number;
    height: number;
    bytes: number;
  };
  expect(capture).toMatchObject({
    width: SIMULATED_VIEW.width,
    height: SIMULATED_VIEW.height,
    scale: 1,
    format: 'png',
  });
  const download = await browser.fetch(`/browser/captures/${capture.id}`);
  expect(download.status).toBe(200);
  expect(download.headers.get('content-type')).toBe('image/png');
  expect(download.headers.get('cache-control')).toBe('no-store');
  const bytes = new Uint8Array(await download.arrayBuffer());
  expect(bytes.length).toBe(capture.bytes);
  expect([...bytes.subarray(0, 4)]).toEqual(PNG);

  // Only this session's signed-in clients, from its own origin.
  const url = `${server.connection.endpoint}/browser/captures/${capture.id}`;
  expect((await fetch(url)).status).toBe(403);
  expect(
    await browser
      .fetch(`/browser/captures/${capture.id}`, {
        headers: { Origin: 'http://evil.test' },
      })
      .then((r) => r.status),
  ).toBe(403);
  // The runtime's own credentials do not read captures either.
  expect(
    (
      await fetch(url, {
        headers: {
          Authorization: `Bearer ${server.connection.token}`,
          'X-Soundor-Session': server.connection.sessionId,
        },
      })
    ).status,
  ).toBe(403);

  expect(
    (
      await browser.fetch(`/browser/captures/${capture.id}`, {
        method: 'DELETE',
      })
    ).status,
  ).toBe(200);
  expect((await browser.fetch(`/browser/captures/${capture.id}`)).status).toBe(
    404,
  );
});

it('clips a capture to a node', async () => {
  const { runtime, browser } = await session();
  const response = await browser.request('Capture.screenshot', runtime.id, {
    node: { generation: 1, id: '3' },
  });
  expect(response.result).toMatchObject({ width: 96, height: 96 });
});

it('requires the capture capability and an upload matching the answer', async () => {
  const limited = await session({ capture: false });
  expect(
    await limited.browser.request('Capture.screenshot', limited.runtime.id),
  ).toMatchObject({ error: { code: 'MISSING_CAPABILITY' } });

  const { runtime, browser } = await session();
  runtime.skipCaptureUploads(true);
  expect(await browser.request('Capture.screenshot', runtime.id)).toMatchObject(
    { error: { code: 'CAPTURE_UNAVAILABLE' } },
  );
  runtime.skipCaptureUploads(false);
  runtime.failCaptures('Nothing is rendered yet');
  expect(await browser.request('Capture.screenshot', runtime.id)).toMatchObject(
    {
      error: {
        code: 'CAPTURE_UNAVAILABLE',
        message: 'Nothing is rendered yet',
      },
    },
  );
});

it('refuses uploads nobody asked for, and bytes that are not PNG', async () => {
  const browser = await startSimulatedBrowser(server);
  cleanup.push(() => browser.close());
  const runtimeHeaders = {
    Authorization: `Bearer ${server.connection.token}`,
    'X-Soundor-Session': server.connection.sessionId,
  };
  const registration = await fetch(
    server.connection.endpoint + '/runtime/register',
    {
      method: 'POST',
      headers: { ...runtimeHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        sessionId: server.connection.sessionId,
        name: 'Uploader',
        runtime: 'Fake',
        generation: 1,
        capabilities: ['capture'],
      }),
    },
  );
  const { targetId, targetToken } = (await registration.json()) as {
    targetId: string;
    targetToken: string;
  };
  const headers = {
    ...runtimeHeaders,
    'X-Soundor-Target': targetId,
    'X-Soundor-Target-Token': targetToken,
  };
  const upload = (id: string, body: Uint8Array, extra = {}) =>
    fetch(`${server.connection.endpoint}/runtime/captures/${id}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/png', ...extra },
      body,
    });
  const png = new Uint8Array([...PNG, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  expect((await upload('unknown', png)).status).toBe(409);
  // Without the target's credentials: refused before anything is read.
  expect(
    (await upload('unknown', png, { 'X-Soundor-Target-Token': 'x' })).status,
  ).toBe(401);
  const pendingCapture = browser.request('Capture.screenshot', targetId);
  const poll = await fetch(server.connection.endpoint + '/runtime/poll', {
    headers,
  });
  const [command] = ((await poll.json()) as { commands: { id: string }[] })
    .commands;
  expect((await upload(command!.id, new Uint8Array([1, 2, 3]))).status).toBe(
    400,
  );
  expect((await upload(command!.id, png)).status).toBe(200);
  // One upload per capture.
  expect((await upload(command!.id, png)).status).toBe(409);
  const answer = await fetch(server.connection.endpoint + '/runtime/messages', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'response',
      id: command!.id,
      result: {
        width: 1,
        height: 1,
        scale: 1,
        format: 'png',
        bytes: png.length,
      },
    }),
  });
  expect(answer.status).toBe(200);
  expect(await pendingCapture).toMatchObject({
    result: { width: 1, height: 1, bytes: png.length },
  });
});

it('keeps a bounded number of captures, and drops a client’s when it goes', async () => {
  const { runtime, browser } = await session();
  const ids: string[] = [];
  for (let index = 0; index <= MAX_CAPTURES; ++index)
    ids.push(
      (
        (await browser.request('Capture.screenshot', runtime.id)).result as {
          id: string;
        }
      ).id,
    );
  // The oldest went first.
  expect((await browser.fetch(`/browser/captures/${ids[0]}`)).status).toBe(404);
  expect((await browser.fetch(`/browser/captures/${ids.at(-1)}`)).status).toBe(
    200,
  );
  const other = await startSimulatedBrowser(server);
  await browser.close();
  // The client that asked went: so did its captures.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await other.fetch(`/browser/captures/${ids.at(-1)}`)).status).toBe(
    404,
  );
  await other.close();
});
