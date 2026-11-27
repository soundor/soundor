#pragma once

#include <soundor/Abi.h>

// What the engine keeps for the plugin module's lifetime rather than an
// editor's: the GPU device (ANGLE's display, its worker threads and the
// driver's), the accessibility bus's thread on Linux and the file worker.
// Each is made when first needed (when an editor first opens, not when the
// module loads) and then serves every editor and runtime after it, so an
// editor opened again starts none of them anew. Starting and ending them on
// every open would leave each opening's allocations in different allocator
// arenas (glibc), and the process would grow with every open (#404).

#include <soundor/Config.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // Ends what the engine keeps for the module: called by the runtime's
    // adapter before the module is unloaded (VST3: DeinitModule, which the
    // host calls through ModuleExit, ExitDll or bundleExit), with no editor
    // and no runtime left. Never from a static destructor or DllMain: ending
    // the threads waits for them, which deadlocks under Windows' loader lock.
    // What is used after it is made again. Safe to call more than once.
    void releaseModuleResources();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
