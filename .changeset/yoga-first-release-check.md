---
'@soundor/yoga-wasm': patch
---

Fix the release-readiness check rejecting the first versioned release after Changesets consumes its changeset. An unpublished package still at `0.0.0` continues to require a changeset.
