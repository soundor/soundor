#pragma once

#include "gpu/Device.h"

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // An OpenGL ES 3.0 context on a Device, without a surface of its own: it
    // draws into framebuffers it makes. Made, used and destroyed on the
    // device's thread.
    class Context
    {
    public:
        struct Options
        {
            // ANGLE's WebGL compatibility: WebGL's validation and robust
            // resource initialization, extensions only once requested.
            bool webgl = false;
        };

        [[nodiscard]] static std::unique_ptr<Context> create(std::shared_ptr<Device> device, const Options& options,
                                                             std::string* failure = nullptr);
        ~Context();
        Context(const Context&) = delete;
        Context& operator=(const Context&) = delete;

        [[nodiscard]] Device& device() const noexcept { return *owner; }
        // The EGLContext.
        [[nodiscard]] void* handle() const noexcept { return eglContext; }

    private:
        Context() = default;

        std::shared_ptr<Device> owner;
        void* eglContext = nullptr;
    };

    // Makes a context current on this thread for a scope, then restores what
    // was current before.
    class CurrentContext
    {
    public:
        explicit CurrentContext(const Context& context);
        ~CurrentContext();
        CurrentContext(const CurrentContext&) = delete;
        CurrentContext& operator=(const CurrentContext&) = delete;

        // Whether it could be made current.
        [[nodiscard]] bool ok() const noexcept { return current; }

    private:
        void* previousDisplay;
        void* previousContext;
        void* previousDraw;
        void* previousRead;
        bool current = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
