# @soundor/devtools-protocol

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

- [#127](https://github.com/soundor/soundor/pull/127) [`640fca8`](https://github.com/soundor/soundor/commit/640fca812d39e560c89494b645169e0377df7e32) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose real native animation snapshots and bounded lifecycle events, plus explicit performance recording of measured UI tick, layout, raster, frame and compositor work. Add animation and performance panels to DevTools with controller-only recording and safe reload/disconnect cleanup. Keep inspection read-only where reconciler-safe property overrides or source metadata are unavailable.

- [#124](https://github.com/soundor/soundor/pull/124) [`2807b91`](https://github.com/soundor/soundor/commit/2807b91593c45278d51e400892b399368e1f55c7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Connect JUCE development Standalones to the designated DevTools session through asynchronous authenticated IPC. Inspect actual native nodes, styles, layout, accessibility and focus, render independent CPU/GPU highlight layers, and intercept native picker clicks safely across disconnects and reloads. Exclude the bridge from production builds.

- [#123](https://github.com/soundor/soundor/pull/123) [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the versioned Soundor Debug Protocol and local development session server with browser WebSockets, authenticated asynchronous native IPC, instance routing, generation validation, control leases, bounded subscriptions and lifecycle cleanup.
