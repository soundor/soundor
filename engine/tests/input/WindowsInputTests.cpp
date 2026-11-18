#include "a11y/windows/Uia.h"
#include "input/windows/WindowsInput.h"

#include <commctrl.h>
#include <doctest/doctest.h>
#include <imm.h>
#include <windowsx.h>

#include <algorithm>
#include <array>
#include <thread>

using namespace soundor;

namespace
{
    struct Window
    {
        Window()
        {
            handle = CreateWindowExW(0, L"STATIC", L"Input fixture", WS_POPUP | WS_VISIBLE, 100, 100, 400, 300, nullptr,
                                     nullptr, GetModuleHandleW(nullptr), nullptr);
            REQUIRE(handle != nullptr);
        }
        ~Window()
        {
            if (handle != nullptr)
                DestroyWindow(handle);
        }
        Window(const Window&) = delete;
        Window& operator=(const Window&) = delete;
        HWND handle = nullptr;
    };

    struct Fixture
    {
        Fixture()
        {
            adapter = input::createPlatformInput({ .view = { window.handle } });
            REQUIRE(adapter != nullptr);
            adapter->setGeometry({ .x = 20, .y = 30, .scale = 2, .width = 100, .height = 80 });
            read();
        }
        void focus()
        {
            adapter->requestFocus();
            REQUIRE(GetFocus() == window.handle);
            REQUIRE(adapter->focused());
            read();
        }
        void send(UINT message, WPARAM wParam = 0, LPARAM lParam = MAKELPARAM(40, 70))
        {
            SendMessageW(window.handle, message, wParam, lParam);
        }
        std::vector<input::Event> read()
        {
            std::vector<input::Event> events;
            adapter->read(events);
            return events;
        }
        std::vector<input::Event> inputEvents()
        {
            auto events = read();
            std::erase_if(events, [](const auto& event) { return std::holds_alternative<input::FocusChange>(event); });
            return events;
        }
        Window window;
        std::unique_ptr<input::PlatformInput> adapter;
    };

    struct Probe
    {
        explicit Probe(HWND target) : window(target)
        {
            REQUIRE(SetWindowSubclass(window, callback, reinterpret_cast<UINT_PTR>(this),
                                      reinterpret_cast<DWORD_PTR>(this)));
        }
        ~Probe() { RemoveWindowSubclass(window, callback, reinterpret_cast<UINT_PTR>(this)); }
        Probe(const Probe&) = delete;
        Probe& operator=(const Probe&) = delete;
        static LRESULT CALLBACK callback(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                         DWORD_PTR data)
        {
            auto* self = reinterpret_cast<Probe*>(data); // NOLINT(performance-no-int-to-ptr)
            if (message == WM_SYSKEYDOWN || (message == WM_KEYDOWN && wParam == VK_F10))
            {
                ++self->systemKeys;
                return 17;
            }
            if (message == WM_SETFOCUS && self->destroyOnFocus != nullptr)
                self->destroyOnFocus->reset();
            return DefSubclassProc(window, message, wParam, lParam);
        }
        HWND window;
        int systemKeys = 0;
        std::unique_ptr<input::PlatformInput>* destroyOnFocus = nullptr;
    };

    constexpr LPARAM aPress = 0x001E0001;
    constexpr LPARAM aRepeat = 0x401E0001;
    constexpr LPARAM aRelease = static_cast<LPARAM>(0xC01E0001U);
} // namespace

