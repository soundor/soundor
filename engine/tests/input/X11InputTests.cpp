// Native X11 input against a real X server (Xvfb in CI), with real input
// from XTest. The view is made by a connection of its own that selects the
// core events JUCE selects on a peer, standing in for the framework: Soundor
// reads the view's input on its own connection, the framework none of it.

#include "X11TestSupport.h"

#include <soundor/input/Platform.h>

#include <algorithm>
#include <chrono>
#include <clocale>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <variant>
#include <vector>

using namespace soundor;
using namespace soundor::input;

namespace
{
    using Events = std::vector<Event>;

    // The framework's connection and the view it shows the editor in.
    class Framework
    {
    public:
        Framework() : display(XOpenDisplay(nullptr)) {}
        ~Framework()
        {
            if (display != nullptr)
                XCloseDisplay(display);
        }
        Framework(const Framework&) = delete;
        Framework& operator=(const Framework&) = delete;

        [[nodiscard]] bool available() const noexcept { return display != nullptr; }

        [[nodiscard]] Window createView(int x, int y, int width, int height) const
        {
            const Window view =
                XCreateSimpleWindow(display, DefaultRootWindow(display), x, y, static_cast<unsigned>(width),
                                    static_cast<unsigned>(height), 0, 0, 0);
            // As JUCE's peers do (juce_XWindowSystem_linux.cpp, getAllEventsMask()).
            XSelectInput(display, view,
                         KeyPressMask | KeyReleaseMask | EnterWindowMask | LeaveWindowMask | PointerMotionMask
                             | KeymapStateMask | ExposureMask | StructureNotifyMask | FocusChangeMask
                             | PropertyChangeMask | ButtonPressMask | ButtonReleaseMask);
            XMapWindow(display, view);
            XSync(display, False);
            return view;
        }

        void focus(Window window) const
        {
            XSetInputFocus(display, window, RevertToParent, CurrentTime);
            XSync(display, False);
        }

        // What the framework received so far, forgotten.
        void forgetItsInput() const { static_cast<void>(inputTheFrameworkGot()); }

        // The core input events the framework received since the last call.
        [[nodiscard]] std::vector<int> inputTheFrameworkGot() const
        {
            std::vector<int> types;
            XSync(display, False);
            while (XPending(display) > 0)
            {
                XEvent event {};
                XNextEvent(display, &event);
                if (event.type == ButtonPress || event.type == ButtonRelease || event.type == MotionNotify
                    || ((event.type == KeyPress || event.type == KeyRelease) && event.xany.send_event == 0))
                    types.push_back(event.type);
            }
            return types;
        }

        // Real input, as the user's.
        void moveTo(int x, int y) const
        {
            XTestFakeMotionEvent(display, -1, x, y, CurrentTime);
            XSync(display, False);
        }
        void button(unsigned button, bool press) const
        {
            XTestFakeButtonEvent(display, button, press ? True : False, CurrentTime);
            XSync(display, False);
        }
        void click(unsigned which) const
        {
            button(which, true);
            button(which, false);
        }
        void key(KeySym keysym, bool press) const
        {
            XTestFakeKeyEvent(display, XKeysymToKeycode(display, keysym), press ? True : False, CurrentTime);
            XSync(display, False);
        }
        void type(KeySym keysym) const
        {
            key(keysym, true);
            key(keysym, false);
        }

        Display* display;
    };

    void* handle(Window window)
    {
        return reinterpret_cast<void*>(static_cast<std::uintptr_t>(window)); // NOLINT(performance-no-int-to-ptr)
    }

    std::unique_ptr<PlatformInput> open(Window view,
                                        std::chrono::milliseconds doubleClick = std::chrono::milliseconds(400))
    {
        std::string failure;
        auto input = createPlatformInput({ .view = { handle(view) }, .doubleClickTime = doubleClick }, &failure);
        INFO(failure);
        REQUIRE(input != nullptr);
        CHECK(input->fileDescriptor() >= 0);
        return input;
    }

