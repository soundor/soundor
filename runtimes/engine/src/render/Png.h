#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/render/Frame.h>

#include <cstdint>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // `pixels` (premultiplied BGRA, as the renderer draws) as a PNG image
    // with straight alpha; empty when it cannot be encoded.
    [[nodiscard]] std::vector<std::uint8_t> encodePng(const Bitmap& pixels);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
