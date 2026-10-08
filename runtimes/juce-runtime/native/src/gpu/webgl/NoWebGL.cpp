// Where Soundor is built without a GPU (SOUNDOR_HAS_GPU off): canvases have
// no WebGL context, and getContext('webgl2') says why.

#include "gpu/webgl/WebGLModule.h"
#include "js/Bindings.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        JSValue webglCreate(JSContext* ctx, JSValueConst, int, JSValueConst*)
        {
            constexpr std::string_view why = "this build of Soundor has no GPU support";
            return JS_NewStringLen(ctx, why.data(), why.size());
        }

        JSValue webglUnavailable(JSContext* ctx, JSValueConst, int, JSValueConst*)
        {
            return JS_ThrowTypeError(ctx, "WebGL is not available in this build of Soundor");
        }
    } // namespace

    std::span<const ui::NativeFunction> webglFunctions()
    {
        static constexpr ui::NativeFunction functions[] = {
            { "webglCreate", webglCreate, 2 },    { "webglAttributes", webglUnavailable, 1 },
            { "webglCall", webglUnavailable, 2 }, { "webglResize", webglUnavailable, 1 },
            { "webglLose", webglUnavailable, 1 }, { "webglRelease", webglUnavailable, 1 },
        };
        return functions;
    }

    void installWebGL(js::Context&, std::shared_ptr<Device>, bool) {}

    void presentWebGL(js::Context&) {}
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
