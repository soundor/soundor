#pragma once

// UTF-8 (Soundor's strings) to and from UTF-16 (VST3's).

#include <pluginterfaces/base/ftypes.h>
#include <pluginterfaces/vst/vsttypes.h>

#include <string>
#include <string_view>

namespace soundor::vst3
{
    [[nodiscard]] std::u16string utf16(std::string_view text);
    [[nodiscard]] std::string utf8(const Steinberg::Vst::TChar* text);
    // Copies `text` into a VST3 String128, truncated and terminated.
    void copyString128(std::string_view text, Steinberg::Vst::String128 out);
    // Copies `text` into a fixed char buffer of `size` bytes, truncated (at a
    // character boundary) and terminated.
    void copyAscii(std::string_view text, char* out, std::size_t size);
} // namespace soundor::vst3
