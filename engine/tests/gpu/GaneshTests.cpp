#include "../web/WebTestSupport.h"
#include "GpuTestSupport.h"
#include "gpu/OffscreenCompositor.h"
#include "render/DrawingSurface.h"

#include <include/core/SkCanvas.h>

#include <algorithm>
#include <cstdint>
#include <vector>

using namespace soundor;

namespace
{
    RuntimeHost::Options ganeshOptions(const std::shared_ptr<gpu::Device>& device)
    {
        RuntimeHost::Options options;
        options.gpuDevice = device;
        options.allowSoftwareGpu = true;
        return options;
    }

    std::shared_ptr<render::GaneshContext> ganeshContext(const std::shared_ptr<gpu::Device>& device)
    {
        std::string failure;
        auto context = render::GaneshContext::create(device, &failure);
        INFO("ANGLE backend: " << gpu::name(device->info().backend) << ", renderer: " << device->info().renderer
                               << ", shared textures: " << device->info().sharesTextures
                               << ", EGL fences: " << device->info().fences);
        REQUIRE_MESSAGE(context != nullptr, failure);
        return context;
    }

    struct Scene : test::WebFixture
    {
        explicit Scene(const std::shared_ptr<gpu::Device>& device)
            : WebFixture(ganeshOptions(device)), compositor(device)
        {
            REQUIRE(ganeshContext(device) != nullptr);
            host.surface().setSize({ 64, 64 });
        }
        void show()
        {
            host.tick();
            const auto& frame = host.frame(compositor.capabilities());
            REQUIRE_FALSE(frame.layers.empty());
            REQUIRE(std::holds_alternative<render::GpuContent>(frame.layers.front().content));
            CHECK(frame.statistics.gpuReadbacks == 0);
            compositor.composite(frame);
            CHECK(compositor.statistics().bytesUploaded == 0);
        }
        std::uint32_t at(int x, int y)
        {
            return compositor.readPixels()[static_cast<std::size_t>(y) * 64 + static_cast<std::size_t>(x)];
        }
        gpu::OffscreenCompositor compositor;
    };
} // namespace

