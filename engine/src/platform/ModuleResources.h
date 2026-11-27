#pragma once

#include <soundor/Abi.h>

// Private to soundor_runtime: how a subsystem keeps something for the
// module's lifetime (soundor/platform/ModuleResources.h).

#include <soundor/Config.h>
#include <soundor/platform/ModuleResources.h>

#include <functional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // Registers `release`, which releaseModuleResources() calls (the last
    // registered first). A subsystem registers when it makes what it keeps,
    // and `release` ends it; made again after a release, it registers again.
    // What it keeps must be reachable from a static that is never destroyed
    // (a leaked pointer): a static destructor would end it during exit or
    // unloading, after the libraries it uses are gone or under a loader lock.
    void releaseWithModule(std::function<void()> release);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
