#include "render/SvgDocument.h"

#include <doctest/doctest.h>
#include <include/core/SkCanvas.h>
#include <include/core/SkSurface.h>

#include <string>
#include <string_view>

using namespace soundor;

namespace
{
    sk_sp<SkSVGDOM> parse(std::string_view xml)
    {
        return render::parseSvgDocument({ reinterpret_cast<const std::uint8_t*>(xml.data()), xml.size() });
    }
} // namespace

TEST_SUITE("SVG document")
{
    TEST_CASE("renders a gradient, transformed path and clipping into an offscreen canvas")
    {
        auto svg = parse(R"svg(<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40">
          <defs>
            <linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
            <clipPath id="clip"><rect width="40" height="40"/></clipPath>
          </defs>
          <rect width="80" height="40" fill="url(#paint)"/>
          <g clip-path="url(#clip)"><path transform="translate(20 10)" d="M0 0h40v20H0z" fill="lime"/></g>
        </svg>)svg");
        REQUIRE(svg != nullptr);
        CHECK(svg->containerSize().width() == 80);
        CHECK(svg->containerSize().height() == 40);
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(80, 40));
        REQUIRE(surface != nullptr);
        surface->getCanvas()->clear(SK_ColorTRANSPARENT);
        svg->render(surface->getCanvas());
        SkPixmap pixels;
        REQUIRE(surface->peekPixels(&pixels));
        CHECK(SkColorGetR(pixels.getColor(2, 20)) > 240);
        CHECK(SkColorGetB(pixels.getColor(77, 20)) > 240);
        CHECK(pixels.getColor(30, 20) == SK_ColorGREEN);
        CHECK(pixels.getColor(50, 20) != SK_ColorGREEN);
    }

    TEST_CASE("malformed XML and non-SVG roots fail safely")
    {
        for (const auto* xml : { "", "<svg>", "<svg><g></svg>", "<html/>", "<svg width='broken'/>", "garbage" })
        {
            const auto svg = parse(xml);
            // Invalid attribute values are Skia's responsibility; they may
            // leave the default value in place. Rendering must remain safe.
            if (svg != nullptr)
            {
                auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(10, 10));
                svg->render(surface->getCanvas());
            }
        }
        CHECK(parse("<svg>") == nullptr);
        CHECK(parse("<html/>") == nullptr);
    }

    TEST_CASE("rejects DTDs, entities, recursion and document expansion")
    {
        CHECK(parse(R"svg(<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg/>)svg") == nullptr);
        CHECK(parse(R"svg(<!DOCTYPE svg [<!ENTITY x "expanded">]><svg>&x;</svg>)svg") == nullptr);
        CHECK(parse(R"svg(<svg><use id="a" xlink:href="#a"/></svg>)svg") == nullptr);
        CHECK(parse(R"svg(<svg><defs><linearGradient id="a" xlink:href=" #b"/>
            <linearGradient id="b" xlink:href="#a"/></defs></svg>)svg")
              == nullptr);
        CHECK(parse(R"svg(<svg><g id="a" fill="url ( #a)"/></svg>)svg") == nullptr);
        std::string deep = "<svg>";
        for (int i = 0; i < 65; ++i)
            deep += "<g>";
        for (int i = 0; i < 65; ++i)
            deep += "</g>";
        CHECK(parse(deep + "</svg>") == nullptr);
        std::string wide = "<svg>";
        for (int i = 0; i < 4100; ++i)
            wide += "<path/>";
        CHECK(parse(wide + "</svg>") == nullptr);
        std::string expansion = "<svg><defs><g id='g0'><rect width='1' height='1'/></g>";
        for (int i = 1; i < 18; ++i)
            expansion += "<g id='g" + std::to_string(i) + "'><use xlink:href='#g" + std::to_string(i - 1)
                         + "'/><use xlink:href='#g" + std::to_string(i - 1) + "'/></g>";
        CHECK(parse(expansion + "</defs><use xlink:href='#g17'/></svg>") == nullptr);
        // Cached validation results must still enforce the depth of a chain
        // referencing previously visited definitions.
        std::string chain = "<svg><defs><linearGradient id='g0'/>";
        for (int i = 1; i < 70; ++i)
            chain += "<linearGradient id='g" + std::to_string(i) + "' xlink:href='#g" + std::to_string(i - 1) + "'/>";
        CHECK(parse(chain + "</defs></svg>") == nullptr);
    }

    TEST_CASE("bounds geometry, document bytes and intermediate filter surfaces")
    {
        CHECK(parse(std::string(1024 * 1024 + 1, ' ')) == nullptr);
        CHECK(parse("<svg width='1e38'/>") == nullptr);
        CHECK(parse("<svg><path d='M0 0L1e999 0'/></svg>") == nullptr);
        CHECK(parse("<svg><filter id='blur'/></svg>") == nullptr);
        std::string path = "<svg><path d='M0 0";
        for (int i = 0; i < 33000; ++i)
            path += "L1 1";
        CHECK(parse(path + "'/></svg>") == nullptr);
    }

    TEST_CASE("external resources are inert and cannot replace the caller's resource provider")
    {
        auto svg = parse(R"svg(<svg width="8" height="8">
            <image xlink:href="file:///etc/passwd" width="8" height="8"/>
            <image xlink:href="https://example.invalid/image.png" width="8" height="8"/>
            <image xlink:href="data:image/svg+xml;base64,PHN2Zy8+" width="8" height="8"/>
            <script>alert('no JavaScript runtime')</script>
        </svg>)svg");
        REQUIRE(svg != nullptr);
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(8, 8));
        surface->getCanvas()->clear(SK_ColorTRANSPARENT);
        svg->render(surface->getCanvas());
        SkPixmap pixels;
        REQUIRE(surface->peekPixels(&pixels));
        for (int y = 0; y < 8; ++y)
            for (int x = 0; x < 8; ++x)
                CHECK(pixels.getColor(x, y) == SK_ColorTRANSPARENT);
    }
}
