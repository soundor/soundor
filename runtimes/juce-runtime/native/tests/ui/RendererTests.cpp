#include "../web/WebTestSupport.h"

#include <soundor/platform/Resources.h>

#include <cstdint>
#include <string>
#include <vector>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports = "import { root, createView, createText, createImage, createScrollView } "
                                    "from 'soundor:ui';\n";

    struct Pixel
    {
        int r = 0;
        int g = 0;
        int b = 0;
        int a = 0;
    };

    RuntimeHost::Options withImages()
    {
        RuntimeHost::Options options;
        options.resources = std::make_shared<platform::DirectoryResources>(SOUNDOR_TEST_FIXTURES "/images");
        return options;
    }

    // A view of `width`×`height` logical pixels, rendered at `scale`.
    struct RenderFixture : WebFixture
    {
        explicit RenderFixture(float width = 100, float height = 100, float scale = 1) : WebFixture(withImages())
        {
            host.surface().setSize({ width, height });
            host.surface().setScale(scale);
            pixelWidth = static_cast<int>(width * scale);
            pixelHeight = static_cast<int>(height * scale);
        }

        void render()
        {
            pixels.assign(static_cast<std::size_t>(pixelWidth) * static_cast<std::size_t>(pixelHeight), 0);
            host.render({ pixels.data(), pixelWidth, pixelHeight, static_cast<std::size_t>(pixelWidth) * 4 });
        }

        // Unpremultiplied, at device pixel (x, y).
        [[nodiscard]] Pixel at(int x, int y) const
        {
            const std::uint32_t value = pixels[(static_cast<std::size_t>(y) * static_cast<std::size_t>(pixelWidth))
                                               + static_cast<std::size_t>(x)];
            const int a = static_cast<int>(value >> 24);
            const auto channel = [&](int shift)
            {
                const int premultiplied = static_cast<int>((value >> shift) & 0xFF);
                return a == 0 ? 0 : (premultiplied * 255 + a / 2) / a;
            };
            return { channel(16), channel(8), channel(0), a };
        }

        [[nodiscard]] int countWhere(int x0, int y0, int x1, int y1, bool (*predicate)(const Pixel&)) const
        {
            int count = 0;
            for (int y = y0; y < y1; ++y)
                for (int x = x0; x < x1; ++x)
                    count += predicate(at(x, y)) ? 1 : 0;
            return count;
        }

        std::vector<std::uint32_t> pixels;
        int pixelWidth = 0;
        int pixelHeight = 0;
    };

    bool isRed(const Pixel& p)
    {
        return p.r > 200 && p.g < 60 && p.b < 60 && p.a > 200;
    }
    bool isBlue(const Pixel& p)
    {
        return p.b > 200 && p.r < 60 && p.g < 60 && p.a > 200;
    }
    bool isDark(const Pixel& p)
    {
        return p.a > 100 && p.r < 120 && p.g < 120 && p.b < 120;
    }
    bool isClear(const Pixel& p)
    {
        return p.a == 0;
    }
} // namespace

