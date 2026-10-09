#pragma once

#include <soundor/Config.h>

#include <cstdint>
#include <memory>
#include <string>
#include <thread>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // Which GPUs are acceptable. A software renderer (SwiftShader, llvmpipe,
    // lavapipe, WARP) runs GPU work on the CPU: fine for tests, but a heavy
    // WebGL scene must not silently land there, so it is opt-in.
    enum class DevicePolicy : std::uint8_t
    {
        HardwareOnly,
        AllowSoftware,
        SoftwareOnly,
    };

    // The graphics API ANGLE drives.
    enum class Backend : std::uint8_t
    {
        Default, // the platform's: Metal, Direct3D 11, Vulkan
        Metal,
        Direct3D11,
        Vulkan,
        // Linux, through the system's EGL; only when asked for: its devices
        // share the system's EGL display, so they are not independent.
        OpenGL,
    };

    [[nodiscard]] const char* name(Backend backend) noexcept;

    struct DeviceInfo
    {
        Backend backend = Backend::Default;
        std::string renderer; // GL_RENDERER, e.g. "ANGLE (Apple, Apple M2, ...)"
        std::string vendor;
        bool software = false;
        // Whether its contexts share one texture namespace
        // (EGL_ANGLE_display_texture_share_group): how WebGL's images reach
        // the compositor without copies.
        bool sharesTextures = false;
        // Whether it has EGL fences the GPU can wait on (EGL_KHR_fence_sync,
        // EGL_KHR_wait_sync).
        bool fences = false;
        // Whether its contexts can learn of a GPU reset
        // (EGL_EXT_create_context_robustness): they are made to be lost then.
        bool resets = false;
    };

    // A GPU device and ANGLE's EGL display over it. It belongs to the thread
    // that created it (the UI thread): contexts are made, used and destroyed
    // there. Each Device has a display of its own, so destroying one never
    // affects another (another editor, another plugin); except OpenGL ones.
    class Device
    {
    public:
        struct Options
        {
            DevicePolicy policy = DevicePolicy::HardwareOnly;
            Backend backend = Backend::Default;
        };

        // A device that `options` accepts, or null (with the reason in
        // `failure`) when there is none.
        [[nodiscard]] static std::shared_ptr<Device> create(const Options& options, std::string* failure = nullptr);

        ~Device();
        Device(const Device&) = delete;
        Device& operator=(const Device&) = delete;

        [[nodiscard]] const DeviceInfo& info() const noexcept { return deviceInfo; }
        // The EGLDisplay.
        [[nodiscard]] void* display() const noexcept { return eglDisplay; }
        // Whether the calling thread is the device's.
        [[nodiscard]] bool onOwnerThread() const noexcept { return std::this_thread::get_id() == owner; }

    private:
        Device() = default;

        void* eglDisplay = nullptr;
        DeviceInfo deviceInfo;
        std::thread::id owner = std::this_thread::get_id();
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
