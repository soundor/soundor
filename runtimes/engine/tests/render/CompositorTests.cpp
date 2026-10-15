#include <soundor/render/Compositor.h>

#include <doctest/doctest.h>

#include <cstdint>
#include <cstdlib>
#include <vector>

using namespace soundor::render;

namespace
{
    // Premultiplied BGRA words (0xAARRGGBB).
    constexpr std::uint32_t red = 0xFFFF0000;
    constexpr std::uint32_t blue = 0xFF0000FF;

    // Pixels kept from present to present, like a window's backing image.
    struct MemoryTarget final : RasterTarget
    {
        Pixels acquire(int width, int height) override
        {
            const bool preserved = width == pixelWidth && height == pixelHeight && ! lost;
            if (! preserved)
            {
                pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0xDEADBEEF);
                pixelWidth = width;
                pixelHeight = height;
                lost = false;
            }
            return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
        }

        void present(const Region& damage) override
        {
            ++presents;
            presented = damage;
        }

        [[nodiscard]] std::uint32_t at(int x, int y) const
        {
            return pixels[static_cast<std::size_t>(y) * static_cast<std::size_t>(pixelWidth)
                          + static_cast<std::size_t>(x)];
        }

        std::vector<std::uint32_t> pixels;
        int pixelWidth = 0;
        int pixelHeight = 0;
        bool lost = false;
        int presents = 0;
        Region presented;
    };

    void fill(RasterSurface& surface, std::uint32_t color)
    {
        auto* pixels = static_cast<std::uint32_t*>(surface.bitmap().pixels);
        for (int i = 0; i < surface.width() * surface.height(); ++i)
            pixels[i] = color;
    }

    Layer layerOf(LayerId id, RasterSurface& surface, IntRect bounds, Region damage = {})
    {
        return { .id = id, .bounds = bounds, .content = RasterContent { &surface, std::move(damage) } };
    }

    int channel(std::uint32_t pixel, int shift)
    {
        return static_cast<int>((pixel >> shift) & 0xFF);
    }

    bool near(std::uint32_t pixel, int a, int r, int g, int b, int tolerance = 2)
    {
        return std::abs(channel(pixel, 24) - a) <= tolerance && std::abs(channel(pixel, 16) - r) <= tolerance
               && std::abs(channel(pixel, 8) - g) <= tolerance && std::abs(channel(pixel, 0) - b) <= tolerance;
    }
} // namespace

