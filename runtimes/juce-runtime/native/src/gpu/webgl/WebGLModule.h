#pragma once

// Private to soundor_runtime: the native side of canvases' WebGL 2 contexts,
// part of `soundor:internal/ui`. webgl.js numbers the hand-written operations
// after the generated ones (generated/WebGLGenerated.inc); keep HandOp and
// webgl.js's HAND list the same.

#include "gpu/Device.h"
#include "modules/ui/CanvasModule.h"

#include <soundor/js/Context.h>

#include <memory>
#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // The WebGL functions of `soundor:internal/ui`.
    [[nodiscard]] std::span<const ui::NativeFunction> webglFunctions();

    // WebGL contexts in `context` render on `device` (the compositor's), or
    // on a device of their own made when the first one is: hardware only,
    // unless `allowSoftware`.
    void installWebGL(js::Context& context, std::shared_ptr<Device> device, bool allowSoftware);

    // Shows what WebGL contexts drew since the last call in their canvases.
    void presentWebGL(js::Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
