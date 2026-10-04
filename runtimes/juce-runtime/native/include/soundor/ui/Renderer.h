#pragma once

#include <soundor/Config.h>
#include <soundor/ui/Surface.h>

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Pixels to draw into: 32 bits each, premultiplied alpha, in the platform's
    // native order (B, G, R, A in memory on little-endian machines, the layout
    // of juce::Image::ARGB).
    struct Bitmap
    {
        void* pixels = nullptr;
        int width = 0;
        int height = 0;
        std::size_t rowBytes = 0;
    };

    // Draws a Surface with Skia, on the CPU. It also supplies the text engine
    // and image source a surface needs to lay out what it draws.
    class Renderer
    {
    public:
        // The encoded bytes of an image by asset id (PNG, JPEG or WebP).
        using AssetLoader = std::function<std::optional<std::span<const std::uint8_t>>(std::string_view id)>;

        explicit Renderer(AssetLoader assets);
        ~Renderer();

        Renderer(const Renderer&) = delete;
        Renderer& operator=(const Renderer&) = delete;

        // Text set with the platform's fonts (CoreText, DirectWrite,
        // fontconfig), measured as drawn.
        [[nodiscard]] std::shared_ptr<TextEngine> textEngine() const;
        [[nodiscard]] std::shared_ptr<ImageSource> images() const;

        // Draws `surface`, laid out, into `target`, which covers the view at
        // surface.scale() device pixels per logical pixel. `seconds` is a
        // steady clock, for what animates by itself (a caret blinking).
        void render(Surface& surface, const Bitmap& target, double seconds);

    private:
        struct Impl;
        std::unique_ptr<Impl> impl;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
