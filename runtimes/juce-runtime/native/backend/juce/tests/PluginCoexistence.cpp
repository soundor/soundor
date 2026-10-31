// Loads two real Soundor plugins (VST3) into one process with JUCE's plugin
// hosting, like a DAW: processes audio in both, moves a parameter in one,
// opens both editors and draws them. Each plugin carries its own runtime,
// JavaScript engine and renderer under the same engine ABI namespace; nothing may
// leak from one into the other.
//
//   soundor_juce_coexistence <plugin.vst3> <other plugin.vst3>
//
// Built with the JUCE adapter tests; needs a display (e.g. xvfb-run on Linux).

#include "HostedPlugin.h"

#include <vector>

using namespace hosting;

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
