---
'@soundor/config': minor
'@soundor/core': minor
'@soundor/expression': minor
'@soundor/runtime-sdk': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/vitest': minor
'create-soundor-app': minor
---

Parameters with Soundor's own semantics. `parameters` is a record keyed by each parameter's stable id, with the types `float32`, `int8`…`uint32`, `boolean` and `choice` (options `{ value, label }`, their values inferred without `as const`, defaults and repeated options type errors); `int64`, `uint64` and `float64` are refused, as hosts carry parameters as 32-bit floats. A parameter declares its `access` (`automatable`, `manual`, `readOnly`), its `mapping` (`linear`, `log`, `power`, `symmetricPower`, or a custom pair of expressions), a `step`, a `unit`, and `format` and `parse` written with the new `@soundor/expression` builder. Validation resolves each one into typed expressions (`ParameterSemantics`) that runtimes compile, and checks defaults, steps, custom mappings and format/parse round trips. `soundor:parameters` adds `format()`, `parse()`, `toNormalized()` and `fromNormalized()`, and refuses writes to read-only parameters. `@soundor/expression` is a typed, JSON-serializable expression language with C++ and JavaScript compilers of identical semantics; the SDK re-exports it as `@soundor/runtime-sdk/expression`. The test runtime and Testing Library run the same compiled behavior, and `testParameters.set` sets read-only parameters as the processing does.
