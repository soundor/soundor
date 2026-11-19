#pragma once

// The editor's own native window, a child of the host's: what the UI is shown
// in, on each platform.
//
// - Linux: an X11 window, on a connection of its own (X11.h), whose events
//   the host's run loop reads (fileDescriptor(), pump()); the CPU frames are
//   put in it with XPutImage.
// - macOS: a layer-backed NSView in the host's NSView; the CPU frames are a
//   sublayer's contents.
// - Windows: a child HWND of the system's STATIC class (nothing registered
//   with the system, as the engine's own child windows), subclassed; the CPU
//   frames are painted with SetDIBitsToDevice.
//
// Sizes and places are in the host's units for the view (ViewRect): physical
// pixels on Linux and Windows, points on macOS.

#include <soundor/render/Compositor.h>
#include <soundor/ui/Input.h>
#include <soundor/ui/Style.h>

#include <cstdint>
#include <memory>
#include <optional>
#include <string>

namespace soundor::vst3
{
    class NativeWindow
    {
    public:
        // A window in `parent` (the X11 window id, the NSView, the HWND the
        // host gave), or null with the reason in `error`.
        [[nodiscard]] static std::unique_ptr<NativeWindow> create(void* parent, int width, int height,
                                                                  std::uint32_t background, std::string& error);

        NativeWindow() = default;
        virtual ~NativeWindow() = default;
        NativeWindow(const NativeWindow&) = delete;
        NativeWindow& operator=(const NativeWindow&) = delete;
        NativeWindow(NativeWindow&&) = delete;
        NativeWindow& operator=(NativeWindow&&) = delete;

        // The native view, as the engine takes it (an XID as a pointer, an
        // NSView*, an HWND).
        [[nodiscard]] virtual void* view() const noexcept = 0;
        virtual void resize(int width, int height) = 0;
        virtual void setCursor(ui::Cursor shape) = 0;
        // Its top-left corner on the screen, in physical pixels; nullopt where
        // the platform finds it itself (macOS).
        [[nodiscard]] virtual std::optional<ui::Point> screenOrigin() const = 0;
        // Device pixels per unit of its size: the backing scale on macOS, 1
        // elsewhere (the host's content scale says it there).
        [[nodiscard]] virtual float backingScale() const { return 1; }
        // Called every frame: what the window keeps up to date itself (the
        // cursor, on macOS).
        virtual void tick() {}

        // Where the CPU compositor presents.
        [[nodiscard]] virtual render::RasterTarget& raster() = 0;
        // Where the frame goes in the window (its units), and the colour
        // (0xAARRGGBB) of the bands around it.
        virtual void placeFrame(float x, float y, std::uint32_t background) = 0;
        // Shows the last frame again, and the bands (an expose, a resize).
        virtual void repaint() = 0;

        // Linux: the connection's descriptor, for the host's run loop, and
        // reading what arrived on it: whether part of the window was exposed.
        [[nodiscard]] virtual int fileDescriptor() const { return -1; }
        virtual bool pump() { return false; }
    };
} // namespace soundor::vst3
