#pragma once

#include "gpu/Context.h"
#include "gpu/Egl.h"

#include <soundor/render/Compositor.h>
#include <soundor/render/Frame.h>

#include <cstdint>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    class SharedImage;

    // Draws a render::Frame's layers with OpenGL ES into the current
    // framebuffer: CPU layers become textures, uploaded only where they
    // changed, GPU images whose textures it shares are drawn from where
    // they are, then each layer is one textured quad with its transform,
    // opacity and rounded clip. Deliberately small: Skia draws the UI, this
    // only puts layers together.
    //
    // Its GL objects belong to `context`, which must be current whenever it
    // is used (and is made current to destroy it).
    class LayerRenderer
    {
    public:
        explicit LayerRenderer(const Context& owner);
        ~LayerRenderer();
        LayerRenderer(const LayerRenderer&) = delete;
        LayerRenderer& operator=(const LayerRenderer&) = delete;

        // Brings the layers' textures up to date with `frame`; returns
        // whether the picture changed (a texture or a layer's placement).
        bool upload(const render::Frame& frame, render::CompositorStatistics& stats);
        // Draws every layer of `frame`, bottom to top, over `background`
        // (0xAARRGGBB), into a framebuffer of the frame's size.
        void draw(const render::Frame& frame, std::uint32_t background, render::CompositorStatistics& stats);
        // Forgets every texture: the next upload() sends everything again.
        void reset();

    private:
        struct Texture
        {
            GLuint name = 0;
            int width = 0;
            int height = 0;
            std::uint64_t used = 0;
        };

        // A GPU image this context can draw (its texture is in this device's
        // shared namespace), or null (another device, no picture yet).
        [[nodiscard]] SharedImage* drawable(const render::GpuContent& content) const;

        const Context& context;
        GLuint program = 0;
        GLuint vertexArray = 0;
        GLuint quad = 0;
        GLint transformLocation = -1;
        GLint viewportLocation = -1;
        GLint opacityLocation = -1;
        GLint clipLocation = -1;
        GLint radiiLocation = -1;
        GLint flipLocation = -1;
        GLint opaqueLocation = -1;
        GLint premultiplyLocation = -1;
        std::unordered_map<render::LayerId, Texture> textures;
        std::vector<render::Layer> placed;
        std::uint64_t frames = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
