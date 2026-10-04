#pragma once

#include <soundor/Config.h>
#include <soundor/js/Runtime.h>

#include <filesystem>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // A log sink appending one JSON object per line to `file`
    // ({"level":"warn","source":"…","message":"…"}). `soundor dev` tails it to
    // show a plugin's console in the terminal, whichever process the plugin
    // runs in. Each line is written with a single append, so several plugin
    // instances can share the file.
    [[nodiscard]] js::LogSink fileLogSink(const std::filesystem::path& file, std::string source);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
