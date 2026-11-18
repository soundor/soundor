#pragma once

#include <soundor/input/Platform.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
{
    // A transparent child NSView over the editor's area, owned by the engine.
    // The host retains its window and parent view. UI/main thread only.
    [[nodiscard]] std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
