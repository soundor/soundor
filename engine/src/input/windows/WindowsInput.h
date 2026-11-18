#pragma once

#include <soundor/input/Platform.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
{
    [[nodiscard]] std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
