#include <soundor/input/Platform.h>

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
#endif
#include <doctest/doctest.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <windows.h>

#include <algorithm>
#include <array>

using namespace soundor;

namespace
{
    // The generated editor's focus/input policy, on a real JUCE peer. Its
    // Windows keyboard hook runs during PeekMessage, before our HWND subclass.
    struct Editor final : juce::Component
    {
        Editor()
        {
            setWantsKeyboardFocus(true);
            setSize(200, 100);
            addToDesktop(0);
            setVisible(true);
            window = static_cast<HWND>(getPeer()->getNativeHandle());
            native = input::createPlatformInput({ .view = { window } });
            REQUIRE(native != nullptr);
            native->setGeometry({ .width = 200, .height = 100 });
            giveAwayKeyboardFocus();
        }
        ~Editor() override
        {
            native.reset();
            removeFromDesktop();
        }
        void focusGained(FocusChangeType) override
        {
            if (native != nullptr)
            {
                giveAwayKeyboardFocus();
                native->requestFocus();
            }
        }
        bool keyPressed(const juce::KeyPress&) override
        {
            ++translatedKeys;
            return false;
        }
        void mouseDown(const juce::MouseEvent&) override { ++translatedPresses; }
        std::vector<input::Event> read()
        {
            std::vector<input::Event> events;
            native->read(events);
            std::erase_if(events, [](const auto& event) { return std::holds_alternative<input::FocusChange>(event); });
            return events;
        }
        HWND window = nullptr;
        std::unique_ptr<input::PlatformInput> native;
        int translatedKeys = 0;
        int translatedPresses = 0;
    };
} // namespace

TEST_CASE("native Windows keys bypass JUCE's pre-dispatch translator, including after programmatic focus")
{
    struct KeyboardState
    {
        KeyboardState()
        {
            REQUIRE(GetKeyboardState(saved.data()));
            std::array<BYTE, 256> clean {};
            REQUIRE(SetKeyboardState(clean.data()));
        }
        ~KeyboardState() { SetKeyboardState(saved.data()); }
        KeyboardState(const KeyboardState&) = delete;
        KeyboardState& operator=(const KeyboardState&) = delete;
        std::array<BYTE, 256> saved {};
    } restore;
    Editor editor;
    for (int attempt = 0; attempt < 2; ++attempt)
    {
        editor.grabKeyboardFocus();
        REQUIRE(GetFocus() == editor.window);
        REQUIRE(juce::Component::getCurrentlyFocusedComponent() == nullptr);
        editor.read();
        editor.native->setTextInputFocused(true);
        REQUIRE(PostMessageW(editor.window, WM_KEYDOWN, 'A', 0x001E0001));
        REQUIRE(PostMessageW(editor.window, WM_KEYUP, 'A', static_cast<LPARAM>(0xC01E0001U)));
        MSG message {};
        // This is the host's usual dispatch sequence, including JUCE's installed
        // WH_GETMESSAGE hook and the WM_CHAR posted by TranslateMessage.
        while (PeekMessageW(&message, editor.window, 0, 0, PM_REMOVE))
        {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        const auto events = editor.read();
        // WM_CHAR may follow the posted release, so preserve that native order
        // as a standalone text commit, rather than reordering it before key-up.
        REQUIRE(events.size() == 3);
        CHECK(std::get<input::KeyEvent>(events[0]).key.down);
        CHECK_FALSE(std::get<input::KeyEvent>(events[1]).key.down);
        CHECK(std::get<ui::TextInput>(events[2]).text == "a");
        CHECK(editor.translatedKeys == 0);
        SetFocus(nullptr);
    }
}

TEST_CASE("native Windows pointer messages are delivered once on a JUCE-owned HWND")
{
    Editor first;
    Editor second;
    // JUCE's hover hit test uses the desktop z-order at the message's screen position.
    second.setTopLeftPosition(first.getRight() + 20, first.getY());
    first.toFront(false);
    POINT screenPoint { 20, 30 };
    const LPARAM position = MAKELPARAM(screenPoint.x, screenPoint.y);
    REQUIRE(ClientToScreen(first.window, &screenPoint));
    REQUIRE(WindowFromPoint(screenPoint) == first.window);
    first.read();
    second.read();
    SendMessageW(first.window, WM_MOUSEMOVE, 0, position);
    CHECK(juce::Desktop::getInstance().getMainMouseSource().getComponentUnderMouse() == &first);
    SendMessageW(first.window, WM_LBUTTONDOWN, MK_LBUTTON, position);
    SendMessageW(first.window, WM_LBUTTONUP, 0, position);
    const auto events = first.read();
    REQUIRE(events.size() == 3);
    CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Move);
    CHECK(std::get<ui::PointerInput>(events[1]).phase == ui::PointerInput::Phase::Down);
    CHECK(std::get<ui::PointerInput>(events[2]).phase == ui::PointerInput::Phase::Up);
    CHECK(first.translatedPresses == 0);
    CHECK(second.read().empty());
    CHECK(second.translatedPresses == 0);
}
