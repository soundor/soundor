#pragma once

#include <soundor/input/Platform.h>

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    // X11 input for one view, on a connection of its own: the view's pointer,
    // wheel and key events selected with XInput 2, which the X server then
    // delivers to this connection in place of the core events a framework
    // selects on the view, so each reaches Soundor once and the framework not
    // at all. Text goes through an X input method (XIM) on the same connection.
    [[nodiscard]] std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
