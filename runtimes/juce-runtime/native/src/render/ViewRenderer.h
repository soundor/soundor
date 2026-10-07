#pragma once

#include "render/Damage.h"

#include <soundor/render/Frame.h>
#include <soundor/ui/Renderer.h>
#include <soundor/ui/Surface.h>

#include <cstdint>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Turns a view's ui::Surface into a Frame for a compositor: plans its
    // layers and keeps their CPU rasterization current, drawing only what
    // changed since the previous frame.
    //
    // Today the whole UI (content and overlay) is one CPU layer.
    class ViewRenderer
    {
    public:
        explicit ViewRenderer(ui::Renderer& renderer) : painter(renderer) {}

        // The frame for `surface` as it is now. It and the pixels it points
        // to stay valid until the next call.
        const Frame& update(ui::Surface& surface, double seconds);

    private:
        ui::Renderer& painter;
        DamageTracker damage;
        RasterSurface pixels;
        LayerId layer = newLayerId();
        std::uint64_t revision = 0;
        Frame frame;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
