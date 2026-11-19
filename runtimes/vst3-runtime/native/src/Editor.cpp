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

        // <user application data>/Soundor/<plugin id>, where the JUCE
        // runtime's plugins keep soundor:storage and soundor:fs too (JUCE's
        // userApplicationDataDirectory): the XDG config home on Linux,
        // ~/Library on macOS, the roaming AppData on Windows.
        std::filesystem::path dataDirectory(const std::string& pluginId)
        {
            std::filesystem::path base;
#if SMTG_OS_WINDOWS
            wchar_t* appData = nullptr;
            std::size_t length = 0;
            if (_wdupenv_s(&appData, &length, L"APPDATA") == 0 && appData != nullptr && *appData != 0)
                base = appData;
            std::free(appData); // NOLINT(cppcoreguidelines-no-malloc): _wdupenv_s allocates it
            if (base.empty())
                return {};
#elif SMTG_OS_MACOS
            // NOLINTNEXTLINE(concurrency-mt-unsafe): read on the UI thread; a plugin never sets the environment.
            if (const char* home = std::getenv("HOME"); home != nullptr && *home != 0)
                base = std::filesystem::path(home) / "Library";
            else
                return {};
#else
            // NOLINTNEXTLINE(concurrency-mt-unsafe): read on the UI thread; a plugin never sets the environment.
            if (const char* config = std::getenv("XDG_CONFIG_HOME"); config != nullptr && *config != 0)
                base = config;
            // NOLINTNEXTLINE(concurrency-mt-unsafe): as above.
            else if (const char* home = std::getenv("HOME"); home != nullptr && *home != 0)
                base = std::filesystem::path(home) / ".config";
            else
                return {};
#endif
            return base / "Soundor" / pluginId;
        }

        // The view's platform type, which the window is made for.
#if SMTG_OS_WINDOWS
        const FIDString platformType = kPlatformTypeHWND;
        constexpr const char* platformName = "windows";
        constexpr const char* inputName = "input: native (Win32)";
#elif SMTG_OS_MACOS
        const FIDString platformType = kPlatformTypeNSView;
        constexpr const char* platformName = "macos";
        constexpr const char* inputName = "input: native (AppKit)";
#else
        const FIDString platformType = kPlatformTypeX11EmbedWindowID;
        constexpr const char* platformName = "linux";
        constexpr const char* inputName = "input: native (X11, XInput 2)";
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
        constexpr const char* architecture = "arm64";
#else
        constexpr const char* architecture = "x64";
