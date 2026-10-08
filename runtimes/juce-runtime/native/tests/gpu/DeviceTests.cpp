#include "GpuTestSupport.h"

#include <array>
#include <cstring>
#include <string>
#include <string_view>

using namespace soundor;

namespace
{
    struct Rgba
    {
        int r = 0;
        int g = 0;
        int b = 0;
        int a = 0;
    };

    Rgba readPixel(int x, int y)
    {
        std::array<unsigned char, 4> pixel {};
        glReadPixels(x, y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel.data());
        return { pixel[0], pixel[1], pixel[2], pixel[3] };
    }

    // A size×size RGBA8 texture as the target of a new framebuffer, bound.
    struct Target
    {
        explicit Target(int size)
        {
            glGenTextures(1, &texture);
            glBindTexture(GL_TEXTURE_2D, texture);
            glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, size, size);
            glGenFramebuffers(1, &framebuffer);
            glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
            glViewport(0, 0, size, size);
        }
        ~Target()
        {
            glDeleteFramebuffers(1, &framebuffer);
            glDeleteTextures(1, &texture);
        }
        Target(const Target&) = delete;
        Target& operator=(const Target&) = delete;

        GLuint texture = 0;
        GLuint framebuffer = 0;
    };

    constexpr const char* vertexShader = R"(#version 300 es
        in vec2 position;
        void main() { gl_Position = vec4(position, 0.0, 1.0); })";
    constexpr const char* fragmentShader = R"(#version 300 es
        precision mediump float;
        uniform vec4 color;
        out vec4 fragment;
        void main() { fragment = color; })";

    // Draws a triangle covering the target's lower middle in `color`.
    void drawTriangle(float r, float g, float b, float a)
    {
        const GLuint program = test::buildProgram(vertexShader, fragmentShader);
        glUseProgram(program);
        glUniform4f(glGetUniformLocation(program, "color"), r, g, b, a);
        GLuint array = 0;
        GLuint buffer = 0;
        glGenVertexArrays(1, &array);
        glBindVertexArray(array);
        constexpr std::array<float, 6> triangle { -1, -1, 1, -1, 0, 1 };
        glGenBuffers(1, &buffer);
        glBindBuffer(GL_ARRAY_BUFFER, buffer);
        glBufferData(GL_ARRAY_BUFFER, sizeof triangle, triangle.data(), GL_STATIC_DRAW);
        const auto position = static_cast<GLuint>(glGetAttribLocation(program, "position"));
        glEnableVertexAttribArray(position);
        glVertexAttribPointer(position, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDeleteBuffers(1, &buffer);
        glDeleteVertexArrays(1, &array);
        glDeleteProgram(program);
    }

    bool hasExtension(std::string_view name)
    {
        const auto* extensions = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
        if (extensions == nullptr)
            return false;
        const std::string_view all(extensions);
        for (std::size_t at = 0; at < all.size();)
        {
            const std::size_t end = std::min(all.find(' ', at), all.size());
            if (all.substr(at, end - at) == name)
                return true;
            at = end + 1;
        }
        return false;
    }
} // namespace

