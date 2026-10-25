---
'create-soundor-app': minor
---

Choose the runtimes of a new project: JUCE (the default), web, or both. The
project gets only the chosen runtimes' packages and config entries, a `dev`
script per runtime (`soundor dev` needs one; the template's `dev` had none),
and a typecheck of the Web host when it has the web runtime.
