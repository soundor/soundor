#pragma once

// Private to soundor_runtime: bundled images decoded with Skia, by asset id,
// for the renderer (image nodes) and canvases (drawImage()).

#include <soundor/ui/Renderer.h>
#include <soundor/ui/Surface.h>

#include <include/codec/SkCodec.h>
#include <include/codec/SkJpegDecoder.h>
#include <include/codec/SkPngDecoder.h>
#include <include/codec/SkWebpDecoder.h>
#include <include/core/SkData.h>
#include <include/core/SkImage.h>

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

        std::optional<ui::Size> imageSize(std::string_view source) override
        {
            const sk_sp<SkImage> found = image(source);
            if (found == nullptr)
                return std::nullopt;
            return ui::Size { static_cast<float>(found->width()), static_cast<float>(found->height()) };
        }

        sk_sp<SkImage> image(std::string_view source)
        {
            if (source.empty())
                return nullptr;
            std::string key(source);
            if (const auto found = cache.find(key); found != cache.end())
                return found->second;
            sk_sp<SkImage> decoded;
            if (assets)
                if (const auto bytes = assets(source))
                    decoded = decode(*bytes);
            cache.emplace(std::move(key), decoded);
            return decoded;
        }

    private:
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
            return status == SkCodec::kSuccess || status == SkCodec::kIncompleteInput ? image : nullptr;
        }

        ui::Renderer::AssetLoader assets;
        std::unordered_map<std::string, sk_sp<SkImage>> cache;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
