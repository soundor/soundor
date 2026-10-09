#include "render/ViewRenderer.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        // A rectangle in logical pixels, for clips.
        struct Box
        {
            float left = 0;
            float top = 0;
            float right = 0;
            float bottom = 0;

            [[nodiscard]] bool contains(const Box& other) const noexcept
            {
                return left <= other.left && top <= other.top && right >= other.right && bottom >= other.bottom;
            }
            [[nodiscard]] Box intersected(const Box& other) const noexcept
            {
                return { std::max(left, other.left), std::max(top, other.top), std::min(right, other.right),
                         std::min(bottom, other.bottom) };
            }
        };

        // What the ancestors clip a node to: a rectangle, rounded or not.
        struct AncestorClip
        {
            Box box;
            bool rounded = false;
        };

        bool hasRadius(const ui::Corners& radii) noexcept
        {
            return radii.topLeft > 0 || radii.topRight > 0 || radii.bottomRight > 0 || radii.bottomLeft > 0;
        }

        // Walks the tree in paint order, as ui::Renderer draws it, finding
        // the GPU canvases a compositor on `device` can show as layers.
        struct Planner
        {
            ui::Surface& surface;
            const gpu::Device* device;
            float scale;
            std::vector<std::pair<ui::NodeId, Layer>> found;

            void walk(const ui::Node& node, float originX, float originY, float opacity,
                      const std::optional<AncestorClip>& clip)
            {
                const ui::Style& style = node.style();
                if (style.display == ui::Display::None || style.opacity <= 0)
                    return;
                const ui::Rect frame = node.frame();
                const float x = originX + frame.x;
                const float y = originY + frame.y;
                const float seen = opacity * std::min(style.opacity, 1.0f);
                if (node.type() == ui::NodeType::Canvas)
                    canvas(node, x, y, seen, clip);
                if (node.children().empty())
                    return;
                std::optional<AncestorClip> inner = clip;
                if (style.overflow != ui::Overflow::Visible || node.type() == ui::NodeType::Scroll)
                {
                    const ui::Edges<float>& border = style.borderWidth;
                    const Box box { x + border.left, y + border.top, x + frame.width - border.right,
                                    y + frame.height - border.bottom };
                    const bool rounded = hasRadius(style.borderRadius);
                    inner = clip ? AncestorClip { clip->box.intersected(box), clip->rounded || rounded }
                                 : AncestorClip { box, rounded };
                }
                const ui::Point scrolled = node.scrollOffset();
                for (const ui::Node* child : node.stackedChildren())
                    walk(*child, x - scrolled.x, y - scrolled.y, seen, inner);
            }

            void canvas(const ui::Node& node, float x, float y, float opacity, const std::optional<AncestorClip>& clip)
            {
                const ui::CanvasBuffer* buffer = node.canvas();
                if (device == nullptr || buffer == nullptr || buffer->gpuImage == nullptr
                    || buffer->gpuImage->device() != device || buffer->gpuImage->width() <= 0
                    || buffer->gpuImage->height() <= 0)
                    return;
                const ui::Rect frame = node.frame();
                const ui::Corners& radii = node.style().borderRadius;
                const Box own { x, y, x + frame.width, y + frame.height };
                Clip shown { own.left * scale,
                             own.top * scale,
                             frame.width * scale,
                             frame.height * scale,
                             { radii.topLeft * scale, radii.topRight * scale, radii.bottomRight * scale,
                               radii.bottomLeft * scale } };
                if (clip && ! clip->box.contains(own))
                {
                    // One rounded rectangle is all a layer's clip can be.
                    if (clip->rounded || hasRadius(radii))
                        return;
                    const Box cut = clip->box.intersected(own);
                    shown = { cut.left * scale,
                              cut.top * scale,
                              std::max(0.0f, cut.right - cut.left) * scale,
                              std::max(0.0f, cut.bottom - cut.top) * scale,
                              {} };
                }
                // The image stretched over the content box, like the CPU's.
                const ui::Rect content = node.contentBox();
                const GpuImage& image = *buffer->gpuImage;
                Layer layer;
                layer.bounds = { 0, 0, image.width(), image.height() };
                layer.transform = { content.width * scale / static_cast<float>(image.width()),
                                    0,
                                    0,
                                    content.height * scale / static_cast<float>(image.height()),
                                    (x + content.x) * scale,
                                    (y + content.y) * scale };
                layer.opacity = opacity;
                layer.clip = shown;
                found.emplace_back(node.id(), std::move(layer));
            }
        };
    } // namespace

    int ViewRenderer::readBackCanvases(ui::Surface& surface)
    {
        int read = 0;
        for (const ui::NodeId id : surface.canvases())
        {
            const auto buffer = surface.canvasBuffer(id);
            if (buffer->gpuImage == nullptr || ! buffer->gpuDrawn)
                continue;
            buffer->gpuDrawn = false;
            if (buffer->gpuImage->read(buffer->pixels))
            {
                ++read;
                surface.invalidate(id);
            }
        }
        return read;
    }

    void ViewRenderer::promote(ui::Surface& surface, const gpu::Device* gpuDevice)
    {
        Planner planner { surface, gpuDevice, surface.scale(), {} };
        planner.walk(surface.root(), 0, 0, 1, std::nullopt);
        planner.walk(surface.overlay(), 0, 0, 1, std::nullopt);

        std::vector<Promoted> now;
        for (auto& [node, layer] : planner.found)
        {
            const auto known = std::ranges::find(canvasLayers, node, &std::pair<ui::NodeId, LayerId>::first);
            layer.id = known != canvasLayers.end() ? known->second : newLayerId();
            now.push_back({ node, surface.canvasBuffer(node)->gpuImage, std::move(layer) });
        }
        canvasLayers.clear();
        for (const Promoted& canvas : now)
            canvasLayers.emplace_back(canvas.node, canvas.layer.id);
        promoted = std::move(now);
    }

    const Frame& ViewRenderer::update(ui::Surface& surface, double seconds, const gpu::Device* gpuDevice)
    {
        const float scale = surface.scale();
        const auto width = static_cast<int>(std::lround(surface.size().width * scale));
        const auto height = static_cast<int>(std::lround(surface.size().height * scale));
        // Laying out may change what is drawn (an input scrolls its caret
        // into view): before taking what changed.
        surface.layout();
        frame.statistics = {};

        // Which GPU canvases are layers of their own; the others' new
        // images (and those of canvases no longer layers) are read back.
        const std::vector<ui::NodeId> wereHoles = holes;
        promote(surface, gpuDevice);
        holes.clear();
        std::vector<bool> fresh(promoted.size(), false);
        for (std::size_t i = 0; i < promoted.size(); ++i)
        {
            holes.push_back(promoted[i].node);
            const auto buffer = surface.canvasBuffer(promoted[i].node);
            fresh[i] = std::exchange(buffer->gpuDrawn, false)
                       || std::ranges::find(wereHoles, promoted[i].node) == wereHoles.end();
        }
        for (const ui::NodeId id : wereHoles)
            if (std::ranges::find(holes, id) == holes.end() && surface.find(id) != nullptr)
                surface.canvasBuffer(id)->gpuDrawn = true; // drawn on the CPU again: needs its pixels
        frame.statistics.gpuReadbacks = readBackCanvases(surface);
        frame.statistics.gpuLayers = static_cast<int>(promoted.size());

        ui::Surface::Invalidation invalid = surface.takeInvalidation();
        // Other holes: every CPU layer is cut differently.
        if (holes != wereHoles || segments.size() != holes.size() + 1)
        {
            invalid.everything = true;
            segments.resize(holes.size() + 1);
        }
        for (Segment& segment : segments)
            if (segment.pixels.resize(width, height))
                invalid.everything = true;

        frame.width = width;
        frame.height = height;
        frame.scale = scale;
        const IntRect bounds { 0, 0, width, height };
        Region changed;
        // Nothing the layout depends on changed, nor anything drawn: no
        // need to look.
        if (invalid.everything || ! invalid.nodes.empty() || surface.revision() != revision)
            changed = damage.update(surface, invalid, bounds);
        revision = surface.revision();

        if (! changed.empty())
            for (std::size_t i = 0; i < segments.size(); ++i)
            {
                const ui::Renderer::Layering layering { holes, static_cast<int>(i) };
                painter.render(surface, segments[i].pixels.bitmap(), seconds, &changed,
                               holes.empty() ? nullptr : &layering);
                ++frame.statistics.layersRasterized;
                frame.statistics.pixelsRasterized += changed.area();
            }

        frame.layers.clear();
        Region damaged = changed;
        for (std::size_t i = 0; i < segments.size(); ++i)
        {
            frame.layers.push_back(
                { .id = segments[i].id, .bounds = bounds, .content = RasterContent { &segments[i].pixels, changed } });
            if (i < promoted.size())
            {
                Layer layer = promoted[i].layer;
                layer.content = GpuContent { promoted[i].image, fresh[i] };
                if (fresh[i])
                {
                    const IntRect area = layer.transform.mapBounds(layer.bounds);
                    damaged.add(area.intersected(bounds));
                }
                frame.layers.push_back(std::move(layer));
            }
        }
        frame.damage = std::move(damaged);
        return frame;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
