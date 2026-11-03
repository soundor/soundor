// Xlib is loaded when a window is first needed, never linked: headless mode
// runs on machines without X11 libraries or a display.
#include "EditorWindow.h"

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <dlfcn.h>

namespace soundor::vst3host
{
    namespace
    {
        struct Xlib
        {
            decltype(&XOpenDisplay) openDisplay = nullptr;
            decltype(&XCloseDisplay) closeDisplay = nullptr;
            decltype(&XDefaultScreen) defaultScreen = nullptr;
            decltype(&XRootWindow) rootWindow = nullptr;
            decltype(&XBlackPixel) blackPixel = nullptr;
            decltype(&XCreateSimpleWindow) createSimpleWindow = nullptr;
            decltype(&XDestroyWindow) destroyWindow = nullptr;
            decltype(&XMapWindow) mapWindow = nullptr;
            decltype(&XStoreName) storeName = nullptr;
            decltype(&XInternAtom) internAtom = nullptr;
            decltype(&XSetWMProtocols) setWMProtocols = nullptr;
            decltype(&XSelectInput) selectInput = nullptr;
            decltype(&XPending) pending = nullptr;
            decltype(&XNextEvent) nextEvent = nullptr;
            decltype(&XResizeWindow) resizeWindow = nullptr;
            decltype(&XFlush) flush = nullptr;
            decltype(&XConnectionNumber) connectionNumber = nullptr;
            decltype(&XAllocSizeHints) allocSizeHints = nullptr;
            decltype(&XSetWMNormalHints) setWMNormalHints = nullptr;
            decltype(&XFree) free = nullptr;

            static const Xlib* load(std::string& error)
            {
                static Xlib xlib;
                static bool loaded = false;
                if (loaded)
                    return &xlib;
                void* library = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
                if (library == nullptr)
                {
                    error = "the editor needs libX11.so.6, which could not be loaded";
                    return nullptr;
                }
                bool complete = true;
                auto bind = [&](auto& function, const char* name)
                {
                    function = reinterpret_cast<std::remove_reference_t<decltype(function)>>(dlsym(library, name));
                    complete = complete && function != nullptr;
                };
                bind(xlib.openDisplay, "XOpenDisplay");
                bind(xlib.closeDisplay, "XCloseDisplay");
                bind(xlib.defaultScreen, "XDefaultScreen");
                bind(xlib.rootWindow, "XRootWindow");
                bind(xlib.blackPixel, "XBlackPixel");
                bind(xlib.createSimpleWindow, "XCreateSimpleWindow");
                bind(xlib.destroyWindow, "XDestroyWindow");
                bind(xlib.mapWindow, "XMapWindow");
                bind(xlib.storeName, "XStoreName");
                bind(xlib.internAtom, "XInternAtom");
                bind(xlib.setWMProtocols, "XSetWMProtocols");
                bind(xlib.selectInput, "XSelectInput");
                bind(xlib.pending, "XPending");
                bind(xlib.nextEvent, "XNextEvent");
                bind(xlib.resizeWindow, "XResizeWindow");
                bind(xlib.flush, "XFlush");
                bind(xlib.connectionNumber, "XConnectionNumber");
                bind(xlib.allocSizeHints, "XAllocSizeHints");
                bind(xlib.setWMNormalHints, "XSetWMNormalHints");
                bind(xlib.free, "XFree");
                if (! complete)
                {
                    error = "libX11.so.6 lacks a required function";
                    return nullptr;
                }
                loaded = true;
                return &xlib;
            }
        };

        class X11EditorWindow final : public EditorWindow
        {
        public:
            X11EditorWindow(EventLoop& loop, const Xlib& x, Display* display, int width, int height,
                            Callbacks callbacks)
                : loop_(loop),
                  x_(x),
                  display_(display),
                  callbacks_(std::move(callbacks)),
                  width_(width),
                  height_(height)
            {
                const int screen = x_.defaultScreen(display_);
                const auto black = x_.blackPixel(display_, screen);
                window_ =
                    x_.createSimpleWindow(display_, x_.rootWindow(display_, screen), 0, 0, static_cast<unsigned>(width),
                                          static_cast<unsigned>(height), 0, black, black);
                x_.selectInput(display_, window_, StructureNotifyMask | FocusChangeMask);
                deleteWindow_ = x_.internAtom(display_, "WM_DELETE_WINDOW", False);
                x_.setWMProtocols(display_, window_, &deleteWindow_, 1);
                connection_ = loop_.addFd(x_.connectionNumber(display_), [this] { drain(); });
                // Xlib may already have read events into its queue, where the
                // connection never becomes readable for them.
                drainTimer_ = loop_.addTimer(20, [this] { drain(); });
            }

