// Loads two real Soundor plugins (VST3) into one process with JUCE's plugin
// hosting, like a DAW: processes audio in both, moves a parameter in one,
// opens both editors and draws them. Each plugin carries its own runtime,
// JavaScript engine and renderer under its own ABI namespace; nothing may
// leak from one into the other.
//
//   soundor_juce_coexistence <plugin.vst3> <other plugin.vst3>
//
// Built with the JUCE adapter tests; needs a display (e.g. xvfb-run on Linux).

#include <juce_audio_processors/juce_audio_processors.h>

#if JUCE_LINUX
    #include <X11/Xlib.h>
    #include <X11/Xutil.h>
#endif

#include <cstdio>
#include <memory>
#include <vector>

namespace
{
    int failures = 0;

    void expect(bool condition, const juce::String& what)
    {
        std::printf("%s %s\n", condition ? "ok  " : "FAIL", what.toRawUTF8());
        if (! condition)
            ++failures;
    }

    std::unique_ptr<juce::AudioPluginInstance> load(juce::AudioPluginFormat& format, const juce::String& path)
    {
        juce::OwnedArray<juce::PluginDescription> types;
        format.findAllTypesForFile(types, path);
        if (types.isEmpty())
            return nullptr;
        juce::String error;
        auto instance = format.createInstanceFromDescription(*types[0], 48000.0, 512, error);
        if (instance == nullptr)
            std::printf("could not load %s: %s\n", path.toRawUTF8(), error.toRawUTF8());
        return instance;
    }

    void process(juce::AudioPluginInstance& plugin, int blocks)
    {
        juce::AudioBuffer<float> buffer(2, 512);
        juce::MidiBuffer midi;
        for (int i = 0; i < blocks; ++i)
        {
            for (int channel = 0; channel < 2; ++channel)
                for (int sample = 0; sample < 512; ++sample)
                    buffer.setSample(channel, sample, 0.25f);
            plugin.processBlock(buffer, midi);
        }
    }

    // The screen, as drawn: a hosted plugin's editor is its own native window,
    // which only the window system can show us.
    juce::Image captureScreen(juce::Rectangle<int> area)
    {
        juce::Image image(juce::Image::RGB, area.getWidth(), area.getHeight(), true);
#if JUCE_LINUX
        Display* display = XOpenDisplay(nullptr);
        if (display == nullptr)
            return image;
        // Only what is on the screen can be read.
        area = area.getIntersection(
            { 0, 0, DisplayWidth(display, DefaultScreen(display)), DisplayHeight(display, DefaultScreen(display)) });
        image = juce::Image(juce::Image::RGB, std::max(1, area.getWidth()), std::max(1, area.getHeight()), true);
        if (area.isEmpty())
        {
            XCloseDisplay(display);
            return image;
        }
        XImage* shot = XGetImage(display, DefaultRootWindow(display), area.getX(), area.getY(),
                                 static_cast<unsigned>(area.getWidth()), static_cast<unsigned>(area.getHeight()),
                                 AllPlanes, ZPixmap);
        if (shot != nullptr)
        {
            for (int y = 0; y < area.getHeight(); ++y)
                for (int x = 0; x < area.getWidth(); ++x)
                {
                    const unsigned long pixel = XGetPixel(shot, x, y);
                    image.setPixelAt(x, y,
                                     juce::Colour(static_cast<juce::uint8>((pixel >> 16) & 0xFF),
                                                  static_cast<juce::uint8>((pixel >> 8) & 0xFF),
                                                  static_cast<juce::uint8>(pixel & 0xFF)));
                }
            XDestroyImage(shot);
        }
        XCloseDisplay(display);
#endif
        return image;
    }

    // How many pixels of `image` (every other one) are close to `colour`.
    int pixelsLike(const juce::Image& image, juce::Colour colour)
    {
        int count = 0;
        for (int y = 0; y < image.getHeight(); y += 2)
            for (int x = 0; x < image.getWidth(); x += 2)
            {
                const juce::Colour pixel = image.getPixelAt(x, y);
                if (std::abs(pixel.getRed() - colour.getRed()) < 12
                    && std::abs(pixel.getGreen() - colour.getGreen()) < 12
                    && std::abs(pixel.getBlue() - colour.getBlue()) < 12)
                    ++count;
            }
        return count;
    }

#if JUCE_LINUX
    // A bare X server (Xvfb, no window manager) lacks the atoms a window
    // manager would create, and JUCE only looks them up; create them first.
    // The connection stays open so they live as long as the test.
    Display* prepareWindowSystem()
    {
        Display* display = XOpenDisplay(nullptr);
        if (display == nullptr)
            return nullptr;
        for (const char* name :
             { "WM_PROTOCOLS", "WM_TAKE_FOCUS", "WM_DELETE_WINDOW", "_NET_WM_PING", "WM_CHANGE_STATE", "WM_STATE",
               "_NET_WM_WINDOW_TYPE", "_NET_WM_STATE", "_NET_WM_STATE_HIDDEN" })
            XInternAtom(display, name, False);
        XSync(display, False);
        return display;
    }
#endif

