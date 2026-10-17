---
'create-soundor-app': minor
'soundor': minor
---

New projects pin every Soundor package to the exact version `create-soundor-app` was released with, instead of `latest`: before 1.0 a minor release can change APIs, so a project changes Soundor versions only when it is upgraded. React, TypeScript and the Node and React types take the ranges Soundor is built and tested with.

Soundor supports pnpm and npm. `create-soundor-app` no longer offers Yarn or bun, and prints `npm run dev` rather than `npm dev` for npm projects; `soundor doctor` warns when it runs under another package manager.
