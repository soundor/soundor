# vitest-environment-soundor

Vitest 5 environment for Soundor's in-memory simulated runtime.

Install this package and `@soundor/vitest` as direct devDependencies alongside
Vitest, then configure:

```ts
import { defineConfig } from 'vitest/config';
import { soundor } from '@soundor/vitest';

export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor' },
});
```

Vitest discovers the environment by its standard package name. The environment
creates the worker context and disposes it at file teardown; the plugin's
injected lifecycle hook provides a fresh runtime for each test and cleans it
up after test hooks, including failures. A global symbol bridges Node's
environment loader and Vite's test modules without separate runtime registries.

Use standard forks/threads pools and isolated test files. Parallel files are
supported; same-file concurrent tests and VM pools are unsupported.
No browser, React, Hermes, or native runtime dependency is introduced by the
environment. It has no peer dependency on the plugin or another environment.

See [@soundor/vitest](../vitest/README.md) for installation, runtime configuration,
mocking, watch mode, declarations, and simulation limits.
