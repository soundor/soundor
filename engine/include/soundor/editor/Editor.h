#pragma once

// A plugin's editor, as far as the engine goes: what every runtime's
// editor does with it, in one place. The runtime's side (a JUCE
// AudioProcessorEditor, a VST3 IPlugView) is a Platform: it owns the native
// view and the loop that drives it, and editor::Editor owns the rest:
//
// - the runtime: a RuntimeHost, or a DevSession that reloads it;
// - placing the UI in the editor (editor::place(), soundor.config's `editor`);
// - the compositor: on the GPU in the native view where there is one, on the
//   CPU into the editor's RasterTarget otherwise, and back to the CPU when
//   the GPU is lost;
// - native input (input::PlatformInput), and the framework's where there is
//   none, given to the UI in its layout's coordinates;
// - the pointer lock, the cursor, platform accessibility and, in debug
//   builds, the DevTools bridge;
// - the order of a frame (frame()).
//
// Everything runs on the editor's UI thread: the editor calls frame() about
// 60 times a second (a timer, a VST3 host's IRunLoop), readInput() when the
// native input's descriptor is readable, and resized() when its size changes.

#include <soundor/Abi.h>
#include <soundor/a11y/Platform.h>
#include <soundor/editor/Layout.h>
#include <soundor/input/Platform.h>
#include <soundor/input/PointerLock.h>
#include <soundor/render/Compositor.h>
#include <soundor/runtime/RuntimeHost.h>
#include <soundor/ui/Style.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    class DevSession;
    namespace render
    {
        class GpuCompositor;
    } // namespace render
    namespace debug
    {
        class Bridge;
    } // namespace debug
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
{
    // The runtime's side of an Editor: what it tells the Editor, and does
    // for it. Called on the UI thread, from the Editor's own calls (frame(),
    // resized(), the input ones).
    class Platform
    {
    public:
        struct State
        {
            // Where the UI is shown: the X11 window (its XID), the NSView, the
            // HWND. Null while there is none (the compositor is the CPU one).
            void* nativeView = nullptr;
            // The editor's size, in its logical pixels.
            ui::Size size;
            // The editor's top-left corner in the native view, and native
            // units per logical pixel: physical pixels (macOS: points).
            ui::Point origin;
            float nativeScale = 1;
            // Device pixels per logical pixel: the UI's pixel density at a
            // zoom of 1.
            float pixelScale = 1;
            // The editor's top-left corner on the screen, in physical pixels,
            // for accessibility where it says so (Linux, Windows); nullopt
            // where the platform finds it itself (macOS) or it is unknown.
            std::optional<ui::Point> screenOrigin;
            // Whether the editor is shown.
            bool visible = false;
            // Whether the editor has the keyboard focus, as the framework
            // sees it: used while there is no native input.
            bool focused = false;
            // The framework shows something of its own over the view (a
            // menu, a modal dialog), whose input it is (see
            // PlatformInput::setSuspended()).
            bool inputSuspended = false;
        };

        virtual ~Platform() = default;

        [[nodiscard]] virtual State state() = 0;
        // Shows `cursor` over the view.
        virtual void setCursor(ui::Cursor cursor) = 0;

        // A size the UI asks for (requestEditorSize()), held to the editor's
        // limits as a resize would be, so the UI knows at once what is
        // asked of the host. Only with Options::canRequestSize.
        [[nodiscard]] virtual ui::Size holdSize(ui::Size wanted) { return wanted; }
        // The UI asked for `wanted` (logical pixels, unheld): resize the
        // editor, as the framework does. Once a frame at most, after the
        // UI's code ran. Only with Options::canRequestSize.
        virtual void requestSize(ui::Size wanted) { (void)wanted; }

        // The pixel density to rasterize the UI at, given the one it is shown
        // at (`wanted`, zoom included): a CPU editor may keep its pixels
        // during a resize and scale them instead.
        [[nodiscard]] virtual float surfaceScale(float wanted, bool gpu)
        {
            (void)gpu;
            return wanted;
        }
        // Where the UI now is in the editor: for the editor's RasterTarget,
        // which shows the CPU compositor's frames there.
        virtual void placed(const Placement& placement) { (void)placement; }

        // A pointer pressed in the view (natively or by the framework's
        // input), before the UI gets it.
        virtual void pressed() {}

        // The native input started for the native view (watch its
        // fileDescriptor() and call readInput() when readable), or could not
        // (the framework's input stays, where it has one).
        virtual void inputStarted(input::PlatformInput& input) { (void)input; }
        virtual void inputFailed(const std::string& why) { (void)why; }
        // Every frame, after the native input is told where the editor is.
        virtual void inputPlaced(input::PlatformInput& input) { (void)input; }
        // The native input is going (a new native view, the Editor closing):
        // stop watching its descriptor.
        virtual void inputStopping(input::PlatformInput& input) { (void)input; }
        // The framework's pointer, for a pointer lock while there is no
        // native input; null: none.
        [[nodiscard]] virtual std::unique_ptr<input::PointerLock::Source> pointerSource(int pointerId)
        {
            (void)pointerId;
            return nullptr;
        }

        // The native view as accessibility takes it (macOS: with the
        // framework's element its elements are children of).
        [[nodiscard]] virtual a11y::NativeView accessibilityView(void* nativeView) { return { nativeView, nullptr }; }
        // The platform accessibility the Editor now presents in the native
        // view, or null (gone): macOS lists its container as the view's
        // accessibility child.
        virtual void accessibilityChanged(a11y::PlatformAccessibility* accessibility) { (void)accessibility; }
    };

    class Editor
    {
    public:
        struct Options
        {
            // soundor.config's `editor`.
            Layout layout;
            // Whether the UI can ask for another editor size: a resizable
            // editor whose limits allow one.
            bool canRequestSize = false;
            // What shows around the UI and where no layer draws (0xAARRGGBB).
            std::uint32_t background = 0xFF000000;
            // Where the CPU compositor presents; the editor shows it.
            render::RasterTarget* raster = nullptr;
            // The runtime's options; the Editor adds the GPU device.
            RuntimeHost::Options runtime;
            // Not empty: `soundor dev`'s bundle directory, reloaded
            // (DevSession) rather than `runtime.resources`.
            std::filesystem::path bundleDirectory;
            // Whether to read the platform's own input; else the editor gives
            // the framework's (pointer(), wheel(), key(), text(), focus()).
            bool nativeInput = true;
            std::chrono::milliseconds doubleClickTime { 400 };
            // The plugin's name (accessibility, DevTools) and the runtime's
            // ("JUCE", "VST3"), as DevTools lists them.
            std::string name;
            std::string runtimeName;
        };

        Editor(Platform& owner, Options provided);
        // Ends a press or keys in progress without telling the UI (endInput()
        // tells it), then destroys the runtime.
        ~Editor();

        Editor(const Editor&) = delete;
        Editor& operator=(const Editor&) = delete;
        Editor(Editor&&) = delete;
        Editor& operator=(Editor&&) = delete;

        // One frame: reads the native input, places the UI, ticks the runtime
        // (parameters, timers, async work), applies a size the UI asked for,
        // updates accessibility, the pointer lock and the cursor, DevTools,
        // the compositor, and renders when the picture changed.
        void frame();
        // The editor's size or place changed: the UI is placed at once and,
        // on the GPU, presented at the new size, so a window being dragged
        // larger does not show the last frame stretched.
        void resized();

        // The native input's descriptor became readable.
        void readInput();
        // The native input's descriptor: -1 while there is none.
        [[nodiscard]] int inputDescriptor() const noexcept { return descriptor; }
        [[nodiscard]] input::PlatformInput* nativeInput() noexcept { return input.get(); }
        // Ends what the native input was in the middle of (a press, held
        // keys), telling the UI, as if the view went away.
        void endInput();

        // The framework's input, in the editor's logical pixels (or the
        // native input's events). Whether the UI handled it.
        void pointer(ui::PointerInput event);
        bool wheel(ui::WheelInput event);
        bool key(const ui::KeyInput& event, const std::string& typed = {});
        void text(const ui::TextInput& event);
        void focus(bool now);
        void deliver(input::Event& event);

        // Whether the view has the keyboard focus: the native input's view,
        // or the framework's.
        [[nodiscard]] bool focused() const;
        // Whether the compositor presents on the GPU, over the view.
        [[nodiscard]] bool gpu() const noexcept { return gpuCompositor != nullptr; }
        [[nodiscard]] const Placement& placement() const noexcept { return where; }
        // The runtime now: replaced by a reload under `soundor dev`, so do
        // not keep it.
        [[nodiscard]] RuntimeHost& runtime() noexcept;

    private:
        void updateInput(const Platform::State& state);
        void stopInput(bool tellUi);
        void place(const Platform::State& state);
        void tickRuntime();
        void updateAccessibility(const Platform::State& state);
        void updatePointerLock();
        void updateCursor();
        void updateCompositor(const Platform::State& state);
        void render();
        void log(js::LogLevel level, const std::string& message) const;
        [[nodiscard]] bool textInputFocused();

        Platform& platform;
        // Without `runtime`, which the runtime took.
        Options options;
        js::LogSink logSink;
        std::shared_ptr<gpu::Device> gpuDevice;
        std::unique_ptr<RuntimeHost> host;
        std::unique_ptr<DevSession> session;
        Platform::State last;
        Placement where;

        std::unique_ptr<render::Compositor> compositor;
        render::GpuCompositor* gpuCompositor = nullptr;
        render::Capabilities capabilities;
        void* compositorView = nullptr;
        bool gpuLost = false;

        std::unique_ptr<input::PlatformInput> input;
        void* inputView = nullptr;
        int descriptor = -1;
        bool reading = false;
        std::vector<input::Event> events;
        // Moves the input's pointer: destroyed (ending a lock) before it.
        input::PointerLock pointerLock;

        std::unique_ptr<a11y::PlatformAccessibility> accessibility;
        void* accessibilityView = nullptr;
        bool accessibilityFocused = false;

        std::optional<ui::Cursor> cursor;
        // Debug builds (SOUNDOR_DEVTOOLS): the DevTools session's connection
        // (SOUNDOR_DEVTOOLS_SESSION), and SOUNDOR_SHOW_RENDERER=1's badge
        // naming the compositor. Members either way, so the class is the
        // same in every build (shared: Bridge is only defined in those).
        std::shared_ptr<debug::Bridge> bridge;
        [[maybe_unused]] bool showRenderer = false;
        [[maybe_unused]] ui::NodeId rendererBadge = ui::noNode;
        void updateRendererBadge();
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
