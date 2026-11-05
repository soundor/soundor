#include "FixtureNative.h"
#include "pluginterfaces/base/funknownimpl.h"

#include <X11/Xlib.h>

#include <cstdio>

namespace soundor::fixtures
{
    using namespace Steinberg;

    namespace
    {
        class Timer final : public U::Implements<U::Directly<Linux::ITimerHandler>>
        {
        public:
            explicit Timer(std::function<void()> tick) : tick_(std::move(tick)) {}
            void PLUGIN_API onTimer() override { tick_(); }

        private:
            std::function<void()> tick_;
        };

        class Events final : public U::Implements<U::Directly<Linux::IEventHandler>>
        {
        public:
            Events(Display* display, Window window) : display_(display), window_(window) {}
            void PLUGIN_API onFDIsSet(Linux::FileDescriptor /*fd*/) override
            {
                while (XPending(display_) > 0)
                {
                    XEvent event {};
                    XNextEvent(display_, &event);
                    if (event.type == Expose || event.type == ConfigureNotify)
                        unpainted_ = paintDelay;
                    if (event.type == ClientMessage)
                        std::fprintf(stderr, "fixture: queued event handled\n");
                }
            }

            /** From the timer. An editor paints its own window, a while after
                it was resized as JUCE's do: the server does not. */
            void tick()
            {
                // As a round trip does to what arrives during it: an event in
                // Xlib's queue, and nothing on the connection to say so.
                if (++ticks_ == queuedEventTick)
                {
                    XEvent event {};
                    event.xclient.type = ClientMessage;
                    event.xclient.window = window_;
                    event.xclient.format = 32;
                    XPutBackEvent(display_, &event);
                }
                if (unpainted_ == 0)
                    return;
                --unpainted_;
                if (unpainted_ > 0)
                    return;
                XWindowAttributes attributes {};
                XGetWindowAttributes(display_, window_, &attributes);
                GC context = DefaultGC(display_, DefaultScreen(display_));
                XSetForeground(display_, context, 0x2a6f97);
                XFillRectangle(display_, window_, context, 0, 0, static_cast<unsigned>(attributes.width),
                               static_cast<unsigned>(attributes.height));
                XFlush(display_);
            }

        private:
            static constexpr int paintDelay = 3;
            static constexpr int queuedEventTick = 50;

            Display* display_;
            Window window_;
            int unpainted_ = 0;
            int ticks_ = 0;
        };
    } // namespace

    struct NativeChild
    {
        Display* display = nullptr;
        Window window = 0;
        IPtr<Linux::IRunLoop> runLoop;
        IPtr<Timer> timer;
        IPtr<Events> events;
    };

    const char* platformType()
    {
        return kPlatformTypeX11EmbedWindowID;
    }

    NativeChild* createChild(void* parent, int width, int height, IPlugFrame* frame, std::function<void()> tick)
    {
        // The run loop comes from the frame, as IRunLoop's documentation says.
        auto runLoop = U::cast<Linux::IRunLoop>(frame);
        if (runLoop == nullptr)
            return nullptr;
        Display* display = XOpenDisplay(nullptr);
        if (display == nullptr)
            return nullptr;
        auto* child = new NativeChild;
        child->display = display;
        child->runLoop = runLoop;
        const int screen = DefaultScreen(display);
        child->window =
            XCreateSimpleWindow(display, reinterpret_cast<Window>(parent), 0, 0, static_cast<unsigned>(width),
                                static_cast<unsigned>(height), 0, BlackPixel(display, screen), 0x2a6f97);
        XSetWindowBackgroundPixmap(display, child->window, None);
        XSelectInput(display, child->window, ExposureMask | StructureNotifyMask);
        XMapWindow(display, child->window);
        XFlush(display);
        child->events = owned(new Events(display, child->window));
        child->timer = owned(new Timer(
            [tick = std::move(tick), events = child->events]
            {
                tick();
                events->tick();
            }));
        runLoop->registerTimer(child->timer, 10);
        runLoop->registerEventHandler(child->events, ConnectionNumber(display));
        return child;
    }

    void resizeChild(NativeChild* child, int width, int height)
    {
        XResizeWindow(child->display, child->window, static_cast<unsigned>(width), static_cast<unsigned>(height));
        XFlush(child->display);
    }

    void destroyChild(NativeChild* child)
    {
        child->runLoop->unregisterTimer(child->timer);
        child->runLoop->unregisterEventHandler(child->events);
        XDestroyWindow(child->display, child->window);
        XCloseDisplay(child->display);
        delete child;
    }
} // namespace soundor::fixtures
