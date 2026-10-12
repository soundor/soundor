#include "render/AnimationRenderer.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        struct CacheBudgetExceeded
        {
        };
        constexpr std::uint64_t maxCacheBytes = 64ULL * 1024 * 1024;
        constexpr int maxCacheSide = 16384;
        IntRect pixels(ui::Rect box, float scale)
        {
            constexpr double limit = 536870911;
            const auto floor = [limit](double value)
            { return static_cast<int>(std::clamp(std::floor(value), -limit, limit)); };
            const auto ceil = [limit](double value)
            { return static_cast<int>(std::clamp(std::ceil(value), -limit, limit)); };
            const int x = floor(static_cast<double>(box.x) * scale - 2);
            const int y = floor(static_cast<double>(box.y) * scale - 2);
            return { x, y, ceil((static_cast<double>(box.x) + box.width) * scale + 2) - x,
                     ceil((static_cast<double>(box.y) + box.height) * scale + 2) - y };
        }
        Transform scaled(const Transform& transform, float scale)
        {
            Transform result = transform;
            result.e *= scale;
            result.f *= scale;
            return result;
        }
        bool gpuCanvas(const ui::Node& node, const gpu::Device* device)
        {
            const auto* canvas = node.canvas();
            return device != nullptr && canvas != nullptr && canvas->gpuImage != nullptr
                   && canvas->gpuImage->device() == device && canvas->gpuImage->width() > 0
                   && canvas->gpuImage->height() > 0;
        }
        bool isolated(const ui::Node& node, const gpu::Device* device)
        {
            const ui::Style& style = node.presentedStyle();
            return node.hasPresentation() || style.transform.count != 0 || style.opacity < 1
                   || style.overflow != ui::Overflow::Visible || node.type() == ui::NodeType::Scroll
                   || gpuCanvas(node, device);
        }
        bool ancestorOf(ui::Surface& surface, ui::NodeId ancestor, const ui::Node& node)
        {
            for (const ui::Node* parent = &node; parent != nullptr; parent = parent->parent())
                if (parent->id() == ancestor)
                    return true;
            return surface.find(ancestor) == nullptr; // a removed node can change old content
        }
    } // namespace

    bool AnimationRenderer::needed(const ui::Node& node)
    {
        if (node.hasPresentation() || node.style().transform.count != 0)
            return true;
        return std::ranges::any_of(node.children(), [](const ui::Node* child) { return needed(*child); });
    }

    AnimationRenderer::Group& AnimationRenderer::build(ui::Surface& surface, const ui::Node& root, double seconds,
                                                       const gpu::Device* device,
                                                       const ui::Surface::Invalidation& invalidation,
                                                       FrameStatistics& statistics)
    {
        auto& slot = groups[root.id()];
        if (! slot)
            slot = std::make_unique<Group>();
        Group& group = *slot;
        group.used = generation;
        const float scale = surface.scale();
        const ui::Rect rootBox = root.frame();
        bool dirty = ! group.initialized || invalidation.everything;
        if (group.style != root.style())
        {
            ui::Style before = group.style, after = root.style();
            before.opacity = after.opacity = 1;
            before.transform = after.transform = {};
            dirty = dirty || before != after;
            group.style = root.style();
        }
        for (const auto id : invalidation.nodes)
            if (ancestorOf(surface, id, root) && (id != root.id() || ! gpuCanvas(root, device)))
                dirty = true;

        auto& holes = group.nextHoles;
        auto& ids = group.nextIds;
        holes.clear();
        ids.clear();
        auto& painting = group.painting;
        painting.clear();
        painting.emplace_back();
        const auto inverse = surface.visualTransform(root.id()).inverse();
        const Transform logicalToPixels { scale, 0, 0, scale, 0, 0 };
        const Transform pixelsToLogical { 1 / scale, 0, 0, 1 / scale, 0, 0 };
        const IntRect viewport { 0, 0, static_cast<int>(std::lround(surface.size().width * scale)),
                                 static_cast<int>(std::lround(surface.size().height * scale)) };
        const IntRect visible =
            inverse ? (logicalToPixels * *inverse * pixelsToLogical).mapBounds(viewport) : IntRect {};
        IntRect extent = pixels({ 0, 0, rootBox.width, rootBox.height }, scale);
        const auto oversized = [](const IntRect& rect)
        {
            return rect.width > maxCacheSide || rect.height > maxCacheSide
                   || static_cast<std::uint64_t>(rect.area()) * 4 > maxCacheBytes;
        };
        if (oversized(extent))
            extent = extent.intersected(visible);
        const auto expand = [&](const IntRect& candidate)
        {
            const IntRect shown = candidate.intersected(visible);
            if (shown.empty())
                return;
            const IntRect combined = extent.united(shown);
            extent = oversized(combined) ? extent.intersected(visible).united(shown) : combined;
        };
        const auto walk = [&](auto&& self, const ui::Node& node, const Transform& parent, bool first) -> void
        {
            const auto& style = node.presentedStyle();
            if (style.display == ui::Display::None)
                return;
            const ui::Rect box = node.frame();
            const Transform local = first ? Transform {} : parent * Transform::translate(box.x, box.y);
            if (! first && isolated(node, device))
            {
                Group& child = build(surface, node, seconds, device, invalidation, statistics);
                const Transform placement = local * style.transform.transform(box.width, box.height);
                expand(scaled(placement, scale).mapBounds(child.extent));
                holes.push_back({ node.id(), scaled(placement, scale), false });
                ids.push_back(node.id());
                painting.emplace_back();
                return;
            }
            IntRect own = scaled(local, scale).mapBounds(pixels({ 0, 0, box.width, box.height }, scale));
            if (node.type() == ui::NodeType::Text)
            {
                const auto content = node.contentBox();
                const float margin = style.text.fontSize;
                for (const auto& line : surface.textLayout(node.id()).lines)
                {
                    float left = content.x;
                    if (style.text.textAlign == ui::TextAlign::Center)
                        left += (content.width - line.width) / 2;
                    else if (style.text.textAlign == ui::TextAlign::Right)
                        left += content.width - line.width;
                    own = own.united(scaled(local, scale)
                                         .mapBounds(pixels({ left - margin / 2, content.y + line.top - margin,
                                                             line.width + margin, line.height + margin * 2 },
                                                           scale)));
                }
            }
            expand(own);
            const auto& border = style.borderWidth;
            const bool bordered = style.borderColor.visible()
                                  && (border.top > 0 || border.right > 0 || border.bottom > 0 || border.left > 0);
            if (style.backgroundColor.visible()
                || (node.type() != ui::NodeType::View && node.type() != ui::NodeType::Scroll
                    && ! gpuCanvas(node, device)))
                painting.back() = painting.back().united(own);
            const auto found = group.layout.find(node.id());
            if (found == group.layout.end() || found->second.first != box)
                dirty = true;
            group.layout[node.id()] = { box, generation };
            if (std::ranges::find(invalidation.nodes, node.id()) != invalidation.nodes.end()
                && ! gpuCanvas(node, device))
                dirty = true;
            if (first && gpuCanvas(node, device))
            {
                holes.push_back({ node.id(), {}, true });
                ids.push_back(node.id());
                painting.emplace_back();
            }
            const auto scroll = node.scrollOffset();
            const Transform children = local * Transform::translate(-scroll.x, -scroll.y);
            for (const ui::Node* child : node.stackedChildren())
                self(self, *child, children, false);
            if (bordered || node.type() == ui::NodeType::Scroll)
                painting.back() = painting.back().united(own);
        };
        walk(walk, root, {}, true);
        // Keep space already reserved during nested movement, avoiding a
        // resize/allocation for every growing or shrinking intermediate frame.
        if (group.initialized)
        {
            const IntRect reserved = extent.united(group.extent);
            if (! oversized(reserved))
                extent = reserved;
        }
        if (extent.empty())
            extent = { 0, 0, 1, 1 };
        if (oversized(extent))
            throw CacheBudgetExceeded {};
        // Reserve one composition target as well as the CPU source pixels.
        std::uint64_t projected = static_cast<std::uint64_t>(extent.area()) * 4;
        for (const IntRect& paint : painting)
            projected += static_cast<std::uint64_t>(paint.intersected(extent).area()) * 4;
        if (cachedBytes - group.cacheBytes + projected > maxCacheBytes)
            throw CacheBudgetExceeded {};
        cachedBytes = cachedBytes - group.cacheBytes + projected;
        group.cacheBytes = projected;
        if (group.extent != extent || group.holes != ids)
            dirty = true;
        group.extent = extent;
        group.holes = ids;
        std::erase_if(group.layout, [&](const auto& entry) { return entry.second.second != generation; });
        group.segments.resize(holes.size() + 1);
        Frame& content = group.frame;
        content.width = extent.width;
        content.height = extent.height;
        content.scale = scale;
        content.layers.clear();
        content.damage.clear();
        content.statistics = {};
        const Transform shift = Transform::translate(-static_cast<float>(extent.x), -static_cast<float>(extent.y));
        for (std::size_t i = 0; i < group.segments.size(); ++i)
        {
            Segment& segment = group.segments[i];
            const IntRect area = painting[i].intersected(extent);
            const bool moved = segment.bounds != area;
            segment.bounds = area;
            // A resized segment must not retain a larger old allocation outside
            // the reservation budget. Presentation-only frames keep its size.
            if (segment.pixels.width() != area.width || segment.pixels.height() != area.height)
                segment.pixels = RasterSurface {};
            const bool resize = segment.pixels.resize(area.width, area.height);
            statistics.cachedRasterBytes += static_cast<std::uint64_t>(segment.pixels.width())
                                            * static_cast<std::uint64_t>(segment.pixels.height()) * 4;
            Region damage;
            if (! area.empty() && (dirty || resize || moved))
            {
                const ui::Renderer::Layering layering { group.holes,
                                                        static_cast<int>(i),
                                                        root.id(),
                                                        static_cast<float>(area.x) / scale,
                                                        static_cast<float>(area.y) / scale,
                                                        true };
                painter.render(surface, segment.pixels.bitmap(), seconds, nullptr, &layering);
                damage.add({ 0, 0, area.width, area.height });
                ++statistics.layersRasterized;
                statistics.pixelsRasterized += damage.area();
            }
            if (! area.empty())
                content.layers.push_back({ .id = segment.id,
                                           .bounds = { area.x - extent.x, area.y - extent.y, area.width, area.height },
                                           .content = RasterContent { &segment.pixels, damage } });
            if (i >= holes.size())
                continue;
            const Hole& hole = holes[i];
            const ui::Node& node = *surface.find(hole.node);
            Layer layer;
            if (hole.gpu)
            {
                const auto buffer = surface.canvasBuffer(node.id());
                const auto& image = *buffer->gpuImage;
                const ui::Rect box = node.contentBox();
                layer.id = group.gpuId;
                layer.bounds = { 0, 0, image.width(), image.height() };
                layer.transform = shift
                                  * Transform { box.width * scale / static_cast<float>(image.width()),
                                                0,
                                                0,
                                                box.height * scale / static_cast<float>(image.height()),
                                                box.x * scale,
                                                box.y * scale };
                layer.content = GpuContent { buffer->gpuImage, std::exchange(buffer->gpuDrawn, false) };
                const auto& radii = node.style().borderRadius;
                layer.clip = Clip { -static_cast<float>(extent.x),
                                    -static_cast<float>(extent.y),
                                    rootBox.width * scale,
                                    rootBox.height * scale,
                                    { radii.topLeft * scale, radii.topRight * scale, radii.bottomRight * scale,
                                      radii.bottomLeft * scale } };
                ++statistics.gpuLayers;
            }
            else
            {
                Group& child = *groups.at(hole.node);
                layer.id = child.id;
                layer.bounds = { 0, 0, child.frame.width, child.frame.height };
                layer.transform =
                    shift * hole.transform
                    * Transform::translate(static_cast<float>(child.extent.x), static_cast<float>(child.extent.y));
                layer.opacity = node.presentedStyle().opacity;
                layer.content = GroupContent { &child.frame };
                const auto& style = root.presentedStyle();
                if (style.overflow != ui::Overflow::Visible || root.type() == ui::NodeType::Scroll)
                {
                    const auto& border = style.borderWidth;
                    layer.clip = Clip {
                        border.left * scale - static_cast<float>(extent.x),
                        border.top * scale - static_cast<float>(extent.y),
                        (rootBox.width - border.left - border.right) * scale,
                        (rootBox.height - border.top - border.bottom) * scale,
                        { std::max(0.f, style.borderRadius.topLeft - std::max(border.left, border.top)) * scale,
                          std::max(0.f, style.borderRadius.topRight - std::max(border.right, border.top)) * scale,
                          std::max(0.f, style.borderRadius.bottomRight - std::max(border.right, border.bottom)) * scale,
                          std::max(0.f, style.borderRadius.bottomLeft - std::max(border.left, border.bottom)) * scale }
                    };
                }
            }
            content.layers.push_back(std::move(layer));
        }
        group.initialized = true;
        return group;
    }

    const Frame& AnimationRenderer::update(ui::Surface& surface, double seconds, const gpu::Device* device)
    {
        surface.layout();
        const bool changedDevice = device != previousDevice;
        int readbacks = 0;
        for (const auto id : surface.canvases())
        {
            const auto canvas = surface.canvasBuffer(id);
            if (changedDevice && canvas->gpuImage && canvas->gpuImage->device() != device)
                canvas->gpuDrawn = true;
            if (canvas->gpuImage == nullptr || canvas->gpuImage->device() == device || ! canvas->gpuDrawn)
                continue;
            canvas->gpuDrawn = false;
            if (canvas->gpuImage->read(canvas->pixels))
            {
                ++readbacks;
                surface.invalidate(id);
            }
        }
        const auto invalid = surface.takeInvalidation();
        if (changedDevice)
            groups.clear();
        std::erase_if(groups, [&](const auto& entry) { return ! surface.isConnected(entry.first); });
        cachedBytes = 0;
        for (const auto& entry : groups)
            cachedBytes += entry.second->cacheBytes;
        previousDevice = device;
        if (invalid.everything || ! invalid.nodes.empty() || changedDevice)
            budgetFallback = false;
        ++generation;
        frame.width = static_cast<int>(std::lround(surface.size().width * surface.scale()));
        frame.height = static_cast<int>(std::lround(surface.size().height * surface.scale()));
        frame.scale = surface.scale();
        frame.statistics = {};
        frame.statistics.gpuReadbacks = readbacks;
        frame.damage.clear();
        frame.layers.clear();
        if (! budgetFallback)
        {
            try
            {
                for (const ui::Node* root : { &surface.root(), &surface.overlay() })
                {
                    Group& group = build(surface, *root, seconds, device, invalid, frame.statistics);
                    const auto box = root->frame();
                    Layer layer;
                    layer.id = group.id;
                    layer.bounds = { 0, 0, group.frame.width, group.frame.height };
                    layer.transform =
                        scaled(root->presentedStyle().transform.transform(box.width, box.height), surface.scale())
                        * Transform::translate(static_cast<float>(group.extent.x), static_cast<float>(group.extent.y));
                    layer.opacity = root->presentedStyle().opacity;
                    layer.content = GroupContent { &group.frame };
                    if (! group.frame.layers.empty())
                        frame.layers.push_back(std::move(layer));
                }
            }
            catch (const CacheBudgetExceeded&)
            {
                groups.clear();
                cachedBytes = 0;
                budgetFallback = true;
                for (const auto id : surface.canvases())
                    if (surface.canvasBuffer(id)->gpuImage)
                        surface.canvasBuffer(id)->gpuDrawn = true;
            }
        }
        if (budgetFallback)
        {
            frame.layers.clear();
            frame.statistics = {};
            frame.statistics.gpuReadbacks = readbacks;
            for (const auto id : surface.canvases())
            {
                const auto canvas = surface.canvasBuffer(id);
                if (! canvas->gpuImage || ! canvas->gpuDrawn)
                    continue;
                canvas->gpuDrawn = false;
                if (canvas->gpuImage->read(canvas->pixels))
                    ++frame.statistics.gpuReadbacks;
            }
            fallback.resize(frame.width, frame.height);
            painter.render(surface, fallback.bitmap(), seconds);
            Region changed;
            changed.add(frame.bounds());
            frame.layers.push_back(
                { .id = fallbackId, .bounds = frame.bounds(), .content = RasterContent { &fallback, changed } });
            frame.statistics.layersRasterized = 1;
            frame.statistics.pixelsRasterized = frame.bounds().area();
            frame.statistics.cachedRasterBytes = static_cast<std::uint64_t>(frame.bounds().area()) * 4;
        }
        std::erase_if(groups, [&](const auto& entry) { return entry.second->used != generation; });
        return frame;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
