---
'soundor': minor
'@soundor/config': minor
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
---

The plugin view is drawn: a Skia renderer and the UI primitives.

- Skia (m144) is built from source at a pinned commit, CPU-only (no GPU, PDF, SVG, ICU or HarfBuzz), once per machine into Soundor's cache directory. It needs git, Python 3 and ninja, which `soundor doctor` now checks. Its symbols stay hidden inside each plugin.
- `soundor:ui` draws backgrounds, borders, per-corner radii, opacity, clipping, text in the platform's fonts (with fallback), images, scroll views and text inputs. Styles take CSS colors (`color`, `backgroundColor`, `borderColor`), `borderRadius`, `opacity` and `resizeMode`.
- New primitives: `createImage()`, `createScrollView()`, `createTextInput()` (editing, selection and clipboard as default actions; `input`/`change` events; UTF-16 indices), `pressable()`, `clipboard`, and global `requestAnimationFrame`/`cancelAnimationFrame`.
- The JUCE editor renders the UI into its view, repainting only when it changed, and uses the system clipboard.
- The symbol check now also fails on Objective-C classes compiled into a binary (Apple platforms).
- **Breaking:** `ui::TextMeasurer` is replaced by `ui::TextEngine`; `RuntimeHost::Options::textMeasurer` is now `textEngine` and defaults to the renderer's fonts.
