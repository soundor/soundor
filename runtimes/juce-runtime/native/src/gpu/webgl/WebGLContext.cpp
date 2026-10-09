#include "gpu/webgl/WebGLContext.h"

#include "gpu/SharedImage.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        // OpenGL state a context's own work changes, saved and put back so
        // the page never sees it.
        struct SavedState
        {
            SavedState()
            {
                glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &drawFramebuffer);
                glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &readFramebuffer);
                glGetIntegerv(GL_RENDERBUFFER_BINDING, &renderbuffer);
                glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
                glGetIntegerv(GL_PIXEL_PACK_BUFFER_BINDING, &packBuffer);
                glGetIntegerv(GL_PACK_ALIGNMENT, &packAlignment);
                glGetIntegerv(GL_PACK_ROW_LENGTH, &packRowLength);
                glGetIntegerv(GL_PACK_SKIP_PIXELS, &packSkipPixels);
                glGetIntegerv(GL_PACK_SKIP_ROWS, &packSkipRows);
                scissor = glIsEnabled(GL_SCISSOR_TEST);
                rasterizerDiscard = glIsEnabled(GL_RASTERIZER_DISCARD);
                glGetBooleanv(GL_COLOR_WRITEMASK, colorMask.data());
                glGetBooleanv(GL_DEPTH_WRITEMASK, &depthMask);
                glGetIntegerv(GL_STENCIL_WRITEMASK, &stencilMask);
                glGetIntegerv(GL_STENCIL_BACK_WRITEMASK, &stencilBackMask);
                glGetFloatv(GL_COLOR_CLEAR_VALUE, clearColor.data());
                glGetFloatv(GL_DEPTH_CLEAR_VALUE, &clearDepth);
                glGetIntegerv(GL_STENCIL_CLEAR_VALUE, &clearStencil);
            }

            ~SavedState()
            {
                glBindFramebuffer(GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(drawFramebuffer));
                glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(readFramebuffer));
                glBindRenderbuffer(GL_RENDERBUFFER, static_cast<GLuint>(renderbuffer));
                glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture));
                glBindBuffer(GL_PIXEL_PACK_BUFFER, static_cast<GLuint>(packBuffer));
                glPixelStorei(GL_PACK_ALIGNMENT, packAlignment);
                glPixelStorei(GL_PACK_ROW_LENGTH, packRowLength);
                glPixelStorei(GL_PACK_SKIP_PIXELS, packSkipPixels);
                glPixelStorei(GL_PACK_SKIP_ROWS, packSkipRows);
                (scissor == GL_TRUE ? glEnable : glDisable)(GL_SCISSOR_TEST);
                (rasterizerDiscard == GL_TRUE ? glEnable : glDisable)(GL_RASTERIZER_DISCARD);
                glColorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
                glDepthMask(depthMask);
                glStencilMaskSeparate(GL_FRONT, static_cast<GLuint>(stencilMask));
                glStencilMaskSeparate(GL_BACK, static_cast<GLuint>(stencilBackMask));
                glClearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
                glClearDepthf(clearDepth);
                glClearStencil(clearStencil);
            }

            SavedState(const SavedState&) = delete;
            SavedState& operator=(const SavedState&) = delete;

            GLint drawFramebuffer = 0;
            GLint readFramebuffer = 0;
            GLint renderbuffer = 0;
            GLint texture = 0;
            GLint packBuffer = 0;
            GLint packAlignment = 4;
            GLint packRowLength = 0;
            GLint packSkipPixels = 0;
            GLint packSkipRows = 0;
            GLboolean scissor = GL_FALSE;
            GLboolean rasterizerDiscard = GL_FALSE;
            std::array<GLboolean, 4> colorMask {};
            GLboolean depthMask = GL_TRUE;
            GLint stencilMask = 0;
            GLint stencilBackMask = 0;
            std::array<GLfloat, 4> clearColor {};
            GLfloat clearDepth = 1;
            GLint clearStencil = 0;
        };
    } // namespace

    // The canvas's GPU image: the presentation texture last shown, through
    // a texture the GPU compositor (sharing the device's textures) draws directly.
    class WebGLContext::Image final : public SharedImage
    {
    public:
        explicit Image(WebGLContext& context) : owner(&context) {}

        void detach() noexcept { owner = nullptr; }

        [[nodiscard]] int width() const noexcept override { return owner != nullptr ? owner->width : 0; }
        [[nodiscard]] int height() const noexcept override { return owner != nullptr ? owner->height : 0; }
        // Drawn without a copy only by contexts sharing its textures.
        [[nodiscard]] const Device* device() const noexcept override
        {
            return owner != nullptr && owner->device().info().sharesTextures ? &owner->device() : nullptr;
        }
        [[nodiscard]] bool opaque() const noexcept override { return owner != nullptr && ! owner->granted.alpha; }
        [[nodiscard]] bool premultiplied() const noexcept override
        {
            return owner == nullptr || owner->granted.premultipliedAlpha;
        }
        bool read(render::RasterSurface& pixels) override { return owner != nullptr && owner->readBack(pixels); }

        [[nodiscard]] GLuint texture() const noexcept override
        {
            return owner != nullptr && owner->shown >= 0 ? owner->fronts[static_cast<std::size_t>(owner->shown)].texture
                                                         : 0;
        }
        [[nodiscard]] EGLSyncKHR takeReady() noexcept override
        {
            return owner != nullptr ? std::exchange(owner->ready, EGL_NO_SYNC_KHR) : EGL_NO_SYNC_KHR;
        }
        void released(EGLSyncKHR fence) noexcept override
        {
            if (owner == nullptr || owner->shown < 0)
            {
                // Nothing will wait for it.
                if (owner != nullptr && fence != EGL_NO_SYNC_KHR)
                    eglDestroySyncKHR(owner->device().display(), fence);
                return;
            }
            Front& front = owner->fronts[static_cast<std::size_t>(owner->shown)];
            if (front.released != EGL_NO_SYNC_KHR)
                eglDestroySyncKHR(owner->device().display(), front.released);
            front.released = fence;
        }

    private:
        WebGLContext* owner;
    };

    std::unique_ptr<WebGLContext> WebGLContext::create(std::shared_ptr<Device> device,
                                                       std::shared_ptr<ui::CanvasBuffer> canvas,
                                                       const Attributes& attributes, std::string* failure)
    {
        const auto fail = [&](std::string reason) -> std::unique_ptr<WebGLContext>
        {
            if (failure != nullptr)
                *failure = std::move(reason);
            return nullptr;
        };
        if (attributes.failIfMajorPerformanceCaveat && device->info().software)
            return fail("the GPU is a software renderer (failIfMajorPerformanceCaveat)");
        std::string reason;
        auto context = Context::create(std::move(device), { .webgl = true }, &reason);
        if (context == nullptr)
            return fail(reason);
        std::unique_ptr<WebGLContext> created(new WebGLContext());
        created->context = std::move(context);
        created->canvas = std::move(canvas);
        created->granted = attributes;
        created->makeCurrent();
        if (attributes.antialias)
        {
            GLint maxSamples = 0;
            glGetIntegerv(GL_MAX_SAMPLES, &maxSamples);
            created->samples = std::min(4, maxSamples);
            created->granted.antialias = created->samples > 1;
        }
        if (! created->makeDrawingBuffer())
            return fail("could not make a drawing buffer");
        created->boundDraw = 0;
        created->boundRead = 0;
        glBindFramebuffer(GL_FRAMEBUFFER, created->drawFramebuffer);
        // WebGL's viewport and scissor box start as the drawing buffer (and
        // stay as they are when it is resized).
        glViewport(0, 0, created->width, created->height);
        glScissor(0, 0, created->width, created->height);
        return created;
    }

    WebGLContext::~WebGLContext()
    {
        makeCurrent();
        if (image != nullptr)
            image->detach();
        // The canvas shows its own pixels again.
        if (canvas->gpuImage == image)
        {
            canvas->gpuImage.reset();
            canvas->drawn = true;
        }
        for (const auto& [id, fence] : syncs)
            glDeleteSync(fence);
        freeDrawingBuffer();
        // The context itself goes with `context`: not current anywhere after.
    }

    void WebGLContext::makeCurrent()
    {
        if (eglGetCurrentContext() != context->handle())
            eglMakeCurrent(context->device().display(), EGL_NO_SURFACE, EGL_NO_SURFACE, context->handle());
    }

    bool WebGLContext::isDrawingBuffer(GLuint framebuffer) const noexcept
    {
        return framebuffer != 0 && (framebuffer == drawFramebuffer || framebuffer == resolveFramebuffer);
    }

    bool WebGLContext::makeDrawingBuffer()
    {
        const SavedState saved;
        GLint maxSize = 0;
        glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE, &maxSize);
        // The canvas's size, scaled down to fit (at least one pixel).
        double w = std::max(1, canvas->pixels.width());
        double h = std::max(1, canvas->pixels.height());
        const double fit = std::min({ 1.0, maxSize / w, maxSize / h });
        width = std::max(1, static_cast<int>(std::floor(w * fit)));
        height = std::max(1, static_cast<int>(std::floor(h * fit)));

        const GLenum colorFormat = granted.alpha ? GL_RGBA8 : GL_RGB8;
        GLenum depthFormat = 0;
        GLenum depthAttachment = 0;
        if (granted.depth && granted.stencil)
        {
            depthFormat = GL_DEPTH24_STENCIL8;
            depthAttachment = GL_DEPTH_STENCIL_ATTACHMENT;
        }
        else if (granted.depth)
        {
            depthFormat = GL_DEPTH_COMPONENT24;
            depthAttachment = GL_DEPTH_ATTACHMENT;
        }
        else if (granted.stencil)
        {
            depthFormat = GL_STENCIL_INDEX8;
            depthAttachment = GL_STENCIL_ATTACHMENT;
        }

        // What is presented and read: a texture (the compositor can show it).
        glGenTextures(1, &resolveTexture);
        glBindTexture(GL_TEXTURE_2D, resolveTexture);
        glTexStorage2D(GL_TEXTURE_2D, 1, colorFormat, width, height);
        glGenFramebuffers(1, &resolveFramebuffer);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, resolveFramebuffer);
        glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, resolveTexture, 0);

        if (samples > 1)
        {
            glGenFramebuffers(1, &drawFramebuffer);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, drawFramebuffer);
            glGenRenderbuffers(1, &colorBuffer);
            glBindRenderbuffer(GL_RENDERBUFFER, colorBuffer);
            glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, colorFormat, width, height);
            glFramebufferRenderbuffer(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, colorBuffer);
        }
        else
            drawFramebuffer = resolveFramebuffer;
        if (depthFormat != 0)
        {
            glGenRenderbuffers(1, &depthStencilBuffer);
            glBindRenderbuffer(GL_RENDERBUFFER, depthStencilBuffer);
            if (samples > 1)
                glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, depthFormat, width, height);
            else
                glRenderbufferStorage(GL_RENDERBUFFER, depthFormat, width, height);
            glFramebufferRenderbuffer(GL_DRAW_FRAMEBUFFER, depthAttachment, GL_RENDERBUFFER, depthStencilBuffer);
        }
        const bool complete = glCheckFramebufferStatus(GL_DRAW_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
        changed = false;
        resolved = false;
        needsClear = true;
        return complete;
    }

    void WebGLContext::freeDrawingBuffer()
    {
        if (drawFramebuffer != resolveFramebuffer)
            glDeleteFramebuffers(1, &drawFramebuffer);
        glDeleteFramebuffers(1, &resolveFramebuffer);
        glDeleteTextures(1, &resolveTexture);
        glDeleteRenderbuffers(1, &colorBuffer);
        glDeleteRenderbuffers(1, &depthStencilBuffer);
        drawFramebuffer = resolveFramebuffer = resolveTexture = colorBuffer = depthStencilBuffer = 0;
        freeFronts();
    }

    void WebGLContext::resize()
    {
        makeCurrent();
        freeDrawingBuffer();
        makeDrawingBuffer();
        // Bindings to the drawing buffer follow it to its new framebuffers.
        if (boundDraw == 0)
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, drawFramebuffer);
        if (boundRead == 0)
            glBindFramebuffer(GL_READ_FRAMEBUFFER, drawFramebuffer);
    }

    void WebGLContext::bindFramebuffer(GLenum target, GLuint framebuffer)
    {
        glBindFramebuffer(target, framebuffer == 0 ? drawFramebuffer : framebuffer);
        // What OpenGL took (it refuses unknown names and targets).
        GLint draw = 0;
        GLint read = 0;
        glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw);
        glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read);
        boundDraw = isDrawingBuffer(static_cast<GLuint>(draw)) ? 0 : static_cast<GLuint>(draw);
        boundRead = isDrawingBuffer(static_cast<GLuint>(read)) ? 0 : static_cast<GLuint>(read);
    }

    void WebGLContext::clearDrawingBuffer()
    {
        const SavedState saved;
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, drawFramebuffer);
        glDisable(GL_SCISSOR_TEST);
        glDisable(GL_RASTERIZER_DISCARD);
        glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glDepthMask(GL_TRUE);
        glStencilMask(0xFFFFFFFF);
        glClearColor(0, 0, 0, 0);
        glClearDepthf(1);
        glClearStencil(0);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        needsClear = false;
        resolved = false;
    }

    void WebGLContext::prepareDraw()
    {
        if (boundDraw == 0 && needsClear)
            clearDrawingBuffer();
    }

    void WebGLContext::drew()
    {
        if (boundDraw == 0)
        {
            changed = true;
            resolved = false;
        }
    }

    void WebGLContext::resolve()
    {
        if (samples <= 1 || resolved)
            return;
        GLint draw = 0;
        GLint read = 0;
        glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw);
        glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read);
        glBindFramebuffer(GL_READ_FRAMEBUFFER, drawFramebuffer);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, resolveFramebuffer);
        const GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
        glDisable(GL_SCISSOR_TEST);
        glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        if (scissor == GL_TRUE)
            glEnable(GL_SCISSOR_TEST);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(draw));
        glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(read));
        resolved = true;
    }

    void WebGLContext::prepareRead()
    {
        if (boundRead != 0)
            return;
        if (needsClear)
            clearDrawingBuffer();
        resolve();
        // Reads come from the single-sampled image.
        glBindFramebuffer(GL_READ_FRAMEBUFFER, resolveFramebuffer);
    }

    bool WebGLContext::makeFronts()
    {
        const GLenum colorFormat = granted.alpha ? GL_RGBA8 : GL_RGB8;
        for (Front& front : fronts)
        {
            glGenTextures(1, &front.texture);
            glBindTexture(GL_TEXTURE_2D, front.texture);
            glTexStorage2D(GL_TEXTURE_2D, 1, colorFormat, width, height);
            glGenFramebuffers(1, &front.framebuffer);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, front.framebuffer);
            glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, front.texture, 0);
        }
        return true;
    }

    void WebGLContext::freeFronts()
    {
        EGLDisplay display = device().display();
        for (Front& front : fronts)
        {
            if (front.released != EGL_NO_SYNC_KHR)
                eglDestroySyncKHR(display, front.released);
            glDeleteFramebuffers(1, &front.framebuffer);
            glDeleteTextures(1, &front.texture);
            front = {};
        }
        if (ready != EGL_NO_SYNC_KHR)
            eglDestroySyncKHR(display, ready);
        ready = EGL_NO_SYNC_KHR;
        shown = -1;
    }

    bool WebGLContext::present()
    {
        if (! changed || lost())
            return false;
        makeCurrent();
        const SavedState saved;
        EGLDisplay display = device().display();
        if (fronts[0].texture == 0 && ! makeFronts())
        {
            freeFronts();
            return false;
        }
        // The other presentation texture, once the compositor is done with it.
        const int next = shown == 0 ? 1 : 0;
        Front& front = fronts[static_cast<std::size_t>(next)];
        if (front.released != EGL_NO_SYNC_KHR)
        {
            eglWaitSyncKHR(display, front.released, 0);
            eglDestroySyncKHR(display, front.released);
            front.released = EGL_NO_SYNC_KHR;
        }
        // The drawing buffer into it, on the GPU (a multisampled one resolved
        // on the way): nothing comes back to the CPU.
        glBindFramebuffer(GL_READ_FRAMEBUFFER, drawFramebuffer);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, front.framebuffer);
        glDisable(GL_SCISSOR_TEST);
        glDisable(GL_RASTERIZER_DISCARD);
        glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        if (ready != EGL_NO_SYNC_KHR)
            eglDestroySyncKHR(display, ready);
        ready = device().info().fences ? eglCreateSyncKHR(display, EGL_SYNC_FENCE_KHR, nullptr) : EGL_NO_SYNC_KHR;
        glFlush();
        shown = next;

        if (image == nullptr)
            image = std::make_shared<Image>(*this);
        canvas->gpuImage = image;
        canvas->gpuDrawn = true;
        changed = false;
        if (! granted.preserveDrawingBuffer)
            needsClear = true;
        return true;
    }

    bool WebGLContext::readBack(render::RasterSurface& pixels)
    {
        if (shown < 0)
            return false;
        const CurrentContext current(*context);
        if (! current.ok())
            return false;
        const SavedState saved;
        glBindFramebuffer(GL_READ_FRAMEBUFFER, fronts[static_cast<std::size_t>(shown)].framebuffer);
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        glPixelStorei(GL_PACK_ALIGNMENT, 4);
        glPixelStorei(GL_PACK_ROW_LENGTH, 0);
        glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
        glPixelStorei(GL_PACK_SKIP_ROWS, 0);
        readback.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4);
        glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, readback.data());
        ++readbackCount;

        // Into the pixels: rows top first, BGRA, premultiplied.
        const int w = std::min(width, pixels.width());
        const int h = std::min(height, pixels.height());
        auto* out = static_cast<std::uint32_t*>(pixels.bitmap().pixels);
        for (int y = 0; y < h; ++y)
        {
            const std::uint8_t* row =
                readback.data() + static_cast<std::size_t>(height - 1 - y) * static_cast<std::size_t>(width) * 4;
            std::uint32_t* target = out + static_cast<std::size_t>(y) * static_cast<std::size_t>(pixels.width());
            for (int x = 0; x < w; ++x)
            {
                const std::uint8_t* p = row + static_cast<std::size_t>(x) * 4;
                std::uint32_t r = p[0];
                std::uint32_t g = p[1];
                std::uint32_t b = p[2];
                std::uint32_t a = granted.alpha ? p[3] : 255;
                if (! granted.premultipliedAlpha)
                {
                    r = (r * a + 127) / 255;
                    g = (g * a + 127) / 255;
                    b = (b * a + 127) / 255;
                }
                // Premultiplied colors never exceed their alpha.
                target[x] = (a << 24) | (std::min(r, a) << 16) | (std::min(g, a) << 8) | std::min(b, a);
            }
        }
        return true;
    }

    std::uint32_t WebGLContext::addSync(GLsync fence)
    {
        const std::uint32_t id = nextSync++;
        syncs.emplace(id, fence);
        return id;
    }

    GLsync WebGLContext::sync(std::uint32_t id) const
    {
        const auto found = syncs.find(id);
        return found != syncs.end() ? found->second : nullptr;
    }

    void WebGLContext::deleteSync(std::uint32_t id)
    {
        const auto found = syncs.find(id);
        if (found == syncs.end())
            return;
        glDeleteSync(found->second);
        syncs.erase(found);
    }

    bool WebGLContext::lost() const noexcept
    {
        return forcedLoss || resetLoss;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
