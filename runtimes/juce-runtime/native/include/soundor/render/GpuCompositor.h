#pragma once

#include <soundor/Config.h>
#include <soundor/render/Compositor.h>

#include <cstdint>
#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    namespace gpu
    {
        class Device;
    } // namespace gpu

    namespace render
    {
        // The platform's view a GPU compositor presents in: an NSView* on
        // macOS (it gets a sublayer), an HWND on Windows (it gets a child
        // window that lets input through). Soundor never subclasses or
        // registers anything for it.
        struct NativeView
        {
            void* handle = nullptr;
        };

        // Composites on the GPU (ANGLE) and presents into a native view: CPU
        // layers become textures, uploaded only where they changed, and are
        // drawn as quads with their transforms, opacity and clips.
        //
        // Created and used on the UI thread. Where there is no GPU
        // presentation (no acceptable device, Linux, SOUNDOR_RENDERER=cpu),
        // create() returns null: use a RasterCompositor then.
        class GpuCompositor : public Compositor
        {
        public:
            struct Options
            {
                NativeView view;
                // What shows where no layer draws (0xAARRGGBB); the
                // presentation is opaque.
                std::uint32_t background = 0xFF000000;
                // Whether a software renderer (WARP, SwiftShader) will do:
                // for tests and debugging, never by default.
                bool allowSoftware = false;
                // The device to draw on, from createDevice(); default: one
                // of its own.
                std::shared_ptr<gpu::Device> device;
            };

            // The device a GPU compositor would draw on, made before there is
            // a view: give it to the RuntimeHost too, so that WebGL draws on
            // it and the compositor shows WebGL without copies. Null (and why
            // in `failure`) where there is no GPU composition.
            [[nodiscard]] static std::shared_ptr<gpu::Device> createDevice(bool allowSoftware = false,
                                                                           std::string* failure = nullptr);

            // A GPU compositor presenting into `options.view`, or null, with
            // the reason in `failure`.
            [[nodiscard]] static std::unique_ptr<GpuCompositor> create(const Options& options,
                                                                       std::string* failure = nullptr);

            // Where it presents in the view, in the view's coordinates
            // (points on macOS, physical pixels on Windows), at `scale`
            // device pixels per unit.
            virtual void setBounds(float x, float y, float width, float height, float scale) = 0;
            virtual void setVisible(bool visible) = 0;
            // False once the GPU is lost (a driver reset, a removed GPU):
            // switch to a RasterCompositor.
            [[nodiscard]] virtual bool healthy() const noexcept = 0;
            // The GPU device, for other GPU work on the same device (WebGL).
            [[nodiscard]] virtual std::shared_ptr<gpu::Device> device() const = 0;
        };
    } // namespace render
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
