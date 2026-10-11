// Soundor's replacement for Hermes's lib/Platform/Unicode/PlatformUnicodeLite.cpp
// (SoundorHermesPatch.cmake), the Unicode support of Hermes on Linux:
// Hermes's own "lite" one leaves case conversion of non-ASCII text and
// normalization undone, and its full one needs the system's ICU, which a
// plugin cannot rely on. This one behaves as QuickJS-NG did in Soundor:
// case mapping and normalization from QuickJS-NG's Unicode tables
// (SoundorUnicode.c), localeCompare over code points of the NFC forms, and
// toLocaleString() as "MM/DD/YYYY, hh:mm:ss AM" in local time.

#include "hermes/Platform/Unicode/PlatformUnicode.h"

#if HERMES_PLATFORM_UNICODE == HERMES_PLATFORM_UNICODE_LITE

    #include <cmath>
    #include <cstdint>
    #include <cstdio>
    #include <cstdlib>
    #include <ctime>
    #include <vector>

extern "C"
{
    int soundor_unicode_case(uint32_t* out, uint32_t c, int lower);
    int soundor_unicode_is_cased(uint32_t c);
    int soundor_unicode_is_case_ignorable(uint32_t c);
    int soundor_unicode_normalize(uint32_t** out, const uint32_t* text, int length, int form);
}

namespace hermes
{
    namespace platform_unicode
    {

        namespace
        {

            std::vector<uint32_t> toCodePoints(llvh::ArrayRef<char16_t> text)
            {
                std::vector<uint32_t> out;
                out.reserve(text.size());
                for (size_t i = 0; i < text.size(); ++i)
                {
                    uint32_t c = text[i];
                    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.size() && text[i + 1] >= 0xDC00
                        && text[i + 1] <= 0xDFFF)
                    {
                        c = 0x10000 + ((c - 0xD800) << 10) + (text[i + 1] - 0xDC00);
                        ++i;
                    }
                    out.push_back(c);
                }
                return out;
            }

            void appendCodePoint(llvh::SmallVectorImpl<char16_t>& out, uint32_t c)
            {
                if (c >= 0x10000)
                {
                    c -= 0x10000;
                    out.push_back(static_cast<char16_t>(0xD800 + (c >> 10)));
                    out.push_back(static_cast<char16_t>(0xDC00 + (c & 0x3FF)));
                }
                else
                {
                    out.push_back(static_cast<char16_t>(c));
                }
            }

            // Unicode's Final_Sigma condition for the capital sigma at `index`.
            bool isFinalSigma(const std::vector<uint32_t>& text, size_t index)
            {
                size_t k = index;
                bool casedBefore = false;
                while (k > 0)
                {
                    const uint32_t c = text[--k];
                    if (! soundor_unicode_is_case_ignorable(c))
                    {
                        casedBefore = soundor_unicode_is_cased(c) != 0;
                        break;
                    }
                }
                if (! casedBefore)
                    return false;
                for (k = index + 1; k < text.size(); ++k)
                {
                    const uint32_t c = text[k];
                    if (! soundor_unicode_is_case_ignorable(c))
                        return soundor_unicode_is_cased(c) == 0;
                }
                return true;
            }

            std::vector<uint32_t> normalized(llvh::ArrayRef<char16_t> text, int form)
            {
                std::vector<uint32_t> points = toCodePoints(text);
                uint32_t* out = nullptr;
                const int length =
                    soundor_unicode_normalize(&out, points.data(), static_cast<int>(points.size()), form);
                if (length < 0)
                    return points; // out of memory: unnormalized rather than nothing
                std::vector<uint32_t> result(out, out + length);
                std::free(out);
                return result;
            }

        } // namespace

        int localeCompare(llvh::ArrayRef<char16_t> left, llvh::ArrayRef<char16_t> right)
        {
            const std::vector<uint32_t> a = normalized(left, 0);
            const std::vector<uint32_t> b = normalized(right, 0);
            const size_t n = a.size() < b.size() ? a.size() : b.size();
            for (size_t i = 0; i < n; ++i)
            {
                if (a[i] != b[i])
                    return a[i] < b[i] ? -1 : 1;
            }
            return a.size() == b.size() ? 0 : (a.size() < b.size() ? -1 : 1);
        }

        void dateFormat(double unixtimeMs, bool formatDate, bool formatTime, llvh::SmallVectorImpl<char16_t>& buf)
        {
            const std::time_t seconds = static_cast<std::time_t>(std::floor(unixtimeMs / 1000.0));
            std::tm local {};
            localtime_r(&seconds, &local);
            char text[64];
            int length = 0;
            if (formatDate)
            {
                length += std::snprintf(text + length, sizeof(text) - length, "%02d/%02d/%04d", local.tm_mon + 1,
                                        local.tm_mday, local.tm_year + 1900);
                if (formatTime)
                    length += std::snprintf(text + length, sizeof(text) - length, ", ");
            }
            if (formatTime)
            {
                length += std::snprintf(text + length, sizeof(text) - length, "%02d:%02d:%02d %cM",
                                        (local.tm_hour + 11) % 12 + 1, local.tm_min, local.tm_sec,
                                        local.tm_hour < 12 ? 'A' : 'P');
            }
            buf.clear();
            for (int i = 0; i < length; ++i)
                buf.push_back(static_cast<char16_t>(text[i]));
        }

        void convertToCase(llvh::SmallVectorImpl<char16_t>& cs, CaseConversion targetCase,
                           bool /* useCurrentLocale: no locale-specific rules, as in QuickJS */)
        {
            const bool lower = targetCase == CaseConversion::ToLower;
            const std::vector<uint32_t> text = toCodePoints(cs);
            llvh::SmallVector<char16_t, 32> out;
            out.reserve(cs.size());
            for (size_t i = 0; i < text.size(); ++i)
            {
                const uint32_t c = text[i];
                if (lower && c == 0x3A3 && isFinalSigma(text, i))
                {
                    out.push_back(0x3C2);
                    continue;
                }
                uint32_t mapped[3];
                const int count = soundor_unicode_case(mapped, c, lower ? 1 : 0);
                for (int k = 0; k < count; ++k)
                    appendCodePoint(out, mapped[k]);
            }
            cs.assign(out.begin(), out.end());
        }

        void normalize(llvh::SmallVectorImpl<char16_t>& buf, NormalizationForm form)
        {
            const int kind = form == NormalizationForm::C    ? 0
                             : form == NormalizationForm::D  ? 1
                             : form == NormalizationForm::KC ? 2
                                                             : 3;
            const std::vector<uint32_t> points = normalized(buf, kind);
            buf.clear();
            for (const uint32_t c : points)
                appendCodePoint(buf, c);
        }

    } // namespace platform_unicode
} // namespace hermes

#endif // HERMES_PLATFORM_UNICODE_LITE
