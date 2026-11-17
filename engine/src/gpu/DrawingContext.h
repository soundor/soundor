#pragma once

#include "gpu/Context.h"

#include <soundor/render/Frame.h>

#include <cstdint>
#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // ANGLE interop for the 2D renderer. No EGL/GLES or Skia types cross this
    // boundary. The renderer owns a separate context on the shared device.
    class DrawingContext
    {
    public:
        static std::shared_ptr<DrawingContext> create(std::shared_ptr<Device> device);
        [[nodiscard]] std::unique_ptr<CurrentContext> makeCurrent() const;
        [[nodiscard]] const Device* device() const noexcept;
        [[nodiscard]] bool healthy() const;
        bool takeStateChanged();
        using Proc = void (*)();
        static Proc procedure(const char* name);

    private:
        std::unique_ptr<Context> context;
        bool stateChanged = false;
        friend class DrawingTexture;
    };

    class DrawingTexture
    {
    public:
        static std::unique_ptr<DrawingTexture> create(std::shared_ptr<DrawingContext> context, int width, int height);
        ~DrawingTexture();
        [[nodiscard]] unsigned texture() const noexcept;
        [[nodiscard]] std::shared_ptr<render::GpuImage> image() const;
        // GPU-side synchronization with the compositor, never a CPU wait.
        void beginWrite();
        void publish();

    private:
        class Image;
        std::shared_ptr<Image> shared;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
