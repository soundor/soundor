#pragma once

#include <soundor/input/Platform.h>

#include <cstdint>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
{
    // NSEventModifierFlags' device-independent bits. Kept free of AppKit so
    // normalization can be checked on every build platform.
    [[nodiscard]] ui::Modifiers modifiersOf(std::uint64_t flags) noexcept;
    [[nodiscard]] int buttonOf(unsigned nativeButton) noexcept;
    [[nodiscard]] unsigned buttonMask(unsigned nativeButton) noexcept;
    // The layout's character, with the virtual key code used only for named
    // keys. Held keys are paired by virtual key code, never by this name.
    [[nodiscard]] std::string keyName(unsigned keyCode, std::string characters, std::string ignoringModifiers);
    [[nodiscard]] ui::WheelInput wheelInput(double x, double y, bool precise, float scale, ui::Point position,
                                            ui::Modifiers modifiers) noexcept;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
