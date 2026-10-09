#include <soundor/render/Compositor.h>

#include <include/core/SkCanvas.h>
#include <include/core/SkImage.h>
#include <include/core/SkImageInfo.h>
#include <include/core/SkPaint.h>
#include <include/core/SkPixmap.h>
#include <include/core/SkRRect.h>
#include <include/core/SkRegion.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        SkImageInfo bgra(int width, int height)
        {
            return SkImageInfo::Make(width, height, kBGRA_8888_SkColorType, kPremul_SkAlphaType);
        }

        // Where a layer's content lands in the view.
        IntRect footprint(const Layer& layer)
        {
            const IntRect area = layer.transform.mapBounds(layer.bounds);
            if (! layer.clip)
                return area;
            const Clip& clip = *layer.clip;
            const auto left = static_cast<int>(std::floor(clip.x));
            const auto top = static_cast<int>(std::floor(clip.y));
            return area.intersected({ left, top, static_cast<int>(std::ceil(clip.x + clip.width)) - left,
                                      static_cast<int>(std::ceil(clip.y + clip.height)) - top });
        }

        // A layer the target's pixels can simply be copied from.
        bool copyable(const Frame& frame)
        {
            if (frame.layers.size() != 1)
                return false;
            const Layer& layer = frame.layers.front();
            const auto* raster = std::get_if<RasterContent>(&layer.content);
            return raster != nullptr && raster->surface != nullptr && layer.transform.isIdentity() && layer.opacity >= 1
                   && ! layer.clip && layer.bounds == frame.bounds() && raster->surface->width() == frame.width
                   && raster->surface->height() == frame.height;
        }

        void copy(const RasterSurface& from, const Bitmap& to, const IntRect& rect)
        {
            const auto* source = from.pixels();
            for (int y = rect.y; y < rect.bottom(); ++y)
                std::memcpy(static_cast<std::uint8_t*>(to.pixels) + static_cast<std::size_t>(y) * to.rowBytes
                                + static_cast<std::size_t>(rect.x) * 4,
                            source + static_cast<std::size_t>(y) * static_cast<std::size_t>(from.width()) + rect.x,
                            static_cast<std::size_t>(rect.width) * 4);
        }

        void draw(SkCanvas& canvas, const Layer& layer)
        {
            const auto* raster = std::get_if<RasterContent>(&layer.content);
            if (raster == nullptr || raster->surface == nullptr || raster->surface->width() == 0
                || raster->surface->height() == 0 || layer.opacity <= 0)
                return;
            const RasterSurface& surface = *raster->surface;
            const SkPixmap pixmap(bgra(surface.width(), surface.height()), surface.pixels(),
                                  static_cast<std::size_t>(surface.width()) * 4);
            // Borrows the pixels: nothing is copied.
            const sk_sp<SkImage> image = SkImages::RasterFromPixmap(pixmap, nullptr, nullptr);
            if (image == nullptr)
                return;
            canvas.save();
            if (layer.clip)
            {
                const Clip& clip = *layer.clip;
                const SkRect rect = SkRect::MakeXYWH(clip.x, clip.y, clip.width, clip.height);
                const SkVector radii[4] = { { clip.radii[0], clip.radii[0] },
                                            { clip.radii[1], clip.radii[1] },
                                            { clip.radii[2], clip.radii[2] },
                                            { clip.radii[3], clip.radii[3] } };
                SkRRect rounded;
                rounded.setRectRadii(rect, radii);
                canvas.clipRRect(rounded, true);
            }
            const Transform& t = layer.transform;
            canvas.concat(SkMatrix::MakeAll(t.a, t.c, t.e, t.b, t.d, t.f, 0, 0, 1));
            SkPaint paint;
            paint.setAlphaf(std::min(layer.opacity, 1.0f));
            const SkRect bounds =
                SkRect::MakeXYWH(static_cast<float>(layer.bounds.x), static_cast<float>(layer.bounds.y),
                                 static_cast<float>(layer.bounds.width), static_cast<float>(layer.bounds.height));
            // Pixel for pixel when only moved by whole pixels; filtered otherwise.
            const SkSamplingOptions sampling = layer.transform.isIntegerTranslate()
                                                   ? SkSamplingOptions()
                                                   : SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone);
            canvas.drawImageRect(image, bounds, sampling, &paint);
            canvas.restore();
        }
    } // namespace

    RasterCompositor::RasterCompositor(RasterTarget& target) : output(target) {}

    RasterCompositor::~RasterCompositor() = default;

    Capabilities RasterCompositor::capabilities() const
    {
        return { .gpu = false, .backend = "Skia raster" };
    }

    void RasterCompositor::composite(const Frame& frame)
    {
        stats = {};
        if (frame.width <= 0 || frame.height <= 0)
            return;
        const RasterTarget::Pixels pixels = output.acquire(frame.width, frame.height);
        if (pixels.bitmap.empty())
            return;

        // What to draw again: the frame's damage, what changed in the
        // layers, and wherever a layer appeared, moved, went away or changed
        // places with another.
        Region damage = frame.damage;
        if (! pixels.preserved)
            damage.add(frame.bounds());
        const auto find = [](const std::vector<Layer>& layers, LayerId id)
        { return std::ranges::find(layers, id, &Layer::id); };
        std::vector<LayerId> order;
        std::vector<LayerId> previousOrder;
        for (const Layer& layer : frame.layers)
        {
            const auto before = find(previous, layer.id);
            if (before == previous.end())
                damage.add(footprint(layer));
            else
            {
                order.push_back(layer.id);
                if (! layer.samePlacement(*before))
                {
                    damage.add(footprint(*before));
                    damage.add(footprint(layer));
                }
            }
            // GPU images never reach a CPU compositor (they are read back
            // into CPU layers first); a changed one still damages its place.
            if (const auto* gpuContent = std::get_if<GpuContent>(&layer.content);
                gpuContent != nullptr && gpuContent->changed)
                damage.add(footprint(layer));
            if (const auto* raster = std::get_if<RasterContent>(&layer.content))
                for (const IntRect& rect : raster->damage.rects())
                    damage.add(layer.transform.mapBounds(
                        { rect.x + layer.bounds.x, rect.y + layer.bounds.y, rect.width, rect.height }));
        }
        for (const Layer& layer : previous)
        {
            if (find(frame.layers, layer.id) == frame.layers.end())
                damage.add(footprint(layer));
            else
                previousOrder.push_back(layer.id);
        }
        if (order != previousOrder)
            for (const Layer& layer : frame.layers)
                damage.add(footprint(layer));
        damage.clip(frame.bounds().intersected({ 0, 0, pixels.bitmap.width, pixels.bitmap.height }));

        // Only the placement is kept: the content belongs to the frame.
        previous.clear();
        for (const Layer& layer : frame.layers)
            previous.push_back(
                { layer.id, layer.bounds, layer.transform, layer.opacity, layer.clip, RasterContent {} });

        if (damage.empty())
            return;
        if (copyable(frame))
        {
            const auto& surface = *std::get<RasterContent>(frame.layers.front().content).surface;
            for (const IntRect& rect : damage.rects())
                copy(surface, pixels.bitmap, rect);
            stats.drawCalls = static_cast<int>(damage.rects().size());
        }
        else
        {
            const std::unique_ptr<SkCanvas> canvas = SkCanvas::MakeRasterDirect(
                bgra(pixels.bitmap.width, pixels.bitmap.height), pixels.bitmap.pixels, pixels.bitmap.rowBytes);
            if (canvas == nullptr)
                return;
            SkRegion clip;
            for (const IntRect& rect : damage.rects())
                clip.op(SkIRect::MakeXYWH(rect.x, rect.y, rect.width, rect.height), SkRegion::kUnion_Op);
            canvas->clipRegion(clip);
            canvas->clear(SK_ColorTRANSPARENT);
            const IntRect bounds = damage.bounds();
            for (const Layer& layer : frame.layers)
                if (footprint(layer).intersects(bounds))
                {
                    draw(*canvas, layer);
                    ++stats.drawCalls;
                }
        }
        stats.layersComposited = static_cast<int>(frame.layers.size());
        stats.pixelsComposited = damage.area();
        output.present(damage);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
