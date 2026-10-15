import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import websocketPlugin from '@fastify/websocket';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  cancelSchema,
  helloSchema,
  methodCapability,
  methodResults,
  registrationSchema,
  requestSchema,
  requiresControl,
  responseSchema,
  runtimeEventSchema,
  type DebugError,
  type Capability,
  type DebugRequest,
  type DebugTarget,
  type EventName,
  type RuntimeCommand,
  type RuntimeEvent,
} from '@soundor/devtools-protocol';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';

import { serveStatic } from './static';

const MAX_CLIENTS = 32;
const MAX_TARGETS = 64;
const MAX_PENDING = 64;
const MAX_QUEUE = 128;

interface Browser {
  id: string;
  socket: WebSocket;
  negotiated: boolean;
  lastHeartbeat: number;
  subscriptions: Map<string, Set<EventName>>;
}
interface Target {
  info: DebugTarget;
  token: string;
  lastSeen: number;
  queue: RuntimeCommand[];
  poll?: { response: FastifyReply; timer: ReturnType<typeof setTimeout> };
  interactive?: string;
}
interface Pending {
  browser: Browser;
  target: Target;
  request: DebugRequest;
  timer: ReturnType<typeof setTimeout>;
}

export interface DevToolsServerOptions {
  projectRoot: string;
  port?: number;
  /** Try following ports on collision. The CLI enables this for its default port. */
  portFallback?: boolean;
  /** Omit to run the complete backend without a frontend. */
  staticDir?: string;
  /** Explicit loopback frontend origin, for a local development proxy only. */
  developmentOrigin?: string;
  signal?: AbortSignal;
  commandTimeout?: number;
  heartbeatTimeout?: number;
  targetTimeout?: number;
  onTarget?: (target: DebugTarget) => void;
  /** Static runtime declaration; connected instances may negotiate a subset. */
  supportedCapabilities?: readonly Capability[];
}
export interface DevToolsConnection {
  readonly endpoint: string;
  readonly sessionId: string;
  readonly token: string;
  readonly descriptorPath?: string;
}
export interface DevToolsServer {
  readonly url: string;
  readonly connection: DevToolsConnection;
  readonly descriptorPath: string;
  /** One-use browser bootstrap ticket; never print this URL in logs. */
  browserLaunchUrl(): string;
  publishLog(entry: {
    level: 'debug' | 'info' | 'warn' | 'error';
    source: string;
    message: string;
  }): void;
  close(): Promise<void>;
}

export class DevToolsPortError extends Error {}

function secret(): string {
  return randomBytes(32).toString('hex');
}
function matches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const bytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    bytes.length === expectedBytes.length &&
    timingSafeEqual(bytes, expectedBytes)
  );
}
function json(response: FastifyReply, status: number, value: unknown): void {
  if (!response.raw.destroyed && !response.sent) {
    response.code(status).header('Cache-Control', 'no-store').send(value);
  }
}