    // Reads until `done` says so (or two seconds pass), with what was read.
    Events readUntil(PlatformInput& input, const std::function<bool(const Events&)>& done)
    {
        Events events;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (std::chrono::steady_clock::now() < deadline)
        {
            input.read(events);
            if (done(events))
                break;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        return events;
    }

    // Reads for a moment: what arrives without waiting for something in particular.
    Events settle(PlatformInput& input)
    {
        Events events;
        for (int i = 0; i < 25; ++i)
        {
            input.read(events);
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        return events;
    }

    void append(Events& events, const Events& more)
    {
        events.insert(events.end(), more.begin(), more.end());
    }

    template <typename T>
    std::vector<T> only(const Events& events)
    {
        std::vector<T> found;
        for (const Event& event : events)
            if (const auto* one = std::get_if<T>(&event))
                found.push_back(*one);
        return found;
    }

    std::vector<ui::PointerInput> pointers(const Events& events)
    {
        return only<ui::PointerInput>(events);
    }

    bool has(const Events& events, ui::PointerInput::Phase phase)
    {
        for (const auto& pointer : pointers(events))
            if (pointer.phase == phase)
                return true;
        return false;
    }

    std::vector<std::string> keys(const Events& events)
    {
        std::vector<std::string> found;
        for (const auto& key : only<KeyEvent>(events))
            found.push_back((key.key.down ? "down " : "up ") + key.key.key + (key.key.repeat ? " (repeat)" : ""));
        return found;
    }

#define SOUNDOR_REQUIRE_DISPLAY(framework)                                                                             \
    if (! (framework).available())                                                                                     \
    {                                                                                                                  \
        MESSAGE("no X11 display: native input tests skipped");                                                         \
        return;                                                                                                        \
    }
} // namespace

TEST_SUITE("native input: X11 (XTest)")
{
    TEST_CASE("a press, a drag out of the view and a release reach Soundor once, and the framework not at all")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(100, 100, 200, 160);
        auto input = open(view);
        framework.forgetItsInput();

        framework.moveTo(150, 140);
        Events events = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Move); });
        auto moves = pointers(events);
        REQUIRE_FALSE(moves.empty());
        CHECK(moves.back().position.x == doctest::Approx(50));
        CHECK(moves.back().position.y == doctest::Approx(40));
        CHECK(moves.back().screen.value_or(ui::Point {}).x == doctest::Approx(150));
        CHECK(moves.back().buttons == 0);

        framework.button(1, true);
        framework.moveTo(400, 420); // out of the view, still pressed
        framework.button(1, false);
        events = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); });
        const auto phases = pointers(events);
        REQUIRE(phases.size() >= 3);
        CHECK(phases.front().phase == ui::PointerInput::Phase::Down);
        CHECK(phases.front().button == 0);
        CHECK(phases.front().buttons == 1);
        CHECK(phases.front().clicks == 1);
        CHECK(phases.front().pressure == doctest::Approx(0.5));
        // The press keeps the pointer: its moves and release, outside too.
        bool movedOutside = false;
        for (const auto& pointer : phases)
            if (pointer.phase == ui::PointerInput::Phase::Move && pointer.position.x == doctest::Approx(300)
                && pointer.buttons == 1)
                movedOutside = true;
        CHECK(movedOutside);
        // The release, then the pointer leaving as the press lets it go.
        const auto up = std::ranges::find_if(phases, [](const ui::PointerInput& p)
                                             { return p.phase == ui::PointerInput::Phase::Up; });
        REQUIRE(up != phases.end());
        CHECK(up->button == 0);
        CHECK(up->buttons == 0);
        CHECK(up->position.y == doctest::Approx(320));
        int downs = 0;
        for (const auto& pointer : phases)
            downs += pointer.phase == ui::PointerInput::Phase::Down ? 1 : 0;
        CHECK(downs == 1);
        CHECK(input->buttons() == 0);

        // XInput 2 took them all: the framework's connection got none.
        CHECK(framework.inputTheFrameworkGot().empty());
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("positions are in the editor's logical pixels: its place and scale in the view")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 300, 300);
        auto input = open(view);
        input->setGeometry({ .x = 20, .y = 10, .scale = 2 });
        framework.moveTo(60, 50);
        const Events events = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Move); });
        const auto moves = pointers(events);
        REQUIRE_FALSE(moves.empty());
        CHECK(moves.back().position.x == doctest::Approx(20));
        CHECK(moves.back().position.y == doctest::Approx(20));
        CHECK(moves.back().screen.value_or(ui::Point {}).x == doctest::Approx(30));
        CHECK(moves.back().screen.value_or(ui::Point {}).y == doctest::Approx(25));
        REQUIRE(input->pointerOnScreen());
        CHECK(input->pointerOnScreen().value_or(ui::Point {}).x == doctest::Approx(60));
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("only the editor's area is read: a framework's own controls around it keep their input")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        // A Standalone's window: JUCE's title bar and buttons above the editor.
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        input->setGeometry({ .x = 0, .y = 40, .scale = 1, .width = 200, .height = 160 });
        framework.forgetItsInput();
        framework.moveTo(50, 20);
        framework.click(1);
        CHECK_FALSE(has(settle(*input), ui::PointerInput::Phase::Down));
        const auto theirs = framework.inputTheFrameworkGot();
        CHECK(std::ranges::count(theirs, ButtonPress) == 1);
        CHECK(std::ranges::count(theirs, ButtonRelease) == 1);

        framework.moveTo(50, 100);
        framework.click(1);
        const Events events = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); });
        const auto phases = pointers(events);
        const auto down = std::ranges::find_if(phases, [](const ui::PointerInput& p)
                                               { return p.phase == ui::PointerInput::Phase::Down; });
        REQUIRE(down != phases.end());
        CHECK(down->position.x == doctest::Approx(50));
        CHECK(down->position.y == doctest::Approx(60)); // from the editor's top
        CHECK(framework.inputTheFrameworkGot().empty());

        // The editor resized within the view: its area follows.
        input->setGeometry({ .x = 0, .y = 40, .scale = 1, .width = 200, .height = 40 });
        framework.moveTo(50, 150);
        framework.click(1);
        CHECK_FALSE(has(settle(*input), ui::PointerInput::Phase::Down));
        CHECK(std::ranges::count(framework.inputTheFrameworkGot(), ButtonPress) == 1);
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("suspended (a framework's menu over the view), the view's input is the framework's until resumed")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.focus(view);
        framework.moveTo(50, 50);
        framework.button(1, true);
        framework.key(XK_a, true);
        readUntil(*input, [](const Events& e) { return ! only<KeyEvent>(e).empty(); });
        Events ended;
        input->setSuspended(true, ended);
        CHECK(has(ended, ui::PointerInput::Phase::Cancel));
        CHECK(keys(ended) == std::vector<std::string> { "up a" });
        framework.key(XK_a, false);
        framework.button(1, false);
        framework.forgetItsInput();
        framework.click(1);
        framework.type(XK_b);
        const Events whileSuspended = settle(*input);
        CHECK(pointers(whileSuspended).empty());
        CHECK(only<KeyEvent>(whileSuspended).empty());
        const auto theirs = framework.inputTheFrameworkGot();
        CHECK(std::ranges::count(theirs, ButtonPress) == 1);
        CHECK(std::ranges::count(theirs, KeyPress) == 1);
        // Suspending twice, or resuming, ends nothing more.
        input->setSuspended(true, ended);
        Events resumed;
        input->setSuspended(false, resumed);
        CHECK(resumed.empty());
        framework.click(1);
        framework.type(XK_c);
        const Events after = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 2; });
        CHECK(has(after, ui::PointerInput::Phase::Down));
        CHECK(keys(after) == std::vector<std::string> { "down c", "up c" });
        CHECK(framework.inputTheFrameworkGot().empty());
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("secondary and middle buttons, chorded as Web pointer events are")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.moveTo(50, 50);
        settle(*input);
        framework.button(3, true);
        framework.button(2, true);
        framework.button(3, false);
        framework.button(2, false);
        const Events events = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); });
        const auto phases = pointers(events);
        REQUIRE(phases.size() == 4);
        CHECK(phases[0].phase == ui::PointerInput::Phase::Down);
        CHECK(phases[0].button == 2);
        CHECK(phases[0].buttons == 2);
        CHECK(phases[1].phase == ui::PointerInput::Phase::Move);
        CHECK(phases[1].button == 1);
        CHECK(phases[1].buttons == 6);
        CHECK(phases[2].phase == ui::PointerInput::Phase::Move);
        CHECK(phases[2].button == 2);
        CHECK(phases[2].buttons == 4);
        CHECK(phases[3].phase == ui::PointerInput::Phase::Up);
        CHECK(phases[3].button == 1);
        CHECK(phases[3].buttons == 0);
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("presses in quick succession count as a series, by the double-click time")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view, std::chrono::milliseconds(5000));
        framework.moveTo(50, 50);
        framework.click(1);
        framework.click(1);
        framework.click(1);
        const Events events = readUntil(*input,
                                        [](const Events& e)
                                        {
                                            int ups = 0;
                                            for (const auto& p : pointers(e))
                                                ups += p.phase == ui::PointerInput::Phase::Up ? 1 : 0;
                                            return ups == 3;
                                        });
        std::vector<int> counts;
        for (const auto& pointer : pointers(events))
            if (pointer.phase == ui::PointerInput::Phase::Down)
                counts.push_back(pointer.clicks);
        CHECK(counts == std::vector { 1, 2, 3 });
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("a wheel without scroll axes scrolls by its buttons: notches, both ways, added up")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.moveTo(80, 60);
        settle(*input);
        // Xvfb's XTest pointer has no scroll axes: its wheel is its buttons.
        framework.click(5);
        framework.click(5);
        framework.click(5);
        Events events = readUntil(*input, [](const Events& e) { return ! only<ui::WheelInput>(e).empty(); });
        append(events, settle(*input));
        float down = 0;
        for (const auto& wheel : only<ui::WheelInput>(events))
        {
            CHECK(wheel.unit == ui::WheelInput::Unit::Line);
            CHECK(wheel.position.x == doctest::Approx(80));
            down += wheel.deltaY;
        }
        CHECK(down == doctest::Approx(3 * ui::linesPerNotch));
        // Read together, they are one wheel event.
        CHECK(only<ui::WheelInput>(events).size() <= 3);
        CHECK(pointers(events).empty()); // nothing pressed, nothing moved

        framework.click(4);
        framework.click(6);
        framework.click(7);
        framework.click(7);
        events = readUntil(*input, [](const Events& e) { return ! only<ui::WheelInput>(e).empty(); });
        append(events, settle(*input));
        float x = 0;
        float y = 0;
        for (const auto& wheel : only<ui::WheelInput>(events))
        {
            x += wheel.deltaX;
            y += wheel.deltaY;
        }
        CHECK(y == doctest::Approx(-ui::linesPerNotch));
        CHECK(x == doctest::Approx(ui::linesPerNotch));
        CHECK(framework.inputTheFrameworkGot().empty());
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("keys, with the Web's names, the text they type, modifiers and repeats")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.focus(view);
        Events events = readUntil(*input, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        REQUIRE_FALSE(only<FocusChange>(events).empty());
        CHECK(only<FocusChange>(events).back().focused);
        CHECK(input->focused());

        framework.type(XK_a);
        events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 2; });
        CHECK(keys(events) == std::vector<std::string> { "down a", "up a" });
        CHECK(only<KeyEvent>(events).front().typed == "a");
        CHECK(only<KeyEvent>(events).back().typed.empty());

        framework.key(XK_Shift_L, true);
        framework.type(XK_Tab);
        framework.type(XK_a);
        framework.key(XK_Shift_L, false);
        events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 6; });
        CHECK(keys(events)
              == std::vector<std::string> { "down Shift", "down Tab", "up Tab", "down A", "up A", "up Shift" });
        const auto withShift = only<KeyEvent>(events);
        REQUIRE(withShift.size() == 6);
        CHECK(withShift[0].key.modifiers == ui::Modifier::Shift);
        CHECK(withShift[1].key.modifiers == ui::Modifier::Shift);
        CHECK(withShift[1].typed.empty());
        CHECK(withShift[3].typed == "A");
        CHECK(withShift[5].key.modifiers == 0);

        framework.key(XK_Control_L, true);
        framework.type(XK_c);
        framework.key(XK_Control_L, false);
        framework.type(XK_Return);
        framework.type(XK_BackSpace);
        events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 8; });
        const auto shortcut = only<KeyEvent>(events);
        REQUIRE(shortcut.size() == 8);
        CHECK(shortcut[1].key.key == "c");
        CHECK(shortcut[1].key.modifiers == ui::Modifier::Control);
        CHECK(shortcut[1].typed.empty()); // a shortcut types nothing
        CHECK(shortcut[4].key.key == "Enter");
        CHECK(shortcut[4].typed.empty());
        CHECK(shortcut[6].key.key == "Backspace");

        // Held: the server repeats it (after its autorepeat delay).
        XAutoRepeatOn(framework.display);
        framework.key(XK_b, true);
        events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 3; });
        framework.key(XK_b, false);
        append(events, readUntil(*input, [](const Events& e) { return ! only<KeyEvent>(e).empty(); }));
        const auto repeated = keys(events);
        REQUIRE(repeated.size() >= 3);
        CHECK(repeated.front() == "down b");
        CHECK(repeated[1] == "down b (repeat)");
        CHECK(repeated.back() == "up b");
        CHECK(std::ranges::count(repeated, std::string("up b")) == 1);
        CHECK(framework.inputTheFrameworkGot().empty());
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("losing the focus releases held keys first; the focus comes back with a press")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        const Window other = framework.createView(300, 0, 100, 100);
        auto input = open(view);
        framework.focus(view);
        readUntil(*input, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        framework.key(XK_x, true);
        readUntil(*input, [](const Events& e) { return ! only<KeyEvent>(e).empty(); });
        framework.focus(other);
        Events events = readUntil(*input, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        CHECK(keys(events) == std::vector<std::string> { "up x" });
        REQUIRE(only<FocusChange>(events).size() == 1);
        CHECK_FALSE(only<FocusChange>(events).front().focused);
        // The key's release went to the other window: nothing more.
        framework.key(XK_x, false);
        CHECK(only<KeyEvent>(settle(*input)).empty());
        CHECK_FALSE(input->focused());
        framework.focus(view);
        events = readUntil(*input, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        CHECK(only<FocusChange>(events).back().focused);
        XDestroyWindow(framework.display, other);
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("keys sent to the view (as an XEmbed embedder forwards them) arrive once")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        XEvent sent {};
        sent.xkey.type = KeyPress;
        sent.xkey.display = framework.display;
        sent.xkey.window = view;
        sent.xkey.root = DefaultRootWindow(framework.display);
        sent.xkey.keycode = XKeysymToKeycode(framework.display, XK_q);
        sent.xkey.same_screen = True;
        XSendEvent(framework.display, view, True, KeyPressMask, &sent);
        sent.xkey.type = KeyRelease;
        XSendEvent(framework.display, view, True, KeyReleaseMask, &sent);
        XSync(framework.display, False);
        Events events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 2; });
        append(events, settle(*input));
        CHECK(keys(events) == std::vector<std::string> { "down q", "up q" });
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("a press the view loses (the view hidden mid-press) is cancelled, and the next is a press")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.moveTo(40, 40);
        framework.button(1, true);
        readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Down); });
        // Unviewable, its press's grab ends without a release.
        XUnmapWindow(framework.display, view);
        XSync(framework.display, False);
        const Events events =
            readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Cancel); });
        CHECK(has(events, ui::PointerInput::Phase::Cancel));
        CHECK_FALSE(has(events, ui::PointerInput::Phase::Up));
        CHECK(input->buttons() == 0);
        framework.button(1, false);
        XMapWindow(framework.display, view);
        XSync(framework.display, False);
        settle(*input);
        framework.moveTo(41, 41);
        framework.button(1, true);
        framework.button(1, false);
        const Events after = readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); });
        CHECK(has(after, ui::PointerInput::Phase::Down));
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("cancel() ends a press and releases held keys")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.focus(view);
        framework.moveTo(40, 40);
        framework.button(1, true);
        framework.key(XK_k, true);
        readUntil(*input, [](const Events& e) { return ! only<KeyEvent>(e).empty(); });
        Events events;
        input->cancel(events);
        CHECK(has(events, ui::PointerInput::Phase::Cancel));
        CHECK(keys(events) == std::vector<std::string> { "up k" });
        framework.key(XK_k, false);
        framework.button(1, false);
        // Nothing of either is left to end.
        Events later = settle(*input);
        CHECK(keys(later).empty());
        CHECK_FALSE(has(later, ui::PointerInput::Phase::Up));
        XDestroyWindow(framework.display, view);
    }

    TEST_CASE("text through the input method, a dead key composing with the next")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        // Xlib's own input method composes by the locale's Compose table.
        // The tests run on one thread: setting the locale races nothing.
        const std::string previous = std::setlocale(LC_CTYPE, nullptr); // NOLINT(concurrency-mt-unsafe)
        if (std::setlocale(LC_CTYPE, "C.UTF-8") == nullptr              // NOLINT(concurrency-mt-unsafe)
            || XSupportsLocale() == 0)
        {
            std::setlocale(LC_CTYPE, previous.c_str()); // NOLINT(concurrency-mt-unsafe)
            MESSAGE("no UTF-8 locale for Xlib: composition test skipped");
            return;
        }
        // A spare keycode as a dead acute, as on a Spanish keyboard.
        int low = 0;
        int high = 0;
        XDisplayKeycodes(framework.display, &low, &high);
        const auto dead = static_cast<KeyCode>(high);
        KeySym acute[] = { XK_dead_acute };
        XChangeKeyboardMapping(framework.display, dead, 1, acute, 1);
        XSync(framework.display, False);
        const Window view = framework.createView(0, 0, 200, 200);
        auto input = open(view);
        framework.focus(view);
        readUntil(*input, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        settle(*input); // the keyboard mapping's notification

        // Not in a text input: the dead key is a key.
        XTestFakeKeyEvent(framework.display, dead, True, CurrentTime);
        XTestFakeKeyEvent(framework.display, dead, False, CurrentTime);
        XSync(framework.display, False);
        Events events = readUntil(*input, [](const Events& e) { return only<KeyEvent>(e).size() >= 2; });
        CHECK(keys(events) == std::vector<std::string> { "down Dead", "up Dead" });

        input->setTextInputFocused(true);
        XTestFakeKeyEvent(framework.display, dead, True, CurrentTime);
        XTestFakeKeyEvent(framework.display, dead, False, CurrentTime);
        XSync(framework.display, False);
        framework.type(XK_e);
        events = readUntil(*input,
                           [](const Events& e)
                           {
                               for (const auto& key : only<KeyEvent>(e))
                                   if (! key.typed.empty())
                                       return true;
                               return ! only<ui::TextInput>(e).empty();
                           });
        append(events, settle(*input));
        std::string typed;
        for (const auto& text : only<ui::TextInput>(events))
            typed += text.text;
        for (const auto& key : only<KeyEvent>(events))
            typed += key.typed;
        CHECK(typed == "é");
        // The composing keys are the input method's: no Dead key went down.
        for (const auto& key : only<KeyEvent>(events))
            CHECK(key.key.key != "Dead");
        input.reset();
        XDestroyWindow(framework.display, view);
        KeySym none[] = { NoSymbol };
        XChangeKeyboardMapping(framework.display, dead, 1, none, 1);
        XSync(framework.display, False);
        std::setlocale(LC_CTYPE, previous.c_str()); // NOLINT(concurrency-mt-unsafe)
    }

    TEST_CASE("two views, two inputs: each reads its own")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window left = framework.createView(0, 0, 200, 200);
        const Window right = framework.createView(250, 0, 200, 200);
        auto first = open(left);
        auto second = open(right);
        framework.moveTo(300, 50);
        framework.click(1);
        const Events inSecond = readUntil(*second, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); });
        CHECK(has(inSecond, ui::PointerInput::Phase::Down));
        CHECK_FALSE(has(settle(*first), ui::PointerInput::Phase::Down));
        framework.focus(right);
        readUntil(*second, [](const Events& e) { return ! only<FocusChange>(e).empty(); });
        framework.type(XK_z);
        CHECK(keys(readUntil(*second, [](const Events& e) { return only<KeyEvent>(e).size() >= 2; }))
              == std::vector<std::string> { "down z", "up z" });
        CHECK(only<KeyEvent>(settle(*first)).empty());
        XDestroyWindow(framework.display, right);
        XDestroyWindow(framework.display, left);
    }

    TEST_CASE("inputs opened and closed again and again, and one whose view went first")
    {
        Framework framework;
        SOUNDOR_REQUIRE_DISPLAY(framework)
        const Window view = framework.createView(0, 0, 200, 200);
        for (int i = 0; i < 20; ++i)
        {
            auto input = open(view);
            framework.moveTo(10 + i, 10);
            readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Move); });
        }
        // A fresh one still gets the presses: no selection or grab was left behind.
        {
            auto input = open(view);
            framework.click(1);
            CHECK(has(readUntil(*input, [](const Events& e) { return has(e, ui::PointerInput::Phase::Up); }),
                      ui::PointerInput::Phase::Up));
        }
        auto orphan = open(view);
        XDestroyWindow(framework.display, view);
        XSync(framework.display, False);
        // Its view is gone: reading, cancelling and closing are harmless.
        Events events = settle(*orphan);
        orphan->cancel(events);
        orphan->warpPointer({ 5, 5 });
        orphan.reset();
        std::string failure;
        CHECK(createPlatformInput({ .view = { handle(view) } }, &failure) == nullptr);
        CHECK_FALSE(failure.empty());
    }
}
