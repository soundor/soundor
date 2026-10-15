# @soundor/devtools-server

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
