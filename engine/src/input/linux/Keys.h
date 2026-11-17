#pragma once

#include <soundor/Config.h>
#include <soundor/ui/Input.h>

#include <cstdint>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    // X11 keys as the Web names them. Pure: no display is needed.

    // A keysym's character in UTF-8 (xkbcommon's xkb_keysym_to_utf8 where it
    // is loaded; else Latin-1, the keypad and Unicode keysyms). Empty for
    // keysyms that are no character.
    using KeysymText = std::string (*)(std::uint32_t keysym);
    [[nodiscard]] std::string basicKeysymText(std::uint32_t keysym);

    // KeyboardEvent.key for a keysym: the Web name of a named key ("Enter",
    // "ArrowLeft", "Shift", "Dead", "F5") or the character it types
    // (`text`). Empty for keys with neither.
    [[nodiscard]] std::string keyName(std::uint32_t keysym, KeysymText text);

    // The modifiers of an X11 state (a core event's, or XInput 2's effective
    // modifiers): Shift, Control, Mod1 (Alt) and Mod4 (Super, the Web's Meta).
    [[nodiscard]] ui::Modifiers modifiersOf(unsigned state) noexcept;

    // The modifier a modifier key itself is ("Shift" is Shift), or 0: its
    // own press holds it, as KeyboardEvent's flags report.
    [[nodiscard]] ui::Modifiers modifierOfKey(const std::string& key) noexcept;

    // What a press with `modifiers` types of the text X11 looked it up as:
    // nothing for a shortcut (Control without Alt), nor control characters
    // (Backspace, Delete, Escape, Control+letter), which keys name instead.
    [[nodiscard]] std::string typedText(std::string text, ui::Modifiers modifiers);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
