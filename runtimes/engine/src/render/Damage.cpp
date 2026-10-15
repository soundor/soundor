#include "render/Damage.h"

#include <algorithm>
#include <bit>
#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    struct DamageTracker::Pass
    {
        ui::Surface& surface;
        const ui::Surface::Invalidation& invalidation;
        float scale = 1;
        const std::unordered_map<ui::NodeId, int>* layerOf = nullptr;
        std::vector<Region> damage;

        [[nodiscard]] int layer(ui::NodeId id) const
        {
            if (layerOf == nullptr)
                return 0;
            const auto found = layerOf->find(id);
            return found != layerOf->end() ? found->second : 0;
        }

        void add(const IntRect& rect, int first, int last)
        {
            for (int i = first; i <= last && i < static_cast<int>(damage.size()); ++i)
                damage[static_cast<std::size_t>(i)].add(rect);
        }

        [[nodiscard]] bool invalidated(ui::NodeId id) const
        {
            return std::ranges::binary_search(invalidation.nodes, id);
        }

        // Logical pixels to device pixels, out to whole pixels plus one for
        // antialiasing.
        [[nodiscard]] IntRect device(float x, float y, float width, float height) const
        {
            if (width <= 0 || height <= 0)
                return {};
            const auto floor = [](float v) { return static_cast<int>(std::floor(v)); };
            const auto ceil = [](float v) { return static_cast<int>(std::ceil(v)); };
            const int left = floor(x * scale) - 1;
            const int top = floor(y * scale) - 1;
            return { left, top, ceil((x + width) * scale) + 1 - left, ceil((y + height) * scale) + 1 - top };
        }
    };

    namespace
    {
        std::uint64_t mix(std::uint64_t seed, std::uint64_t value)
        {
            return seed ^ (value + 0x9e3779b97f4a7c15ULL + (seed << 6) + (seed >> 2));
        }

        std::uint64_t bits(float value)
        {
            return std::bit_cast<std::uint32_t>(value);
        }
    } // namespace

    void DamageTracker::reset() noexcept
    {
        records.clear();
        known = false;
    }

    Region DamageTracker::update(ui::Surface& surface, const ui::Surface::Invalidation& invalidation,
                                 const IntRect& view)
    {
        return std::move(update(surface, invalidation, view, {}, 1).front());
    }

    std::vector<Region> DamageTracker::update(ui::Surface& surface, const ui::Surface::Invalidation& invalidation,
                                              const IntRect& view, const std::unordered_map<ui::NodeId, int>& layerOf,
                                              int layers)
    {
        surface.layout();
        Pass pass { surface, invalidation, surface.scale(), &layerOf,
                    std::vector<Region>(static_cast<std::size_t>(std::max(layers, 1))) };
        ++passes;
        visit(pass, surface.root(), 0, 0, view);
        visit(pass, surface.overlay(), 0, 0, view);
        // What is no longer drawn: removed, hidden, or released.
        for (auto record = records.begin(); record != records.end();)
        {
            if (record->second.pass == passes)
            {
                ++record;
                continue;
            }
            pass.add(record->second.own, record->second.first, record->second.last);
            record = records.erase(record);
        }
        if (! known || invalidation.everything)
        {
            known = true;
            for (Region& region : pass.damage)
                region = Region(view);
            return std::move(pass.damage);
        }
        for (Region& region : pass.damage)
            region.clip(view);
        return std::move(pass.damage);
    }

    DamageTracker::Visited DamageTracker::visit(Pass& pass, const ui::Node& node, float originX, float originY,
                                                const IntRect& clip)
    {
        const ui::Style& style = node.style();
        // Not drawn (nor anything in it): not recorded either, so where it
        // was is damaged as gone.
        const int first = pass.layer(node.id());
        if (style.display == ui::Display::None || style.opacity <= 0)
            return { {}, first };

        const ui::Rect frame = node.frame();
        const float x = originX + frame.x;
        const float y = originY + frame.y;
        IntRect own = pass.device(x, y, frame.width, frame.height);
        std::uint64_t key = 0;
        if (node.type() == ui::NodeType::Text)
        {
            // Lines may run past the box, and glyphs past their line.
            const ui::Rect content = node.contentBox();
            const float margin = style.text.fontSize;
            for (const ui::TextLine& line : pass.surface.textLayout(node.id()).lines)
            {
                float left = x + content.x;
                if (style.text.textAlign == ui::TextAlign::Center)
                    left += (content.width - line.width) / 2;
                else if (style.text.textAlign == ui::TextAlign::Right)
                    left += content.width - line.width;
                own = own.united(pass.device(left - margin / 2, y + content.y + line.top - margin, line.width + margin,
                                             line.height + margin * 2));
            }
        }
        else if (node.type() == ui::NodeType::Scroll)
        {
            // Its scroll indicators follow the content's size.
            const ui::Size content = pass.surface.contentSize(node.id());
            key = mix(mix(1, bits(content.width)), bits(content.height));
        }
        own = own.intersected(clip);

        IntRect childClip = clip;
        if (style.overflow != ui::Overflow::Visible || node.type() == ui::NodeType::Scroll)
        {
            const ui::Edges<float>& border = style.borderWidth;
            childClip =
                clip.intersected(pass.device(x + border.left, y + border.top, frame.width - border.left - border.right,
                                             frame.height - border.top - border.bottom));
        }
        IntRect extent = own;
        int last = first;
        const ui::Point scroll = node.scrollOffset();
        for (const ui::Node* child : node.stackedChildren())
        {
            const Visited visited = visit(pass, *child, x - scroll.x, y - scroll.y, childClip);
            extent = extent.united(visited.extent);
            last = std::max(last, visited.last);
        }

        auto [found, inserted] = records.try_emplace(node.id());
        Record& record = found->second;
        if (inserted)
            pass.add(pass.invalidated(node.id()) ? extent : own, first, last);
        else if (pass.invalidated(node.id()))
        {
            pass.add(record.extent, std::min(first, record.first), std::max(last, record.last));
            pass.add(extent, first, last);
        }
        else if (record.own != own || record.key != key || record.box.x != x || record.box.y != y
                 || record.box.width != frame.width || record.box.height != frame.height)
        {
            // Moving by a fraction of a pixel changes its edges too.
            pass.add(record.own, std::min(first, record.first), std::max(last, record.last));
            pass.add(own, first, last);
        }
        record = { { x, y, frame.width, frame.height }, own, extent, key, passes, first, last };
        return { extent, last };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
