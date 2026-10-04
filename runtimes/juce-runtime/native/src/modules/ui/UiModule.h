#pragma once

#include <soundor/js/Context.h>
#include <soundor/ui/Surface.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Installs `soundor:ui` into `context`: plugin code builds its node tree on
    // `surface`, and the surface's events are dispatched to those nodes for as
    // long as the context lives.
    void install(js::Context& context, std::shared_ptr<Surface> surface);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
