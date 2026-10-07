#pragma once

#include "gpu/Context.h"
#include "gpu/Device.h"
#include "gpu/Egl.h"

#include <doctest/doctest.h>

#include <cstdlib>
#include <memory>
#include <string>

namespace soundor::test
{
    // Whether a missing GPU fails the test run instead of skipping GPU tests:
    // CI sets SOUNDOR_REQUIRE_GPU=1 where it provides one (a software one
    // will do), so GPU tests never pass by not running there.
    inline bool gpuRequired()
    {
        // Read before any thread is started.
        const char* value = std::getenv("SOUNDOR_REQUIRE_GPU"); // NOLINT(concurrency-mt-unsafe)
        return value != nullptr && std::string(value) == "1";
    }

    // A device for tests, software renderers included, or null when there
    // is none here: then the test reports that it was skipped, and why.
    // Where the platform's backend has no device, OpenGL (Linux) will do,
    // unless `independent` devices are needed.
    inline std::shared_ptr<gpu::Device> testDevice(bool independent = false)
    {
        std::string failure;
        auto device = gpu::Device::create({ .policy = gpu::DevicePolicy::AllowSoftware }, &failure);
#if defined(__linux__)
        if (device == nullptr && ! independent)
        {
            std::string fallback;
            device = gpu::Device::create(
                { .policy = gpu::DevicePolicy::AllowSoftware, .backend = gpu::Backend::OpenGL }, &fallback);
            failure += "; " + fallback;
        }
#else
        (void)independent;
#endif
        if (device == nullptr)
        {
            if (gpuRequired())
                FAIL("no GPU device, though SOUNDOR_REQUIRE_GPU=1: " << failure);
            else
                MESSAGE("skipped: no GPU device here (" << failure << ")");
        }
        return device;
    }

    // A shader program from GLSL ES 3.00 sources; fails the test with the
    // compiler's log when they do not compile or link.
    inline GLuint buildProgram(const char* vertexSource, const char* fragmentSource)
    {
        const auto compile = [](GLenum kind, const char* source)
        {
            const GLuint shader = glCreateShader(kind);
            glShaderSource(shader, 1, &source, nullptr);
            glCompileShader(shader);
            GLint compiled = GL_FALSE;
            glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
            if (compiled != GL_TRUE)
            {
                char log[1024] = {};
                glGetShaderInfoLog(shader, sizeof log, nullptr, log);
                FAIL("shader did not compile: " << log);
            }
            return shader;
        };
        const GLuint program = glCreateProgram();
        const GLuint vertex = compile(GL_VERTEX_SHADER, vertexSource);
        const GLuint fragment = compile(GL_FRAGMENT_SHADER, fragmentSource);
        glAttachShader(program, vertex);
        glAttachShader(program, fragment);
        glLinkProgram(program);
        glDeleteShader(vertex);
        glDeleteShader(fragment);
        GLint linked = GL_FALSE;
        glGetProgramiv(program, GL_LINK_STATUS, &linked);
        if (linked != GL_TRUE)
        {
            char log[1024] = {};
            glGetProgramInfoLog(program, sizeof log, nullptr, log);
            FAIL("program did not link: " << log);
        }
        return program;
    }
} // namespace soundor::test