            ~X11EditorWindow() override
            {
                loop_.removeFd(connection_);
                loop_.removeTimer(drainTimer_);
                x_.destroyWindow(display_, window_);
                x_.flush(display_);
                x_.closeDisplay(display_);
            }

            void setTitle(const std::string& title) { x_.storeName(display_, window_, title.c_str()); }

            [[nodiscard]] const char* platformType() const override { return "X11EmbedWindowID"; }
            [[nodiscard]] void* parentHandle() const override
            {
                return reinterpret_cast<void*>(window_); // NOLINT(performance-no-int-to-ptr): an X11 id
            }

            void setResizable(bool resizable) override
            {
                resizable_ = resizable;
                applyHints();
            }

            void setContentSize(int width, int height) override
            {
                width_ = width;
                height_ = height;
                applyHints();
                x_.resizeWindow(display_, window_, static_cast<unsigned>(width), static_cast<unsigned>(height));
                x_.flush(display_);
            }

            void show() override
            {
                x_.mapWindow(display_, window_);
                x_.flush(display_);
            }

            [[nodiscard]] double scale() const override { return 1.0; }

        private:
            void applyHints()
            {
                XSizeHints* hints = x_.allocSizeHints();
                if (hints == nullptr)
                    return;
                if (! resizable_)
                {
                    hints->flags = PMinSize | PMaxSize;
                    hints->min_width = hints->max_width = width_;
                    hints->min_height = hints->max_height = height_;
                }
                x_.setWMNormalHints(display_, window_, hints);
                x_.free(hints);
            }

            void drain()
            {
                while (x_.pending(display_) > 0)
                {
                    XEvent event {};
                    x_.nextEvent(display_, &event);
                    switch (event.type)
                    {
                        case ConfigureNotify:
                            if (event.xconfigure.window == window_
                                && (event.xconfigure.width != width_ || event.xconfigure.height != height_))
                            {
                                width_ = event.xconfigure.width;
                                height_ = event.xconfigure.height;
                                if (callbacks_.resized)
                                    callbacks_.resized(width_, height_);
                            }
                            break;
                        case FocusIn:
                        case FocusOut:
                            if (callbacks_.focusChanged)
                                callbacks_.focusChanged(event.type == FocusIn);
                            break;
                        case ClientMessage:
                            if (static_cast<Atom>(event.xclient.data.l[0]) == deleteWindow_ && callbacks_.closed)
                            {
                                // The callback destroys this window.
                                loop_.post(callbacks_.closed);
                                return;
                            }
                            break;
                        default:
                            break;
                    }
                }
            }

            EventLoop& loop_;
            const Xlib& x_;
            Display* display_;
            Callbacks callbacks_;
            Window window_ = 0;
            Atom deleteWindow_ = 0;
            EventLoop::Id connection_ = 0;
            EventLoop::Id drainTimer_ = 0;
            int width_;
            int height_;
            bool resizable_ = true;
        };
    } // namespace

    std::unique_ptr<EditorWindow> EditorWindow::create(EventLoop& loop, const std::string& title, int width, int height,
                                                       Callbacks callbacks, std::string& error)
    {
        const Xlib* x = Xlib::load(error);
        if (x == nullptr)
            return nullptr;
        Display* display = x->openDisplay(nullptr);
        if (display == nullptr)
        {
            error = "no X11 display is available (is DISPLAY set? Use headless mode without one)";
            return nullptr;
        }
        auto window = std::make_unique<X11EditorWindow>(loop, *x, display, width, height, std::move(callbacks));
        window->setTitle(title);
        return window;
    }
} // namespace soundor::vst3host
