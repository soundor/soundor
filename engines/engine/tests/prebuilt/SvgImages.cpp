// Public headers only: exercise the installed archive in both variants,
// including a Release engine without Hermes's JavaScript compiler.
#include <soundor/ui/Renderer.h>

#include <doctest/doctest.h>

#include <string_view>
#include <vector>

using namespace soundor;

TEST_CASE("source and prebuilt engines measure and draw SVG Image at physical resolution")
{
    constexpr std::string_view xml = "<svg width='8' height='8' viewBox='0 0 8 8'>"
                                     "<circle cx='4' cy='4' r='3' fill='red'/></svg>";
    int reads = 0;
    ui::Renderer renderer(
        [&](std::string_view) -> std::optional<std::span<const std::uint8_t>>
        {
            ++reads;
            return std::span(reinterpret_cast<const std::uint8_t*>(xml.data()), xml.size());
        });
    ui::Surface surface({ .textEngine = renderer.textEngine(), .images = renderer.images() });
    const auto node = surface.createNode(ui::NodeType::Image);
    surface.setSource(node, "circle.svg");
    surface.insertChild(surface.root().id(), node);
    const auto size = renderer.images()->imageSize("circle.svg");
    REQUIRE(size.has_value());
    CHECK(size.value_or(ui::Size {}).width == 8);
    CHECK(size.value_or(ui::Size {}).height == 8);
    ui::Style style;
    style.width = ui::Length::points(64);
    style.height = ui::Length::points(64);
    surface.setStyle(node, style);
    surface.setSize({ 64, 64 });
    for (const float scale : { 0.5f, 1.0f, 1.5f, 2.0f, 3.0f, 4.0f })
    {
        surface.setScale(scale);
        const auto side = static_cast<int>(64 * scale);
        const auto stride = static_cast<std::size_t>(side);
        std::vector<std::uint32_t> pixels(stride * stride);
        renderer.render(surface, { pixels.data(), side, side, stride * 4 }, 0);
        const auto at = [&](int x, int y)
        { return pixels[static_cast<std::size_t>(y) * stride + static_cast<std::size_t>(x)]; };
        CHECK(at(side / 2, side / 2) == 0xffff0000);
        CHECK(at(0, 0) == 0);
        CHECK(at(side / 2, side / 16) == 0);
    }
    CHECK(reads == 1);
    surface.releaseNode(node);
}
