#include "../web/WebTestSupport.h"

#include <soundor/platform/Resources.h>
#include <soundor/render/Compositor.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>

using namespace soundor;
using test::WebFixture;

namespace
{
    RuntimeHost::Options withImages()
    {
        RuntimeHost::Options options;
        options.resources = std::make_shared<platform::DirectoryResources>(SOUNDOR_TEST_FIXTURES "/images");
        return options;
    }

    // Draws frames as a backend does, and checks every one against the whole
    // view drawn from scratch: drawing only what changed must look the same.
    struct FrameFixture : WebFixture
    {
        explicit FrameFixture(float width = 120, float height = 90, float scale = 1) : WebFixture(withImages())
        {
            host.surface().setSize({ width, height });
            host.surface().setScale(scale);
        }

        const render::Frame& frame()
        {
            const render::Frame& frame = host.frame();
            REQUIRE(frame.layers.size() == 1);
            const auto& content = std::get<render::RasterContent>(frame.layers.front().content);
            REQUIRE(content.surface != nullptr);
            const int width = content.surface->width();
            const int height = content.surface->height();
            std::vector<std::uint32_t> full(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
            host.render({ full.data(), width, height, static_cast<std::size_t>(width) * 4 });
            // Skia flattens a curve cut by a clip a little differently, so
            // where a redrawn area cuts one, its edge pixels may differ by a
            // few levels; nothing may differ by more.
            int worst = 0;
            for (std::size_t i = 0; i < full.size(); ++i)
            {
                const std::uint32_t drawn = content.surface->pixels()[i];
                for (int shift = 0; shift < 32; shift += 8)
                    worst = std::max(worst, std::abs(static_cast<int>((drawn >> shift) & 0xFF)
                                                     - static_cast<int>((full[i] >> shift) & 0xFF)));
            }
            CHECK_MESSAGE(worst <= 32, "pixels differ from a full render by up to " << worst);
            return frame;
        }

        // Applies `script`, then checks the frame after it.
        const render::Frame& step(const std::string& script)
        {
            run(script);
            return frame();
        }
    };

    constexpr const char* scene = R"(
        import { root, overlayRoot, createView, createText, createImage, createScrollView, createTextInput }
            from 'soundor:ui';
        const g = globalThis;
        g.panel = createView({ flexDirection: 'row', padding: 4, backgroundColor: '#eee',
                               borderWidth: 1, borderColor: 'gray', borderRadius: 6 });
        g.a = createView({ width: 20, height: 20, backgroundColor: 'red' });
        g.b = createView({ width: 20, height: 20, backgroundColor: 'blue', marginLeft: 4 });
        g.label = createText('Gain', { fontSize: 12, color: 'black' });
        g.panel.appendChild(g.a);
        g.panel.appendChild(g.b);
        g.panel.appendChild(g.label);
        root.appendChild(g.panel);
        g.list = createScrollView({ height: 30, overflow: 'hidden', backgroundColor: 'white' });
        for (let i = 0; i < 6; i++)
            g.list.appendChild(createView({ height: 10, backgroundColor: i % 2 ? 'green' : 'yellow' }));
        root.appendChild(g.list);
        g.image = createImage('', { width: 16, height: 16 });
        root.appendChild(g.image);
        g.input = createTextInput({ value: 'abc', style: { width: 60, fontSize: 12 } });
        root.appendChild(g.input);
        g.badge = createView({ position: 'absolute', left: 90, top: 2, width: 12, height: 12,
                               backgroundColor: 'purple' });
        overlayRoot.appendChild(g.badge);
    )";
} // namespace

