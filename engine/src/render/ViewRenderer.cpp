#include "render/ViewRenderer.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <unordered_map>
#include <utility>
#include <vector>

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

        // A rectangle with a circular radius at each corner (top left, top
        // right, bottom right, bottom left), in logical pixels: what a
        // layer's clip can be. Not `exact` where a corner is elliptical (a
        // clip inside borders of different widths): its radii then bound
        // the corners, and it can only be left out, never be a layer's clip.
        struct Rounded
        {
            Box box;
            std::array<float, 4> radii {};
            bool exact = true;

            [[nodiscard]] bool rounded() const noexcept
            {
                return std::ranges::any_of(radii, [](float radius) { return radius > 0; });
            }

            // Radii that overlap are scaled down together, as CSS and Skia do.
            void normalize() noexcept
            {
                const float width = box.right - box.left;
                const float height = box.bottom - box.top;
                float factor = 1;
                const auto fit = [&](float side, float first, float second)
                {
                    if (first + second > side && first + second > 0)
                        factor = std::min(factor, std::max(0.0f, side) / (first + second));
                };
                fit(width, radii[0], radii[1]);
                fit(height, radii[1], radii[2]);
                fit(width, radii[3], radii[2]);
                fit(height, radii[0], radii[3]);
                if (factor < 1)
                    for (float& radius : radii)
                        radius *= factor;
            }

            // Whether `inner`, inside the box, stays out of the corners'
            // squares, where the rounding cuts.
            [[nodiscard]] bool avoidsCorners(const Box& inner) const noexcept
            {
                const auto overlaps = [&](const Box& corner)
                {
                    return inner.left < corner.right && inner.right > corner.left && inner.top < corner.bottom
                           && inner.bottom > corner.top;
                };
                const Box corners[4] = {
                    { box.left, box.top, box.left + radii[0], box.top + radii[0] },
                    { box.right - radii[1], box.top, box.right, box.top + radii[1] },
                    { box.right - radii[2], box.bottom - radii[2], box.right, box.bottom },
                    { box.left, box.bottom - radii[3], box.left + radii[3], box.bottom },
                };
                for (std::size_t corner = 0; corner < 4; ++corner)
                    if (radii[corner] > 0 && overlaps(corners[corner]))
                        return false;
                return true;
            }
        };

        // A node's own rounded rectangle, normalized.
        Rounded roundedBox(const Box& box, const ui::Corners& radii)
        {
            Rounded own { box, { radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft } };
            own.normalize();
            return own;
        }

        // Where a view clips its children: inside its borders, its radii
        // less the borders' widths (ui::Renderer's clip).
        Rounded clipBox(const Box& inner, const ui::Corners& radii, const ui::Edges<float>& border)
        {
            Rounded clip { inner };
            const auto corner = [&](std::size_t index, float radius, float sideX, float sideY)
            {
                const float x = std::max(0.0f, radius - sideX);
                const float y = std::max(0.0f, radius - sideY);
                // Skia draws a corner with either radius 0 square.
                if (x <= 0 || y <= 0)
                    return;
                clip.radii[index] = std::max(x, y);
                clip.exact = clip.exact && x == y;
            };
            corner(0, radii.topLeft, border.left, border.top);
            corner(1, radii.topRight, border.right, border.top);
            corner(2, radii.bottomRight, border.right, border.bottom);
            corner(3, radii.bottomLeft, border.left, border.bottom);
            clip.normalize();
            return clip;
        }

        // Where both show, if one rounded rectangle is all of it.
        std::optional<Rounded> intersect(const Rounded& a, const Rounded& b)
        {
            const auto same = [](const Box& x, const Box& y)
            {
                constexpr float epsilon = 1e-3f;
                return std::abs(x.left - y.left) < epsilon && std::abs(x.top - y.top) < epsilon
                       && std::abs(x.right - y.right) < epsilon && std::abs(x.bottom - y.bottom) < epsilon;
            };
            if (same(a.box, b.box) && a.exact && b.exact)
            {
                // The same box: each corner is the rounder one's.
                Rounded both { b.box };
                for (std::size_t corner = 0; corner < 4; ++corner)
                    both.radii[corner] = std::max(a.radii[corner], b.radii[corner]);
                return both;
            }
            if (b.exact && a.box.contains(b.box) && a.avoidsCorners(b.box))
                return b;
            if (a.exact && b.box.contains(a.box) && b.avoidsCorners(a.box))
                return a;
            if (! a.rounded() && ! b.rounded())
                return Rounded { a.box.intersected(b.box) };
            return std::nullopt;
        }

        // What the ancestors clip a node to: each clipping ancestor's
        // rounded rectangle, the innermost last.
        using AncestorClip = std::vector<Rounded>;

        // Walks the tree in paint order, as ui::Renderer draws it, finding
        // the GPU canvases a compositor on `device` can show as layers.
        struct Planner
        {
            ui::Surface& surface;
            const gpu::Device* device;
            float scale;
            std::vector<std::pair<ui::NodeId, Layer>> found;
            // Where each CPU layer paints (device pixels): what paints
            // before the first promoted canvas, between it and the next, …
            std::vector<Region> painted = std::vector<Region>(1);
            // The layer each visible node starts painting in.
            std::unordered_map<ui::NodeId, int> layerOf;

            // A node's box, out to whole device pixels with a margin for
            // antialiasing, as painted in the current layer.
            void paint(float x, float y, float width, float height)
            {
                constexpr float margin = 2;
                const auto left = static_cast<int>(std::floor((x * scale) - margin));
                const auto top = static_cast<int>(std::floor((y * scale) - margin));
                const auto right = static_cast<int>(std::ceil(((x + width) * scale) + margin));
                const auto bottom = static_cast<int>(std::ceil(((y + height) * scale) + margin));
                painted.back().add({ left, top, right - left, bottom - top });
            }

            void walkChildren(const ui::Node& node, float x, float y, float opacity, const AncestorClip& clip)
            {
                const ui::Point scrolled = node.scrollOffset();
                for (const ui::Node* child : node.stackedChildren())
                    walk(*child, x - scrolled.x, y - scrolled.y, opacity, clip);
            }

            void walk(const ui::Node& node, float originX, float originY, float opacity, const AncestorClip& clip)
            {
                const ui::Style& style = node.presentedStyle();
                if (style.display == ui::Display::None || style.opacity <= 0)
                    return;
                const ui::Rect frame = node.frame();
                const float x = originX + frame.x;
                const float y = originY + frame.y;
                const float seen = opacity * std::min(style.opacity, 1.0f);
                layerOf[node.id()] = static_cast<int>(painted.size()) - 1;
                const ui::Edges<float>& border = style.borderWidth;
                const bool bordered = (border.top > 0 || border.right > 0 || border.bottom > 0 || border.left > 0)
                                      && style.borderColor.visible();
                const bool outlined = style.outlined();
                const bool shadowed = style.shadowed();
                const ui::Edges<float> ink = style.inkOverflow();
                // What it draws itself (a plain view draws nothing), its
                // outline and shadows outside its box.
                const auto paintOwn = [&] {
                    paint(x - ink.left, y - ink.top, frame.width + ink.left + ink.right,
                          frame.height + ink.top + ink.bottom);
                };
                if (style.backgroundColor.visible() || bordered || outlined || shadowed
                    || node.type() != ui::NodeType::View)
                    paintOwn();
                const std::size_t layers = painted.size();
                if (node.type() == ui::NodeType::Canvas)
                    canvas(node, x, y, seen, clip);
                if (node.children().empty())
                    return;
                if (style.clips())
                {
                    const Box box { x + border.left, y + border.top, x + frame.width - border.right,
                                    y + frame.height - border.bottom };
                    AncestorClip inner = clip;
                    inner.push_back(clipBox(box, style.borderRadius, border));
                    walkChildren(node, x, y, seen, inner);
                }
                else
                    walkChildren(node, x, y, seen, clip);
                // Its border, outline and scroll indicators paint after its
                // children: in a later layer when a canvas among them is
                // promoted.
                if (painted.size() != layers && (bordered || outlined || node.scrolls()))
                    paintOwn();
            }

            void canvas(const ui::Node& node, float x, float y, float opacity, const AncestorClip& clip)
            {
                const ui::CanvasBuffer* buffer = node.canvas();
                if (device == nullptr || buffer == nullptr || buffer->gpuImage == nullptr
                    || buffer->gpuImage->device() != device || buffer->gpuImage->width() <= 0
                    || buffer->gpuImage->height() <= 0)
                    return;
                const ui::Rect frame = node.frame();
                // Its own rounded box, then each clipping ancestor's: one an
                // ancestor's rounded corners do not reach is left out.
                std::optional<Rounded> visible =
                    roundedBox({ x, y, x + frame.width, y + frame.height }, node.style().borderRadius);
                for (auto ancestor = clip.rbegin(); visible && ancestor != clip.rend(); ++ancestor)
                    visible = intersect(*visible, *ancestor);
                // One rounded rectangle is all a layer's clip can be: the
                // canvas is read back and drawn on the CPU otherwise.
                if (! visible || ! visible->exact)
                    return;
                const Box& cut = visible->box;
                const Clip shown { cut.left * scale,
                                   cut.top * scale,
                                   std::max(0.0f, cut.right - cut.left) * scale,
                                   std::max(0.0f, cut.bottom - cut.top) * scale,
                                   { visible->radii[0] * scale, visible->radii[1] * scale, visible->radii[2] * scale,
                                     visible->radii[3] * scale } };
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
                painted.emplace_back();
            }
        };
    } // namespace

    int ViewRenderer::readBackCanvases(ui::Surface& surface, const gpu::Device* drawingDevice)
    {
        int read = 0;
        for (const ui::NodeId id : surface.canvases())
        {
            const auto buffer = surface.canvasBuffer(id);
            flushCanvas(*buffer);
            if (buffer->drawingSurface && buffer->gpuImage && buffer->gpuImage->device() == drawingDevice)
                continue;
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

    void ViewRenderer::readBackAllCanvases(ui::Surface& surface)
    {
        for (const ui::NodeId id : surface.canvases())
        {
            const auto buffer = surface.canvasBuffer(id);
            flushCanvas(*buffer);
            if (buffer->gpuImage != nullptr && buffer->gpuImage->read(buffer->pixels))
                surface.invalidate(id);
        }
    }

    void ViewRenderer::promote(ui::Surface& surface, const gpu::Device* gpuDevice)
    {
        for (const auto id : surface.canvases())
            flushCanvas(*surface.canvasBuffer(id));
        Planner planner { surface, gpuDevice, surface.scale(), {}, std::vector<Region>(1) };
        planner.walk(surface.root(), 0, 0, 1, {});
        planner.walk(surface.overlay(), 0, 0, 1, {});

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
        painting = std::move(planner.painted);
        layerOf = std::move(planner.layerOf);
    }

    const Frame& ViewRenderer::update(ui::Surface& surface, double seconds, const gpu::Device* gpuDevice)
    {
        const bool useAnimations =
            AnimationRenderer::needed(surface.root()) || AnimationRenderer::needed(surface.overlay());
        if (useAnimations)
        {
            wasAnimated = true;
            const auto& content = animated.update(surface, seconds, gpuDevice);
#if SOUNDOR_DEVTOOLS
            return debugOverlay.append(content, surface, painter);
#else
            return content;
#endif
        }
        if (std::exchange(wasAnimated, false))
        {
            damage.reset();
            for (const auto id : surface.canvases())
                if (surface.canvasBuffer(id)->gpuImage)
                    surface.canvasBuffer(id)->gpuDrawn = true;
            surface.invalidate(surface.root().id());
            surface.invalidate(surface.overlay().id());
        }
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
        frame.statistics.gpuReadbacks = readBackCanvases(surface, painter.usesGpu(gpuDevice) ? gpuDevice : nullptr);
        frame.statistics.gpuLayers = static_cast<int>(promoted.size());

        ui::Surface::Invalidation invalid = surface.takeInvalidation();
        // Other holes: every CPU layer is cut differently.
        if (holes != wereHoles || segments.size() != holes.size() + 1)
        {
            invalid.everything = true;
            segments.resize(holes.size() + 1);
        }
        for (Segment& segment : segments)
            if (painter.prepare(segment.pixels, width, height, gpuDevice))
                invalid.everything = true;

        frame.width = width;
        frame.height = height;
        frame.scale = scale;
        const IntRect bounds { 0, 0, width, height };
        // What changed, per CPU layer: a change above a canvas leaves the
        // layer below it alone, and the other way round.
        std::vector<Region> damages(segments.size());
        if (invalid.everything || ! invalid.nodes.empty() || surface.revision() != revision)
            damages = damage.update(surface, invalid, bounds, layerOf, static_cast<int>(segments.size()));
        revision = surface.revision();
        Region changed;
        for (std::size_t i = 0; i < segments.size(); ++i)
        {
            Segment& segment = segments[i];
            const Region& redraw = damages[i];
            changed.add(redraw);
            segment.painted = painting[i];
            if (redraw.empty())
                continue;
            const ui::Renderer::Layering layering { holes, static_cast<int>(i) };
            painter.render(surface, segment.pixels, seconds, &redraw, holes.empty() ? nullptr : &layering);
            ++frame.statistics.layersRasterized;
            frame.statistics.pixelsRasterized += redraw.area();
        }

        frame.layers.clear();
        Region damaged = changed;
        for (std::size_t i = 0; i < segments.size(); ++i)
        {
            // A layer that paints nothing is left out (most often the one
            // above a canvas with nothing over it).
            if (holes.empty() || ! segments[i].painted.empty())
            {
                Layer layer = segments[i].pixels.content(damages[i]);
                layer.id = segments[i].id;
                layer.bounds = bounds;
                frame.layers.push_back(std::move(layer));
            }
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
#if SOUNDOR_DEVTOOLS
        return debugOverlay.append(frame, surface, painter);
#else
        return frame;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
