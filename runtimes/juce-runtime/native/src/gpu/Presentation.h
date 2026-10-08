#pragma once

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

        // For eglCreateWindowSurface: a CALayer* (macOS), an HWND (Windows).
        [[nodiscard]] virtual void* nativeWindow() const noexcept = 0;
        // In the view's coordinates (points on macOS, pixels on Windows).
        virtual void setBounds(float x, float y, float width, float height, float scale) = 0;
        virtual void setVisible(bool visible) = 0;
    };

    // The platform's presentation in `view` (an NSView*, an HWND), or null
    // with the reason in `failure` where there is none (Linux).
    [[nodiscard]] std::unique_ptr<Presentation> createPresentation(void* view, std::string* failure);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
