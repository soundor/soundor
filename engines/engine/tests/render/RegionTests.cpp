#include <soundor/render/Frame.h>
#include <soundor/render/Region.h>

#include <doctest/doctest.h>

using namespace soundor::render;

TEST_SUITE("render::Region")
{
    TEST_CASE("merges overlapping rectangles and keeps apart ones")
    {
        Region region;
        region.add({ 0, 0, 10, 10 });
        region.add({ 5, 5, 10, 10 });
        region.add({ 50, 50, 4, 4 });
        REQUIRE(region.rects().size() == 2);
        CHECK(region.rects()[0] == IntRect { 0, 0, 15, 15 });
        CHECK(region.rects()[1] == IntRect { 50, 50, 4, 4 });
        CHECK(region.bounds() == IntRect { 0, 0, 54, 54 });
        CHECK(region.area() == 15 * 15 + 16);
    }

    TEST_CASE("ignores empty and contained rectangles")
    {
        Region region;
        region.add({ 0, 0, 0, 10 });
        CHECK(region.empty());
        region.add({ 0, 0, 10, 10 });
        region.add({ 2, 2, 3, 3 });
        CHECK(region.rects().size() == 1);
        CHECK(region.area() == 100);
    }

    TEST_CASE("becomes its bounds past a handful of rectangles")
    {
        Region region;
        for (int i = 0; i <= static_cast<int>(Region::maxRects); ++i)
            region.add({ i * 10, 0, 2, 2 });
        REQUIRE(region.rects().size() == 1);
        CHECK(region.rects()[0] == IntRect { 0, 0, static_cast<int>(Region::maxRects) * 10 + 2, 2 });
    }

    TEST_CASE("clips to a rectangle")
    {
        Region region;
        region.add({ -5, -5, 10, 10 });
        region.add({ 90, 90, 20, 20 });
        region.clip({ 0, 0, 100, 100 });
        REQUIRE(region.rects().size() == 2);
        CHECK(region.rects()[0] == IntRect { 0, 0, 5, 5 });
        CHECK(region.rects()[1] == IntRect { 90, 90, 10, 10 });
        CHECK(region.intersects({ 95, 95, 1, 1 }));
        CHECK_FALSE(region.intersects({ 50, 50, 10, 10 }));
    }
}

TEST_SUITE("render::Transform")
{
    TEST_CASE("maps bounds out to whole pixels")
    {
        CHECK(Transform {}.mapBounds({ 1, 2, 3, 4 }) == IntRect { 1, 2, 3, 4 });
        CHECK(Transform::translate(10, -2).mapBounds({ 1, 2, 3, 4 }) == IntRect { 11, 0, 3, 4 });
        CHECK(Transform { 2, 0, 0, 2, 0.5f, 0 }.mapBounds({ 0, 0, 3, 4 }) == IntRect { 0, 0, 7, 8 });
        // A quarter turn: (x, y) → (-y, x).
        CHECK(Transform { 0, 1, -1, 0, 0, 0 }.mapBounds({ 0, 0, 3, 4 }) == IntRect { -4, 0, 4, 3 });
        CHECK(Transform::translate(3, 4).isIntegerTranslate());
        CHECK_FALSE(Transform::translate(0.5f, 0).isIntegerTranslate());
        CHECK_FALSE(Transform { 2, 0, 0, 2, 0, 0 }.isIntegerTranslate());
    }

    TEST_CASE("layer ids are unique")
    {
        CHECK(newLayerId() != newLayerId());
    }
}

TEST_SUITE("render::RasterSurface")
{
    TEST_CASE("is transparent after a resize, and says when it resized")
    {
        RasterSurface surface;
        CHECK(surface.resize(4, 3));
        CHECK_FALSE(surface.resize(4, 3));
        CHECK(surface.bitmap().rowBytes == 16);
        CHECK(surface.bounds() == IntRect { 0, 0, 4, 3 });
        static_cast<std::uint32_t*>(surface.bitmap().pixels)[5] = 0xFFFFFFFF;
        CHECK(surface.resize(2, 2));
        for (int i = 0; i < 4; ++i)
            CHECK(surface.pixels()[i] == 0);
        CHECK(surface.resize(0, 0));
        CHECK(surface.bitmap().empty());
    }
}
