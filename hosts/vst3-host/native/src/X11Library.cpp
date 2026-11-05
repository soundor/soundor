#include "X11Library.h"

#include <dlfcn.h>

#include <cstdio>
#include <type_traits>

namespace soundor::vst3host
{
    namespace
    {
        const Xlib* loadedXlib = nullptr;
        Display* quietDisplay = nullptr;

        int logError(Display* display, XErrorEvent* event)
        {
            if (display == quietDisplay)
                return 0;
            char text[256] = {};
            loadedXlib->getErrorText(display, event->error_code, text, sizeof text);
            std::fprintf(stderr, "X error (ignored): %s, request %d.%d, resource 0x%lx\n", text, event->request_code,
                         event->minor_code, event->resourceid);
            return 0;
        }
    } // namespace

    const Xlib* loadXlib(std::string& error)
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
        bind(xlib.changeProperty, "XChangeProperty");
        bind(xlib.setWMProtocols, "XSetWMProtocols");
        bind(xlib.selectInput, "XSelectInput");
        bind(xlib.pending, "XPending");
        bind(xlib.nextEvent, "XNextEvent");
        bind(xlib.resizeWindow, "XResizeWindow");
        bind(xlib.getWindowAttributes, "XGetWindowAttributes");
        bind(xlib.flush, "XFlush");
        bind(xlib.connectionNumber, "XConnectionNumber");
        bind(xlib.allocSizeHints, "XAllocSizeHints");
        bind(xlib.setWMNormalHints, "XSetWMNormalHints");
        bind(xlib.free, "XFree");
        bind(xlib.moveResizeWindow, "XMoveResizeWindow");
        bind(xlib.setErrorHandler, "XSetErrorHandler");
        bind(xlib.getErrorText, "XGetErrorText");
        bind(xlib.displayString, "XDisplayString");
        bind(xlib.queryTree, "XQueryTree");
        bind(xlib.sync, "XSync");
        bind(xlib.getImage, "XGetImage");
        bind(xlib.freePixmap, "XFreePixmap");
        bind(xlib.setWindowBackgroundPixmap, "XSetWindowBackgroundPixmap");
        bind(xlib.sendEvent, "XSendEvent");
        bind(xlib.setWindowBackground, "XSetWindowBackground");
        bind(xlib.changeWindowAttributes, "XChangeWindowAttributes");
        bind(xlib.translateCoordinates, "XTranslateCoordinates");
        if (! complete)
        {
            error = "libX11.so.6 lacks a required function";
            return nullptr;
        }
        loaded = true;
        loadedXlib = &xlib;
        xlib.setErrorHandler(&logError);
        return &xlib;
    }

    const XLive* loadXLive()
    {
        static const XLive* const loaded = []() -> const XLive*
        {
            static XLive live;
            void* composite = dlopen("libXcomposite.so.1", RTLD_NOW | RTLD_LOCAL);
            void* damage = dlopen("libXdamage.so.1", RTLD_NOW | RTLD_LOCAL);
            void* extensions = dlopen("libXext.so.6", RTLD_NOW | RTLD_LOCAL);
            if (composite == nullptr || damage == nullptr || extensions == nullptr)
                return nullptr;
            bool complete = true;
            auto bind = [&](void* library, auto& function, const char* name)
            {
                function = reinterpret_cast<std::remove_reference_t<decltype(function)>>(dlsym(library, name));
                complete = complete && function != nullptr;
            };
            bind(composite, live.compositeQueryExtension, "XCompositeQueryExtension");
            bind(composite, live.redirectSubwindows, "XCompositeRedirectSubwindows");
            bind(composite, live.unredirectSubwindows, "XCompositeUnredirectSubwindows");
            bind(composite, live.nameWindowPixmap, "XCompositeNameWindowPixmap");
            bind(damage, live.damageQueryExtension, "XDamageQueryExtension");
            bind(damage, live.damageCreate, "XDamageCreate");
            bind(damage, live.damageDestroy, "XDamageDestroy");
            bind(damage, live.damageSubtract, "XDamageSubtract");
            bind(extensions, live.shapeQueryExtension, "XShapeQueryExtension");
            bind(extensions, live.shapeCombineRectangles, "XShapeCombineRectangles");
            bind(extensions, live.shapeCombineMask, "XShapeCombineMask");
            return complete ? &live : nullptr;
        }();
        return loaded;
    }

    void setQuietDisplay(Display* display)
    {
        quietDisplay = display;
    }
} // namespace soundor::vst3host
