#pragma once

#include <soundor/input/Platform.h>

#include <cstdint>
#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
{
    // Pure normalization; virtual-key values are the Win32 ABI's constants.
    [[nodiscard]] std::string namedKey(unsigned virtualKey);
    [[nodiscard]] unsigned physicalKey(unsigned virtualKey, std::uint32_t flags) noexcept;
    // KeyboardEvent.code of a physicalKey(): its scan code's, or for a
    // synthetic message without one, the virtual key's on a US layout.
    [[nodiscard]] std::string_view codeOf(unsigned physical);
    [[nodiscard]] ui::Point clientPosition(ui::Point client, const ViewGeometry& geometry) noexcept;
    [[nodiscard]] ui::WheelInput wheelInput(int delta, bool horizontal, ui::Point position,
                                            ui::Modifiers modifiers) noexcept;
    [[nodiscard]] std::string utf8(std::u16string_view text);
    [[nodiscard]] bool printable(char32_t character) noexcept;

    // WM_CHAR delivers UTF-16 code units, including separate surrogate messages.
    class Characters
    {
    public:
        [[nodiscard]] std::string append(char16_t character, bool filterControls = true);
        void reset() noexcept { high = 0; }

    private:
        char16_t high = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::win32
