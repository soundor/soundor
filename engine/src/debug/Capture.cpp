#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS
    #include "render/Png.h"

    #include <algorithm>
    #include <cmath>
    #include <cstring>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        // As the DevTools protocol bounds them (MAX_CAPTURE_*).
        constexpr long long maxSide = 8192;
        constexpr long long maxPixels = 16LL * 1024 * 1024;
        constexpr std::size_t maxBytes = std::size_t { 32 } * 1024 * 1024;

        CommandError unavailable(const std::string& message)
        {
            return { "CAPTURE_UNAVAILABLE", message };
        }
    } // namespace

    std::vector<std::uint8_t> Inspector::capture(RuntimeHost& host, const Command& command, Value::Object& result) const
    {
        auto& surface = host.surface();
        surface.layout();
        const float scale = surface.scale();
        const auto view = surface.size();
        // The whole view in device pixels, sized as a backend sizes its target.
        const long long width = std::lround(static_cast<double>(view.width) * scale);
        const long long height = std::lround(static_cast<double>(view.height) * scale);
        if (width <= 0 || height <= 0)
            throw unavailable("The view has no size yet");
        if (width > maxSide || height > maxSide || width * height > maxPixels)
            throw unavailable("The view is too big to capture (at most 8192 pixels a side, 16 megapixels)");
        // The part to keep: the view, or the node's box in it.
        long long left = 0, top = 0, right = width, bottom = height;
        if (command.node != ui::noNode)
        {
            (void)node(host, command.node, false);
            const auto box = surface.bounds(command.node);
            left = std::clamp<long long>(std::lround(std::floor(box.x * scale)), 0, width);
            top = std::clamp<long long>(std::lround(std::floor(box.y * scale)), 0, height);
            right = std::clamp<long long>(std::lround(std::ceil((box.x + box.width) * scale)), 0, width);
            bottom = std::clamp<long long>(std::lround(std::ceil((box.y + box.height) * scale)), 0, height);
            if (right <= left || bottom <= top)
                throw unavailable("The node shows nothing inside the view");
        }
        // Drawn by the engine's renderer, as for the view's layers; GPU
        // canvases are read back once for it.
        std::vector<std::uint32_t> pixels(static_cast<std::size_t>(width * height));
        const render::Bitmap full { pixels.data(), static_cast<int>(width), static_cast<int>(height),
                                    static_cast<std::size_t>(width) * 4 };
        host.render(full);
        const auto keptWidth = static_cast<std::size_t>(right - left);
        const auto keptHeight = static_cast<std::size_t>(bottom - top);
        if (keptWidth != static_cast<std::size_t>(width) || keptHeight != static_cast<std::size_t>(height))
        {
            std::vector<std::uint32_t> kept(keptWidth * keptHeight);
            for (std::size_t row = 0; row < keptHeight; ++row)
                std::memcpy(kept.data() + row * keptWidth,
                            pixels.data() + (static_cast<std::size_t>(top) + row) * static_cast<std::size_t>(width)
                                + static_cast<std::size_t>(left),
                            keptWidth * 4);
            pixels = std::move(kept);
        }
        auto png = render::encodePng(
            { pixels.data(), static_cast<int>(keptWidth), static_cast<int>(keptHeight), keptWidth * 4 });
        if (png.empty())
            throw unavailable("The capture could not be encoded");
        if (png.size() > maxBytes)
            throw unavailable("The capture is bigger than 32 MiB");
        result = Value::Object { { "width", keptWidth },
                                 { "height", keptHeight },
                                 { "scale", scale },
                                 { "format", "png" },
                                 { "bytes", png.size() } };
        return png;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