#endif

        void logToStderr(js::LogLevel level, std::string_view message)
        {
            static constexpr const char* prefixes[] = { "[soundor] ", "[soundor] ",
                                                        "[soundor] warning: ", "[soundor] error: " };
            log(std::string(prefixes[static_cast<int>(level)]) + std::string(message));
        }
    } // namespace

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
        return type != nullptr && std::strcmp(type, platformType) == 0 ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API Editor::attached(void* parent, FIDString type)
    {
        if (parent == nullptr || isPlatformTypeSupported(type) != kResultTrue || controller == nullptr)
            return kResultFalse;
        const auto result = CPluginView::attached(parent, type);
        if (result != kResultOk)
            return result;
#if SMTG_OS_LINUX
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
#endif
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
        window =
            NativeWindow::create(systemWindow, rect.getWidth(), rect.getHeight(), definition.editor.background, why);
        if (window == nullptr)
            throw std::runtime_error(why);
        auto& owner = *controller;
        uiParameters = std::make_shared<UiParameters>(definition, owner.editors(), owner.historyManager());
        owner.addUi(uiParameters.get());
        attachedToHost = true;
        editor::Platform& platform = *this;
        engineEditor = std::make_unique<editor::Editor>(platform, editorOptions());
#if SMTG_OS_LINUX
        runLoop->registerTimer(this, 16);
        runLoop->registerEventHandler(this, window->fileDescriptor());
#else
        timer = Timer::create(16, [this]() { tick(); });
#endif
        tick();
    }

    float Editor::nativeScale() const noexcept
    {
#if SMTG_OS_MACOS
        // macOS sizes views in points, whatever the screen's density.
        return 1.0f;
#else
        return contentScale;
#endif
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
        result.raster = &window->raster();
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
        options.environment = { "vst3", SOUNDOR_VST3_RUNTIME_VERSION, platformName, architecture, "vst3" };
        options.hostInfo = std::make_shared<HostInfo>(owner);
        // fetch(): the system's HTTP stack.
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
        timer.reset();
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
        window.reset();
        runLoop = nullptr;
        attachedToHost = false;
    }

    ui::Size Editor::logicalSize() const
    {
        return { static_cast<float>(rect.getWidth()) / nativeScale(),
                 static_cast<float>(rect.getHeight()) / nativeScale() };
    }

    void Editor::readWindowEvents()
    {
        if (window != nullptr && window->pump() && (engineEditor == nullptr || ! engineEditor->gpu()))
            window->repaint();
    }

    // ── editor::Platform ───────────────────────────────────────────────────────

    editor::Platform::State Editor::state()
    {
        State now;
        now.size = logicalSize();
        // The window is the editor: at its top-left, in its native units
        // (physical pixels; macOS: points).
        now.nativeScale = nativeScale();
        now.pixelScale = contentScale;
        if (window != nullptr)
        {
            now.nativeView = window->view();
            now.pixelScale = nativeScale() * window->backingScale();
            now.screenOrigin = window->screenOrigin();
        }
        now.visible = attachedToHost;
        now.focused = focusedByHost;
        return now;
    }

    void Editor::setCursor(ui::Cursor shape)
    {
        if (window != nullptr)
            window->setCursor(shape);
    }

    ViewRect Editor::physical(ui::Size logical) const
    {
        return { 0, 0, static_cast<int32>(std::lround(logical.width * nativeScale())),
                 static_cast<int32>(std::lround(logical.height * nativeScale())) };
    }

    ui::Size Editor::holdSize(ui::Size wanted)
    {
        const auto held = constrained(physical(wanted));
        return { static_cast<float>(held.getWidth()) / nativeScale(),
                 static_cast<float>(held.getHeight()) / nativeScale() };
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
        if (window != nullptr)
            window->placeFrame(placement.area.x * nativeScale(), placement.area.y * nativeScale(),
                               definition.editor.background);
    }

    void Editor::pressed()
    {
        // A press takes the keyboard, as it does in the JUCE runtime's editor.
        if (auto* native = engineEditor != nullptr ? engineEditor->nativeInput() : nullptr;
            native != nullptr && ! native->focused())
            native->requestFocus();
    }

    void Editor::inputStarted(input::PlatformInput& input)
    {
        // Read when its connection is readable. It goes with the engine's Editor, whose
        // handlers close() unregisters (all of this editor's at once).
        if (const int descriptor = input.fileDescriptor(); descriptor >= 0 && runLoop)
            runLoop->registerEventHandler(this, descriptor);
        logSink(js::LogLevel::Info, inputName);
    }

    void Editor::inputFailed(const std::string& why)
    {
        // No XInput 2 (Linux): the editor shows, and takes no input.
        logSink(js::LogLevel::Warn, "native input could not start (" + why + ")");
    }

    ViewRect Editor::constrained(ViewRect wanted) const
    {
        const auto& editor = definition.editor;
        const auto scaled = [&](int value)
        { return static_cast<int32>(std::lround(static_cast<float>(value) * nativeScale())); };
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
            window->tick();
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
                    window->repaint();
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
#if SMTG_OS_MACOS
        // macOS hosts never call it: views are in points there.
        (void)factor;
        return kResultFalse;
#else
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
#endif
    }
} // namespace soundor::vst3
