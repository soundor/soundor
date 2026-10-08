#include "gpu/LayerRenderer.h"

#include <algorithm>
#include <array>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        // A unit square, its corners mapped into the view by `transform`.
        constexpr const char* vertexShader = R"(#version 300 es
            uniform mat3 transform;
            uniform vec2 viewport;
            in vec2 corner;
            out vec2 uv;
            out vec2 pixel;
            void main() {
                vec3 at = transform * vec3(corner, 1.0);
                pixel = at.xy;
                uv = corner;
                gl_Position = vec4(at.x / viewport.x * 2.0 - 1.0, 1.0 - at.y / viewport.y * 2.0, 0.0, 1.0);
            })";

        // Premultiplied content, scaled by opacity and the rounded clip's
        // coverage (antialiased over a pixel).
        constexpr const char* fragmentShader = R"(#version 300 es
            precision highp float;
            uniform sampler2D content;
            uniform float opacity;
            uniform vec4 clip;
            uniform vec4 radii;
            in vec2 uv;
            in vec2 pixel;
            out vec4 color;
            float coverage() {
                vec2 center = (clip.xy + clip.zw) * 0.5;
                vec2 halfSize = (clip.zw - clip.xy) * 0.5;
                vec2 p = pixel - center;
                float r = p.x < 0.0 ? (p.y < 0.0 ? radii.x : radii.w) : (p.y < 0.0 ? radii.y : radii.z);
                vec2 q = abs(p) - halfSize + r;
                float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
                return clamp(0.5 - d, 0.0, 1.0);
            }
            void main() {
                color = texture(content, uv) * (opacity * coverage());
            })";

        GLuint compile(GLenum kind, const char* source)
        {
            const GLuint shader = glCreateShader(kind);
            glShaderSource(shader, 1, &source, nullptr);
            glCompileShader(shader);
            return shader;
        }
    } // namespace

    LayerRenderer::LayerRenderer(const Context& owner) : context(owner)
    {
        program = glCreateProgram();
        const GLuint vertex = compile(GL_VERTEX_SHADER, vertexShader);
        const GLuint fragment = compile(GL_FRAGMENT_SHADER, fragmentShader);
        glAttachShader(program, vertex);
        glAttachShader(program, fragment);
        glBindAttribLocation(program, 0, "corner");
        glLinkProgram(program);
        glDeleteShader(vertex);
        glDeleteShader(fragment);
        transformLocation = glGetUniformLocation(program, "transform");
        viewportLocation = glGetUniformLocation(program, "viewport");
        opacityLocation = glGetUniformLocation(program, "opacity");
        clipLocation = glGetUniformLocation(program, "clip");
        radiiLocation = glGetUniformLocation(program, "radii");

        glGenVertexArrays(1, &vertexArray);
        glBindVertexArray(vertexArray);
        constexpr std::array<float, 8> corners { 0, 0, 1, 0, 0, 1, 1, 1 };
        glGenBuffers(1, &quad);
        glBindBuffer(GL_ARRAY_BUFFER, quad);
        glBufferData(GL_ARRAY_BUFFER, sizeof corners, corners.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
        glBindVertexArray(0);
    }

    LayerRenderer::~LayerRenderer()
    {
        const CurrentContext current(context);
        reset();
        glDeleteBuffers(1, &quad);
        glDeleteVertexArrays(1, &vertexArray);
        glDeleteProgram(program);
    }

    void LayerRenderer::reset()
    {
        for (auto& [id, texture] : textures)
            glDeleteTextures(1, &texture.name);
        textures.clear();
        placed.clear();
    }

    bool LayerRenderer::upload(const render::Frame& frame, render::CompositorStatistics& stats)
    {
        ++frames;
        bool changed =
            ! std::ranges::equal(frame.layers, placed, [](const render::Layer& now, const render::Layer& before)
                                 { return now.samePlacement(before); });
        for (const render::Layer& layer : frame.layers)
        {
            const auto* raster = std::get_if<render::RasterContent>(&layer.content);
            if (raster == nullptr || raster->surface == nullptr)
                continue;
            const render::RasterSurface& surface = *raster->surface;
            Texture& texture = textures[layer.id];
            texture.used = frames;
            glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
            glPixelStorei(GL_UNPACK_ROW_LENGTH, surface.width());
            if (texture.name == 0 || texture.width != surface.width() || texture.height != surface.height())
            {
                // New, or resized: everything, in one go.
                if (texture.name == 0)
                    glGenTextures(1, &texture.name);
                glBindTexture(GL_TEXTURE_2D, texture.name);
                glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
                glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
                glTexImage2D(GL_TEXTURE_2D, 0, GL_BGRA_EXT, surface.width(), surface.height(), 0, GL_BGRA_EXT,
                             GL_UNSIGNED_BYTE, surface.pixels());
                texture.width = surface.width();
                texture.height = surface.height();
                ++stats.textureAllocations;
                stats.bytesUploaded += static_cast<long long>(surface.width()) * surface.height() * 4;
                changed = true;
                continue;
            }
            if (raster->damage.empty())
                continue;
            // Only what changed, straight from the surface's rows.
            glBindTexture(GL_TEXTURE_2D, texture.name);
            for (const render::IntRect& rect : raster->damage.rects())
            {
                const render::IntRect inside = rect.intersected(surface.bounds());
                if (inside.empty())
                    continue;
                glPixelStorei(GL_UNPACK_SKIP_PIXELS, inside.x);
                glPixelStorei(GL_UNPACK_SKIP_ROWS, inside.y);
                glTexSubImage2D(GL_TEXTURE_2D, 0, inside.x, inside.y, inside.width, inside.height, GL_BGRA_EXT,
                                GL_UNSIGNED_BYTE, surface.pixels());
                stats.bytesUploaded += inside.area() * 4;
            }
            changed = true;
        }
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
        glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
        // Textures of layers gone from the frame.
        std::erase_if(textures,
                      [&](auto& entry)
                      {
                          if (entry.second.used == frames)
                              return false;
                          glDeleteTextures(1, &entry.second.name);
                          return true;
                      });
        placed.clear();
        for (const render::Layer& layer : frame.layers)
            placed.push_back(
                { layer.id, layer.bounds, layer.transform, layer.opacity, layer.clip, render::RasterContent {} });
        return changed;
    }

    void LayerRenderer::draw(const render::Frame& frame, std::uint32_t background, render::CompositorStatistics& stats)
    {
        glViewport(0, 0, frame.width, frame.height);
        const auto channel = [&](int shift) { return static_cast<float>((background >> shift) & 0xFF) / 255.0f; };
        const float alpha = channel(24);
        glClearColor(channel(16) * alpha, channel(8) * alpha, channel(0) * alpha, alpha);
        glClear(GL_COLOR_BUFFER_BIT);
        glEnable(GL_BLEND);
        glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        glUseProgram(program);
        glBindVertexArray(vertexArray);
        glUniform2f(viewportLocation, static_cast<float>(frame.width), static_cast<float>(frame.height));
        glActiveTexture(GL_TEXTURE0);
        for (const render::Layer& layer : frame.layers)
        {
            const auto found = textures.find(layer.id);
            if (found == textures.end() || layer.opacity <= 0)
                continue;
            const render::Transform& t = layer.transform;
            const auto x = static_cast<float>(layer.bounds.x);
            const auto y = static_cast<float>(layer.bounds.y);
            const auto w = static_cast<float>(layer.bounds.width);
            const auto h = static_cast<float>(layer.bounds.height);
            const std::array<float, 9> matrix {
                t.a * w, t.b * w, 0, t.c * h, t.d * h, 0, t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f, 1
            };
            glUniformMatrix3fv(transformLocation, 1, GL_FALSE, matrix.data());
            glUniform1f(opacityLocation, std::min(layer.opacity, 1.0f));
            if (layer.clip)
            {
                const render::Clip& clip = *layer.clip;
                glUniform4f(clipLocation, clip.x, clip.y, clip.x + clip.width, clip.y + clip.height);
                glUniform4f(radiiLocation, clip.radii[0], clip.radii[1], clip.radii[2], clip.radii[3]);
            }
            else
            {
                glUniform4f(clipLocation, -1e6f, -1e6f, 1e6f, 1e6f);
                glUniform4f(radiiLocation, 0, 0, 0, 0);
            }
            glBindTexture(GL_TEXTURE_2D, found->second.name);
            // Pixel for pixel when only moved by whole pixels; filtered otherwise.
            const bool exact = layer.transform.isIntegerTranslate() && found->second.width == layer.bounds.width
                               && found->second.height == layer.bounds.height;
            const GLint filter = exact ? GL_NEAREST : GL_LINEAR;
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            ++stats.drawCalls;
        }
        stats.layersComposited = static_cast<int>(frame.layers.size());
        stats.pixelsComposited = static_cast<long long>(frame.width) * frame.height;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
