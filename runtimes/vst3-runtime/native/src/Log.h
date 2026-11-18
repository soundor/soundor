#pragma once

#include <string_view>

namespace soundor::vst3
{
    // Writes a line to the plugin's log: stderr, which hosts keep (or show).
    // Any thread but the audio thread.
    void log(std::string_view message) noexcept;
} // namespace soundor::vst3
