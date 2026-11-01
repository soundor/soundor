#pragma once

#include <soundor/Abi.h>

// Private to soundor_runtime: bundled images decoded with Skia, by asset id,
// for the renderer (image nodes) and canvases (drawImage()).

#include "SvgDocument.h"

#include <soundor/ui/Renderer.h>
#include <soundor/ui/Surface.h>

#include <include/codec/SkCodec.h>
#include <include/codec/SkJpegDecoder.h>
#include <include/codec/SkPngDecoder.h>
#include <include/codec/SkWebpDecoder.h>
#include <include/core/SkCanvas.h>
#include <include/core/SkData.h>
#include <include/core/SkImage.h>
#include <modules/svg/include/SkSVGRenderContext.h>

#include <algorithm>
#include <cmath>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Decoded images by asset id; a failed decode is remembered too.
    class SkiaImages final : public ui::ImageSource
    {
    public:
        explicit SkiaImages(ui::Renderer::AssetLoader loader) : assets(std::move(loader)) {}

        struct Image
        {
            sk_sp<SkImage> raster;
            sk_sp<SkSVGDOM> document;
            ui::Size size;
            bool viewBox = false;
        };

        std::optional<ui::Size> imageSize(std::string_view source) override
        {
            const auto* found = load(source);
            return found != nullptr ? std::optional(found->size) : std::nullopt;
        }

        // Raster consumers (e.g. WebGL textures) explicitly request pixels.
        // Image nodes always use load()/draw(), retaining SVG geometry.
        sk_sp<SkImage> image(std::string_view source)
        {
            const auto* found = load(source);
            return found != nullptr ? found->raster : nullptr;
        }

        const Image* load(std::string_view source)
        {
            if (source.empty())
                return nullptr;
            std::string key(source);
            if (const auto found = cache.find(key); found != cache.end())
                return found->second.get();
            std::unique_ptr<Image> decoded;
            if (assets)
                if (const auto bytes = assets(source))
                {
                    if (source.ends_with(".svg"))
                    {
                        ++documentParses;
                        if (auto document = parseSvgDocument(*bytes))
                            if (const auto size = svgSize(*document))
                            {
                                document->setContainerSize(SkSize::Make(size->width, size->height));
                                const bool viewBox = document->getRoot()->getViewBox().has_value();
                                if (viewBox)
                                {
                                    // As in a browser Image, CSS supplies the
                                    // document viewport; intrinsic dimensions
                                    // still determine Image placement above it.
                                    const SkSVGLength relative(100, SkSVGLength::Unit::kPercentage);
                                    document->getRoot()->setWidth(relative);
                                    document->getRoot()->setHeight(relative);
                                }
                                decoded =
                                    std::make_unique<Image>(Image { nullptr, std::move(document), *size, viewBox });
                            }
                    }
                    else if (auto raster = decode(*bytes))
                    {
                        const ui::Size size { static_cast<float>(raster->width()),
                                              static_cast<float>(raster->height()) };
                        decoded = std::make_unique<Image>(Image { std::move(raster), nullptr, size });
                    }
                }
            return cache.emplace(std::move(key), std::move(decoded)).first->second.get();
        }

        enum class SvgViewport
        {
            Image,
            Intrinsic, // Canvas drawImage scales/crops the natural image.
        };

        void draw(SkCanvas& canvas, const Image& image, const SkRect& destination,
                  SvgViewport viewport = SvgViewport::Image)
        {
            if (destination.isEmpty() || canvas.quickReject(destination))
                return;
            if (image.raster != nullptr)
                canvas.drawImageRect(image.raster, destination,
                                     SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kLinear));
            else
            {
                ++documentDraws;
                canvas.save();
                // SVG-as-image is clipped to its own viewport, even when the
                // root document permits overflow. The outer Image adds its
                // content-box and rounded clips as usual.
                canvas.clipRect(destination, true);
                canvas.translate(destination.x(), destination.y());
                if (image.viewBox && viewport == SvgViewport::Image)
                    image.document->setContainerSize(SkSize::Make(destination.width(), destination.height()));
                else
                {
                    image.document->setContainerSize(SkSize::Make(image.size.width, image.size.height));
                    canvas.scale(destination.width() / image.size.width, destination.height() / image.size.height);
                }
                image.document->render(&canvas);
                canvas.restore();
            }
        }

        [[nodiscard]] std::uint64_t svgParseAttempts() const { return documentParses; }
        [[nodiscard]] std::uint64_t svgDraws() const { return documentDraws; }

    private:
        static std::optional<ui::Size> svgSize(const SkSVGDOM& document)
        {
            const auto* root = document.getRoot();
            const SkSVGLengthContext context(SkSize::Make(0, 0));
            const auto explicitSide = [&](const SkSVGLength& length, SkSVGLengthContext::LengthType type)
            {
                return length.unit() != SkSVGLength::Unit::kPercentage ? std::optional(context.resolve(length, type))
                                                                       : std::nullopt;
            };
            const auto explicitWidth = explicitSide(root->getWidth(), SkSVGLengthContext::LengthType::kHorizontal);
            const auto explicitHeight = explicitSide(root->getHeight(), SkSVGLengthContext::LengthType::kVertical);
            const bool hasWidth = explicitWidth.has_value();
            const bool hasHeight = explicitHeight.has_value();
            float width = explicitWidth.value_or(300);
            float height = explicitHeight.value_or(150);
            const auto positive = [](float value) { return std::isfinite(value) && value > 0 && value <= 1000000; };
            if ((hasWidth && ! positive(width)) || (hasHeight && ! positive(height)))
                return std::nullopt;
            float ratio = 0;
            if (const auto& box = root->getViewBox();
                box.has_value() && positive(box->width()) && positive(box->height()))
                ratio = box->width() / box->height();
            if (! std::isfinite(ratio))
                return std::nullopt;
            if (hasWidth && ! hasHeight)
                height = ratio > 0 ? width / ratio : 150;
            else if (hasHeight && ! hasWidth)
                width = ratio > 0 ? height * ratio : 300;
            else if (! hasWidth && ! hasHeight)
            {
                // A viewBox supplies a ratio, not intrinsic pixel dimensions.
                // Contain it in the browser's default object size, 300x150.
                width = ratio > 0 ? std::min(300.0f, 150 * ratio) : 300;
                height = ratio > 0 ? width / ratio : 150;
            }
            if (! positive(width) || ! positive(height))
                return std::nullopt;
            return ui::Size { width, height };
        }

        static sk_sp<SkImage> decode(std::span<const std::uint8_t> bytes)
        {
            sk_sp<const SkData> data = SkData::MakeWithCopy(bytes.data(), bytes.size());
            std::unique_ptr<SkCodec> codec;
            SkCodec::Result result = SkCodec::kSuccess;
            if (SkPngDecoder::IsPng(bytes.data(), bytes.size()))
                codec = SkPngDecoder::Decode(data, &result);
            else if (SkJpegDecoder::IsJpeg(bytes.data(), bytes.size()))
                codec = SkJpegDecoder::Decode(data, &result);
            else if (SkWebpDecoder::IsWebp(bytes.data(), bytes.size()))
                codec = SkWebpDecoder::Decode(data, &result);
            if (codec == nullptr)
                return nullptr;
            auto [image, status] = codec->getImage();
            if (status != SkCodec::kSuccess && status != SkCodec::kIncompleteInput)
                return nullptr;
            // Its smaller versions, made once: an image drawn much smaller than
            // its pixels averages them instead of skipping most (aliasing).
            return image->withDefaultMipmaps();
        }

        ui::Renderer::AssetLoader assets;
        std::unordered_map<std::string, std::unique_ptr<Image>> cache;
        std::uint64_t documentParses = 0;
        std::uint64_t documentDraws = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
