#include "input/windows/Translation.h"

#include "input/KeyCodes.h"

#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
{
    namespace
    {
        void appendUtf8(std::string& text, char32_t code)
        {
            if (code < 0x80)
                text += static_cast<char>(code);
            else if (code < 0x800)
            {
                text += static_cast<char>(0xC0U | (code >> 6));
                text += static_cast<char>(0x80U | (code & 0x3FU));
            }
            else if (code < 0x10000)
            {
                text += static_cast<char>(0xE0U | (code >> 12));
                text += static_cast<char>(0x80U | ((code >> 6) & 0x3FU));
                text += static_cast<char>(0x80U | (code & 0x3FU));
            }
            else
            {
                text += static_cast<char>(0xF0U | (code >> 18));
                text += static_cast<char>(0x80U | ((code >> 12) & 0x3FU));
                text += static_cast<char>(0x80U | ((code >> 6) & 0x3FU));
                text += static_cast<char>(0x80U | (code & 0x3FU));
            }
        }
    } // namespace

    std::string namedKey(unsigned key)
    {
        constexpr std::pair<unsigned, const char*> names[] = { { 0x03, "Cancel" },
                                                               { 0x08, "Backspace" },
                                                               { 0x09, "Tab" },
                                                               { 0x0C, "Clear" },
                                                               { 0x0D, "Enter" },
                                                               { 0x10, "Shift" },
                                                               { 0x11, "Control" },
                                                               { 0x12, "Alt" },
                                                               { 0x13, "Pause" },
                                                               { 0x14, "CapsLock" },
                                                               { 0x1B, "Escape" },
                                                               { 0x20, " " },
                                                               { 0x21, "PageUp" },
                                                               { 0x22, "PageDown" },
                                                               { 0x23, "End" },
                                                               { 0x24, "Home" },
                                                               { 0x25, "ArrowLeft" },
                                                               { 0x26, "ArrowUp" },
                                                               { 0x27, "ArrowRight" },
                                                               { 0x28, "ArrowDown" },
                                                               { 0x29, "Select" },
                                                               { 0x2A, "PrintScreen" },
                                                               { 0x2B, "Execute" },
                                                               { 0x2C, "PrintScreen" },
                                                               { 0x2D, "Insert" },
                                                               { 0x2E, "Delete" },
                                                               { 0x2F, "Help" },
                                                               { 0x5B, "Meta" },
                                                               { 0x5C, "Meta" },
                                                               { 0x5D, "ContextMenu" },
                                                               { 0x90, "NumLock" },
                                                               { 0x91, "ScrollLock" },
                                                               { 0xA0, "Shift" },
                                                               { 0xA1, "Shift" },
                                                               { 0xA2, "Control" },
                                                               { 0xA3, "Control" },
                                                               { 0xA4, "Alt" },
                                                               { 0xA5, "Alt" },
                                                               { 0xAD, "AudioVolumeMute" },
                                                               { 0xAE, "AudioVolumeDown" },
                                                               { 0xAF, "AudioVolumeUp" },
                                                               { 0xB0, "MediaTrackNext" },
                                                               { 0xB1, "MediaTrackPrevious" },
                                                               { 0xB2, "MediaStop" },
                                                               { 0xB3, "MediaPlayPause" },
                                                               { 0xE5, "Process" } };
        for (const auto& [code, name] : names)
            if (key == code)
                return name;
        if (key >= 0x70 && key <= 0x87)
            return "F" + std::to_string(key - 0x70 + 1);
        return {};
    }

    unsigned physicalKey(unsigned virtualKey, std::uint32_t flags) noexcept
    {
        // Scan code plus the extended flag distinguishes right Control/Alt
        // and keypad Enter. Synthetic messages without a scan code use VK.
        const unsigned scan = (flags >> 16) & 0x1FFU;
        return scan != 0 ? scan : 0x200U + virtualKey;
    }

    std::string_view codeOf(unsigned physical)
    {
        if (physical < 0x200U)
            return codeOfScancode(((physical & 0x100U) != 0 ? 0xE000U : 0U) | (physical & 0xFFU));
        const unsigned virtualKey = physical - 0x200U;
        if ((virtualKey >= '0' && virtualKey <= '9') || (virtualKey >= 'A' && virtualKey <= 'Z'))
            return codeOfKey(std::string(1, static_cast<char>(virtualKey)));
        return codeOfKey(namedKey(virtualKey));
    }

    ui::Point clientPosition(ui::Point client, const ViewGeometry& geometry) noexcept
    {
        const float scale = geometry.scale > 0 ? geometry.scale : 1;
        return { (client.x - geometry.x) / scale, (client.y - geometry.y) / scale };
    }

    ui::WheelInput wheelInput(int delta, bool horizontal, ui::Point position, ui::Modifiers modifiers) noexcept
    {
        const float lines = static_cast<float>(delta) * ui::linesPerNotch / 120.0F;
        return { .position = position,
                 .deltaX = horizontal ? lines : 0,
                 .deltaY = horizontal ? 0 : -lines,
                 .unit = ui::WheelInput::Unit::Line,
                 .modifiers = modifiers };
    }

    bool printable(char32_t character) noexcept
    {
        return character >= 0x20 && character != 0x7F && (character < 0x80 || character >= 0xA0);
    }

    std::string Characters::append(char16_t character, bool filterControls)
    {
        std::string text;
        if (high != 0)
        {
            const auto previous = std::exchange(high, 0);
            if (character >= 0xDC00 && character <= 0xDFFF)
            {
                appendUtf8(text, 0x10000U + ((static_cast<char32_t>(previous) - 0xD800U) << 10)
                                     + (static_cast<char32_t>(character) - 0xDC00U));
                return text;
            }
            appendUtf8(text, 0xFFFD);
        }
        if (character >= 0xD800 && character <= 0xDBFF)
            high = character;
        else if (character >= 0xDC00 && character <= 0xDFFF)
            appendUtf8(text, 0xFFFD);
        else if (! filterControls || printable(character))
            appendUtf8(text, character);
        return text;
    }

    std::string utf8(std::u16string_view text)
    {
        Characters decoder;
        std::string result;
        for (const char16_t character : text)
            result += decoder.append(character, false);
        // Flush an incomplete high surrogate without adding a character.
        result += decoder.append(0);
        return result;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
