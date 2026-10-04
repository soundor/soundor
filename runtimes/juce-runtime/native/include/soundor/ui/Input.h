#pragma once

#include <soundor/Config.h>

#include <cstdint>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Input a backend hands to a Surface, already normalized: positions in
    // logical pixels relative to the view's top-left corner, buttons and keys
    // named as on the Web, so plugin code sees the same events on every host.

    enum Modifier : std::uint8_t
    {
        Shift = 1 << 0,
        Control = 1 << 1,
        Alt = 1 << 2,  // Option on macOS
        Meta = 1 << 3, // Command on macOS, the Windows key on Windows
    };
    using Modifiers = std::uint8_t;

    struct Point
    {
        float x = 0;
        float y = 0;
    };

    enum class PointerType : std::uint8_t
    {
        Mouse,
        Pen,
        Touch,
    };

    struct PointerInput
    {
        enum class Phase : std::uint8_t
        {
            Down,
            Move,
            Up,
            // The pointer left the view (hover ends; a pressed pointer stays
            // captured).
            Leave,
            // The pointer went away without an up (e.g. the host took the mouse).
            Cancel,
        };

        Phase phase = Phase::Move;
        Point position;
        // Distinguishes simultaneous pointers (touches); the mouse is 1.
        int pointerId = 1;
        PointerType type = PointerType::Mouse;
        // The button that changed, as MouseEvent.button: 0 primary, 1 middle,
        // 2 secondary. -1 for a move.
        int button = -1;
        // The buttons held after this input, as MouseEvent.buttons: 1 primary,
        // 2 secondary, 4 middle.
        unsigned buttons = 0;
        Modifiers modifiers = 0;
        float pressure = 0;
    };

    struct WheelInput
    {
        enum class Unit : std::uint8_t
        {
            Pixel,
            Line,
        };

        Point position;
        // Positive deltaY scrolls down, positive deltaX right (as on the Web).
        float deltaX = 0;
        float deltaY = 0;
        Unit unit = Unit::Pixel;
        Modifiers modifiers = 0;
    };

    struct KeyInput
    {
        bool down = true;
        // KeyboardEvent.key: the character ("a", "A", "1") or a named key
        // ("Enter", "ArrowLeft", "Backspace", "F5"...).
        std::string key;
        bool repeat = false;
        Modifiers modifiers = 0;
    };

    // Text the user entered (typed characters, IME composition results),
    // delivered to the focused node as a `beforeinput` event.
    struct TextInput
    {
        std::string text;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
