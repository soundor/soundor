#include "render/DebugOverlay.h"

#include <algorithm>

#if SOUNDOR_DEVTOOLS

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    const Frame& DebugOverlay::append(const Frame& content, ui::Surface& surface, ui::Renderer& painter)
    {
        std::vector<ui::NodeId> selected;
        for (const auto id : surface.debugHighlights())
            if (surface.isConnected(id) && std::ranges::find(selected, id) == selected.end())
                selected.push_back(id);
        if (selected.empty() && ! pixels)
            return content;
        frame = content;
        if (selected.empty())
        {
            pixels.reset();
            nodes.clear();
            frame.damage.add(frame.bounds());
            return frame;
        }
        const bool created = ! pixels;
        if (created)
        {
            pixels = std::make_unique<RasterSurface>();
            layer = newLayerId();
        }
        const bool resized = pixels->resize(frame.width, frame.height);
        std::vector<Placement> placements;
        for (const auto id : selected)
            for (const ui::Node* item = surface.find(id); item; item = item->parent())
            {
                const auto& style = item->presentedStyle();
                if (item->id() != id && style.overflow == ui::Overflow::Visible && item->type() != ui::NodeType::Scroll
                    && style.display != ui::Display::None)
                    continue;
                const auto box = item->frame();
                const auto border = style.borderWidth;
                const auto radius = style.borderRadius;
                placements.push_back({ { 0, 0, box.width, box.height },
                                       surface.visualTransform(item->id()),
                                       { border.top, border.right, border.bottom, border.left, radius.topLeft,
                                         radius.topRight, radius.bottomRight, radius.bottomLeft },
                                       style.display == ui::Display::None });
            }
        const bool changed = created || resized || selected != nodes || placements != geometry || scale != frame.scale;
        Region damage;
        if (changed)
        {
            painter.renderHighlights(surface, selected, pixels->bitmap());
            damage.add(frame.bounds());
            frame.damage.add(frame.bounds());
            ++frame.statistics.layersRasterized;
            frame.statistics.pixelsRasterized += static_cast<long long>(frame.width) * frame.height;
        }
        frame.layers.push_back(
            { .id = layer, .bounds = frame.bounds(), .content = RasterContent { pixels.get(), damage } });
        frame.statistics.cachedRasterBytes +=
            static_cast<std::uint64_t>(frame.width) * static_cast<std::uint64_t>(frame.height) * 4;
        nodes = std::move(selected);
        geometry = std::move(placements);
        scale = frame.scale;
        return frame;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
#endif
