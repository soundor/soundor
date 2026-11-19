#pragma once

// The VST3 view (IPlugView, X11EmbedWindowID): the plugin's UI, as the
// engine runs it. Its part is only what a plugin framework's is in the JUCE
// runtime: a window in the host's (its own X11 child window, on a
// connection of its own), the run loop the host lends (IRunLoop: a 60 Hz
// timer and the connections' descriptors), sizes, and hands everything else
// to the engine, unchanged:
//
// - RuntimeHost: the JavaScript world, layout, the `soundor:*` modules;
// - render::GpuCompositor in the window where there is a GPU (its own
//   input-transparent child window), else render::RasterCompositor, whose
//   frames this shows with XPutImage;
// - input::PlatformInput (XInput 2, on its own connection) for pointer,
//   wheel, keys, text and focus;
// - a11y::PlatformAccessibility (AT-SPI) for screen readers.

#include "Controller.h"
#include "X11.h"

#include <soundor/a11y/Platform.h>
#include <soundor/input/Platform.h>
#include <soundor/render/Compositor.h>
#include <soundor/render/GpuCompositor.h>
#include <soundor/runtime/DevSession.h>
#include <soundor/runtime/RuntimeHost.h>

#include <pluginterfaces/gui/iplugview.h>
#include <pluginterfaces/gui/iplugviewcontentscalesupport.h>
#include <public.sdk/source/common/pluginview.h>

#include <memory>
#include <vector>

namespace soundor::vst3
{
    namespace render = soundor::render;
    namespace input = soundor::input;
    namespace a11y = soundor::a11y;
    namespace ui = soundor::ui;
    namespace gpu = soundor::gpu;
    using RuntimeHost = soundor::RuntimeHost;
    using DevSession = soundor::DevSession;

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
                         public Steinberg::Linux::IEventHandler
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
        struct Area
        {
            // In the window's logical pixels.
            float x = 0;
            float y = 0;
            float width = 0;
            float height = 0;
        };

        [[nodiscard]] RuntimeHost& runtimeHost();
        void open();
        void close();
        void createRuntime();
        // The view's logical size, from its physical rect.
        [[nodiscard]] float logicalWidth() const;
        [[nodiscard]] float logicalHeight() const;
        // How many layout pixels per logical one: 1, or the zoom of a scaling editor.
        [[nodiscard]] float zoom() const;
        [[nodiscard]] Area uiArea() const;
        void sizeSurface();
        void updateCompositor();
        void renderFrame();
        void readWindowEvents();
        [[nodiscard]] void* nativeWindow() const noexcept;
        void readInput();
        void deliver(input::Event& event);
        void updateInputGeometry();
        void updateAccessibility();
        void updateCursor();
        void applySizeRequest();
        void tick();
        [[nodiscard]] Steinberg::ViewRect constrained(Steinberg::ViewRect wanted) const;

        Controller* controller;
        const Plugin& definition;
        std::unique_ptr<x11::Window> window;
        Steinberg::IPtr<Steinberg::Linux::IRunLoop> runLoop;
        float contentScale = 1;

        std::shared_ptr<gpu::Device> gpuDevice;
        std::shared_ptr<UiParameters> uiParameters;
        std::unique_ptr<RuntimeHost> host;
        std::unique_ptr<DevSession> session;
        js::LogSink logSink;

        WindowTarget image;
        std::unique_ptr<render::Compositor> compositor;
        render::GpuCompositor* gpu = nullptr;
        render::Capabilities capabilities;
        bool gpuLost = false;

        std::unique_ptr<input::PlatformInput> nativeInput;
        int inputDescriptor = -1;
        bool readingInput = false;
        std::vector<input::Event> events;
        bool focusedByHost = false;

        std::unique_ptr<a11y::PlatformAccessibility> accessibility;
        bool accessibilityFocused = false;

        ui::Cursor cursor = ui::Cursor::Auto;
        bool attachedToHost = false;
    };
} // namespace soundor::vst3
