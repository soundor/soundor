#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/ui/Style.h>

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    struct Size
    {
        float width = 0;
        float height = 0;
    };

    // One line of laid-out text: bytes [begin, end) of the text (a break's
    // spaces belong to no line), positioned from the top of the text.
    struct TextLine
    {
        std::size_t begin = 0;
        std::size_t end = 0;
        float width = 0;
        float top = 0;
        float height = 0;
        // From the top of the text.
        float baseline = 0;
    };

    struct TextLayout
    {
        std::vector<TextLine> lines;
        Size size;
    };

    // Lays out text: line breaking and measuring. The renderer provides the
    // engine that matches what it draws; without one, an approximation from
    // the font size keeps layout working.
    class TextEngine
    {
    public:
        virtual ~TextEngine() = default;

        // `text` set in `style`, wrapped at word boundaries to fit `maxWidth`
        // (infinite: only at line breaks), with at most style.numberOfLines.
        virtual TextLayout layout(std::string_view text, const TextStyle& style, float maxWidth);

        // The width of `text` on one line.
        virtual float advance(std::string_view text, const TextStyle& style) = 0;

        struct Metrics
        {
            float ascent = 0;  // above the baseline
            float descent = 0; // below the baseline
        };
        virtual Metrics metrics(const TextStyle& style) = 0;

        // Makes the font file `source` (a bundled asset id) the face of
        // `family` at `weight` and `style`; text in that family is set in
        // the registered faces only. An error message if it is not a font.
        // Engines that do not draw (the approximation) take any font.
        virtual std::optional<std::string> addFont(std::string_view family, std::string_view source, int weight,
                                                   FontStyle style);
    };

    [[nodiscard]] std::shared_ptr<TextEngine> approximateTextEngine();

    // The byte offset in `line` closest to `x` (relative to the line's start),
    // always on a UTF-8 code point boundary.
    [[nodiscard]] std::size_t offsetAt(TextEngine& engine, std::string_view text, const TextLine& line,
                                       const TextStyle& style, float x);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