/** One session, one loopback HTTP port. All native I/O is asynchronous IPC. */
export async function startDevToolsServer(
  options: DevToolsServerOptions,
): Promise<DevToolsServer> {
  if (options.developmentOrigin) {
    const origin = new URL(options.developmentOrigin);
    if (
      origin.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(origin.hostname) ||
      origin.origin !== options.developmentOrigin
    )
      throw new Error(
        'developmentOrigin must be an exact HTTP loopback origin',
      );
  }
  const sessionId = randomUUID();
  const token = secret();
  const browserToken = secret();
  const browserKey = secret();
  const browserTickets = new Map<string, number>();
  const cookieName = `soundor_${sessionId.replaceAll('-', '')}`;
  const targets = new Map<string, Target>();
  const browsers = new Map<string, Browser>();
  const pending = new Map<string, Pending>();
  const commandTimeout = options.commandTimeout ?? 5000;
  const heartbeatTimeout = options.heartbeatTimeout ?? 30000;
  const targetTimeout = options.targetTimeout ?? 60000;
  let closing = false;
  let port = options.port ?? 0;
  let descriptorPath = '';
  let descriptorDirectory = '';
  let closePromise: Promise<void> | undefined;
  const app = Fastify({
    bodyLimit: MAX_MESSAGE_BYTES,
    requestTimeout: 25000,
    forceCloseConnections: true,
    exposeHeadRoutes: false,
    routerOptions: {
      onBadUrl: (_path, _request, response) => {
        response.writeHead(404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ error: 'Not found' }));
      },
    },
  });
  const http = app.server;
  http.headersTimeout = 10000;
  http.maxConnections = 128;
  // Native clients and the browser bootstrap also send JSON as text/plain or
  // without a Content-Type. Fastify still bounds and parses these payloads.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, body === '' ? undefined : JSON.parse(body as string));
      } catch (error) {
        done(error as Error);
      }
    },
  );
  app.setErrorHandler((_error, _request, reply) => {
    json(reply, 400, { error: 'Invalid or oversized request' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (closing) return json(reply, 503, { error: 'Session closing' });
    if (!trustedHost(request.raw))
      return json(reply, 403, { error: 'Invalid host' });
  });
  await app.register(websocketPlugin, {
    options: { maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false },
  });

  const origins = (): string[] => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(options.developmentOrigin ? [options.developmentOrigin] : []),
  ];
  function trustedHost(request: IncomingMessage): boolean {
    return [`localhost:${port}`, `127.0.0.1:${port}`].includes(
      request.headers.host ?? '',
    );
  }
  function trustedOrigin(request: IncomingMessage): boolean {
    return (
      typeof request.headers.origin === 'string' &&
      origins().includes(request.headers.origin)
    );
  }
  function authenticatedBrowser(request: IncomingMessage): boolean {
    const value = request.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return matches(value, browserToken);
  }
  function send(browser: Browser, value: unknown): void {
    if (browser.socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify(value);
    if (
      Buffer.byteLength(message) > MAX_MESSAGE_BYTES ||
      browser.socket.bufferedAmount > MAX_MESSAGE_BYTES * 2
    ) {
      browser.socket.terminate();
      return;
    }
    browser.socket.send(message);
  }
  function broadcastTargets(): void {
    const message = {
      type: 'event',
      event: 'Runtime.targetsChanged',
      data: [...targets.values()].map((target) => target.info),
    };
    for (const browser of browsers.values()) send(browser, message);
  }
  function reply(
    browser: Browser,
    request: DebugRequest,
    result: unknown = null,
    error?: DebugError,
  ): void {
    send(browser, {
      type: 'response',
      id: request.id,
      targetId: request.targetId,
      ...(error ? { error } : { result }),
    });
  }
  function flush(target: Target): void {
    if (!target.poll || target.queue.length === 0) return;
    const poll = target.poll;
    target.poll = undefined;
    clearTimeout(poll.timer);
    json(poll.response, 200, { commands: target.queue.splice(0, 32) });
  }
  function enqueue(target: Target, command: RuntimeCommand): boolean {
    if (target.queue.length >= MAX_QUEUE) return false;
    target.queue.push(command);
    flush(target);
    return true;
  }
  function finish(id: string, result?: unknown, error?: DebugError): void {
    const operation = pending.get(id);
    if (!operation) return;
    clearTimeout(operation.timer);
    pending.delete(id);
    if (operation.target.interactive === id)
      operation.target.interactive = undefined;
    operation.target.queue = operation.target.queue.filter(
      (command) => !(command.type === 'request' && command.id === id),
    );
    reply(operation.browser, operation.request, result, error);
  }
  function cancel(id: string, error: DebugError): void {
    const operation = pending.get(id);
    if (!operation) return;
    enqueue(operation.target, { type: 'cancel', id });
    finish(id, undefined, error);
  }
  function subscriptions(target: Target): void {
    const events = new Set<EventName>();
    for (const browser of browsers.values())
      for (const event of browser.subscriptions.get(target.info.id) ?? [])
        events.add(event);
    target.queue = target.queue.filter(
      (command) => command.type !== 'subscribe',
    );
    enqueue(target, { type: 'subscribe', events: [...events] });
  }
  function release(target: Target): void {
    if (!target.info.controller) return;
    const controller = target.info.controller;
    target.info.controller = null;
    for (const [id, operation] of pending)
      if (
        operation.target === target &&
        operation.browser.id === controller &&
        requiresControl(operation.request.method)
      )
        cancel(id, {
          code: 'LEASE_REQUIRED',
          message: 'Control lease released',
        });
    // Reset is a transport command, so cleanup never depends on a browser lease.
    target.queue = target.queue.filter(
      (command) => command.type !== 'resetControl',
    );
    if (!enqueue(target, { type: 'resetControl' })) disconnect(target);
    broadcastTargets();
  }
  function disconnect(target: Target): void {
    if (!targets.delete(target.info.id)) return;
    if (target.poll) {
      clearTimeout(target.poll.timer);
      json(target.poll.response, 410, { error: 'Target disconnected' });
    }
    for (const [id, operation] of pending)
      if (operation.target === target)
        finish(id, undefined, {
          code: 'TARGET_GONE',
          message: 'Runtime disconnected',
        });
    for (const browser of browsers.values())
      browser.subscriptions.delete(target.info.id);
    broadcastTargets();
  }
  function dropBrowser(browser: Browser): void {
    if (!browsers.delete(browser.id)) return;
    for (const [id, operation] of pending)
      if (operation.browser === browser)
        cancel(id, { code: 'CANCELLED', message: 'Browser disconnected' });
    for (const target of targets.values()) {
      if (target.info.controller === browser.id) release(target);
      subscriptions(target);
    }
  }
  function browserRequest(browser: Browser, request: DebugRequest): void {
    if (
      [...pending.values()].some(
        (operation) =>
          operation.browser === browser && operation.request.id === request.id,
      )
    ) {
      reply(browser, request, undefined, {
        code: 'INVALID_REQUEST',
        message: 'Duplicate request ID',
      });
      return;
    }
    if (request.method === 'Runtime.getTargets') {
      reply(
        browser,
        request,
        [...targets.values()].map((target) => target.info),
      );
      return;
    }
    const target = targets.get(request.targetId!);
    if (!target) {
      reply(browser, request, undefined, {
        code: 'TARGET_GONE',
        message: 'Target is not connected to this session',
      });
      return;
    }
    if (request.method === 'Control.acquire') {
      if (target.info.controller && target.info.controller !== browser.id) {
        reply(browser, request, undefined, {
          code: 'LEASE_BUSY',
          message:
            'Another tab controls this target; ask it to release control',
        });
        return;
      }
      target.info.controller = browser.id;
      reply(browser, request, { controller: browser.id });
      broadcastTargets();
      return;
    }
    if (request.method === 'Control.release') {
      if (target.info.controller !== browser.id) {
        reply(browser, request, undefined, {
          code: 'LEASE_REQUIRED',
          message: 'You do not own control',
        });
        return;
      }
      release(target);
      reply(browser, request);
      return;
    }
    if (request.method === 'Events.subscribe') {
      browser.subscriptions.set(
        target.info.id,
        new Set((request.params as { events: EventName[] }).events),
      );
      subscriptions(target);
      reply(browser, request);
      return;
    }
    const capability = methodCapability(request.method);
    if (capability && !target.info.capabilities.includes(capability)) {
      reply(browser, request, undefined, {
        code: 'MISSING_CAPABILITY',
        message: `Target does not support ${capability}`,
      });
      return;
    }
    const ref = (request.params as { node?: { generation: number } }).node;
    if (ref && ref.generation !== target.info.generation) {
      reply(browser, request, undefined, {
        code: 'STALE_NODE',
        message: 'Node belongs to an old runtime generation',
      });
      return;
    }
    if (
      requiresControl(request.method) &&
      target.info.controller !== browser.id
    ) {
      reply(browser, request, undefined, {
        code: 'LEASE_REQUIRED',
        message: 'Acquire control before modifying native debug state',
      });
      return;
    }
    if (
      pending.size >= MAX_PENDING ||
      (requiresControl(request.method) && target.interactive)
    ) {
      reply(browser, request, undefined, {
        code: 'BUSY',
        message: 'Target has outstanding operations; retry after completion',
      });
      return;
    }
    const id = randomUUID();
    pending.set(id, {
      browser,
      target,
      request,
      timer: setTimeout(
        () =>
          cancel(id, { code: 'TIMEOUT', message: 'Runtime command timed out' }),
        commandTimeout,
      ),
    });
    if (requiresControl(request.method)) target.interactive = id;
    if (
      !enqueue(target, { ...request, id, generation: target.info.generation })
    )
      finish(id, undefined, {
        code: 'BUSY',
        message: 'Runtime command queue is full',
      });
  }

  function publish(target: Target, event: RuntimeEvent): void {
    const data = event.data as {
      generation?: number;
      node?: { generation: number };
    };
    if (event.event === 'Runtime.generationChanged') {
      if (!data.generation || data.generation <= target.info.generation) return;
      target.info.generation = data.generation;
      for (const [id, operation] of pending)
        if (operation.target === target)
          cancel(id, { code: 'STALE_NODE', message: 'Runtime reloaded' });
      enqueue(target, { type: 'resetControl' });
      broadcastTargets();
    } else if (
      (data.generation && data.generation !== target.info.generation) ||
      (data.node && data.node.generation !== target.info.generation)
    )
      return;
    for (const browser of browsers.values())
      if (browser.subscriptions.get(target.info.id)?.has(event.event))
        send(browser, { ...event, targetId: target.info.id });
  }

  app.setNotFoundHandler(async (request, response) => {
    const path = request.raw.url?.split('?')[0] ?? '/';
    if (
      (request.headers.origin && !trustedOrigin(request.raw)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return json(response, 403, { error: 'Invalid origin' });
    if (
      !/^\/(runtime|browser|api)(\/|$)/.test(path) &&
      options.staticDir &&
      (await serveStatic(options.staticDir, request, response))
    )
      return;
    json(response, 404, { error: 'Not found' });
  });
  app.post(
    '/browser/auth',
    {
      onRequest: async (request, response) => {
        if (!trustedOrigin(request.raw))
          json(response, 403, { error: 'Invalid origin' });
      },
    },
    async (request, response) => {
      const value = request.body as { key?: unknown };
      const key = typeof value?.key === 'string' ? value.key : undefined;
      const ticket = key ? browserTickets.get(key) : undefined;
      if (!matches(key, browserKey) && !(ticket && ticket > Date.now())) {
        json(response, 401, { error: 'Invalid or expired browser key' });
        return;
      }
      if (key) browserTickets.delete(key);
      response.header(
        'Set-Cookie',
        `${cookieName}=${browserToken}; HttpOnly; SameSite=Strict; Path=/`,
      );
      json(response, 200, null);
      return;
    },
  );
  app.get('/browser/session', async (request, response) => {
    if (request.headers.origin && !trustedOrigin(request.raw)) {
      json(response, 403, { error: 'Invalid origin' });
      return;
    }
    json(response, 200, { authenticated: authenticatedBrowser(request.raw) });
    return;
  });
  async function runtimeAuth(
    request: FastifyRequest,
    response: FastifyReply,
  ): Promise<void> {
    if (
      request.headers.origin ||
      !matches(request.headers.authorization, `Bearer ${token}`) ||
      request.headers['x-soundor-session'] !== sessionId
    ) {
      json(response, 401, { error: 'Runtime authentication required' });
      return;
    }
  }
  app.post(
    '/runtime/register',
    { onRequest: runtimeAuth },
    async (request, response) => {
      const parsed = registrationSchema.safeParse(request.body);
      if (!parsed.success) {
        json(response, 400, {
          error: {
            code: 'PROTOCOL_MISMATCH',
            message: 'Invalid registration or unsupported protocol version',
          },
        });
        return;
      }
      if (parsed.data.sessionId !== sessionId) {
        json(response, 401, { error: 'Wrong session' });
        return;
      }
      if (
        options.supportedCapabilities &&
        parsed.data.capabilities.some(
          (capability) => !options.supportedCapabilities!.includes(capability),
        )
      ) {
        json(response, 400, {
          error: {
            code: 'MISSING_CAPABILITY',
            message: 'Instance capabilities exceed the runtime declaration',
          },
        });
        return;
      }
      if (targets.size >= MAX_TARGETS) {
        json(response, 429, { error: 'Too many runtime instances' });
        return;
      }
      const { version: _version, sessionId: _sessionId, ...info } = parsed.data;
      const target: Target = {
        info: { ...info, id: randomUUID(), controller: null },
        token: secret(),
        lastSeen: Date.now(),
        queue: [],
      };
      targets.set(target.info.id, target);
      json(response, 200, {
        version: PROTOCOL_VERSION,
        targetId: target.info.id,
        targetToken: target.token,
      });
      broadcastTargets();
      options.onTarget?.(target.info);
      return;
    },
  );
  async function targetAuth(
    request: FastifyRequest,
    response: FastifyReply,
  ): Promise<void> {
    await runtimeAuth(request, response);
    if (response.sent) return;
    const id = request.headers['x-soundor-target'];
    const target = typeof id === 'string' ? targets.get(id) : undefined;
    if (
      !target ||
      !matches(
        typeof request.headers['x-soundor-target-token'] === 'string'
          ? request.headers['x-soundor-target-token']
          : undefined,
        target.token,
      )
    ) {
      json(response, 401, { error: 'Target authentication required' });
      return;
    }
    target.lastSeen = Date.now();
  }
  app.get('/runtime/poll', { onRequest: targetAuth }, (request, response) => {
    const target = targets.get(request.headers['x-soundor-target'] as string)!;

    if (target.poll) {
      json(response, 409, { error: 'One poll per target' });
      return;
    }
    target.poll = {
      response,
      timer: setTimeout(() => {
        target.poll = undefined;
        json(response, 200, { commands: [] });
      }, 20000),
    };
    response.raw.on('close', () => {
      if (target.poll?.response === response) {
        clearTimeout(target.poll.timer);
        target.poll = undefined;
        if (!response.raw.writableEnded) disconnect(target);
      }
    });
    flush(target);
    return response;
  });
  app.post(
    '/runtime/messages',
    { onRequest: targetAuth },
    async (request, response) => {
      const target = targets.get(
        request.headers['x-soundor-target'] as string,
      )!;
      const value = request.body;
      const event = runtimeEventSchema.safeParse(value);
      if (event.success) {
        publish(target, event.data);
        json(response, 200, null);
        return;
      }
      const parsed = responseSchema.safeParse(value);
      if (!parsed.success) {
        json(response, 400, { error: 'Invalid runtime message' });
        return;
      }
      const operation = pending.get(parsed.data.id);
      if (!operation || operation.target !== target) {
        json(response, 409, { error: 'Stale or foreign request' });
        return;
      }
      const result = parsed.data.result;
      const resultGeneration =
        result && typeof result === 'object'
          ? 'generation' in result
            ? result.generation
            : 'ref' in result &&
                result.ref &&
                typeof result.ref === 'object' &&
                'generation' in result.ref
              ? result.ref.generation
              : undefined
          : undefined;
      if (parsed.data.targetId && parsed.data.targetId !== target.info.id) {
        json(response, 409, { error: 'Foreign target response' });
        return;
      }
      if (
        resultGeneration !== undefined &&
        resultGeneration !== target.info.generation
      ) {
        finish(parsed.data.id, undefined, {
          code: 'STALE_NODE',
          message: 'Response belongs to an old generation',
        });
      } else if (
        !parsed.data.error &&
        !methodResults[operation.request.method].safeParse(result).success
      ) {
        finish(parsed.data.id, undefined, {
          code: 'INVALID_REQUEST',
          message: 'Invalid runtime result',
        });
      } else finish(parsed.data.id, result, parsed.data.error);
      json(response, 200, null);
      return;
    },
  );
  app.post(
    '/runtime/disconnect',
    { onRequest: targetAuth },
    async (request, response) => {
      const target = targets.get(
        request.headers['x-soundor-target'] as string,
      )!;
      disconnect(target);
      json(response, 200, null);
      return;
    },
  );
  app.route({
    method: 'GET',
    url: '/browser',
    onRequest: async (request, response) => {
      if (
        request.raw.url !== '/browser' ||
        !trustedOrigin(request.raw) ||
        !authenticatedBrowser(request.raw) ||
        browsers.size >= MAX_CLIENTS
      )
        json(response, 403, { error: 'Browser authentication required' });
    },
    handler: async (_request, response) => {
      json(response, 404, { error: 'Not found' });
    },
    wsHandler: (socket) => {
      const browser: Browser = {
        id: randomUUID(),
        socket,
        negotiated: false,
        lastHeartbeat: Date.now(),
        subscriptions: new Map(),
      };
      browsers.set(browser.id, browser);
      send(browser, {
        type: 'hello',
        version: PROTOCOL_VERSION,
        sessionId,
        clientId: browser.id,
        project: options.projectRoot,
      });
      broadcastTargets();
      socket.on('pong', () => {
        if (browser.negotiated) browser.lastHeartbeat = Date.now();
      });
      socket.on('message', (raw) => {
        let value: unknown;
        try {
          value = JSON.parse(raw.toString());
        } catch {
          socket.close(1007, 'Invalid JSON');
          return;
        }
        if (!browser.negotiated) {
          if (!helloSchema.safeParse(value).success) {
            send(browser, {
              type: 'error',
              error: {
                code: 'PROTOCOL_MISMATCH',
                message: 'Send a hello with protocol version 1',
              },
            });
            socket.close(1002, 'Protocol mismatch');
            return;
          }
          browser.negotiated = true;
          return;
        }
        const cancelled = cancelSchema.safeParse(value);
        if (cancelled.success) {
          for (const [id, operation] of pending)
            if (
              operation.browser === browser &&
              operation.request.id === cancelled.data.id
            )
              cancel(id, { code: 'CANCELLED', message: 'Request cancelled' });
          return;
        }
        const parsed = requestSchema.safeParse(value);
        if (!parsed.success) {
          send(browser, {
            type: 'error',
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid method or payload',
            },
          });
          return;
        }
        browserRequest(browser, parsed.data);
      });
      socket.on('error', () => dropBrowser(browser));
      socket.on('close', () => dropBrowser(browser));
    },
  });
  for (;;) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      const address = http.address();
      if (address && typeof address !== 'string') port = address.port;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        await app.close();
        throw error;
      }
      if (!options.portFallback || port >= 65535) {
        await app.close();
        throw new DevToolsPortError(
          `DevTools port ${port} is occupied. Close the other listener or change devtools.port in your Soundor user config.`,
        );
      }
      port++;
    }
  }
  const url = `http://localhost:${port}`;
  http.on('error', () => {
    void close().catch(() => {});
  });
  app.websocketServer.on('error', () => {
    void close().catch(() => {});
  });
  const connection = { endpoint: `http://127.0.0.1:${port}`, sessionId, token };
  const heartbeat = setInterval(
    () => {
      const now = Date.now();
      for (const [key, expires] of browserTickets)
        if (expires <= now) browserTickets.delete(key);
      for (const browser of browsers.values()) {
        if (now - browser.lastHeartbeat > heartbeatTimeout) {
          dropBrowser(browser);
          browser.socket.terminate();
        } else browser.socket.ping();
      }
      for (const target of targets.values())
        if (now - target.lastSeen > targetTimeout) disconnect(target);
    },
    Math.min(10000, heartbeatTimeout / 3, targetTimeout / 3),
  );
  heartbeat.unref();
  async function close(): Promise<void> {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      clearInterval(heartbeat);
      options.signal?.removeEventListener('abort', onAbort);
      for (const target of [...targets.values()]) disconnect(target);
      for (const browser of browsers.values()) browser.socket.terminate();
      browsers.clear();
      browserTickets.clear();
      await app.close();
      if (descriptorDirectory)
        await rm(descriptorDirectory, { recursive: true, force: true });
    })();
    return closePromise;
  }
  function onAbort(): void {
    void close();
  }
  try {
    const directory = await mkdtemp(join(tmpdir(), 'soundor-devtools-'));
    descriptorDirectory = directory;
    if (process.platform !== 'win32') await chmod(directory, 0o700);
    descriptorPath = join(directory, `${sessionId}.json`);
    const file = await open(descriptorPath, 'wx', 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          project: options.projectRoot,
          browserKey,
          ...connection,
        }),
      );
    } finally {
      await file.close();
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) await close();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    url,
    connection: { ...connection, descriptorPath },
    descriptorPath,
    browserLaunchUrl() {
      const key = secret();
      if (browserTickets.size >= 32)
        browserTickets.delete(browserTickets.keys().next().value!);
      browserTickets.set(key, Date.now() + 60000);
      return `${url}/#connect=${key}`;
    },
    close,
    publishLog(entry) {
      const event = runtimeEventSchema.safeParse({
        type: 'event',
        event: 'Console.message',
        data: {
          ...entry,
          timestamp: Date.now(),
          message: entry.message.slice(0, 16384),
          source: entry.source.slice(0, 128) || 'runtime',
        },
      });
      // The existing shared log file lacks instance IDs. Keep these logs at
      // session scope rather than attributing a message to every native target.
      if (event.success)
        for (const browser of browsers.values())
          send(browser, { ...event.data, scope: 'session' });
    },
  };
}