TEST_SUITE("ui::Renderer")
{
    TEST_CASE("draws backgrounds and borders where layout put them")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            root.appendChild(createView({ position: 'absolute', left: 10, top: 20, width: 50, height: 30,
                                          backgroundColor: '#00f', borderWidth: 4, borderColor: 'red' }));
        )");
        f.render();
        CHECK(isClear(f.at(5, 5)));
        CHECK(isRed(f.at(11, 21)));  // border
        CHECK(isRed(f.at(58, 48)));  // border, bottom right
        CHECK(isBlue(f.at(35, 35))); // inside
        CHECK(isClear(f.at(61, 35)));
    }

    TEST_CASE("rounds corners, applies opacity, and clips children to overflow")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            root.appendChild(createView({ position: 'absolute', left: 0, top: 0, width: 40, height: 40,
                                          backgroundColor: 'rgb(255 0 0)', borderRadius: 20 }));
            root.appendChild(createView({ position: 'absolute', left: 50, top: 0, width: 40, height: 40,
                                          backgroundColor: 'red', opacity: 0.5 }));
            const clip = createView({ position: 'absolute', left: 0, top: 50, width: 20, height: 20,
                                      overflow: 'hidden' });
            clip.appendChild(createView({ width: 60, height: 20, backgroundColor: 'blue' }));
            root.appendChild(clip);
            const free = createView({ position: 'absolute', left: 0, top: 75, width: 20, height: 20 });
            free.appendChild(createView({ width: 60, height: 20, backgroundColor: 'blue' }));
            root.appendChild(free);
        )");
        f.render();
        CHECK(isClear(f.at(1, 1))); // outside the rounded corner
        CHECK(isRed(f.at(20, 20)));
        CHECK(f.at(70, 20).a == doctest::Approx(128).epsilon(0.02));
        CHECK(isBlue(f.at(10, 60)));
        CHECK(isClear(f.at(40, 60))); // clipped
        CHECK(isBlue(f.at(40, 85)));  // overflow visible
    }

    TEST_CASE("renders at the device scale")
    {
        RenderFixture f(50, 50, 2);
        f.run(std::string(imports) + R"(
            root.appendChild(createView({ position: 'absolute', left: 10, top: 10, width: 10, height: 10,
                                          backgroundColor: 'red' }));
        )");
        f.render();
        CHECK(isClear(f.at(19, 19)));
        CHECK(isRed(f.at(21, 21)));
        CHECK(isRed(f.at(38, 38)));
        CHECK(isClear(f.at(41, 41)));
    }

    TEST_CASE("draws text in its color, measured with real fonts")
    {
        RenderFixture f(200, 60);
        f.run(std::string(imports) + R"(
            const label = createText('Hello', { fontSize: 24, color: '#000' });
            root.style = { padding: 10, alignItems: 'flex-start' };
            root.appendChild(label);
            const narrow = createText('iiii', { fontSize: 24 });
            const wide = createText('WWWW', { fontSize: 24 });
            root.appendChild(narrow);
            root.appendChild(wide);
            globalThis.result = JSON.stringify([label.layout.width > 30, narrow.layout.width < wide.layout.width,
                                                label.layout.height]);
        )");
        CHECK(f.eval("result").asString() == "[true,true,29]");
        f.render();
        CHECK(f.countWhere(10, 10, 80, 39, isDark) > 40);
        CHECK(f.countWhere(120, 10, 200, 39, isDark) == 0);
    }

    TEST_CASE("draws bundled images, sized by their pixels unless styled")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            const natural = createImage('halves.png');
            const stretched = createImage('halves.png', { width: 40, height: 20, resizeMode: 'stretch' });
            const missing = createImage('nope.png');
            root.style = { alignItems: 'flex-start' };
            for (const node of [natural, stretched, missing]) root.appendChild(node);
            globalThis.result = JSON.stringify([natural.layout, stretched.layout.y, missing.layout.height]);
        )");
        CHECK(f.eval("result").asString() == R"([{"x":0,"y":0,"width":4,"height":2},2,0])");
        f.render();
        CHECK(isRed(f.at(5, 10)));
        CHECK(isBlue(f.at(35, 10)));
    }

    TEST_CASE("contain and cover keep the image's aspect ratio")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            root.appendChild(createImage('halves.png', { position: 'absolute', left: 0, top: 0, width: 40,
                                                          height: 40, resizeMode: 'contain' }));
            root.appendChild(createImage('halves.png', { position: 'absolute', left: 50, top: 0, width: 40,
                                                          height: 40, resizeMode: 'cover' }));
        )");
        f.render();
        CHECK(isClear(f.at(20, 5))); // contain: 40×20, centered vertically
        CHECK(isRed(f.at(5, 20)));
        CHECK(isRed(f.at(55, 5))); // cover: 80×40, centered: the middle shows
        CHECK(isBlue(f.at(85, 35)));
    }

    TEST_CASE("zIndex draws siblings in stacking order, as they are hit")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            const box = (color, zIndex) =>
              createView({ position: 'absolute', left: 0, top: 0, width: 50, height: 50, backgroundColor: color, zIndex });
            globalThis.red = box('red', 1);
            globalThis.blue = box('blue', 0);
            root.appendChild(red);
            root.appendChild(blue);
        )");
        f.render();
        CHECK(isRed(f.at(25, 25)));
        CHECK(f.host.surface().hitTest({ 25, 25 }) != f.host.surface().root().id());
        f.run(std::string(imports) + "blue.style = { ...blue.style, zIndex: 1 };");
        f.render();
        CHECK(isBlue(f.at(25, 25)));
        // A child's zIndex stays inside its parent's place among siblings.
        f.run(std::string(imports) + R"(
            red.appendChild(createView({ width: 20, height: 20, backgroundColor: 'red', zIndex: 99 }));
            blue.style = { ...blue.style, zIndex: 2 };
        )");
        f.render();
        CHECK(isBlue(f.at(10, 10)));
    }

    TEST_CASE("the overlay draws over all of the content, and clips inside itself")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            import { overlayRoot } from 'soundor:ui';
            const content = createView({ position: 'absolute', left: 0, top: 0, width: 100, height: 100,
                                         backgroundColor: 'red', zIndex: 2147483647 });
            root.appendChild(content);
            const clip = createView({ position: 'absolute', left: 0, top: 0, width: 50, height: 50, overflow: 'hidden' });
            clip.appendChild(createView({ width: 100, height: 100, backgroundColor: 'blue' }));
            overlayRoot.appendChild(clip);
        )");
        f.render();
        CHECK(isBlue(f.at(25, 25)));
        CHECK(isRed(f.at(75, 75)));
    }

    TEST_CASE("scroll views clip and offset their content")
    {
        RenderFixture f;
        f.run(std::string(imports) + R"(
            const scroller = createScrollView({ position: 'absolute', left: 0, top: 0, width: 50, height: 50 });
            scroller.appendChild(createView({ height: 50, backgroundColor: 'red' }));
            scroller.appendChild(createView({ height: 50, backgroundColor: 'blue' }));
            root.appendChild(scroller);
            globalThis.scroller = scroller;
        )");
        f.render();
        CHECK(isRed(f.at(10, 40)));
        CHECK(isClear(f.at(10, 60)));
        f.run(std::string(imports) + "scroller.scrollTop = 40; globalThis.result = scroller.scrollTop;");
        f.render();
        CHECK(isBlue(f.at(10, 20)));
        CHECK(isRed(f.at(10, 5)));
        // Clamped to the content.
        CHECK(f.run(std::string(imports)
                    + "scroller.scrollTop = 1e6; globalThis.result = [scroller.scrollTop, "
                      "scroller.scrollHeight].join();")
                  .asString()
              == "50,100");
    }

    TEST_CASE("an input given its value before layout still shows it")
    {
        RenderFixture f(200, 40);
        f.run(R"(
            import { root, createTextInput } from 'soundor:ui';
            const input = createTextInput({ value: 'Preset one', style: { width: 180, fontSize: 16 } });
            root.appendChild(input);
        )");
        f.render();
        CHECK(f.countWhere(0, 0, 100, 30, isDark) > 30);
    }

    TEST_CASE("reports when it needs drawing again")
    {
        RenderFixture f;
        CHECK(f.host.needsRender());
        CHECK_FALSE(f.host.needsRender());
        f.run(std::string(imports)
              + "root.appendChild(createView({ width: 10, height: 10, backgroundColor: 'red' }));");
        CHECK(f.host.needsRender());
        CHECK_FALSE(f.host.needsRender());
    }
}
