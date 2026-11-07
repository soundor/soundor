#include "render/SkiaText.h"

#include "render/Canvas2D.h"

#include <include/core/SkCanvas.h>
#include <include/core/SkData.h>
#include <include/core/SkFont.h>
#include <include/core/SkFontMetrics.h>
#include <include/core/SkFontStyle.h>
#include <include/core/SkPaint.h>

#if defined(__APPLE__)
    #include <include/ports/SkFontMgr_mac_ct.h>
#elif defined(_WIN32)
    #include <include/ports/SkTypeface_win.h>
#else
    #include <include/ports/SkFontMgr_fontconfig.h>
    #include <include/ports/SkFontScanner_FreeType.h>
#endif

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        sk_sp<SkFontMgr> platformFonts()
        {
#if defined(__APPLE__)
            return SkFontMgr_New_CoreText(nullptr);
#elif defined(_WIN32)
            return SkFontMgr_New_DirectWrite();
#else
            return SkFontMgr_New_FontConfig(nullptr, SkFontScanner_Make_FreeType());
#endif
        }

        SkFontStyle fontStyleOf(const ui::TextStyle& style)
        {
            return { style.fontWeight, SkFontStyle::kNormal_Width,
                     style.fontStyle == ui::FontStyle::Italic ? SkFontStyle::kItalic_Slant
                                                              : SkFontStyle::kUpright_Slant };
        }

        // Decodes the UTF-8 code point at `i`, advancing it; U+FFFD for
        // malformed input.
        SkUnichar nextCodePoint(std::string_view text, std::size_t& i)
        {
            const auto byte = [&](std::size_t at) { return static_cast<unsigned char>(text[at]); };
            const unsigned char lead = byte(i++);
            if (lead < 0x80)
                return lead;
            int extra = 0;
            SkUnichar value = 0;
            if ((lead & 0xE0) == 0xC0)
            {
                extra = 1;
                value = lead & 0x1F;
            }
            else if ((lead & 0xF0) == 0xE0)
            {
                extra = 2;
                value = lead & 0x0F;
            }
            else if ((lead & 0xF8) == 0xF0)
            {
                extra = 3;
                value = lead & 0x07;
            }
            else
                return 0xFFFD;
            for (int k = 0; k < extra; ++k)
            {
                if (i >= text.size() || (byte(i) & 0xC0) != 0x80)
                    return 0xFFFD;
                value = (value << 6) | (byte(i++) & 0x3F);
            }
            return value;
        }

        SkFont fontOf(const Fonts::Face& face, const ui::TextStyle& style)
        {
            SkFont font(face.typeface, style.fontSize);
            font.setSubpixel(true);
            font.setEdging(SkFont::Edging::kAntiAlias);
            font.setHinting(SkFontHinting::kSlight);
            // What browsers synthesize, the same way (Skia's fake bold and
            // a quarter skew).
            font.setEmbolden(face.embolden);
            if (face.slant)
                font.setSkewX(-0.25f);
            return font;
        }

        std::string lowercase(std::string_view text)
        {
            std::string result(text);
            for (char& character : result)
                character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
            return result;
        }

        // How far `candidate` is from the `wanted` weight in CSS's order of
        // preference (CSS Fonts 4, "font-weight" matching): lower is closer.
        int weightDistance(int wanted, int candidate)
        {
            constexpr int beyond = 10000; // the weights on the other side come after
            if (wanted >= 400 && wanted <= 500)
            {
                // Up to 500 heavier first, then lighter, then heavier still.
                if (candidate >= wanted && candidate <= 500)
                    return candidate - wanted;
                if (candidate < wanted)
                    return beyond + wanted - candidate;
                return 2 * beyond + candidate - wanted;
            }
            if (wanted < 400)
                return candidate <= wanted ? wanted - candidate : beyond + candidate - wanted;
            return candidate >= wanted ? candidate - wanted : beyond + wanted - candidate;
        }

        std::string cacheKey(std::string_view text, const ui::TextStyle& style)
        {
            std::string key = style.fontFamily;
            key += '\0';
            for (const float number : { style.fontSize, style.letterSpacing, static_cast<float>(style.fontWeight),
                                        static_cast<float>(style.fontStyle) })
            {
                char bytes[sizeof(float)];
                std::memcpy(bytes, &number, sizeof(float));
                key.append(bytes, sizeof(float));
            }
            key.append(text);
            return key;
        }
    } // namespace

    Fonts::Fonts(ui::Renderer::AssetLoader loader) : manager(platformFonts()), assets(std::move(loader)) {}

    std::optional<std::string> Fonts::add(std::string_view family, std::string_view source, int weight, bool italic)
    {
        const std::optional<std::span<const std::uint8_t>> bytes =
            assets ? assets(source) : std::optional<std::span<const std::uint8_t>> {};
        if (! bytes)
            return "'" + std::string(source) + "' is not a bundled font (TrueType or OpenType)";
        sk_sp<SkTypeface> typeface =
            manager != nullptr ? manager->makeFromData(SkData::MakeWithCopy(bytes->data(), bytes->size())) : nullptr;
        if (typeface == nullptr)
            return "'" + std::string(source) + "' is not a bundled font (TrueType or OpenType)";
        std::vector<Registered>& faces = families[lowercase(family)];
        std::erase_if(faces, [&](const Registered& face) { return face.weight == weight && face.italic == italic; });
        faces.push_back({ weight, italic, std::move(typeface) });
        ++added;
        return std::nullopt;
    }

    std::optional<Fonts::Face> Fonts::match(std::string_view family, int weight, bool italic) const
    {
        if (families.empty())
            return std::nullopt;
        const auto found = families.find(lowercase(family));
        if (found == families.end() || found->second.empty())
            return std::nullopt;
        // The style first (an upright face for italic only when there is
        // no italic one), then the weight.
        const Registered* best = &found->second.front();
        for (const Registered& face : found->second)
            if ((face.italic == italic && best->italic != italic)
                || (face.italic == best->italic
                    && weightDistance(weight, face.weight) < weightDistance(weight, best->weight)))
                best = &face;
        return Face { best->typeface, weight >= 600 && best->weight <= 500, italic && ! best->italic };
    }

    std::shared_ptr<Fonts> fontsOf(const ui::TextEngine& text)
    {
        const auto* engine = dynamic_cast<const SkiaTextEngine*>(&text);
        return engine != nullptr ? engine->fonts() : nullptr;
    }

    SkiaTextEngine::SkiaTextEngine(std::shared_ptr<Fonts> fonts)
        : collection(fonts != nullptr ? std::move(fonts) : std::make_shared<Fonts>())
    {
    }

    std::optional<std::string> SkiaTextEngine::addFont(std::string_view family, std::string_view source, int weight,
                                                       ui::FontStyle style)
    {
        return collection->add(family, source, weight, style == ui::FontStyle::Italic);
    }

    void SkiaTextEngine::catchUp()
    {
        if (seenGeneration == collection->generation())
            return;
        seenGeneration = collection->generation();
        typefaces.clear();
        advances.clear();
    }

    Fonts::Face SkiaTextEngine::typeface(const ui::TextStyle& style)
    {
        catchUp();
        const bool italic = style.fontStyle == ui::FontStyle::Italic;
        const auto key = std::make_tuple(style.fontFamily, style.fontWeight, italic);
        if (const auto found = typefaces.find(key); found != typefaces.end())
            return found->second;
        Fonts::Face face;
        if (auto registered = collection->match(style.fontFamily, style.fontWeight, italic))
            face = std::move(*registered);
        else if (const sk_sp<SkFontMgr>& fonts = collection->platform(); fonts != nullptr)
        {
            const char* family = style.fontFamily.empty() ? nullptr : style.fontFamily.c_str();
            face.typeface = fonts->matchFamilyStyle(family, fontStyleOf(style));
            if (face.typeface == nullptr)
                face.typeface = fonts->legacyMakeTypeface(family, fontStyleOf(style));
            if (face.typeface == nullptr && family != nullptr)
                face.typeface = fonts->legacyMakeTypeface(nullptr, fontStyleOf(style));
        }
        typefaces.emplace(key, face);
        return face;
    }

    sk_sp<SkTypeface> SkiaTextEngine::fallback(const ui::TextStyle& style, SkUnichar character)
    {
        const auto key = std::make_tuple(style.fontWeight, style.fontStyle == ui::FontStyle::Italic, character);
        if (const auto found = fallbacks.find(key); found != fallbacks.end())
            return found->second;
        const sk_sp<SkFontMgr>& fonts = collection->platform();
        sk_sp<SkTypeface> face =
            fonts != nullptr ? fonts->matchFamilyStyleCharacter(nullptr, fontStyleOf(style), nullptr, 0, character)
                             : nullptr;
        fallbacks.emplace(key, face);
        return face;
    }

    std::vector<SkiaTextEngine::Run> SkiaTextEngine::shape(std::string_view text, const ui::TextStyle& style)
    {
        std::vector<Run> runs;
        const Fonts::Face primary = typeface(style);
        if (primary.typeface == nullptr)
            return runs;
        for (std::size_t i = 0; i < text.size();)
        {
            const SkUnichar character = nextCodePoint(text, i);
            Fonts::Face face = primary;
            SkGlyphID glyph = primary.typeface->unicharToGlyph(character);
            if (glyph == 0 && character > 0x20)
                if (sk_sp<SkTypeface> other = fallback(style, character); other != nullptr)
                    if (const SkGlyphID found = other->unicharToGlyph(character); found != 0)
                    {
                        face = { std::move(other) };
                        glyph = found;
                    }
            if (runs.empty() || runs.back().face.typeface != face.typeface)
                runs.push_back({ std::move(face), {}, {} });
            runs.back().glyphs.push_back(glyph);
        }
        for (Run& run : runs)
        {
            run.advances.resize(run.glyphs.size());
            fontOf(run.face, style).getWidths(run.glyphs, run.advances);
            for (float& advance : run.advances)
                advance += style.letterSpacing;
        }
        return runs;
    }

    float SkiaTextEngine::advance(std::string_view text, const ui::TextStyle& style)
    {
        catchUp();
        std::string key = cacheKey(text, style);
        if (const auto found = advances.find(key); found != advances.end())
            return found->second;
        float width = 0;
        for (const Run& run : shape(text, style))
            for (const float advance : run.advances)
                width += advance;
        if (advances.size() > 8192)
            advances.clear();
        advances.emplace(std::move(key), width);
        return width;
    }

    ui::TextEngine::Metrics SkiaTextEngine::metrics(const ui::TextStyle& style)
    {
        const Fonts::Face face = typeface(style);
        if (face.typeface == nullptr)
            return { style.fontSize * 0.8f, style.fontSize * 0.2f };
        SkFontMetrics metrics {};
        fontOf(face, style).getMetrics(&metrics);
        return { -metrics.fAscent, metrics.fDescent };
    }

    void SkiaTextEngine::draw(SkCanvas& canvas, std::string_view text, const ui::TextStyle& style, float x, float y,
                              const SkPaint& paint)
    {
        std::vector<SkPoint> positions;
        for (const Run& run : shape(text, style))
        {
            positions.resize(run.glyphs.size());
            float at = 0;
            for (std::size_t i = 0; i < run.glyphs.size(); ++i)
            {
                positions[i] = { at, 0 };
                at += run.advances[i];
            }
            canvas.drawGlyphs(run.glyphs, positions, { x, y }, fontOf(run.face, style), paint);
            x += at;
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
