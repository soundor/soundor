---
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/vst3-runtime': minor
---

`fetch()`, DevTools and pointer lock move into the engine, for every runtime:

- **`fetch()` goes through the system's HTTP stack** (`platform::systemHttpClient()`): `NSURLSession` on macOS and iOS, WinHTTP on Windows, and on Linux the system's libcurl, loaded when first used (`libcurl.so.4`, else `libcurl-gnutls.so.4`), never linked and never bundled, so HTTPS is as current as the system keeps it, with HTTP/3 where the system's stack has it. In the JUCE runtime this replaces JUCE's networking: HTTPS now works on Linux (JUCE's was built without curl), and Windows uses WinHTTP rather than WinINet. Where Linux has no libcurl, `fetch()` rejects, saying so.
- **The DevTools bridge is the engine's** (`debug::Bridge`), over the same HTTP stack, so the VST3 runtime's Debug builds connect to DevTools too, and `soundor build vst3 --debug` builds one.
- **Pointer lock is the engine's** (`input::PointerLock`): the VST3 runtime supports `requestPointerLock()`, and CSS's `cursor: none` hides its cursor.
- **The engine has one JSON implementation** (`soundor::json`, strict, numbers kept as written), which the DevTools protocol and the VST3 adapter share.
- The VST3 runtime's `soundor doctor` checks for libcurl.
