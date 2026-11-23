#include "GpuTestSupport.h"
#include "TestWindow.h"

#include <soundor/render/GpuCompositor.h>

#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>

using namespace soundor;

namespace
{
    render::Layer layerOf(render::LayerId id, render::RasterSurface& surface, render::Region damage = {})
    {
        return { .id = id,
                 .bounds = surface.bounds(),
                 .content = render::RasterContent { &surface, std::move(damage) } };
    }
} // namespace

TEST_SUITE("render::GpuCompositor")
{
    TEST_CASE("presents into a native view, drawing only when something changed")
    {
        void* view = test::createTestWindow(160, 120);
        if (view == nullptr)
        {
            if (test::gpuRequired())
                FAIL("no native test window, though SOUNDOR_REQUIRE_GPU=1");
            else
                MESSAGE("skipped: no native test window (Linux needs DISPLAY, e.g. xvfb-run)");
            return;
        }
        std::string failure;
        auto compositor = render::GpuCompositor::create({ .view = { view }, .allowSoftware = true }, &failure);
        if (compositor == nullptr)
        {
            if (test::gpuRequired())
                FAIL("no GPU compositor, though SOUNDOR_REQUIRE_GPU=1: " << failure);
            else
                MESSAGE("skipped: no GPU compositor here (" << failure << ")");
            test::destroyTestWindow(view);
            return;
        }
        MESSAGE("GPU compositor: " << compositor->capabilities().backend);
        CHECK(compositor->capabilities().gpu);
        CHECK(compositor->device().get() != nullptr);
        compositor->setBounds(0, 0, 160, 120, 1);
        compositor->setVisible(true);

        render::RasterSurface ui;
        ui.resize(160, 120);
        const render::LayerId id = render::newLayerId();
        render::Frame frame { .width = 160, .height = 120, .layers = { layerOf(id, ui, render::Region(ui.bounds())) } };
        compositor->composite(frame);
        CHECK(compositor->healthy());
        CHECK(compositor->statistics().drawCalls == 1);
        CHECK(compositor->statistics().bytesUploaded == 160 * 120 * 4);

        // Nothing changed: nothing drawn, nothing presented.
        frame.layers[0] = layerOf(id, ui);
        compositor->composite(frame);
        CHECK(compositor->statistics().drawCalls == 0);

        // Resized: drawn again at the new size.
        ui.resize(200, 150);
        compositor->setBounds(0, 0, 200, 150, 1);
        frame = { .width = 200, .height = 150, .layers = { layerOf(id, ui, render::Region(ui.bounds())) } };
        compositor->composite(frame);
        CHECK(compositor->healthy());
        CHECK(compositor->statistics().drawCalls == 1);

        compositor.reset();
        test::destroyTestWindow(view);
    }

    TEST_CASE("asks for a redraw when placed or shown anew, not when placed the same")
    {
        void* view = test::createTestWindow(160, 120);
        if (view == nullptr)
        {
            if (test::gpuRequired())
                FAIL("no native test window, though SOUNDOR_REQUIRE_GPU=1");
            else
                MESSAGE("skipped: no native test window (Linux needs DISPLAY, e.g. xvfb-run)");
            return;
        }
        std::string failure;
        auto compositor = render::GpuCompositor::create({ .view = { view }, .allowSoftware = true }, &failure);
        if (compositor == nullptr)
        {
            if (test::gpuRequired())
                FAIL("no GPU compositor, though SOUNDOR_REQUIRE_GPU=1: " << failure);
            else
                MESSAGE("skipped: no GPU compositor here (" << failure << ")");
            test::destroyTestWindow(view);
            return;
        }
        // Hidden, it has nothing to present.
        CHECK_FALSE(compositor->needsRedraw());
        compositor->setBounds(0, 0, 160, 120, 1);
        compositor->setVisible(true);
        CHECK(compositor->needsRedraw());

        render::RasterSurface ui;
        ui.resize(160, 120);
        const render::LayerId id = render::newLayerId();
        render::Frame frame { .width = 160, .height = 120, .layers = { layerOf(id, ui, render::Region(ui.bounds())) } };
        // An editor's frames, without UI changes, for half a second: on
        // Linux the window's Expose (it became viewable) asks once more.
        int presents = 0;
        const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
        while (std::chrono::steady_clock::now() < until)
        {
            if (compositor->needsRedraw())
            {
                compositor->composite(frame);
                frame.layers[0] = layerOf(id, ui);
                ++presents;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        CHECK(presents >= 1);
        CHECK(presents <= 2);
        CHECK_FALSE(compositor->needsRedraw());

        // Placed the same, every frame: no redraw.
        compositor->setBounds(0, 0, 160, 120, 1);
        compositor->setVisible(true);
        CHECK_FALSE(compositor->needsRedraw());
        // Moved: drawn again, although no layer changed.
        compositor->setBounds(4, 4, 150, 110, 1);
        CHECK(compositor->needsRedraw());
        compositor->composite(frame);
        CHECK(compositor->statistics().drawCalls == 1);
        CHECK_FALSE(compositor->needsRedraw());
        // Hidden, then shown: drawn again.
        compositor->setVisible(false);
        CHECK_FALSE(compositor->needsRedraw());
        compositor->setVisible(true);
        CHECK(compositor->needsRedraw());

        compositor.reset();
        test::destroyTestWindow(view);
    }
}
