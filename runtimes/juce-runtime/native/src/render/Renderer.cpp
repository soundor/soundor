#include "render/SkiaImages.h"
#include "render/SkiaText.h"

#include <soundor/ui/Renderer.h>

#include <include/codec/SkCodec.h>
#include <include/codec/SkJpegDecoder.h>
#include <include/codec/SkPngDecoder.h>
#include <include/codec/SkWebpDecoder.h>
#include <include/core/SkCanvas.h>
#include <include/core/SkData.h>
#include <include/core/SkImage.h>
#include <include/core/SkImageInfo.h>
#include <include/core/SkPaint.h>
#include <include/core/SkPixmap.h>
#include <include/core/SkRRect.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        SkColor skColor(Color color)
        {
            return SkColorSetARGB(color.a, color.r, color.g, color.b);
        }

        SkRRect roundedRect(const SkRect& rect, const Corners& radii, const Edges<float>& inset = {})
        {
            const SkVector corners[4] = {
                { std::max(0.0f, radii.topLeft - inset.left), std::max(0.0f, radii.topLeft - inset.top) },
                { std::max(0.0f, radii.topRight - inset.right), std::max(0.0f, radii.topRight - inset.top) },
                { std::max(0.0f, radii.bottomRight - inset.right), std::max(0.0f, radii.bottomRight - inset.bottom) },
                { std::max(0.0f, radii.bottomLeft - inset.left), std::max(0.0f, radii.bottomLeft - inset.bottom) },
            };
            SkRRect rounded;
            rounded.setRectRadii(rect, corners);
            return rounded;
        }

        // Where an image of `image` size goes inside `box`.
        SkRect placeImage(Size image, const SkRect& box, ResizeMode mode)
        {
            if (image.width <= 0 || image.height <= 0)
                return box;
            const float scaleX = box.width() / image.width;
            const float scaleY = box.height() / image.height;
            float scale = 1;
            switch (mode)
            {
                case ResizeMode::Stretch:
                    return box;
                case ResizeMode::Cover:
                    scale = std::max(scaleX, scaleY);
                    break;
                case ResizeMode::Contain:
                    scale = std::min(scaleX, scaleY);
                    break;
                case ResizeMode::Center:
                    scale = std::min({ 1.0f, scaleX, scaleY });
                    break;
            }
            const float width = image.width * scale;
            const float height = image.height * scale;
            return SkRect::MakeXYWH(box.centerX() - width / 2, box.centerY() - height / 2, width, height);
        }

        // BGRA on every platform (Skia's N32 is RGBA on Apple's), as Bitmap promises.
        std::unique_ptr<SkCanvas> canvasFor(const render::Bitmap& bitmap)
        {
            const SkImageInfo info =
                SkImageInfo::Make(bitmap.width, bitmap.height, kBGRA_8888_SkColorType, kPremul_SkAlphaType);
            return SkCanvas::MakeRasterDirect(info, bitmap.pixels, bitmap.rowBytes);
        }
    } // namespace

    struct Renderer::Impl
    {
        std::shared_ptr<render::SkiaTextEngine> text = std::make_shared<render::SkiaTextEngine>();
        std::shared_ptr<render::SkiaImages> images;
        Surface* surface = nullptr;
        double seconds = 0;
        const Layering* layering = nullptr;
        // Holes passed so far in this drawing, in paint order.
        int holesPassed = 0;

        // Whether what paints now belongs to the layer being drawn.
        [[nodiscard]] bool painting() const noexcept { return layering == nullptr || holesPassed == layering->segment; }
        [[nodiscard]] bool isHole(const Node& node) const noexcept
        {
            return layering != nullptr && node.type() == NodeType::Canvas
                   && std::ranges::find(layering->holes, node.id()) != layering->holes.end();
        }
        // Where part of a view is drawn before being copied in.
        render::RasterSurface scratch;

        void draw(SkCanvas& canvas);
        void drawNode(SkCanvas& canvas, const Node& node);
        void drawText(SkCanvas& canvas, const Node& node);
        void drawImage(SkCanvas& canvas, const Node& node, const SkRRect& outer);
        void drawInput(SkCanvas& canvas, const Node& node);
        void drawCanvas(SkCanvas& canvas, const Node& node, const SkRRect& outer);
        void drawScrollIndicators(SkCanvas& canvas, const Node& node) const;
    };

    Renderer::Renderer(AssetLoader assets) : impl(std::make_unique<Impl>())
    {
        impl->images = std::make_shared<render::SkiaImages>(std::move(assets));
    }

    Renderer::~Renderer() = default;

    std::shared_ptr<TextEngine> Renderer::textEngine() const
    {
        return impl->text;
    }

    std::shared_ptr<ImageSource> Renderer::images() const
    {
        return impl->images;
    }

    void Renderer::render(Surface& surface, const render::Bitmap& target, double seconds, const render::Region* only,
                          const Layering* layering)
    {
        if (target.empty() || (only != nullptr && only->empty()))
            return;
        surface.layout();
        impl->surface = &surface;
        impl->seconds = seconds;
        impl->layering = layering;
        if (only == nullptr)
        {
            if (const auto canvas = canvasFor(target))
            {
                canvas->clear(SK_ColorTRANSPARENT);
                impl->draw(*canvas);
            }
        }
        else
        {
            // Each rectangle is drawn apart, with a margin, then copied in:
            // Skia draws what a clip cuts a little differently near the cut,
            // so the cut must fall where nothing is kept.
            constexpr int margin = 4;
            const render::IntRect all { 0, 0, target.width, target.height };
            for (const render::IntRect& rect : only->rects())
            {
                const render::IntRect inside = rect.intersected(all);
                if (inside.empty())
                    continue;
                const render::IntRect drawn = render::IntRect { inside.x - margin, inside.y - margin,
                                                                inside.width + margin * 2, inside.height + margin * 2 }
                                                  .intersected(all);
                impl->scratch.resize(drawn.width, drawn.height);
                const render::Bitmap scratch = impl->scratch.bitmap();
                std::memset(scratch.pixels, 0, scratch.rowBytes * static_cast<std::size_t>(scratch.height));
                if (const auto canvas = canvasFor(scratch))
                {
                    canvas->translate(static_cast<float>(-drawn.x), static_cast<float>(-drawn.y));
                    impl->draw(*canvas);
                }
                for (int y = inside.y; y < inside.bottom(); ++y)
                    std::memcpy(static_cast<std::uint8_t*>(target.pixels)
                                    + static_cast<std::size_t>(y) * target.rowBytes
                                    + static_cast<std::size_t>(inside.x) * 4,
                                static_cast<const std::uint8_t*>(scratch.pixels)
                                    + static_cast<std::size_t>(y - drawn.y) * scratch.rowBytes
                                    + static_cast<std::size_t>(inside.x - drawn.x) * 4,
                                static_cast<std::size_t>(inside.width) * 4);
            }
        }
        impl->surface = nullptr;
        impl->layering = nullptr;
    }

    void Renderer::Impl::draw(SkCanvas& canvas)
    {
        holesPassed = 0;
        canvas.scale(surface->scale(), surface->scale());
        // The overlay over all of the content, whatever their zIndex.
        drawNode(canvas, surface->root());
        drawNode(canvas, surface->overlay());
    }

    void Renderer::Impl::drawNode(SkCanvas& canvas, const Node& node)
    {
        const Style& style = node.style();
        if (style.display == Display::None || style.opacity <= 0)
            return;
        const Rect frame = node.frame();
        canvas.save();
        canvas.translate(frame.x, frame.y);
        const SkRect box = SkRect::MakeWH(frame.width, frame.height);
        const Edges<float>& border = style.borderWidth;
        const bool bordered =
            (border.top > 0 || border.right > 0 || border.bottom > 0 || border.left > 0) && style.borderColor.visible();
        // Opacity applies to the node and everything in it as one picture,
        // drawn into a layer. A view that paints a single shape (its
        // background: no border, nothing in it) looks the same with the
        // opacity in its paint, without a layer. A leaf that paints only
        // inside its box gets a layer of that size; others, one the size
        // of what is drawn.
        const bool leaf = node.children().empty();
        const bool singleShape = style.opacity < 1 && leaf && ! bordered && node.type() == NodeType::View;
        const bool layered = style.opacity < 1 && ! singleShape;
        if (layered)
        {
            const bool insideBox =
                leaf
                && (node.type() == NodeType::View || node.type() == NodeType::Image || node.type() == NodeType::Canvas);
            canvas.saveLayerAlphaf(insideBox ? &box : nullptr, style.opacity);
        }

        const SkRRect outer = roundedRect(box, style.borderRadius);
        if (style.backgroundColor.visible() && painting())
        {
            SkColor4f color = SkColor4f::FromColor(skColor(style.backgroundColor));
            if (singleShape)
                color.fA *= style.opacity;
            SkPaint paint(color);
            paint.setAntiAlias(true);
            canvas.drawRRect(outer, paint);
        }

        // Shown elsewhere: everything after it is in the next layer.
        if (isHole(node))
            ++holesPassed;
        else if (painting())
            switch (node.type())
            {
                case NodeType::Text:
                    drawText(canvas, node);
                    break;
                case NodeType::Image:
                    drawImage(canvas, node, outer);
                    break;
                case NodeType::Input:
                    drawInput(canvas, node);
                    break;
                case NodeType::Canvas:
                    drawCanvas(canvas, node, outer);
                    break;
                case NodeType::View:
                case NodeType::Scroll:
                    break;
            }

        if (! node.children().empty())
        {
            canvas.save();
            if (style.overflow != Overflow::Visible || node.type() == NodeType::Scroll)
            {
                const SkRect inner =
                    SkRect::MakeLTRB(border.left, border.top, frame.width - border.right, frame.height - border.bottom);
                canvas.clipRRect(roundedRect(inner, style.borderRadius, border), true);
            }
            canvas.translate(-node.scrollOffset().x, -node.scrollOffset().y);
            for (const Node* child : node.stackedChildren())
                drawNode(canvas, *child);
            canvas.restore();
        }
        if (node.type() == NodeType::Scroll && painting())
            drawScrollIndicators(canvas, node);

        if (bordered && painting())
        {
            const SkRect inner =
                SkRect::MakeLTRB(border.left, border.top, frame.width - border.right, frame.height - border.bottom);
            SkPaint paint(SkColor4f::FromColor(skColor(style.borderColor)));
            paint.setAntiAlias(true);
            if (inner.isEmpty())
                canvas.drawRRect(outer, paint);
            else
                canvas.drawDRRect(outer, roundedRect(inner, style.borderRadius, border), paint);
        }

        if (layered)
            canvas.restore();
        canvas.restore();
    }

    void Renderer::Impl::drawText(SkCanvas& canvas, const Node& node)
    {
        const TextStyle& style = node.style().text;
        const Rect content = node.contentBox();
        SkPaint paint(SkColor4f::FromColor(skColor(style.color)));
        paint.setAntiAlias(true);
        for (const TextLine& line : surface->textLayout(node.id()).lines)
        {
            float x = content.x;
            if (style.textAlign == TextAlign::Center)
                x += (content.width - line.width) / 2;
            else if (style.textAlign == TextAlign::Right)
                x += content.width - line.width;
            text->draw(canvas, std::string_view(node.text()).substr(line.begin, line.end - line.begin), style, x,
                       content.y + line.baseline, paint);
        }
    }

    void Renderer::Impl::drawImage(SkCanvas& canvas, const Node& node, const SkRRect& outer)
    {
        const sk_sp<SkImage> image = images->image(node.source());
        if (image == nullptr)
            return;
        const Rect content = node.contentBox();
        const SkRect box = SkRect::MakeXYWH(content.x, content.y, content.width, content.height);
        const SkRect placed = placeImage({ static_cast<float>(image->width()), static_cast<float>(image->height()) },
                                         box, node.style().resizeMode);
        canvas.save();
        canvas.clipRRect(outer, true);
        canvas.clipRect(box, true);
        canvas.drawImageRect(image, placed, SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone));
        canvas.restore();
    }

    void Renderer::Impl::drawCanvas(SkCanvas& canvas, const Node& node, const SkRRect& outer)
    {
        const render::RasterSurface& pixels = node.canvas()->pixels;
        if (pixels.width() == 0 || pixels.height() == 0)
            return;
        const SkPixmap pixmap(
            SkImageInfo::Make(pixels.width(), pixels.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType),
            pixels.pixels(), static_cast<std::size_t>(pixels.width()) * 4);
        // Borrows the pixels: nothing is copied.
        const sk_sp<SkImage> image = SkImages::RasterFromPixmap(pixmap, nullptr, nullptr);
        if (image == nullptr)
            return;
        const Rect content = node.contentBox();
        canvas.save();
        canvas.clipRRect(outer, true);
        // Stretched over the content box, like an HTML canvas.
        canvas.drawImageRect(image, SkRect::MakeXYWH(content.x, content.y, content.width, content.height),
                             SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone));
        canvas.restore();
    }

    void Renderer::Impl::drawInput(SkCanvas& canvas, const Node& node)
    {
        const TextStyle& style = node.style().text;
        const Rect content = node.contentBox();
        const TextLayout& layout = surface->textLayout(node.id());
        const float lineHeight = layout.lines.empty() ? style.fontSize * 1.2f : layout.lines.front().height;
        const float top = content.y + (content.height - lineHeight) / 2;
        const float baseline = top + (layout.lines.empty() ? style.fontSize : layout.lines.front().baseline);
        const float x = content.x - node.scrollOffset().x;
        const bool focused = surface->focused() == node.id();

        canvas.save();
        canvas.clipRect(SkRect::MakeXYWH(content.x, content.y, content.width, content.height), true);
        const std::string& value = node.text();
        if (value.empty())
        {
            Color faded = style.color;
            faded.a = static_cast<std::uint8_t>(faded.a * 2 / 5);
            SkPaint paint(SkColor4f::FromColor(skColor(faded)));
            paint.setAntiAlias(true);
            text->draw(canvas, node.placeholder(), style, content.x, baseline, paint);
        }
        const Selection& selection = node.selection();
        const auto offsetX = [&](std::size_t offset)
        { return x + text->advance(std::string_view(value).substr(0, offset), style); };
        if (focused && selection.start() != selection.end())
        {
            SkPaint highlight(SkColor4f::FromColor(SkColorSetARGB(90, 51, 144, 255)));
            canvas.drawRect(
                SkRect::MakeLTRB(offsetX(selection.start()), top, offsetX(selection.end()), top + lineHeight),
                highlight);
        }
        SkPaint paint(SkColor4f::FromColor(skColor(style.color)));
        paint.setAntiAlias(true);
        text->draw(canvas, value, style, x, baseline, paint);
        // The caret blinks: on for 530 ms, off for 530 ms.
        if (focused && selection.start() == selection.end() && std::fmod(seconds, 1.06) < 0.53)
            canvas.drawRect(SkRect::MakeXYWH(std::round(offsetX(selection.focus)), top, 1, lineHeight), paint);
        canvas.restore();
    }

    void Renderer::Impl::drawScrollIndicators(SkCanvas& canvas, const Node& node) const
    {
        const Size content = surface->contentSize(node.id());
        const Rect box = node.contentBox();
        const Point scroll = node.scrollOffset();
        SkPaint paint(SkColor4f::FromColor(SkColorSetARGB(96, 128, 128, 128)));
        paint.setAntiAlias(true);
        constexpr float thickness = 3;
        if (content.height > box.height + 0.5f && box.height > 0)
        {
            const float length = std::max(16.0f, box.height * box.height / content.height);
            const float travel = box.height - length;
            const float at = box.y + travel * scroll.y / (content.height - box.height);
            canvas.drawRRect(
                SkRRect::MakeRectXY(SkRect::MakeXYWH(box.x + box.width - thickness - 2, at, thickness, length),
                                    thickness / 2, thickness / 2),
                paint);
        }
        if (content.width > box.width + 0.5f && box.width > 0)
        {
            const float length = std::max(16.0f, box.width * box.width / content.width);
            const float travel = box.width - length;
            const float at = box.x + travel * scroll.x / (content.width - box.width);
            canvas.drawRRect(
                SkRRect::MakeRectXY(SkRect::MakeXYWH(at, box.y + box.height - thickness - 2, length, thickness),
                                    thickness / 2, thickness / 2),
                paint);
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
