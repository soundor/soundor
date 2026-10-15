#include "gpu/OffscreenCompositor.h"

#include "gpu/Egl.h"

#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    OffscreenCompositor::OffscreenCompositor(std::shared_ptr<Device> device, std::uint32_t backgroundColor)
        : owner(std::move(device)), background(backgroundColor)
    {
        context = Context::create(owner, {});
        if (context == nullptr)
            return;
        const CurrentContext current(*context);
        renderer = std::make_unique<LayerRenderer>(*context);
    }

    OffscreenCompositor::~OffscreenCompositor()
    {
        if (context == nullptr)
            return;
        renderer.reset();
        const CurrentContext current(*context);
        glDeleteFramebuffers(1, &framebuffer);
        glDeleteTextures(1, &texture);
    }

    render::Capabilities OffscreenCompositor::capabilities() const
    {
        return { .gpu = true,
                 .backend = std::string("ANGLE offscreen / ") + name(owner->info().backend),
                 .device = owner.get() };
    }

    void OffscreenCompositor::composite(const render::Frame& frame)
    {
        stats = {};
        if (renderer == nullptr || frame.width <= 0 || frame.height <= 0)
            return;
        const CurrentContext current(*context);
        if (frame.width != targetWidth || frame.height != targetHeight)
        {
            glDeleteFramebuffers(1, &framebuffer);
            glDeleteTextures(1, &texture);
            glGenTextures(1, &texture);
            glBindTexture(GL_TEXTURE_2D, texture);
            glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, frame.width, frame.height);
            glGenFramebuffers(1, &framebuffer);
            glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
            targetWidth = frame.width;
            targetHeight = frame.height;
            ++stats.textureAllocations;
        }
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
        if (! renderer->upload(frame, stats) && stats.textureAllocations == 0)
            return;
        renderer->draw(frame, background, stats);
    }

    std::vector<std::uint32_t> OffscreenCompositor::readPixels()
    {
        std::vector<std::uint32_t> pixels(static_cast<std::size_t>(targetWidth)
                                          * static_cast<std::size_t>(targetHeight));
        if (context == nullptr || pixels.empty())
            return pixels;
        const CurrentContext current(*context);
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
        std::vector<std::uint8_t> rgba(pixels.size() * 4);
        glReadPixels(0, 0, targetWidth, targetHeight, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
        // GL's rows go bottom up; Bitmap's top down, in BGRA.
        for (int y = 0; y < targetHeight; ++y)
            for (int x = 0; x < targetWidth; ++x)
            {
                const std::uint8_t* at =
                    rgba.data()
                    + (static_cast<std::size_t>(targetHeight - 1 - y) * static_cast<std::size_t>(targetWidth)
                       + static_cast<std::size_t>(x))
                          * 4;
                pixels[static_cast<std::size_t>(y) * static_cast<std::size_t>(targetWidth)
                       + static_cast<std::size_t>(x)] = (std::uint32_t { at[3] } << 24)
                                                        | (std::uint32_t { at[0] } << 16)
                                                        | (std::uint32_t { at[1] } << 8) | at[2];
            }
        return pixels;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