TEST_SUITE("Skia Ganesh")
{
    TEST_CASE("texture snapshots outlive their source and restore the host GL context")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        auto hostContext = gpu::Context::create(device, {});
        REQUIRE(hostContext != nullptr);
        const gpu::CurrentContext hostCurrent(*hostContext);
        REQUIRE(hostCurrent.ok());
        const auto original = eglGetCurrentContext();
        auto renderer = ganeshContext(device);
        REQUIRE(renderer != nullptr);
        CHECK(eglGetCurrentContext() == original);
        std::shared_ptr<render::GpuImage> result;
        {
            const auto current = renderer->makeCurrent();
            REQUIRE(current != nullptr);
            auto source = render::GaneshSurface::create(renderer, 8, 8);
            REQUIRE(source != nullptr);
            source->begin().clear(SK_ColorRED);
            const auto snapshot = source->snapshot();
            source.reset();
            auto destination = render::GaneshSurface::create(renderer, 8, 8);
            REQUIRE(destination != nullptr);
            destination->begin().drawImage(snapshot, 0, 0);
            destination->publish();
            result = destination->image();
        }
        CHECK(eglGetCurrentContext() == original);
        render::RasterSurface pixels;
        REQUIRE(result->read(pixels));
        CHECK(pixels.pixels()[2 * 8 + 2] == 0xFFFF0000);
        CHECK(eglGetCurrentContext() == original);
        result.reset();
        renderer.reset();
        CHECK(eglGetCurrentContext() == original);
    }

    TEST_CASE("retained UI stays on the GPU, repairs damage, resizes and falls back to CPU")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        REQUIRE(ganeshContext(device) != nullptr);
        Scene scene(device);
        scene.run(R"(
            import {root,createView} from 'soundor:ui';
            root.style.backgroundColor='red';
            globalThis.panel=createView({position:'absolute',left:8,top:8,width:16,height:16,backgroundColor:'blue'});
            root.appendChild(panel);
        )");
        scene.show();
        CHECK(scene.at(2, 2) == 0xFFFF0000);
        CHECK(scene.at(12, 12) == 0xFF0000FF);
        scene.run("panel.style.backgroundColor='lime';");
        scene.show();
        CHECK(scene.at(12, 12) == 0xFF00FF00);
        CHECK(scene.at(40, 40) == 0xFFFF0000);
        scene.run("panel.style.left=32;");
        scene.show();
        CHECK(scene.at(12, 12) == 0xFFFF0000);
        CHECK(scene.at(36, 12) == 0xFF00FF00);
        const auto& unchanged = scene.host.frame(scene.compositor.capabilities());
        CHECK(unchanged.statistics.layersRasterized == 0);
        scene.compositor.composite(unchanged);
        CHECK(scene.compositor.statistics().drawCalls == 0);
        CHECK(scene.compositor.statistics().bytesUploaded == 0);
        // Switching to a CPU compositor repaints retained UI; no stale GPU layer.
        const auto& cpu = scene.host.frame({});
        REQUIRE(cpu.layers.size() == 1);
        REQUIRE(std::holds_alternative<render::RasterContent>(cpu.layers[0].content));
        CHECK(std::get<render::RasterContent>(cpu.layers[0].content).surface->pixels()[12 * 64 + 36] == 0xFF00FF00);
        scene.host.surface().setScale(2);
        const auto& scaled = scene.host.frame(scene.compositor.capabilities());
        CHECK(scaled.width == 128);
        REQUIRE(std::holds_alternative<render::GpuContent>(scaled.layers[0].content));
        scene.compositor.composite(scaled);
        CHECK(scene.compositor.statistics().bytesUploaded == 0);
    }

    TEST_CASE("rounded clips, shadows, opacity, text and SVG agree with raster drawing")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        Scene scene(device);
        scene.run(R"(
            import {root,createView,createText,createSvg} from 'soundor:ui';
            root.style.backgroundColor='white';
            const box=createView({position:'absolute',left:8,top:8,width:36,height:36,
                backgroundColor:'red',borderRadius:8,overflow:'hidden',opacity:0.75,
                boxShadow:[{offsetX:2,offsetY:2,blur:5,color:'rgba(0,0,0,0.3)'}]});
            box.appendChild(createText('Aa',{fontSize:20,color:'blue'}));root.appendChild(box);
            const svg=createSvg({position:'absolute',left:40,top:4,width:20,height:20});
            svg.setSvgScene({version:1,viewBox:[0,0,20,20],presentation:{fill:'lime'},
                children:[{type:'circle',cx:10,cy:10,r:8}]});root.appendChild(svg);
        )");
        scene.show();
        const auto gpu = scene.compositor.readPixels();
        render::RasterSurface raster;
        raster.resize(64, 64);
        scene.host.render(raster.bitmap());
        std::uint64_t difference = 0;
        int edgeDifferences = 0;
        for (std::size_t i = 0; i < gpu.size(); ++i)
        {
            int worst = 0;
            for (int shift = 0; shift < 32; shift += 8)
            {
                const int delta = std::abs(static_cast<int>((gpu[i] >> shift) & 255)
                                           - static_cast<int>((raster.pixels()[i] >> shift) & 255));
                difference += static_cast<std::uint64_t>(delta);
                worst = std::max(worst, delta);
            }
            edgeDifferences += worst > 32 ? 1 : 0;
        }
        // Raster/Ganesh edge coverage can differ, but the image as a whole
        // must agree. This also catches missing shadows, text or SVG content.
        CHECK(difference < gpu.size() * 4 * 3);
        CHECK(edgeDifferences < 100);
    }

    TEST_CASE("Canvas 2D pixels, clipping, snapshots and reset retain Web semantics on the GPU")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        Scene scene(device);
        scene.run(R"(
            import {root,createCanvas} from 'soundor:ui';
            root.style.backgroundColor='red';
            globalThis.c=createCanvas({width:32,height:32});root.appendChild(c);c.width=32;c.height=32;
            globalThis.ctx=c.getContext('2d');
            ctx.fillStyle='blue';ctx.fillRect(0,0,32,32);
            ctx.save();ctx.beginPath();ctx.rect(0,0,16,16);ctx.clip();
            ctx.fillStyle='lime';ctx.fillRect(0,0,32,32);ctx.restore();
            globalThis.result=Array.from(ctx.getImageData(0,0,1,1).data).join(',');
        )");
        CHECK(scene.eval("result").asString() == "0,255,0,255");
        scene.show();
        CHECK(scene.at(4, 4) == 0xFF00FF00);
        CHECK(scene.at(20, 20) == 0xFF0000FF);
        scene.run(R"(
            const pattern=ctx.createPattern(c,'no-repeat');
            ctx.fillStyle='white';ctx.fillRect(0,0,32,32);
            ctx.fillStyle=pattern;ctx.fillRect(0,0,32,32);
            const pixel=ctx.createImageData(1,1);pixel.data.set([255,0,255,255]);
            ctx.save();ctx.translate(20,20);ctx.globalAlpha=0.1;
            ctx.beginPath();ctx.rect(0,0,1,1);ctx.clip();
            ctx.putImageData(pixel,4,4);ctx.restore();
            globalThis.result=Array.from(ctx.getImageData(4,4,1,1).data).join(',');
        )");
        CHECK(scene.eval("result").asString() == "255,0,255,255");
        scene.show();
        CHECK(scene.at(4, 4) == 0xFFFF00FF);
        CHECK(scene.at(20, 20) == 0xFF0000FF);
        // Self-copy snapshots the old contents before writing the destination.
        scene.run("ctx.drawImage(c,0,0,16,16,16,16,16,16);");
        scene.show();
        CHECK(scene.at(20, 20) == 0xFFFF00FF);
        // A same-size assignment clears even without a subsequent draw.
        scene.run("c.width=32;");
        scene.show();
        CHECK(scene.at(4, 4) == 0xFFFF0000);
        scene.run("ctx.fillStyle='blue';ctx.fillRect(0,0,32,32);");
        scene.show();
        CHECK(scene.at(4, 4) == 0xFF0000FF);
    }

    TEST_CASE("Ganesh and WebGL share the compositor without UI uploads or canvas readbacks")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        Scene scene(device);
        scene.run(R"(
            import {root,createCanvas,createView} from 'soundor:ui';
            root.style.backgroundColor='red';
            const c=createCanvas({width:32,height:32});root.appendChild(c);c.width=32;c.height=32;
            globalThis.gl=c.getContext('webgl2',{antialias:false});
            gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
            root.appendChild(createView({position:'absolute',left:4,top:4,width:8,height:8,backgroundColor:'lime'}));
        )");
        scene.show();
        CHECK(scene.at(8, 8) == 0xFF00FF00);
        CHECK(scene.at(20, 20) == 0xFF0000FF);
        CHECK(scene.at(50, 50) == 0xFFFF0000);
        scene.run("gl.clearColor(1,1,0,1);gl.clear(gl.COLOR_BUFFER_BIT);");
        scene.show();
        CHECK(scene.at(20, 20) == 0xFFFFFF00);
        CHECK(scene.at(8, 8) == 0xFF00FF00);
    }
}
