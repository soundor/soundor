#include "Editor.h"

#include "Log.h"
#include "Modules.h"

#include <soundor/history/Module.h>
#include <soundor/midi/Midi.h>
#include <soundor/platform/FileLog.h>
#include <soundor/platform/Platform.h>
#include <soundor/platform/Resources.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
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
        // soundor:host, from what the processor last saw (when it shares
        // this process).
        class HostInfo final : public platform::HostInfo
        {
        public:
            explicit HostInfo(std::shared_ptr<HostState> state) : shared(std::move(state)) {}

            [[nodiscard]] platform::HostSnapshot snapshot() const override
            {
                platform::HostSnapshot out;
                out.samplePrecision = "32-bit";
                if (shared == nullptr)
                    return out;
                out.sampleRate = shared->sampleRate.load(std::memory_order_relaxed);
                out.blockSize = shared->blockSize.load(std::memory_order_relaxed);
                out.processingMode = "realtime";
                if (! shared->known.load(std::memory_order_relaxed))
                    return out;
                platform::Transport transport;
                transport.playing = shared->playing.load(std::memory_order_relaxed);
                transport.recording = shared->recording.load(std::memory_order_relaxed);
                transport.looping = shared->looping.load(std::memory_order_relaxed);
                transport.bpm = shared->bpm.load(std::memory_order_relaxed);
                transport.timeSignatureNumerator = shared->numerator.load(std::memory_order_relaxed);
                transport.timeSignatureDenominator = shared->denominator.load(std::memory_order_relaxed);
                transport.ppqPosition = shared->ppq.load(std::memory_order_relaxed);
                transport.barStartPpq = shared->barStart.load(std::memory_order_relaxed);
                transport.timeInSeconds = shared->seconds.load(std::memory_order_relaxed);
                transport.timeInSamples = shared->samples.load(std::memory_order_relaxed);
                out.transport = transport;
                return out;
            }

        private:
            std::shared_ptr<HostState> shared;
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
        createRuntime();
        attachedToHost = true;
        runLoop->registerTimer(this, 16);
        runLoop->registerEventHandler(this, window->fileDescriptor());
        tick();
    }

    void* Editor::nativeWindow() const noexcept
    {
        // An X11 window id, which the engine's APIs carry as a pointer.
        return window != nullptr ? reinterpret_cast<void*>(window->id()) : nullptr; // NOLINT(performance-no-int-to-ptr)
    }

    void Editor::createRuntime()
    {
        gpuDevice = render::GpuCompositor::createDevice();
        auto& owner = *controller;
        uiParameters = std::make_shared<UiParameters>(definition, owner.editors(), owner.historyManager());
        owner.addUi(uiParameters.get());

        RuntimeHost::Options options;
        options.gpuDevice = gpuDevice;
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
        const auto& link = owner.link();
        options.hostInfo = std::make_shared<HostInfo>(link != nullptr ? link->host : nullptr);
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
        if (! definition.uiDirectory.empty())
        {
            // soundor dev: the UI the CLI keeps rebuilding, reloaded when it changes.
            session = std::make_unique<DevSession>(
                DevSession::Options { .host = std::move(options), .bundleDirectory = definition.uiDirectory });
        }
        else
        {
            if (! definition.files.empty())
            {
                options.resources = std::make_shared<platform::EmbeddedResources>(definition.files);
                options.entry = "/bundle.js";
            }
            host = std::make_unique<RuntimeHost>(std::move(options));
        }
#if SOUNDOR_DEVTOOLS
        if (auto descriptor = debug::Bridge::sessionFromEnvironment(); ! descriptor.empty())
        {
            try
            {
                bridge = std::make_unique<debug::Bridge>(debug::Bridge::Options {
                    .descriptor = std::move(descriptor), .name = definition.name, .runtime = "VST3", .log = logSink });
            }
            catch (const std::exception&)
            {
                logSink(js::LogLevel::Warn, "DevTools could not connect; native UI continues normally.");
            }
        }
#endif
    }

    RuntimeHost& Editor::runtimeHost()
    {
        return session != nullptr ? session->host() : *host;
    }

    void Editor::close()
    {
        if (runLoop)
        {
            runLoop->unregisterTimer(this);
            runLoop->unregisterEventHandler(this);
        }
#if SOUNDOR_DEVTOOLS
        bridge.reset();
#endif
        // While the input whose pointer it moves is there.
        pointerLock.release();
        if (nativeInput != nullptr)
        {
            std::vector<input::Event> ended;
            nativeInput->cancel(ended);
            if (host != nullptr || session != nullptr)
                for (auto& event : ended)
                    deliver(event);
            nativeInput.reset();
        }
        inputDescriptor = -1;
        accessibility.reset();
        gpu = nullptr;
        compositor.reset();
        session.reset();
        host.reset();
        if (uiParameters != nullptr)
        {
            if (controller != nullptr)
                controller->removeUi(uiParameters.get());
            uiParameters.reset();
        }
        gpuDevice.reset();
        image.attach(nullptr);
        window.reset();
        cursor = ui::Cursor::Auto;
        runLoop = nullptr;
        attachedToHost = false;
    }

    float Editor::logicalWidth() const
    {
        return static_cast<float>(rect.getWidth()) / contentScale;
    }
    float Editor::logicalHeight() const
    {
        return static_cast<float>(rect.getHeight()) / contentScale;
    }

    float Editor::zoom() const
    {
        const auto& editor = definition.editor;
        if (! editor.scale)
            return 1;
        const float sx = logicalWidth() / static_cast<float>(editor.width);
        const float sy = logicalHeight() / static_cast<float>(editor.height);
        float zoomed = std::min(sx, sy);
        if (editor.maxWidth > 0 && editor.maxHeight > 0)
            zoomed =
                std::min(zoomed, std::min(static_cast<float>(editor.maxWidth) / static_cast<float>(editor.width),
                                          static_cast<float>(editor.maxHeight) / static_cast<float>(editor.height)));
        return std::max(zoomed, 0.05f);
    }

    Editor::Area Editor::uiArea() const
    {
        const float width = logicalWidth();
        const float height = logicalHeight();
        const auto& editor = definition.editor;
        if (! editor.scale || editor.cover)
            return { 0, 0, width, height };
        // 'contain': the configured size, zoomed, in the middle.
        const float shownWidth = static_cast<float>(editor.width) * zoom();
        const float shownHeight = static_cast<float>(editor.height) * zoom();
        return { std::max(0.0f, (width - shownWidth) / 2), std::max(0.0f, (height - shownHeight) / 2),
                 std::min(width, shownWidth), std::min(height, shownHeight) };
    }

    void Editor::sizeSurface()
    {
        auto& surface = runtimeHost().surface();
        surface.setVisible(attachedToHost);
        surface.setFocused(nativeInput != nullptr ? nativeInput->focused() : focusedByHost);
        const float viewZoom = zoom();
        const auto area = uiArea();
        surface.setSize({ area.width / viewZoom, area.height / viewZoom });
        const auto& editor = definition.editor;
        if (editor.scale && editor.cover)
        {
            const float width = area.width / viewZoom;
            const float height = area.height / viewZoom;
            surface.setSafeArea(ui::Rect { (width - static_cast<float>(editor.width)) / 2,
                                           (height - static_cast<float>(editor.height)) / 2,
                                           static_cast<float>(editor.width), static_cast<float>(editor.height) });
        }
        else
            surface.setSafeArea(std::nullopt);
        surface.setEditorSize({ logicalWidth(), logicalHeight() });
        surface.setEditorResizable(editor.resizable);
        if (editor.resizable)
            surface.setEditorSizeHold(
                [this](ui::Size wanted)
                {
                    auto requested =
                        constrained(ViewRect(0, 0, static_cast<int32>(std::lround(wanted.width * contentScale)),
                                             static_cast<int32>(std::lround(wanted.height * contentScale))));
                    return ui::Size { static_cast<float>(requested.getWidth()) / contentScale,
                                      static_cast<float>(requested.getHeight()) / contentScale };
                });
        surface.setScale(contentScale * viewZoom);
        image.setPlacement(static_cast<int>(std::lround(area.x * contentScale)),
                           static_cast<int>(std::lround(area.y * contentScale)), definition.editor.background);
    }

    void Editor::updateCompositor()
    {
        if (gpu != nullptr && ! gpu->healthy())
        {
            logSink(js::LogLevel::Warn, "the GPU was lost: rendering on the CPU from now on");
            gpuLost = true;
            gpu = nullptr;
            compositor.reset();
        }
        if (compositor == nullptr)
        {
            std::string why = "no GPU";
            if (! gpuLost)
                if (auto created = render::GpuCompositor::create(
                        { .view = { nativeWindow() }, .background = definition.editor.background, .device = gpuDevice },
                        &why))
                {
                    gpu = created.get();
                    compositor = std::move(created);
                }
            if (compositor == nullptr)
                compositor = std::make_unique<render::RasterCompositor>(image);
            capabilities = compositor->capabilities();
            logSink(js::LogLevel::Info, capabilities.gpu ? "renderer: GPU compositor, " + capabilities.backend
                                                         : "renderer: CPU, " + capabilities.backend + " (" + why + ")");
        }
        if (gpu != nullptr)
        {
            const auto area = uiArea();
            gpu->setBounds(area.x * contentScale, area.y * contentScale, area.width * contentScale,
                           area.height * contentScale, runtimeHost().surface().scale());
            gpu->setVisible(attachedToHost);
        }
    }

    void Editor::renderFrame()
    {
#if SOUNDOR_DEVTOOLS
        if (bridge != nullptr && bridge->recording())
        {
            bridge->renderFrame(runtimeHost(), *compositor, capabilities);
            return;
        }
#endif
        compositor->composite(runtimeHost().frame(capabilities));
    }

    void Editor::readWindowEvents()
    {
        if (window != nullptr && window->pump() && gpu == nullptr)
            image.repaint();
    }

    void Editor::updateInputGeometry()
    {
        if (window == nullptr)
            return;
        if (nativeInput == nullptr && inputDescriptor != -2)
        {
            std::string why;
            nativeInput = input::createPlatformInput({ .view = { nativeWindow() } }, &why);
            if (nativeInput == nullptr)
            {
                // No XInput 2: the editor shows, and takes no input.
                logSink(js::LogLevel::Warn, "native input could not start (" + why + ")");
                inputDescriptor = -2;
                return;
            }
            inputDescriptor = nativeInput->fileDescriptor();
            if (inputDescriptor >= 0)
                runLoop->registerEventHandler(this, inputDescriptor);
            logSink(js::LogLevel::Info, "input: native (X11, XInput 2)");
        }
        if (nativeInput == nullptr)
            return;
        nativeInput->setGeometry(
            { .x = 0, .y = 0, .scale = contentScale, .width = logicalWidth(), .height = logicalHeight() });
    }

    void Editor::readInput()
    {
        if (nativeInput == nullptr || readingInput)
            return;
        readingInput = true;
        events.clear();
        nativeInput->read(events);
        for (auto& event : events)
            deliver(event);
        events.clear();
        readingInput = false;
        if (nativeInput != nullptr)
        {
            auto& surface = runtimeHost().surface();
            const auto* node = surface.find(surface.focused());
            nativeInput->setTextInputFocused(node != nullptr && node->type() == ui::NodeType::Input);
        }
    }

    void Editor::deliver(input::Event& event)
    {
        auto& runtime = runtimeHost();
        const float viewZoom = zoom();
        const auto area = uiArea();
        const auto toLayout = [&](ui::Point point)
        { return ui::Point { (point.x - area.x) / viewZoom, (point.y - area.y) / viewZoom }; };
        if (auto* pointer = std::get_if<ui::PointerInput>(&event))
        {
            // A locked pointer goes on past the view's edges.
            if (pointer->phase == ui::PointerInput::Phase::Move && pointer->buttons != 0)
                pointer->position =
                    pointerLock.follow(pointer->pointerId, pointer->position, { logicalWidth(), logicalHeight() });
            pointer->position = toLayout(pointer->position);
#if SOUNDOR_DEVTOOLS
            if (bridge != nullptr && bridge->pointer(runtime, *pointer))
                return;
#endif
            runtime.surface().pointer(*pointer);
            runtime.runtime().runPendingJobs();
            updatePointerLock();
            updateCursor();
        }
        else if (auto* wheel = std::get_if<ui::WheelInput>(&event))
        {
#if SOUNDOR_DEVTOOLS
            if (bridge != nullptr && bridge->picking())
                return;
#endif
            wheel->position = toLayout(wheel->position);
            runtime.surface().wheel(*wheel);
            runtime.runtime().runPendingJobs();
        }
        else if (auto* key = std::get_if<input::KeyEvent>(&event))
        {
#if SOUNDOR_DEVTOOLS
            if (bridge != nullptr && bridge->key(runtime, key->key))
                return;
#endif
            runtime.surface().key(key->key, key->typed);
            runtime.runtime().runPendingJobs();
        }
        else if (auto* text = std::get_if<ui::TextInput>(&event))
        {
            runtime.surface().text(*text);
            runtime.runtime().runPendingJobs();
        }
        else if (auto* focus = std::get_if<input::FocusChange>(&event))
            runtime.surface().setFocused(focus->focused);
    }

    void Editor::updatePointerLock()
    {
        const auto lock = runtimeHost().surface().pointerLock();
        const float viewZoom = zoom();
        const auto area = uiArea();
        pointerLock.update(
            lock ? std::optional<int>(lock->pointerId) : std::nullopt,
            lock ? ui::Point { lock->position.x * viewZoom + area.x, lock->position.y * viewZoom + area.y }
                 : ui::Point {});
    }

    void Editor::updateCursor()
    {
        if (window == nullptr)
            return;
        // None while the pointer is locked: it stays in this view for that.
        const auto wanted = pointerLock.active() ? ui::Cursor::None : runtimeHost().surface().cursor();
        if (wanted == cursor)
            return;
        cursor = wanted;
        window->setCursor(cursorIcon(cursor));
    }

    void Editor::updateAccessibility()
    {
        if (accessibility == nullptr)
        {
            accessibility = a11y::createPlatformAccessibility({ { nullptr, nullptr }, definition.name });
            if (accessibility == nullptr)
                return;
        }
        const auto area = uiArea();
        const auto [screenX, screenY] = window != nullptr ? window->screenPosition() : std::pair { 0, 0 };
        const float scale = runtimeHost().surface().scale();
        accessibility->setGeometry({ area.x * contentScale,
                                     area.y * contentScale,
                                     scale,
                                     { static_cast<float>(screenX) + area.x * contentScale,
                                       static_cast<float>(screenY) + area.y * contentScale, area.width * contentScale,
                                       area.height * contentScale } });
        const bool focused = nativeInput != nullptr ? nativeInput->focused() : focusedByHost;
        if (focused != accessibilityFocused)
        {
            accessibilityFocused = focused;
            accessibility->setFocused(focused);
        }
        accessibility->tick(runtimeHost());
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

    void Editor::applySizeRequest()
    {
        auto& surface = runtimeHost().surface();
        const auto request = surface.takeEditorSizeRequest();
        if (! request || ! plugFrame || ! definition.editor.resizable)
            return;
        auto wanted = constrained(ViewRect(0, 0, static_cast<int32>(std::lround(request->width * contentScale)),
                                           static_cast<int32>(std::lround(request->height * contentScale))));
        if (wanted.getWidth() == rect.getWidth() && wanted.getHeight() == rect.getHeight())
            return;
        // The host answers with onSize(), with this size or its own.
        plugFrame->resizeView(this, &wanted);
    }

    void Editor::tick()
    {
        if (window == nullptr || (host == nullptr && session == nullptr))
            return;
        try
        {
            readWindowEvents();
            updateInputGeometry();
            readInput();
            sizeSurface();
            if (session != nullptr)
                session->tick();
            else
                host->tick();
            applySizeRequest();
            updateAccessibility();
            // A lock ends with a reloaded runtime or a drag the platform
            // ended, and styles also change outside input.
            updatePointerLock();
            updateCursor();
#if SOUNDOR_DEVTOOLS
            if (bridge != nullptr)
                bridge->tick(runtimeHost(), session != nullptr ? session->reloadCount() + 1 : 1);
#endif
            updateCompositor();
            if (runtimeHost().needsRender())
                renderFrame();
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
        if (fd == inputDescriptor)
            readInput();
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
            if (host != nullptr || session != nullptr)
            {
                updateInputGeometry();
                sizeSurface();
                updateCompositor();
                if (gpu == nullptr)
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
