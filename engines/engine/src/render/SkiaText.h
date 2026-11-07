#pragma once

#include <soundor/Abi.h>

// Private to soundor_runtime: text set with Skia, in the platform's fonts and
// those the UI registered.

#include <soundor/ui/Renderer.h>
#include <soundor/ui/Text.h>

#include <include/core/SkFontMgr.h>
#include <include/core/SkRefCnt.h>
#include <include/core/SkTypeface.h>

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <unordered_map>
#include <vector>

class SkCanvas;
class SkPaint;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // The fonts text is set in: the platform's, and the bundled font files the
    // UI registered (registerFont()), shared by a view's text and canvases.
    class Fonts
    {
    public:
        // `loader` reads the font files registered by asset id (may be empty).
        explicit Fonts(ui::Renderer::AssetLoader loader = {});

        [[nodiscard]] const sk_sp<SkFontMgr>& platform() const noexcept { return manager; }

        // Makes the font file `source` (an asset id) the face of `family` at
        // `weight` and in italic or not, replacing one registered with the
        // same; an error message if it is not a font Skia reads.
        std::optional<std::string> add(std::string_view family, std::string_view source, int weight, bool italic);

        // A registered face, with what to synthesize when the closest one is
        // lighter or upright where the style asks for bold or italic.
        struct Face
        {
            sk_sp<SkTypeface> typeface;
            bool embolden = false;
            bool slant = false;
        };
        // The registered face of `family` closest to `weight` and `italic`,
        // chosen as CSS does; nothing if no face of `family` is registered
        // (the platform's fonts are used then).
        [[nodiscard]] std::optional<Face> match(std::string_view family, int weight, bool italic) const;

        // Counts registrations: what was measured before one may have changed.
        [[nodiscard]] std::uint64_t generation() const noexcept { return added; }

    private:
        struct Registered
        {
            int weight = 400;
            bool italic = false;
            sk_sp<SkTypeface> typeface;
        };

        sk_sp<SkFontMgr> manager;
        ui::Renderer::AssetLoader assets;
        // By family, lowercased: family names match case-insensitively.
        std::map<std::string, std::vector<Registered>, std::less<>> families;
        std::uint64_t added = 0;
    };

    // Simple shaping: one glyph per code point, from the style's typeface or,
    // for characters it lacks, a fallback the font manager picks. No
    // ligatures, kerning or complex scripts (those need HarfBuzz).
    class SkiaTextEngine final : public ui::TextEngine
    {
    public:
        // Without `fonts`, the platform's alone.
        explicit SkiaTextEngine(std::shared_ptr<Fonts> fonts = nullptr);

        float advance(std::string_view text, const ui::TextStyle& style) override;
        Metrics metrics(const ui::TextStyle& style) override;
        std::optional<std::string> addFont(std::string_view family, std::string_view source, int weight,
                                           ui::FontStyle style) override;

        [[nodiscard]] const std::shared_ptr<Fonts>& fonts() const noexcept { return collection; }

        // Draws one line of text with its baseline starting at (x, y).
        void draw(SkCanvas& canvas, std::string_view text, const ui::TextStyle& style, float x, float y,
                  const SkPaint& paint);

    private:
        struct Run
        {
            Fonts::Face face;
            std::vector<SkGlyphID> glyphs;
            std::vector<float> advances; // letter spacing included
        };

        std::vector<Run> shape(std::string_view text, const ui::TextStyle& style);
        Fonts::Face typeface(const ui::TextStyle& style);
        sk_sp<SkTypeface> fallback(const ui::TextStyle& style, SkUnichar character);
        // Forgets what was measured when a font was registered since.
        void catchUp();

        std::shared_ptr<Fonts> collection;
        std::uint64_t seenGeneration = 0;
        std::map<std::tuple<std::string, int, bool>, Fonts::Face> typefaces;
        std::map<std::tuple<int, bool, SkUnichar>, sk_sp<SkTypeface>> fallbacks;
        // Layout measures the same words over and over.
        std::unordered_map<std::string, float> advances;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