TEST_SUITE("render::RasterCompositor")
{
    TEST_CASE("presents a single full-view layer, then only what changed")
    {
        MemoryTarget target;
        RasterCompositor compositor(target);
        CHECK_FALSE(compositor.capabilities().gpu);

        RasterSurface ui;
        ui.resize(20, 10);
        fill(ui, red);
        const LayerId id = newLayerId();
        Frame frame { .width = 20, .height = 10, .layers = { layerOf(id, ui, ui.bounds(), Region(ui.bounds())) } };
        compositor.composite(frame);
        CHECK(target.presents == 1);
        CHECK(target.at(0, 0) == red);
        CHECK(target.at(19, 9) == red);
        CHECK(compositor.statistics().pixelsComposited == 200);

        SUBCASE("nothing changed: nothing is drawn or presented")
        {
            frame.layers[0] = layerOf(id, ui, ui.bounds());
            compositor.composite(frame);
            CHECK(target.presents == 1);
            CHECK(compositor.statistics().pixelsComposited == 0);
        }

        SUBCASE("a small change: only it is drawn and presented")
        {
            static_cast<std::uint32_t*>(ui.bitmap().pixels)[3 * 20 + 4] = blue;
            frame.layers[0] = layerOf(id, ui, ui.bounds(), Region({ 4, 3, 1, 1 }));
            compositor.composite(frame);
            CHECK(target.presents == 2);
            CHECK(target.presented.area() == 1);
            CHECK(target.at(4, 3) == blue);
            CHECK(compositor.statistics().pixelsComposited == 1);
        }

        SUBCASE("the target lost its pixels: everything is drawn again")
        {
            target.lost = true;
            frame.layers[0] = layerOf(id, ui, ui.bounds());
            compositor.composite(frame);
            CHECK(target.presented.area() == 200);
            CHECK(target.at(10, 5) == red);
        }

        SUBCASE("another layer in its place: everything is drawn again")
        {
            frame.layers[0] = layerOf(newLayerId(), ui, ui.bounds());
            compositor.composite(frame);
            CHECK(target.presented.area() == 200);
        }
    }

    TEST_CASE("stacks layers bottom to top with premultiplied alpha")
    {
        MemoryTarget target;
        RasterCompositor compositor(target);
        RasterSurface bottom;
        bottom.resize(10, 10);
        fill(bottom, red);
        RasterSurface top;
        top.resize(4, 4);
        // Blue at half alpha, premultiplied.
        fill(top, 0x80000080);
        Layer over = layerOf(newLayerId(), top, { 2, 2, 4, 4 });
        Frame frame { .width = 10, .height = 10, .layers = { layerOf(newLayerId(), bottom, bottom.bounds()), over } };
        compositor.composite(frame);
        CHECK(target.at(0, 0) == red);
        CHECK(target.at(1, 1) == red);
        // Source over: half blue on red.
        CHECK(near(target.at(3, 3), 255, 127, 0, 128));
        CHECK(target.at(6, 6) == red);
        CHECK(compositor.statistics().layersComposited == 2);

        SUBCASE("opacity scales the layer")
        {
            frame.layers[1].opacity = 0.5f;
            compositor.composite(frame);
            // A quarter blue on red.
            CHECK(near(target.at(3, 3), 255, 191, 0, 64));
        }

        SUBCASE("moving a layer redraws where it was and where it is")
        {
            frame.layers[1].bounds = { 5, 5, 4, 4 };
            compositor.composite(frame);
            CHECK(target.at(3, 3) == red);
            CHECK(near(target.at(6, 6), 255, 127, 0, 128));
            CHECK(target.presented.bounds() == IntRect { 2, 2, 7, 7 });
        }

        SUBCASE("removing a layer redraws where it was")
        {
            frame.layers.pop_back();
            compositor.composite(frame);
            CHECK(target.at(3, 3) == red);
            CHECK(target.presented.bounds() == IntRect { 2, 2, 4, 4 });
        }

        SUBCASE("order is the frame's")
        {
            std::swap(frame.layers[0], frame.layers[1]);
            compositor.composite(frame);
            CHECK(target.at(3, 3) == red);
        }
    }

    TEST_CASE("leaves what no layer covers transparent")
    {
        MemoryTarget target;
        RasterCompositor compositor(target);
        RasterSurface small;
        small.resize(2, 2);
        fill(small, blue);
        compositor.composite({ .width = 6, .height = 6, .layers = { layerOf(newLayerId(), small, { 1, 1, 2, 2 }) } });
        CHECK(target.at(0, 0) == 0);
        CHECK(target.at(1, 1) == blue);
        CHECK(target.at(5, 5) == 0);
    }

    TEST_CASE("clips a layer to a rounded rectangle")
    {
        MemoryTarget target;
        RasterCompositor compositor(target);
        RasterSurface surface;
        surface.resize(20, 20);
        fill(surface, red);
        Layer layer = layerOf(newLayerId(), surface, surface.bounds());
        layer.clip = Clip { 0, 0, 10, 20, { 8, 0, 0, 0 } };
        compositor.composite({ .width = 20, .height = 20, .layers = { layer } });
        CHECK(target.at(0, 0) == 0);    // cut by the corner
        CHECK(target.at(5, 10) == red); // inside
        CHECK(target.at(15, 10) == 0);  // past the clip
    }

    TEST_CASE("transforms a layer")
    {
        MemoryTarget target;
        RasterCompositor compositor(target);
        RasterSurface surface;
        surface.resize(4, 4);
        fill(surface, red);
        Layer layer = layerOf(newLayerId(), surface, surface.bounds());
        layer.transform = { 2, 0, 0, 2, 10, 0 };
        compositor.composite({ .width = 20, .height = 10, .layers = { layer } });
        CHECK(target.at(9, 3) == 0);
        CHECK(target.at(11, 1) == red);
        CHECK(target.at(17, 7) == red);
        CHECK(target.at(18, 9) == 0);
    }
}
