#pragma once

// Private to soundor_runtime: CSS color syntax.

#include <soundor/ui/Style.h>

#include <optional>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // A CSS color: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla()
    // (comma or space separated, with "/ alpha"), a named color, or
    // "transparent". Case-insensitive.
    [[nodiscard]] std::optional<Color> parseColor(std::string_view text);

    // A CSS number ("12", "-0.5", ".5", "1e2"), the whole of `text`; parsed
    // without the C locale, which a host may have changed.
    [[nodiscard]] std::optional<double> parseCssNumber(std::string_view text);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
