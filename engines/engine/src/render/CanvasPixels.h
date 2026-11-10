#pragma once

#include <soundor/Abi.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    struct CanvasBuffer;
}

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // Finish deferred Canvas 2D drawing before sampling its texture.
    void flushCanvas(const ui::CanvasBuffer& buffer);
    // Explicit CPU consumer (e.g. WebGL texture upload with pixel conversion).
    // GPU-backed canvases synchronize and refresh their staging pixels.
    bool readCanvasPixels(ui::CanvasBuffer& buffer);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
