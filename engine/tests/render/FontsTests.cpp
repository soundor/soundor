#include "render/SkiaText.h"

#include <doctest/doctest.h>
#include <include/core/SkGraphics.h>

#include <cstdint>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

using namespace soundor;

namespace
{
    std::vector<std::uint8_t> fixtureFont(const std::string& name)
    {
        std::ifstream file(std::string(SOUNDOR_TEST_FIXTURES "/images/assets/") + name, std::ios::binary);
        return { std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>() };
    }

    // An editor's fonts: the fixture's files by name.
    std::shared_ptr<render::Fonts> editorFonts(const std::vector<std::uint8_t>& regular,
                                               const std::vector<std::uint8_t>& bold)
    {
        return std::make_shared<render::Fonts>(
            [&](std::string_view id) -> std::optional<std::span<const std::uint8_t>>
            {
                if (id == "box-regular.ttf")
                    return std::span<const std::uint8_t>(regular);
                if (id == "box-bold.ttf")
                    return std::span<const std::uint8_t>(bold);
                return std::nullopt;
            });
    }

    // The id of the typeface `family` is set in at `weight`: 0 for none.
    SkTypefaceID typefaceOf(const render::Fonts& fonts, std::string_view family, int weight)
    {
        const auto face = fonts.match(family, weight, false);
        return face ? face->typeface->uniqueID() : 0;
    }
} // namespace

TEST_SUITE("render::Fonts")
{
    TEST_CASE("editors open together share the typefaces of the same font files, and the font manager")
    {
        const auto regular = fixtureFont("box-regular.ttf");
        const auto bold = fixtureFont("box-bold.ttf");
        REQUIRE_FALSE(regular.empty());
        REQUIRE_FALSE(bold.empty());
        const auto first = editorFonts(regular, bold);
        const auto second = editorFonts(regular, bold);
        CHECK(first->platform() == second->platform());
        REQUIRE_FALSE(first->add("Brand", "box-regular.ttf", 400, false).has_value());
        REQUIRE_FALSE(second->add("Other", "box-regular.ttf", 400, false).has_value());
        REQUIRE_FALSE(second->add("Other", "box-bold.ttf", 700, false).has_value());
        const SkTypefaceID a = typefaceOf(*first, "Brand", 400);
        CHECK(a != 0);
        CHECK(typefaceOf(*second, "Other", 400) == a);
        CHECK(typefaceOf(*second, "Other", 700) != a);
    }

    TEST_CASE("when the last editor's fonts go, their typefaces and Skia's glyph caches go too")
    {
        const auto regular = fixtureFont("box-regular.ttf");
        const auto bold = fixtureFont("box-bold.ttf");
        SkTypefaceID before = 0;
        {
            render::SkiaTextEngine text(editorFonts(regular, bold));
            REQUIRE_FALSE(text.addFont("Brand", "box-regular.ttf", 400, ui::FontStyle::Normal).has_value());
            before = typefaceOf(*text.fonts(), "Brand", 400);
            CHECK(before != 0);
            // Glyphs measured: a strike in Skia's cache.
            ui::TextStyle style;
            style.fontFamily = "Brand";
            style.fontSize = 20;
            CHECK(text.advance("ABCD", style) > 0);
            CHECK(SkGraphics::GetFontCacheUsed() > 0);
        }
        CHECK(SkGraphics::GetFontCacheUsed() == 0);
        // Opened again: a typeface of its own (the last one went).
        const auto fonts = editorFonts(regular, bold);
        REQUIRE_FALSE(fonts->add("Brand", "box-regular.ttf", 400, false).has_value());
        const SkTypefaceID again = typefaceOf(*fonts, "Brand", 400);
        CHECK(again != 0);
        CHECK(again != before);
    }
}
