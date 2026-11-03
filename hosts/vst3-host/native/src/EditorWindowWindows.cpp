#include "EditorWindow.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <string>

namespace soundor::vst3host
{
    namespace
    {
        std::wstring widen(const std::string& text)
        {
            const int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
            std::wstring result(static_cast<size_t>(std::max(size, 1)), L'\0');
            MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, result.data(), size);
            result.resize(static_cast<size_t>(std::max(size - 1, 0)));
            return result;
        }

        constexpr DWORD resizableStyle = WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN;
        constexpr DWORD fixedStyle = (WS_OVERLAPPEDWINDOW & ~(WS_THICKFRAME | WS_MAXIMIZEBOX)) | WS_CLIPCHILDREN;

        class WindowsEditorWindow final : public EditorWindow
        {
        public:
            WindowsEditorWindow(EventLoop& loop, const std::string& title, int width, int height, Callbacks callbacks)
                : loop_(loop), callbacks_(std::move(callbacks))
            {
                static const ATOM windowClass = []
                {
                    WNDCLASSEXW description {};
                    description.cbSize = sizeof description;
                    description.style = CS_HREDRAW | CS_VREDRAW;
                    description.lpfnWndProc = &WindowsEditorWindow::windowProc;
                    description.hInstance = GetModuleHandleW(nullptr);
                    description.hCursor = LoadCursorW(nullptr, IDC_ARROW);
                    description.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
                    description.lpszClassName = L"SoundorVst3HostEditor";
                    return RegisterClassExW(&description);
                }();
                window_ =
                    CreateWindowExW(0, MAKEINTATOM(windowClass), widen(title).c_str(), resizableStyle, CW_USEDEFAULT,
                                    CW_USEDEFAULT, width, height, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
                SetWindowLongPtrW(window_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
                setContentSize(width, height);
            }

            ~WindowsEditorWindow() override
            {
                SetWindowLongPtrW(window_, GWLP_USERDATA, 0);
                DestroyWindow(window_);
            }

            [[nodiscard]] const char* platformType() const override { return "HWND"; }
            [[nodiscard]] void* parentHandle() const override { return window_; }

            void setResizable(bool resizable) override
            {
                resizable_ = resizable;
                SetWindowLongPtrW(window_, GWL_STYLE,
                                  static_cast<LONG_PTR>(resizable ? resizableStyle : fixedStyle)
                                      | (IsWindowVisible(window_) ? WS_VISIBLE : 0));
                RECT client {};
                GetClientRect(window_, &client);
                setContentSize(client.right - client.left, client.bottom - client.top);
            }

            void setContentSize(int width, int height) override
            {
                RECT rect { 0, 0, width, height };
                const DWORD style = resizable_ ? resizableStyle : fixedStyle;
                AdjustWindowRectExForDpi(&rect, style, FALSE, 0, GetDpiForWindow(window_));
                ignoreResize_ = true;
                SetWindowPos(window_, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
                             SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
                ignoreResize_ = false;
            }

            void show() override
            {
                ShowWindow(window_, SW_SHOWNORMAL);
                SetForegroundWindow(window_);
            }

            [[nodiscard]] double scale() const override { return static_cast<double>(GetDpiForWindow(window_)) / 96.0; }

        private:
            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
            {
                auto* self = reinterpret_cast<WindowsEditorWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
                if (self == nullptr)
                    return DefWindowProcW(window, message, wParam, lParam);
                switch (message)
                {
                    case WM_SIZE:
                        if (! self->ignoreResize_ && wParam != SIZE_MINIMIZED && self->callbacks_.resized)
                            self->callbacks_.resized(LOWORD(lParam), HIWORD(lParam));
                        return 0;
                    case WM_ACTIVATE:
                        if (self->callbacks_.focusChanged)
                            self->callbacks_.focusChanged(LOWORD(wParam) != WA_INACTIVE);
                        break;
                    case WM_DPICHANGED:
                    {
                        const auto* suggested = reinterpret_cast<const RECT*>(lParam);
                        SetWindowPos(window, nullptr, suggested->left, suggested->top,
                                     suggested->right - suggested->left, suggested->bottom - suggested->top,
                                     SWP_NOZORDER | SWP_NOACTIVATE);
                        if (self->callbacks_.scaleChanged)
                            self->callbacks_.scaleChanged(static_cast<double>(HIWORD(wParam)) / 96.0);
                        return 0;
                    }
                    case WM_CLOSE:
                        // The callback destroys this window.
                        if (self->callbacks_.closed)
                            self->loop_.post(self->callbacks_.closed);
                        return 0;
                    default:
                        break;
                }
                return DefWindowProcW(window, message, wParam, lParam);
            }

            EventLoop& loop_;
            Callbacks callbacks_;
            HWND window_ = nullptr;
            bool resizable_ = true;
            bool ignoreResize_ = false;
        };
    } // namespace

    std::unique_ptr<EditorWindow> EditorWindow::create(EventLoop& loop, const std::string& title, int width, int height,
                                                       Callbacks callbacks, std::string& /*error*/)
    {
        return std::make_unique<WindowsEditorWindow>(loop, title, width, height, std::move(callbacks));
    }
} // namespace soundor::vst3host
