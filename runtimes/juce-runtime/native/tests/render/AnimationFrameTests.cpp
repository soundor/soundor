#include "../web/WebTestSupport.h"

#include <soundor/render/Compositor.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#if SOUNDOR_TEST_GPU
    #include "../gpu/GpuTestSupport.h"
    #include "gpu/OffscreenCompositor.h"
#endif

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

using namespace soundor;

namespace
{
    struct Target final : render::RasterTarget
    {
        render::RasterSurface pixels;
        Pixels acquire(int width, int height) override
        {
            const bool resized = pixels.resize(width, height);
            return { pixels.bitmap(), ! resized };
        }
        void present(const render::Region&) override {}
    };

    struct Scene
    {
        double time = 0;
        RuntimeHost host { RuntimeHost::Options {} };
        ui::NodeId panel = host.surface().createNode(ui::NodeType::View);
        ui::NodeId child = host.surface().createNode(ui::NodeType::View);
        Scene()
        {
            auto& surface = host.surface();
            surface.setSize({ 100, 100 });
            surface.animations().setClock([this] { return time; });
            ui::Style style;
            style.backgroundColor = { 0, 0, 255, 255 };
            surface.setStyle(surface.root().id(), style);
            style.position = ui::Position::Absolute;
            style.inset.left = ui::Length::points(20);
            style.inset.top = ui::Length::points(20);
            style.width = ui::Length::points(40);
            style.height = ui::Length::points(40);
            style.backgroundColor = { 255, 0, 0, 255 };
            style.overflow = ui::Overflow::Hidden;
            style.borderRadius = { 6, 6, 6, 6 };
            surface.setStyle(panel, style);
            surface.insertChild(surface.root().id(), panel);
            style.inset.left = ui::Length::points(15);
            style.inset.top = ui::Length::points(15);
            style.width = ui::Length::points(40);
            style.height = ui::Length::points(40);
            style.backgroundColor = { 0, 255, 0, 255 };
            style.overflow = ui::Overflow::Visible;
            style.borderRadius = {};
            surface.setStyle(child, style);
            surface.insertChild(panel, child);
            const auto marker = surface.createNode(ui::NodeType::View);
            style.inset.left = ui::Length::points(75);
            style.inset.top = ui::Length::points(5);
            style.width = ui::Length::points(15);
            style.height = ui::Length::points(15);
            style.backgroundColor = { 255, 255, 0, 255 };
            surface.setStyle(marker, style);
            surface.insertChild(surface.root().id(), marker);
            ui::AnimationDescription animation;
            animation.to[ui::AnimatedProperty::Opacity] = 0.5f;
            animation.to[ui::AnimatedProperty::TranslateX] = 12;
            animation.to[ui::AnimatedProperty::Rotate] = 0.2f;
            animation.to.order[0] = ui::AnimatedProperty::TranslateX;
            animation.to.order[1] = ui::AnimatedProperty::Rotate;
            animation.to.count = 2;
            animation.properties = ui::propertyBit(ui::AnimatedProperty::Opacity)
                                   | ui::propertyBit(ui::AnimatedProperty::TranslateX)
                                   | ui::propertyBit(ui::AnimatedProperty::Rotate);
            animation.timing.duration = 100;
            animation.timing.fill = ui::Fill::Forwards;
            surface.animations().animate(panel, animation);
        }
        void step(double value)
        {
            time = value;
            host.tick();
        }
        std::vector<std::uint32_t> whole()
        {
            std::vector<std::uint32_t> pixels(100ULL * 100);
            host.render({ pixels.data(), 100, 100, 100ULL * 4 });
            return pixels;
        }
    };

    int difference(std::uint32_t x, std::uint32_t y)
    {
        int worst = 0;
        for (int shift = 0; shift < 32; shift += 8)
            worst =
                std::max(worst, std::abs(static_cast<int>((x >> shift) & 255) - static_cast<int>((y >> shift) & 255)));
        return worst;
    }
} // namespace

