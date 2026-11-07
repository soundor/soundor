#include "../web/WebTestSupport.h"
#include "GpuTestSupport.h"
#include "gpu/OffscreenCompositor.h"

#include <soundor/render/Compositor.h>

#include <cstdint>
#include <string>
#include <vector>

using namespace soundor;
using test::WebFixture;

namespace
{
    RuntimeHost::Options onDevice(std::shared_ptr<gpu::Device> device)
    {
        RuntimeHost::Options options;
        options.gpuDevice = std::move(device);
        options.allowSoftwareGpu = true;
        return options;
    }

    // A 64×64 view, red, with a 32×32 WebGL canvas `c` (context `gl`) at
    // (16, 16), composited on the GPU with the WebGL's own device.
    struct ZeroCopyFixture : WebFixture
    {
        explicit ZeroCopyFixture(const std::shared_ptr<gpu::Device>& device, const std::string& canvasStyle = "{}")
            : WebFixture(onDevice(device)), compositor(device)
        {
            host.surface().setSize({ 64, 64 });
            run(R"(
                import { root, createView, createCanvas } from 'soundor:ui';
                root.style = { backgroundColor: '#ff0000', padding: 16, alignItems: 'flex-start' };
                const g = globalThis;
                g.c = createCanvas({ width: 32, height: 32, ...)"
                + canvasStyle + R"( });
                root.appendChild(g.c);
                g.c.width = 32;
                g.c.height = 32;
                g.gl = g.c.getContext('webgl2', { antialias: false });
                g.fill = (r, gr, b) => { g.gl.clearColor(r, gr, b, 1); g.gl.clear(g.gl.COLOR_BUFFER_BIT); };
            )");
        }

        // A tick, then a frame composited: the frame's statistics.
        render::FrameStatistics show()
        {
            host.tick();
            const render::Frame& frame = host.frame(compositor.capabilities());
            layers = frame.layers.size();
            compositor.composite(frame);
            return frame.statistics;
        }

        // The composited pixel at (x, y), y down, as 0xAARRGGBB.
        std::uint32_t at(int x, int y)
        {
            const std::vector<std::uint32_t> pixels = compositor.readPixels();
            return pixels[(static_cast<std::size_t>(y) * static_cast<std::size_t>(compositor.width()))
                          + static_cast<std::size_t>(x)];
        }

        gpu::OffscreenCompositor compositor;
        std::size_t layers = 0;
    };

    constexpr std::uint32_t red = 0xFFFF0000;
    constexpr std::uint32_t green = 0xFF00FF00;
    constexpr std::uint32_t blue = 0xFF0000FF;
} // namespace

TEST_SUITE("WebGL composited without copies")
{
    TEST_CASE("a WebGL canvas on the compositor's device is a layer of its own, never read back")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        REQUIRE(f.eval("gl !== null").asBoolean());
        f.run("fill(0, 0, 1);");
        const render::FrameStatistics stats = f.show();
        CHECK(stats.gpuLayers == 1);
        CHECK(stats.gpuReadbacks == 0);
        // The UI below it and the canvas: nothing paints above it.
        CHECK(f.layers == 2);
        CHECK(f.at(32, 32) == blue);
        CHECK(f.at(4, 4) == red);
        CHECK(f.at(60, 60) == red);
    }

    TEST_CASE("a canvas drawing every frame redraws and uploads none of the UI")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        f.run("fill(0, 0, 1);");
        (void)f.show();
        for (int i = 0; i < 5; ++i)
        {
            f.run(i % 2 == 0 ? "fill(0, 1, 0);" : "fill(0, 0, 1);");
            const render::FrameStatistics stats = f.show();
            CHECK(stats.layersRasterized == 0);
            CHECK(stats.gpuReadbacks == 0);
            CHECK(f.compositor.statistics().bytesUploaded == 0);
            CHECK(f.at(32, 32) == (i % 2 == 0 ? green : blue));
        }
        // Not drawing: nothing to render.
        (void)f.host.needsRender();
        f.host.tick();
        CHECK_FALSE(f.host.needsRender());
    }

    TEST_CASE("the image's way up, and what paints after the canvas, stay right")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            fill(0, 0, 1);
            // OpenGL's lower half: the canvas's bottom on screen.
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(0, 0, 32, 16);
            fill(0, 1, 0);
            gl.disable(gl.SCISSOR_TEST);
            // Over the canvas's right edge, painted after it.
            root.appendChild(createView({ position: 'absolute', left: 44, top: 16, width: 8, height: 32,
                                          backgroundColor: '#ffffff' }));
        )");
        (void)f.show();
        CHECK(f.at(24, 20) == blue);
        CHECK(f.at(24, 44) == green);
        CHECK(f.at(46, 32) == 0xFFFFFFFF);
    }

    TEST_CASE("a change above a canvas redraws only where the layer above it paints")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            fill(0, 0, 1);
            globalThis.badge = createView({ position: 'absolute', left: 20, top: 20, width: 8, height: 8,
                                            backgroundColor: '#ffffff' });
            root.appendChild(badge);
        )");
        (void)f.show();
        CHECK(f.layers == 3);
        f.run("badge.style.backgroundColor = '#00ff00';");
        const render::FrameStatistics stats = f.show();
        // Only the layer above the canvas, and only around the badge.
        CHECK(stats.layersRasterized == 1);
        CHECK(stats.pixelsRasterized < 20 * 20);
        CHECK(f.compositor.statistics().bytesUploaded < 20 * 20 * 4);
        CHECK(f.at(24, 24) == green);
        CHECK(f.at(32, 32) == blue);
    }

    TEST_CASE("rounded corners and opacity are the layer's")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device, "{ borderRadius: 16, opacity: 0.5 }");
        f.run("fill(0, 0, 1);");
        const render::FrameStatistics stats = f.show();
        CHECK(stats.gpuLayers == 1);
        // The corner shows the background; the middle is half blue over red.
        CHECK(f.at(17, 17) == red);
        const std::uint32_t middle = f.at(32, 32);
        CHECK(((middle >> 16) & 0xFF) > 100);
        CHECK((middle & 0xFF) > 100);
    }

    TEST_CASE("where the compositor cannot show it, the image is read back")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        f.run("fill(0, 0, 1);");
        f.host.tick();
        // A CPU compositor (no device).
        const render::Frame& frame = f.host.frame({});
        CHECK(frame.layers.size() == 1);
        CHECK(frame.statistics.gpuLayers == 0);
        CHECK(frame.statistics.gpuReadbacks == 1);
        // Back on the GPU compositor: a layer again, read back no more.
        f.run("fill(0, 1, 0);");
        const render::FrameStatistics stats = f.show();
        CHECK(stats.gpuLayers == 1);
        CHECK(stats.gpuReadbacks == 0);
        CHECK(f.at(32, 32) == green);
    }

    TEST_CASE("a clip a layer cannot have is drawn on the CPU instead")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ZeroCopyFixture f(device);
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            // A rounded box cutting into the canvas.
            const box = createView({ width: 24, height: 24, borderRadius: 8, overflow: 'hidden' });
            root.removeChild(c);
            box.appendChild(c);
            root.appendChild(box);
            fill(0, 0, 1);
        )");
        const render::FrameStatistics stats = f.show();
        CHECK(stats.gpuLayers == 0);
        CHECK(stats.gpuReadbacks == 1);
        CHECK(f.layers == 1);
        CHECK(f.at(28, 28) == blue);
    }
}
