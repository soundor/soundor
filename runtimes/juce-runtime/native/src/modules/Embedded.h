#pragma once

// JavaScript sources embedded into the runtime at build time (see
// cmake/SoundorEmbed.cmake). Each is the full text of a runtime-provided module.

#include <soundor/Config.h>

#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    extern const std::string_view parametersModule; // modules/parameters/parameters.js
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
