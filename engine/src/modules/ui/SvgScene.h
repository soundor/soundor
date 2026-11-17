#pragma once

#include "js/Bindings.h"

#include <soundor/ui/Svg.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Reads a bounded portable snapshot. Compilation/installation is atomic
    // in Surface; no guest values escape this call.
    SvgScene readSvgScene(js::bind::ContextState& context, const jsi::Value& value);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
