// Windows: the editor's window, a child HWND of the system's STATIC class
// (nothing is registered with the system, as the engine's own child windows),
// subclassed to paint the CPU frames, show the cursor and take input (a
// STATIC is otherwise transparent to the pointer).

#include "NativeWindow.h"

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
// After windows.h, which it needs.
#include <commctrl.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace soundor::vst3
{
    namespace
    {
        constexpr UINT_PTR subclassId = 0x53564733; // "SVG3"

        HCURSOR cursorOf(ui::Cursor cursor)
        {
            const auto load = [](LPCWSTR id) { return LoadCursorW(nullptr, id); };
            switch (cursor)
            {
                case ui::Cursor::Pointer:
                    return load(IDC_HAND);
                case ui::Cursor::Text:
                    return load(IDC_IBEAM);
                case ui::Cursor::Crosshair:
                    return load(IDC_CROSS);
                case ui::Cursor::Move:
                    return load(IDC_SIZEALL);
                case ui::Cursor::EwResize:
                    return load(IDC_SIZEWE);
                case ui::Cursor::NsResize:
                    return load(IDC_SIZENS);
                case ui::Cursor::NeswResize:
                    return load(IDC_SIZENESW);
                case ui::Cursor::NwseResize:
                    return load(IDC_SIZENWSE);
                case ui::Cursor::None:
                    return nullptr;
                default:
                    return load(IDC_ARROW);
            }
        }

        class WindowsWindow;

        // A CPU compositor's frames, painted with SetDIBitsToDevice.
        class DibTarget final : public render::RasterTarget
        {
        public:
            explicit DibTarget(WindowsWindow& owner) : window(owner) {}

            Pixels acquire(int width, int height) override
            {
                width = std::max(1, width);
                height = std::max(1, height);
                bool preserved = true;
                if (width != imageWidth || height != imageHeight)
                {
                    preserved = false;
                    pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
                    imageWidth = width;
                    imageHeight = height;
                }
                return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
            }

            void present(const render::Region& damage) override;

            // Paints the frame at (left, top) in `context`.
            void paint(HDC context, int left, int top) const
            {
                if (pixels.empty())
                    return;
                BITMAPINFO info {};
                info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
                info.bmiHeader.biWidth = imageWidth;
                // Top-down rows: B, G, R, A in memory, the engine's Bitmap.
                info.bmiHeader.biHeight = -imageHeight;
                info.bmiHeader.biPlanes = 1;
                info.bmiHeader.biBitCount = 32;
                info.bmiHeader.biCompression = BI_RGB;
                SetDIBitsToDevice(context, left, top, static_cast<DWORD>(imageWidth), static_cast<DWORD>(imageHeight),
                                  0, 0, 0, static_cast<UINT>(imageHeight), pixels.data(), &info, DIB_RGB_COLORS);
            }

            [[nodiscard]] int width() const noexcept { return imageWidth; }
            [[nodiscard]] int height() const noexcept { return imageHeight; }

        private:
            WindowsWindow& window;
            std::vector<std::uint32_t> pixels;
            int imageWidth = 0;
            int imageHeight = 0;
        };

        class WindowsWindow final : public NativeWindow
        {
        public:
            WindowsWindow(HWND created, std::uint32_t background) : window(created), image(*this)
            {
                setBackground(background);
                SetWindowSubclass(window, &windowProc, subclassId, reinterpret_cast<DWORD_PTR>(this));
            }

            ~WindowsWindow() override
            {
                RemoveWindowSubclass(window, &windowProc, subclassId);
                DestroyWindow(window);
                if (brush != nullptr)
                    DeleteObject(brush);
            }
            WindowsWindow(const WindowsWindow&) = delete;
            WindowsWindow& operator=(const WindowsWindow&) = delete;
            WindowsWindow(WindowsWindow&&) = delete;
            WindowsWindow& operator=(WindowsWindow&&) = delete;

            [[nodiscard]] void* view() const noexcept override { return window; }

            void resize(int width, int height) override
            {
                SetWindowPos(window, nullptr, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
            }

            void setCursor(ui::Cursor shape) override
            {
                cursor = cursorOf(shape);
                // Now, if the pointer is over the window.
                POINT point {};
                if (GetCursorPos(&point) != 0 && WindowFromPoint(point) == window)
                    SetCursor(cursor);
            }

            [[nodiscard]] std::optional<ui::Point> screenOrigin() const override
            {
                POINT origin {};
                if (ClientToScreen(window, &origin) == 0)
                    return std::nullopt;
                return ui::Point { static_cast<float>(origin.x), static_cast<float>(origin.y) };
            }

            render::RasterTarget& raster() override { return image; }

            void placeFrame(float x, float y, std::uint32_t background) override
            {
                left = static_cast<int>(std::lround(x));
                top = static_cast<int>(std::lround(y));
                setBackground(background);
            }

            void repaint() override { InvalidateRect(window, nullptr, FALSE); }

            void showFrame()
            {
                if (HDC context = GetDC(window); context != nullptr)
                {
                    image.paint(context, left, top);
                    ReleaseDC(window, context);
                }
            }

        private:
            void setBackground(std::uint32_t background)
            {
                const COLORREF rgb = RGB((background >> 16) & 0xFFU, (background >> 8) & 0xFFU, background & 0xFFU);
                if (brush != nullptr && rgb == brushColour)
                    return;
                if (brush != nullptr)
                    DeleteObject(brush);
                brush = CreateSolidBrush(rgb);
                brushColour = rgb;
            }

            void paint()
            {
                PAINTSTRUCT paint {};
                HDC context = BeginPaint(window, &paint);
                if (context == nullptr)
                    return;
                // The bands around the frame, then the frame.
                RECT client {};
                GetClientRect(window, &client);
                const RECT bands[] = { { 0, 0, left, client.bottom },
                                       { 0, 0, client.right, top },
                                       { left + image.width(), 0, client.right, client.bottom },
                                       { 0, top + image.height(), client.right, client.bottom } };
                for (const auto& band : bands)
                    if (band.right > band.left && band.bottom > band.top)
                        FillRect(context, &band, brush);
                image.paint(context, left, top);
                EndPaint(window, &paint);
            }

            static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                               DWORD_PTR data)
            {
                auto* self = reinterpret_cast<WindowsWindow*>(data);
                switch (message)
                {
                    case WM_NCHITTEST:
                        return HTCLIENT;
                    case WM_ERASEBKGND:
                        return 1;
                    case WM_PAINT:
                        self->paint();
                        return 0;
                    case WM_SETCURSOR:
                        if (LOWORD(lParam) == HTCLIENT)
                        {
                            SetCursor(self->cursor);
                            return TRUE;
                        }
                        break;
                    case WM_GETDLGCODE:
                        return DLGC_WANTALLKEYS | DLGC_WANTCHARS | DLGC_WANTARROWS | DLGC_WANTTAB;
                    default:
                        break;
                }
                return DefSubclassProc(hwnd, message, wParam, lParam);
            }

            HWND window;
            DibTarget image;
            HBRUSH brush = nullptr;
            COLORREF brushColour = 0;
            HCURSOR cursor = LoadCursorW(nullptr, IDC_ARROW);
            int left = 0;
            int top = 0;
        };

        void DibTarget::present(const render::Region&)
        {
            window.showFrame();
        }
    } // namespace

    std::unique_ptr<NativeWindow> NativeWindow::create(void* parent, int width, int height, std::uint32_t background,
                                                       std::string& error)
    {
        const auto host = static_cast<HWND>(parent);
        if (host == nullptr || IsWindow(host) == 0)
        {
            error = "the host's window is not a window";
            return nullptr;
        }
        const HWND window = CreateWindowExW(WS_EX_NOPARENTNOTIFY, L"STATIC", L"",
                                            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | SS_NOTIFY, 0, 0,
                                            width, height, host, nullptr, GetModuleHandleW(nullptr), nullptr);
        if (window == nullptr)
        {
            error = "could not create the editor's window (" + std::to_string(GetLastError()) + ")";
            return nullptr;
        }
        return std::make_unique<WindowsWindow>(window, background);
    }
} // namespace soundor::vst3
