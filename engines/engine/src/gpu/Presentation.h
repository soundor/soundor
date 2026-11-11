#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // Where a GPU compositor's picture goes on screen: a native window ANGLE
    // presents to, inside the view the backend gives. It adds nothing to the
    // process: no class of its own is subclassed or registered.
    class Presentation
    {
    public:
        virtual ~Presentation() = default;

        // For eglCreateWindowSurface: CALayer* (macOS), HWND (Windows),
        // an X11 Window cast to void* (Linux).
        [[nodiscard]] virtual void* nativeWindow() const noexcept = 0;
        // In the view's coordinates (points on macOS, pixels on Windows and Linux).
        virtual void setBounds(float x, float y, float width, float height, float scale) = 0;
        virtual void setVisible(bool visible) = 0;
        [[nodiscard]] virtual bool healthy() const noexcept { return true; }
    };

    // The platform's presentation in `view` (NSView*, HWND, or X11 Window
    // cast to void*), or null with the reason in `failure`.
    [[nodiscard]] std::unique_ptr<Presentation> createPresentation(void* view, std::string* failure);
    // Whether this platform has a presentation at all.
    [[nodiscard]] bool presentationAvailable() noexcept;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
