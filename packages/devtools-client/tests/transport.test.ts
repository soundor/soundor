import { expect, it } from 'vitest';

import { createConnectionRequests } from '../src/connection';

function setup() {
  const timers = new Map<number, () => void>();
  const messages: Array<{ id: string; type: string }> = [];
  let sequence = 0;
  const socket = {
    readyState: 1,
    send(data: string) {
      messages.push(JSON.parse(data));
    },
  };
  const transport = createConnectionRequests({
    win: {
      setTimeout(handler) {
        const id = ++sequence;
        timers.set(id, () => {
          timers.delete(id);
          handler();
        });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    getSocket: () => socket,
    getTargetId: () => 'target',
    isConnected: () => true,
  });
  return { transport, socket, timers, messages };
}
it('correlates responses and ignores stale replies after selection cancellation', async () => {
  const { transport, messages, timers } = setup();
  const response = transport.request('UI.clearHighlight', {});
  transport.settle({
    type: 'response',
    id: messages[0]!.id,
    result: null,
  });
  await expect(response).resolves.toBeNull();
  expect(timers.size).toBe(0);
  const stale = transport.request('UI.getTree', {});
  const rejected = expect(stale).rejects.toThrow('Inspection changed');
  transport.cancelRequests('target');
  await rejected;
  transport.settle({ type: 'response', id: messages[1]!.id, result: null });
  expect(messages.at(-1)?.type).toBe('cancel');
  expect(timers.size).toBe(0);
});
it('rejects protocol errors, disconnected requests and timed out operations', async () => {
  const { transport, socket, messages, timers } = setup();
  const response = transport.request('UI.getTree', {});
  const rejected = expect(response).rejects.toThrow('STALE_NODE: Reloaded');
  transport.settle({
    type: 'response',
    id: messages[0]!.id,
    error: { code: 'STALE_NODE', message: 'Reloaded' },
  });
  await rejected;
  const timeout = transport.request('UI.getTree', {});
  const timedOut = expect(timeout).rejects.toThrow('timed out');
  for (const run of timers.values()) run();
  await timedOut;
  expect(messages.at(-1)?.type).toBe('cancel');
  socket.readyState = 3;
  await expect(transport.request('UI.getTree', {})).rejects.toThrow(
    'disconnected',
  );
  expect(timers.size).toBe(0);
});
