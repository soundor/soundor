// What the hosting tests (PluginCoexistence.cpp, EditorResize.cpp) share: a
// real Soundor plugin (VST3) loaded with JUCE's plugin hosting, as a DAW
// loads one, and the screen read back to see what its editor drew.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#if JUCE_LINUX
    #include <X11/Xlib.h>
    #include <X11/Xutil.h>
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>

namespace hosting
{
    inline int failures = 0;

    inline void expect(bool condition, const juce::String& what)
    {
        std::printf("%s %s\n", condition ? "ok  " : "FAIL", what.toRawUTF8());
        if (! condition)
            ++failures;
    }

    inline std::unique_ptr<juce::AudioPluginInstance> load(juce::AudioPluginFormat& format, const juce::String& path)
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

    inline void process(juce::AudioPluginInstance& plugin, int blocks)
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
    inline juce::Image captureScreen(juce::Rectangle<int> area)
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
    inline int pixelsLike(const juce::Image& image, juce::Colour colour)
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
    inline Display* prepareWindowSystem()
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

    inline void save(const juce::Image& image, const juce::String& name)
    {
        const auto file = juce::File::getCurrentWorkingDirectory().getChildFile(name);
        file.deleteFile();
        juce::FileOutputStream out(file);
        juce::PNGImageFormat().writeImageToStream(image, out);
    }
} // namespace hosting
