// Opens a real Soundor plugin's editor (VST3) in a window, as a DAW does, and
// uses it with real X11 input (XTest, as the user's): Soundor's own input
// reads the view's (XInput 2, on a connection of its own; the plugin's log
// says so), read when JUCE's event loop finds it readable, which in a plugin
// is the host's run loop (VST3's IRunLoop; here JUCE's hosting provides it).
//
// The plugin is the JUCE runtime's test plugin (tests/plugin): its UI's
// middle line ("Active" or "Bypassed") toggles the bypass parameter when
// pressed, which the host sees. A press must reach the UI once (one toggle,
// not two), take the keyboard focus, land where it is drawn under a host's
// scaling, keep working across editors opened and closed again, and reach
// only the instance it was made in.
//
//   soundor_juce_editor_input <plugin.vst3>
//
// Linux only; needs a display at least 1400×720 (xvfb-run -s "-screen 0
// 1920x1200x24").

#include "HostedPlugin.h"

#include <X11/extensions/XTest.h>
#include <unistd.h>

#include <array>
#include <chrono>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace hosting;

namespace
{
    void settle(int milliseconds = 500)
    {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(milliseconds);
    }

    // Where the UI drew in the editor: the box around every pixel unlike its
    // background (the test plugin's UI is text, centred in the view).
    juce::Rectangle<int> drawnArea(juce::Component& editor)
    {
        const auto image = captureScreen(editor.getScreenBounds());
        const juce::Colour background = image.getPixelAt(2, 2);
        int left = image.getWidth();
        int top = image.getHeight();
        int right = -1;
        int bottom = -1;
        for (int y = 0; y < image.getHeight(); ++y)
            for (int x = 0; x < image.getWidth(); ++x)
            {
                const juce::Colour pixel = image.getPixelAt(x, y);
                if (std::abs(pixel.getRed() - background.getRed()) + std::abs(pixel.getGreen() - background.getGreen())
                        + std::abs(pixel.getBlue() - background.getBlue())
                    < 96)
                    continue;
                left = std::min(left, x);
                top = std::min(top, y);
                right = std::max(right, x);
                bottom = std::max(bottom, y);
            }
        return right < 0 ? juce::Rectangle<int>() : juce::Rectangle<int>(left, top, right - left + 1, bottom - top + 1);
    }

    std::unique_ptr<juce::DocumentWindow> windowFor(juce::AudioProcessorEditor& editor, int x)
    {
        auto window = std::make_unique<juce::DocumentWindow>("editor", juce::Colours::black, 0);
        window->setUsingNativeTitleBar(false);
        window->setTitleBarHeight(0);
        window->setContentNonOwned(&editor, true);
        window->setTopLeftPosition(x, 0);
        window->setVisible(true);
        return window;
    }

    juce::AudioProcessorParameter* parameterNamed(juce::AudioPluginInstance& plugin, const juce::String& name)
    {
        for (auto* parameter : plugin.getParameters())
            if (parameter->getName(64) == name)
                return parameter;
        return nullptr;
    }

    // The user, through XTest: a press and release at a point on the screen.
    void clickAt(Display* user, juce::Point<int> where)
    {
        XTestFakeMotionEvent(user, -1, where.x, where.y, CurrentTime);
        XSync(user, False);
        settle(150);
        XTestFakeButtonEvent(user, 1, True, CurrentTime);
        XTestFakeButtonEvent(user, 1, False, CurrentTime);
        XSync(user, False);
        settle(400);
    }

    // The middle line of the UI (bypass), on the screen.
    juce::Point<int> bypassLine(juce::Component& editor)
    {
        return editor.getScreenBounds().getPosition() + drawnArea(editor).getCentre();
    }

    void forEachWindowIn(Display* display, Window window, const std::function<void(Window)>& visit)
    {
        visit(window);
        Window root = 0;
        Window parent = 0;
        Window* children = nullptr;
        unsigned count = 0;
        if (XQueryTree(display, window, &root, &parent, &children, &count) == 0)
            return;
        const std::vector<Window> inside(children, children + count);
        if (children != nullptr)
            XFree(children);
        for (const Window child : inside)
            forEachWindowIn(display, child, visit);
    }

    // The plugin's log (JUCE's Logger writes it to stderr), kept while the
    // test runs and passed on: which input the editor reads is said there.
    class StderrLog
    {
    public:
        StderrLog()
        {
            if (pipe(ends.data()) != 0)
                return;
            original = dup(STDERR_FILENO);
            dup2(ends[1], STDERR_FILENO);
            close(ends[1]);
            reader = std::thread(
                [this]
                {
                    std::array<char, 4096> buffer {};
                    ssize_t read = 0;
                    while ((read = ::read(ends[0], buffer.data(), buffer.size())) > 0)
                    {
                        const std::lock_guard lock(mutex);
                        text.append(buffer.data(), static_cast<std::size_t>(read));
                        [[maybe_unused]] const auto written =
                            ::write(original, buffer.data(), static_cast<std::size_t>(read));
                    }
                });
        }
        ~StderrLog()
        {
            if (original < 0)
                return;
            std::fflush(stderr);
            dup2(original, STDERR_FILENO); // closes the pipe's last writer: the reader ends
            reader.join();
            close(ends[0]);
            close(original);
        }
        StderrLog(const StderrLog&) = delete;
        StderrLog& operator=(const StderrLog&) = delete;

