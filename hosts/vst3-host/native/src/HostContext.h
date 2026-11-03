// The host's side of VST3: what a plugin receives as its host context
// (IHostApplication, and on Linux IRunLoop), as its controller's component
// handler, and as its editor's frame.
#pragma once

#include "EventLoop.h"
#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"

#include <map>
#include <vector>

namespace soundor::vst3host
{
    using namespace Steinberg;

#if defined(__linux__)
    /** Linux::IRunLoop over the main thread's EventLoop. Handlers are
        released on a later turn of the loop, never inside their own call. */
    class RunLoop final : public U::Implements<U::Directly<Linux::IRunLoop>>
    {
    public:
        explicit RunLoop(EventLoop& loop) : loop_(loop) {}
        ~RunLoop() override { clear(); }

        tresult PLUGIN_API registerEventHandler(Linux::IEventHandler* handler, Linux::FileDescriptor fd) override;
        tresult PLUGIN_API unregisterEventHandler(Linux::IEventHandler* handler) override;
        tresult PLUGIN_API registerTimer(Linux::ITimerHandler* handler, Linux::TimerInterval milliseconds) override;
        tresult PLUGIN_API unregisterTimer(Linux::ITimerHandler* handler) override;

        /** Drops every registration: before a plugin's module is unloaded. */
        void clear();

    private:
        void releaseLater(FUnknown* object);

        EventLoop& loop_;
        std::multimap<Linux::IEventHandler*, EventLoop::Id> handlers_;
        std::multimap<Linux::ITimerHandler*, EventLoop::Id> timers_;
    };
#endif

    /** IHostApplication (and IPlugInterfaceSupport), plus IRunLoop on Linux,
        which plugins may ask their host context for even without an editor. */
    class HostApplication final : public Vst::HostApplication
    {
    public:
        explicit HostApplication(FUnknown* runLoop) : runLoop_(runLoop) {}
        tresult PLUGIN_API getName(Vst::String128 name) override;
        tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override;

    private:
        FUnknown* runLoop_;
    };

    /** What the plugin's controller and editor ask of the host. */
    class HostListener
    {
    public:
        virtual ~HostListener() = default;
        virtual void beginEdit(Vst::ParamID id) = 0;
        virtual void performEdit(Vst::ParamID id, Vst::ParamValue value) = 0;
        virtual void endEdit(Vst::ParamID id) = 0;
        virtual void restartComponent(int32 flags) = 0;
        virtual void setDirty(bool dirty) = 0;
        virtual void requestOpenEditor() = 0;
        /** IPlugFrame::resizeView. */
        virtual bool resizeView(IPlugView* view, ViewRect* size) = 0;
    };

    class ComponentHandler final : public U::Implements<U::Directly<Vst::IComponentHandler, Vst::IComponentHandler2>>
    {
    public:
        explicit ComponentHandler(HostListener& listener) : listener_(listener) {}

        tresult PLUGIN_API beginEdit(Vst::ParamID id) override;
        tresult PLUGIN_API performEdit(Vst::ParamID id, Vst::ParamValue valueNormalized) override;
        tresult PLUGIN_API endEdit(Vst::ParamID id) override;
        tresult PLUGIN_API restartComponent(int32 flags) override;

        tresult PLUGIN_API setDirty(TBool state) override;
        tresult PLUGIN_API requestOpenEditor(FIDString name) override;
        tresult PLUGIN_API startGroupEdit() override { return kResultOk; }
        tresult PLUGIN_API finishGroupEdit() override { return kResultOk; }

    private:
        HostListener& listener_;
    };

#if defined(__linux__)
    class PlugFrame final : public U::Implements<U::Directly<IPlugFrame, Linux::IRunLoop>>
#else
    class PlugFrame final : public U::Implements<U::Directly<IPlugFrame>>
#endif
    {
    public:
        PlugFrame(HostListener& listener, FUnknown* runLoop) : listener_(listener), runLoop_(runLoop) {}

        tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* newSize) override;

#if defined(__linux__)
        tresult PLUGIN_API registerEventHandler(Linux::IEventHandler* handler, Linux::FileDescriptor fd) override;
        tresult PLUGIN_API unregisterEventHandler(Linux::IEventHandler* handler) override;
        tresult PLUGIN_API registerTimer(Linux::ITimerHandler* handler, Linux::TimerInterval milliseconds) override;
        tresult PLUGIN_API unregisterTimer(Linux::ITimerHandler* handler) override;
#endif

    private:
        HostListener& listener_;
        FUnknown* runLoop_;
    };
} // namespace soundor::vst3host
