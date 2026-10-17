import { randomUUID } from 'node:crypto';

import {
  PROTOCOL_VERSION,
  responseSchema,
  type DebugMethod,
  type DebugResponse,
} from '@soundor/devtools-protocol';
import { WebSocket } from 'ws';

import type { DevToolsServer } from '../server';

/** Real authenticated observer/controller for development scenarios and tests. */
export async function startSimulatedBrowser(server: DevToolsServer) {
  const key = new URLSearchParams(
    new URL(server.browserLaunchUrl()).hash.slice(1),
  ).get('connect');
  const auth = await fetch(server.connection.endpoint + '/browser/auth', {
    method: 'POST',
    headers: { Origin: server.url },
    body: JSON.stringify({ key }),
  });
  if (!auth.ok) throw new Error('Browser bootstrap failed');
  const cookie = auth.headers.get('set-cookie')!.split(';')[0]!;
  const socket = new WebSocket(
    server.connection.endpoint.replace('http:', 'ws:') + '/browser',
    {
      origin: server.url,
      headers: { Cookie: cookie },
    },
  );
  const pending = new Map<
    string,
    {
      resolve: (response: DebugResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      cleanup(): void;
    }
  >();
  const events: unknown[] = [];
  socket.on('message', (raw) => {
    const value: unknown = JSON.parse(raw.toString());
    const response = responseSchema.safeParse(value);
    if (!response.success) {
      events.push(value);
      return;
    }
    const entry = pending.get(response.data.id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.cleanup();
      pending.delete(response.data.id);
      entry.resolve(response.data);
    }
  });
  const closed = () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.cleanup();
      entry.reject(new Error('Browser disconnected'));
    }
    pending.clear();
  };
  socket.on('close', closed);
  socket.on('error', closed);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION }));
  return {
    events,
    /** An HTTP request with this browser's session cookie and Origin (overridable). */
    fetch(path: string, init: RequestInit = {}) {
      return fetch(server.connection.endpoint + path, {
        ...init,
        headers: {
          Origin: server.url,
          Cookie: cookie,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    },
    request(
      method: DebugMethod,
      targetId?: string,
      params: unknown = {},
      signal?: AbortSignal,
    ): Promise<DebugResponse> {
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const cancel = () => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'cancel', id }));
        };
        pending.set(id, {
          cleanup: () => signal?.removeEventListener('abort', cancel),
          resolve,
          reject,
          timer: setTimeout(() => {
            pending.delete(id);
            signal?.removeEventListener('abort', cancel);
            reject(new Error('Browser request timed out'));
          }, 7000),
        });
        socket.send(
          JSON.stringify({ type: 'request', id, method, targetId, params }),
        );
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((resolve) => {
        socket.once('close', resolve);
        socket.terminate();
      });
    },
  };
}
