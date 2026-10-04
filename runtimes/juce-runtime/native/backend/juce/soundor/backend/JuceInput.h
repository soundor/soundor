#pragma once

#include <soundor/ui/Input.h>

#include <juce_gui_basics/juce_gui_basics.h>

#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // JUCE input in Soundor's normalized, Web-shaped form (see ui/Input.h).

    [[nodiscard]] ui::Modifiers modifiersOf(const juce::ModifierKeys& keys) noexcept;

    // The buttons held, as MouseEvent.buttons: 1 primary, 2 secondary, 4 middle.
    [[nodiscard]] unsigned buttonsOf(const juce::ModifierKeys& keys) noexcept;

    // A JUCE mouse event as pointer input. For Down, the pressed button is the
    // one reported; for Up, JUCE's modifiers still hold the released button.
    [[nodiscard]] ui::PointerInput pointerInput(const juce::MouseEvent& event, ui::PointerInput::Phase phase);

    // Smooth (trackpad) scrolling in pixels; a stepped wheel in lines, three
    // per notch, as browsers report them.
    [[nodiscard]] ui::WheelInput wheelInput(juce::Point<float> position, const juce::ModifierKeys& modifiers,
                                            const juce::MouseWheelDetails& wheel);

    // KeyboardEvent.key for a key press: its character, or the Web name of a
    // named key ("Enter", "ArrowLeft", "F5"). Empty for keys with neither.
    [[nodiscard]] std::string keyName(const juce::KeyPress& key);

    // The text a key press types, or empty (named keys, shortcuts).
    [[nodiscard]] std::string typedText(const juce::KeyPress& key);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
