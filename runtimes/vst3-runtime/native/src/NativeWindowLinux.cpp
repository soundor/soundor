// Linux: the editor's X11 window (X11.h) and the CPU frames shown in it.

#include "NativeWindow.h"
#include "X11.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace soundor::vst3
{
    namespace
    {
        x11::CursorIcon cursorIcon(ui::Cursor cursor)
        {
            switch (cursor)
            {
                case ui::Cursor::Pointer:
                    return x11::CursorIcon::Hand;
                case ui::Cursor::Text:
                    return x11::CursorIcon::Text;
                case ui::Cursor::Crosshair:
                    return x11::CursorIcon::Crosshair;
                case ui::Cursor::Move:
                    return x11::CursorIcon::Move;
                case ui::Cursor::EwResize:
                    return x11::CursorIcon::HorizontalResize;
                case ui::Cursor::NsResize:
                    return x11::CursorIcon::VerticalResize;
                case ui::Cursor::NeswResize:
                    return x11::CursorIcon::DiagonalResizeUp;
                case ui::Cursor::NwseResize:
                    return x11::CursorIcon::DiagonalResizeDown;
                case ui::Cursor::None:
                    return x11::CursorIcon::Hidden;
                default:
                    return x11::CursorIcon::Arrow;
            }
        }

        // A CPU compositor's frames, shown in the window with XPutImage.
        class WindowTarget final : public render::RasterTarget
        {
        public:
            explicit WindowTarget(x11::Window& shown) : target(shown) {}

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
                    target.setImage(pixels.data(), width, height);
                }
                return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
            }

            void present(const render::Region& damage) override
            {
                for (const auto& rect : damage.rects())
                    put(rect.x, rect.y, rect.width, rect.height);
                target.flush();
            }

            void setPlacement(int x, int y, std::uint32_t background)
            {
                left = x;
                top = y;
                fill = background;
            }

            void repaint()
            {
                // The bands around the frame, then the frame.
                constexpr int far = 32767;
                target.fill(0, 0, left, far, fill);
                target.fill(0, 0, far, top, fill);
                target.fill(left + imageWidth, 0, far, far, fill);
                target.fill(0, top + imageHeight, far, far, fill);
                put(0, 0, imageWidth, imageHeight);
                target.flush();
            }

        private:
            void put(int x, int y, int width, int height)
            {
                x = std::clamp(x, 0, imageWidth);
                y = std::clamp(y, 0, imageHeight);
                target.putImage(x, y, std::min(width, imageWidth - x), std::min(height, imageHeight - y), left, top);
            }

            x11::Window& target;
            std::vector<std::uint32_t> pixels;
            int imageWidth = 0;
            int imageHeight = 0;
            int left = 0;
            int top = 0;
            std::uint32_t fill = 0xFF000000;
        };

        class LinuxWindow final : public NativeWindow
        {
        public:
            explicit LinuxWindow(std::unique_ptr<x11::Window> created) : window(std::move(created)), image(*window) {}

            [[nodiscard]] void* view() const noexcept override
            {
                // An X11 window id, which the engine's APIs carry as a pointer.
                return reinterpret_cast<void*>(window->id()); // NOLINT(performance-no-int-to-ptr)
            }

            void resize(int width, int height) override { window->resize(width, height); }

            void setCursor(ui::Cursor shape) override { window->setCursor(cursorIcon(shape)); }

            [[nodiscard]] std::optional<ui::Point> screenOrigin() const override
            {
                const auto [x, y] = window->screenPosition();
                return ui::Point { static_cast<float>(x), static_cast<float>(y) };
            }

            render::RasterTarget& raster() override { return image; }

            void placeFrame(float x, float y, std::uint32_t background) override
            {
                image.setPlacement(static_cast<int>(std::lround(x)), static_cast<int>(std::lround(y)), background);
            }

            void repaint() override { image.repaint(); }

            [[nodiscard]] int fileDescriptor() const override { return window->fileDescriptor(); }

            bool pump() override { return window->pump(); }

        private:
            std::unique_ptr<x11::Window> window;
            WindowTarget image;
        };
    } // namespace

    std::unique_ptr<NativeWindow> NativeWindow::create(void* parent, int width, int height, std::uint32_t background,
                                                       std::string& error)
    {
        auto window = x11::Window::create(reinterpret_cast<std::uintptr_t>(parent), width, height, background, error);
        if (window == nullptr)
            return nullptr;
        return std::make_unique<LinuxWindow>(std::move(window));
    }
} // namespace soundor::vst3