        [[nodiscard]] int count(const std::string& line)
        {
            std::fflush(stderr);
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            const std::lock_guard lock(mutex);
            int found = 0;
            for (std::size_t at = text.find(line); at != std::string::npos; at = text.find(line, at + 1))
                ++found;
            return found;
        }

    private:
        std::array<int, 2> ends { -1, -1 };
        int original = -1;
        std::thread reader;
        std::mutex mutex;
        std::string text;
    };

    // The window with the keyboard focus is `top` or in it.
    bool focusedIn(Display* display, Window top)
    {
        Window focus = 0;
        int revert = 0;
        XGetInputFocus(display, &focus, &revert);
        bool inside = false;
        forEachWindowIn(display, top, [&](Window window) { inside = inside || window == focus; });
        return inside;
    }

    Window nativeWindow(juce::Component& component)
    {
        auto* peer = component.getPeer();
        return peer != nullptr ? static_cast<Window>(reinterpret_cast<std::uintptr_t>(peer->getNativeHandle())) : 0;
    }

    bool toggles(Display* user, juce::Component& editor, juce::AudioProcessorParameter& bypass,
                 const juce::String& what)
    {
        const float before = bypass.getValue();
        clickAt(user, bypassLine(editor));
        const float after = bypass.getValue();
        // Once: two deliveries of one press would toggle it back.
        const bool toggled = (before < 0.5f) != (after < 0.5f);
        expect(toggled,
               what + ": a press toggles bypass once (" + juce::String(before) + " to " + juce::String(after) + ")");
        return toggled;
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 2)
    {
        std::printf("usage: %s <plugin.vst3>\n", argv[0]);
        return 2;
    }
    StderrLog log;
    const std::string nativeInputLine = "[soundor] input: native (X11, XInput 2)";
    Display* atoms = prepareWindowSystem();
    Display* user = XOpenDisplay(nullptr);
    expect(user != nullptr, "there is a display");
    if (user == nullptr)
        return 1;
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::VST3PluginFormat format;
        const auto path = juce::String::fromUTF8(argv[1]);
        auto plugin = load(format, path);
        expect(plugin != nullptr, "the plugin loads");
        if (plugin == nullptr)
            return 1;
        plugin->prepareToPlay(48000.0, 512);
        auto* bypass = parameterNamed(*plugin, "Bypass");
        expect(bypass != nullptr, "the plugin has its bypass");
        if (bypass == nullptr)
            return 1;

        std::unique_ptr<juce::AudioProcessorEditor> editor(plugin->createEditorIfNeeded());
        expect(editor != nullptr, "the editor opens");
        if (editor == nullptr)
            return 1;
        auto window = windowFor(*editor, 0);
        settle(1500);
        const Window top = nativeWindow(*window);
        expect(log.count(nativeInputLine) == 1, "Soundor reads the plugin view's input itself (XInput 2)");
        expect(log.count("JUCE's input instead") == 0, "it did not fall back to JUCE's input");
        expect(! drawnArea(*editor).isEmpty(), "the UI drew");

        toggles(user, *editor, *bypass, "a click");
        expect(focusedIn(user, top), "a press gives the plugin's view the keyboard focus");
        toggles(user, *editor, *bypass, "a second click");

        // A host scaling the editor (a high-density display): the press lands
        // on what is drawn under it, at its new place.
        editor->setScaleFactor(1.5f);
        settle(1000);
        toggles(user, *editor, *bypass, "at a scale of 1.5");
        editor->setScaleFactor(1.0f);
        settle(500);

        // Closed and opened again, and again: each new editor reads input,
        // none left behind takes it.
        for (int round = 1; round <= 4; ++round)
        {
            window.reset();
            editor.reset();
            settle(200);
            editor.reset(plugin->createEditorIfNeeded());
            if (editor == nullptr)
                break;
            window = windowFor(*editor, 0);
            settle(1000);
            toggles(user, *editor, *bypass, "reopened (" + juce::String(round) + ")");
        }
        // One native input for each editor opened.
        expect(log.count(nativeInputLine) == 5, "each editor reads its input natively");
        expect(editor != nullptr, "the editor opens again and again");

        // A second instance beside it: a press in one is that one's alone.
        auto other = load(format, path);
        expect(other != nullptr, "a second instance loads");
        if (other != nullptr && editor != nullptr)
        {
            other->prepareToPlay(48000.0, 512);
            auto* otherBypass = parameterNamed(*other, "Bypass");
            std::unique_ptr<juce::AudioProcessorEditor> otherEditor(other->createEditorIfNeeded());
            auto otherWindow = otherEditor != nullptr ? windowFor(*otherEditor, 700) : nullptr;
            settle(1500);
            if (otherEditor != nullptr && otherBypass != nullptr)
            {
                const float first = bypass->getValue();
                toggles(user, *otherEditor, *otherBypass, "the second instance");
                expect(bypass->getValue() == first, "the first instance did not see the second's press");
                toggles(user, *editor, *bypass, "the first instance, after the second");
                expect(focusedIn(user, nativeWindow(*window)), "the focus followed the press to the first");
            }
            otherWindow.reset();
            otherEditor.reset();
            other->releaseResources();
        }

        window.reset();
        editor.reset();
        plugin->releaseResources();
    }
    XCloseDisplay(user);
    if (atoms != nullptr)
        XCloseDisplay(atoms);
    std::printf(failures == 0 ? "The editor takes native input.\n" : "%d check(s) failed.\n", failures);
    return failures == 0 ? 0 : 1;
}
