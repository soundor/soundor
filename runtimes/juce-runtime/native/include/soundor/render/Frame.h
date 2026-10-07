#pragma once

#include <soundor/Config.h>
#include <soundor/render/Region.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Pixels to draw into: 32 bits each, premultiplied alpha, B, G, R, A in
    // memory on every platform (a 0xAARRGGBB word on little-endian machines,
    // the layout of juce::Image::ARGB).
    struct Bitmap
    {
        void* pixels = nullptr;
        int width = 0;
        int height = 0;
        std::size_t rowBytes = 0;

        [[nodiscard]] bool empty() const noexcept { return pixels == nullptr || width <= 0 || height <= 0; }
    };

    // Pixels a layer is rasterized into on the CPU, owned: a Bitmap's format,
    // rows packed. What it holds survives from frame to frame, so only what
    // changed is drawn again.
    class RasterSurface
    {
    public:
        // Sets the size; true when it changed, and the pixels with it (they
        // are transparent then).
        bool resize(int width, int height);

        [[nodiscard]] int width() const noexcept { return pixelWidth; }
        [[nodiscard]] int height() const noexcept { return pixelHeight; }
        [[nodiscard]] IntRect bounds() const noexcept { return { 0, 0, pixelWidth, pixelHeight }; }
        [[nodiscard]] Bitmap bitmap() noexcept;
        [[nodiscard]] const std::uint32_t* pixels() const noexcept { return storage.data(); }

    private:
        std::vector<std::uint32_t> storage;
        int pixelWidth = 0;
        int pixelHeight = 0;
    };

    // A 2D affine transform, as CSS's matrix(a, b, c, d, e, f): a point
    // (x, y) maps to (a·x + c·y + e, b·x + d·y + f).
    struct Transform
    {
        float a = 1;
        float b = 0;
        float c = 0;
        float d = 1;
        float e = 0;
        float f = 0;

        [[nodiscard]] static constexpr Transform translate(float x, float y) noexcept { return { 1, 0, 0, 1, x, y }; }
        [[nodiscard]] bool isIdentity() const noexcept;
        // Moves pixels by whole pixels only (or not at all).
        [[nodiscard]] bool isIntegerTranslate() const noexcept;
        // The bounds of `rect` transformed, out to whole pixels.
        [[nodiscard]] IntRect mapBounds(const IntRect& rect) const noexcept;

        friend constexpr bool operator==(const Transform&, const Transform&) = default;
    };

    // A rounded rectangle in view pixels that clips a layer.
    struct Clip
    {
        float x = 0;
        float y = 0;
        float width = 0;
        float height = 0;
        // Top left, top right, bottom right, bottom left.
        std::array<float, 4> radii {};

        [[nodiscard]] bool rounded() const noexcept;
        friend bool operator==(const Clip&, const Clip&) = default;
    };

    // Content rasterized on the CPU: a surface, and what changed in it since
    // the previous frame (in its own pixels).
    struct RasterContent
    {
        const RasterSurface* surface = nullptr;
        Region damage;
    };

    using LayerId = std::uint64_t;

    // A new id, unique in the process: compositors key what they cache for
    // a layer (a texture) by it, whatever view the layer belongs to.
    [[nodiscard]] LayerId newLayerId() noexcept;

    // One piece of a view a compositor draws: content, placed at `bounds`
    // (view pixels, before `transform`), with the opacity and clip it is
    // seen through. A layer keeps its id while it exists; its content may
    // change in place.
    struct Layer
    {
        LayerId id = 0;
        IntRect bounds;
        Transform transform;
        float opacity = 1;
        std::optional<Clip> clip;
        std::variant<RasterContent> content;

        // Whether everything but the content is the same.
        [[nodiscard]] bool samePlacement(const Layer& other) const noexcept;
    };

    // What producing a frame cost: the CPU rasterization behind it.
    struct FrameStatistics
    {
        int layersRasterized = 0;
        long long pixelsRasterized = 0;
    };

    // A view as a compositor sees it: its size in device pixels and its
    // layers, bottom to top, with what changed since the previous frame.
    struct Frame
    {
        int width = 0;
        int height = 0;
        // Device pixels per logical pixel.
        float scale = 1;
        std::vector<Layer> layers;
        // The view pixels that may look different from the previous frame;
        // everything when the size or the layers themselves changed.
        Region damage;
        FrameStatistics statistics;

        [[nodiscard]] IntRect bounds() const noexcept { return { 0, 0, width, height }; }
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
