---
'soundor': patch
---

The UI bundle ships only the images and fonts its code still uses after tree shaking: a library's font helper that the plugin never calls no longer adds its files to the plugin.
