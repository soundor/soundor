---
'soundor': patch
'@soundor/devtools-server': minor
'@soundor/devtools-client': minor
---

Extract DevTools into an independent Node server and TypeScript/Vite application,
preserving the shared protocol and dashboard behavior. Add secure optional static
serving, headless operation, reusable simulated runtimes and scenarios, standalone
frontend development, browser E2E coverage and packed-consumer validation.

Allow Vite development to attach to an existing loopback backend through an
explicit CLI Origin opt-in, retaining normal browser authentication and backend
ownership. Derive simulated tree roots from the current fixture nodes.

Separate browser session handling, protocol state, and dashboard rendering into
focused client modules. Cover state transitions with DOM-independent tests,
model cancellable simulated operations without error side effects, and isolate
frontend development tests with ephemeral ports. Canonicalize localhost browser
bootstrap links onto the explicitly trusted loopback origin.
