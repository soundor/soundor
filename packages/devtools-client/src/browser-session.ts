import type { ServerMessage } from '@soundor/devtools-protocol';

import type { InspectorState } from './state';
export function createBrowserSession(options: {
  win: Window & typeof globalThis;
  state: InspectorState;
  onMessage(message: ServerMessage): void;
  onDisconnect(): void;
  report(message: string): void;
  isAuthorizing(): boolean;
  setAuthRequired(value: boolean): void;
  setStatus(value: string): void;
}) {
  const { win, state, onMessage, onDisconnect, report } = options;
  const { isAuthorizing, setAuthRequired, setStatus } = options;
  let socket: WebSocket | undefined;
  let disposed = false;
  let reconnectTimer = 0;
  function fail(error: unknown) {
    report(error instanceof Error ? error.message : String(error));
  }
  async function checkSession() {
    if (disposed || socket || isAuthorizing()) return;
    try {
      const response = await win.fetch('/browser/session');
      if (response.ok && (await response.json()).authenticated) connect();
      else {
        setAuthRequired(true);
        setStatus('Authorization required');
      }
    } catch {
      setStatus('Session unavailable · reconnecting');
      scheduleReconnect();
    }
  }
  function scheduleReconnect() {
    win.clearTimeout(reconnectTimer);
    if (!disposed)
      reconnectTimer = win.setTimeout(() => {
        setAuthRequired(false);
        void checkSession();
      }, 1500);
  }
  function connect() {
    if (disposed || socket) return;
    const ws = new win.WebSocket(
      win.location.origin.replace(/^http/, 'ws') + '/browser',
    );
    socket = ws;
    setStatus('Connecting…');
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
      setStatus('Disconnected · reconnecting');
      setAuthRequired(false);
      scheduleReconnect();
    };
    ws.onerror = () => {
      setStatus('Connection failed · reconnecting');
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
      setAuthRequired(false);
      report('');
      connect();
    } catch (error) {
      setAuthRequired(true);
      fail(error);
    }
  }

  return {
    authorize,
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
        setAuthRequired(false);
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
