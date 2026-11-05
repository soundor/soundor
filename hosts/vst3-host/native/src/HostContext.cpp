#include "HostContext.h"

#include "pluginterfaces/base/ustring.h"

#if defined(__linux__)
    #include <sys/socket.h>
    #include <sys/un.h>

    #include <cstddef>
    #include <string_view>
#endif

namespace soundor::vst3host
{
#if defined(__linux__)
    namespace
    {
        constexpr unsigned xRecheckMilliseconds = 16;

        bool isXConnection(int fd)
        {
            sockaddr_un address {};
            socklen_t size = sizeof address;
            if (getpeername(fd, reinterpret_cast<sockaddr*>(&address), &size) != 0 || address.sun_family != AF_UNIX
                || size <= offsetof(sockaddr_un, sun_path))
                return false;
            // Abstract sockets start with a NUL.
            const std::string_view path(address.sun_path, size - offsetof(sockaddr_un, sun_path));
            return path.find("/.X11-unix/") != std::string_view::npos;
        }
    } // namespace

    // A handler that unregisters itself while it runs may drop the last other
    // reference. It is released at once when it unregisters, never on a later
    // turn: JUCE's handlers do not count references, and can be gone by then.
    void RunLoop::fireFd(Linux::IEventHandler* handler, Linux::FileDescriptor fd)
    {
        const IPtr<Linux::IEventHandler> alive(handler);
        handler->onFDIsSet(fd);
    }

    tresult PLUGIN_API RunLoop::registerEventHandler(Linux::IEventHandler* handler, Linux::FileDescriptor fd)
    {
        if (handler == nullptr)
            return kInvalidArgument;
        handler->addRef();
        const auto id = loop_.addFd(fd, [handler, fd] { fireFd(handler, fd); });
        handlers_.emplace(handler, id);
        // Xlib reads whatever is on its connection during any round trip into a
        // queue of its own, and then the connection has nothing to read: an
        // event that arrived during one (a click) would wait for the next. So
        // an X connection's handler is asked to look again, every frame. Only
        // those: they must drain that queue anyway, and do not block with
        // nothing there, as a handler of any other descriptor might.
        if (isXConnection(fd))
            rechecks_.emplace(handler, loop_.addTimer(xRecheckMilliseconds, [handler, fd] { fireFd(handler, fd); }));
        return kResultTrue;
    }

    tresult PLUGIN_API RunLoop::unregisterEventHandler(Linux::IEventHandler* handler)
    {
        const auto [first, last] = handlers_.equal_range(handler);
        if (first == last)
            return kInvalidArgument;
        const auto [recheck, lastRecheck] = rechecks_.equal_range(handler);
        for (auto it = recheck; it != lastRecheck; ++it)
            loop_.removeTimer(it->second);
        rechecks_.erase(recheck, lastRecheck);
        for (auto it = first; it != last; ++it)
        {
            loop_.removeFd(it->second);
            handler->release();
        }
        handlers_.erase(first, last);
        return kResultTrue;
    }

    tresult PLUGIN_API RunLoop::registerTimer(Linux::ITimerHandler* handler, Linux::TimerInterval milliseconds)
    {
        if (handler == nullptr)
            return kInvalidArgument;
        handler->addRef();
        const auto id = loop_.addTimer(static_cast<unsigned>(milliseconds),
                                       [handler]
                                       {
                                           const IPtr<Linux::ITimerHandler> alive(handler);
                                           handler->onTimer();
                                       });
        timers_.emplace(handler, id);
        return kResultTrue;
    }

    tresult PLUGIN_API RunLoop::unregisterTimer(Linux::ITimerHandler* handler)
    {
        const auto [first, last] = timers_.equal_range(handler);
        if (first == last)
            return kInvalidArgument;
        for (auto it = first; it != last; ++it)
        {
            loop_.removeTimer(it->second);
            handler->release();
        }
        timers_.erase(first, last);
        return kResultTrue;
    }

    void RunLoop::clear()
    {
        // The module is about to go: release now, not on a later turn.
        for (const auto& [handler, id] : rechecks_)
            loop_.removeTimer(id);
        rechecks_.clear();
        for (const auto& [handler, id] : handlers_)
        {
            loop_.removeFd(id);
            handler->release();
        }
        for (const auto& [handler, id] : timers_)
        {
            loop_.removeTimer(id);
            handler->release();
        }
        handlers_.clear();
        timers_.clear();
    }
#endif

    tresult PLUGIN_API HostApplication::getName(Vst::String128 name)
    {
        UString(name, 128).fromAscii("Soundor VST3 Host");
        return kResultOk;
    }

    tresult PLUGIN_API HostApplication::queryInterface(const TUID iid, void** obj)
    {
#if defined(__linux__)
        if (runLoop_ != nullptr && FUnknownPrivate::iidEqual(iid, Linux::IRunLoop::iid))
            return runLoop_->queryInterface(iid, obj);
#endif
        return Vst::HostApplication::queryInterface(iid, obj);
    }

    tresult PLUGIN_API ComponentHandler::beginEdit(Vst::ParamID id)
    {
        listener_.beginEdit(id);
        return kResultOk;
    }

    tresult PLUGIN_API ComponentHandler::performEdit(Vst::ParamID id, Vst::ParamValue valueNormalized)
    {
        listener_.performEdit(id, valueNormalized);
        return kResultOk;
    }

    tresult PLUGIN_API ComponentHandler::endEdit(Vst::ParamID id)
    {
        listener_.endEdit(id);
        return kResultOk;
    }

    tresult PLUGIN_API ComponentHandler::restartComponent(int32 flags)
    {
        listener_.restartComponent(flags);
        return kResultOk;
    }

    tresult PLUGIN_API ComponentHandler::setDirty(TBool state)
    {
        listener_.setDirty(state != 0);
        return kResultOk;
    }

    tresult PLUGIN_API ComponentHandler::requestOpenEditor(FIDString name)
    {
        if (name == nullptr || std::string_view(name) != Vst::ViewType::kEditor)
            return kResultFalse;
        listener_.requestOpenEditor();
        return kResultOk;
    }

    tresult PLUGIN_API PlugFrame::resizeView(IPlugView* view, ViewRect* newSize)
    {
        if (view == nullptr || newSize == nullptr)
            return kInvalidArgument;
        return listener_.resizeView(view, newSize) ? kResultTrue : kResultFalse;
    }

#if defined(__linux__)
    namespace
    {
        IPtr<Linux::IRunLoop> runLoopOf(FUnknown* object)
        {
            return U::cast<Linux::IRunLoop>(object);
        }
    } // namespace

    tresult PLUGIN_API PlugFrame::registerEventHandler(Linux::IEventHandler* handler, Linux::FileDescriptor fd)
    {
        return runLoopOf(runLoop_)->registerEventHandler(handler, fd);
    }

    tresult PLUGIN_API PlugFrame::unregisterEventHandler(Linux::IEventHandler* handler)
    {
        return runLoopOf(runLoop_)->unregisterEventHandler(handler);
    }

    tresult PLUGIN_API PlugFrame::registerTimer(Linux::ITimerHandler* handler, Linux::TimerInterval milliseconds)
    {
        return runLoopOf(runLoop_)->registerTimer(handler, milliseconds);
    }

    tresult PLUGIN_API PlugFrame::unregisterTimer(Linux::ITimerHandler* handler)
    {
        return runLoopOf(runLoop_)->unregisterTimer(handler);
    }
#endif
} // namespace soundor::vst3host