TEST_SUITE("native animation frames")
{
    TEST_CASE("oversized transformed content uses a bounded viewport fallback")
    {
        RuntimeHost host { RuntimeHost::Options {} };
        auto& surface = host.surface();
        surface.setSize({ 100, 100 });
        const auto node = surface.createNode(ui::NodeType::View);
        ui::Style style;
        style.position = ui::Position::Absolute;
        style.width = ui::Length::points(100000);
        style.height = ui::Length::points(100000);
        style.backgroundColor = { 255, 0, 0, 255 };
        style.transform.count = 3;
        style.transform.order[0] = ui::AnimatedProperty::TranslateX;
        style.transform.order[1] = ui::AnimatedProperty::TranslateY;
        style.transform.order[2] = ui::AnimatedProperty::Scale;
        style.transform[ui::AnimatedProperty::TranslateX] = -49950;
        style.transform[ui::AnimatedProperty::TranslateY] = -49950;
        style.transform[ui::AnimatedProperty::Scale] = 0.001f;
        surface.setStyle(node, style);
        surface.insertChild(surface.root().id(), node);
        Target target;
        render::RasterCompositor compositor(target);
        const auto& frame = host.frame();
        CHECK(frame.statistics.cachedRasterBytes == 100 * 100 * 4);
        CHECK(frame.statistics.layersRasterized == 1);
        compositor.composite(frame);
        CHECK(target.pixels.pixels()[50 * 100 + 50] == 0xffff0000);
        CHECK(host.frame().statistics.cachedRasterBytes <= 64 * 1024 * 1024);
        surface.releaseNode(node);
        CHECK(host.frame().statistics.cachedRasterBytes == 0);
    }

    TEST_CASE("CPU composition caches content, preserves group opacity and clips transformed subtrees")
    {
        Scene scene;
        Target target;
        render::RasterCompositor compositor(target);
        compositor.composite(scene.host.frame());
        for (const double time : { 20., 50., 100. })
        {
            scene.step(time);
            const auto& frame = scene.host.frame();
            CHECK(frame.statistics.layersRasterized == 0);
            compositor.composite(frame);
            const auto whole = scene.whole();
            int worstEdge = 0, worstInterior = 0;
            for (std::size_t i = 0; i < whole.size(); ++i)
            {
                const ui::Point point { static_cast<float>(i % 100) + 0.5f,
                                        std::floor(static_cast<float>(i) / 100) + 0.5f };
                const auto local = scene.host.surface().localPoint(scene.panel, point);
                const float dx = std::abs(local.x - 20) - 14;
                const float dy = std::abs(local.y - 20) - 14;
                const float distance =
                    std::min(std::max(dx, dy), 0.f) + std::hypot(std::max(dx, 0.f), std::max(dy, 0.f)) - 6;
                const bool edge = std::abs(distance) < 1.5f
                                  || (distance < 0 && (std::abs(local.x - 15) < 1.5f || std::abs(local.y - 15) < 1.5f));
                const int changed = difference(whole[i], target.pixels.pixels()[i]);
                if (edge)
                    worstEdge = std::max(worstEdge, changed);
                else
                    worstInterior = std::max(worstInterior, changed);
            }
            // A transformed bitmap filters an already antialiased edge. Check
            // crisp regions separately so this allowance cannot hide alpha,
            // clipping, placement or stacking mistakes.
            CHECK_MESSAGE(worstInterior <= 2, "interior differs by " << worstInterior);
            CHECK_MESSAGE(worstEdge <= 96, "resampled edge differs by " << worstEdge);
            CHECK(scene.host.surface().find(scene.panel)->style().opacity == 1);
        }
        compositor.composite(scene.host.frame());
        CHECK(compositor.statistics().drawCalls == 0);
        auto style = scene.host.surface().find(scene.child)->style();
        style.backgroundColor = { 255, 255, 0, 255 };
        scene.host.surface().setStyle(scene.child, style);
        CHECK(scene.host.frame().statistics.layersRasterized > 0);
    }

#if SOUNDOR_TEST_GPU
    TEST_CASE("mixed WebGL animation shares textures and preserves pixels when switching to CPU fallback")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        double time = 0;
        RuntimeHost::Options options;
        options.gpuDevice = device;
        options.animationClock = [&] { return time; };
        test::WebFixture f(std::move(options));
        f.host.surface().setSize({ 100, 100 });
        f.run(R"(
            import {root,createView,createCanvas} from 'soundor:ui';
            root.style.backgroundColor='blue';
            globalThis.panel=createView({width:40,height:40,position:'absolute',left:20,top:20});
            const canvas=createCanvas({width:40,height:40});canvas.width=40;canvas.height=40;
            panel.appendChild(canvas);root.appendChild(panel);
            const gl=canvas.getContext('webgl2');gl.clearColor(1,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
            globalThis.animation=panel.animate([{opacity:0.5}],{duration:100,fill:'forwards'});
        )");
        gpu::OffscreenCompositor gpu(device);
        gpu.composite(f.host.frame(gpu.capabilities()));
        time = 50;
        f.host.tick();
        const auto& frame = f.host.frame(gpu.capabilities());
        CHECK(frame.statistics.gpuReadbacks == 0);
        CHECK(frame.statistics.layersRasterized == 0);
        gpu.composite(frame);
        CHECK(gpu.statistics().bytesUploaded == 0);
        const auto expected = gpu.readPixels();
        Target target;
        render::RasterCompositor cpu(target);
        const auto& fallback = f.host.frame();
        CHECK(fallback.statistics.gpuReadbacks == 1);
        cpu.composite(fallback);
        CHECK(difference(expected[40 * 100 + 40], target.pixels.pixels()[40 * 100 + 40]) <= 2);
        CHECK(f.host.frame().statistics.gpuReadbacks == 0);
        // Switching back, then removing animation isolation must also retain
        // the last WebGL image on the ordinary CPU damage path.
        gpu.composite(f.host.frame(gpu.capabilities()));
        f.run("animation.cancel();");
        CHECK(f.host.frame().statistics.gpuReadbacks == 1);
        cpu.composite(f.host.frame());
        CHECK(target.pixels.pixels()[40 * 100 + 40] == 0xffff0000);
    }

    TEST_CASE("GPU composition changes presentation without rasterization, uploads or readbacks")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        Scene scene;
        gpu::OffscreenCompositor compositor(device);
        compositor.composite(scene.host.frame(compositor.capabilities()));
        for (const double time : { 20., 50., 100. })
        {
            scene.step(time);
            const auto& frame = scene.host.frame(compositor.capabilities());
            CHECK(frame.statistics.layersRasterized == 0);
            CHECK(frame.statistics.gpuReadbacks == 0);
            compositor.composite(frame);
            CHECK(compositor.statistics().bytesUploaded == 0);
            CHECK(compositor.statistics().textureAllocations == 0);
            CHECK(compositor.statistics().readbacks == 0);
            const auto pixels = compositor.readPixels(); // test verification only
            Target target;
            render::RasterCompositor cpu(target);
            cpu.composite(frame);
            REQUIRE(pixels.size() == static_cast<std::size_t>(target.pixels.width() * target.pixels.height()));
            int worst = 0;
            for (std::size_t i = 0; i < pixels.size(); ++i)
                worst = std::max(worst, difference(target.pixels.pixels()[i], pixels[i]));
            CHECK_MESSAGE(worst <= 2, "GPU differs from CPU cached composition by " << worst);
        }
        compositor.composite(scene.host.frame(compositor.capabilities()));
        CHECK(compositor.statistics().drawCalls == 0);
    }
#endif
}
