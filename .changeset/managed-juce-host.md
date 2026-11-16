---
'@soundor/juce-runtime': minor
---

Manage the JUCE host inside the runtime package. Development and builds no longer need `soundor init juce` or a `runtimes/juce/` scaffold; the init lifecycle remains a no-op. Rust processing and controllers, generated contracts, engine selection and plugin formats retain their existing pipeline. Legacy host directories now fail with migration guidance and are never deleted automatically. Review and migrate customizations before removing the directory yourself.
