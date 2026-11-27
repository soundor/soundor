---
'@soundor/engine': patch
'@soundor/vst3-runtime': patch
---

An editor opened again no longer starts the GPU device's threads and the engine's own again. A process that opened and closed a plugin's editor all session (as a DAW does) grew with every open, because the memory each opening's threads had freed stayed in glibc arenas the next ones did not use: reported at about 180 MB over 60 opens of a WebGL editor on Linux.

- The GPU device the editors share (ANGLE's display, its worker threads, and the driver's device and threads) is kept when the last editor closes, until the plugin is unloaded, and so is the device WebGL uses where the editor composites on the CPU (`SOUNDOR_RENDERER=cpu`), which was made for each runtime. It is still made when an editor first opens, never when the plugin loads. A device a GPU reset lost is not given to the next editor.
- On Linux, the editors' accessibility (AT-SPI) work runs on one thread the plugin keeps, `soundor-a11y`, instead of one per editor, and file and storage work on one, `soundor-files`, instead of one per runtime. A runtime's teardown still waits until what it wrote is written.
- The VST3 adapter ends them when the host unloads the plugin (`ModuleExit`, `ExitDll` or `bundleExit`), through the engine's new `platform::releaseModuleResources()`.

Hermes's threads (its collector and time-limit monitor) still start with each editor's runtime, and Mesa's swapchain threads with each window.
