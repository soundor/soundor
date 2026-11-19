#include "X11.h"

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/cursorfont.h>
#include <dlfcn.h>

#include <algorithm>

namespace soundor::vst3::x11
{
    namespace
    {
#define SOUNDOR_VST3_X11_FUNCTIONS(F)                                                                                  \
    F(XOpenDisplay)                                                                                                    \
    F(XCloseDisplay)                                                                                                   \
    F(XDefaultScreen)                                                                                                  \
    F(XDefaultVisual)                                                                                                  \
    F(XDefaultDepth)                                                                                                   \
    F(XDefaultColormap)                                                                                                \
    F(XRootWindow)                                                                                                     \
    F(XCreateWindow)                                                                                                   \
    F(XDestroyWindow)                                                                                                  \
    F(XMapWindow)                                                                                                      \
    F(XMoveResizeWindow)                                                                                               \
    F(XPending)                                                                                                        \
    F(XNextEvent)                                                                                                      \
    F(XConnectionNumber)                                                                                               \
    F(XFlush)                                                                                                          \
    F(XSync)                                                                                                           \
    F(XCreateGC)                                                                                                       \
    F(XFreeGC)                                                                                                         \
    F(XSetForeground)                                                                                                  \
    F(XFillRectangle)                                                                                                  \
    F(XCreateImage)                                                                                                    \
    F(XPutImage)                                                                                                       \
    F(XFree)                                                                                                           \
    F(XTranslateCoordinates)                                                                                           \
    F(XCreateFontCursor)                                                                                               \
    F(XCreateBitmapFromData)                                                                                           \
    F(XCreatePixmapCursor)                                                                                             \
    F(XFreePixmap)                                                                                                     \
    F(XDefineCursor)                                                                                                   \
    F(XFreeCursor)                                                                                                     \
    F(XSetErrorHandler)

        struct Xlib
        {
            Xlib()
            {
                void* library = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
                if (library == nullptr)
                    return;
                bool complete = true;
#define SOUNDOR_VST3_X11_LOAD(name)                                                                                    \
    name = reinterpret_cast<decltype(name)>(dlsym(library, #name));                                                    \
    complete = complete && (name) != nullptr;
                SOUNDOR_VST3_X11_FUNCTIONS(SOUNDOR_VST3_X11_LOAD)
#undef SOUNDOR_VST3_X11_LOAD
                available = complete;
            }

            bool available = false;
// NOLINTNEXTLINE(bugprone-macro-parentheses): a member declaration cannot parenthesize its name
#define SOUNDOR_VST3_X11_DECLARE(name) decltype(&::name) name = nullptr;
            SOUNDOR_VST3_X11_FUNCTIONS(SOUNDOR_VST3_X11_DECLARE)
#undef SOUNDOR_VST3_X11_DECLARE
        };

        // Loaded once and kept for the process: an X connection's
        // callbacks may outlive an editor.
        const Xlib* xlib()
        {
            static const Xlib* loaded = new Xlib(); // NOLINT(cppcoreguidelines-owning-memory): kept for the process
            return loaded->available ? loaded : nullptr;
        }

        // Xlib's default handler exits the process: a host window gone
        // before the editor must not take the host with it.
        int ignoreErrors(Display*, XErrorEvent*)
        {
            return 0;
        }

        Display* asDisplay(void* display)
        {
            return static_cast<Display*>(display);
        }
    } // namespace

    std::unique_ptr<Window> Window::create(std::uintptr_t parent, int width, int height, std::uint32_t background,
                                           std::string& error)
    {
        const auto* lib = xlib();
        if (lib == nullptr)
        {
            error = "libX11.so.6 could not be loaded";
            return nullptr;
        }
        Display* display = lib->XOpenDisplay(nullptr);
        if (display == nullptr)
        {
            error = "no X display";
            return nullptr;
        }
        lib->XSetErrorHandler(ignoreErrors);
        const int screen = lib->XDefaultScreen(display);
        XSetWindowAttributes attributes {};
        attributes.background_pixel = background & 0xFFFFFF;
        attributes.border_pixel = 0;
        attributes.colormap = lib->XDefaultColormap(display, screen);
        attributes.event_mask = ExposureMask | StructureNotifyMask;
        const ::Window window = lib->XCreateWindow(
            display, static_cast<::Window>(parent), 0, 0, static_cast<unsigned int>(std::max(1, width)),
            static_cast<unsigned int>(std::max(1, height)), 0, lib->XDefaultDepth(display, screen), InputOutput,
            lib->XDefaultVisual(display, screen), CWBackPixel | CWBorderPixel | CWColormap | CWEventMask, &attributes);
        lib->XMapWindow(display, window);
        // The window exists on the server before the engine's own
        // connections (input, GPU presentation) look for it.
        lib->XSync(display, False);
        std::unique_ptr<Window> out(new Window());
        out->display = display;
        out->window = window;
        out->context = lib->XCreateGC(display, window, 0, nullptr);
        return out;
    }

