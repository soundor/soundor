---
'@soundor/juce-runtime': minor
---

JavaScript is compiled to QuickJS bytecode at build time: the runtime's own modules, and a built plugin's UI bundle. Opening an editor no longer parses JavaScript: for the benchmark example, startup went from 46 ms to 10 ms and the engine's heap after it from 4.7 MB to 3.2 MB. The bytecode keeps line numbers for stack traces but not source text, so a function's `toString()` no longer returns its code in a built plugin; `soundor dev` still runs source. Only bytecode compiled into the binary is ever read. Cross builds (or `-DSOUNDOR_PRECOMPILE_JS=OFF`) embed source as before.
