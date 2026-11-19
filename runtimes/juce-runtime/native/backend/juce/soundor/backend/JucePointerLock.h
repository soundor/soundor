#pragma once

// JUCE backend: JUCE's own mouse as a pointer lock's source
// (input::PointerLock), where the view's input is JUCE's rather than
// Soundor's native input (input::pointerSource()).

#include <soundor/Abi.h>
#include <soundor/input/PointerLock.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // juce::Desktop's mouse source for a pointer id (pointer n is source n -
    // 1), or null.
    [[nodiscard]] std::unique_ptr<input::PointerLock::Source> desktopPointerSource(int pointerId);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
