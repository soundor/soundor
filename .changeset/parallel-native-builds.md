---
'@soundor/juce-runtime': patch
'@soundor/engine': patch
---

Plugin builds compile in parallel with Visual Studio too: `soundor dev` and `soundor build` pass `--parallel` to `cmake --build` (MSBuild otherwise builds one project at a time), and the engine's targets compile with `/MP` under the Visual Studio generator (cl.exe otherwise compiles a project's sources one at a time). Ninja builds were already parallel. The engine's `tidy` build can remember clang-tidy's passes in a directory (`SOUNDOR_CLANG_TIDY_CACHE`), so files whose source, headers and configuration are unchanged are not analyzed again.
