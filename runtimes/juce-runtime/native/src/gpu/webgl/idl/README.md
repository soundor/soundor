# WebGL IDL

`webgl.idl` and `webgl2.idl` from the Khronos WebGL repository,
`specs/latest/1.0/webgl.idl` and `specs/latest/2.0/webgl2.idl` at commit
`714857a28445e8f5d8d6ae1c78498578009534d8`, unchanged (their license is in
their headers).

`runtimes/juce-runtime/scripts/webgl-codegen.mjs` generates the constants and
the plain methods of Soundor's `WebGL2RenderingContext` from them
(`../generated/`); `pnpm --filter @soundor/juce-runtime gen:webgl` runs it, and
a test checks the checked-in output is up to date. Updating the IDL is
replacing these two files and regenerating.
