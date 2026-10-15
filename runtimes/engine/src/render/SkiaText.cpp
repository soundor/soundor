#include "render/SkiaText.h"

#include <include/core/SkCanvas.h>
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

        SkFont fontOf(sk_sp<SkTypeface> typeface, const ui::TextStyle& style)
        {
            SkFont font(std::move(typeface), style.fontSize);
            font.setSubpixel(true);
            font.setEdging(SkFont::Edging::kAntiAlias);
            font.setHinting(SkFontHinting::kSlight);
            return font;
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

    SkiaTextEngine::SkiaTextEngine() : fonts(platformFonts()) {}

    sk_sp<SkTypeface> SkiaTextEngine::typeface(const ui::TextStyle& style)
    {
        const auto key = std::make_tuple(style.fontFamily, style.fontWeight, style.fontStyle == ui::FontStyle::Italic);
        if (const auto found = typefaces.find(key); found != typefaces.end())
            return found->second;
        const char* family = style.fontFamily.empty() ? nullptr : style.fontFamily.c_str();
        sk_sp<SkTypeface> face;
        if (fonts != nullptr)
        {
            face = fonts->matchFamilyStyle(family, fontStyleOf(style));
            if (face == nullptr)
                face = fonts->legacyMakeTypeface(family, fontStyleOf(style));
            if (face == nullptr && family != nullptr)
                face = fonts->legacyMakeTypeface(nullptr, fontStyleOf(style));
        }
        typefaces.emplace(key, face);
        return face;
    }

    sk_sp<SkTypeface> SkiaTextEngine::fallback(const ui::TextStyle& style, SkUnichar character)
    {
        const auto key = std::make_tuple(style.fontWeight, style.fontStyle == ui::FontStyle::Italic, character);
        if (const auto found = fallbacks.find(key); found != fallbacks.end())
            return found->second;
        sk_sp<SkTypeface> face =
            fonts != nullptr ? fonts->matchFamilyStyleCharacter(nullptr, fontStyleOf(style), nullptr, 0, character)
                             : nullptr;
        fallbacks.emplace(key, face);
        return face;
    }

    std::vector<SkiaTextEngine::Run> SkiaTextEngine::shape(std::string_view text, const ui::TextStyle& style)
    {
        std::vector<Run> runs;
        const sk_sp<SkTypeface> primary = typeface(style);
        if (primary == nullptr)
            return runs;
        for (std::size_t i = 0; i < text.size();)
        {
            const SkUnichar character = nextCodePoint(text, i);
            sk_sp<SkTypeface> face = primary;
            SkGlyphID glyph = primary->unicharToGlyph(character);
            if (glyph == 0 && character > 0x20)
                if (sk_sp<SkTypeface> other = fallback(style, character); other != nullptr)
                    if (const SkGlyphID found = other->unicharToGlyph(character); found != 0)
                    {
                        face = std::move(other);
                        glyph = found;
                    }
            if (runs.empty() || runs.back().typeface != face)
                runs.push_back({ face, {}, {} });
            runs.back().glyphs.push_back(glyph);
        }
        for (Run& run : runs)
        {
            run.advances.resize(run.glyphs.size());
            fontOf(run.typeface, style).getWidths(run.glyphs, run.advances);
            for (float& advance : run.advances)
                advance += style.letterSpacing;
        }
        return runs;
    }

    float SkiaTextEngine::advance(std::string_view text, const ui::TextStyle& style)
    {
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
        const sk_sp<SkTypeface> face = typeface(style);
        if (face == nullptr)
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
            canvas.drawGlyphs(run.glyphs, positions, { x, y }, fontOf(run.typeface, style), paint);
            x += at;
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
