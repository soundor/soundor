#include <soundor/backend/JucePresentation.h>

#include <doctest/doctest.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <cstdint>

using namespace soundor;

namespace
{
    void fill(const render::Bitmap& bitmap, const render::IntRect& rect, std::uint32_t color)
    {
        for (int y = rect.y; y < rect.bottom(); ++y)
            for (int x = rect.x; x < rect.right(); ++x)
                static_cast<std::uint32_t*>(
                    bitmap.pixels)[static_cast<std::size_t>(y) * (bitmap.rowBytes / 4) + static_cast<std::size_t>(x)] =
                    color;
    }
} // namespace

TEST_SUITE("JUCE presentation")
{
    TEST_CASE("a JuceImageTarget keeps its pixels until the size changes")
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::Component view;
        view.setSize(50, 20);
        backend::JuceImageTarget target(view);
        CHECK_FALSE(target.matches(100, 40));

        auto pixels = target.acquire(100, 40);
        CHECK_FALSE(pixels.preserved);
        CHECK(pixels.bitmap.width == 100);
        CHECK(pixels.bitmap.height == 40);
        fill(pixels.bitmap, { 0, 0, 100, 40 }, 0xFFFF0000);
        target.present(render::Region({ 0, 0, 100, 40 }));
        CHECK(target.matches(100, 40));

        pixels = target.acquire(100, 40);
        CHECK(pixels.preserved);
        CHECK(static_cast<const std::uint32_t*>(pixels.bitmap.pixels)[0] == 0xFFFF0000);
        target.present({});

        CHECK_FALSE(target.acquire(60, 40).preserved);
        target.present({});
    }

    TEST_CASE("a JuceImageTarget paints its device pixels over the component")
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::Component view;
        view.setSize(50, 20);
        backend::JuceImageTarget target(view);
        const auto pixels = target.acquire(100, 40);
        fill(pixels.bitmap, { 0, 0, 50, 40 }, 0xFFFF0000);
        fill(pixels.bitmap, { 50, 0, 50, 40 }, 0xFF0000FF);
        target.present(render::Region({ 0, 0, 100, 40 }));

        juce::Image shown(juce::Image::ARGB, 50, 20, true);
        {
            juce::Graphics g(shown);
            target.paint(g);
        }
        CHECK(shown.getPixelAt(5, 10) == juce::Colour(0xFFFF0000));
        CHECK(shown.getPixelAt(45, 10) == juce::Colour(0xFF0000FF));
    }
}
