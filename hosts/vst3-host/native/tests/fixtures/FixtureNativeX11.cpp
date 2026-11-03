#include "FixtureNative.h"
#include "pluginterfaces/base/funknownimpl.h"

#include <X11/Xlib.h>

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
            explicit Events(Display* display) : display_(display) {}
            void PLUGIN_API onFDIsSet(Linux::FileDescriptor /*fd*/) override
            {
                while (XPending(display_) > 0)
                {
                    XEvent event {};
                    XNextEvent(display_, &event);
                }
            }

        private:
            Display* display_;
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
        XMapWindow(display, child->window);
        XFlush(display);
        child->timer = owned(new Timer(std::move(tick)));
        child->events = owned(new Events(display));
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
