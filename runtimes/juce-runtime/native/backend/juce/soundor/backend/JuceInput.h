#pragma once

#include <soundor/ui/Input.h>
#include <soundor/ui/Surface.h>

#include <juce_gui_basics/juce_gui_basics.h>

#include <optional>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // JUCE input in Soundor's normalized, Web-shaped form (see ui/Input.h).

    [[nodiscard]] ui::Modifiers modifiersOf(const juce::ModifierKeys& keys) noexcept;

    // The buttons held, as MouseEvent.buttons: 1 primary, 2 secondary, 4 middle.
    [[nodiscard]] unsigned buttonsOf(const juce::ModifierKeys& keys) noexcept;

    // A JUCE mouse event as pointer input. For Down, the pressed button is the
    // one reported, and the press's click count JUCE's; for Up, JUCE's
    // modifiers still hold the released button. Its screen position is in the
    // event component's logical pixels.
    [[nodiscard]] ui::PointerInput pointerInput(const juce::MouseEvent& event, ui::PointerInput::Phase phase);

    // The platform's double-click time in milliseconds, where it has one:
    // macOS's and Windows' setting, or on Linux the XSETTINGS
    // Net/DoubleClickTime (GNOME's and KDE's). Nullopt where it cannot tell.
    [[nodiscard]] std::optional<int> platformDoubleClickTime();

    // Has JUCE count clicks (MouseEvent::getNumberOfClicks(), which
    // pointerInput() reports) by the platform's double-click time rather than
    // its fixed 400 ms. The setting is JUCE's, so the plugin's own: each
    // plugin links JUCE into itself.
    void useDoubleClickTime();

    // The platform's cursor for a resolved Soundor cursor (never Auto).
    [[nodiscard]] juce::MouseCursor mouseCursor(ui::Cursor cursor);

    // The platform's arrow, which Cursor::Default shows. On X11 it is the
    // theme's arrow rather than JUCE's NormalCursor, which shows whatever the
    // host's window shows (JuceCursor.cpp).
    [[nodiscard]] juce::MouseCursor arrowCursor();

    // Smooth (trackpad) scrolling in pixels; a stepped wheel in lines, three
    // per notch, as browsers report them.
    [[nodiscard]] ui::WheelInput wheelInput(juce::Point<float> position, const juce::ModifierKeys& modifiers,
                                            const juce::MouseWheelDetails& wheel);

    // KeyboardEvent.key for a key press: its character, or the Web name of a
    // named key ("Enter", "ArrowLeft", "F5"). Empty for keys with neither.
    [[nodiscard]] std::string keyName(const juce::KeyPress& key);

    // The text a key press types, or empty (named keys, shortcuts).
    [[nodiscard]] std::string typedText(const juce::KeyPress& key);

    // The system clipboard, for text inputs.
    class JuceClipboard final : public ui::Clipboard
    {
    public:
        std::string readText() override;
        void writeText(std::string text) override;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
