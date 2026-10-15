import type { ServerMessage } from '@soundor/devtools-protocol';

import type { InspectorState } from './state';
export function createBrowserSession(options: {
  win: Window & typeof globalThis;
  state: InspectorState;
  onMessage(message: ServerMessage): void;
  onDisconnect(): void;
  report(message: string): void;
}) {
  const { win, state, onMessage, onDisconnect, report } = options;
  const auth = win.document.getElementById('auth') as HTMLFormElement;
  const keyInput = win.document.getElementById('key') as HTMLInputElement;
  const status = win.document.getElementById('status')!;
  let socket: WebSocket | undefined;
  let disposed = false;
  let reconnectTimer = 0;
  function fail(error: unknown) {
    report(error instanceof Error ? error.message : String(error));
  }
  async function checkSession() {
    if (disposed || socket || !auth.hidden) return;
    try {
      const response = await win.fetch('/browser/session');
      if (response.ok && (await response.json()).authenticated) connect();
      else {
        auth.hidden = false;
        status.textContent = 'Authorization required';
      }
    } catch {
      status.textContent = 'Session unavailable · reconnecting';
      scheduleReconnect();
    }
  }
  function scheduleReconnect() {
    win.clearTimeout(reconnectTimer);
    if (!disposed)
      reconnectTimer = win.setTimeout(() => {
        auth.hidden = true;
        void checkSession();
      }, 1500);
  }
  function connect() {
    if (disposed || socket) return;
    const ws = new win.WebSocket(
      win.location.origin.replace(/^http/, 'ws') + '/browser',
    );
    socket = ws;
    status.textContent = 'Connecting…';
    ws.onmessage = (event) => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 1024 * 1024)
          throw new Error('Oversized protocol message');
        onMessage(JSON.parse(event.data));
      } catch (error) {
        fail(error);
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      state.connected = false;
      state.clientId = '';
      onDisconnect();
      status.textContent = 'Disconnected · reconnecting';
      auth.hidden = true;
      scheduleReconnect();
    };
    ws.onerror = () => {
      status.textContent = 'Connection failed · reconnecting';
    };
  }
  async function authorize(key: string) {
    try {
      const response = await win.fetch('/browser/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
        }),
      });
      if (!response.ok) throw new Error('Invalid or expired browser key');
      auth.hidden = true;
      report('');
      connect();
    } catch (error) {
      auth.hidden = false;
      fail(error);
    }
  }
  auth.onsubmit = (event) => {
    event.preventDefault();
    const key = keyInput.value;
    keyInput.value = '';
    void authorize(key);
  };

  return {
    get socket() {
      return socket;
    },
    start() {
      const ticket = new URLSearchParams(win.location.hash.slice(1)).get(
        'connect',
      );
      win.history.replaceState(null, '', win.location.pathname);
      if (ticket) void authorize(ticket);
      else {
        auth.hidden = true;
        void checkSession();
      }
    },
    dispose() {
      disposed = true;
      win.clearTimeout(reconnectTimer);
      socket?.close();
      socket = undefined;
    },
  };
}
