// Drives the real top-level window in Linux UI tests, without a window manager.
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>
#include <X11/extensions/shape.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

int main(int argc, char** argv)
{
    if (argc != 4 && argc != 6)
        return 2;
    Display* display = XOpenDisplay(nullptr);
    if (display == nullptr)
        return 3;
    Window root = DefaultRootWindow(display);
    Window parent = 0;
    Window* children = nullptr;
    unsigned count = 0;
    XQueryTree(display, root, &root, &parent, &children, &count);
    Window window = 0;
    const char* targetTitle =
        std::getenv("SOUNDOR_VST3_HOST_WINDOW_TITLE"); // NOLINT(concurrency-mt-unsafe): test process
    if (targetTitle == nullptr)
        targetTitle = "Fixture Gain";
    for (unsigned index = 0; index < count; ++index)
    {
        char* title = nullptr;
        if (XFetchName(display, children[index], &title) != 0 && title != nullptr)
        {
            if (std::strcmp(title, targetTitle) == 0)
                window = children[index];
            XFree(title);
        }
    }
    XFree(children);
    if (window == 0)
        return 4;
    const int x = std::atoi(argv[2]); // NOLINT(cert-err34-c): test arguments
    const int y = std::atoi(argv[3]); // NOLINT(cert-err34-c): test arguments
    if (std::strcmp(argv[1], "only-move-resize-close") == 0)
    {
        const Atom property = XInternAtom(display, "_MOTIF_WM_HINTS", False);
        Atom type = 0;
        int format = 0;
        unsigned long items = 0;
        unsigned long remaining = 0;
        unsigned char* data = nullptr;
        XGetWindowProperty(display, window, property, 0, 5, False, property, &type, &format, &items, &remaining, &data);
        const auto* hints = reinterpret_cast<const unsigned long*>(data);
        const bool only = items == 5 && hints[0] == 1 && hints[1] == (2 | 4 | 32);
        if (data != nullptr)
            XFree(data);
        XCloseDisplay(display);
        return only ? 0 : 5;
    }
    if (std::strcmp(argv[1], "user-resizable") == 0)
    {
        // A window manager keeps a window that may be only one size to it.
        XSizeHints hints {};
        long supplied = 0;
        XGetWMNormalHints(display, window, &hints, &supplied);
        const bool locked = (hints.flags & PMinSize) != 0 && (hints.flags & PMaxSize) != 0
                            && hints.min_width == hints.max_width && hints.min_height == hints.max_height;
        XCloseDisplay(display);
        return locked ? 6 : 0;
    }
    if (std::strcmp(argv[1], "maximize") == 0)
    {
        const Atom state = XInternAtom(display, "_NET_WM_STATE", False);
        const Atom atom = XInternAtom(display, "ATOM", False);
        const Atom values[] = { XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_VERT", False),
                                XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_HORZ", False) };
        XChangeProperty(display, window, state, atom, 32, PropModeReplace,
                        reinterpret_cast<const unsigned char*>(values), 2);
        XResizeWindow(display, window, static_cast<unsigned>(x), static_cast<unsigned>(y));
    }
    else if (std::strcmp(argv[1], "unmaximize") == 0)
    {
        XDeleteProperty(display, window, XInternAtom(display, "_NET_WM_STATE", False));
        XResizeWindow(display, window, static_cast<unsigned>(x), static_cast<unsigned>(y));
    }
    else if (std::strcmp(argv[1], "press-keeps-view") == 0)
    {
        // A press that moves nothing leaves the editor's view showing: live
        // presentation empties its shape.
        Window child = 0;
        int rootX = 0;
        int rootY = 0;
        XTranslateCoordinates(display, window, root, x, y, &rootX, &rootY, &child);
        XTestFakeMotionEvent(display, DefaultScreen(display), rootX - 2, rootY - 2, CurrentTime);
        XFlush(display);
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        XTestFakeMotionEvent(display, DefaultScreen(display), rootX, rootY, CurrentTime);
        XFlush(display);
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        XTestFakeButtonEvent(display, Button1, True, CurrentTime);
        XFlush(display);
        Window queryRoot = 0;
        Window queryParent = 0;
        Window* queryChildren = nullptr;
        unsigned queryCount = 0;
        XQueryTree(display, window, &queryRoot, &queryParent, &queryChildren, &queryCount);
        const Window view = queryCount > 0 ? queryChildren[0] : 0;
        XFree(queryChildren);
        bool hidden = false;
        for (int step = 0; step < 30 && view != 0; ++step)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            int rectangles = 0;
            int ordering = 0;
            XRectangle* shape = XShapeGetRectangles(display, view, ShapeBounding, &rectangles, &ordering);
            if (shape != nullptr)
                XFree(shape);
            hidden = hidden || rectangles == 0;
        }
        XTestFakeButtonEvent(display, Button1, False, CurrentTime);
        XSync(display, False);
        if (hidden)
        {
            std::fprintf(stderr, "A press without a move hid the editor's view\n");
            return 8;
        }
    }
    else if (std::strcmp(argv[1], "resize") == 0)
        XResizeWindow(display, window, static_cast<unsigned>(x), static_cast<unsigned>(y));
    else if (std::strcmp(argv[1], "probe") == 0)
    {
        // Sample the visible editor through the root window, including its
        // native child. Catch a parent clear/swap painting over its contents.
        for (int step = 0; step < 80; ++step)
        {
            XResizeWindow(display, window, static_cast<unsigned>(x + step % 10), static_cast<unsigned>(y + step % 10));
            XSync(display, False);
            std::this_thread::sleep_for(std::chrono::milliseconds(4));
            Window child = 0;
            int rootX = 0;
            int rootY = 0;
            XTranslateCoordinates(display, window, root, 100, 100, &rootX, &rootY, &child);
            XImage* image = XGetImage(display, root, rootX, rootY, 1, 1, AllPlanes, ZPixmap);
            const unsigned long pixel = XGetPixel(image, 0, 0) & 0xffffffUL;
            XDestroyImage(image);
            if (pixel != 0x2a6f97UL)
            {
                std::fprintf(stderr, "Editor covered during resize: 0x%lx\n", pixel);
                return 5;
            }
        }
    }
    else
    {
        Window child = 0;
        int rootX = 0;
        int rootY = 0;
        XTranslateCoordinates(display, window, root, x, y, &rootX, &rootY, &child);
        XTestFakeMotionEvent(display, DefaultScreen(display), rootX - 2, rootY - 2, CurrentTime);
        XFlush(display);
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        XTestFakeMotionEvent(display, DefaultScreen(display), rootX, rootY, CurrentTime);
        XFlush(display);
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        XTestFakeButtonEvent(display, Button1, True, CurrentTime);
        XFlush(display);
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        // drag-probe: the editor is never missing from the window while its
        // geometry changes, and is back in its place afterwards.
        const bool probe = std::strcmp(argv[1], "drag-probe") == 0;
        // drag-release: the release comes with the last move, in one frame.
        const bool releaseAtOnce = std::strcmp(argv[1], "drag-release") == 0;
        if ((std::strcmp(argv[1], "drag") == 0 || probe || releaseAtOnce) && argc == 6)
        {
            const int dx = std::atoi(argv[4]); // NOLINT(cert-err34-c): test arguments
            const int dy = std::atoi(argv[5]); // NOLINT(cert-err34-c): test arguments
            for (int step = 1; step <= 20; ++step)
            {
                XTestFakeMotionEvent(display, DefaultScreen(display), rootX + dx * step / 20, rootY + dy * step / 20,
                                     CurrentTime);
                XFlush(display);
                if (releaseAtOnce && step == 20)
                    break;
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
                if (probe)
                {
                    XImage* image = XGetImage(display, root, rootX - 30, rootY - 30, 1, 1, AllPlanes, ZPixmap);
                    const unsigned long pixel = XGetPixel(image, 0, 0) & 0xffffffUL;
                    XDestroyImage(image);
                    if (pixel != 0x2a6f97UL)
                    {
                        std::fprintf(stderr, "Editor missing during drag, step %d: 0x%lx\n", step, pixel);
                        XTestFakeButtonEvent(display, Button1, False, CurrentTime);
                        XSync(display, False);
                        return 5;
                    }
                }
            }
        }
        XTestFakeButtonEvent(display, Button1, False, CurrentTime);
        if (std::strcmp(argv[1], "drag-probe") == 0)
        {
            XSync(display, False);
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            Window queryRoot = 0;
            Window queryParent = 0;
            Window* queryChildren = nullptr;
            unsigned queryCount = 0;
            XQueryTree(display, window, &queryRoot, &queryParent, &queryChildren, &queryCount);
            XWindowAttributes area {};
            const bool placed = queryCount > 0 && XGetWindowAttributes(display, queryChildren[0], &area) != 0
                                && area.x >= 0 && area.y >= 0 && area.width > 1;
            XFree(queryChildren);
            if (! placed)
            {
                std::fprintf(stderr, "The editor did not return: %d,%d %dx%d\n", area.x, area.y, area.width,
                             area.height);
                return 6;
            }
        }
    }
    XSync(display, False);
    XCloseDisplay(display);
    return 0;
}
