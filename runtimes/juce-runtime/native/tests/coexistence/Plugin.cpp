// A stand-in for one Soundor plugin binary in the coexistence test: the whole
// runtime under its own ABI namespace, a UI that draws a color of its own and
// counts clicks, behind a small C entry point table. With the GPU, each
// instance also draws its color with its own ANGLE device.

#include <soundor/a11y/Platform.h>
#include <soundor/runtime/RuntimeHost.h>

#if SOUNDOR_HAS_GPU
    #include "gpu/Context.h"
    #include "gpu/Egl.h"
#endif

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#if defined(_WIN32)
    #define SOUNDOR_COEXIST_EXPORT extern "C" __declspec(dllexport)
#else
    #define SOUNDOR_COEXIST_EXPORT extern "C" __attribute__((visibility("default")))
#endif

namespace
{
    constexpr int size = 64;

    struct Instance
    {
        Instance()
        {
            host.surface().setSize({ size, size });
            const std::string ui = std::string("const COLOR = '") + SOUNDOR_COEXIST_COLOR + "';\n" + R"(
                import { root, createView } from 'soundor:ui';
                globalThis.count = 0;
                const box = createView({ width: 64, height: 64, backgroundColor: COLOR });
                box.addEventListener('click', () => { globalThis.count += 1; });
                root.appendChild(box);
            )";
            ok = host.context().evaluateModule(ui, "/coexist.js").ok();
        }

        soundor::RuntimeHost host { {} };
        // Each plugin's own platform accessibility (AccessKit on Linux and
        // Windows), side by side in one process.
        std::unique_ptr<soundor::a11y::PlatformAccessibility> accessibility =
            soundor::a11y::createPlatformAccessibility({ {}, SOUNDOR_COEXIST_COLOR });
        std::vector<std::uint32_t> pixels = std::vector<std::uint32_t>(std::size_t { size } * size);
        bool ok = false;
#if SOUNDOR_HAS_GPU
        std::shared_ptr<soundor::gpu::Device> device;
        std::unique_ptr<soundor::gpu::Context> context;
#endif
    };

#if SOUNDOR_HAS_GPU
    // Draws a triangle in the plugin's color with the instance's own device
    // (shader compiler and all) and reads the middle back; 0 without a GPU.
    std::uint32_t drawWithGpu(Instance& instance)
    {
        using namespace soundor;
        if (instance.device == nullptr)
            instance.device = gpu::Device::create({ .policy = gpu::DevicePolicy::AllowSoftware });
        if (instance.device == nullptr)
            return 0;
        if (instance.context == nullptr)
            instance.context = gpu::Context::create(instance.device, {});
        if (instance.context == nullptr)
            return 0;
        const gpu::CurrentContext current(*instance.context);
        GLuint texture = 0;
        GLuint framebuffer = 0;
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D, texture);
        glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, size, size);
        glGenFramebuffers(1, &framebuffer);
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
        glViewport(0, 0, size, size);
        glClearColor(0, 0, 0, 0);
        glClear(GL_COLOR_BUFFER_BIT);

        const std::string red = std::string(SOUNDOR_COEXIST_COLOR) == "red" ? "1.0" : "0.0";
        const std::string blue = std::string(SOUNDOR_COEXIST_COLOR) == "blue" ? "1.0" : "0.0";
        const std::string fragment = "#version 300 es\nprecision mediump float; out vec4 color;\n"
                                     "void main() { color = vec4("
                                     + red + ", 0.0, " + blue + ", 1.0); }";
        const char* vertex = "#version 300 es\nvoid main() {\n"
                             "  vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));\n"
                             "  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0); }";
        const auto compile = [](GLenum kind, const char* source)
        {
            const GLuint shader = glCreateShader(kind);
            glShaderSource(shader, 1, &source, nullptr);
            glCompileShader(shader);
            return shader;
        };
        const GLuint program = glCreateProgram();
        const char* fragmentSource = fragment.c_str();
        glAttachShader(program, compile(GL_VERTEX_SHADER, vertex));
        glAttachShader(program, compile(GL_FRAGMENT_SHADER, fragmentSource));
        glLinkProgram(program);
        glUseProgram(program);
        GLuint array = 0;
        glGenVertexArrays(1, &array);
        glBindVertexArray(array);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        unsigned char pixel[4] = {};
        glReadPixels(size / 2, size / 2, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
        glDeleteVertexArrays(1, &array);
        glDeleteProgram(program);
        glDeleteFramebuffers(1, &framebuffer);
        glDeleteTextures(1, &texture);
        return (std::uint32_t { pixel[3] } << 24) | (std::uint32_t { pixel[0] } << 16)
               | (std::uint32_t { pixel[1] } << 8) | pixel[2];
    }
#endif

    soundor::ui::PointerInput press(soundor::ui::PointerInput::Phase phase, unsigned buttons)
    {
        soundor::ui::PointerInput input;
        input.phase = phase;
        input.position = { 10, 10 };
        input.button = 0;
        input.buttons = buttons;
        return input;
    }
} // namespace

SOUNDOR_COEXIST_EXPORT void* soundor_coexist_create()
{
    auto* instance = new Instance();
    if (instance->ok)
        return instance;
    delete instance;
    return nullptr;
}

// Clicks the instance's view; returns its click count.
SOUNDOR_COEXIST_EXPORT int soundor_coexist_click(void* handle)
{
    auto& instance = *static_cast<Instance*>(handle);
    instance.host.surface().pointer(press(soundor::ui::PointerInput::Phase::Down, 1));
    instance.host.surface().pointer(press(soundor::ui::PointerInput::Phase::Up, 0));
    instance.host.tick();
    if (instance.accessibility != nullptr)
        instance.accessibility->tick(instance.host);
    auto count = instance.host.context().evaluateScript("count");
    return count ? static_cast<int>(count.value().asNumber()) : -1;
}

// Renders the instance; returns the pixel in the middle (0xAARRGGBB).
SOUNDOR_COEXIST_EXPORT std::uint32_t soundor_coexist_pixel(void* handle)
{
    auto& instance = *static_cast<Instance*>(handle);
    instance.host.tick();
    instance.host.render({ instance.pixels.data(), size, size, std::size_t { size } * 4 });
    return instance.pixels[(std::size_t { size } * size / 2) + (size / 2)];
}

// Draws the instance's color on the GPU; the pixel in the middle
// (0xAARRGGBB), or 0 without a GPU.
SOUNDOR_COEXIST_EXPORT std::uint32_t soundor_coexist_gpu_pixel(void* handle)
{
#if SOUNDOR_HAS_GPU
    return drawWithGpu(*static_cast<Instance*>(handle));
#else
    (void)handle;
    return 0;
#endif
}

SOUNDOR_COEXIST_EXPORT void soundor_coexist_destroy(void* handle)
{
    delete static_cast<Instance*>(handle);
}
