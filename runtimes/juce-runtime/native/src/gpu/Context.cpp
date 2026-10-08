#include "gpu/Context.h"

#include "gpu/Egl.h"

#include <cassert>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    std::unique_ptr<Context> Context::create(std::shared_ptr<Device> device, const Options& options,
                                             std::string* failure)
    {
        assert(device != nullptr && device->onOwnerThread());
        const EGLint attributes[] = {
            EGL_CONTEXT_MAJOR_VERSION,
            3,
            EGL_CONTEXT_MINOR_VERSION,
            0,
            EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE,
            options.webgl ? EGL_TRUE : EGL_FALSE,
            // WebGL never shows memory it did not write.
            EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE,
            options.webgl ? EGL_TRUE : EGL_FALSE,
            EGL_NONE,
        };
        EGLContext context = eglCreateContext(device->display(), EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
        if (context == EGL_NO_CONTEXT)
        {
            if (failure != nullptr)
                *failure = "eglCreateContext failed (" + std::to_string(eglGetError()) + ")";
            return nullptr;
        }
        std::unique_ptr<Context> created(new Context());
        created->owner = std::move(device);
        created->eglContext = context;
        return created;
    }

    Context::~Context()
    {
        assert(owner->onOwnerThread());
        // Never left current after it is gone.
        if (eglGetCurrentContext() == eglContext)
            eglMakeCurrent(owner->display(), EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        eglDestroyContext(owner->display(), eglContext);
    }

    CurrentContext::CurrentContext(const Context& context, void* surface)
        : previousDisplay(eglGetCurrentDisplay()),
          previousContext(eglGetCurrentContext()),
          previousDraw(eglGetCurrentSurface(EGL_DRAW)),
          previousRead(eglGetCurrentSurface(EGL_READ))
    {
        assert(context.device().onOwnerThread());
        EGLSurface draw = surface != nullptr ? static_cast<EGLSurface>(surface) : EGL_NO_SURFACE;
        current = eglMakeCurrent(context.device().display(), draw, draw, context.handle()) == EGL_TRUE;
    }

    CurrentContext::~CurrentContext()
    {
        if (previousContext != EGL_NO_CONTEXT)
            eglMakeCurrent(previousDisplay, previousDraw, previousRead, previousContext);
        else if (current)
            eglMakeCurrent(eglGetCurrentDisplay(), EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
