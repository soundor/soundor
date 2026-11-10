#pragma once

#include "gpu/Context.h"
#include "render/CanvasPixels.h"

#include <soundor/render/Frame.h>

#include <include/core/SkImage.h>
#include <include/core/SkSurface.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    struct CanvasBuffer;
}

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    [[nodiscard]] sk_sp<SkImage> canvasImage(const ui::CanvasBuffer& buffer, bool onGpu, bool copy = false);

    class GaneshSurface;
    class GaneshContext
    {
    public:
        class Scope
        {
        public:
            Scope();
            ~Scope();

        private:
            struct Impl;
            std::unique_ptr<Impl> impl;
            friend class GaneshContext;
        };
        static std::shared_ptr<GaneshContext> create(std::shared_ptr<gpu::Device> device);
        ~GaneshContext();
        [[nodiscard]] const gpu::Device* device() const;
        [[nodiscard]] std::unique_ptr<Scope> makeCurrent() const;
        [[nodiscard]] bool healthy() const;
        void resetState();

    private:
        GaneshContext();
        struct Impl;
        std::unique_ptr<Impl> impl;
        friend class GaneshSurface;
    };

    // Private Skia surface whose pixels stay on the compositor's GPU. The
    // texture's owner implements the GPU module's shared-image protocol.
    class GaneshSurface
    {
    public:
        static std::shared_ptr<GaneshSurface> create(std::shared_ptr<GaneshContext> context, int width, int height);
        ~GaneshSurface();
        SkCanvas& begin();
        void publish();
        [[nodiscard]] sk_sp<SkImage> snapshot();
        [[nodiscard]] std::shared_ptr<GpuImage> image() const;
        [[nodiscard]] GaneshContext& context() const;
        bool readPixels(const SkImageInfo& info, void* pixels, std::size_t rowBytes, int x, int y);
        bool writePixels(const SkPixmap& pixels, int x, int y);

    private:
        GaneshSurface();
        struct Impl;
        std::unique_ptr<Impl> impl;
    };

    // A cached UI layer, either GPU storage or the existing raster storage.
    // Switching devices/storage invalidates it so callers repaint it in full.
    class DrawingSurface
    {
    public:
        bool resize(int width, int height, const std::shared_ptr<GaneshContext>& context);
        [[nodiscard]] int width() const { return gpu ? gpu->image()->width() : raster.width(); }
        [[nodiscard]] int height() const { return gpu ? gpu->image()->height() : raster.height(); }
        [[nodiscard]] Layer content(const Region& damage) const;
        RasterSurface raster;
        std::shared_ptr<GaneshSurface> gpu;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
