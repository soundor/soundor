import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type DebugMethod,
  type DebugResponse,
  type RuntimeCommand,
} from '@soundor/devtools-protocol';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  startDevToolsServer,
  type DevToolsServer,
  type DevToolsServerOptions,
} from './server';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function serve(
  overrides: Partial<DevToolsServerOptions> = {},
): Promise<DevToolsServer> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'soundor-session-'));
  cleanup.push(() => rm(projectRoot, { recursive: true, force: true }));
  const server = await startDevToolsServer({
    projectRoot,
    port: 0,
    ...overrides,
  });
  cleanup.push(() => server.close());
  return server;
}

class Client {
  readonly messages: Array<Record<string, unknown>> = [];
  id = '';
  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) =>
      this.messages.push(JSON.parse(data.toString())),
    );
  }
  async take(
    predicate: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`No matching message: ${JSON.stringify(this.messages)}`);
  }
  request(
    method: DebugMethod,
    targetId?: string,
    params: unknown = {},
  ): { id: string; response: Promise<DebugResponse> } {
    const id = crypto.randomUUID();
    this.socket.send(
      JSON.stringify({ type: 'request', id, targetId, method, params }),
    );
    return {
      id,
      response: this.take(
        (message) => message.type === 'response' && message.id === id,
      ) as unknown as Promise<DebugResponse>,
    };
  }
}
async function browser(
  server: DevToolsServer,
  autoPong = true,
  version = PROTOCOL_VERSION,
): Promise<Client> {
  const { browserKey } = JSON.parse(
    await readFile(server.descriptorPath, 'utf8'),
  );
  const page = await fetch(server.connection.endpoint + '/browser/auth', {
    method: 'POST',
    headers: { Origin: server.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: browserKey }),
  });
  const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
  const socket = new WebSocket(
    server.connection.endpoint.replace('http', 'ws') + '/browser',
    { origin: server.url, headers: { Cookie: cookie }, autoPong },
  );
  const client = new Client(socket);
  cleanup.push(async () => {
    socket.terminate();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const hello = await client.take((message) => message.type === 'hello');
  expect(hello.version).toBe(PROTOCOL_VERSION);
  client.id = hello.clientId as string;
  socket.send(JSON.stringify({ type: 'hello', version }));
  return client;
}
async function native(
  server: DevToolsServer,
  name = 'Plugin',
  capabilities: string[] = ['inspector', 'accessibility'],
): Promise<{
  id: string;
  headers: Record<string, string>;
  poll: () => Promise<RuntimeCommand[]>;
  post: (message: unknown) => Promise<Response>;
  disconnect: () => Promise<Response>;
}> {
  const headers = {
    Authorization: `Bearer ${server.connection.token}`,
    'X-Soundor-Session': server.connection.sessionId,
    'Content-Type': 'application/json',
  };
  const result = await fetch(server.connection.endpoint + '/runtime/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: PROTOCOL_VERSION,
      sessionId: server.connection.sessionId,
      name,
      runtime: 'Fake Native',
      generation: 1,
      capabilities,
    }),
  });
  expect(result.status).toBe(200);
  const registration = (await result.json()) as {
    targetId: string;
    targetToken: string;
  };
  const targetHeaders = {
    ...headers,
    'X-Soundor-Target': registration.targetId,
    'X-Soundor-Target-Token': registration.targetToken,
  };
  return {
    id: registration.targetId,
    headers: targetHeaders,
    async poll() {
      const response = await fetch(
        server.connection.endpoint + '/runtime/poll',
        { headers: targetHeaders },
      );
      return ((await response.json()) as { commands: RuntimeCommand[] })
        .commands;
    },
    post: (message) =>
      fetch(server.connection.endpoint + '/runtime/messages', {
        method: 'POST',
        headers: targetHeaders,
        body: JSON.stringify(message),
      }),
    disconnect: () =>
      fetch(server.connection.endpoint + '/runtime/disconnect', {
        method: 'POST',
        headers: targetHeaders,
      }),
  };
}

