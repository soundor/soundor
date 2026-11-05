#include "EditorArea.h"

#include <SDL3/SDL.h>

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>

namespace soundor::vst3host
{
    namespace
    {
        class WindowsEditorArea final : public EditorArea
        {
        public:
            explicit WindowsEditorArea(HWND parent)
            {
                static const ATOM windowClass = []
                {
                    WNDCLASSEXW description {};
                    description.cbSize = sizeof description;
                    description.lpfnWndProc = DefWindowProcW;
                    description.hInstance = GetModuleHandleW(nullptr);
                    description.hCursor = LoadCursorW(nullptr, IDC_ARROW);
                    description.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
                    description.lpszClassName = L"SoundorVst3HostEditorArea";
                    return RegisterClassExW(&description);
                }();
                // The interface must not draw over the editor.
                SetWindowLongPtrW(parent, GWL_STYLE, GetWindowLongPtrW(parent, GWL_STYLE) | WS_CLIPCHILDREN);
                window_ = CreateWindowExW(0, MAKEINTATOM(windowClass), L"",
                                          WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 0, 0, 1, 1, parent,
                                          nullptr, GetModuleHandleW(nullptr), nullptr);
            }

            ~WindowsEditorArea() override { DestroyWindow(window_); }

            [[nodiscard]] const char* platformType() const override { return "HWND"; }
            [[nodiscard]] void* handle() const override { return window_; }

            void setFrame(int x, int y, int width, int height) override
            {
                SetWindowPos(window_, nullptr, x, y, std::max(width, 1), std::max(height, 1),
                             SWP_NOZORDER | SWP_NOACTIVATE);
            }

        private:
            HWND window_ = nullptr;
        };
    } // namespace

    std::unique_ptr<EditorArea> EditorArea::create(SDL_Window* window, std::string& error)
    {
        auto* parent = static_cast<HWND>(
            SDL_GetPointerProperty(SDL_GetWindowProperties(window), SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
        if (parent == nullptr)
        {
            error = "the host interface's window is not a Win32 window";
            return nullptr;
        }
        return std::make_unique<WindowsEditorArea>(parent);
    }
} // namespace soundor::vst3host
