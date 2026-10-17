# @soundor/test-runtime

## 0.12.0

### Minor Changes

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

## 0.11.0

No changes in this release.

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

## 0.10.0

No changes in this release.

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.8.0

### Minor Changes

- [#113](https://github.com/soundor/soundor/pull/113) [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract an isolated, framework independent testing runtime with semantic trees,
  input, services and deterministic animation time. Share the analytic spring solver
  with the Web runtime and preserve React tests through a temporary adapter.

  Make modal focus eligibility and pointer ownership deterministic, bound animation
  ownership without losing fills or replay, and fix native and simulated target
  capture propagation so stopPropagation preserves same-target bubble listeners.

- [#118](https://github.com/soundor/soundor/pull/118) [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add Soundor Testing Library with semantic queries, stateful pointer and keyboard interactions, React rendering and cleanup, async assertions, and deterministic animation time. Align simulated mouse capture and event cancellation with native behavior and keep frame batches on the 60 Hz timeline.

- [#115](https://github.com/soundor/soundor/pull/115) [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the Soundor Vitest plugin and simulated environment with virtual modules,
  per-test runtime isolation, deterministic service configuration, and published
  package consumer validation. Make React focus scopes read the active roots.

### Patch Changes

- [#121](https://github.com/soundor/soundor/pull/121) [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add automatically registered Soundor focus assertions and focused simulated parameter,
  host and native mock setup helpers. React setup helpers commit subscription updates
  with act. Deprecate the Vitest runtime escape hatch and document behavior-based
  application animation tests while preserving runtime lifecycle coverage.