it('selects the next default port and reports explicit collisions', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(0, '127.0.0.1', resolve),
  );
  cleanup.push(
    () => new Promise<void>((resolve) => occupied.close(() => resolve())),
  );
  const port = (occupied.address() as { port: number }).port;
  const server = await serve({
    port,
    portFallback: true,
  });
  expect(Number(new URL(server.url).port)).toBeGreaterThan(port);
  await expect(
    serve({
      port,
    }),
  ).rejects.toThrow('change devtools.port');
});

it('protects descriptors and removes them on shutdown', async () => {
  const server = await serve();
  const descriptor = JSON.parse(await readFile(server.descriptorPath, 'utf8'));
  expect(descriptor.token).toBe(server.connection.token);
  expect(descriptor.sessionId).toBe(server.connection.sessionId);
  if (process.platform !== 'win32')
    expect((await stat(server.descriptorPath)).mode & 0o777).toBe(0o600);
  const response = await fetch(server.connection.endpoint);
  const html = await response.text();
  expect(response.status).toBe(404);
  expect(html).not.toContain(server.connection.token);
  expect(response.headers.get('set-cookie')).toBeNull();
  await server.close();
  await expect(stat(server.descriptorPath)).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('rejects unauthenticated clients, origins, hosts and mismatched protocols', async () => {
  const server = await serve();
  expect(
    (
      await fetch(server.connection.endpoint + '/runtime/register', {
        method: 'POST',
        body: '{}',
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(server.connection.endpoint, {
        headers: { Origin: 'https://evil.test' },
      })
    ).status,
  ).toBe(403);
  const hostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const request = httpRequest(
        server.connection.endpoint,
        { headers: { Host: 'evil.test' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
  expect(hostStatus).toBe(403);
  const headers = {
    Authorization: `Bearer ${server.connection.token}`,
    'X-Soundor-Session': server.connection.sessionId,
  };
  expect(
    (
      await fetch(server.connection.endpoint + '/runtime/register', {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 99 }),
      })
    ).status,
  ).toBe(400);
  const socket = new WebSocket(
    server.connection.endpoint.replace('http', 'ws') + '/browser',
    { origin: server.url },
  );
  await new Promise<void>((resolve) => {
    socket.on('unexpected-response', (_request, response) => {
      expect(response.statusCode).toBe(403);
      response.resume();
      socket.terminate();
      resolve();
    });
    socket.on('error', () => {});
  });
  const client = await browser(server, true, 99);
  expect(
    (await client.take((message) => message.type === 'error')).error,
  ).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
});

it('isolates concurrent projects, targets, responses and reconnects', async () => {
  const a = await serve();
  const b = await serve();
  expect(a.connection.sessionId).not.toBe(b.connection.sessionId);
  expect(a.connection.token).not.toBe(b.connection.token);
  const first = await native(a);
  const second = await native(a);
  const foreign = await native(b);
  const client = await browser(a);
  const list = await client.request('Runtime.getTargets').response;
  expect((list.result as unknown[]).length).toBe(2);
  expect(await client.request('UI.getTree', foreign.id).response).toMatchObject(
    { error: { code: 'TARGET_GONE' } },
  );
  const operation = client.request('UI.getLayout', first.id, {
    node: { generation: 1, id: 'node' },
  });
  const commands = await first.poll();
  const request = commands.find((command) => command.type === 'request')!;
  expect(request.type).toBe('request');
  if (request.type !== 'request') throw new Error('Expected request');
  expect(
    (await second.post({ type: 'response', id: request.id, result: {} }))
      .status,
  ).toBe(409);
  expect(
    (
      await first.post({
        type: 'response',
        id: request.id,
        result: { width: 10 },
      })
    ).status,
  ).toBe(200);
  expect(await operation.response).toMatchObject({ result: { width: 10 } });
  expect(
    (
      await fetch(b.connection.endpoint + '/runtime/poll', {
        headers: first.headers,
      })
    ).status,
  ).toBe(401);
  await first.disconnect();
  expect(await client.request('UI.getTree', first.id).response).toMatchObject({
    error: { code: 'TARGET_GONE' },
  });
  const reconnected = await native(a);
  expect(reconnected.id).not.toBe(first.id);
});

it('lets every client change debug state, names it to the runtime, and cleans up after it', async () => {
  const server = await serve();
  const target = await native(server);
  const first = await browser(server);
  const second = await browser(server);
  // No lease: both clients highlight at once, each request naming its client.
  const highlights = [first, second].map(
    (client) =>
      client.request('UI.highlightNode', target.id, {
        node: { generation: 1, id: 'node' },
      }).response,
  );
  const requests: RuntimeCommand[] = [];
  while (requests.length < 2)
    requests.push(
      ...(await target.poll()).filter((command) => command.type === 'request'),
    );
  expect(
    requests
      .map((command) => command.type === 'request' && command.client)
      .sort(),
  ).toEqual([first.id, second.id].sort());
  for (const command of requests)
    if (command.type === 'request')
      await target.post({ type: 'response', id: command.id, result: null });
  for (const response of await Promise.all(highlights))
    expect(response).toMatchObject({ result: null });
  // An event about one client's own state reaches that client alone.
  for (const client of [first, second])
    await client.request('Events.subscribe', target.id, {
      events: ['UI.pickerChanged'],
    }).response;
  await target.post({
    type: 'event',
    event: 'UI.pickerChanged',
    data: { enabled: true },
    client: second.id,
  });
  const picked = await second.take(
    (message) => message.event === 'UI.pickerChanged',
  );
  expect(picked).not.toHaveProperty('client');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    first.messages.some((message) => message.event === 'UI.pickerChanged'),
  ).toBe(false);
  // A client's state goes with it, whoever else is connected.
  first.socket.terminate();
  const gone: RuntimeCommand[] = [];
  while (!gone.some((command) => command.type === 'clientGone'))
    gone.push(...(await target.poll()));
  expect(gone).toContainEqual({ type: 'clientGone', client: first.id });
  expect(gone).not.toContainEqual({ type: 'clientGone', client: second.id });
});

it('gates input behind its capability, before forwarding', async () => {
  const server = await serve();
  const inspectOnly = await native(server, 'Inspect only');
  const automatable = await native(server, 'Automatable', [
    'inspector',
    'input',
  ]);
  const client = await browser(server);
  const other = await browser(server);
  const click = { action: 'click', x: 10, y: 10 };
  // `inspector` alone never grants input.
  expect(
    await client.request('Input.dispatchPointer', inspectOnly.id, click)
      .response,
  ).toMatchObject({ error: { code: 'MISSING_CAPABILITY' } });
  // Clients send input side by side, as two mice: neither waits for the other.
  const dispatched = client.request(
    'Input.dispatchPointer',
    automatable.id,
    click,
  );
  const typed = other.request('Input.dispatchKey', automatable.id, {
    action: 'press',
    key: 'a',
  });
  const commands: RuntimeCommand[] = [];
  while (commands.length < 2) commands.push(...(await automatable.poll()));
  expect(commands).toMatchObject([
    { method: 'Input.dispatchPointer', params: click, client: client.id },
    { method: 'Input.dispatchKey', client: other.id },
  ]);
  for (const command of commands)
    if (command.type === 'request')
      await automatable.post({
        type: 'response',
        id: command.id,
        result: { handled: true, node: { generation: 1, id: '3' } },
      });
  expect(await dispatched.response).toMatchObject({
    result: { handled: true },
  });
  expect(await typed.response).toMatchObject({ result: { handled: true } });
});

it('forgets a client after heartbeat timeout', async () => {
  const server = await serve({ heartbeatTimeout: 90 });
  const target = await native(server);
  const stalled = await browser(server, false);
  await new Promise((resolve) => setTimeout(resolve, 140));
  expect(await target.poll()).toContainEqual({
    type: 'clientGone',
    client: stalled.id,
  });
});

it('supports bounded subscriptions, cancels commands and invalidates generations', async () => {
  const server = await serve({ commandTimeout: 80 });
  const target = await native(server);
  const client = await browser(server);
  const observer = await browser(server);
  await client.request('Events.subscribe', target.id, {
    events: ['UI.nodeSelected', 'Runtime.generationChanged'],
  }).response;
  expect(await target.poll()).toContainEqual({
    type: 'subscribe',
    events: ['UI.nodeSelected', 'Runtime.generationChanged'],
  });
  await target.post({
    type: 'event',
    event: 'UI.nodeSelected',
    data: { node: { generation: 1, id: 'node' } },
  });
  expect(
    await client.take((message) => message.event === 'UI.nodeSelected'),
  ).toMatchObject({ targetId: target.id, data: { node: { id: 'node' } } });
  expect(
    observer.messages.some((message) => message.event === 'UI.nodeSelected'),
  ).toBe(false);
  const cancelled = client.request('UI.getLayout', target.id, {
    node: { generation: 1, id: 'node' },
  });
  client.socket.send(JSON.stringify({ type: 'cancel', id: cancelled.id }));
  expect(await cancelled.response).toMatchObject({
    error: { code: 'CANCELLED' },
  });
  expect(await client.request('UI.getTree', target.id).response).toMatchObject({
    error: { code: 'TIMEOUT' },
  });
  await target.post({
    type: 'event',
    event: 'Runtime.generationChanged',
    data: { generation: 2 },
  });
  expect(
    await client.request('UI.getNode', target.id, {
      node: { generation: 1, id: 'node' },
    }).response,
  ).toMatchObject({ error: { code: 'STALE_NODE' } });
  expect(
    await client.request('Animation.getActive', target.id).response,
  ).toMatchObject({ error: { code: 'MISSING_CAPABILITY' } });
  const removed = client.request('UI.getNode', target.id, {
    node: { generation: 2, id: 'removed' },
  });
  const commands = await target.poll();
  const request = commands.find(
    (command) => command.type === 'request' && command.method === 'UI.getNode',
  );
  if (request?.type !== 'request') throw new Error('Expected node query');
  await target.post({
    type: 'response',
    id: request.id,
    error: { code: 'STALE_NODE', message: 'Node removed' },
  });
  expect(await removed.response).toMatchObject({
    error: { code: 'STALE_NODE' },
  });
  await server.close();
  expect(client.socket.readyState).not.toBe(WebSocket.OPEN);
});

it('bounds malformed and oversized messages and cleans up an active native poll', async () => {
  const server = await serve();
  const target = await native(server);
  const client = await browser(server);
  client.socket.send(
    JSON.stringify({
      type: 'request',
      id: 'bad',
      targetId: target.id,
      method: 'UI.setPickerEnabled',
      params: { enabled: 'yes' },
    }),
  );
  expect(
    (await client.take((message) => message.type === 'error')).error,
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  const polling = target.poll();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await server.close();
  // Shutdown finishes or closes the poll; it does not keep the server alive.
  await polling.catch(() => undefined);
});

it('rejects oversized browser messages and stale runtime snapshots', async () => {
  const server = await serve();
  const target = await native(server);
  const client = await browser(server);
  const query = client.request('UI.getTree', target.id);
  const command = (await target.poll()).find(
    (command) => command.type === 'request',
  );
  if (command?.type !== 'request') throw new Error('Expected tree query');
  await target.post({
    type: 'response',
    id: command.id,
    result: {
      generation: 9,
      revision: 0,
      roots: [],
      nodes: [],
      truncated: false,
    },
  });
  expect(await query.response).toMatchObject({ error: { code: 'STALE_NODE' } });
  const closed = new Promise<number>((resolve) =>
    client.socket.once('close', (code) => resolve(code)),
  );
  client.socket.send('x'.repeat(1024 * 1024 + 1));
  expect(await closed).toBe(1009);
});

it('expires crashed native targets and rejects old credentials after a server restart', async () => {
  const server = await serve({ targetTimeout: 90 });
  const target = await native(server);
  const client = await browser(server);
  await new Promise((resolve) => setTimeout(resolve, 140));
  expect(await client.request('UI.getTree', target.id).response).toMatchObject({
    error: { code: 'TARGET_GONE' },
  });
  const port = Number(new URL(server.url).port);
  await server.close();
  const restarted = await serve({
    port,
  });
  expect(
    (
      await fetch(restarted.connection.endpoint + '/runtime/register', {
        method: 'POST',
        headers: target.headers,
        body: '{}',
      })
    ).status,
  ).toBe(401);
  expect(restarted.connection.sessionId).not.toBe(server.connection.sessionId);
  const reconnected = await browser(restarted);
  expect(
    await reconnected.request('Runtime.getTargets').response,
  ).toMatchObject({ result: [] });
});

it('closes subscriptions, in-flight commands and descriptors on abort', async () => {
  const controller = new AbortController();
  const server = await serve({ signal: controller.signal });
  const target = await native(server);
  const client = await browser(server);
  await client.request('Events.subscribe', target.id, {
    events: ['UI.treeChanged'],
  }).response;
  await target.poll();
  const command = client.request('UI.getTree', target.id);
  await target.poll();
  const closed = new Promise<void>((resolve) =>
    client.socket.once('close', () => resolve()),
  );
  controller.abort();
  await server.close();
  await closed;
  expect(await command.response).toMatchObject({
    error: { code: 'TARGET_GONE' },
  });
  await expect(stat(server.descriptorPath)).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('forwards mapped pipeline logs at session scope without inventing target attribution', async () => {
  const server = await serve();
  const client = await browser(server);
  server.publishLog({
    level: 'error',
    source: 'Plugin',
    message: 'at src/App.tsx:12:3',
  });
  expect(
    await client.take((message) => message.event === 'Console.message'),
  ).toMatchObject({
    scope: 'session',
    data: { level: 'error', message: 'at src/App.tsx:12:3' },
  });
});

it('authorizes browsers only with protected keys or one-use tickets', async () => {
  const server = await serve();
  const foreign = await serve();
  const { browserKey } = JSON.parse(
    await readFile(server.descriptorPath, 'utf8'),
  );
  const authenticate = (endpoint: string, origin: string, key: string) =>
    fetch(endpoint + '/browser/auth', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  expect(
    await (await fetch(server.connection.endpoint + '/browser/session')).json(),
  ).toEqual({ authenticated: false });
  expect(
    (
      await authenticate(
        server.connection.endpoint,
        server.url,
        server.connection.token,
      )
    ).status,
  ).toBe(401);
  expect(
    (await authenticate(foreign.connection.endpoint, foreign.url, browserKey))
      .status,
  ).toBe(401);
  expect(
    (
      await authenticate(
        server.connection.endpoint,
        'http://evil.test',
        browserKey,
      )
    ).status,
  ).toBe(403);
  const ticket = new URLSearchParams(
    new URL(server.browserLaunchUrl()).hash.slice(1),
  ).get('connect')!;
  const result = await authenticate(
    server.connection.endpoint,
    server.url,
    ticket,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('set-cookie')).toContain(
    'HttpOnly; SameSite=Strict',
  );
  expect(
    (await authenticate(server.connection.endpoint, server.url, ticket)).status,
  ).toBe(401);
  expect(
    (await authenticate(server.connection.endpoint, server.url, browserKey))
      .status,
  ).toBe(200);
});

it('bounds HTTP bodies, rejects malformed JSON and authenticates before parsing', async () => {
  const server = await serve();
  const url = server.connection.endpoint + '/runtime/register';
  const headers = {
    Authorization: `Bearer ${server.connection.token}`,
    'X-Soundor-Session': server.connection.sessionId,
  };
  for (const contentType of [
    'application/json',
    'text/plain',
    'application/octet-stream',
  ]) {
    for (const body of ['{', '"' + 'x'.repeat(MAX_MESSAGE_BYTES) + '"']) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Invalid or oversized request',
      });
    }
  }
  const rejected = await fetch(url, { method: 'POST', body: '{' });
  expect(rejected.status).toBe(401);
  const foreign = await fetch(server.connection.endpoint + '/browser/auth', {
    method: 'POST',
    headers: { Origin: 'http://evil.test' },
    body: '{',
  });
  expect(foreign.status).toBe(403);
  // A parse failure must not poison the listener or the next runtime session.
  await native(server);
});
