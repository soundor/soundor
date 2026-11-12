---
'@soundor/config': minor
'@soundor/core': minor
'@soundor/runtime-sdk': minor
'soundor': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Runtime packages now declare supported Soundor CLI versions through a required `soundor` peer dependency. Both first-party runtimes use a caret range matching their regular `@soundor/runtime-sdk` dependency; the SDK and CLI share the fixed package version. Before 1.0, this supports the current minor and its patches. Runtime providers own the supported range, and package managers handle peer mismatches without an additional CLI compatibility check.

Remove the numeric `Runtime.apiVersion` and `ResolvedRuntime.apiVersion`, runtime API version constants and contract record, config-feature version gates, compatibility helpers, and `RuntimeCompatibilityError` with its dedicated error codes. Third-party runtimes should remove those imports and fields, keep the SDK as a regular dependency, and declare the supported CLI range in `peerDependencies.soundor`. The existing project config release-line check and cross-copy error protocol remain.
