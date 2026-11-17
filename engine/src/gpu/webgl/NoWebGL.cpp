// Where Soundor is built without a GPU (SOUNDOR_HAS_GPU off): canvases have
// no WebGL context, and getContext('webgl2') says why.

#include "gpu/webgl/WebGLModule.h"
#include "js/Bindings.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        using js::bind::ContextState;

        jsi::Value webglCreate(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t)
        {
            return js::bind::write(context, "this build of Soundor has no GPU support");
        }

        // Nothing to lose: no context is ever made.
        jsi::Value webglIgnored(ContextState&, const jsi::Value&, const jsi::Value*, std::size_t)
        {
            return jsi::Value::undefined();
        }

        jsi::Value webglUnavailable(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t)
        {
            js::bind::throwTypeError(context, "WebGL is not available in this build of Soundor");
        }
    } // namespace

    std::span<const ui::NativeFunction> webglFunctions()
    {
        static constexpr ui::NativeFunction functions[] = {
            { "webglCreate", webglCreate, 2 },           { "webglAttributes", webglUnavailable, 1 },
            { "webglCall", webglUnavailable, 2 },        { "webglResize", webglUnavailable, 1 },
            { "webglLose", webglUnavailable, 1 },        { "webglRelease", webglUnavailable, 1 },
            { "webglSetLostListener", webglIgnored, 1 },
        };
        return functions;
    }

    void installWebGL(js::Context&, std::shared_ptr<Device>, bool) {}

    void presentWebGL(js::Context&) {}

    void loseWebGL(js::Context&) {}
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
