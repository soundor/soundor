#pragma once

// The editor's own X11 window: the child of the host's window that the UI is
// shown in, on a connection of its own, and the CPU frames shown in it.
//
// Xlib is loaded when an editor first opens (dlopen, as the engine's input
// does): a plugin never links X11, so it loads, and processes audio, where
// there is none. Xlib's headers stay in X11.cpp: their macros (None, Status,
// Cursor...) would clash with the engine's names.

#include <cstdint>
#include <memory>
#include <string>
#include <utility>

namespace soundor::vst3::x11
{
    enum class CursorIcon : std::uint8_t
    {
        Arrow,
        Hand,
        Text,
        Crosshair,
        Move,
        HorizontalResize,
        VerticalResize,
        DiagonalResizeUp,
        DiagonalResizeDown,
    };

    class Window
    {
    public:
        // A window in `parent` (the host's X11 window id), or null with the
        // reason in `error`: no libX11, no display.
        [[nodiscard]] static std::unique_ptr<Window> create(std::uintptr_t parent, int width, int height,
                                                            std::uint32_t background, std::string& error);
        ~Window();
        Window(const Window&) = delete;
        Window& operator=(const Window&) = delete;
        Window(Window&&) = delete;
        Window& operator=(Window&&) = delete;

        // Its X11 id, for the engine (compositor, input).
        [[nodiscard]] std::uintptr_t id() const noexcept { return window; }
        // Its connection's descriptor, for the host's run loop.
        [[nodiscard]] int fileDescriptor() const noexcept;
        void resize(int width, int height);
        // Reads what arrived on its connection: whether part of it was
        // exposed (and the frame must be shown again).
        bool pump();
        void setCursor(CursorIcon shape);
        // Its top-left corner on the screen, in physical pixels.
        [[nodiscard]] std::pair<int, int> screenPosition() const;

        // The frame CPU composition draws into: `width`×`height` BGRA pixels
        // the caller owns (they outlive the image). False without one.
        bool setImage(void* pixels, int width, int height);
        // Shows the image's (x, y, width, height) at (left + x, top + y).
        void putImage(int x, int y, int width, int height, int left, int top);
        // Fills a rectangle of the window with an RGB colour.
        void fill(int x, int y, int width, int height, std::uint32_t rgb);
        void flush();

    private:
        Window() = default;
        void dropImage();

        void* display = nullptr; // Display*
        std::uintptr_t window = 0;
        void* context = nullptr; // GC
        void* image = nullptr;   // XImage*
        unsigned long cursor = 0;
    };
} // namespace soundor::vst3::x11
