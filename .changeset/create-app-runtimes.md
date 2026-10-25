---
'create-soundor-app': minor
---

Choose the runtimes of a new project: JUCE (the default), web, or both. The
project gets only the chosen runtimes' packages and config entries, a typecheck
of the Web host when it has the web runtime, and scripts that name a runtime:
`dev` runs the first one (`soundor dev` needs one; the template's `dev` had
none), `dev:web` the web runtime alongside JUCE, and with both, `build:juce`
and `build:web` build one.
