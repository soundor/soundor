// UTF-8 strings to and from std::filesystem paths (the protocol's paths are
// UTF-8; Windows paths are UTF-16).
#pragma once

#include <filesystem>
#include <string>

namespace soundor::vst3host
{
    inline std::filesystem::path toPath(const std::string& utf8)
    {
        return { std::u8string(utf8.begin(), utf8.end()) };
    }

    inline std::string fromPath(const std::filesystem::path& path)
    {
        const std::u8string utf8 = path.u8string();
        return { utf8.begin(), utf8.end() };
    }
} // namespace soundor::vst3host
