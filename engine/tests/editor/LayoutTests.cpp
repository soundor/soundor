#include <soundor/editor/Layout.h>

#include <doctest/doctest.h>

#include <limits>

using namespace soundor;

namespace
{
    constexpr float unbounded = std::numeric_limits<float>::infinity();

    editor::Layout layoutOf(editor::Layout::Resize resize, editor::Layout::Fit fit,
                            ui::Size maximum = { unbounded, unbounded })
    {
        return { .size = { 400, 300 }, .resizable = true, .resize = resize, .fit = fit, .maximum = maximum };
    }

    void checkRect(const ui::Rect& actual, ui::Rect expected)
    {
        CHECK(actual.x == doctest::Approx(expected.x));
        CHECK(actual.y == doctest::Approx(expected.y));
        CHECK(actual.width == doctest::Approx(expected.width));
        CHECK(actual.height == doctest::Approx(expected.height));
    }
} // namespace

TEST_SUITE("editor layout")
{
    TEST_CASE("a fixed editor is laid out over all of itself")
    {
        const auto placed = editor::place({ .size = { 400, 300 } }, { 500, 320 });
        CHECK(placed.zoom == 1);
        checkRect(placed.area, { 0, 0, 500, 320 });
        CHECK_FALSE(placed.safeArea);
    }

    TEST_CASE("an editor that lays out again fills the editor up to its maximum")
    {
        using enum editor::Layout::Resize;
        using enum editor::Layout::Fit;
        SUBCASE("without a maximum")
        {
            const auto placed = editor::place(layoutOf(Layout, Contain), { 900, 700 });
            checkRect(placed.area, { 0, 0, 900, 700 });
            CHECK_FALSE(placed.safeArea);
        }
        SUBCASE("contain: beyond the maximum, laid out at it in the middle")
        {
            const auto placed = editor::place(layoutOf(Layout, Contain, { 600, unbounded }), { 800, 500 });
            CHECK(placed.zoom == 1);
            checkRect(placed.area, { 100, 0, 600, 500 });
            CHECK_FALSE(placed.safeArea);
        }
        SUBCASE("cover: over the whole editor, the maximum in the middle safe")
        {
            const auto placed = editor::place(layoutOf(Layout, Cover, { 600, 400 }), { 800, 500 });
            checkRect(placed.area, { 0, 0, 800, 500 });
            REQUIRE(placed.safeArea);
            checkRect(placed.safeArea.value_or(ui::Rect {}), { 100, 50, 600, 400 });
        }
        SUBCASE("within the maximum, all of it")
        {
            const auto placed = editor::place(layoutOf(Layout, Contain, { 600, 400 }), { 500, 350 });
            checkRect(placed.area, { 0, 0, 500, 350 });
        }
    }

    TEST_CASE("an editor that scales zooms its configured layout")
    {
        using enum editor::Layout::Resize;
        using enum editor::Layout::Fit;
        SUBCASE("contain: the smaller zoom, in the middle")
        {
            const auto placed = editor::place(layoutOf(Scale, Contain), { 1000, 600 });
            CHECK(placed.zoom == doctest::Approx(2));
            checkRect(placed.area, { 100, 0, 800, 600 });
            CHECK(placed.layoutSize().width == doctest::Approx(400));
            CHECK(placed.layoutSize().height == doctest::Approx(300));
            CHECK_FALSE(placed.safeArea);
        }
        SUBCASE("cover: laid out over the whole editor, the configured size safe")
        {
            const auto placed = editor::place(layoutOf(Scale, Cover), { 1000, 600 });
            CHECK(placed.zoom == doctest::Approx(2));
            checkRect(placed.area, { 0, 0, 1000, 600 });
            REQUIRE(placed.safeArea);
            checkRect(placed.safeArea.value_or(ui::Rect {}), { 50, 0, 400, 300 });
        }
        SUBCASE("never beyond the zoom the maximum allows")
        {
            const auto placed = editor::place(layoutOf(Scale, Contain, { 600, unbounded }), { 1200, 900 });
            CHECK(placed.zoom == doctest::Approx(1.5));
            checkRect(placed.area, { 300, 225, 600, 450 });
        }
        SUBCASE("an empty editor keeps a zoom of 1")
        {
            const auto placed = editor::place(layoutOf(Scale, Contain), { 0, 0 });
            CHECK(placed.zoom == 1);
        }
    }

    TEST_CASE("positions go between the editor and the layout")
    {
        const auto placed =
            editor::place(layoutOf(editor::Layout::Resize::Scale, editor::Layout::Fit::Contain), { 1000, 600 });
        const auto layout = placed.toLayout({ 300, 200 });
        CHECK(layout.x == doctest::Approx(100));
        CHECK(layout.y == doctest::Approx(100));
        const auto editor = placed.toEditor(layout);
        CHECK(editor.x == doctest::Approx(300));
        CHECK(editor.y == doctest::Approx(200));
    }
}
