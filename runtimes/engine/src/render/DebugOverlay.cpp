#include "render/DebugOverlay.h"

#if SOUNDOR_DEVTOOLS

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    const Frame& DebugOverlay::append(const Frame& content, ui::Surface& surface, ui::Renderer& painter)
    {
        auto selected = surface.debugHighlight();
        if (! surface.isConnected(selected))
            selected = ui::noNode;
        if (selected == ui::noNode && ! pixels)
            return content;
        frame = content;
        if (selected == ui::noNode)
        {
            pixels.reset();
            node = ui::noNode;
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
        for (const ui::Node* item = surface.find(selected); item; item = item->parent())
        {
            const auto& style = item->presentedStyle();
            if (item->id() != selected && style.overflow == ui::Overflow::Visible
                && item->type() != ui::NodeType::Scroll && style.display != ui::Display::None)
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
        const bool changed = created || resized || selected != node || placements != geometry || scale != frame.scale;
        Region damage;
        if (changed)
        {
            painter.renderHighlight(surface, selected, pixels->bitmap());
            damage.add(frame.bounds());
            frame.damage.add(frame.bounds());
            ++frame.statistics.layersRasterized;
            frame.statistics.pixelsRasterized += static_cast<long long>(frame.width) * frame.height;
        }
        frame.layers.push_back(
            { .id = layer, .bounds = frame.bounds(), .content = RasterContent { pixels.get(), damage } });
        frame.statistics.cachedRasterBytes +=
            static_cast<std::uint64_t>(frame.width) * static_cast<std::uint64_t>(frame.height) * 4;
        node = selected;
        geometry = std::move(placements);
        scale = frame.scale;
        return frame;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
#endif
