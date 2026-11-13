---
title: soundor:env
description: Explicit public build-time configuration, shared across runtimes.
---

```ts
import { env } from 'soundor:env';

env.DEV; // true in soundor dev and debug builds
env.PROD; // true in production builds
env.MODE; // 'development' or 'production'
env.API_BASE_URL; // a custom key declared in soundor.config.ts
```

## Configuration

```ts
// soundor.config.ts (runs in Node)
export default defineSoundorConfig({
  plugin: { id: 'com.acme.analyzer', name: 'Analyzer' },
  runtimes: [juceRuntime(), webRuntime()],
  env: {
    API_BASE_URL: process.env.API_BASE_URL ?? 'https://api.example.com',
    ENABLE_EXPERIMENTAL_UI: false,
    MAX_POINTS: 2048,
  },
});
```

Only values listed under `env` enter the JavaScript bundle. Soundor does not
copy `process.env`, read `.env` files automatically, or expose the DAW's
process environment. A config can explicitly read a Node environment variable,
as above, and choose its own default or fail when it is missing.

Custom keys contain letters, digits and underscores and cannot start with a
digit. Values must be strings, booleans or finite numbers. Objects, arrays,
null and undefined are rejected. `DEV`, `PROD` and `MODE` are reserved and
cannot be overridden.

## Exports

`env` is a frozen object with the configured keys and these built-ins:

| Key    | Type                            | Value                                 |
| ------ | ------------------------------- | ------------------------------------- |
| `DEV`  | `boolean`                       | True in development and debug builds. |
| `PROD` | `boolean`                       | True in production builds.            |
| `MODE` | `'development' \| 'production'` | The UI build's mode.                  |

Core generates readonly primitive types for custom keys in
`.soundor/generated/env.d.ts`. Run `soundor gen` after changing the keys;
misspelled or unconfigured keys are TypeScript errors. JavaScript reads an
unconfigured own key as undefined. All configured values are public and
readable from shipped bundles: do not include secrets.

The CLI embeds this module in the shared UI bundle before any runtime consumes
it, so JUCE and web see the same values. The web runtime also resolves it for
host code such as `audio.ts` and the playground. Native module lowering and
bytecode compilation need no extra platform service.

Values are fixed when the config is evaluated and the bundle is built. Restart
`soundor dev` after changing config values or the shell environment; changing
the host process environment after a build does not change `env`.

## Testing

The Soundor Vitest plugin takes custom values from the project's config.
Tests use `MODE: 'development'`, `DEV: true` and `PROD: false`. To override
public values in a test project:

```ts
soundor({
  runtime: {
    env: {
      API_BASE_URL: 'https://fixture.example',
      ENABLE_EXPERIMENTAL_UI: true,
    },
  },
});
```

The simulated runtime isolates these values between tests and rejects writes.
There is no `process` global added to plugin JavaScript.
