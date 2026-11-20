#pragma once

// The VST3 view (IPlugView): the plugin's UI, as the engine runs it. Its
// part is a plugin framework's: a window in the host's (NativeWindow: an X11 child window on Linux, an NSView on macOS,
// a child HWND on Windows), a run loop (the one the host lends on Linux, IRunLoop: a 60 Hz timer and the connections'
// descriptors; a timer of the UI thread's run loop elsewhere), sizes, and the host's calls. The engine's editor::Editor
// does the rest: the runtime, placing the UI, the compositor (on the GPU in the window where there is one, else on the
// CPU, whose frames the window shows), native input, the pointer lock, the cursor and accessibility.

#include "Controller.h"
#include "NativeWindow.h"
#include "Timer.h"

#include <soundor/editor/Editor.h>
#include <soundor/render/Compositor.h>

#include <pluginterfaces/gui/iplugview.h>
#include <pluginterfaces/gui/iplugviewcontentscalesupport.h>
#include <public.sdk/source/common/pluginview.h>

#include <memory>
#include <vector>

namespace soundor::vst3
{
    namespace render = soundor::render;
    namespace input = soundor::input;
    namespace ui = soundor::ui;
    namespace editor = soundor::editor;

    class Editor final : public Steinberg::CPluginView,
                         public Steinberg::IPlugViewContentScaleSupport,
                         public Steinberg::Linux::ITimerHandler,
                         public Steinberg::Linux::IEventHandler,
                         private editor::Platform
    {
    public:
        explicit Editor(Controller& owner);
        ~Editor() override;
        Editor(const Editor&) = delete;
        Editor& operator=(const Editor&) = delete;
        Editor(Editor&&) = delete;
        Editor& operator=(Editor&&) = delete;

        // IPlugView
        Steinberg::tresult PLUGIN_API isPlatformTypeSupported(Steinberg::FIDString type) override;
        Steinberg::tresult PLUGIN_API attached(void* parent, Steinberg::FIDString type) override;
        Steinberg::tresult PLUGIN_API removed() override;
        Steinberg::tresult PLUGIN_API onSize(Steinberg::ViewRect* newSize) override;
        Steinberg::tresult PLUGIN_API canResize() override;
        Steinberg::tresult PLUGIN_API checkSizeConstraint(Steinberg::ViewRect* wanted) override;
        Steinberg::tresult PLUGIN_API getSize(Steinberg::ViewRect* size) override;
        Steinberg::tresult PLUGIN_API onFocus(Steinberg::TBool state) override;
        // IPlugViewContentScaleSupport
        Steinberg::tresult PLUGIN_API setContentScaleFactor(ScaleFactor factor) override;
        // ITimerHandler, IEventHandler
        void PLUGIN_API onTimer() override;
        void PLUGIN_API onFDIsSet(Steinberg::Linux::FileDescriptor fd) override;

        // The controller is terminating: let go of it.
        void controllerGone();

        OBJ_METHODS(Editor, CPluginView)
        DEFINE_INTERFACES
        DEF_INTERFACE(Steinberg::IPlugViewContentScaleSupport)
        DEF_INTERFACE(Steinberg::Linux::ITimerHandler)
        DEF_INTERFACE(Steinberg::Linux::IEventHandler)
        END_DEFINE_INTERFACES(CPluginView)
        REFCOUNT_METHODS(CPluginView)

    private:
        void open();
        void close();
        [[nodiscard]] editor::Editor::Options editorOptions();
        // The view's logical size, from its physical rect.
        [[nodiscard]] ui::Size logicalSize() const;
        // Native units (the window's: ViewRect's) per logical pixel.
        [[nodiscard]] float nativeScale() const noexcept;
        void readWindowEvents();
        void tick();
        [[nodiscard]] Steinberg::ViewRect constrained(Steinberg::ViewRect wanted) const;
        [[nodiscard]] Steinberg::ViewRect physical(ui::Size logical) const;

        // editor::Platform
        State state() override;
        void setCursor(ui::Cursor shape) override;
        ui::Size holdSize(ui::Size wanted) override;
        void requestSize(ui::Size wanted) override;
        void placed(const editor::Placement& placement) override;
        void pressed() override;
        void inputStarted(input::PlatformInput& input) override;
        void inputFailed(const std::string& why) override;

        Controller* controller;
        const Plugin& definition;
        std::unique_ptr<NativeWindow> window;
        // Linux: the host's run loop; elsewhere, a timer of the UI thread's.
        Steinberg::IPtr<Steinberg::Linux::IRunLoop> runLoop;
        std::unique_ptr<Timer> timer;
        float contentScale = 1;
        std::shared_ptr<UiParameters> uiParameters;
        js::LogSink logSink;
        // After the window it shows frames in, so it goes first.
        std::unique_ptr<editor::Editor> engineEditor;
        bool focusedByHost = false;
        bool attachedToHost = false;
    };
} // namespace soundor::vst3
