#pragma once

// A canvas's WebGL 2 context: an OpenGL ES 3.0 context in ANGLE's WebGL
// compatibility mode, and the drawing buffer that stands for WebGL's default
// framebuffer. Used on the UI thread only.

#include "gpu/Context.h"
#include "gpu/Egl.h"

#include <soundor/ui/Surface.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    class WebGLContext
    {
    public:
        // WebGLContextAttributes, as given and as granted.
        struct Attributes
        {
            bool alpha = true;
            bool depth = true;
            bool stencil = false;
            bool antialias = true;
            bool premultipliedAlpha = true;
            bool preserveDrawingBuffer = false;
            bool failIfMajorPerformanceCaveat = false;
        };

        // A context drawing into `canvas`, or null (why in `failure`).
        [[nodiscard]] static std::unique_ptr<WebGLContext> create(std::shared_ptr<Device> device,
                                                                  std::shared_ptr<ui::CanvasBuffer> canvas,
                                                                  const Attributes& attributes, std::string* failure);
        ~WebGLContext();
        WebGLContext(const WebGLContext&) = delete;
        WebGLContext& operator=(const WebGLContext&) = delete;

        // Makes the context current on this thread, if it is not already.
        void makeCurrent();
        [[nodiscard]] const Attributes& attributes() const noexcept { return granted; }
        [[nodiscard]] Device& device() const noexcept { return context->device(); }

        // ── The drawing buffer ───────────────────────────────────────────────
        // Follows the canvas's size (smaller where the GPU cannot make one so
        // large); it starts cleared.
        void resize();
        [[nodiscard]] int drawingBufferWidth() const noexcept { return width; }
        [[nodiscard]] int drawingBufferHeight() const noexcept { return height; }
        // bindFramebuffer(), with 0 standing for the drawing buffer.
        void bindFramebuffer(GLenum target, GLuint framebuffer);
        // The framebuffer bound for drawing / reading, 0 being the drawing buffer.
        [[nodiscard]] GLuint drawBinding() const noexcept { return boundDraw; }
        [[nodiscard]] GLuint readBinding() const noexcept { return boundRead; }
        // Whether `framebuffer` (an OpenGL name) is one of the drawing buffer's.
        [[nodiscard]] bool isDrawingBuffer(GLuint framebuffer) const noexcept;
        // Before drawing: a drawing buffer that was presented and is not
        // preserved is cleared first.
        void prepareDraw();
        // After drawing: the drawing buffer changed if it was drawn into.
        void drew();
        // Before reading: as before drawing, and a multisampled drawing buffer
        // is resolved into the one that is read.
        void prepareRead();

        // Shows the drawing buffer in the canvas if it changed since: its
        // pixels are read back into the canvas's buffer. True when they were.
        bool present();

        // ── Loss ─────────────────────────────────────────────────────────────
        // Whether the context is lost (the GPU reset, or loseContext()).
        [[nodiscard]] bool lost() const noexcept;
        void lose() noexcept { forcedLoss = true; }

        // Readbacks so far (diagnostics).
        [[nodiscard]] long long readbacks() const noexcept { return readbackCount; }

    private:
        WebGLContext() = default;
        bool makeDrawingBuffer();
        void freeDrawingBuffer();
        void clearDrawingBuffer();
        // Brings the single-sampled image up to date with a multisampled one.
        void resolve();

        std::unique_ptr<Context> context;
        std::shared_ptr<ui::CanvasBuffer> canvas;
        Attributes granted;
        int width = 0;
        int height = 0;
        int samples = 0;
        // The framebuffer drawn into (multisampled with antialias), and the
        // one presented and read (the same without antialias).
        GLuint drawFramebuffer = 0;
        GLuint colorBuffer = 0;
        GLuint depthStencilBuffer = 0;
        GLuint resolveFramebuffer = 0;
        GLuint resolveTexture = 0;
        GLuint boundDraw = 0;
        GLuint boundRead = 0;
        bool changed = false;  // drawn into since presented
        bool resolved = false; // the resolve framebuffer holds the latest
        bool needsClear = false;
        bool forcedLoss = false;
        bool resetLoss = false;
        std::vector<std::uint8_t> readback;
        long long readbackCount = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
