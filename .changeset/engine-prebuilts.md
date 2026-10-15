---
'@soundor/engine': minor
---

Build the engine as prebuilt archives and link them. `soundor_engine_stage` and the `prebuilt-debug`/`prebuilt-release` presets lay out a variant with every library it links, its headers for internal consumers, `hermesc`, license notices and `soundor-engine.json`; `SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR` and `SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR` import extracted archives as the same targets a source build defines, after checking them against the package and the build's target. Third-party notices that dependency builds leave out ship in `licenses/`. Release versions get the ABI namespace they name (0.1.0 is `soundor::v0_1_0`, not `v0_1_0_p`). `soundor_embed_ui()` keeps its generated files per target. Universal macOS builds compile Hermes for every architecture (it was built for the first one only).
