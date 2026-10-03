#pragma once

// JavaScript sources embedded into the runtime at build time (see
// cmake/SoundorEmbed.cmake). Each is the full text of a runtime-provided module.

#include <soundor/Config.h>

#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    extern const std::string_view parametersModule; // modules/parameters/parameters.js

    // web/js/*.js
    extern const std::string_view abortModule;
    extern const std::string_view cloneModule;
    extern const std::string_view consoleModule;
    extern const std::string_view cryptoModule;
    extern const std::string_view encodingModule;
    extern const std::string_view eventsModule;
    extern const std::string_view inspectModule;
    extern const std::string_view timersModule;
    extern const std::string_view urlModule;
    extern const std::string_view webModule;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
