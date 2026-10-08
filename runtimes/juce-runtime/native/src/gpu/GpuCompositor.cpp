#include "gpu/Context.h"
#include "gpu/Egl.h"
#include "gpu/LayerRenderer.h"
#include "gpu/Presentation.h"

#include <soundor/render/GpuCompositor.h>

#include <cstdlib>
#include <string>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    namespace
    {
        bool cpuRequested()
        {
#if defined(_MSC_VER)
            char* value = nullptr;
            std::size_t size = 0;
            const bool cpu =
                _dupenv_s(&value, &size, "SOUNDOR_RENDERER") == 0 && value != nullptr && std::string(value) == "cpu";
            std::free(value);
            return cpu;
#else
            const char* value = std::getenv("SOUNDOR_RENDERER"); // NOLINT(concurrency-mt-unsafe)
            return value != nullptr && std::string(value) == "cpu";
#endif
        }

        class WindowCompositor final : public GpuCompositor
        {
        public:
            WindowCompositor(std::unique_ptr<gpu::Presentation> where, std::shared_ptr<gpu::Device> gpuDevice,
                             std::unique_ptr<gpu::Context> gpuContext, EGLSurface windowSurface,
                             std::uint32_t backgroundColor)
                : presentation(std::move(where)),
                  shared(std::move(gpuDevice)),
                  context(std::move(gpuContext)),
                  surface(windowSurface),
                  background(backgroundColor)
            {
                const gpu::CurrentContext current(*context, surface);
                renderer = std::make_unique<gpu::LayerRenderer>(*context);
            }

            ~WindowCompositor() override
            {
                // GL objects, then the surface (before the window it shows in).
                renderer.reset();
                eglDestroySurface(shared->display(), surface);
                context.reset();
            }

            [[nodiscard]] Capabilities capabilities() const override
            {
                const gpu::DeviceInfo& info = shared->info();
                return { .gpu = true,
                         .backend = std::string("ANGLE / ") + gpu::name(info.backend) + " (" + info.renderer + ")" };
            }

            void composite(const Frame& frame) override
            {
                stats = {};
                if (! working || frame.width <= 0 || frame.height <= 0)
                    return;
                const gpu::CurrentContext current(*context, surface);
                if (! current.ok())
                {
                    lose();
                    return;
                }
                bool changed = renderer->upload(frame, stats);
                changed = changed || frame.width != width || frame.height != height || stale;
                width = frame.width;
                height = frame.height;
                if (! changed)
                    return;
                renderer->draw(frame, background, stats);
                if (eglSwapBuffers(shared->display(), surface) != EGL_TRUE)
                {
                    if (eglGetError() == EGL_CONTEXT_LOST)
                        lose();
                    return;
                }
                stale = false;
            }

            [[nodiscard]] const CompositorStatistics& statistics() const noexcept override { return stats; }

            void setBounds(float x, float y, float w, float h, float scale) override
            {
                presentation->setBounds(x, y, w, h, scale);
                stale = true;
            }

            void setVisible(bool visible) override
            {
                presentation->setVisible(visible);
                stale = true;
            }

            [[nodiscard]] bool healthy() const noexcept override { return working; }

            [[nodiscard]] std::shared_ptr<gpu::Device> device() const override { return shared; }

        private:
            void lose() { working = false; }

            std::unique_ptr<gpu::Presentation> presentation;
            std::shared_ptr<gpu::Device> shared;
            std::unique_ptr<gpu::Context> context;
            EGLSurface surface;
            std::unique_ptr<gpu::LayerRenderer> renderer;
            std::uint32_t background;
            CompositorStatistics stats;
            int width = 0;
            int height = 0;
            // The window needs drawing again although no layer changed.
            bool stale = true;
            bool working = true;
        };
    } // namespace

    std::unique_ptr<GpuCompositor> GpuCompositor::create(const Options& options, std::string* failure)
    {
        const auto fail = [&](std::string reason) -> std::unique_ptr<GpuCompositor>
        {
            if (failure != nullptr)
                *failure = std::move(reason);
            return nullptr;
        };
        if (cpuRequested())
            return fail("SOUNDOR_RENDERER=cpu");
        std::string reason;
        auto presentation = gpu::createPresentation(options.view.handle, &reason);
        if (presentation == nullptr)
            return fail(reason);
        auto device = gpu::Device::create(
            { .policy = options.allowSoftware ? gpu::DevicePolicy::AllowSoftware : gpu::DevicePolicy::HardwareOnly },
            &reason);
        if (device == nullptr)
            return fail(reason);
        auto context = gpu::Context::create(device, {}, &reason);
        if (context == nullptr)
            return fail(reason);

        const EGLint configAttributes[] = {
            EGL_RED_SIZE,
            8,
            EGL_GREEN_SIZE,
            8,
            EGL_BLUE_SIZE,
            8,
            EGL_ALPHA_SIZE,
            8,
            EGL_SURFACE_TYPE,
            EGL_WINDOW_BIT,
            EGL_RENDERABLE_TYPE,
            EGL_OPENGL_ES3_BIT,
            EGL_NONE,
        };
        EGLConfig config = nullptr;
        EGLint count = 0;
        if (eglChooseConfig(device->display(), configAttributes, &config, 1, &count) != EGL_TRUE || count == 0)
            return fail("no EGL config for a window");
        EGLSurface surface = eglCreateWindowSurface(
            device->display(), config, reinterpret_cast<EGLNativeWindowType>(presentation->nativeWindow()), nullptr);
        if (surface == EGL_NO_SURFACE)
            return fail("eglCreateWindowSurface failed (" + std::to_string(eglGetError()) + ")");
        return std::make_unique<WindowCompositor>(std::move(presentation), std::move(device), std::move(context),
                                                  surface, options.background);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
