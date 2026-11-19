#pragma once

// The VST3 view (IPlugView, X11EmbedWindowID): the plugin's UI, as the
// engine runs it. Its part is what a plugin framework's is in the JUCE
// runtime: a window in the host's (its own X11 child window, on a
// connection of its own), the run loop the host lends (IRunLoop: a 60 Hz
// timer and the connections' descriptors), sizes, and the host's calls. The
// engine's editor::Editor does the rest, as for the JUCE runtime's editor:
// the runtime, placing the UI, the compositor (on the GPU in the window
// where there is one, else on the CPU, whose frames this shows with
// XPutImage), native input (XInput 2), the pointer lock, the cursor and
// accessibility (AT-SPI).

#include "Controller.h"
#include "X11.h"

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

    // A CPU compositor's frames, shown in the editor's window.
    class WindowTarget final : public render::RasterTarget
    {
    public:
        void attach(x11::Window* window)
        {
            target = window;
            imageWidth = imageHeight = 0;
        }
        Pixels acquire(int width, int height) override;
        void present(const render::Region& damage) override;
        // Where the frame goes in the window (physical pixels), and the
        // colour of the bands around it.
        void setPlacement(int x, int y, std::uint32_t background);
        // Shows the last frame again, and the bands (an Expose, a resize).
        void repaint();

    private:
        void put(int x, int y, int width, int height);

        x11::Window* target = nullptr;
        std::vector<std::uint32_t> pixels;
        int imageWidth = 0;
        int imageHeight = 0;
        int left = 0;
        int top = 0;
        std::uint32_t fill = 0xFF000000;
    };

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
        [[nodiscard]] void* nativeWindow() const noexcept;
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
        void inputStarted(input::PlatformInput& input) override;
        void inputFailed(const std::string& why) override;

        Controller* controller;
        const Plugin& definition;
        std::unique_ptr<x11::Window> window;
        Steinberg::IPtr<Steinberg::Linux::IRunLoop> runLoop;
        float contentScale = 1;
        std::shared_ptr<UiParameters> uiParameters;
        js::LogSink logSink;
        WindowTarget image;
        // After the window and the image it shows frames in, so it goes first.
        std::unique_ptr<editor::Editor> engineEditor;
        bool focusedByHost = false;
        bool attachedToHost = false;
    };
} // namespace soundor::vst3