    Window::~Window()
    {
        const auto* lib = xlib();
        dropImage();
        if (lib == nullptr || display == nullptr)
            return;
        if (context != nullptr)
            lib->XFreeGC(asDisplay(display), static_cast<GC>(context));
        if (cursor != 0)
            lib->XFreeCursor(asDisplay(display), cursor);
        if (window != 0)
            lib->XDestroyWindow(asDisplay(display), static_cast<::Window>(window));
        lib->XSync(asDisplay(display), False);
        lib->XCloseDisplay(asDisplay(display));
    }

    int Window::fileDescriptor() const noexcept
    {
        return xlib()->XConnectionNumber(asDisplay(display));
    }

    void Window::resize(int width, int height)
    {
        const auto* lib = xlib();
        lib->XMoveResizeWindow(asDisplay(display), static_cast<::Window>(window), 0, 0,
                               static_cast<unsigned int>(std::max(1, width)),
                               static_cast<unsigned int>(std::max(1, height)));
        lib->XFlush(asDisplay(display));
    }

    bool Window::pump()
    {
        const auto* lib = xlib();
        bool exposed = false;
        while (lib->XPending(asDisplay(display)) > 0)
        {
            XEvent event {};
            lib->XNextEvent(asDisplay(display), &event);
            if (event.type == Expose && event.xexpose.window == static_cast<::Window>(window))
                exposed = true;
        }
        return exposed;
    }

    void Window::setCursor(CursorIcon shape)
    {
        const auto* lib = xlib();
        unsigned int font = XC_left_ptr;
        switch (shape)
        {
            case CursorIcon::Hand:
                font = XC_hand2;
                break;
            case CursorIcon::Text:
                font = XC_xterm;
                break;
            case CursorIcon::Crosshair:
                font = XC_crosshair;
                break;
            case CursorIcon::Move:
                font = XC_fleur;
                break;
            case CursorIcon::HorizontalResize:
                font = XC_sb_h_double_arrow;
                break;
            case CursorIcon::VerticalResize:
                font = XC_sb_v_double_arrow;
                break;
            case CursorIcon::DiagonalResizeUp:
                font = XC_top_right_corner;
                break;
            case CursorIcon::DiagonalResizeDown:
                font = XC_bottom_right_corner;
                break;
            case CursorIcon::Arrow:
            case CursorIcon::Hidden:
                break;
        }
        if (cursor != 0)
            lib->XFreeCursor(asDisplay(display), cursor);
        if (shape == CursorIcon::Hidden)
        {
            // A cursor of one transparent pixel.
            const char empty[1] = { 0 };
            const Pixmap blank =
                lib->XCreateBitmapFromData(asDisplay(display), static_cast<::Window>(window), empty, 1, 1);
            XColor black {};
            cursor = lib->XCreatePixmapCursor(asDisplay(display), blank, blank, &black, &black, 0, 0);
            lib->XFreePixmap(asDisplay(display), blank);
        }
        else
            cursor = lib->XCreateFontCursor(asDisplay(display), font);
        lib->XDefineCursor(asDisplay(display), static_cast<::Window>(window), cursor);
        lib->XFlush(asDisplay(display));
    }

    std::pair<int, int> Window::screenPosition() const
    {
        const auto* lib = xlib();
        ::Window child = 0;
        int x = 0;
        int y = 0;
        lib->XTranslateCoordinates(asDisplay(display), static_cast<::Window>(window),
                                   lib->XRootWindow(asDisplay(display), lib->XDefaultScreen(asDisplay(display))), 0, 0,
                                   &x, &y, &child);
        return { x, y };
    }

    void Window::dropImage()
    {
        if (image == nullptr)
            return;
        auto* xImage = static_cast<XImage*>(image);
        xImage->data = nullptr; // the caller's pixels
        xlib()->XFree(xImage);
        image = nullptr;
    }

    bool Window::setImage(void* pixels, int width, int height)
    {
        const auto* lib = xlib();
        dropImage();
        const int screen = lib->XDefaultScreen(asDisplay(display));
        image = lib->XCreateImage(asDisplay(display), lib->XDefaultVisual(asDisplay(display), screen),
                                  static_cast<unsigned int>(lib->XDefaultDepth(asDisplay(display), screen)), ZPixmap, 0,
                                  static_cast<char*>(pixels), static_cast<unsigned int>(width),
                                  static_cast<unsigned int>(height), 32, width * 4);
        return image != nullptr;
    }

    void Window::putImage(int x, int y, int width, int height, int left, int top)
    {
        if (image == nullptr || context == nullptr || width <= 0 || height <= 0)
            return;
        xlib()->XPutImage(asDisplay(display), static_cast<::Window>(window), static_cast<GC>(context),
                          static_cast<XImage*>(image), x, y, left + x, top + y, static_cast<unsigned int>(width),
                          static_cast<unsigned int>(height));
    }

    void Window::fill(int x, int y, int width, int height, std::uint32_t rgb)
    {
        if (context == nullptr || width <= 0 || height <= 0)
            return;
        const auto* lib = xlib();
        lib->XSetForeground(asDisplay(display), static_cast<GC>(context), rgb & 0xFFFFFF);
        lib->XFillRectangle(asDisplay(display), static_cast<::Window>(window), static_cast<GC>(context), x, y,
                            static_cast<unsigned int>(width), static_cast<unsigned int>(height));
    }

    void Window::flush()
    {
        xlib()->XFlush(asDisplay(display));
    }
} // namespace soundor::vst3::x11
