---
'@soundor/engine': patch
'@soundor/juce-runtime': patch
---

Remove Linux AccessKit archive acquisition, linking and staging while preserving Windows support and notices. Propagate dynamically linked system GIO through prebuilt imports, document native Linux accessibility, and add a Rust static-library/JUCE plugin link and loading regression check.