TEST_SUITE("render::ViewRenderer")
{
    TEST_CASE("the first frame draws everything, an unchanged one nothing")
    {
        FrameFixture f;
        f.run(scene);
        const render::Frame& first = f.frame();
        CHECK(first.width == 120);
        CHECK(first.height == 90);
        CHECK(first.damage.area() == 120 * 90);
        CHECK(first.statistics.layersRasterized == 1);
        const render::LayerId id = first.layers.front().id;

        const render::Frame& second = f.frame();
        CHECK(second.damage.empty());
        CHECK(second.statistics.layersRasterized == 0);
        CHECK(second.statistics.pixelsRasterized == 0);
        CHECK(std::get<render::RasterContent>(second.layers.front().content).damage.empty());
        CHECK(second.layers.front().id == id);
    }

    TEST_CASE("draws again only what changed, exactly as a full redraw would")
    {
        FrameFixture f;
        f.run(scene);
        f.frame();
        constexpr long long view = 120LL * 90;

        SUBCASE("a color")
        {
            const auto& frame = f.step("globalThis.a.style = { width: 20, height: 20, backgroundColor: 'lime' };");
            CHECK(frame.damage.area() > 0);
            CHECK(frame.damage.area() < view / 10);
            CHECK(frame.statistics.pixelsRasterized == frame.damage.area());
        }
        SUBCASE("a size that moves siblings")
        {
            f.step("globalThis.a.style = { width: 30, height: 20, backgroundColor: 'red' };");
        }
        SUBCASE("removing and adding")
        {
            f.step("globalThis.panel.removeChild(globalThis.b);");
            f.step("globalThis.list.appendChild(globalThis.b);");
            f.step("globalThis.b.remove();");
        }
        SUBCASE("text")
        {
            f.step("globalThis.label.text = 'Gain (dB)';");
            f.step("globalThis.label.style = { fontSize: 16, color: 'navy' };");
        }
        SUBCASE("opacity and display of a parent")
        {
            f.step("globalThis.panel.style = { ...globalThis.panel.style, opacity: 0.5 };");
            f.step("globalThis.panel.style = { ...globalThis.panel.style, display: 'none' };");
            f.step("globalThis.panel.style = { ...globalThis.panel.style, display: 'flex', opacity: 1 };");
        }
        SUBCASE("clipping")
        {
            f.step("globalThis.panel.style = { ...globalThis.panel.style, height: 12, overflow: 'hidden' };");
            f.step("globalThis.panel.style = { ...globalThis.panel.style, overflow: 'visible' };");
        }
        SUBCASE("scrolling")
        {
            const auto& frame = f.step("globalThis.list.scrollTop = 7;");
            CHECK(frame.damage.area() < view / 2);
            f.step("globalThis.list.scrollTop = 30;");
        }
        SUBCASE("stacking")
        {
            f.step("globalThis.a.style = { ...globalThis.a.style, marginRight: -10, zIndex: 2 };");
            f.step("globalThis.a.style = { ...globalThis.a.style, zIndex: 0 };");
        }
        SUBCASE("an image")
        {
            f.step("globalThis.image.source = 'halves.png';");
            f.step("globalThis.image.source = '';");
        }
        SUBCASE("an input's text")
        {
            f.step("globalThis.input.value = 'abcdef';");
        }
        SUBCASE("the overlay")
        {
            f.step("globalThis.badge.style = { ...globalThis.badge.style, left: 60 };");
            f.step("globalThis.badge.remove();");
        }
        SUBCASE("a subtree moved between parents")
        {
            f.step("globalThis.list.appendChild(globalThis.panel);");
            f.step("import { root } from 'soundor:ui'; root.insertBefore(globalThis.panel, globalThis.list);");
        }
        SUBCASE("the view's size")
        {
            f.host.surface().setSize({ 100, 70 });
            const auto& frame = f.frame();
            CHECK(frame.width == 100);
            CHECK(frame.damage.area() == 100 * 70);
        }
    }

    TEST_CASE("draws only what changed at a fractional scale too")
    {
        FrameFixture f(100, 80, 1.5f);
        f.run(scene);
        f.frame();
        f.step("globalThis.a.style = { width: 21.3, height: 20, backgroundColor: 'lime' };");
        f.step("globalThis.list.scrollTop = 3.7;");
        f.step("globalThis.label.text = 'Mix';");
    }

    TEST_CASE("a large curve partly redrawn stays smooth")
    {
        FrameFixture f(160, 160, 2);
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            const knob = createView({ width: 140, height: 140, borderRadius: 70, borderWidth: 6,
                                      borderColor: '#334', backgroundColor: '#ccd', overflow: 'hidden' });
            globalThis.dot = createView({ position: 'absolute', left: 4, top: 60, width: 8, height: 8,
                                          backgroundColor: 'red' });
            knob.appendChild(globalThis.dot);
            root.appendChild(knob);
        )");
        f.frame();
        for (int i = 1; i <= 8; ++i)
            f.step("globalThis.dot.style = { ...globalThis.dot.style, left: " + std::to_string(i * 3)
                   + ", top: " + std::to_string(60 - i * 6) + " };");
    }

    TEST_CASE("focusing an input draws its caret")
    {
        FrameFixture f;
        f.run(scene);
        f.frame();
        f.run("globalThis.input.focus();");
        const render::Frame& frame = f.host.frame();
        const auto x =
            static_cast<int>(f.run("globalThis.result = globalThis.input.getBoundingClientRect().x;").asNumber());
        const auto y =
            static_cast<int>(f.run("globalThis.result = globalThis.input.getBoundingClientRect().y;").asNumber());
        CHECK(frame.damage.intersects({ x, y, 4, 4 }));
        CHECK(frame.damage.area() < 120 * 90 / 4);
    }

    TEST_CASE("presents through a compositor, drawing only what changed")
    {
        struct Target final : render::RasterTarget
        {
            Pixels acquire(int width, int height) override
            {
                const bool preserved = std::exchange(allocated, true);
                pixels.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
                return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
            }
            void present(const render::Region& damage) override { presented.push_back(damage.area()); }

            std::vector<std::uint32_t> pixels;
            std::vector<long long> presented;
            bool allocated = false;
        } target;

        FrameFixture f;
        f.run(scene);
        render::RasterCompositor compositor(target);
        compositor.composite(f.host.frame());
        compositor.composite(f.host.frame());
        f.run("globalThis.b.style = { width: 20, height: 20, backgroundColor: 'orange', marginLeft: 4 };");
        compositor.composite(f.host.frame());
        REQUIRE(target.presented.size() == 2);
        CHECK(target.presented[0] == 120 * 90);
        CHECK(target.presented[1] < 120 * 90 / 10);
    }
}
