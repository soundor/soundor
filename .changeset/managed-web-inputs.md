---
'@soundor/web-runtime': minor
'create-soundor-app': patch
---

Manage the complete Web host inside the runtime package, without a scaffolded
runtimes/web project. Configure built-in input sources with webRuntime({ inputs })
or supply a browser TypeScript/JavaScript module and compose custom inputs with
factories from @soundor/web-runtime/input. New projects include a separate browser
TypeScript project. Legacy web host directories require explicit migration;
the user-owned Vite integration entry is removed.
