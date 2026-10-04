#pragma once

// Private to soundor_runtime: text set with Skia and the platform's fonts.

#include <soundor/ui/Text.h>

#include <include/core/SkFontMgr.h>
#include <include/core/SkRefCnt.h>
#include <include/core/SkTypeface.h>

#include <cstdint>
#include <map>
#include <string>
#include <tuple>
#include <unordered_map>
#include <vector>

class SkCanvas;
class SkPaint;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Simple shaping: one glyph per code point, from the style's typeface or,
    // for characters it lacks, a fallback the font manager picks. No
    // ligatures, kerning or complex scripts (those need HarfBuzz).
    class SkiaTextEngine final : public ui::TextEngine
    {
    public:
        SkiaTextEngine();

        float advance(std::string_view text, const ui::TextStyle& style) override;
        Metrics metrics(const ui::TextStyle& style) override;

        // Draws one line of text with its baseline starting at (x, y).
        void draw(SkCanvas& canvas, std::string_view text, const ui::TextStyle& style, float x, float y,
                  const SkPaint& paint);

    private:
        struct Run
        {
            sk_sp<SkTypeface> typeface;
            std::vector<SkGlyphID> glyphs;
            std::vector<float> advances; // letter spacing included
        };

        std::vector<Run> shape(std::string_view text, const ui::TextStyle& style);
        sk_sp<SkTypeface> typeface(const ui::TextStyle& style);
        sk_sp<SkTypeface> fallback(const ui::TextStyle& style, SkUnichar character);

        sk_sp<SkFontMgr> fonts;
        std::map<std::tuple<std::string, int, bool>, sk_sp<SkTypeface>> typefaces;
        std::map<std::tuple<int, bool, SkUnichar>, sk_sp<SkTypeface>> fallbacks;
        // Layout measures the same words over and over.
        std::unordered_map<std::string, float> advances;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
