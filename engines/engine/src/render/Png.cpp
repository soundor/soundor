#include "render/Png.h"

#include <include/core/SkImageInfo.h>
#include <include/core/SkPixmap.h>
#include <include/core/SkStream.h>
#include <include/encode/SkPngEncoder.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    std::vector<std::uint8_t> encodePng(const Bitmap& pixels)
    {
        if (pixels.empty())
            return {};
        const SkPixmap source(
            SkImageInfo::Make(pixels.width, pixels.height, kBGRA_8888_SkColorType, kPremul_SkAlphaType), pixels.pixels,
            pixels.rowBytes);
        SkDynamicMemoryWStream out;
        SkPngEncoder::Options options;
        // Fast enough for a frame on the UI thread, a little bigger.
        options.fZLibLevel = 3;
        if (! SkPngEncoder::Encode(&out, source, options))
            return {};
        std::vector<std::uint8_t> bytes(out.bytesWritten());
        out.copyTo(bytes.data());
        return bytes;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
