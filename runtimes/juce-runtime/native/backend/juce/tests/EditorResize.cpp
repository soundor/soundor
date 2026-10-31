// Opens a real Soundor plugin's editor (VST3) in a window, as a DAW does, and
// resizes it the way a host does: the editor must open at the size its
// soundor.config sets, keep to its limits, and lay its UI out again at every
// new size (the UI moves with the view's centre; it is not scaled). Then it
// closes the editor and opens a new one, and shows one at a display scale
// of 2.
//
//   soundor_juce_editor_resize <plugin.vst3>
//
// The plugin is the JUCE runtime's test plugin (tests/plugin), whose editor
// is resizable: 640×480, within 400×300 and 1280×960. Built with the JUCE
// adapter tests; needs a display at least 1600×1040 large (on Linux:
// xvfb-run -s "-screen 0 1920x1200x24").

#include "HostedPlugin.h"

using namespace hosting;

namespace
{
    // Where the UI drew: the box around every pixel unlike the view's
    // background (the test plugin's UI is text, centred in the view).
    juce::Rectangle<int> drawnArea(const juce::Image& image)
    {
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

    void settle(int milliseconds = 600)
    {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(milliseconds);
    }

    struct Shown
    {
        juce::Image shot;
        juce::Rectangle<int> drawn;
    };

    // The editor as the screen shows it (its window adds a border).
    Shown show(juce::Component& editor, const juce::String& name)
    {
        settle();
        const auto shot = captureScreen(editor.getScreenBounds());
        save(shot, "editor-resize-" + name + ".png");
        return { shot, drawnArea(shot) };
    }

    // The UI's centre is the view's: it was laid out at the view's size.
    void expectCentred(const Shown& shown, juce::Point<int> size, const juce::String& what)
    {
        const auto centre = shown.drawn.getCentre();
        expect(! shown.drawn.isEmpty() && std::abs(centre.x - size.x / 2) <= 4 && std::abs(centre.y - size.y / 2) <= 4,
               what + ": the UI is centred in " + juce::String(size.x) + "x" + juce::String(size.y) + " (drawn at "
                   + shown.drawn.toString() + ")");
    }

    std::unique_ptr<juce::DocumentWindow> windowFor(juce::AudioProcessorEditor& editor)
    {
        auto window = std::make_unique<juce::DocumentWindow>("editor", juce::Colours::black, 0);
        window->setUsingNativeTitleBar(false);
        window->setTitleBarHeight(0);
        window->setContentNonOwned(&editor, true);
        window->setTopLeftPosition(0, 0);
        window->setVisible(true);
        return window;
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 2)
    {
        std::printf("usage: %s <plugin.vst3>\n", argv[0]);
        return 2;
    }
#if JUCE_LINUX
    Display* atoms = prepareWindowSystem();
#endif
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::VST3PluginFormat format;
        auto plugin = load(format, juce::String::fromUTF8(argv[1]));
        expect(plugin != nullptr, "the plugin loads");
        if (plugin == nullptr)
            return 1;
        plugin->prepareToPlay(48000.0, 512);

        std::unique_ptr<juce::AudioProcessorEditor> editor(plugin->createEditorIfNeeded());
        expect(editor != nullptr, "the editor opens");
        if (editor == nullptr)
            return 1;
        auto window = windowFor(*editor);

        // The size and the resizability soundor.config sets.
        expect(editor->isResizable(), "the host can resize the editor");
        expect(editor->getWidth() == 640 && editor->getHeight() == 480,
               "it opens at 640x480, not " + editor->getBounds().toString());
        const Shown first = show(*editor, "640x480");
        expectCentred(first, { 640, 480 }, "at 640x480");
        expect(first.drawn.getWidth() > 20 && first.drawn.getHeight() > 20, "the UI drew text");

        // Larger: laid out again, not scaled (the text keeps its size).
        editor->setSize(1000, 700);
        expect(editor->getWidth() == 1000 && editor->getHeight() == 700,
               "it resizes to 1000x700: " + editor->getBounds().toString());
        const Shown larger = show(*editor, "1000x700");
        expect(window->getContentComponent()->getBounds().getWidth() == 1000, "the window follows the editor");
        expectCentred(larger, { 1000, 700 }, "at 1000x700");
        expect(std::abs(larger.drawn.getHeight() - first.drawn.getHeight()) <= 2
                   && std::abs(larger.drawn.getWidth() - first.drawn.getWidth()) <= 2,
               "the UI keeps its size: " + first.drawn.toString() + " then " + larger.drawn.toString());

        // Beyond the limits: the plugin constrains what the host asks for.
        editor->setSize(200, 100);
        expect(editor->getWidth() == 400 && editor->getHeight() == 300,
               "too small is held at 400x300: " + editor->getBounds().toString());
        expectCentred(show(*editor, "400x300"), { 400, 300 }, "at its minimum");
        editor->setSize(3000, 3000);
        expect(editor->getWidth() == 1280 && editor->getHeight() == 960,
               "too large is held at 1280x960: " + editor->getBounds().toString());
        expectCentred(show(*editor, "1280x960"), { 1280, 960 }, "at its maximum");

        // Many resizes in a row, as a dragged window edge makes: the last wins.
        for (int step = 0; step < 40; ++step)
            editor->setSize(500 + step * 10, 400 + step * 5);
        expectCentred(show(*editor, "dragged"), { 890, 595 }, "after a drag");

        // Closed and opened again: a new editor, at the configured size.
        window.reset();
        editor.reset();
        settle(200);
        editor.reset(plugin->createEditorIfNeeded());
        expect(editor != nullptr, "the editor opens again");
        if (editor == nullptr)
            return 1;
        window = windowFor(*editor);
        expect(editor->getWidth() == 640 && editor->getHeight() == 480,
               "it opens again at 640x480: " + editor->getBounds().toString());
        editor->setSize(800, 520);
        expectCentred(show(*editor, "reopened"), { 800, 520 }, "reopened and resized");

        // At a display scale of 2 (as a host on a high-density display sets
        // it): the same layout, drawn with twice the pixels.
        editor->setScaleFactor(2.0f);
        settle();
        const auto physical = editor->getScreenBounds();
        const Shown scaled = show(*editor, "scale-2");
        expect(physical.getWidth() == 1600 && physical.getHeight() == 1040,
               "at scale 2 the editor covers 1600x1040: " + physical.toString());
        expectCentred(scaled, { physical.getWidth(), physical.getHeight() }, "at scale 2");
        expect(std::abs(scaled.drawn.getHeight() - 2 * first.drawn.getHeight()) <= 6,
               "the UI is drawn twice as large: " + scaled.drawn.toString());

        window.reset();
        editor.reset();
        plugin->releaseResources();
    }
#if JUCE_LINUX
    if (atoms != nullptr)
        XCloseDisplay(atoms);
#endif
    std::printf(failures == 0 ? "The editor resizes.\n" : "%d check(s) failed.\n", failures);
    return failures == 0 ? 0 : 1;
}
