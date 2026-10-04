#include "JuceInput.h"

#include <array>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        // JUCE's wheel delta for one notch of a stepped wheel, per platform.
#if JUCE_WINDOWS
        constexpr float wheelNotch = 120.0f / 256.0f;
#elif JUCE_MAC
        constexpr float wheelNotch = 10.0f / 256.0f;
#else
        constexpr float wheelNotch = 50.0f / 256.0f;
#endif
        // JUCE scales precise (trackpad) deltas, in points, by 0.5 / 256.
        constexpr float pixelsPerSmoothDelta = 512.0f;
        constexpr float linesPerNotch = 3.0f;

        ui::PointerType pointerTypeOf(juce::MouseInputSource::InputSourceType type) noexcept
        {
            switch (type)
            {
                case juce::MouseInputSource::InputSourceType::pen:
                    return ui::PointerType::Pen;
                case juce::MouseInputSource::InputSourceType::touch:
                    return ui::PointerType::Touch;
                case juce::MouseInputSource::InputSourceType::mouse:
                    break;
            }
            return ui::PointerType::Mouse;
        }

        // MouseEvent.button of the first button held: 0 primary, 1 middle, 2 secondary.
        int buttonOf(const juce::ModifierKeys& keys) noexcept
        {
            if (keys.isLeftButtonDown())
                return 0;
            if (keys.isMiddleButtonDown())
                return 1;
            if (keys.isRightButtonDown())
                return 2;
            return -1;
        }

        std::string utf8(juce::juce_wchar character)
        {
            return juce::String::charToString(character).toStdString();
        }
    } // namespace

    ui::Modifiers modifiersOf(const juce::ModifierKeys& keys) noexcept
    {
        ui::Modifiers modifiers = 0;
        if (keys.isShiftDown())
            modifiers |= ui::Modifier::Shift;
        if (keys.isCtrlDown())
            modifiers |= ui::Modifier::Control;
        if (keys.isAltDown())
            modifiers |= ui::Modifier::Alt;
#if JUCE_MAC
        if (keys.isCommandDown())
            modifiers |= ui::Modifier::Meta;
#endif
        return modifiers;
    }

    unsigned buttonsOf(const juce::ModifierKeys& keys) noexcept
    {
        return (keys.isLeftButtonDown() ? 1u : 0u) | (keys.isRightButtonDown() ? 2u : 0u)
               | (keys.isMiddleButtonDown() ? 4u : 0u);
    }

    ui::PointerInput pointerInput(const juce::MouseEvent& event, ui::PointerInput::Phase phase)
    {
        ui::PointerInput input;
        input.phase = phase;
        input.position = { event.position.x, event.position.y };
        // The mouse is pointer 1, as on the Web; touches follow.
        input.pointerId = event.source.getIndex() + 1;
        input.type = pointerTypeOf(event.source.getType());
        input.modifiers = modifiersOf(event.mods);
        input.pressure = event.isPressureValid() ? event.pressure : 0.0f;
        switch (phase)
        {
            case ui::PointerInput::Phase::Down:
                input.button = buttonOf(event.mods);
                input.buttons = buttonsOf(event.mods);
                if (input.pressure == 0.0f)
                    input.pressure = 0.5f;
                break;
            case ui::PointerInput::Phase::Up:
                // JUCE reports up once every button is released, with the
                // released buttons still in its modifiers.
                input.button = buttonOf(event.mods);
                input.buttons = 0;
                input.pressure = 0;
                break;
            case ui::PointerInput::Phase::Move:
            case ui::PointerInput::Phase::Leave:
            case ui::PointerInput::Phase::Cancel:
                input.buttons = buttonsOf(event.mods);
                if (input.buttons != 0 && input.pressure == 0.0f)
                    input.pressure = 0.5f;
                break;
        }
        return input;
    }

    ui::WheelInput wheelInput(juce::Point<float> position, const juce::ModifierKeys& modifiers,
                              const juce::MouseWheelDetails& wheel)
    {
        ui::WheelInput input;
        input.position = { position.x, position.y };
        input.modifiers = modifiersOf(modifiers);
        // JUCE's positive deltas scroll up and left; the Web's down and right.
        if (wheel.isSmooth)
        {
            input.unit = ui::WheelInput::Unit::Pixel;
            input.deltaX = -wheel.deltaX * pixelsPerSmoothDelta;
            input.deltaY = -wheel.deltaY * pixelsPerSmoothDelta;
        }
        else
        {
            input.unit = ui::WheelInput::Unit::Line;
            input.deltaX = -wheel.deltaX / wheelNotch * linesPerNotch;
            input.deltaY = -wheel.deltaY / wheelNotch * linesPerNotch;
        }
        return input;
    }

    std::string keyName(const juce::KeyPress& key)
    {
        const int code = key.getKeyCode();
        static const std::array<std::pair<int, const char*>, 22> named { {
            { juce::KeyPress::returnKey, "Enter" },
            { juce::KeyPress::escapeKey, "Escape" },
            { juce::KeyPress::tabKey, "Tab" },
            { juce::KeyPress::backspaceKey, "Backspace" },
            { juce::KeyPress::deleteKey, "Delete" },
            { juce::KeyPress::spaceKey, " " },
            { juce::KeyPress::leftKey, "ArrowLeft" },
            { juce::KeyPress::rightKey, "ArrowRight" },
            { juce::KeyPress::upKey, "ArrowUp" },
            { juce::KeyPress::downKey, "ArrowDown" },
            { juce::KeyPress::homeKey, "Home" },
            { juce::KeyPress::endKey, "End" },
            { juce::KeyPress::pageUpKey, "PageUp" },
            { juce::KeyPress::pageDownKey, "PageDown" },
            { juce::KeyPress::insertKey, "Insert" },
            { juce::KeyPress::playKey, "MediaPlayPause" },
            { juce::KeyPress::stopKey, "MediaStop" },
            { juce::KeyPress::fastForwardKey, "MediaFastForward" },
            { juce::KeyPress::rewindKey, "MediaRewind" },
            { juce::KeyPress::numberPadDecimalPoint, "." },
            { juce::KeyPress::numberPadEquals, "=" },
            { juce::KeyPress::numberPadDelete, "Delete" },
        } };
        for (const auto& [keyCode, name] : named)
            if (code == keyCode)
                return name;

        static const std::array<int, 24> functionKeys {
            juce::KeyPress::F1Key,  juce::KeyPress::F2Key,  juce::KeyPress::F3Key,  juce::KeyPress::F4Key,
            juce::KeyPress::F5Key,  juce::KeyPress::F6Key,  juce::KeyPress::F7Key,  juce::KeyPress::F8Key,
            juce::KeyPress::F9Key,  juce::KeyPress::F10Key, juce::KeyPress::F11Key, juce::KeyPress::F12Key,
            juce::KeyPress::F13Key, juce::KeyPress::F14Key, juce::KeyPress::F15Key, juce::KeyPress::F16Key,
            juce::KeyPress::F17Key, juce::KeyPress::F18Key, juce::KeyPress::F19Key, juce::KeyPress::F20Key,
            juce::KeyPress::F21Key, juce::KeyPress::F22Key, juce::KeyPress::F23Key, juce::KeyPress::F24Key,
        };
        for (std::size_t i = 0; i < functionKeys.size(); ++i)
            if (code == functionKeys[i])
                return "F" + std::to_string(i + 1);

        const juce::juce_wchar character = key.getTextCharacter();
        if (character >= 32 && character != 127)
            return utf8(character);
        // A letter or digit pressed with a modifier that suppressed its text.
        const auto ascii = static_cast<juce::juce_wchar>(code);
        if (code > 0 && code < 128 && juce::CharacterFunctions::isLetterOrDigit(ascii))
            return utf8(key.getModifiers().isShiftDown() ? juce::CharacterFunctions::toUpperCase(ascii)
                                                         : juce::CharacterFunctions::toLowerCase(ascii));
        return {};
    }

    std::string typedText(const juce::KeyPress& key)
    {
        // Shortcuts type nothing; AltGr (Ctrl+Alt outside macOS) still types.
        const juce::ModifierKeys mods = key.getModifiers();
#if JUCE_MAC
        if (mods.isCommandDown() || mods.isCtrlDown())
            return {};
#else
        if (mods.isCtrlDown() && ! mods.isAltDown())
            return {};
#endif
        const juce::juce_wchar character = key.getTextCharacter();
        if (character < 32 || character == 127)
            return {};
        return utf8(character);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
