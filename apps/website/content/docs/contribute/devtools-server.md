---
title: 'DevTools server'
description: 'Authenticated HTTP/WebSocket backend, static serving, lifecycle, and testing helpers.'
---

Source: [`packages/devtools-server/`](https://github.com/soundor/soundor/tree/main/packages/devtools-server).

Standalone Fastify HTTP/WebSocket backend for Soundor DevTools. Requires Node
22.18+ or 24.11+. It depends on the shared `@soundor/devtools-protocol` contract,
`fastify`, its static, cookie and WebSocket plugins, and `ws`, and has no dependency on the CLI,
configuration package, or frontend.

```ts
import { startDevToolsServer } from '@soundor/devtools-server';

const server = await startDevToolsServer({
  projectRoot: '/path/to/plugin',
  port: 0, // ephemeral; the default
  // staticDir: '/path/to/any/built/frontend', // omit for headless mode
});
try {
  // Hand server.connection to the native runtime. Treat it as a secret.
  // Open server.browserLaunchUrl() privately; never log its one-use ticket.
} finally {
  await server.close();
}
```

The server exposes `url` (credential-free), `connection` (endpoint, session ID,
token, protected descriptor path), `descriptorPath`, `browserLaunchUrl()`,
`publishLog({level, source, message})`, and idempotent asynchronous `close()`.
Options include `signal`, `commandTimeout`, `heartbeatTimeout`, `targetTimeout`,
`onTarget`, and `supportedCapabilities`. It always binds IPv4 loopback.
Explicit port collisions throw `DevToolsPortError`; `portFallback: true` tries
subsequent ports. The CLI enables fallback only for its default port.

Headless mode retains all runtime and browser protocol routes, authentication,
leases, and session lifecycle. Frontend routes return 404. UI mode serves
regular files beneath `staticDir`, including nested binary assets. Extensionless
navigation falls back to `index.html`; missing assets, API namespaces, hidden
files, private keys, traversal paths, and escaping symlinks return 404.
HTML revalidates; hashed assets can be cached immutably. GET and HEAD are
supported. Fastify handles routing, bounded JSON parsing, replies, WebSocket upgrades, and
listener shutdown. Its static plugin handles streaming, MIME types, HEAD, caching,
conditional and range requests; only public-file selection and SPA fallback
remain explicit server policies. Its cookie plugin parses and serializes browser
session cookies.
The same Host/Origin validation and CSP apply to any supplied UI.

Browser authentication exchanges a protected descriptor key or one-use ticket
for an HttpOnly SameSite=Strict cookie. The launch fragment must be removed from
history by the frontend. Runtime credentials never authenticate browser sockets.
`developmentOrigin` permits one exact HTTP localhost/127.0.0.1 origin for a local
frontend proxy; it does not relax Host validation or allow remote origins.

The implementation separates lifecycle (`server.ts`), credentials and trusted
origins (`authentication.ts`), browser routes/WebSockets (`browser.ts`), runtime
registration and long polling (`runtime.ts`), leases/queues/subscriptions
(`session.ts`), and static delivery/SPA fallback (`static.ts`). Public server
interfaces live in `types.ts` and remain exported from the package entry.

## Testing and simulation

The production entry does not include testing helpers:

```ts
import {
  startSimulatedRuntime,
  startScenario,
} from '@soundor/devtools-server/testing';

const runtime = await startSimulatedRuntime({ connection: server.connection });
await runtime.reload();
await runtime.event('Console.message', {
  level: 'info',
  message: 'Hello',
  source: 'test',
  timestamp: 1,
});
await runtime.close();

// Alternative: a group of runtimes and optional competing controller.
const scenario = await startScenario({
  connection: server.connection,
  server,
  scenario: 'multiple-targets',
});
await scenario.close();
```

The simulator was extracted from the dashboard integration tests. It registers,
polls and responds through the production HTTP endpoints, validating commands
and outgoing messages with shared protocol schemas. It maintains nodes,
generation, picker/highlight state, animations, recording and metrics.
Controls include `setNodes`, `setAnimations`, `setMetrics`, `event`, `reload`,
`disconnect`, `delayNode`, `setCommandDelay(method, milliseconds)`, and an
`errors` map. Delays occur before a command changes state; production cancel
commands interrupt them. Injected errors return without applying changes.
`pendingRequests` reports in-flight simulated work. `methods`, `commands`,
`treeRequests` and `failure` expose deterministic observations. Tree roots are
derived from the nodes supplied to `setNodes`, including empty trees and multiple roots. `close` disconnects,
aborts polling and pending commands and joins their tasks; call it before closing the server.

Scenarios: `gain-plugin`, `empty`, `multiple-targets`, `limited-capabilities`,
`disconnected`, `reload`, `lease-conflict`. The last requires `server` and owns
a lease through a real authenticated simulated browser. `startSimulatedBrowser`
is also available for tests. Scenarios seed deterministic diagnostic samples and
startup logs; individual runtimes opt in with `sampleData: true`.
Fixtures `node` and `originalNodes` are exported for custom scenarios.
The simulated browser accepts an optional AbortSignal as the fourth argument
to `request(method, targetId, params, signal)` to send a real protocol cancellation.

```sh
pnpm turbo run build --filter=@soundor/devtools-server...
pnpm --filter @soundor/devtools-server test
```
