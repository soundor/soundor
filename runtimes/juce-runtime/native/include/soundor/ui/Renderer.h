#pragma once

#include <soundor/Config.h>
#include <soundor/render/Frame.h>
#include <soundor/render/Region.h>
#include <soundor/ui/Surface.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
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
        // Given `only`, draws just those device pixels: the rest of `target`
        // keeps what it had.
        // Given `layering`, draws one of the CPU layers the view is split
        // into around content shown elsewhere (GPU canvases).
        struct Layering
        {
            // The canvases shown elsewhere, in paint order: each is left out,
            // and ends a layer.
            std::span<const NodeId> holes;
            // Which layer: what paints before the first hole is 0, what
            // paints between the first and the second is 1, and so on.
            int segment = 0;
        };
        void render(Surface& surface, const render::Bitmap& target, double seconds,
                    const render::Region* only = nullptr, const Layering* layering = nullptr);

    private:
        struct Impl;
        std::unique_ptr<Impl> impl;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