TEST_SUITE("native input: Win32 HWND")
{
    TEST_CASE("factory validates the native window and owning thread")
    {
        CHECK(input::createPlatformInput({}) == nullptr);
        Window window;
        bool rejected = false;
        std::thread other([&] { rejected = input::createPlatformInput({ .view = { window.handle } }) == nullptr; });
        other.join();
        CHECK(rejected);
    }

    TEST_CASE("movement and button chording preserve order and capture outside the editor")
    {
        Fixture f;
        f.send(WM_MOUSEMOVE, MK_SHIFT);
        f.send(WM_LBUTTONDOWN, MK_LBUTTON | MK_CONTROL);
        CHECK(GetCapture() == f.window.handle);
        f.send(WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(-10, 10));
        f.send(WM_RBUTTONDOWN, MK_LBUTTON | MK_RBUTTON);
        f.send(WM_LBUTTONUP, MK_RBUTTON);
        f.send(WM_RBUTTONUP);
        CHECK(GetCapture() != f.window.handle);
        const auto events = f.inputEvents();
        REQUIRE(events.size() == 7); // leave followed by the captured move
        const auto& move = std::get<ui::PointerInput>(events[0]);
        CHECK(move.position.x == 10);
        CHECK(move.position.y == 20);
        CHECK(move.modifiers == ui::Modifier::Shift);
        CHECK(std::get<ui::PointerInput>(events[1]).phase == ui::PointerInput::Phase::Down);
        CHECK(std::get<ui::PointerInput>(events[1]).modifiers == ui::Modifier::Control);
        CHECK(std::get<ui::PointerInput>(events[2]).phase == ui::PointerInput::Phase::Leave);
        CHECK(std::get<ui::PointerInput>(events[3]).position.x == -15);
        CHECK(std::get<ui::PointerInput>(events[4]).buttons == 3);
        CHECK(std::get<ui::PointerInput>(events[5]).buttons == 2);
        CHECK(std::get<ui::PointerInput>(events[6]).phase == ui::PointerInput::Phase::Up);
        CHECK(f.adapter->buttons() == 0);
    }

    TEST_CASE("normal capture release preserves the next double click's series")
    {
        Fixture f;
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        f.send(WM_LBUTTONUP);
        f.send(WM_LBUTTONDBLCLK, MK_LBUTTON);
        f.send(WM_LBUTTONUP);
        const auto events = f.inputEvents();
        REQUIRE(events.size() == 4);
        CHECK(std::get<ui::PointerInput>(events[0]).clicks == 1);
        CHECK(std::get<ui::PointerInput>(events[2]).clicks == 2);
    }

    TEST_CASE("middle and additional buttons are native, and leave never releases a drag")
    {
        Fixture f;
        f.send(WM_MBUTTONDOWN, MK_MBUTTON);
        f.send(WM_MOUSELEAVE);
        CHECK(f.adapter->buttons() == 4);
        f.send(WM_MBUTTONUP);
        f.send(WM_XBUTTONDOWN, MAKEWPARAM(MK_XBUTTON1, XBUTTON1));
        f.send(WM_XBUTTONUP, MAKEWPARAM(0, XBUTTON1));
        f.send(WM_XBUTTONDOWN, MAKEWPARAM(MK_XBUTTON2, XBUTTON2));
        f.send(WM_XBUTTONUP, MAKEWPARAM(0, XBUTTON2));
        const auto events = f.inputEvents();
        REQUIRE(events.size() == 7);
        CHECK(std::get<ui::PointerInput>(events[0]).button == 1);
        CHECK(std::get<ui::PointerInput>(events[1]).phase == ui::PointerInput::Phase::Leave);
        CHECK(std::get<ui::PointerInput>(events[3]).buttons == 8);
        CHECK(std::get<ui::PointerInput>(events[3]).button == 3);
        CHECK(std::get<ui::PointerInput>(events[5]).buttons == 16);
        CHECK(std::get<ui::PointerInput>(events[5]).button == 4);
    }

    TEST_CASE("capture loss cancels exactly once without a spurious mouse up")
    {
        Fixture f;
        Window other;
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        f.read();
        SetCapture(other.handle);
        const auto events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Cancel);
        CHECK(f.adapter->buttons() == 0);
        f.send(WM_LBUTTONUP);
        CHECK(f.inputEvents().empty());
        ReleaseCapture();
    }

    TEST_CASE("wheel messages convert screen coordinates and retain fractional axes")
    {
        Fixture f;
        POINT point { 40, 70 };
        REQUIRE(ClientToScreen(f.window.handle, &point));
        const LPARAM position = MAKELPARAM(point.x, point.y);
        f.send(WM_MOUSEWHEEL, MAKEWPARAM(MK_CONTROL, 1), position);
        f.send(WM_MOUSEHWHEEL, MAKEWPARAM(MK_SHIFT, 30), position);
        const auto events = f.read();
        REQUIRE(events.size() == 2);
        const auto& vertical = std::get<ui::WheelInput>(events[0]);
        CHECK(vertical.position.x == 10);
        CHECK(vertical.position.y == 20);
        CHECK(vertical.deltaY == doctest::Approx(-0.025));
        CHECK(vertical.modifiers == ui::Modifier::Control);
        CHECK(std::get<ui::WheelInput>(events[1]).deltaX == doctest::Approx(0.75));
        CHECK(std::get<ui::WheelInput>(events[1]).modifiers == ui::Modifier::Shift);
    }

    TEST_CASE("physical key and translated text stay paired, while repeats remain key downs")
    {
        Fixture f;
        f.focus();
        f.send(WM_KEYDOWN, 'A', aPress);
        f.send(WM_CHAR, 'a', aPress);
        f.send(WM_KEYDOWN, 'A', aRepeat);
        f.send(WM_CHAR, 'a', aRepeat);
        // A layout change can change the VK used for the same physical release.
        f.send(WM_KEYUP, 'Q', aRelease);
        const auto events = f.read();
        REQUIRE(events.size() == 3);
        const auto& first = std::get<input::KeyEvent>(events[0]);
        CHECK(first.typed == "a");
        CHECK_FALSE(first.key.repeat);
        CHECK(std::get<input::KeyEvent>(events[1]).key.repeat);
        CHECK_FALSE(std::get<input::KeyEvent>(events[2]).key.down);
        CHECK(std::get<input::KeyEvent>(events[2]).key.key == first.key.key);
    }

    TEST_CASE("dead-key identity and coalesced character repeats stay separate from committed text")
    {
        Fixture f;
        f.focus();
        f.send(WM_KEYDOWN, VK_OEM_7, 0x00280001);
        f.send(WM_DEADCHAR, 0x00B4, 0x00280001);
        f.send(WM_KEYUP, VK_OEM_7, static_cast<LPARAM>(0xC0280001U));
        auto events = f.read();
        REQUIRE(events.size() == 2);
        CHECK(std::get<input::KeyEvent>(events[0]).key.key == "Dead");
        CHECK(std::get<input::KeyEvent>(events[0]).typed.empty());
        CHECK(std::get<input::KeyEvent>(events[1]).key.key == "Dead");
        f.send(WM_KEYDOWN, 'A', aRepeat);
        f.send(WM_CHAR, 'a', 0x401E0003);
        events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<input::KeyEvent>(events[0]).key.repeat);
        CHECK(std::get<input::KeyEvent>(events[0]).key.key == "a");
        CHECK(std::get<input::KeyEvent>(events[0]).typed == "aaa");
    }

    TEST_CASE("sided modifiers keep independent press state and native modifier flags")
    {
        Fixture f;
        f.focus();
        struct KeyboardState
        {
            KeyboardState() { REQUIRE(GetKeyboardState(saved.data())); }
            ~KeyboardState() { SetKeyboardState(saved.data()); }
            KeyboardState(const KeyboardState&) = delete;
            KeyboardState& operator=(const KeyboardState&) = delete;
            std::array<BYTE, 256> saved {};
        } restore;
        std::array<BYTE, 256> state {};
        state[VK_SHIFT] = state[VK_LSHIFT] = state[VK_RSHIFT] = 0x80;
        REQUIRE(SetKeyboardState(state.data()));
        f.send(WM_KEYDOWN, VK_SHIFT, 0x002A0001);
        f.send(WM_KEYDOWN, VK_SHIFT, 0x00360001);
        state[VK_LSHIFT] = 0;
        REQUIRE(SetKeyboardState(state.data()));
        f.send(WM_KEYUP, VK_SHIFT, static_cast<LPARAM>(0xC02A0001U));
        state[VK_SHIFT] = state[VK_RSHIFT] = 0;
        REQUIRE(SetKeyboardState(state.data()));
        f.send(WM_KEYUP, VK_SHIFT, static_cast<LPARAM>(0xC0360001U));
        const auto events = f.read();
        REQUIRE(events.size() == 4);
        CHECK(std::get<input::KeyEvent>(events[0]).key.key == "Shift");
        CHECK(std::get<input::KeyEvent>(events[0]).key.modifiers == ui::Modifier::Shift);
        CHECK(std::get<input::KeyEvent>(events[1]).key.down);
        CHECK_FALSE(std::get<input::KeyEvent>(events[2]).key.down);
        CHECK(std::get<input::KeyEvent>(events[2]).key.modifiers == ui::Modifier::Shift);
        CHECK_FALSE(std::get<input::KeyEvent>(events[3]).key.down);
        CHECK(std::get<input::KeyEvent>(events[3]).key.modifiers == 0);
    }

    TEST_CASE("interleaved wheel and Unicode commits preserve arrival order")
    {
        Fixture f;
        f.focus();
        f.adapter->setTextInputFocused(true);
        f.send(WM_KEYDOWN, 'A', aPress);
        POINT point { 40, 70 };
        ClientToScreen(f.window.handle, &point);
        f.send(WM_MOUSEWHEEL, MAKEWPARAM(0, 1), MAKELPARAM(point.x, point.y));
        f.send(WM_CHAR, 'a', aPress);
        const auto events = f.read();
        REQUIRE(events.size() == 3);
        CHECK(std::get<input::KeyEvent>(events[0]).typed.empty());
        CHECK(std::holds_alternative<ui::WheelInput>(events[1]));
        CHECK(std::get<ui::TextInput>(events[2]).text == "a");
    }

    TEST_CASE("Unicode composition commits and late callbacks do not reach a blurred editor")
    {
        Fixture f;
        f.focus();
        f.adapter->setTextInputFocused(true);
        f.send(WM_IME_STARTCOMPOSITION, 0, 0);
        f.send(WM_IME_CHAR, 0xD83D, 0);
        f.send(WM_IME_CHAR, 0xDE00, 0);
        f.send(WM_IME_ENDCOMPOSITION, 0, 0);
        auto events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::TextInput>(events[0]).text == "😀");
        f.send(WM_UNICHAR, 0x65E5, 0);
        events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::TextInput>(events[0]).text == "日");
        SetFocus(nullptr);
        f.read();
        f.send(WM_IME_CHAR, 'x', 0);
        f.send(WM_CHAR, 'x', aPress);
        CHECK(f.read().empty());
    }

    TEST_CASE("focus loss releases held keys and capture before the focus notification")
    {
        Fixture f;
        f.focus();
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        f.send(WM_KEYDOWN, 'A', aPress);
        f.read();
        SetFocus(nullptr);
        const auto events = f.read();
        REQUIRE(events.size() == 3);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Cancel);
        CHECK_FALSE(std::get<input::KeyEvent>(events[1]).key.down);
        CHECK_FALSE(std::get<input::FocusChange>(events[2]).focused);
        std::vector<input::Event> ended;
        f.adapter->cancel(ended);
        CHECK(ended.empty());
        f.focus();
    }

    TEST_CASE("suspension is idempotent and resumption starts clean input")
    {
        Fixture f;
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        f.read();
        std::vector<input::Event> ended;
        f.adapter->setSuspended(true, ended);
        REQUIRE_FALSE(ended.empty());
        CHECK(std::get<ui::PointerInput>(ended[0]).phase == ui::PointerInput::Phase::Cancel);
        ended.clear();
        f.adapter->setSuspended(true, ended);
        CHECK(ended.empty());
        f.send(WM_MOUSEMOVE);
        f.send(WM_KEYDOWN, 'A', aPress);
        CHECK(f.inputEvents().empty());
        f.adapter->setSuspended(false, ended);
        f.read();
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        const auto events = f.inputEvents();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Down);
    }

    TEST_CASE("system shortcuts continue down the host subclass chain")
    {
        Fixture f;
        // Attach the observer below input, as a host's own WndProc would be.
        f.adapter.reset();
        Probe probe(f.window.handle);
        f.adapter = input::createPlatformInput({ .view = { f.window.handle } });
        REQUIRE(f.adapter != nullptr);
        f.focus();
        CHECK(SendMessageW(f.window.handle, WM_SYSKEYDOWN, VK_F4, 0x203E0001) == 17);
        CHECK(SendMessageW(f.window.handle, WM_KEYDOWN, VK_F10, 0x00440001) == 17);
        CHECK(probe.systemKeys == 2);
        const auto events = f.read();
        REQUIRE(events.size() == 2);
        CHECK(std::get<input::KeyEvent>(events[0]).key.key == "F4");
        CHECK(std::get<input::KeyEvent>(events[1]).key.key == "F10");
    }

    TEST_CASE("the subclass survives synchronous editor destruction during focus acquisition")
    {
        Fixture f;
        SetFocus(nullptr);
        f.read();
        Probe probe(f.window.handle);
        probe.destroyOnFocus = &f.adapter;
        f.send(WM_LBUTTONDOWN, MK_LBUTTON);
        CHECK(f.adapter == nullptr);
        CHECK(GetCapture() != f.window.handle);
        CHECK(IsWindow(f.window.handle));
        probe.destroyOnFocus = nullptr;
        f.adapter = input::createPlatformInput({ .view = { f.window.handle } });
        REQUIRE(f.adapter != nullptr);
        f.read();
        f.send(WM_MOUSEMOVE);
        REQUIRE(f.inputEvents().size() == 1);
    }

    TEST_CASE("IME association is private to the editor and restored when the adapter detaches")
    {
        Window window;
        const HIMC original = ImmGetContext(window.handle);
        if (original != nullptr)
            ImmReleaseContext(window.handle, original);
        auto adapter = input::createPlatformInput({ .view = { window.handle } });
        REQUIRE(adapter != nullptr);
        adapter->setTextInputFocused(true);
        const HIMC owned = ImmGetContext(window.handle);
        REQUIRE(owned != nullptr);
        CHECK(owned != original);
        ImmReleaseContext(window.handle, owned);
        adapter.reset();
        const HIMC restored = ImmGetContext(window.handle);
        CHECK(restored == original);
        if (restored != nullptr)
            ImmReleaseContext(window.handle, restored);
    }

    TEST_CASE("independent editors, destruction orders and accessibility subclasses coexist")
    {
        Fixture other;
        for (int i = 0; i < 4; ++i)
        {
            Fixture f;
            auto accessibility = a11y::createPlatformAccessibility({ { f.window.handle, nullptr }, "Editor" });
            REQUIRE(accessibility != nullptr);
            SendMessageW(f.window.handle, WM_GETOBJECT, 0, UiaRootObjectId);
            CHECK(accessibility->active());
            f.send(WM_LBUTTONDOWN, MK_LBUTTON);
            CHECK(other.inputEvents().empty());
            f.read();
            HIMC owned = ImmGetContext(f.window.handle);
            if (owned != nullptr)
                ImmReleaseContext(f.window.handle, owned);
            if (i % 2 == 0)
            {
                DestroyWindow(f.window.handle);
                f.window.handle = nullptr;
                const auto ended = f.read();
                REQUIRE_FALSE(ended.empty());
                CHECK(std::get<ui::PointerInput>(ended[0]).phase == ui::PointerInput::Phase::Cancel);
                CHECK_FALSE(f.adapter->focused());
                CHECK_FALSE(accessibility->active());
                f.adapter.reset();
            }
            else
            {
                f.adapter.reset();
                CHECK(IsWindow(f.window.handle));
                CHECK(accessibility->active());
                // No native input callback remains on this still-live HWND.
                SendMessageW(f.window.handle, WM_MOUSEMOVE, 0, MAKELPARAM(40, 70));
                f.adapter = input::createPlatformInput({ .view = { f.window.handle } });
                REQUIRE(f.adapter != nullptr);
            }
        }
    }
}
