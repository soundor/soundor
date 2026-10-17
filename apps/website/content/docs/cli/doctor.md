---
title: 'soundor doctor'
description: "Checks the machine, the config and each runtime's prerequisites, and says what to fix."
---

```sh
soundor doctor [--json] [--config <path>]
```

`doctor` checks that a project can build, and says what to fix when it
cannot:

- **The machine:** the Node.js version, and the package manager (pnpm or npm).
- **The config:** that `soundor.config.ts` loads and is valid, with every
  problem and its path.
- **Each runtime's prerequisites:** for JUCE, CMake, a C++ compiler, the
  tools Skia and ANGLE build with, and JUCE itself; for the web, Vite and
  the host project.

| Option            | What it does                                               |
| ----------------- | ---------------------------------------------------------- |
| `--json`          | Prints `{ status, exitCode, checks }`, for scripts and CI. |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`. |

Each check is `ok`, `warn` or `fail`, with a detail. `doctor` exits with 1
when any check fails, else 0: a warning does not fail it.

## Good to know

- **Run it first** on a new machine, or when a build fails in a way that
  looks like the environment.
- **In CI**, before `build`: a missing tool fails in seconds, not after a
  long native build.
- **It never throws** on a failing check: a broken config or runtime is one
  more failed check, and the others still run.
