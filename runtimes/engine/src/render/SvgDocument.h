#pragma once

#include <soundor/Abi.h>

#include <include/core/SkRefCnt.h>
#include <modules/svg/include/SkSVGDOM.h>

#include <cstdint>
#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Untrusted, self-contained SVG. No filesystem, network, font or data-URL
    // provider is installed. The XML/geometry/reference budget is checked before
    // Skia constructs its recursive DOM. Failures are represented by nullptr.
    [[nodiscard]] sk_sp<SkSVGDOM> parseSvgDocument(std::span<const std::uint8_t> bytes);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
