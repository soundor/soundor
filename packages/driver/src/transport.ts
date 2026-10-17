import {
  MAX_CAPTURE_BYTES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  errorSchema,
  eventNameSchema,
  eventPayloads,
  methodParams,
  methodResults,
  responseSchema,
  targetSchema,
  type DebugMethod,
  type DebugTarget,
  type EventName,
  type MethodResults,
  type Params,
} from '@soundor/devtools-protocol';
import { WebSocket, type RawData } from 'ws';
import { z } from 'zod';

import { DriverError, fromProtocolError } from './errors';
import type { SessionCredentials } from './session';

/** Per-call limits: how long to wait, and a signal that cancels the call. */
export interface CallOptions {
  /** Milliseconds before the call fails with TIMEOUT. */
  timeout?: number;
  signal?: AbortSignal;
}

export interface RuntimeEventMessage {
  targetId: string;
  event: EventName;
  data: unknown;
}

interface Pending {
  method: DebugMethod;
  resolve(value: unknown): void;
  reject(error: DriverError): void;
  settle(): void;
}

const helloSchema = z.object({
  type: z.literal('hello'),
  version: z.number(),
  clientId: z.string().min(1),
  project: z.string(),
});
const targetsSchema = z.object({
  type: z.literal('event'),
  event: z.literal('Runtime.targetsChanged'),
  data: z.array(targetSchema).max(64),
});
const runtimeEventSchema = z.object({
  type: z.literal('event'),
  event: eventNameSchema,
  targetId: z.string().optional(),
  data: z.unknown(),
});
const serverErrorSchema = z.object({
  type: z.literal('error'),
  error: errorSchema,
});

function aborted(signal: AbortSignal | undefined, what: string): DriverError {
  return signal?.reason instanceof DriverError
    ? signal.reason
    : new DriverError('CANCELLED', `${what} was cancelled`);
}

/** Exchanges the browser key for this session's control-client cookie. */
async function signIn(
  { endpoint, browserKey }: SessionCredentials,
  signal: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL('/browser/auth', endpoint), {
      method: 'POST',
      headers: { Origin: endpoint.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: browserKey }),
      redirect: 'error',
      signal,
    });
    await response.arrayBuffer();
  } catch (error) {
    if (signal.aborted) throw aborted(signal, 'Connecting');
    throw new DriverError(
      'SERVER_UNAVAILABLE',
      `No DevTools server answers at ${endpoint.origin}: is soundor dev running, with DevTools enabled?`,
      { cause: error },
    );
  }
  if (response.status === 401)
    throw new DriverError(
      'AUTHENTICATION_FAILED',
      `The DevTools server at ${endpoint.origin} rejected the browser key: it belongs to another session, or the session restarted`,
    );
  if (response.status === 503)
    throw new DriverError(
      'SERVER_UNAVAILABLE',
      `The DevTools session at ${endpoint.origin} is closing`,
    );
  if (!response.ok)
    throw new DriverError(
      'AUTHENTICATION_FAILED',
      `The DevTools server at ${endpoint.origin} refused to sign in this client (HTTP ${response.status})`,
    );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0]!.trim())
    .find((value) => value.startsWith('soundor_'));
  if (!cookie)
    throw new DriverError(
      'PROTOCOL',
      `The server at ${endpoint.origin} is not a Soundor DevTools server`,
    );
  return cookie;
}

/**
 * One authenticated control-client connection to a DevTools session: the
 * same `/browser` transport, cookie and Origin checks the dashboard uses.
 */
export class Connection {
  readonly #socket: WebSocket;
  // The session cookie and where it goes: for the session's HTTP resources
  // (captures). Never exposed.
  readonly #cookie: string;
  readonly #endpoint: URL;
  readonly #pending = new Map<string, Pending>();
  readonly #targetListeners = new Set<(targets: DebugTarget[]) => void>();
  readonly #eventListeners = new Set<(event: RuntimeEventMessage) => void>();
  readonly #closeListeners = new Set<(error: DriverError) => void>();
  #sequence = 0;
  #closed: DriverError | undefined;
  #closing: Promise<void> | undefined;
  /** This client's ID: the `controller` of targets it controls. */
  readonly clientId: string;
  /** The project directory of the session. */
  readonly project: string;
  /** The targets as the server last announced them. */
  targets: DebugTarget[] = [];

  private constructor(
    socket: WebSocket,
    hello: { clientId: string; project: string },
    cookie: string,
    endpoint: URL,
  ) {
    this.#socket = socket;
    this.#cookie = cookie;
    this.#endpoint = endpoint;
    this.clientId = hello.clientId;
    this.project = hello.project;
  }

