#include <soundor/ui/Text.h>

#include <algorithm>
#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        bool isContinuation(char c) noexcept
        {
            return (static_cast<unsigned char>(c) & 0xC0) == 0x80;
        }

        // Approximates a proportional font: every character 0.55 em wide.
        class ApproximateTextEngine final : public TextEngine
        {
        public:
            float advance(std::string_view text, const TextStyle& style) override
            {
                const auto characters = static_cast<float>(
                    std::count_if(text.begin(), text.end(), [](char c) { return ! isContinuation(c); }));
                return characters * (style.fontSize * 0.55f + style.letterSpacing);
            }

            Metrics metrics(const TextStyle& style) override
            {
                return { style.fontSize * 0.8f, style.fontSize * 0.2f };
            }
        };
    } // namespace

    TextLayout TextEngine::layout(std::string_view text, const TextStyle& style, float maxWidth)
    {
        const Metrics font = metrics(style);
        // CSS's "normal" line height, or the one asked for.
        const float lineHeight = style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2f;
        const float baseline = (lineHeight - (font.ascent + font.descent)) / 2 + font.ascent;
        const auto limit =
            style.numberOfLines > 0 ? static_cast<std::size_t>(style.numberOfLines) : static_cast<std::size_t>(-1);

        TextLayout out;
        const auto emit = [&](std::size_t begin, std::size_t end)
        {
            if (out.lines.size() >= limit)
                return;
            const float top = static_cast<float>(out.lines.size()) * lineHeight;
            const float width = advance(text.substr(begin, end - begin), style);
            out.lines.push_back({ begin, end, width, top, lineHeight, top + baseline });
            out.size.width = std::max(out.size.width, width);
        };

        std::size_t paragraph = 0;
        for (;;)
        {
            const std::size_t paragraphEnd = std::min(text.find('\n', paragraph), text.size());
            // Greedy word wrap: the longest run of whole words that fits; a
            // word wider than the line gets a line of its own.
            std::size_t lineBegin = paragraph;
            std::size_t lineEnd = paragraph;
            std::size_t position = paragraph;
            while (position < paragraphEnd)
            {
                const std::size_t wordEnd = std::min(text.find(' ', position), paragraphEnd);
                const bool fits =
                    std::isinf(maxWidth) || advance(text.substr(lineBegin, wordEnd - lineBegin), style) <= maxWidth;
                if (fits || lineEnd == lineBegin)
                    lineEnd = wordEnd;
                else
                {
                    emit(lineBegin, lineEnd);
                    lineBegin = position;
                    lineEnd = wordEnd;
                }
                position = wordEnd;
                while (position < paragraphEnd && text[position] == ' ')
                    ++position;
                // Leading spaces stay with the first word of a line.
                if (lineEnd == lineBegin)
                    lineEnd = position;
            }
            emit(lineBegin, lineEnd);
            if (paragraphEnd == text.size())
                break;
            paragraph = paragraphEnd + 1;
        }
        out.size.height = static_cast<float>(out.lines.size()) * lineHeight;
        return out;
    }

    std::shared_ptr<TextEngine> approximateTextEngine()
    {
        return std::make_shared<ApproximateTextEngine>();
    }

    std::size_t offsetAt(TextEngine& engine, std::string_view text, const TextLine& line, const TextStyle& style,
                         float x)
    {
        std::size_t best = line.begin;
        float bestDistance = std::abs(x);
        for (std::size_t i = line.begin + 1; i <= line.end; ++i)
        {
            if (i < text.size() && isContinuation(text[i]))
                continue;
            const float distance = std::abs(x - engine.advance(text.substr(line.begin, i - line.begin), style));
            if (distance < bestDistance)
            {
                best = i;
                bestDistance = distance;
            }
        }
        return best;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
