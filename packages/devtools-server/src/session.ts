import { randomUUID } from 'node:crypto';

import {
  CAPTURE_TTL_MS,
  MAX_CAPTURES,
  MAX_MESSAGE_BYTES,
  methodCapability,
  requiresControl,
  runtimeEventSchema,
  type DebugError,
  type DebugRequest,
  type DebugTarget,
  type EventName,
  type RuntimeCommand,
  type RuntimeEvent,
} from '@soundor/devtools-protocol';
import type { FastifyReply } from 'fastify';
import { WebSocket } from 'ws';

import type { DevToolsServer, DevToolsServerOptions } from './types';

const MAX_PENDING = 64;
const MAX_QUEUE = 128;

export interface Browser {
  id: string;
  socket: WebSocket;
  negotiated: boolean;
  lastHeartbeat: number;
  subscriptions: Map<string, Set<EventName>>;
}
export interface Target {
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
  /** Capture.screenshot: the PNG the runtime uploaded before answering. */
  capture?: Buffer;
}
/** A capture a client reads over HTTP until it expires or is deleted. */
export interface Capture {
  data: Buffer;
  browser: string;
  target: string;
  expires: number;
}
// Captures being made at once: each may hold MAX_CAPTURE_BYTES.
const MAX_PENDING_CAPTURES = 2;

/** Session protocol state, shared by the browser and runtime transports. */
export function createSession(options: DevToolsServerOptions) {
  const targets = new Map<string, Target>();
  const browsers = new Map<string, Browser>();
  const pending = new Map<string, Pending>();
  const captures = new Map<string, Capture>();
  function dropCaptures(match: (capture: Capture) => boolean): void {
    for (const [id, capture] of captures)
      if (match(capture)) captures.delete(id);
  }
  /** Keeps a finished capture, the oldest going first beyond the bound. */
  function storeCapture(operation: Pending, data: Buffer): string {
    dropCaptures((capture) => capture.expires <= Date.now());
    while (captures.size >= MAX_CAPTURES)
      captures.delete(captures.keys().next().value!);
    const id = randomUUID();
    captures.set(id, {
      data,
      browser: operation.browser.id,
      target: operation.target.info.id,
      expires: Date.now() + CAPTURE_TTL_MS,
    });
    return id;
  }
  const commandTimeout = options.commandTimeout ?? 5000;
  const heartbeatTimeout = options.heartbeatTimeout ?? 30000;
  const targetTimeout = options.targetTimeout ?? 60000;
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
    poll.response.code(200).send({ commands: target.queue.splice(0, 32) });
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
    dropCaptures((capture) => capture.target === target.info.id);
    if (target.poll) {
      clearTimeout(target.poll.timer);
      target.poll.response.code(410).send({ error: 'Target disconnected' });
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
    dropCaptures((capture) => capture.browser === browser.id);
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
      request.method === 'Capture.screenshot' &&
      [...pending.values()].filter(
        (operation) => operation.request.method === 'Capture.screenshot',
      ).length >= MAX_PENDING_CAPTURES
    ) {
      reply(browser, request, undefined, {
        code: 'BUSY',
        message: 'Other captures are being made; retry after they finish',
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

  function publishLog(entry: Parameters<DevToolsServer['publishLog']>[0]) {
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
  }

  return {
    targets,
    browsers,
    pending,
    captures,
    storeCapture,
    send,
    broadcastTargets,
    flush,
    finish,
    cancel,
    disconnect,
    dropBrowser,
    browserRequest,
    publish,
    publishLog,
    heartbeatInterval: Math.min(10000, heartbeatTimeout / 3, targetTimeout / 3),
    tick(now: number) {
      dropCaptures((capture) => capture.expires <= now);
      for (const browser of browsers.values()) {
        if (now - browser.lastHeartbeat > heartbeatTimeout) {
          dropBrowser(browser);
          browser.socket.terminate();
        } else browser.socket.ping();
      }
      for (const target of targets.values())
        if (now - target.lastSeen > targetTimeout) disconnect(target);
    },
    close() {
      captures.clear();
      for (const target of [...targets.values()]) disconnect(target);
      for (const browser of browsers.values()) browser.socket.terminate();
      browsers.clear();
    },
  };
}
export type Session = ReturnType<typeof createSession>;
