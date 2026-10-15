#include "GpuTestSupport.h"
#include "TestWindow.h"

#include <soundor/render/GpuCompositor.h>

#include <cstdint>
#include <memory>
#include <string>

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
#if defined(__linux__)
            // Linux composites on the CPU (see NoPresentation.cpp), and says so.
            std::string failure;
            CHECK(render::GpuCompositor::create({ .allowSoftware = true }, &failure).get() == nullptr);
            CHECK(failure.find("Linux") != std::string::npos);
#endif
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
}
