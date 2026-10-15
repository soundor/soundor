# @soundor/devtools-client

Soundor DevTools browser application: React and React DOM with TypeScript, built
with Vite.
The extracted dashboard preserves its UI, keyboard controls, authentication,
tree inspection, accessibility, control ownership, logs, animations and metrics.
The shared protocol supplies browser types; production connects to the real
DevTools backend.

```sh
pnpm turbo run build --filter=@soundor/devtools-client...
pnpm --filter @soundor/devtools-client dev
```

Open **http://127.0.0.1:5173/__connect**. This local endpoint redirects privately
with a one-use bootstrap ticket; the normal frontend exchanges it for a cookie
and removes it from history. Bootstrap links opened through localhost redirect
to the explicitly trusted 127.0.0.1 origin before authentication. The command
starts Vite HMR, the production server
in headless mode, and a simulated runtime. It needs no JUCE, plugin, or DAW.
The default port is 5173 with strict binding. The backend trusts only the
frontend origin derived from the bound port; tests use port 0 for isolation.
Closing Vite closes the runtime, poller and backend together.

Choose a scenario using `SOUNDOR_DEVTOOLS_SCENARIO`:

```sh
SOUNDOR_DEVTOOLS_SCENARIO=multiple-targets pnpm --filter @soundor/devtools-client dev
```

Available: `gain-plugin` (default), `empty`, `multiple-targets`,
`limited-capabilities`, `disconnected`, `reload`, `lease-conflict`.
The conflict scenario already has a competing controller. The disconnected
scenario starts without a live target; the reload scenario starts at generation 2.
Tests can trigger transitions using the simulator's controls.

The production build emits `dist/index.html` and arbitrary Vite assets/chunks,
using base `/`. The package publishes `dist` and exports `./package.json` so
consumers can resolve the installed asset directory without layout assumptions:

```ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const staticDir = join(
  dirname(require.resolve('@soundor/devtools-client/package.json')),
  'dist',
);
```

Pass that directory to `startDevToolsServer`. The server has no dependency on
this application. Browser internals have no public library export.
The client uses the server only as a development/test dependency.

```sh
pnpm --filter @soundor/devtools-client build
pnpm --filter @soundor/devtools-client test
pnpm --filter @soundor/devtools-client exec playwright install chromium
pnpm --filter @soundor/devtools-client test:e2e
pnpm --filter soundor test:devtools-consumer
```

Unit tests cover tree/filter and metric transformations, message processing,
selection changes, stale-response guards, and target/generation state.
React owns the dashboard shell, tree/details views, and diagnostics rendering.
`controller.ts` coordinates asynchronous commands and publishes revisions through
`useSyncExternalStore`; `state.ts` retains protocol state and stale-response guards.
Browser session management handles transport and authentication through callbacks,
without mutating the DOM. The inspector mounts one React root and unmounts it with
the controller on disposal. Integration suites are
organized by inspector, connection/control, and diagnostics, using Happy DOM,
the real backend, and the reusable simulator. Playwright separately verifies
the actual production assets, bootstrap/cookies/WebSocket, discovery, selection,
picker, reload/reconnect, SPA navigation and missing resources, plus Vite proxy
authentication on ephemeral ports, including attachment to an externally owned backend. Backend tests also cover static security and binary/MIME behavior.
The packed consumer smoke installs published tarballs in an isolated strict pnpm
project and exercises the server, testing subpath, client assets and bundled CLI.

To attach Vite to a separately running backend, start that backend with
`developmentOrigin: 'http://127.0.0.1:5173'`, then run:

```sh
SOUNDOR_DEVTOOLS_BACKEND=http://127.0.0.1:4545 pnpm --filter @soundor/devtools-client dev
```

Only credential-free HTTP loopback origins are accepted. This mode starts no
simulator, and stopping Vite leaves the external backend and its runtimes alive.
Open **http://127.0.0.1:5173/** and use the existing browser-key form with the key
from the backend's protected session descriptor. If you already have a one-use
launch ticket, opening its fragment on the Vite origin uses the usual bootstrap
flow and removes the fragment from history. Keep credentials out of command
arguments, environment variables, and ordinary logs.

For an existing native integration launched by the CLI, opt into that exact
frontend origin before starting development:

```sh
SOUNDOR_DEVTOOLS_ORIGIN=http://127.0.0.1:5173 soundor dev juce
```

Use the backend port from the CLI's credential-free DevTools URL in
`SOUNDOR_DEVTOOLS_BACKEND`. These environment options are development-only;
ordinary CLI sessions retain their original Origin restrictions.
