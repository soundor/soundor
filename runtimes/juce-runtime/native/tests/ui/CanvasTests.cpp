#include "../web/WebTestSupport.h"

#include <soundor/platform/Resources.h>

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

    // A canvas `c` with its 2D context `ctx`, and px(x, y): the RGBA of a pixel.
    struct CanvasFixture : WebFixture
    {
        CanvasFixture() : WebFixture(withImages())
        {
            host.surface().setSize({ 200, 200 });
            run(R"(
                import { root, createCanvas } from 'soundor:ui';
                const g = globalThis;
                g.c = createCanvas({ width: 100, height: 50 });
                root.appendChild(g.c);
                g.c.width = 100;
                g.c.height = 50;
                g.ctx = g.c.getContext('2d');
                g.px = (x, y) => Array.from(g.ctx.getImageData(x, y, 1, 1).data).join(',');
            )");
        }

        std::string pixel(int x, int y)
        {
            return eval("px(" + std::to_string(x) + ", " + std::to_string(y) + ")").asString();
        }

        std::string string(const std::string& expression) { return eval(expression).asString(); }
        double number(const std::string& expression) { return eval(expression).asNumber(); }
        bool boolean(const std::string& expression) { return eval(expression).asBoolean(); }
    };
} // namespace

TEST_SUITE("soundor:ui canvas")
{
    TEST_CASE("a canvas is 300 by 150 until sized, and lays out at its size")
    {
        WebFixture f;
        f.host.surface().setSize({ 400, 400 });
        f.run(R"(
            import { root, createCanvas, createView } from 'soundor:ui';
            // Not stretched across the column, to show its own size.
            const box = createView({ alignItems: 'flex-start' });
            root.appendChild(box);
            const c = createCanvas();
            box.appendChild(c);
            const sized = createCanvas({ width: 50 });
            box.appendChild(sized);
            globalThis.result = [c.type, c.width, c.height, c.layout.width, c.layout.height,
                                 sized.layout.width, sized.layout.height].join(',');
        )");
        CHECK(f.eval("result").asString() == "canvas,300,150,300,150,50,25");
        CHECK(
            f.run(
                 "import { root } from 'soundor:ui'; const c = root.firstChild.firstChild; c.width = 20; c.height = 10;"
                 "globalThis.result = [c.layout.width, c.layout.height].join(',');")
                .asString()
            == "20,10");
    }

    TEST_CASE("getContext gives one 2d context, and nothing else once it has one")
    {
        CanvasFixture f;
        CHECK(f.boolean("c.getContext('2d') === ctx"));
        CHECK(f.boolean("ctx instanceof CanvasRenderingContext2D"));
        CHECK(f.boolean("ctx.canvas === c"));
        CHECK(f.boolean("c.getContext('webgl2') === null"));
        CHECK(f.boolean("c.getContext('bitmaprenderer') === null"));
        CHECK(f.error("import { createView } from 'soundor:ui'; createView().getContext('2d');")
                  .find("belongs to canvas nodes")
              != std::string::npos);
    }

    TEST_CASE("fills rectangles under the transform, with alpha and state")
    {
        CanvasFixture f;
        f.run(R"(
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 10, 10);
            ctx.save();
            ctx.translate(20, 0);
            ctx.scale(2, 1);
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 0, 5, 10);
            ctx.restore();
            ctx.globalAlpha = 0.5;
            ctx.fillRect(40, 0, 10, 10);
        )");
        CHECK(f.pixel(5, 5) == "255,0,0,255");
        CHECK(f.pixel(21, 5) == "0,0,255,255");
        CHECK(f.pixel(29, 5) == "0,0,255,255");
        CHECK(f.pixel(31, 5) == "0,0,0,0");
        // Red at half alpha, after restore() brought red back.
        CHECK(f.pixel(45, 5) == "255,0,0,128");
        CHECK(f.string("ctx.fillStyle") == "#ff0000");
        f.run("ctx.clearRect(0, 0, 5, 5);");
        CHECK(f.pixel(2, 2) == "0,0,0,0");
        CHECK(f.pixel(7, 7) == "255,0,0,255");
    }

    TEST_CASE("draws paths: arcs, strokes, clips and fill rules")
    {
        CanvasFixture f;
        f.run(R"(
            ctx.beginPath();
            ctx.arc(25, 25, 20, 0, Math.PI * 2);
            ctx.fillStyle = 'lime';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(60, 10);
            ctx.lineTo(90, 10);
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'blue';
            ctx.stroke();
        )");
        CHECK(f.pixel(25, 25) == "0,255,0,255");
        CHECK(f.pixel(2, 2) == "0,0,0,0"); // outside the circle
        CHECK(f.pixel(75, 10) == "0,0,255,255");
        CHECK(f.pixel(75, 14) == "0,0,0,0");
        CHECK(f.boolean("(ctx.beginPath(), ctx.arc(25, 25, 20, 0, 7), ctx.isPointInPath(25, 25))"));
        CHECK_FALSE(f.boolean("ctx.isPointInPath(1, 1)"));

        // A rectangle with a hole, under the even-odd rule; then a clip.
        f.run(R"(
            ctx.clearRect(0, 0, 100, 50);
            ctx.beginPath();
            ctx.rect(0, 0, 40, 40);
            ctx.rect(10, 10, 20, 20);
            ctx.fillStyle = 'red';
            ctx.fill('evenodd');
            ctx.save();
            ctx.beginPath();
            ctx.rect(50, 0, 10, 10);
            ctx.clip();
            ctx.fillRect(40, 0, 60, 50);
            ctx.restore();
        )");
        CHECK(f.pixel(5, 5) == "255,0,0,255");
        CHECK(f.pixel(20, 20) == "0,0,0,0");
        CHECK(f.pixel(55, 5) == "255,0,0,255");
        CHECK(f.pixel(65, 5) == "0,0,0,0");
        CHECK(f.error("ctx.arc(0, 0, -1, 0, 1);").find("IndexSizeError") != std::string::npos);
    }

    TEST_CASE("styles: colors as the Web prints them, gradients, patterns")
    {
        CanvasFixture f;
        f.run("ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';");
        CHECK(f.string("ctx.fillStyle") == "rgba(0, 0, 255, 0.5)");
        f.run("ctx.fillStyle = 'not a color';");
        CHECK(f.string("ctx.fillStyle") == "rgba(0, 0, 255, 0.5)");

        f.run(R"(
            const gradient = ctx.createLinearGradient(0, 0, 100, 0);
            gradient.addColorStop(0, 'black');
            gradient.addColorStop(1, 'white');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 100, 10);
            globalThis.same = ctx.fillStyle === gradient;
        )");
        CHECK(f.boolean("same"));
        const std::string middle = f.pixel(50, 5);
        const int red = std::stoi(middle.substr(0, middle.find(',')));
        CHECK(red > 110);
        CHECK(red < 145);
        CHECK(f.error("ctx.createLinearGradient(0, 0, 1, 1).addColorStop(2, 'red');").find("IndexSizeError")
              != std::string::npos);

        f.run(R"(
            import { createCanvas } from 'soundor:ui';
            const tile = createCanvas();
            tile.width = 2;
            tile.height = 2;
            const t = tile.getContext('2d');
            t.fillStyle = 'red';
            t.fillRect(0, 0, 1, 2);
            t.fillStyle = 'blue';
            t.fillRect(1, 0, 1, 2);
            ctx.fillStyle = ctx.createPattern(tile, 'repeat');
            ctx.fillRect(0, 20, 10, 10);
        )");
        CHECK(f.pixel(4, 25) == "255,0,0,255");
        CHECK(f.pixel(5, 25) == "0,0,255,255");
    }

    TEST_CASE("compositing operations, including those that reach past the shape")
    {
        CanvasFixture f;
        f.run(R"(
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 40, 40);
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillRect(0, 0, 10, 10);
            ctx.globalCompositeOperation = 'copy';
            ctx.fillStyle = 'blue';
            ctx.fillRect(50, 0, 10, 10);
            ctx.globalCompositeOperation = 'nonsense';
        )");
        CHECK(f.string("ctx.globalCompositeOperation") == "copy");
        // 'copy' replaces everything, outside the rectangle too.
        CHECK(f.pixel(20, 20) == "0,0,0,0");
        CHECK(f.pixel(55, 5) == "0,0,255,255");
    }

    TEST_CASE("text: fonts, alignment, metrics")
    {
        CanvasFixture f;
        f.run("ctx.font = 'bold 20px sans-serif';");
        CHECK(f.string("ctx.font") == "bold 20px sans-serif");
        f.run("ctx.font = 'not a font';");
        CHECK(f.string("ctx.font") == "bold 20px sans-serif");
        const double wide = f.number("ctx.measureText('Soundor').width");
        f.run("ctx.font = '10px sans-serif';");
        const double narrow = f.number("ctx.measureText('Soundor').width");
        CHECK(narrow > 0);
        CHECK(wide > narrow * 1.5);
        CHECK(f.number("ctx.measureText('x').fontBoundingBoxAscent") > 0);

        f.run(R"(
            ctx.font = '30px sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillText('M', 0, 0);
            ctx.textAlign = 'right';
            ctx.fillText('M', 100, 0);
            globalThis.dark = (x0, x1) => {
                const data = ctx.getImageData(x0, 0, x1 - x0, 50).data;
                let count = 0;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 128) count++;
                return count;
            };
        )");
        CHECK(f.number("dark(0, 30)") > 40);
        CHECK(f.number("dark(70, 100)") > 40);
        CHECK(f.number("dark(40, 60)") == 0);
    }

    TEST_CASE("ImageData: read, write, round trip")
    {
        CanvasFixture f;
        f.run(R"(
            const data = ctx.createImageData(2, 1);
            data.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
            ctx.putImageData(data, 10, 10);
            globalThis.image = ctx.getImageData(9, 10, 4, 1);
        )");
        CHECK(f.number("image.width") == 4);
        CHECK(f.boolean("image instanceof ImageData"));
        CHECK(f.string("Array.from(image.data).join(',')") == "0,0,0,0,255,0,0,255,0,255,0,255,0,0,0,0");
        // Outside the canvas reads as transparent.
        CHECK(f.string("Array.from(ctx.getImageData(-1, -1, 1, 1).data).join(',')") == "0,0,0,0");
        CHECK(f.number("new ImageData(3, 2).data.length") == 24);
        CHECK(f.error("ctx.getImageData(0, 0, 0, 1);").find("IndexSizeError") != std::string::npos);
    }

    TEST_CASE("drawImage: another canvas, and bundled images")
    {
        CanvasFixture f;
        f.run(R"(
            import { createCanvas, createImage } from 'soundor:ui';
            const other = createCanvas();
            other.width = 4;
            other.height = 4;
            const o = other.getContext('2d');
            o.fillStyle = 'blue';
            o.fillRect(0, 0, 4, 4);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(other, 10, 10, 8, 8);
            ctx.drawImage(createImage('halves.png'), 50, 0);
        )");
        CHECK(f.pixel(10, 10) == "0,0,255,255");
        CHECK(f.pixel(17, 17) == "0,0,255,255");
        CHECK(f.pixel(18, 18) == "0,0,0,0");
        CHECK(f.pixel(51, 1) != "0,0,0,0");
    }

    TEST_CASE("resizing clears the canvas and resets its context")
    {
        CanvasFixture f;
        f.run("ctx.fillStyle = ctx.createLinearGradient(0, 0, 1, 0); ctx.fillStyle = 'red';"
              "ctx.translate(10, 0); ctx.fillRect(0, 0, 5, 5); c.width = 100;");
        CHECK(f.pixel(12, 2) == "0,0,0,0");
        CHECK(f.string("ctx.fillStyle") == "#000000");
        CHECK(f.string("JSON.stringify(ctx.getTransform())").find("\"e\":0") != std::string::npos);
    }

    TEST_CASE("what Soundor does not draw fails clearly")
    {
        CanvasFixture f;
        CHECK(f.error("ctx.shadowBlur = 4;").find("not supported") != std::string::npos);
        CHECK(f.error("ctx.filter = 'blur(2px)';").find("not supported") != std::string::npos);
        CHECK(f.error("c.width = 100; import { createCanvas } from 'soundor:ui';"
                      "createCanvas().getContext('2d', { alpha: false });")
                  .find("not supported")
              != std::string::npos);
        // Defaults are fine.
        f.run("ctx.shadowBlur = 0; ctx.filter = 'none';");
    }

    TEST_CASE("a canvas is drawn in its box, and drawing redraws only it")
    {
        CanvasFixture f;
        (void)f.host.frame();
        f.run("ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 100, 50);");
        CHECK(f.host.needsRender());
        const render::Frame& frame = f.host.frame();
        CHECK(frame.damage.bounds().width <= 104);
        CHECK(frame.damage.bounds().height <= 54);
        const auto& pixels = std::get<render::RasterContent>(frame.layers.front().content).surface->pixels();
        CHECK(pixels[static_cast<std::size_t>(25) * 200 + 50] == 0xFFFF0000);
        // Nothing drawn since: nothing to render.
        CHECK_FALSE(f.host.needsRender());
    }
}