  static async open(
    credentials: SessionCredentials,
    { timeout = 10000, signal }: CallOptions = {},
  ): Promise<Connection> {
    const limit = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(signal ? [signal] : []),
    ]);
    const failure = () =>
      signal?.aborted
        ? aborted(signal, 'Connecting')
        : new DriverError(
            'TIMEOUT',
            `Connecting to DevTools at ${credentials.endpoint.origin} took over ${timeout} ms`,
          );
    if (limit.aborted) throw failure();
    const cookie = await signIn(credentials, limit).catch((error: unknown) => {
      throw limit.aborted && !(error instanceof DriverError)
        ? failure()
        : error;
    });
    const { origin, host } = credentials.endpoint;
    const socket = new WebSocket(`ws://${host}/browser`, {
      origin,
      headers: { Cookie: cookie },
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      followRedirects: false,
    });
    return new Promise<Connection>((resolve, reject) => {
      const fail = (error: DriverError) => {
        cleanup();
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.terminate();
        reject(error);
      };
      const onAbort = () => fail(failure());
      const cleanup = () => limit.removeEventListener('abort', onAbort);
      limit.addEventListener('abort', onAbort, { once: true });
      socket.once('unexpected-response', (_request, response) => {
        fail(
          new DriverError(
            'AUTHENTICATION_FAILED',
            response.statusCode === 403
              ? `The DevTools server at ${origin} refused the connection: the sign-in expired, or 32 clients are already connected`
              : `The DevTools server at ${origin} refused the connection (HTTP ${response.statusCode})`,
          ),
        );
      });
      socket.on('error', (error) =>
        fail(
          new DriverError(
            'SERVER_UNAVAILABLE',
            `The DevTools connection to ${origin} failed`,
            { cause: error },
          ),
        ),
      );
      socket.once('close', () =>
        fail(
          new DriverError(
            'DISCONNECTED',
            `The DevTools server at ${origin} closed the connection`,
          ),
        ),
      );
      socket.once('message', (raw) => {
        const hello = helloSchema.safeParse(parse(raw));
        if (!hello.success || hello.data.version !== PROTOCOL_VERSION) {
          fail(
            new DriverError(
              'PROTOCOL',
              `The DevTools server at ${origin} speaks another protocol version; use matching Soundor packages`,
            ),
          );
          return;
        }
        socket.send(
          JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION }),
        );
        cleanup();
        socket.removeAllListeners();
        const connection = new Connection(
          socket,
          hello.data,
          cookie,
          credentials.endpoint,
        );
        // Synchronously: the targets the server sends next reach it.
        connection.#listen();
        resolve(connection);
      });
    });
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  #listen(): void {
    const socket = this.#socket;
    socket.on('message', (raw) => this.#receive(raw));
    socket.on('error', () => {});
    socket.on('close', () =>
      this.#shutdown(
        new DriverError(
          'DISCONNECTED',
          'The DevTools server closed the connection: the development session ended or restarted',
        ),
      ),
    );
  }

  #receive(raw: RawData): void {
    const value = parse(raw);
    const response = responseSchema.safeParse(value);
    if (response.success) {
      const entry = this.#pending.get(response.data.id);
      if (!entry) return;
      this.#pending.delete(response.data.id);
      entry.settle();
      if (response.data.error)
        entry.reject(fromProtocolError(response.data.error, entry.method));
      else {
        const result = methodResults[entry.method].safeParse(
          response.data.result,
        );
        if (result.success) entry.resolve(result.data);
        else
          entry.reject(
            new DriverError(
              'PROTOCOL',
              `${entry.method}: the server sent an invalid result`,
            ),
          );
      }
      return;
    }
    const targets = targetsSchema.safeParse(value);
    if (targets.success) {
      this.targets = targets.data.data;
      for (const listener of this.#targetListeners) listener(targets.data.data);
      return;
    }
    const event = runtimeEventSchema.safeParse(value);
    if (event.success) {
      const { targetId, data } = event.data;
      if (targetId && eventPayloads[event.data.event].safeParse(data).success)
        for (const listener of this.#eventListeners)
          listener({ targetId, event: event.data.event, data });
      return;
    }
    // An error the server could not tie to a request: requests are validated
    // before sending, so this means mismatched packages.
    if (serverErrorSchema.safeParse(value).success)
      this.#shutdown(
        new DriverError(
          'PROTOCOL',
          'The DevTools server rejected a message; use matching Soundor packages',
        ),
      );
  }

  /** Sends a typed request and waits for its validated result. */
  request<M extends DebugMethod>(
    method: M,
    params: Params<M>,
    targetId: string | undefined,
    { timeout = 10000, signal }: CallOptions = {},
  ): Promise<MethodResults[M]> {
    if (this.#closed) return Promise.reject(this.#closed);
    if (signal?.aborted) return Promise.reject(aborted(signal, method));
    if (!methodParams[method].safeParse(params).success)
      return Promise.reject(
        new DriverError('INVALID_OPTIONS', `${method}: invalid parameters`),
      );
    const id = `driver-${++this.#sequence}`;
    const message = JSON.stringify({
      type: 'request',
      id,
      ...(targetId === undefined ? {} : { targetId }),
      method,
      params,
    });
    if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES)
      return Promise.reject(
        new DriverError('INVALID_OPTIONS', `${method}: the request is too big`),
      );
    return new Promise<MethodResults[M]>((resolve, reject) => {
      const cancel = (error: DriverError) => {
        if (!this.#pending.delete(id)) return;
        settle();
        // The server stops waiting and tells the instance to drop the work.
        if (this.#socket.readyState === WebSocket.OPEN)
          this.#socket.send(JSON.stringify({ type: 'cancel', id }));
        reject(error);
      };
      const timer = setTimeout(
        () =>
          cancel(
            new DriverError(
              'TIMEOUT',
              `${method} did not finish within ${timeout} ms`,
            ),
          ),
        timeout,
      );
      const onAbort = () => cancel(aborted(signal, method));
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        method,
        resolve: (value) => resolve(value as MethodResults[M]),
        reject,
        settle,
      });
      this.#socket.send(message);
    });
  }

  /**
   * Reads a capture the server keeps (`GET /browser/captures/<id>`, with the
   * session cookie), then deletes it there.
   */
  async readCapture(
    id: string,
    { timeout = 10000, signal }: CallOptions = {},
  ): Promise<Uint8Array> {
    if (this.#closed) throw this.#closed;
    const url = new URL(
      `/browser/captures/${encodeURIComponent(id)}`,
      this.#endpoint,
    );
    const headers = { Origin: this.#endpoint.origin, Cookie: this.#cookie };
    const limit = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(signal ? [signal] : []),
    ]);
    let response: Response;
    let bytes: ArrayBuffer;
    try {
      response = await fetch(url, {
        headers,
        redirect: 'error',
        signal: limit,
      });
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (signal?.aborted) throw aborted(signal, 'Reading the capture');
      if (limit.aborted)
        throw new DriverError(
          'TIMEOUT',
          `Reading the capture took over ${timeout} ms`,
        );
      throw new DriverError(
        'SERVER_UNAVAILABLE',
        'The DevTools server did not deliver the capture',
        { cause: error },
      );
    }
    if (!response.ok || bytes.byteLength > MAX_CAPTURE_BYTES)
      throw new DriverError(
        'SCREENSHOT_UNAVAILABLE',
        response.status === 404
          ? 'The capture expired before it was read'
          : `The DevTools server refused the capture (HTTP ${response.status})`,
      );
    // Read once: free the server's copy (it would expire anyway).
    await fetch(url, { method: 'DELETE', headers, redirect: 'error' })
      .then((done) => done.arrayBuffer())
      .catch(() => {});
    return new Uint8Array(bytes);
  }

  onTargets(listener: (targets: DebugTarget[]) => void): () => void {
    this.#targetListeners.add(listener);
    return () => this.#targetListeners.delete(listener);
  }

  onEvent(listener: (event: RuntimeEventMessage) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onClose(listener: (error: DriverError) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  #shutdown(error: DriverError): void {
    if (this.#closed) return;
    this.#closed = error;
    for (const entry of this.#pending.values()) {
      entry.settle();
      entry.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#closeListeners) listener(error);
    this.#targetListeners.clear();
    this.#eventListeners.clear();
    this.#closeListeners.clear();
    if (this.#socket.readyState !== WebSocket.CLOSED) this.#socket.terminate();
  }

  /** Closes the connection; the server releases whatever it controlled. */
  close(): Promise<void> {
    this.#closing ??= new Promise<void>((resolve) => {
      if (this.#socket.readyState === WebSocket.CLOSED) resolve();
      else this.#socket.once('close', () => resolve());
      this.#shutdown(
        new DriverError('DISCONNECTED', 'The Driver was disconnected'),
      );
    });
    return this.#closing;
  }
}

function parse(raw: RawData): unknown {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
}