    void save(const juce::Image& image, const juce::String& name)
    {
        const auto file = juce::File::getCurrentWorkingDirectory().getChildFile(name);
        file.deleteFile();
        juce::FileOutputStream out(file);
        juce::PNGImageFormat().writeImageToStream(image, out);
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 3)
    {
        std::printf("usage: %s <plugin.vst3> <other plugin.vst3>\n", argv[0]);
        return 2;
    }
#if JUCE_LINUX
    Display* atoms = prepareWindowSystem();
#endif
    juce::ScopedJuceInitialiser_GUI gui;
    juce::VST3PluginFormat format;

    std::vector<std::unique_ptr<juce::AudioPluginInstance>> plugins;
    for (int i = 1; i <= 2; ++i)
        plugins.push_back(load(format, juce::String::fromUTF8(argv[i])));
    expect(plugins[0] != nullptr && plugins[1] != nullptr, "both plugins load");
    if (plugins[0] == nullptr || plugins[1] == nullptr)
        return 1;
    expect(plugins[0]->getName() != plugins[1]->getName(),
           "they are different plugins: " + plugins[0]->getName() + ", " + plugins[1]->getName());

    for (auto& plugin : plugins)
    {
        plugin->prepareToPlay(48000.0, 512);
        process(*plugin, 8);
    }

    // A parameter set in one plugin stays in that plugin.
    auto* gainA = plugins[0]->getParameters()[0];
    auto* gainB = plugins[1]->getParameters()[0];
    const float before = gainB->getValue();
    gainA->setValueNotifyingHost(0.9f);
    process(*plugins[0], 2);
    expect(std::abs(gainA->getValue() - 0.9f) < 0.01f, "the first plugin's gain moved");
    expect(gainB->getValue() == before, "the second plugin's gain did not");

    // Both editors at once, side by side on screen: each starts its own
    // JavaScript UI (React) and draws it with its own renderer.
    std::vector<std::unique_ptr<juce::AudioProcessorEditor>> editors;
    std::vector<std::unique_ptr<juce::DocumentWindow>> windows;
    for (std::size_t i = 0; i < plugins.size(); ++i)
    {
        editors.emplace_back(plugins[i]->createEditorIfNeeded());
        if (editors.back() == nullptr)
            break;
        auto window = std::make_unique<juce::DocumentWindow>(plugins[i]->getName(), juce::Colours::black, 0);
        window->setUsingNativeTitleBar(false);
        window->setTitleBarHeight(0);
        window->setContentNonOwned(editors.back().get(), true);
        window->setTopLeftPosition(i == 0 ? 0 : windows[0]->getRight() + 20, 0);
        window->setVisible(true);
        windows.push_back(std::move(window));
    }
    expect(editors.size() == 2 && editors[0] != nullptr && editors[1] != nullptr, "both editors open");
    if (windows.size() != 2)
        return 1;

    // Let the editors' frame timers run: React renders on the first frames.
    juce::MessageManager::getInstance()->runDispatchLoopUntil(2000);

    // The example's UI: a dark background and a blue fader filled to the gain.
    const juce::Colour background(0x17, 0x18, 0x1c);
    const juce::Colour fader(0x4c, 0x8d, 0xff);
    int secondFader = 0;
    for (std::size_t i = 0; i < windows.size(); ++i)
    {
        const auto shot = captureScreen(windows[i]->getScreenBounds());
        save(shot, "coexistence-editor-" + juce::String(static_cast<int>(i + 1)) + ".png");
        const juce::String which = "editor " + juce::String(static_cast<int>(i + 1));
        expect(pixelsLike(shot, background) > 2000, which + " drew its background");
        expect(pixelsLike(shot, fader) > 100, which + " drew its fader");
        secondFader = pixelsLike(shot, fader);
    }

    // Close one editor; the other plugin's UI keeps running.
    windows[0].reset();
    editors[0].reset();
    plugins[1]->getParameters()[0]->setValueNotifyingHost(1.0f);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(500);
    process(*plugins[1], 4);
    const auto again = captureScreen(windows[1]->getScreenBounds());
    save(again, "coexistence-editor-2-after.png");
    // Its gain went to the top, and so did its fader.
    expect(pixelsLike(again, fader) > secondFader, "the second editor follows its parameter after the first closed");
    windows.clear();
    editors.clear();
    for (auto& plugin : plugins)
        plugin->releaseResources();
    plugins.clear();

#if JUCE_LINUX
    if (atoms != nullptr)
        XCloseDisplay(atoms);
#endif
    std::printf(failures == 0 ? "Two Soundor plugins coexist in one host.\n" : "%d check(s) failed.\n", failures);
    return failures == 0 ? 0 : 1;
}
