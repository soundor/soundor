#pragma once

// Private to soundor_runtime: a render::GpuImage the GPU compositor can draw
// without copying it, because it lives on the compositor's device.

#include "gpu/Egl.h"

#include <soundor/render/Frame.h>

#include <cstdint>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // An image another context draws (a WebGL canvas's), shown through an
    // EGLImage on the same EGL display. Who draws it and who shows it never
    // wait for each other on the CPU: each side leaves a fence the other's
    // GPU work waits behind.
    class SharedImage : public render::GpuImage
    {
    public:
        // The EGLImage showing the latest picture, or EGL_NO_IMAGE_KHR when
        // there is none (its context went away).
        [[nodiscard]] virtual EGLImageKHR image() const noexcept = 0;
        // Changes when the image's EGLImages are made again (a resize): an
        // EGLImage handle may then be reused for other storage.
        [[nodiscard]] virtual std::uint64_t generation() const noexcept = 0;
        // A fence the picture is complete behind (EGL_NO_SYNC_KHR: it already
        // is), handed over once: the caller waits for it and destroys it.
        [[nodiscard]] virtual EGLSyncKHR takeReady() noexcept = 0;
        // After drawing image() somewhere: a fence behind that drawing. The
        // image is not drawn into again until it has passed. Takes ownership.
        virtual void released(EGLSyncKHR fence) noexcept = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
