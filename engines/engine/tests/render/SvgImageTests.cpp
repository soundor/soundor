#include "render/SkiaImages.h"

#include <doctest/doctest.h>
#include <include/core/SkPaint.h>
#include <include/core/SkSurface.h>

#include <array>
#include <cmath>
#include <string>
#include <string_view>

using namespace soundor;

namespace
{
    std::span<const std::uint8_t> bytes(std::string_view value)
    {
        return { reinterpret_cast<const std::uint8_t*>(value.data()), value.size() };
    }
} // namespace

TEST_SUITE("SVG images")
{
    TEST_CASE("intrinsic sizes use explicit sides and a ratio-contained default object size")
    {
        struct Case
        {
            const char* attributes {};
            ui::Size expected {};
        };
        constexpr Case cases[] = {
            { "", { 300, 150 } },
            { "viewBox='0 0 20 10'", { 300, 150 } },
            { "viewBox='0 0 20 20'", { 150, 150 } },
            { "viewBox='5 7 60 10'", { 300, 50 } },
            { "width='80'", { 80, 150 } },
            { "height='40'", { 300, 40 } },
            { "width='80' viewBox='0 0 20 10'", { 80, 40 } },
            { "height='40' viewBox='0 0 20 10'", { 80, 40 } },
            { "width='80' height='30' viewBox='0 0 20 10'", { 80, 30 } },
            { "width='100%' height='100%' viewBox='0 0 20 20'", { 150, 150 } },
            { "width='12.5px' height='25px'", { 12.5f, 25 } },
            { "width='broken'", { 300, 150 } },
            { "width='broken' height='40' viewBox='0 0 20 10'", { 80, 40 } },
        };
        for (const auto& item : cases)
        {
            const std::string xml = "<svg " + std::string(item.attributes) + "/>";
            render::SkiaImages images([&](std::string_view) { return bytes(xml); });
            const auto size = images.imageSize("size.svg");
            REQUIRE_MESSAGE(size.has_value(), item.attributes);
            CHECK(size.value_or(ui::Size { -1, -1 }).width == doctest::Approx(item.expected.width));
            CHECK(size.value_or(ui::Size { -1, -1 }).height == doctest::Approx(item.expected.height));
        }
    }

    TEST_CASE("nonzero viewBox origins map into the image viewport")
    {
        constexpr std::string_view xml = "<svg width='80' height='40' viewBox='10 20 20 10'>"
                                         "<rect x='10' y='20' width='10' height='10' fill='red'/>"
                                         "<rect x='20' y='20' width='10' height='10' fill='blue'/></svg>";
        render::SkiaImages images([&](std::string_view) { return bytes(xml); });
        const auto* image = images.load("origin.svg");
        REQUIRE(image != nullptr);
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(80, 40));
        images.draw(*surface->getCanvas(), *image, SkRect::MakeWH(80, 40));
        SkPixmap pixels;
        REQUIRE(surface->peekPixels(&pixels));
        CHECK(pixels.getColor(10, 20) == SK_ColorRED);
        CHECK(pixels.getColor(70, 20) == SK_ColorBLUE);
    }

    TEST_CASE("Image viewports and Canvas intrinsic mapping share a document without stale sizing")
    {
        constexpr std::string_view xml = "<svg width='80' height='40' viewBox='0 0 20 20'>"
                                         "<circle cx='10' cy='10' r='8' fill='red'/></svg>";
        render::SkiaImages images([&](std::string_view) { return bytes(xml); });
        const auto* image = images.load("viewport.svg");
        REQUIRE(image != nullptr);
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(100, 100));
        for (const auto viewport : { render::SkiaImages::SvgViewport::Image, render::SkiaImages::SvgViewport::Intrinsic,
                                     render::SkiaImages::SvgViewport::Image })
        {
            surface->getCanvas()->clear(SK_ColorTRANSPARENT);
            images.draw(*surface->getCanvas(), *image, SkRect::MakeWH(100, 100), viewport);
            SkPixmap pixels;
            REQUIRE(surface->peekPixels(&pixels));
            CHECK(pixels.getColor(50, 15) == SK_ColorRED);
            CHECK((pixels.getColor(15, 50) == SK_ColorRED) == (viewport == render::SkiaImages::SvgViewport::Image));
        }
        CHECK(images.svgParseAttempts() == 1);
        CHECK(images.imageSize("viewport.svg").value_or(ui::Size {}).width == 80);
    }

    TEST_CASE("documents and failures are cached by asset identity")
    {
        int reads = 0;
        constexpr std::string_view xml = "<svg width='8' height='8'><circle cx='4' cy='4' r='3' fill='red'/></svg>";
        render::SkiaImages images(
            [&](std::string_view id)
            {
                ++reads;
                return bytes(id == "bad.svg" ? "<svg>" : xml);
            });
        const auto* image = images.load("icon.svg");
        REQUIRE(image != nullptr);
        CHECK(image->raster == nullptr);
        CHECK(image->document != nullptr);
        for (int i = 0; i < 500; ++i)
        {
            CHECK(images.load("icon.svg") == image);
            CHECK(images.imageSize("icon.svg").value_or(ui::Size { -1, -1 }).width == 8);
        }
        CHECK(reads == 1);
        CHECK(images.svgParseAttempts() == 1);
        CHECK(images.load("bad.svg") == nullptr);
        CHECK(images.load("bad.svg") == nullptr);
        CHECK(reads == 2);
        CHECK(images.svgParseAttempts() == 2);
    }

    TEST_CASE("resizing after a small draw matches direct geometry at editor and device scales")
    {
        constexpr std::string_view xml = "<svg width='8' height='8' viewBox='0 0 8 8'>"
                                         "<circle cx='4' cy='4' r='3' fill='red'/></svg>";
        render::SkiaImages images([&](std::string_view) { return bytes(xml); });
        const auto* image = images.load("circle.svg");
        REQUIRE(image != nullptr);
        auto small = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(8, 8));
        images.draw(*small->getCanvas(), *image, SkRect::MakeWH(8, 8));
        for (float scale : { 0.5f, 1.0f, 1.5f, 2.0f, 3.0f, 4.0f })
        {
            const int side = static_cast<int>(64 * scale);
            auto actual = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(side, side));
            auto reference = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(side, side));
            actual->getCanvas()->clear(SK_ColorTRANSPARENT);
            reference->getCanvas()->clear(SK_ColorTRANSPARENT);
            actual->getCanvas()->scale(scale, scale);
            images.draw(*actual->getCanvas(), *image, SkRect::MakeWH(64, 64));
            reference->getCanvas()->scale(8 * scale, 8 * scale);
            SkPaint paint;
            paint.setAntiAlias(true);
            paint.setColor(SK_ColorRED);
            reference->getCanvas()->drawCircle(4, 4, 3, paint);
            SkPixmap a, b;
            REQUIRE(actual->peekPixels(&a));
            REQUIRE(reference->peekPixels(&b));
            int largest = 0;
            for (int y = 0; y < side; ++y)
                for (int x = 0; x < side; ++x)
                    largest = std::max(largest, std::abs(static_cast<int>(SkColorGetA(a.getColor(x, y)))
                                                         - static_cast<int>(SkColorGetA(b.getColor(x, y)))));
            CHECK_MESSAGE(largest <= 1, "scale " << scale << ", maximum alpha difference " << largest);
        }
        CHECK(images.svgParseAttempts() == 1);
        CHECK(images.svgDraws() == 7);
    }

    TEST_CASE("damage clipping skips document walks and SVG overflow stays inside the image viewport")
    {
        constexpr std::string_view xml = "<svg width='8' height='8'><rect width='80' height='80' fill='red'/></svg>";
        render::SkiaImages images([&](std::string_view) { return bytes(xml); });
        const auto* image = images.load("overflow.svg");
        REQUIRE(image != nullptr);
        auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(32, 32));
        auto* canvas = surface->getCanvas();
        canvas->clear(SK_ColorTRANSPARENT);
        canvas->save();
        canvas->clipRect(SkRect::MakeXYWH(24, 24, 8, 8));
        for (int i = 0; i < 100; ++i)
            images.draw(*canvas, *image, SkRect::MakeWH(8, 8));
        CHECK(images.svgDraws() == 0);
        canvas->restore();
        images.draw(*canvas, *image, SkRect::MakeWH(8, 8));
        SkPixmap pixels;
        REQUIRE(surface->peekPixels(&pixels));
        CHECK(pixels.getColor(4, 4) == SK_ColorRED);
        CHECK(pixels.getColor(10, 4) == SK_ColorTRANSPARENT);
        CHECK(pixels.getColor(4, 10) == SK_ColorTRANSPARENT);
    }

    TEST_CASE("invalid dimensions and XML have a stable empty result")
    {
        for (const auto* attributes : { "width='0'", "height='-1'", "width='NaN'", "height='Infinity'" })
        {
            const std::string xml = "<svg " + std::string(attributes) + "/>";
            render::SkiaImages images([&](std::string_view) { return bytes(xml); });
            CHECK_FALSE(images.imageSize("invalid.svg").has_value());
        }
    }
}
