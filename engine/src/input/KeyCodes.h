#pragma once

#include <soundor/Config.h>

#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    // KeyboardEvent.code: the physical key, named as the Web names it
    // ("KeyS", "Digit1", "ShiftLeft", "NumpadEnter"), whatever the layout
    // and the modifiers make it type. Pure tables, checked on every build
    // platform; empty for a key none of them names.

    // Linux: an evdev key code (an X11 keycode less 8).
    [[nodiscard]] std::string_view codeOfEvdev(unsigned code) noexcept;
    // Windows: a set 1 scan code, 0xE0xx for an extended key (lParam's bit 24).
    [[nodiscard]] std::string_view codeOfScancode(unsigned scancode) noexcept;
    // macOS: a virtual key code (NSEvent.keyCode, Carbon's kVK_*).
    [[nodiscard]] std::string_view codeOfMacKeyCode(unsigned keyCode) noexcept;
    // For input with no physical key (a driver's, a test's): the key that
    // types `key` on a US layout ("s" and "S" are "KeyS", "!" is "Digit1"),
    // the left one of a modifier, a named key's own name where the Web uses
    // it as a code ("Enter", "ArrowLeft"); empty otherwise.
    [[nodiscard]] std::string_view codeOfKey(std::string_view key) noexcept;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
