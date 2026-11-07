#include "gpu/Presentation.h"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        // Lets every click and move through to the window underneath (the
        // view's own), which handles input as if the child were not there.
        LRESULT CALLBACK passInput(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
        {
            if (message == WM_NCHITTEST)
                return HTTRANSPARENT;
            const auto original = reinterpret_cast<WNDPROC>(GetWindowLongPtrW(window, GWLP_USERDATA));
            return CallWindowProcW(original, window, message, wParam, lParam);
        }

        // A child window of the system's STATIC class over the view, for
        // ANGLE's swap chain: nothing is registered with the system.
        class ChildWindowPresentation final : public Presentation
        {
        public:
            explicit ChildWindowPresentation(HWND child) : window(child) {}

            ~ChildWindowPresentation() override { DestroyWindow(window); }

            void* nativeWindow() const noexcept override { return window; }

            void setBounds(float x, float y, float width, float height, float) override
            {
                const auto left = static_cast<int>(std::lround(x));
                const auto top = static_cast<int>(std::lround(y));
                SetWindowPos(window, HWND_TOP, left, top, static_cast<int>(std::lround(x + width)) - left,
                             static_cast<int>(std::lround(y + height)) - top, SWP_NOACTIVATE);
            }

            void setVisible(bool visible) override { ShowWindow(window, visible ? SW_SHOWNA : SW_HIDE); }

        private:
            HWND window;
        };
    } // namespace

    std::unique_ptr<Presentation> createPresentation(void* view, std::string* failure)
    {
        const auto parent = static_cast<HWND>(view);
        if (parent == nullptr || ! IsWindow(parent))
        {
            if (failure != nullptr)
                *failure = "no window to present in";
            return nullptr;
        }
        const HWND child =
            CreateWindowExW(WS_EX_NOPARENTNOTIFY, L"STATIC", L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0, 0, 1, 1,
                            parent, nullptr, GetModuleHandleW(nullptr), nullptr);
        if (child == nullptr)
        {
            if (failure != nullptr)
                *failure = "could not create a child window (" + std::to_string(GetLastError()) + ")";
            return nullptr;
        }
        SetWindowLongPtrW(child, GWLP_USERDATA, GetWindowLongPtrW(child, GWLP_WNDPROC));
        SetWindowLongPtrW(child, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&passInput));
        return std::make_unique<ChildWindowPresentation>(child);
    }

    bool presentationAvailable() noexcept
    {
        return true;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
