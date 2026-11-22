#include "input/KeyCodes.h"

#include <array>
#include <cstdint>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    namespace
    {
        constexpr std::uint16_t none = 0xFFFF;

        // A physical key, and what each platform numbers it (as Chromium's
        // dom_code_data.inc does).
        struct PhysicalKey
        {
            std::string_view code;
            std::uint16_t evdev = none;
            std::uint16_t scancode = none;
            std::uint16_t mac = none;
        };

        // clang-format off
        constexpr std::array keys {
            PhysicalKey { "Escape", 1, 0x0001, 0x35 },
            PhysicalKey { "Digit1", 2, 0x0002, 0x12 },
            PhysicalKey { "Digit2", 3, 0x0003, 0x13 },
            PhysicalKey { "Digit3", 4, 0x0004, 0x14 },
            PhysicalKey { "Digit4", 5, 0x0005, 0x15 },
            PhysicalKey { "Digit5", 6, 0x0006, 0x17 },
            PhysicalKey { "Digit6", 7, 0x0007, 0x16 },
            PhysicalKey { "Digit7", 8, 0x0008, 0x1A },
            PhysicalKey { "Digit8", 9, 0x0009, 0x1C },
            PhysicalKey { "Digit9", 10, 0x000A, 0x19 },
            PhysicalKey { "Digit0", 11, 0x000B, 0x1D },
            PhysicalKey { "Minus", 12, 0x000C, 0x1B },
            PhysicalKey { "Equal", 13, 0x000D, 0x18 },
            PhysicalKey { "Backspace", 14, 0x000E, 0x33 },
            PhysicalKey { "Tab", 15, 0x000F, 0x30 },
            PhysicalKey { "KeyQ", 16, 0x0010, 0x0C },
            PhysicalKey { "KeyW", 17, 0x0011, 0x0D },
            PhysicalKey { "KeyE", 18, 0x0012, 0x0E },
            PhysicalKey { "KeyR", 19, 0x0013, 0x0F },
            PhysicalKey { "KeyT", 20, 0x0014, 0x11 },
            PhysicalKey { "KeyY", 21, 0x0015, 0x10 },
            PhysicalKey { "KeyU", 22, 0x0016, 0x20 },
            PhysicalKey { "KeyI", 23, 0x0017, 0x22 },
            PhysicalKey { "KeyO", 24, 0x0018, 0x1F },
            PhysicalKey { "KeyP", 25, 0x0019, 0x23 },
            PhysicalKey { "BracketLeft", 26, 0x001A, 0x21 },
            PhysicalKey { "BracketRight", 27, 0x001B, 0x1E },
            PhysicalKey { "Enter", 28, 0x001C, 0x24 },
            PhysicalKey { "ControlLeft", 29, 0x001D, 0x3B },
            PhysicalKey { "KeyA", 30, 0x001E, 0x00 },
            PhysicalKey { "KeyS", 31, 0x001F, 0x01 },
            PhysicalKey { "KeyD", 32, 0x0020, 0x02 },
            PhysicalKey { "KeyF", 33, 0x0021, 0x03 },
            PhysicalKey { "KeyG", 34, 0x0022, 0x05 },
            PhysicalKey { "KeyH", 35, 0x0023, 0x04 },
            PhysicalKey { "KeyJ", 36, 0x0024, 0x26 },
            PhysicalKey { "KeyK", 37, 0x0025, 0x28 },
            PhysicalKey { "KeyL", 38, 0x0026, 0x25 },
            PhysicalKey { "Semicolon", 39, 0x0027, 0x29 },
            PhysicalKey { "Quote", 40, 0x0028, 0x27 },
            PhysicalKey { "Backquote", 41, 0x0029, 0x32 },
            PhysicalKey { "ShiftLeft", 42, 0x002A, 0x38 },
            PhysicalKey { "Backslash", 43, 0x002B, 0x2A },
            PhysicalKey { "KeyZ", 44, 0x002C, 0x06 },
            PhysicalKey { "KeyX", 45, 0x002D, 0x07 },
            PhysicalKey { "KeyC", 46, 0x002E, 0x08 },
            PhysicalKey { "KeyV", 47, 0x002F, 0x09 },
            PhysicalKey { "KeyB", 48, 0x0030, 0x0B },
            PhysicalKey { "KeyN", 49, 0x0031, 0x2D },
            PhysicalKey { "KeyM", 50, 0x0032, 0x2E },
            PhysicalKey { "Comma", 51, 0x0033, 0x2B },
            PhysicalKey { "Period", 52, 0x0034, 0x2F },
            PhysicalKey { "Slash", 53, 0x0035, 0x2C },
            PhysicalKey { "ShiftRight", 54, 0x0036, 0x3C },
            PhysicalKey { "NumpadMultiply", 55, 0x0037, 0x43 },
            PhysicalKey { "AltLeft", 56, 0x0038, 0x3A },
            PhysicalKey { "Space", 57, 0x0039, 0x31 },
            PhysicalKey { "CapsLock", 58, 0x003A, 0x39 },
            PhysicalKey { "F1", 59, 0x003B, 0x7A },
            PhysicalKey { "F2", 60, 0x003C, 0x78 },
            PhysicalKey { "F3", 61, 0x003D, 0x63 },
            PhysicalKey { "F4", 62, 0x003E, 0x76 },
            PhysicalKey { "F5", 63, 0x003F, 0x60 },
            PhysicalKey { "F6", 64, 0x0040, 0x61 },
            PhysicalKey { "F7", 65, 0x0041, 0x62 },
            PhysicalKey { "F8", 66, 0x0042, 0x64 },
            PhysicalKey { "F9", 67, 0x0043, 0x65 },
            PhysicalKey { "F10", 68, 0x0044, 0x6D },
            PhysicalKey { "NumLock", 69, 0xE045, 0x47 },
            PhysicalKey { "ScrollLock", 70, 0x0046, none },
            PhysicalKey { "Numpad7", 71, 0x0047, 0x59 },
            PhysicalKey { "Numpad8", 72, 0x0048, 0x5B },
            PhysicalKey { "Numpad9", 73, 0x0049, 0x5C },
            PhysicalKey { "NumpadSubtract", 74, 0x004A, 0x4E },
            PhysicalKey { "Numpad4", 75, 0x004B, 0x56 },
            PhysicalKey { "Numpad5", 76, 0x004C, 0x57 },
            PhysicalKey { "Numpad6", 77, 0x004D, 0x58 },
            PhysicalKey { "NumpadAdd", 78, 0x004E, 0x45 },
            PhysicalKey { "Numpad1", 79, 0x004F, 0x53 },
            PhysicalKey { "Numpad2", 80, 0x0050, 0x54 },
            PhysicalKey { "Numpad3", 81, 0x0051, 0x55 },
            PhysicalKey { "Numpad0", 82, 0x0052, 0x52 },
            PhysicalKey { "NumpadDecimal", 83, 0x0053, 0x41 },
            PhysicalKey { "IntlBackslash", 86, 0x0056, 0x0A },
            PhysicalKey { "F11", 87, 0x0057, 0x67 },
            PhysicalKey { "F12", 88, 0x0058, 0x6F },
            PhysicalKey { "IntlRo", 89, 0x0073, 0x5E },
            PhysicalKey { "Convert", 92, 0x0079, none },
            PhysicalKey { "KanaMode", 93, 0x0070, none },
            PhysicalKey { "NonConvert", 94, 0x007B, none },
            PhysicalKey { "NumpadEnter", 96, 0xE01C, 0x4C },
            PhysicalKey { "ControlRight", 97, 0xE01D, 0x3E },
            PhysicalKey { "NumpadDivide", 98, 0xE035, 0x4B },
            PhysicalKey { "PrintScreen", 99, 0xE037, none },
            PhysicalKey { "AltRight", 100, 0xE038, 0x3D },
            PhysicalKey { "Home", 102, 0xE047, 0x73 },
            PhysicalKey { "ArrowUp", 103, 0xE048, 0x7E },
            PhysicalKey { "PageUp", 104, 0xE049, 0x74 },
            PhysicalKey { "ArrowLeft", 105, 0xE04B, 0x7B },
            PhysicalKey { "ArrowRight", 106, 0xE04D, 0x7C },
            PhysicalKey { "End", 107, 0xE04F, 0x77 },
            PhysicalKey { "ArrowDown", 108, 0xE050, 0x7D },
            PhysicalKey { "PageDown", 109, 0xE051, 0x79 },
            PhysicalKey { "Insert", 110, 0xE052, 0x72 },
            PhysicalKey { "Delete", 111, 0xE053, 0x75 },
            PhysicalKey { "AudioVolumeMute", 113, 0xE020, 0x4A },
            PhysicalKey { "AudioVolumeDown", 114, 0xE02E, 0x49 },
            PhysicalKey { "AudioVolumeUp", 115, 0xE030, 0x48 },
            PhysicalKey { "NumpadEqual", 117, 0x0059, 0x51 },
            PhysicalKey { "Pause", 119, 0x0045, none },
            PhysicalKey { "NumpadComma", 121, 0x007E, 0x5F },
            PhysicalKey { "Lang1", 122, 0x0072, 0x68 },
            PhysicalKey { "Lang2", 123, 0x0071, 0x66 },
            PhysicalKey { "IntlYen", 124, 0x007D, 0x5D },
            PhysicalKey { "MetaLeft", 125, 0xE05B, 0x37 },
            PhysicalKey { "MetaRight", 126, 0xE05C, 0x36 },
            PhysicalKey { "ContextMenu", 127, 0xE05D, 0x6E },
            PhysicalKey { "MediaTrackNext", 163, 0xE019, none },
            PhysicalKey { "MediaPlayPause", 164, 0xE022, none },
            PhysicalKey { "MediaTrackPrevious", 165, 0xE010, none },
            PhysicalKey { "MediaStop", 166, 0xE024, none },
            PhysicalKey { "F13", 183, 0x0064, 0x69 },
            PhysicalKey { "F14", 184, 0x0065, 0x6B },
            PhysicalKey { "F15", 185, 0x0066, 0x71 },
            PhysicalKey { "F16", 186, 0x0067, 0x6A },
            PhysicalKey { "F17", 187, 0x0068, 0x40 },
            PhysicalKey { "F18", 188, 0x0069, 0x4F },
            PhysicalKey { "F19", 189, 0x006A, 0x50 },
            PhysicalKey { "F20", 190, 0x006B, 0x5A },
            PhysicalKey { "F21", 191, 0x006C, none },
            PhysicalKey { "F22", 192, 0x006D, none },
            PhysicalKey { "F23", 193, 0x006E, none },
            PhysicalKey { "F24", 194, 0x0076, none },
            PhysicalKey { "Fn", none, none, 0x3F },
        };
        // clang-format on

        template <auto PhysicalKey::*Field>
        std::string_view find(unsigned number) noexcept
        {
            if (number >= none)
                return {};
            for (const PhysicalKey& key : keys)
                if (key.*Field == number)
                    return key.code;
            return {};
        }

        // The characters of US keys, unshifted and shifted, other than letters.
        constexpr std::array<std::pair<std::string_view, std::string_view>, 21> typed { {
            { "1!", "Digit1" },      { "2@", "Digit2" },       { "3#", "Digit3" },     { "4$", "Digit4" },
            { "5%", "Digit5" },      { "6^", "Digit6" },       { "7&", "Digit7" },     { "8*", "Digit8" },
            { "9(", "Digit9" },      { "0)", "Digit0" },       { "-_", "Minus" },      { "=+", "Equal" },
            { "[{", "BracketLeft" }, { "]}", "BracketRight" }, { "\\|", "Backslash" }, { ";:", "Semicolon" },
            { "'\"", "Quote" },      { "`~", "Backquote" },    { ",<", "Comma" },      { ".>", "Period" },
            { "/?", "Slash" },
        } };

        constexpr std::array<std::string_view, 26> letters {
            "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM",
            "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
        };
    } // namespace

    std::string_view codeOfEvdev(unsigned code) noexcept
    {
        return find<&PhysicalKey::evdev>(code);
    }

    std::string_view codeOfScancode(unsigned scancode) noexcept
    {
        return find<&PhysicalKey::scancode>(scancode);
    }

    std::string_view codeOfMacKeyCode(unsigned keyCode) noexcept
    {
        return find<&PhysicalKey::mac>(keyCode);
    }

    std::string_view codeOfKey(std::string_view key) noexcept
    {
        if (key.size() == 1)
        {
            const char character = key.front();
            if (character >= 'a' && character <= 'z')
                return letters.at(static_cast<std::size_t>(character - 'a'));
            if (character >= 'A' && character <= 'Z')
                return letters.at(static_cast<std::size_t>(character - 'A'));
            if (character == ' ')
                return "Space";
            for (const auto& [characters, code] : typed)
                if (characters.find(character) != std::string_view::npos)
                    return code;
            return {};
        }
        if (key == "Shift" || key == "Control" || key == "Alt" || key == "Meta")
        {
            for (const PhysicalKey& physical : keys)
                if (physical.code.starts_with(key) && physical.code.ends_with("Left"))
                    return physical.code;
        }
        if (key == "AltGraph")
            return "AltRight";
        // A named key the Web names its key after ("Enter", "ArrowLeft", "F5").
        for (const PhysicalKey& physical : keys)
            if (physical.code == key)
                return physical.code;
        return {};
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
