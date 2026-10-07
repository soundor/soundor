#include "render/ViewRenderer.h"

#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    const Frame& ViewRenderer::update(ui::Surface& surface, double seconds)
    {
        const float scale = surface.scale();
        const auto width = static_cast<int>(std::lround(surface.size().width * scale));
        const auto height = static_cast<int>(std::lround(surface.size().height * scale));
        // Laying out may change what is drawn (an input scrolls its caret
        // into view): before taking what changed.
        surface.layout();
        ui::Surface::Invalidation invalid = surface.takeInvalidation();
        if (pixels.resize(width, height))
            invalid.everything = true;

        frame.width = width;
        frame.height = height;
        frame.scale = scale;
        frame.statistics = {};
        Region changed;
        // Nothing the layout depends on changed, nor anything drawn: no
        // need to look.
        if (invalid.everything || ! invalid.nodes.empty() || surface.revision() != revision)
            changed = damage.update(surface, invalid, pixels.bounds());
        revision = surface.revision();

        if (! changed.empty())
        {
            painter.render(surface, pixels.bitmap(), seconds, &changed);
            frame.statistics.layersRasterized = 1;
            frame.statistics.pixelsRasterized = changed.area();
        }
        frame.layers.clear();
        frame.layers.push_back(
            { .id = layer, .bounds = pixels.bounds(), .content = RasterContent { &pixels, changed } });
        frame.damage = std::move(changed);
        return frame;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
