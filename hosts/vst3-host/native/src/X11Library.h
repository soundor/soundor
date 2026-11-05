// Xlib, loaded when a window is first needed and never linked: headless mode
// runs on machines without X11 libraries or a display.
#pragma once

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/Xdamage.h>
#include <X11/extensions/shape.h>

#include <string>

namespace soundor::vst3host
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
        decltype(&XChangeProperty) changeProperty = nullptr;
        decltype(&XSetWMProtocols) setWMProtocols = nullptr;
        decltype(&XSelectInput) selectInput = nullptr;
        decltype(&XPending) pending = nullptr;
        decltype(&XNextEvent) nextEvent = nullptr;
        decltype(&XResizeWindow) resizeWindow = nullptr;
        decltype(&XGetWindowAttributes) getWindowAttributes = nullptr;
        decltype(&XFlush) flush = nullptr;
        decltype(&XConnectionNumber) connectionNumber = nullptr;
        decltype(&XAllocSizeHints) allocSizeHints = nullptr;
        decltype(&XSetWMNormalHints) setWMNormalHints = nullptr;
        decltype(&XFree) free = nullptr;
        decltype(&XMoveResizeWindow) moveResizeWindow = nullptr;
        decltype(&XSetErrorHandler) setErrorHandler = nullptr;
        decltype(&XGetErrorText) getErrorText = nullptr;
        decltype(&XDisplayString) displayString = nullptr;
        decltype(&XQueryTree) queryTree = nullptr;
        decltype(&XSync) sync = nullptr;
        decltype(&XGetImage) getImage = nullptr;
        decltype(&XFreePixmap) freePixmap = nullptr;
        decltype(&XSetWindowBackgroundPixmap) setWindowBackgroundPixmap = nullptr;
        decltype(&XSendEvent) sendEvent = nullptr;
        decltype(&XSetWindowBackground) setWindowBackground = nullptr;
        decltype(&XChangeWindowAttributes) changeWindowAttributes = nullptr;
        decltype(&XTranslateCoordinates) translateCoordinates = nullptr;
    };

    /** What live presentation needs (EditorArea) besides Xlib. */
    struct XLive
    {
        decltype(&XCompositeQueryExtension) compositeQueryExtension = nullptr;
        decltype(&XCompositeRedirectSubwindows) redirectSubwindows = nullptr;
        decltype(&XCompositeUnredirectSubwindows) unredirectSubwindows = nullptr;
        decltype(&XCompositeNameWindowPixmap) nameWindowPixmap = nullptr;
        decltype(&XDamageQueryExtension) damageQueryExtension = nullptr;
        decltype(&XDamageCreate) damageCreate = nullptr;
        decltype(&XDamageDestroy) damageDestroy = nullptr;
        decltype(&XDamageSubtract) damageSubtract = nullptr;
        decltype(&XShapeQueryExtension) shapeQueryExtension = nullptr;
        decltype(&XShapeCombineRectangles) shapeCombineRectangles = nullptr;
        decltype(&XShapeCombineMask) shapeCombineMask = nullptr;
    };

    /** The functions the host uses, loaded once; nullptr and `error` without
        libX11. Loading also replaces Xlib's default error handler, which
        ends the process, with one that logs: a plugin's failed X request
        is the plugin's problem, not the host's end. */
    const Xlib* loadXlib(std::string& error);

    /** Loaded once; nullptr without libXcomposite, libXdamage or libXext, where the
        editor's view stays on the screen while it is resized. */
    const XLive* loadXLive();

    /** Errors on this connection are not logged: its requests may name a
        plugin's window, which the plugin destroys when it likes. */
    void setQuietDisplay(Display* display);
} // namespace soundor::vst3host
