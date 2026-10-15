import type {
  DebugMethod,
  DebugResponse,
  Params,
  MethodResults,
} from '@soundor/devtools-protocol';

/** Request correlation, cancellation and bounded lifetimes over the live socket. */
export function createConnectionRequests(options: {
  win: {
    setTimeout(handler: () => void, timeout: number): number;
    clearTimeout(id: number): void;
  };
  getSocket: () =>
    | { readonly readyState: number; send(data: string): void }
    | undefined;
  getTargetId: () => string;
  isConnected: () => boolean;
}) {
  const { win, getSocket, getTargetId, isConnected } = options;
  let requestSequence = 0;
  const pending: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: number;
      targetId: string | undefined;
    }
  > = new Map();
  function request<M extends DebugMethod>(
    method: M,
    params: Params<M>,
    id: string | undefined = getTargetId() || undefined,
  ): Promise<MethodResults[M]> {
    const socket = getSocket();
    return new Promise<MethodResults[M]>((resolve, reject) => {
      if (!isConnected() || socket?.readyState !== 1) {
        reject(new Error('Development session is disconnected'));
        return;
      }
      const requestId = String(++requestSequence);
      const timer = win.setTimeout(() => {
        pending.delete(requestId);
        getSocket()?.send(JSON.stringify({ type: 'cancel', id: requestId }));
        reject(
          new Error(`${method} timed out; refresh or reconnect the runtime`),
        );
      }, 7000);
      pending.set(requestId, {
        resolve: (value) => resolve(value as MethodResults[M]),
        reject,
        timer,
        targetId: id,
      });
      socket.send(
        JSON.stringify({
          type: 'request',
          id: requestId,
          targetId: id,
          method,
          params,
        }),
      );
    });
  }

  function cancelRequests(id: string | undefined) {
    const socket = getSocket();
    for (const [requestId, entry] of pending) {
      if (id && entry.targetId !== id) continue;
      win.clearTimeout(entry.timer);
      pending.delete(requestId);
      if (socket?.readyState === 1)
        socket.send(JSON.stringify({ type: 'cancel', id: requestId }));
      entry.reject(new Error('Inspection changed or connection closed'));
    }
  }

  function settle(message: DebugResponse) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    win.clearTimeout(entry.timer);
    if (message.error)
      entry.reject(
        new Error(`${message.error.code}: ${message.error.message}`),
      );
    else entry.resolve(message.result);
  }
  return { request, cancelRequests, settle };
}