TEST_SUITE("gpu::Device")
{
    TEST_CASE("a device says what it is")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        MESSAGE("GPU: " << std::string(gpu::name(device->info().backend)) << ", " << device->info().renderer);
        CHECK(device->info().backend != gpu::Backend::Default);
        CHECK_FALSE(device->info().renderer.empty());
        CHECK(device->onOwnerThread());

        // A machine with only a software renderer has no hardware device.
        if (device->info().software)
        {
            std::string failure;
            CHECK(gpu::Device::create({ .policy = gpu::DevicePolicy::HardwareOnly, .backend = device->info().backend },
                                      &failure)
                  == nullptr);
            CHECK(failure.find("software renderer") != std::string::npos);
        }
    }

    TEST_CASE("renders a triangle offscreen and reads it back")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        std::string failure;
        const auto context = gpu::Context::create(device, {}, &failure);
        REQUIRE_MESSAGE(context.get() != nullptr, failure);
        const gpu::CurrentContext current(*context);
        REQUIRE(current.ok());

        const Target target(64);
        REQUIRE(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE);
        glClearColor(0, 0, 0, 0);
        glClear(GL_COLOR_BUFFER_BIT);
        drawTriangle(1, 0, 0, 1);

        const Rgba inside = readPixel(32, 20);
        CHECK(inside.r == 255);
        CHECK(inside.g == 0);
        CHECK(inside.a == 255);
        const Rgba corner = readPixel(1, 62);
        CHECK(corner.a == 0);
        CHECK(glGetError() == GL_NO_ERROR);
    }

    TEST_CASE("a WebGL-compatible context validates like WebGL and enables extensions on request")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        const auto context = gpu::Context::create(device, { .webgl = true });
        REQUIRE(context.get() != nullptr);
        const gpu::CurrentContext current(*context);
        REQUIRE(current.ok());

        REQUIRE(hasExtension("GL_ANGLE_request_extension"));
        // Robust resource initialization: new storage reads back as zeros.
        const Target target(16);
        CHECK(readPixel(8, 8).a == 0);

        // Extensions start off and appear once requested.
        const auto* requestable = reinterpret_cast<const char*>(glGetString(GL_REQUESTABLE_EXTENSIONS_ANGLE));
        REQUIRE(requestable != nullptr);
        if (std::strstr(requestable, "GL_EXT_color_buffer_float") != nullptr)
        {
            CHECK_FALSE(hasExtension("GL_EXT_color_buffer_float"));
            glRequestExtensionANGLE("GL_EXT_color_buffer_float");
            CHECK(hasExtension("GL_EXT_color_buffer_float"));
        }

        // WebGL forbids what plain ES allows: drawing from client memory.
        const GLuint program = test::buildProgram(vertexShader, fragmentShader);
        glUseProgram(program);
        const std::array<float, 6> triangle { -1, -1, 1, -1, 0, 1 };
        glBindBuffer(GL_ARRAY_BUFFER, 0);
        const auto position = static_cast<GLuint>(glGetAttribLocation(program, "position"));
        glEnableVertexAttribArray(position);
        glVertexAttribPointer(position, 2, GL_FLOAT, GL_FALSE, 0, triangle.data());
        glDrawArrays(GL_TRIANGLES, 0, 3);
        CHECK(glGetError() == GL_INVALID_OPERATION);
        glDeleteProgram(program);
    }

    TEST_CASE("devices are independent: destroying one leaves the other working")
    {
        auto first = test::testDevice(true);
        if (first == nullptr)
            return;
        const auto second = test::testDevice(true);
        REQUIRE(second.get() != nullptr);
        CHECK(first->display() != second->display());

        auto firstContext = gpu::Context::create(first, {});
        const auto secondContext = gpu::Context::create(second, {});
        REQUIRE(firstContext.get() != nullptr);
        REQUIRE(secondContext.get() != nullptr);
        {
            const gpu::CurrentContext current(*firstContext);
            const Target target(8);
            glClearColor(0, 1, 0, 1);
            glClear(GL_COLOR_BUFFER_BIT);
            CHECK(readPixel(4, 4).g == 255);
        }
        firstContext.reset();
        first.reset();

        const gpu::CurrentContext current(*secondContext);
        REQUIRE(current.ok());
        const Target target(8);
        glClearColor(0, 0, 1, 1);
        glClear(GL_COLOR_BUFFER_BIT);
        CHECK(readPixel(4, 4).b == 255);
        CHECK(glGetError() == GL_NO_ERROR);
    }

    TEST_CASE("a current context is restored after a nested one")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        const auto outer = gpu::Context::create(device, {});
        const auto inner = gpu::Context::create(device, {});
        REQUIRE(outer.get() != nullptr);
        REQUIRE(inner.get() != nullptr);
        const gpu::CurrentContext outerScope(*outer);
        CHECK(eglGetCurrentContext() == outer->handle());
        {
            const gpu::CurrentContext innerScope(*inner);
            CHECK(eglGetCurrentContext() == inner->handle());
        }
        CHECK(eglGetCurrentContext() == outer->handle());
    }
}
