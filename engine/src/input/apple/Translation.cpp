#include "input/apple/Translation.h"

#include <array>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
{
    ui::Modifiers modifiersOf(std::uint64_t flags) noexcept
    {
        return static_cast<ui::Modifiers>(((flags & (1ULL << 17)) != 0 ? ui::Modifier::Shift : 0)
                                          | ((flags & (1ULL << 18)) != 0 ? ui::Modifier::Control : 0)
                                          | ((flags & (1ULL << 19)) != 0 ? ui::Modifier::Alt : 0)
                                          | ((flags & (1ULL << 20)) != 0 ? ui::Modifier::Meta : 0));
    }

    int buttonOf(unsigned nativeButton) noexcept
    {
        switch (nativeButton)
        {
            case 0:
                return 0;
            case 1:
                return 2;
            case 2:
                return 1;
            default:
                return -1;
        }
    }

    unsigned buttonMask(unsigned nativeButton) noexcept
    {
        return nativeButton < 3 ? (1U << nativeButton) : 0;
    }

    std::string keyName(unsigned keyCode, std::string characters, std::string ignoringModifiers)
    {
        static constexpr std::array<std::pair<unsigned, const char*>, 48> named { {
            { 36, "Enter" },   { 48, "Tab" },        { 51, "Backspace" },    { 53, "Escape" },     { 54, "Meta" },
            { 55, "Meta" },    { 56, "Shift" },      { 57, "CapsLock" },     { 58, "Alt" },        { 59, "Control" },
            { 60, "Shift" },   { 61, "Alt" },        { 62, "Control" },      { 63, "Fn" },         { 64, "F17" },
            { 76, "Enter" },   { 79, "F18" },        { 80, "F19" },          { 90, "F20" },        { 96, "F5" },
            { 97, "F6" },      { 98, "F7" },         { 99, "F3" },           { 100, "F8" },        { 101, "F9" },
            { 103, "F11" },    { 105, "F13" },       { 106, "F16" },         { 107, "F14" },       { 109, "F10" },
            { 111, "F12" },    { 113, "F15" },       { 114, "Insert" },      { 115, "Home" },      { 116, "PageUp" },
            { 117, "Delete" }, { 118, "F4" },        { 119, "End" },         { 120, "F2" },        { 121, "PageDown" },
            { 122, "F1" },     { 123, "ArrowLeft" }, { 124, "ArrowRight" },  { 125, "ArrowDown" }, { 126, "ArrowUp" },
            { 71, "Clear" },   { 81, "=" },          { 110, "ContextMenu" },
        } };
        for (const auto& [code, name] : named)
            if (code == keyCode)
                return name;
        const auto printable = [](const std::string& text)
        { return ! text.empty() && static_cast<unsigned char>(text.front()) >= 32 && text.front() != 127; };
        if (printable(characters))
            return characters;
        if (printable(ignoringModifiers))
            return ignoringModifiers;
        return "Dead";
    }

    ui::WheelInput wheelInput(double x, double y, bool precise, float scale, ui::Point position,
                              ui::Modifiers modifiers) noexcept
    {
        const double factor = precise ? 1.0 / (scale > 0 ? scale : 1) : ui::linesPerNotch;
        return { .position = position,
                 .deltaX = static_cast<float>(-x * factor),
                 .deltaY = static_cast<float>(-y * factor),
                 .unit = precise ? ui::WheelInput::Unit::Pixel : ui::WheelInput::Unit::Line,
                 .modifiers = modifiers };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
