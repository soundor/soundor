// The Unicode tables of QuickJS-NG's libunicode (case mapping, normalization),
// behind a plain C interface for PlatformUnicodeLite.cpp: Hermes's Unicode
// support on Linux, which would otherwise need the system's ICU.

#include "libunicode.h"

#include <stdint.h>
#include <stdlib.h>

static void* soundorRealloc(void* opaque, void* block, size_t size)
{
    (void)opaque;
    if (size == 0)
    {
        free(block);
        return NULL;
    }
    return realloc(block, size);
}

int soundor_unicode_case(uint32_t* out, uint32_t c, int lower)
{
    return lre_case_conv(out, c, lower ? 1 : 0);
}

int soundor_unicode_is_cased(uint32_t c)
{
    return lre_is_cased(c) ? 1 : 0;
}

int soundor_unicode_is_case_ignorable(uint32_t c)
{
    return lre_is_case_ignorable(c) ? 1 : 0;
}

// 0 = NFC, 1 = NFD, 2 = NFKC, 3 = NFKD. Returns the length of *out (freed by
// the caller with free()), or -1 when out of memory.
int soundor_unicode_normalize(uint32_t** out, const uint32_t* text, int length, int form)
{
    return unicode_normalize(out, text, length, (UnicodeNormalizationEnum)form, NULL, soundorRealloc);
}
