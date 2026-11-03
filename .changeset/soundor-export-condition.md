---
'soundor': minor
'@soundor/vitest': minor
'create-soundor-app': patch
---

Enable the `soundor` package condition when bundling plugin UIs and running
Soundor Vitest tests, including external dependencies. Libraries can expose
Soundor and DOM implementations through the same import, with the Soundor
entry selected for both JUCE and the web runtime. New projects include
`customConditions: ["soundor"]` in their UI tsconfig; existing and manually
created projects should add it to select matching TypeScript declarations.
