#include "Editor.h"

#include "Log.h"
#include "Modules.h"

#include <soundor/history/Module.h>
#include <soundor/midi/Midi.h>
#include <soundor/platform/Clipboard.h>
#include <soundor/platform/FileLog.h>
#include <soundor/platform/Platform.h>
#include <soundor/platform/Resources.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <limits>
#include <string>
#include <variant>

#ifndef SOUNDOR_VST3_RUNTIME_VERSION
    #define SOUNDOR_VST3_RUNTIME_VERSION "0.0.0"
#endif

namespace soundor::vst3
{
    using namespace Steinberg;
    namespace platform = soundor::platform;

    namespace
    {
        // The editor owns its runtime and keeps the controller alive.
        class HostInfo final : public platform::HostInfo
        {
        public:
            explicit HostInfo(const Controller& owner) : controller(owner) {}

            [[nodiscard]] platform::HostSnapshot snapshot() const override { return controller.hostSnapshot(); }

        private:
            const Controller& controller;
        };

        // <XDG config home>/Soundor/<plugin id>: where the JUCE runtime's
        // Linux plugins keep soundor:storage and soundor:fs too.
        std::filesystem::path dataDirectory(const std::string& pluginId)
        {
            std::filesystem::path base;
            // NOLINTNEXTLINE(concurrency-mt-unsafe): read on the UI thread; a plugin never sets the environment.
            if (const char* config = std::getenv("XDG_CONFIG_HOME"); config != nullptr && *config != 0)
                base = config;
            // NOLINTNEXTLINE(concurrency-mt-unsafe): as above.
            else if (const char* home = std::getenv("HOME"); home != nullptr && *home != 0)
                base = std::filesystem::path(home) / ".config";
            else
                return {};
            return base / "Soundor" / pluginId;
        }

        void logToStderr(js::LogLevel level, std::string_view message)
        {
            static constexpr const char* prefixes[] = { "[soundor] ", "[soundor] ",
                                                        "[soundor] warning: ", "[soundor] error: " };
            log(std::string(prefixes[static_cast<int>(level)]) + std::string(message));
        }

        x11::CursorIcon cursorIcon(ui::Cursor cursor)
        {
            switch (cursor)
            {
                case ui::Cursor::Pointer:
                    return x11::CursorIcon::Hand;
                case ui::Cursor::Text:
                    return x11::CursorIcon::Text;
                case ui::Cursor::Crosshair:
                    return x11::CursorIcon::Crosshair;
                case ui::Cursor::Move:
                    return x11::CursorIcon::Move;
                case ui::Cursor::EwResize:
                    return x11::CursorIcon::HorizontalResize;
                case ui::Cursor::NsResize:
                    return x11::CursorIcon::VerticalResize;
                case ui::Cursor::NeswResize:
                    return x11::CursorIcon::DiagonalResizeUp;
                case ui::Cursor::NwseResize:
                    return x11::CursorIcon::DiagonalResizeDown;
                case ui::Cursor::None:
                    return x11::CursorIcon::Hidden;
                default:
                    return x11::CursorIcon::Arrow;
            }
        }
    } // namespace

    // ── WindowTarget ─────────────────────────────────────────────────────────

    render::RasterTarget::Pixels WindowTarget::acquire(int width, int height)
    {
        width = std::max(1, width);
        height = std::max(1, height);
        bool preserved = true;
        if (width != imageWidth || height != imageHeight)
        {
            preserved = false;
            pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
            imageWidth = width;
            imageHeight = height;
            if (target != nullptr)
                target->setImage(pixels.data(), width, height);
        }
        return { { pixels.data(), width, height, static_cast<std::size_t>(width) * 4 }, preserved };
    }

    void WindowTarget::put(int x, int y, int width, int height)
    {
        if (target == nullptr)
            return;
        x = std::clamp(x, 0, imageWidth);
        y = std::clamp(y, 0, imageHeight);
        target->putImage(x, y, std::min(width, imageWidth - x), std::min(height, imageHeight - y), left, top);
    }

    void WindowTarget::present(const render::Region& damage)
    {
        for (const auto& rect : damage.rects())
            put(rect.x, rect.y, rect.width, rect.height);
        if (target != nullptr)
            target->flush();
    }

    void WindowTarget::setPlacement(int x, int y, std::uint32_t background)
    {
        left = x;
        top = y;
        fill = background;
    }

