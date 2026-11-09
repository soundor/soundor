---
'@soundor/web-runtime': minor
---

**Breaking:** `soundor:native` in the browser checks and converts every call as the JUCE runtime does, with its errors word for word: sized numbers are never coerced (`float32` rounded with `Math.fround`, 64-bit integers bigints), `null` only for `T?`, buffers exactly their typed array, and structs and arrays copied with their declared fields only. What the implementation returns is checked too, and copied. Argument errors of async methods are thrown, not rejected, as natively. `defineHandle()`, `WebNativeHandle` and `WebNativeHandleType` are removed with handles. The manifest carries the native API's types.
