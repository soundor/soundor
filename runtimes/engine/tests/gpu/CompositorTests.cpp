#include "GpuTestSupport.h"
#include "gpu/OffscreenCompositor.h"

#include <soundor/render/Compositor.h>

#include <cstdint>
#include <cstdlib>
#include <vector>

using namespace soundor;

namespace
{
    constexpr std::uint32_t red = 0xFFFF0000;
    constexpr std::uint32_t blue = 0xFF0000FF;

    // Pixels kept from present to present, for the CPU compositor.
    struct MemoryTarget final : render::RasterTarget
    {
        Pixels acquire(int width, int height) override
        {
            const bool preserved = width == pixelWidth && height == pixelHeight;
            if (! preserved)
                pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
            pixelWidth = width;
            pixelHeight = height;
            return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
        }
        void present(const render::Region&) override {}

        std::vector<std::uint32_t> pixels;
        int pixelWidth = 0;
        int pixelHeight = 0;
    };

    void fill(render::RasterSurface& surface, std::uint32_t color, render::IntRect rect = { 0, 0, 1 << 20, 1 << 20 })
    {
        const render::IntRect inside = rect.intersected(surface.bounds());
        auto* pixels = static_cast<std::uint32_t*>(surface.bitmap().pixels);
        for (int y = inside.y; y < inside.bottom(); ++y)
            for (int x = inside.x; x < inside.right(); ++x)
                pixels[static_cast<std::size_t>(y) * static_cast<std::size_t>(surface.width())
                       + static_cast<std::size_t>(x)] = color;
    }

    render::Layer layerOf(render::LayerId id, render::RasterSurface& surface, render::IntRect bounds,
                          render::Region damage = {})
    {
        return { .id = id, .bounds = bounds, .content = render::RasterContent { &surface, std::move(damage) } };
    }

    int largestDifference(std::uint32_t a, std::uint32_t b)
    {
        int largest = 0;
        for (int shift = 0; shift < 32; shift += 8)
            largest = std::max(largest,
                               std::abs(static_cast<int>((a >> shift) & 0xFF) - static_cast<int>((b >> shift) & 0xFF)));
        return largest;
    }

    // The GPU's composition of `frame` against the CPU's: equal but for
    // rounding, except along a rounded clip's curves, where the GPU's
    // antialiasing (by distance) and Skia's (by area) differ a little:
    // `curved` pixels may differ by up to 64 levels there.
    void compareWithCpu(gpu::OffscreenCompositor& gpuCompositor, const render::Frame& frame, int curved = 0)
    {
        MemoryTarget target;
        render::RasterCompositor cpu(target);
        cpu.composite(frame);
        gpuCompositor.composite(frame);
        const std::vector<std::uint32_t> drawn = gpuCompositor.readPixels();
        REQUIRE(drawn.size() == target.pixels.size());
        int worst = 0;
        int different = 0;
        for (std::size_t i = 0; i < drawn.size(); ++i)
        {
            const int difference = largestDifference(drawn[i], target.pixels[i]);
            worst = std::max(worst, difference);
            different += difference > 2 ? 1 : 0;
        }
        CHECK_MESSAGE(different <= curved, different << " pixels differ from the CPU's composition");
        CHECK_MESSAGE(worst <= (curved > 0 ? 64 : 2),
                      "the GPU's composition differs from the CPU's by up to " << worst);
    }
} // namespace

TEST_SUITE("gpu::LayerRenderer")
{
    TEST_CASE("composites like the CPU compositor: order, alpha, opacity, transforms, clips")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        gpu::OffscreenCompositor gpuCompositor(device);

        render::RasterSurface bottom;
        bottom.resize(40, 30);
        fill(bottom, red);
        fill(bottom, 0, { 0, 0, 5, 5 }); // a transparent corner
        render::RasterSurface top;
        top.resize(10, 10);
        fill(top, 0x80000080); // half blue, premultiplied
        render::Frame frame { .width = 40, .height = 30 };
        frame.layers = { layerOf(render::newLayerId(), bottom, bottom.bounds()),
                         layerOf(render::newLayerId(), top, { 5, 5, 10, 10 }) };
        compareWithCpu(gpuCompositor, frame);

        SUBCASE("opacity")
        {
            frame.layers[1].opacity = 0.5f;
            compareWithCpu(gpuCompositor, frame);
        }
        SUBCASE("moved by whole pixels")
        {
            frame.layers[1].transform = render::Transform::translate(12, 3);
            compareWithCpu(gpuCompositor, frame);
        }
        SUBCASE("a rectangular clip")
        {
            frame.layers[1].clip = render::Clip { 8, 8, 4, 20 };
            compareWithCpu(gpuCompositor, frame);
        }
        SUBCASE("a rounded clip, antialiased")
        {
            frame.layers[0].clip = render::Clip { 0, 0, 40, 30, { 10, 0, 6, 0 } };
            compareWithCpu(gpuCompositor, frame, 32);
        }
        SUBCASE("order is the frame's")
        {
            std::swap(frame.layers[0], frame.layers[1]);
            compareWithCpu(gpuCompositor, frame);
        }
    }

    TEST_CASE("uploads a layer once, then only what changed, and nothing when nothing did")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        gpu::OffscreenCompositor gpuCompositor(device);
        render::RasterSurface ui;
        ui.resize(64, 32);
        fill(ui, red);
        const render::LayerId id = render::newLayerId();
        render::Frame frame { .width = 64,
                              .height = 32,
                              .layers = { layerOf(id, ui, ui.bounds(), render::Region(ui.bounds())) } };

        gpuCompositor.composite(frame);
        CHECK(gpuCompositor.statistics().bytesUploaded == 64 * 32 * 4);
        CHECK(gpuCompositor.statistics().textureAllocations >= 1);
        CHECK(gpuCompositor.statistics().drawCalls == 1);

        frame.layers[0] = layerOf(id, ui, ui.bounds());
        gpuCompositor.composite(frame);
        CHECK(gpuCompositor.statistics().bytesUploaded == 0);
        CHECK(gpuCompositor.statistics().textureAllocations == 0);
        CHECK(gpuCompositor.statistics().drawCalls == 0);

        fill(ui, blue, { 10, 4, 3, 2 });
        frame.layers[0] = layerOf(id, ui, ui.bounds(), render::Region({ 10, 4, 3, 2 }));
        gpuCompositor.composite(frame);
        CHECK(gpuCompositor.statistics().bytesUploaded == 3 * 2 * 4);
        CHECK(gpuCompositor.statistics().textureAllocations == 0);
        const auto pixels = gpuCompositor.readPixels();
        CHECK(pixels[4 * 64 + 10] == blue);
        CHECK(pixels[4 * 64 + 13] == red);
        CHECK(gpuCompositor.statistics().readbacks == 0);
    }

    TEST_CASE("a resized layer gets a new texture")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        gpu::OffscreenCompositor gpuCompositor(device);
        render::RasterSurface ui;
        ui.resize(16, 16);
        fill(ui, red);
        const render::LayerId id = render::newLayerId();
        gpuCompositor.composite({ .width = 16, .height = 16, .layers = { layerOf(id, ui, ui.bounds()) } });
        ui.resize(32, 16);
        fill(ui, blue);
        gpuCompositor.composite({ .width = 32, .height = 16, .layers = { layerOf(id, ui, ui.bounds()) } });
        CHECK(gpuCompositor.statistics().bytesUploaded == 32 * 16 * 4);
        CHECK(gpuCompositor.readPixels()[20] == blue);
    }
}
