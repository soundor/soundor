#pragma once

// Private to soundor_runtime: a render::GpuImage the GPU compositor can draw
// without copying it, because it is a texture of the compositor's device's
// shared texture namespace.

#include "gpu/Egl.h"

#include <soundor/render/Frame.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // An image another context draws (a WebGL canvas's): a texture every
    // context of its device sees (EGL_ANGLE_display_texture_share_group). Who
    // draws it and who shows it never wait for each other on the CPU: where
    // the device has fences, each side leaves one the other's GPU work waits
    // behind.
    class SharedImage : public render::GpuImage
    {
    public:
        // The texture showing the latest picture, or 0 when there is none
        // (nothing shown yet, or its context went away). Not to be changed:
        // only sampled.
        [[nodiscard]] virtual GLuint texture() const noexcept = 0;
        // A fence the picture is complete behind (EGL_NO_SYNC_KHR: it already
        // is), handed over once: the caller waits for it and destroys it.
        [[nodiscard]] virtual EGLSyncKHR takeReady() noexcept = 0;
        // After drawing texture() somewhere: a fence behind that drawing. The
        // image is not drawn into again until it has passed. Takes ownership.
        virtual void released(EGLSyncKHR fence) noexcept = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
