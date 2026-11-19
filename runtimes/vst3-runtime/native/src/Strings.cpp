#include "Strings.h"

#include <algorithm>
#include <cstring>

namespace soundor::vst3
{
    std::u16string utf16(std::string_view text)
    {
        std::u16string out;
        out.reserve(text.size());
        std::size_t i = 0;
        while (i < text.size())
        {
            const auto c = static_cast<unsigned char>(text[i]);
            char32_t code = 0xFFFD;
            std::size_t length = 1;
            if (c < 0x80)
                code = c;
            else if ((c & 0xE0) == 0xC0 && i + 1 < text.size())
            {
                code = ((c & 0x1Fu) << 6) | (static_cast<unsigned char>(text[i + 1]) & 0x3Fu);
                length = 2;
            }
            else if ((c & 0xF0) == 0xE0 && i + 2 < text.size())
            {
                code = ((c & 0x0Fu) << 12) | ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 6)
                       | (static_cast<unsigned char>(text[i + 2]) & 0x3Fu);
                length = 3;
            }
            else if ((c & 0xF8) == 0xF0 && i + 3 < text.size())
            {
                code = ((c & 0x07u) << 18) | ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 12)
                       | ((static_cast<unsigned char>(text[i + 2]) & 0x3Fu) << 6)
                       | (static_cast<unsigned char>(text[i + 3]) & 0x3Fu);
                length = 4;
            }
            i += length;
            if (code >= 0x10000)
            {
                code -= 0x10000;
                out += static_cast<char16_t>(0xD800 + (code >> 10));
                out += static_cast<char16_t>(0xDC00 + (code & 0x3FF));
            }
            else
                out += static_cast<char16_t>(code);
        }
        return out;
    }

    std::string utf8(const Steinberg::Vst::TChar* text)
    {
        std::string out;
        if (text == nullptr)
            return out;
        for (std::size_t i = 0; text[i] != 0; ++i)
        {
            char32_t code = static_cast<char16_t>(text[i]);
            if (code >= 0xD800 && code <= 0xDBFF && text[i + 1] >= 0xDC00 && text[i + 1] <= 0xDFFF)
            {
                code = 0x10000 + ((code - 0xD800) << 10) + (static_cast<char16_t>(text[i + 1]) - 0xDC00);
                ++i;
            }
            if (code < 0x80)
                out += static_cast<char>(code);
            else if (code < 0x800)
            {
                out += static_cast<char>(0xC0 | (code >> 6));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
            else if (code < 0x10000)
            {
                out += static_cast<char>(0xE0 | (code >> 12));
                out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
            else
            {
                out += static_cast<char>(0xF0 | (code >> 18));
                out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
                out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
        }
        return out;
    }

    void copyString128(std::string_view text, Steinberg::Vst::String128 out)
    {
        const auto wide = utf16(text);
        const auto length = std::min<std::size_t>(wide.size(), 127);
        for (std::size_t i = 0; i < length; ++i)
            out[i] = static_cast<Steinberg::Vst::TChar>(wide[i]);
        out[length] = 0;
    }

    void copyAscii(std::string_view text, char* out, std::size_t size)
    {
        if (size == 0)
            return;
        std::size_t length = std::min(text.size(), size - 1);
        // Never cut a UTF-8 sequence.
        while (length > 0 && length < text.size() && (static_cast<unsigned char>(text[length]) & 0xC0) == 0x80)
            --length;
        std::memcpy(out, text.data(), length);
        out[length] = 0;
    }
} // namespace soundor::vst3
