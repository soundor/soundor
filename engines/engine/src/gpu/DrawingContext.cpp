#include "gpu/DrawingContext.h"

#include "gpu/SharedImage.h"

#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    std::shared_ptr<DrawingContext> DrawingContext::create(std::shared_ptr<Device> device)
    {
        // Shared textures and server-side fences are required for asynchronous
        // handoff; unsupported devices keep the raster renderer.
        if (! device || ! device->info().sharesTextures || ! device->info().fences)
            return nullptr;
        auto result = std::make_shared<DrawingContext>();
        result->context = Context::create(std::move(device), {});
        if (! result->context)
            return nullptr;
        const auto current = result->makeCurrent();
        return current && result->healthy() ? result : nullptr;
    }

    std::unique_ptr<CurrentContext> DrawingContext::makeCurrent() const
    {
        auto current = std::make_unique<CurrentContext>(*context);
        return current->ok() ? std::move(current) : nullptr;
    }

    const Device* DrawingContext::device() const noexcept
    {
        return &context->device();
    }
    bool DrawingContext::healthy() const
    {
        return glGetGraphicsResetStatusEXT() == GL_NO_ERROR;
    }
    bool DrawingContext::takeStateChanged()
    {
        return std::exchange(stateChanged, false);
    }
    DrawingContext::Proc DrawingContext::procedure(const char* name)
    {
        return reinterpret_cast<Proc>(eglGetProcAddress(name));
    }

    class DrawingTexture::Image final : public SharedImage
    {
    public:
        std::shared_ptr<DrawingContext> owner;
        GLuint name = 0;
        int pixelWidth = 0;
        int pixelHeight = 0;
        EGLSyncKHR ready = EGL_NO_SYNC_KHR;
        EGLSyncKHR release = EGL_NO_SYNC_KHR;

        ~Image() override
        {
            const auto current = owner->makeCurrent();
            if (ready != EGL_NO_SYNC_KHR)
                eglDestroySyncKHR(owner->context->device().display(), ready);
            if (release != EGL_NO_SYNC_KHR)
                eglDestroySyncKHR(owner->context->device().display(), release);
            if (current && owner->healthy())
            {
                owner->stateChanged = true;
                glDeleteTextures(1, &name);
            }
        }
        [[nodiscard]] int width() const noexcept override { return pixelWidth; }
        [[nodiscard]] int height() const noexcept override { return pixelHeight; }
        [[nodiscard]] const Device* device() const noexcept override { return owner->device(); }
        [[nodiscard]] bool opaque() const noexcept override { return false; }
        [[nodiscard]] bool premultiplied() const noexcept override { return true; }
        [[nodiscard]] GLuint texture() const noexcept override { return name; }
        EGLSyncKHR takeReady() noexcept override { return std::exchange(ready, EGL_NO_SYNC_KHR); }
        void released(EGLSyncKHR fence) noexcept override
        {
            if (release != EGL_NO_SYNC_KHR)
                eglDestroySyncKHR(owner->context->device().display(), release);
            release = fence;
        }
        void waitRelease()
        {
            if (release == EGL_NO_SYNC_KHR)
                return;
            const auto display = owner->context->device().display();
            eglWaitSyncKHR(display, release, 0);
            eglDestroySyncKHR(display, release);
            release = EGL_NO_SYNC_KHR;
        }
        bool read(render::RasterSurface& pixels) override
        {
            const auto current = owner->makeCurrent();
            if (! current || ! owner->healthy())
                return false;
            owner->stateChanged = true;
            GLuint framebuffer = 0;
            glGenFramebuffers(1, &framebuffer);
            glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, name, 0);
            if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
            {
                glDeleteFramebuffers(1, &framebuffer);
                return false;
            }
            std::vector<std::uint8_t> rgba(static_cast<std::size_t>(pixelWidth) * static_cast<std::size_t>(pixelHeight)
                                           * 4);
            glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
            glPixelStorei(GL_PACK_ALIGNMENT, 4);
            glPixelStorei(GL_PACK_ROW_LENGTH, 0);
            glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
            glPixelStorei(GL_PACK_SKIP_ROWS, 0);
            glReadPixels(0, 0, pixelWidth, pixelHeight, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
            glDeleteFramebuffers(1, &framebuffer);
            pixels.resize(pixelWidth, pixelHeight);
            auto* out = static_cast<std::uint32_t*>(pixels.bitmap().pixels);
            for (int y = 0; y < pixelHeight; ++y)
                for (int x = 0; x < pixelWidth; ++x)
                {
                    const auto at =
                        (static_cast<std::size_t>(pixelHeight - y - 1) * static_cast<std::size_t>(pixelWidth)
                         + static_cast<std::size_t>(x))
                        * 4;
                    out[static_cast<std::size_t>(y) * static_cast<std::size_t>(pixelWidth)
                        + static_cast<std::size_t>(x)] = (std::uint32_t { rgba[at + 3] } << 24)
                                                         | (std::uint32_t { rgba[at] } << 16)
                                                         | (std::uint32_t { rgba[at + 1] } << 8) | rgba[at + 2];
                }
            return true;
        }
    };

    std::unique_ptr<DrawingTexture> DrawingTexture::create(std::shared_ptr<DrawingContext> context, int width,
                                                           int height)
    {
        const auto current = context->makeCurrent();
        if (! current || ! context->healthy() || width <= 0 || height <= 0)
            return nullptr;
        GLint limit = 0;
        glGetIntegerv(GL_MAX_TEXTURE_SIZE, &limit);
        if (width > limit || height > limit)
            return nullptr;
        auto result = std::make_unique<DrawingTexture>();
        result->shared = std::make_shared<Image>();
        auto& image = *result->shared;
        image.owner = std::move(context);
        image.pixelWidth = width;
        image.pixelHeight = height;
        image.owner->stateChanged = true;
        glGenTextures(1, &image.name);
        glBindTexture(GL_TEXTURE_2D, image.name);
        glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, width, height);
        if (glGetError() != GL_NO_ERROR)
            return nullptr;
        return result;
    }
    DrawingTexture::~DrawingTexture() = default;
    unsigned DrawingTexture::texture() const noexcept
    {
        return shared->name;
    }
    std::shared_ptr<render::GpuImage> DrawingTexture::image() const
    {
        return shared;
    }
    void DrawingTexture::beginWrite()
    {
        shared->waitRelease();
    }
    void DrawingTexture::publish()
    {
        const auto display = shared->owner->context->device().display();
        if (shared->ready != EGL_NO_SYNC_KHR)
            eglDestroySyncKHR(display, shared->ready);
        shared->ready = eglCreateSyncKHR(display, EGL_SYNC_FENCE_KHR, nullptr);
        glFlush();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
