# Third-party notices not shipped with the dependencies

A prebuilt engine archive carries the license notices of everything it links
(`licenses/` in the archive, assembled by `cmake/SoundorEngineStage.cmake`).
Most come from the dependency builds themselves: Skia's and Hermes's top-level licenses, and ANGLE's per-dependency `licenses/`. This
directory holds the rest, each taken verbatim from the exact pinned revision
in `cmake/SoundorDependencies.cmake`:

| Directory              | Compiled into     | Source                                                                                  |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `skia/libjpeg-turbo`   | Skia              | Skia's DEPS pin, `e14cbfaa85529d47f9f55b0f104a579c1061f9ad`                             |
| `skia/libpng`          | Skia              | Skia's DEPS pin, `49363adcfaf098748d7a4c8c624ad8c45a8c3a86`                             |
| `skia/libwebp`         | Skia              | Skia's DEPS pin, `845d5476a866141ba35ac133f856fa62f0b7445f` (decoding)                  |
| `skia/expat`          | Skia              | Skia's DEPS pin, `8e49998f003d693213b538ef765814c7d21abada`                             |
| `skia/zlib`            | Skia              | Skia's DEPS pin (Chromium's zlib), `646b7f569718921d7d4b5b8e22572ff6c76f2596`           |
| `hermes/llvh`          | Hermes            | `external/llvh/LICENSE.txt` at the Hermes revision (LLVM's support library)             |
| `hermes/dtoa`          | Hermes            | the notice heading `external/dtoa/dtoa.c` at the Hermes revision                        |
| `hermes/quickjs-ng`    | Hermes (Linux)    | QuickJS-NG at its pinned revision (libunicode tables)                                   |
| `ada`                  | the engine        | ada-url/ada `v3.4.4`                                                                    |
| `yoga`                 | the engine        | facebook/yoga at its pinned revision                                                    |
| `emscripten`           | the WebAssembly core | Emscripten's `LICENSE` and musl's `COPYRIGHT` (its libc), at the pinned Emscripten (`wasm/emscripten.json`) |

The WebAssembly core (`soundor-core.wasm`) contains the engine's own core,
Yoga, and the parts of Emscripten's system libraries it uses: musl's libc,
whose notice is in `emscripten/`, and LLVM's libc++, libc++abi and
compiler-rt, whose LLVM exception asks for no notice in compiled form. Its
notices are `webLicenses()` (`node/src/web.ts`), which the web archive and
the web runtime both use.

Skia's skcms is Skia's own code, under Skia's license. JSI ships with Hermes
under its license. When a pin changes, update the matching notices here; the
staging step fails when a linked component has none.

Linux accessibility links the system's shared GIO/GLib libraries (LGPL-2.1-or-later). They are not copied into prebuilt archives. See `NOTICE.md` for
system-library distribution requirements. Windows uses native UI Automation system
libraries.
