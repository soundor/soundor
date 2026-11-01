#include <soundor/backend/JucePresentation.h>
#include <soundor/ui/Renderer.h>

#include <doctest/doctest.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <cstdint>
#include <string_view>
#include <vector>

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
    TEST_CASE("SVG Image and scenes stay sharp through letterboxed editor scaling and display density")
    {
        juce::ScopedJuceInitialiser_GUI gui;
        constexpr std::string_view svg = "<svg width='8' height='8' viewBox='0 0 8 8'>"
                                         "<circle cx='4' cy='4' r='3' fill='red'/></svg>";
        for (const bool retained : { false, true })
        {
            int reads = 0;
            ui::Renderer renderer(
                [&](std::string_view) -> std::optional<std::span<const std::uint8_t>>
                {
                    ++reads;
                    return std::span(reinterpret_cast<const std::uint8_t*>(svg.data()), svg.size());
                });
            ui::Surface surface({ .textEngine = renderer.textEngine(), .images = renderer.images() });
            const auto node = surface.createNode(retained ? ui::NodeType::Svg : ui::NodeType::Image);
            if (retained)
            {
                ui::SvgScene scene;
                scene.viewBox = { 0, 0, 8, 8 };
                ui::SvgShape circle;
                circle.geometry = ui::SvgCircle { 4, 4, 3 };
                circle.presentation.fill = "red";
                scene.children.push_back(std::move(circle));
                surface.setSvgScene(node, std::move(scene));
            }
            else
                surface.setSource(node, "circle.svg");
            ui::Style style;
            style.width = ui::Length::points(64);
            style.height = ui::Length::points(64);
            surface.setStyle(node, style);
            surface.insertChild(surface.root().id(), node);
            surface.setSize({ 64, 64 });
            juce::Component view;
            backend::JuceImageTarget target(view);
            for (const float editorScale : { 0.5f, 1.0f, 1.5f, 2.0f })
                for (const float density : { 1.0f, 2.0f })
                {
                    const float effectiveScale = editorScale * density;
                    surface.setScale(effectiveScale);
                    view.setSize(static_cast<int>(128 * editorScale), static_cast<int>(80 * editorScale));
                    target.setArea({ 32 * editorScale, 8 * editorScale, 64 * editorScale, 64 * editorScale });
                    const int side = static_cast<int>(64 * effectiveScale);
                    const auto stride = static_cast<std::size_t>(side);
                    std::vector<std::uint32_t> reference(stride * stride);
                    renderer.render(surface, { reference.data(), side, side, stride * 4 }, 0);
                    renderer.render(surface, target.acquire(side, side).bitmap, 0);
                    target.present(render::Region({ 0, 0, side, side }));
                    juce::Image shown(juce::Image::ARGB, static_cast<int>(128 * effectiveScale),
                                      static_cast<int>(80 * effectiveScale), true);
                    {
                        juce::Graphics graphics(shown);
                        graphics.addTransform(juce::AffineTransform::scale(density));
                        target.paint(graphics);
                    }
                    const int left = static_cast<int>(32 * effectiveScale);
                    const int top = static_cast<int>(8 * effectiveScale);
                    int worst = 0;
                    for (int y = 0; y < side; ++y)
                        for (int x = 0; x < side; ++x)
                        {
                            const auto expected =
                                reference[static_cast<std::size_t>(y) * stride + static_cast<std::size_t>(x)] >> 24;
                            worst = std::max(worst, std::abs(static_cast<int>(expected)
                                                             - shown.getPixelAt(left + x, top + y).getAlpha()));
                        }
                    CHECK_MESSAGE(worst <= 2, "editor scale " << editorScale << ", density " << density);
                    CHECK(shown.getPixelAt(0, shown.getHeight() / 2).getAlpha() == 0);
                    CHECK(shown.getPixelAt(left + side / 2, top + side / 2) == juce::Colour(0xffff0000));
                    CHECK(surface.find(node)->frame().width == 64);
                }
            CHECK(reads == (retained ? 0 : 1));
        }
    }

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

    TEST_CASE("a JuceImageTarget paints into the area it is given, letterboxed")
    {
        // An editor that scales, 80×20 for a 40×20 layout: the UI in the middle.
        juce::ScopedJuceInitialiser_GUI gui;
        juce::Component view;
        view.setSize(80, 20);
        backend::JuceImageTarget target(view);
        target.setArea({ 20, 0, 40, 20 });
        const auto pixels = target.acquire(40, 20);
        fill(pixels.bitmap, { 0, 0, 40, 20 }, 0xFFFF0000);
        target.present(render::Region({ 0, 0, 40, 20 }));

        juce::Image shown(juce::Image::ARGB, 80, 20, true);
        {
            juce::Graphics g(shown);
            target.paint(g);
        }
        CHECK(shown.getPixelAt(10, 10).getAlpha() == 0);
        CHECK(shown.getPixelAt(40, 10) == juce::Colour(0xFFFF0000));
        CHECK(shown.getPixelAt(70, 10).getAlpha() == 0);
    }
}
