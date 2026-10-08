#pragma once

#include "gpu/Context.h"
#include "gpu/LayerRenderer.h"

#include <soundor/render/Compositor.h>

#include <cstdint>
#include <memory>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // The GPU compositor's drawing into a texture instead of a window, read
    // back on request: what GPU composition produces, where nothing can be
    // shown (tests).
    class OffscreenCompositor final : public render::Compositor
    {
    public:
        explicit OffscreenCompositor(std::shared_ptr<Device> device, std::uint32_t background = 0);
        ~OffscreenCompositor() override;

        [[nodiscard]] render::Capabilities capabilities() const override;
        void composite(const render::Frame& frame) override;
        [[nodiscard]] const render::CompositorStatistics& statistics() const noexcept override { return stats; }

        // What the last composite() drew: premultiplied BGRA, top row first,
        // like render::Bitmap.
        [[nodiscard]] std::vector<std::uint32_t> readPixels();
        [[nodiscard]] int width() const noexcept { return targetWidth; }
        [[nodiscard]] int height() const noexcept { return targetHeight; }

    private:
        std::shared_ptr<Device> owner;
        std::unique_ptr<Context> context;
        std::unique_ptr<LayerRenderer> renderer;
        std::uint32_t background;
        unsigned texture = 0;
        unsigned framebuffer = 0;
        int targetWidth = 0;
        int targetHeight = 0;
        render::CompositorStatistics stats;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
