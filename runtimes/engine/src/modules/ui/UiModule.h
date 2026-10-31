#pragma once

#include <soundor/Abi.h>
#include <soundor/js/Context.h>
#include <soundor/ui/Surface.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Installs `soundor:ui` into `context`: plugin code builds its node tree on
    // `surface`, and the surface's events are dispatched to those nodes for as
    // long as the context lives.
    void install(js::Context& context, std::shared_ptr<Surface> surface);

    // Tells soundor:ui's viewSize() subscribers that the surface's size or
    // scale changed since they were last told; nothing when it did not.
    void notifyViewSize(js::Context& context);

    // Runs the callbacks requestAnimationFrame() collected.
    void frame(js::Context& context);
    void notifyAnimations(js::Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
