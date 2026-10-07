#include "gpu/Device.h"

#include "gpu/Egl.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        struct Candidate
        {
            Backend backend;
            EGLAttrib type;
            EGLAttrib deviceType;
        };

        // What to try for `options`, best first.
        std::vector<Candidate> candidates(const Device::Options& options)
        {
            const EGLAttrib hardware = EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE;
            std::vector<Candidate> all;
#if defined(__APPLE__)
            all.push_back({ Backend::Metal, EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE, hardware });
#elif defined(_WIN32)
            // WARP is Direct3D's software rasterizer.
            const bool software = options.policy == DevicePolicy::SoftwareOnly;
            all.push_back({ Backend::Direct3D11, EGL_PLATFORM_ANGLE_TYPE_D3D11_ANGLE,
                            software ? EGL_PLATFORM_ANGLE_DEVICE_TYPE_D3D_WARP_ANGLE : hardware });
            if (options.policy == DevicePolicy::AllowSoftware)
                all.push_back({ Backend::Direct3D11, EGL_PLATFORM_ANGLE_TYPE_D3D11_ANGLE,
                                EGL_PLATFORM_ANGLE_DEVICE_TYPE_D3D_WARP_ANGLE });
#else
            // A software Vulkan (lavapipe) is only told apart by its name, below.
            all.push_back({ Backend::Vulkan, EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE, hardware });
            // OpenGL through the system's EGL, only when asked for: every
            // user of EGL in the process shares the system's display, so one
            // device's teardown ends the others' (another editor's, another
            // plugin's). For development machines without Vulkan.
            if (options.backend == Backend::OpenGL)
                all.push_back({ Backend::OpenGL, EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE,
                                EGL_PLATFORM_ANGLE_DEVICE_TYPE_EGL_ANGLE });
#endif
            if (options.backend != Backend::Default)
                std::erase_if(all, [&](const Candidate& candidate) { return candidate.backend != options.backend; });
            return all;
        }

        bool contains(std::string_view text, std::string_view word)
        {
            const auto lower = [](char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); };
            return std::search(text.begin(), text.end(), word.begin(), word.end(),
                               [&](char a, char b) { return lower(a) == lower(b); })
                   != text.end();
        }

        // Whether a GL_RENDERER string names a renderer that runs on the CPU.
        bool isSoftware(std::string_view renderer)
        {
            constexpr std::array<std::string_view, 7> names { "swiftshader", "llvmpipe", "lavapipe",
                                                              "softpipe",    "warp",     "basic render driver",
                                                              "software" };
            return std::ranges::any_of(names, [&](std::string_view name) { return contains(renderer, name); });
        }

        // Every Device gets a display of its own (EGL hands out one display per
        // platform and attributes otherwise).
        EGLAttrib nextDisplayKey()
        {
            static std::atomic<EGLAttrib> next { 1 };
            return next.fetch_add(1, std::memory_order_relaxed);
        }

        // GL_RENDERER and GL_VENDOR, read through a throwaway context.
        bool describe(EGLDisplay display, DeviceInfo& info)
        {
            const EGLint attributes[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_NONE };
            EGLContext context = eglCreateContext(display, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attributes);
            if (context == EGL_NO_CONTEXT)
                return false;
            EGLDisplay previousDisplay = eglGetCurrentDisplay();
            EGLContext previousContext = eglGetCurrentContext();
            EGLSurface previousDraw = eglGetCurrentSurface(EGL_DRAW);
            EGLSurface previousRead = eglGetCurrentSurface(EGL_READ);
            const bool current = eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context) == EGL_TRUE;
            if (current)
            {
                const auto* renderer = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
                const auto* vendor = reinterpret_cast<const char*>(glGetString(GL_VENDOR));
                info.renderer = renderer != nullptr ? renderer : "";
                info.vendor = vendor != nullptr ? vendor : "";
                info.software = isSoftware(info.renderer);
                eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            }
            if (previousContext != EGL_NO_CONTEXT)
                eglMakeCurrent(previousDisplay, previousDraw, previousRead, previousContext);
            eglDestroyContext(display, context);
            return current;
        }
    } // namespace

    const char* name(Backend backend) noexcept
    {
        switch (backend)
        {
            case Backend::Default:
                return "default";
            case Backend::Metal:
                return "Metal";
            case Backend::Direct3D11:
                return "Direct3D 11";
            case Backend::Vulkan:
                return "Vulkan";
            case Backend::OpenGL:
                return "OpenGL";
        }
        return "unknown";
    }

    std::shared_ptr<Device> Device::create(const Options& options, std::string* failure)
    {
        std::string reasons;
        for (const Candidate& candidate : candidates(options))
        {
            const EGLAttrib attributes[] = {
                EGL_PLATFORM_ANGLE_TYPE_ANGLE,
                candidate.type,
                EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE,
                candidate.deviceType,
                EGL_PLATFORM_ANGLE_DISPLAY_KEY_ANGLE,
                nextDisplayKey(),
                EGL_NONE,
            };
            EGLDisplay display = eglGetPlatformDisplay(EGL_PLATFORM_ANGLE_ANGLE,
                                                       reinterpret_cast<void*>(EGL_DEFAULT_DISPLAY), attributes);
            if (display == EGL_NO_DISPLAY || eglInitialize(display, nullptr, nullptr) != EGL_TRUE)
            {
                reasons += std::string(reasons.empty() ? "" : "; ") + name(candidate.backend) + ": no device";
                if (display != EGL_NO_DISPLAY)
                    eglTerminate(display);
                continue;
            }
            std::shared_ptr<Device> device(new Device());
            device->eglDisplay = display;
            device->deviceInfo.backend = candidate.backend;
            if (! describe(display, device->deviceInfo))
            {
                reasons +=
                    std::string(reasons.empty() ? "" : "; ") + name(candidate.backend) + ": no OpenGL ES 3 context";
                continue;
            }
            const bool software = device->deviceInfo.software;
            if ((software && options.policy == DevicePolicy::HardwareOnly)
                || (! software && options.policy == DevicePolicy::SoftwareOnly))
            {
                reasons += std::string(reasons.empty() ? "" : "; ") + name(candidate.backend) + ": "
                           + device->deviceInfo.renderer + (software ? " is a software renderer" : " is not software");
                continue;
            }
            return device;
        }
        if (failure != nullptr)
            *failure = reasons.empty() ? "no backend to try" : reasons;
        return nullptr;
    }

    Device::~Device()
    {
        if (eglDisplay != nullptr)
            eglTerminate(eglDisplay);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