    void WindowTarget::repaint()
    {
        if (target == nullptr)
            return;
        // The bands around the frame, then the frame.
        constexpr int far = 32767;
        target->fill(0, 0, left, far, fill);
        target->fill(0, 0, far, top, fill);
        target->fill(left + imageWidth, 0, far, far, fill);
        target->fill(0, top + imageHeight, far, far, fill);
        put(0, 0, imageWidth, imageHeight);
        target->flush();
    }

    // ── Editor ───────────────────────────────────────────────────────────────

    Editor::Editor(Controller& owner) : controller(&owner), definition(owner.plugin())
    {
        const auto& size = definition.editor;
        rect = ViewRect(0, 0, size.width, size.height);
        owner.addRef();
    }

    Editor::~Editor()
    {
        close();
        if (controller != nullptr)
        {
            controller->editorClosed(this);
            controller->release();
        }
    }

    void Editor::controllerGone()
    {
        close();
        if (controller != nullptr)
        {
            auto* owner = controller;
            controller = nullptr;
            owner->release();
        }
    }

    tresult PLUGIN_API Editor::isPlatformTypeSupported(FIDString type)
    {
        return type != nullptr && std::strcmp(type, kPlatformTypeX11EmbedWindowID) == 0 ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API Editor::attached(void* parent, FIDString type)
    {
        if (parent == nullptr || isPlatformTypeSupported(type) != kResultTrue || controller == nullptr)
            return kResultFalse;
        const auto result = CPluginView::attached(parent, type);
        if (result != kResultOk)
            return result;
        // The host's run loop (VST3 on Linux): through the frame it gave.
        if (plugFrame)
        {
            Linux::IRunLoop* loop = nullptr;
            if (plugFrame->queryInterface(Linux::IRunLoop::iid, reinterpret_cast<void**>(&loop)) == kResultOk
                && loop != nullptr)
                runLoop = owned(loop);
        }
        if (! runLoop)
        {
            log("Soundor: the host offers no run loop (IRunLoop) for the editor; it cannot run");
            CPluginView::removed();
            return kResultFalse;
        }
        try
        {
            open();
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the editor could not open: ") + error.what());
            close();
            CPluginView::removed();
            return kResultFalse;
        }
        return kResultOk;
    }

    tresult PLUGIN_API Editor::removed()
    {
        close();
        return CPluginView::removed();
    }

    void Editor::open()
    {
        std::string why;
        window = x11::Window::create(reinterpret_cast<std::uintptr_t>(systemWindow), rect.getWidth(), rect.getHeight(),
                                     definition.editor.background, why);
        if (window == nullptr)
            throw std::runtime_error(why);
        image.attach(window.get());
        auto& owner = *controller;
        uiParameters = std::make_shared<UiParameters>(definition, owner.editors(), owner.historyManager());
        owner.addUi(uiParameters.get());
        attachedToHost = true;
        editor::Platform& platform = *this;
        engineEditor = std::make_unique<editor::Editor>(platform, editorOptions());
        runLoop->registerTimer(this, 16);
        runLoop->registerEventHandler(this, window->fileDescriptor());
        tick();
    }

    void* Editor::nativeWindow() const noexcept
    {
        // An X11 window id, which the engine's APIs carry as a pointer.
        return window != nullptr ? reinterpret_cast<void*>(window->id()) : nullptr; // NOLINT(performance-no-int-to-ptr)
    }

    editor::Editor::Options Editor::editorOptions()
    {
        const auto& editor = definition.editor;
        constexpr float unbounded = std::numeric_limits<float>::infinity();
        const float maxWidth = editor.maxWidth > 0 ? static_cast<float>(editor.maxWidth) : unbounded;
        const float maxHeight = editor.maxHeight > 0 ? static_cast<float>(editor.maxHeight) : unbounded;

        editor::Editor::Options result;
        result.layout = { .size = { static_cast<float>(editor.width), static_cast<float>(editor.height) },
                          .resizable = editor.resizable,
                          .resize = editor.scale ? editor::Layout::Resize::Scale : editor::Layout::Resize::Layout,
                          .fit = editor.cover ? editor::Layout::Fit::Cover : editor::Layout::Fit::Contain,
                          .maximum = { maxWidth, maxHeight } };
        // A resizable editor whose limits allow another size, as the JUCE
        // runtime's and the Web host's.
        result.canRequestSize =
            editor.resizable
            && (static_cast<float>(editor.minWidth) < maxWidth || static_cast<float>(editor.minHeight) < maxHeight);
        result.background = editor.background;
        result.raster = &image;
        result.name = definition.name;
        result.runtimeName = "VST3";

        auto& owner = *controller;
        RuntimeHost::Options options;
        options.clipboard = platform::systemClipboard();
        logSink = logToStderr;
        if (! definition.logFile.empty())
            logSink = [file = platform::fileLogSink(definition.logFile, definition.name)](js::LogLevel level,
                                                                                          std::string_view message)
            {
                logToStderr(level, message);
                file(level, message);
            };
        options.runtime.log = logSink;
        options.runtime.timeLimit = std::chrono::milliseconds { definition.timeLimit };
        options.pluginId = definition.id;
        options.pluginName = definition.name;
        options.pluginVersion = definition.version;
        options.environment = { "vst3", SOUNDOR_VST3_RUNTIME_VERSION, "linux", "x64", "vst3" };
        options.hostInfo = std::make_shared<HostInfo>(owner);
        // fetch(): the system's HTTP stack (its libcurl).
        options.http = platform::systemHttpClient();
        options.dataDirectory = dataDirectory(definition.id);
        options.parameters = uiParameters;
        Controller* target = &owner;
        options.installModules = [target](js::Context& context)
        {
            if (const auto& midiHost = target->midiHost())
                midi::install(context, midiHost);
            history::install(context, target->historyManager());
            modules::installState(context, *target);
            modules::installPresets(context, target->presets());
            modules::installNative(context, *target);
        };
        options.dispatchModules = [](js::Context& context)
        {
            history::dispatch(context);
            modules::dispatchState(context);
            modules::dispatchPresets(context);
        };
        // soundor dev: the UI the CLI keeps rebuilding, reloaded when it changes.
        if (! definition.uiDirectory.empty())
            result.bundleDirectory = definition.uiDirectory;
        else if (! definition.files.empty())
        {
            options.resources = std::make_shared<platform::EmbeddedResources>(definition.files);
            options.entry = "/bundle.js";
        }
        result.runtime = std::move(options);
        return result;
    }

    void Editor::close()
    {
        if (runLoop)
        {
            runLoop->unregisterTimer(this);
            runLoop->unregisterEventHandler(this);
        }
        if (engineEditor != nullptr)
        {
            // A press or keys in progress end in the UI (a gesture ends).
            engineEditor->endInput();
            engineEditor.reset();
        }
        if (uiParameters != nullptr)
        {
            if (controller != nullptr)
                controller->removeUi(uiParameters.get());
            uiParameters.reset();
        }
        image.attach(nullptr);
        window.reset();
        runLoop = nullptr;
        attachedToHost = false;
    }

    ui::Size Editor::logicalSize() const
    {
        return { static_cast<float>(rect.getWidth()) / contentScale,
                 static_cast<float>(rect.getHeight()) / contentScale };
    }

    void Editor::readWindowEvents()
    {
        if (window != nullptr && window->pump() && (engineEditor == nullptr || ! engineEditor->gpu()))
            image.repaint();
    }

    // ── editor::Platform ───────────────────────────────────────────────────────

    editor::Platform::State Editor::state()
    {
        State now;
        now.nativeView = nativeWindow();
        now.size = logicalSize();
        // The window is the editor: at its top-left, in physical pixels.
        now.nativeScale = contentScale;
        now.pixelScale = contentScale;
        if (window != nullptr)
        {
            const auto [x, y] = window->screenPosition();
            now.screenOrigin = ui::Point { static_cast<float>(x), static_cast<float>(y) };
        }
        now.visible = attachedToHost;
        now.focused = focusedByHost;
        return now;
    }

    void Editor::setCursor(ui::Cursor shape)
    {
        if (window != nullptr)
            window->setCursor(cursorIcon(shape));
    }

    ViewRect Editor::physical(ui::Size logical) const
    {
        return { 0, 0, static_cast<int32>(std::lround(logical.width * contentScale)),
                 static_cast<int32>(std::lround(logical.height * contentScale)) };
    }

    ui::Size Editor::holdSize(ui::Size wanted)
    {
        const auto held = constrained(physical(wanted));
        return { static_cast<float>(held.getWidth()) / contentScale,
                 static_cast<float>(held.getHeight()) / contentScale };
    }

    void Editor::requestSize(ui::Size wanted)
    {
        if (! plugFrame || ! definition.editor.resizable)
            return;
        auto held = constrained(physical(wanted));
        if (held.getWidth() == rect.getWidth() && held.getHeight() == rect.getHeight())
            return;
        // The host answers with onSize(), with this size or its own.
        plugFrame->resizeView(this, &held);
    }

    void Editor::placed(const editor::Placement& placement)
    {
        image.setPlacement(static_cast<int>(std::lround(placement.area.x * contentScale)),
                           static_cast<int>(std::lround(placement.area.y * contentScale)),
                           definition.editor.background);
    }

    void Editor::inputStarted(input::PlatformInput& input)
    {
        // Read when its connection is readable. It goes with the engine's Editor, whose
        // handlers close() unregisters (all of this editor's at once).
        if (const int descriptor = input.fileDescriptor(); descriptor >= 0 && runLoop)
            runLoop->registerEventHandler(this, descriptor);
        logSink(js::LogLevel::Info, "input: native (X11, XInput 2)");
    }

    void Editor::inputFailed(const std::string& why)
    {
        // No XInput 2: the editor shows, and takes no input.
        logSink(js::LogLevel::Warn, "native input could not start (" + why + ")");
    }

    ViewRect Editor::constrained(ViewRect wanted) const
    {
        const auto& editor = definition.editor;
        const auto scaled = [&](int value)
        { return static_cast<int32>(std::lround(static_cast<float>(value) * contentScale)); };
        int32 width = std::max<int32>(1, wanted.getWidth());
        int32 height = std::max<int32>(1, wanted.getHeight());
        if (editor.minWidth > 0)
            width = std::max(width, scaled(editor.minWidth));
        if (editor.minHeight > 0)
            height = std::max(height, scaled(editor.minHeight));
        if (editor.maxWidth > 0)
            width = std::min(width, scaled(editor.maxWidth));
        if (editor.maxHeight > 0)
            height = std::min(height, scaled(editor.maxHeight));
        if (editor.scale && editor.keepAspectRatio)
        {
            const double aspect = static_cast<double>(editor.width) / static_cast<double>(editor.height);
            height = static_cast<int32>(std::lround(static_cast<double>(width) / aspect));
        }
        return { wanted.left, wanted.top, wanted.left + width, wanted.top + height };
    }

    void Editor::tick()
    {
        if (engineEditor == nullptr)
            return;
        try
        {
            readWindowEvents();
            engineEditor->frame();
            if (controller != nullptr)
                controller->pump();
        }
        catch (const std::exception& error)
        {
            logSink(js::LogLevel::Error, std::string("the editor's frame failed: ") + error.what());
        }
    }

    void PLUGIN_API Editor::onTimer()
    {
        tick();
    }

    void PLUGIN_API Editor::onFDIsSet(Linux::FileDescriptor fd)
    {
        if (engineEditor != nullptr && fd == engineEditor->inputDescriptor())
            engineEditor->readInput();
        else
            readWindowEvents();
    }

    tresult PLUGIN_API Editor::onSize(ViewRect* newSize)
    {
        if (newSize == nullptr)
            return kInvalidArgument;
        rect = *newSize;
        if (window != nullptr)
        {
            window->resize(rect.getWidth(), rect.getHeight());
            if (engineEditor != nullptr)
            {
                engineEditor->resized();
                if (! engineEditor->gpu())
                    image.repaint();
            }
        }
        return kResultTrue;
    }

    tresult PLUGIN_API Editor::canResize()
    {
        return definition.editor.resizable ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API Editor::checkSizeConstraint(ViewRect* wanted)
    {
        if (wanted == nullptr)
            return kInvalidArgument;
        if (! definition.editor.resizable)
        {
            wanted->right = wanted->left + rect.getWidth();
            wanted->bottom = wanted->top + rect.getHeight();
            return kResultTrue;
        }
        *wanted = constrained(*wanted);
        return kResultTrue;
    }

    tresult PLUGIN_API Editor::getSize(ViewRect* size)
    {
        if (size == nullptr)
            return kInvalidArgument;
        *size = rect;
        return kResultTrue;
    }

    tresult PLUGIN_API Editor::onFocus(TBool state)
    {
        focusedByHost = state != 0;
        return kResultTrue;
    }

    tresult PLUGIN_API Editor::setContentScaleFactor(ScaleFactor factor)
    {
        if (factor <= 0.25f || factor >= 8.0f || std::isnan(factor))
            return kResultFalse;
        if (factor == contentScale)
            return kResultTrue;
        const float ratio = factor / contentScale;
        contentScale = factor;
        // The same logical size, at the new density.
        rect.right = rect.left + static_cast<int32>(std::lround(static_cast<float>(rect.getWidth()) * ratio));
        rect.bottom = rect.top + static_cast<int32>(std::lround(static_cast<float>(rect.getHeight()) * ratio));
        if (plugFrame && attachedToHost)
        {
            auto wanted = rect;
            plugFrame->resizeView(this, &wanted);
        }
        return kResultTrue;
    }
} // namespace soundor::vst3
