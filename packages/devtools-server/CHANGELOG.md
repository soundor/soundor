# @soundor/devtools-server

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @soundor/devtools-protocol@0.10.0

## 0.9.0

### Patch Changes

- [#132](https://github.com/soundor/soundor/pull/132) [`b1f3261`](https://github.com/soundor/soundor/commit/b1f3261faf930dcd6640926d7bb8180a7147adb8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Use Fastify and its static, cookie, and WebSocket plugins for DevTools routing, bounded request parsing, file streaming, browser cookies, and server lifecycle while preserving authentication and static-file confinement. Static assets support conditional and range requests.

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a)]:
  - @soundor/devtools-protocol@0.9.0

## 0.8.0

### Minor Changes

- [#128](https://github.com/soundor/soundor/pull/128) [`5ec0815`](https://github.com/soundor/soundor/commit/5ec081578c4f7667e5942cf1ca8e8c8d172a195a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract DevTools into an independent Node server and TypeScript/Vite application,
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

### Patch Changes

- Updated dependencies [[`640fca8`](https://github.com/soundor/soundor/commit/640fca812d39e560c89494b645169e0377df7e32), [`2807b91`](https://github.com/soundor/soundor/commit/2807b91593c45278d51e400892b399368e1f55c7), [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f)]:
  - @soundor/devtools-protocol@0.8.0
