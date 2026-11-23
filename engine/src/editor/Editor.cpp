#include <soundor/editor/Editor.h>
#include <soundor/render/GpuCompositor.h>
#include <soundor/runtime/DevSession.h>
#if SOUNDOR_DEVTOOLS
    #include <soundor/debug/Bridge.h>
#endif

#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <utility>
#include <variant>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
{
    namespace
    {
#if SOUNDOR_DEVTOOLS
        bool rendererBadgeAsked()
        {
    #if defined(_WIN32)
            char* value = nullptr;
            std::size_t size = 0;
            const bool asked = _dupenv_s(&value, &size, "SOUNDOR_SHOW_RENDERER") == 0 && value != nullptr
                               && std::strcmp(value, "1") == 0;
            std::free(value); // NOLINT(cppcoreguidelines-no-malloc): _dupenv_s allocates with malloc.
            return asked;
    #else
            // NOLINTNEXTLINE(concurrency-mt-unsafe): read on the UI thread; a plugin never sets it.
            const char* value = std::getenv("SOUNDOR_SHOW_RENDERER");
            return value != nullptr && std::strcmp(value, "1") == 0;
    #endif
        }
#endif
    } // namespace

    Editor::Editor(Platform& owner, Options provided)
        : platform(owner),
          options(std::move(provided)),
          pointerLock(
              [this](int pointerId) {
                  return input != nullptr ? input::pointerSource(*input, pointerId) : platform.pointerSource(pointerId);
              })
    {
        if (options.raster == nullptr)
            throw std::invalid_argument("editor::Editor needs a RasterTarget");
        // Before the runtime: the GPU compositor and canvases' WebGL share it,
        // so WebGL is shown without copies. Null where there is no GPU
        // composition.
        gpuDevice = render::GpuCompositor::createDevice();
        compositor = std::make_unique<render::RasterCompositor>(*options.raster);
        capabilities = compositor->capabilities();

        auto runtimeOptions = std::move(options.runtime);
        options.runtime = {};
        runtimeOptions.gpuDevice = gpuDevice;
        // What this Editor logs goes where the runtime's log goes.
        logSink = runtimeOptions.runtime.log;
        if (! options.bundleDirectory.empty())
            session = std::make_unique<DevSession>(
                DevSession::Options { .host = std::move(runtimeOptions), .bundleDirectory = options.bundleDirectory });
        else
            host = std::make_unique<RuntimeHost>(std::move(runtimeOptions));

#if SOUNDOR_DEVTOOLS
        showRenderer = rendererBadgeAsked();
        if (auto sessionFile = debug::Bridge::sessionFromEnvironment(); ! sessionFile.empty())
        {
            try
            {
                bridge = std::make_shared<debug::Bridge>(debug::Bridge::Options { .descriptor = std::move(sessionFile),
                                                                                  .name = options.name,
                                                                                  .runtime = options.runtimeName,
                                                                                  .log = logSink });
            }
            catch (const std::exception&)
            {
                log(js::LogLevel::Warn, "DevTools could not connect; native UI continues normally.");
            }
        }
#endif
    }

    Editor::~Editor()
    {
        bridge.reset();
        // While the runtime and the input's pointer are still there.
        stopInput(false);
        if (accessibility != nullptr)
        {
            platform.accessibilityChanged(nullptr);
            accessibility.reset();
        }
        // While the native view it presents in still exists.
        gpuCompositor = nullptr;
        compositor.reset();
        session.reset();
        host.reset();
        gpuDevice.reset();
    }

    RuntimeHost& Editor::runtime() noexcept
    {
        return session != nullptr ? session->host() : *host;
    }

    void Editor::log(js::LogLevel level, const std::string& message) const
    {
        if (logSink)
            logSink(level, message);
    }

    // ── Frames ───────────────────────────────────────────────────────────────

    void Editor::frame()
    {
        const auto state = platform.state();
        // Input not read yet goes first (its descriptor is also watched).
        updateInput(state);
        // Every frame, so a reloaded UI (soundor dev) gets the size at once.
        place(state);
        tickRuntime();
        // At most one a frame, whatever asked for it (input included): a fast
        // pointer's every event would resize the host's window, and take the
        // thread from it, as a browser's next render does not.
        if (const auto wanted = runtime().surface().takeEditorSizeRequest(); wanted && options.canRequestSize)
            platform.requestSize(*wanted);
        // The UI's code may have focused a text input, or left one.
        if (input != nullptr)
            input->setTextInputFocused(textInputFocused());
        updateAccessibility(state);
        // A lock ends with a reloaded runtime or a drag the platform ended,
        // and styles also change outside input (timers, animations).
        updatePointerLock();
        updateCursor();
#if SOUNDOR_DEVTOOLS
        if (bridge != nullptr)
            bridge->tick(runtime(), session != nullptr ? session->reloadCount() + 1 : 1);
#endif
        updateCompositor(state);
        if (needsRender())
            render();
    }

    bool Editor::needsRender()
    {
        // Both, every time: the runtime's changes are taken either way.
        const bool changed = runtime().needsRender();
        // A static UI reports no change, but a window placed, shown or
        // exposed anew needs presenting again.
        const bool redraw = gpuCompositor != nullptr && gpuCompositor->needsRedraw();
        return changed || redraw;
    }

    void Editor::resized()
    {
        const auto state = platform.state();
        // Where the editor now is, for the native input.
        updateInput(state);
        place(state);
        // On the CPU, the editor shows the last complete frame until the next
        // one, at the new size, settled the UI's code. The GPU compositor
        // presents over the view instead: present now, not on the next frame.
        if (gpuCompositor == nullptr || ! state.visible)
            return;
        updateCompositor(state);
        if (gpuCompositor != nullptr && needsRender())
            render();
    }

    void Editor::tickRuntime()
    {
        if (session != nullptr)
            session->tick();
        else
            host->tick();
    }

    void Editor::place(const Platform::State& state)
    {
        last = state;
        where = editor::place(options.layout, state.size);
        auto& surface = runtime().surface();
        surface.setVisible(state.visible);
        surface.setFocused(focused());
        surface.setSize(where.layoutSize());
        surface.setSafeArea(where.safeArea);
        // The editor's own size, which soundor:ui's editorSize() reports.
        surface.setEditorSize(state.size);
        surface.setEditorResizable(options.canRequestSize);
        // A request is held at once, so requestEditorSize() returns the size
        // asked of the host. Every frame: a reload replaces the surface.
        if (options.canRequestSize)
            surface.setEditorSizeHold([this](ui::Size wanted) { return platform.holdSize(wanted); });
        platform.placed(where);
        surface.setScale(platform.surfaceScale(state.pixelScale * where.zoom, gpuCompositor != nullptr));
    }

    void Editor::updateCompositor(const Platform::State& state)
    {
        bool rebuild = state.nativeView != compositorView;
        if (gpuCompositor != nullptr && ! gpuCompositor->healthy())
        {
            log(js::LogLevel::Warn, "the GPU was lost: rendering on the CPU from now on");
            gpuLost = true;
            rebuild = true;
        }
        if (rebuild)
        {
            // A new native view (or none), or a lost GPU: a compositor for it.
            compositorView = state.nativeView;
            gpuCompositor = nullptr;
            compositor.reset();
            std::string why = gpuLost ? "the GPU was lost" : "no native view";
            if (state.nativeView != nullptr && ! gpuLost)
            {
                if (auto created = render::GpuCompositor::create(
                        { .view = { state.nativeView }, .background = options.background, .device = gpuDevice }, &why))
                {
                    gpuCompositor = created.get();
                    compositor = std::move(created);
                }
            }
            if (compositor == nullptr)
                compositor = std::make_unique<render::RasterCompositor>(*options.raster);
            capabilities = compositor->capabilities();
            log(js::LogLevel::Info, capabilities.gpu ? "renderer: GPU compositor, " + capabilities.backend
                                                     : "renderer: CPU, " + capabilities.backend + " (" + why + ")");
        }
        if (gpuCompositor != nullptr)
        {
            const auto& area = where.area;
            gpuCompositor->setBounds(state.origin.x + area.x * state.nativeScale,
                                     state.origin.y + area.y * state.nativeScale, area.width * state.nativeScale,
                                     area.height * state.nativeScale, runtime().surface().scale());
            gpuCompositor->setVisible(state.visible);
        }
        // A new compositor has nothing yet: it draws everything, placed and
        // shown (a present into the unplaced, unmapped window would be lost).
        if (rebuild && state.nativeView != nullptr)
            render();
    }

    void Editor::render()
    {
#if SOUNDOR_DEVTOOLS
        updateRendererBadge();
        if (bridge != nullptr && bridge->recording())
        {
            bridge->renderFrame(runtime(), *compositor, capabilities);
            return;
        }
#endif
        compositor->composite(runtime().frame(capabilities));
    }

    void Editor::updateRendererBadge()
    {
#if SOUNDOR_DEVTOOLS
        if (! showRenderer)
            return;
        auto& surface = runtime().surface();
        const auto* node = surface.find(rendererBadge);
        // A development reload replaces the surface and its node IDs.
        if (node == nullptr || node->debugId() != "soundor.renderer")
        {
            rendererBadge = surface.createNode(ui::NodeType::Text);
            surface.setDebugId(rendererBadge, "soundor.renderer");
            ui::Style style;
            style.position = ui::Position::Absolute;
            style.inset.right = ui::Length::points(12);
            style.inset.bottom = ui::Length::points(12);
            style.padding = { ui::Length::points(5), ui::Length::points(8), ui::Length::points(5),
                              ui::Length::points(8) };
            style.backgroundColor = { 25, 30, 36, 245 };
            style.borderRadius = { 4, 4, 4, 4 };
            style.text.color = { 255, 255, 255, 255 };
            style.text.fontSize = 11;
            style.text.fontWeight = 600;
            style.pointerEvents = ui::PointerEvents::None;
            style.zIndex = 1000000;
            surface.setStyle(rendererBadge, style);
            surface.insertChild(surface.overlay().id(), rendererBadge);
            node = surface.find(rendererBadge);
        }
        const std::string label = capabilities.gpu ? "GPU composition" : "CPU composition";
        if (node->text() != label)
            surface.setText(rendererBadge, label);
#endif
    }

    // ── Accessibility, pointer lock, cursor ──────────────────────────────────

    void Editor::updateAccessibility(const Platform::State& state)
    {
        if (state.nativeView != accessibilityView)
        {
            // A new native view (or none): attach again.
            if (accessibility != nullptr)
            {
                platform.accessibilityChanged(nullptr);
                accessibility.reset();
            }
            accessibilityFocused = false;
            accessibilityView = state.nativeView;
            if (state.nativeView != nullptr)
            {
                accessibility = a11y::createPlatformAccessibility(
                    { .view = platform.accessibilityView(state.nativeView), .name = options.name });
                if (accessibility != nullptr)
                    platform.accessibilityChanged(accessibility.get());
            }
        }
        if (accessibility == nullptr)
            return;
        // The surface in the native view's units, and on the screen.
        const auto& area = where.area;
        const float scale = state.nativeScale;
        a11y::Rect screen;
        if (state.screenOrigin)
            screen = { state.screenOrigin->x + area.x * scale, state.screenOrigin->y + area.y * scale,
                       area.width * scale, area.height * scale };
        accessibility->setGeometry({ .x = state.origin.x + area.x * scale,
                                     .y = state.origin.y + area.y * scale,
                                     .scale = scale * where.zoom,
                                     .screen = screen });
        if (const bool now = focused(); now != accessibilityFocused)
        {
            accessibilityFocused = now;
            accessibility->setFocused(now);
        }
        accessibility->tick(runtime());
    }

    void Editor::updatePointerLock()
    {
        const auto lock = runtime().surface().pointerLock();
        pointerLock.update(lock ? std::optional<int>(lock->pointerId) : std::nullopt,
                           lock ? where.toEditor(lock->position) : ui::Point {});
    }

    void Editor::updateCursor()
    {
        // None while the pointer is locked: it stays in this view for that.
        const auto wanted = pointerLock.active() ? ui::Cursor::None : runtime().surface().cursor();
        if (cursor == wanted)
            return;
        cursor = wanted;
        platform.setCursor(wanted);
    }

    // ── Input ────────────────────────────────────────────────────────────────

    void Editor::updateInput(const Platform::State& state)
    {
        if (options.nativeInput && state.nativeView != inputView)
        {
            // A new native view (or none): a new input for it.
            stopInput(true);
            inputView = state.nativeView;
            if (state.nativeView != nullptr)
            {
                std::string why;
                input = input::createPlatformInput(
                    { .view = { state.nativeView }, .doubleClickTime = options.doubleClickTime }, &why);
                if (input != nullptr)
                {
                    descriptor = input->fileDescriptor();
                    platform.inputStarted(*input);
                }
                else
                    platform.inputFailed(why);
            }
        }
        if (input == nullptr)
            return;
        // Where the editor is in the native view: only its area is read (a
        // Standalone's window has the framework's own controls around it).
        input->setGeometry({ .x = state.origin.x,
                             .y = state.origin.y,
                             .scale = state.nativeScale,
                             .width = state.size.width,
                             .height = state.size.height });
        platform.inputPlaced(*input);
        std::vector<input::Event> ended;
        input->setSuspended(state.inputSuspended, ended);
        for (auto& event : ended)
            deliver(event);
        readInput();
    }

    void Editor::stopInput(bool tellUi)
    {
        if (input == nullptr)
            return;
        platform.inputStopping(*input);
        descriptor = -1;
        // While its pointer is still there to put back.
        pointerLock.release();
        std::vector<input::Event> ended;
        input->cancel(ended);
        input.reset();
        inputView = nullptr;
        if (tellUi)
            for (auto& event : ended)
                deliver(event);
    }

    void Editor::endInput()
    {
        pointerLock.release();
        if (input == nullptr)
            return;
        std::vector<input::Event> ended;
        input->cancel(ended);
        for (auto& event : ended)
            deliver(event);
    }

    void Editor::readInput()
    {
        // Not again while what was read is delivered (the UI's code runs).
        if (input == nullptr || reading)
            return;
        reading = true;
        events.clear();
        input->read(events);
        for (auto& event : events)
            deliver(event);
        events.clear();
        reading = false;
        if (input != nullptr)
            input->setTextInputFocused(textInputFocused());
    }

    void Editor::deliver(input::Event& event)
    {
        if (auto* pointerInput = std::get_if<ui::PointerInput>(&event))
            pointer(*pointerInput);
        else if (auto* wheelInput = std::get_if<ui::WheelInput>(&event))
            (void)wheel(*wheelInput);
        else if (auto* keyEvent = std::get_if<input::KeyEvent>(&event))
            (void)key(keyEvent->key, keyEvent->typed);
        else if (auto* textInput = std::get_if<ui::TextInput>(&event))
            text(*textInput);
        else if (auto* change = std::get_if<input::FocusChange>(&event))
            focus(change->focused);
    }

    void Editor::pointer(ui::PointerInput event)
    {
        if (event.phase == ui::PointerInput::Phase::Down)
            platform.pressed();
        else if (event.phase == ui::PointerInput::Phase::Move && event.buttons != 0)
            // A locked pointer goes on past the view's edges.
            event.position = pointerLock.follow(event.pointerId, event.position, { last.size.width, last.size.height });
        // The editor's coordinates to the layout's.
        event.position = where.toLayout(event.position);
        auto& current = runtime();
#if SOUNDOR_DEVTOOLS
        if (bridge != nullptr && bridge->pointer(current, event))
            return;
#endif
        current.surface().pointer(event);
        current.runtime().runPendingJobs();
        updatePointerLock();
        updateCursor();
    }

    bool Editor::wheel(ui::WheelInput event)
    {
#if SOUNDOR_DEVTOOLS
        // The picker takes the view's input.
        if (bridge != nullptr && bridge->picking())
            return true;
#endif
        event.position = where.toLayout(event.position);
        auto& current = runtime();
        const bool handled = current.surface().wheel(event);
        current.runtime().runPendingJobs();
        return handled;
    }

    bool Editor::key(const ui::KeyInput& event, const std::string& typed)
    {
        auto& current = runtime();
#if SOUNDOR_DEVTOOLS
        if (bridge != nullptr && bridge->key(current, event))
            return true;
#endif
        // The key, then the text it types when the UI does not handle it.
        const bool handled = current.surface().key(event, typed);
        current.runtime().runPendingJobs();
        return handled;
    }

    void Editor::text(const ui::TextInput& event)
    {
        auto& current = runtime();
        current.surface().text(event);
        current.runtime().runPendingJobs();
    }

    void Editor::focus(bool now)
    {
        runtime().surface().setFocused(now);
    }

    bool Editor::focused() const
    {
        return input != nullptr ? input->focused() : last.focused;
    }

    bool Editor::textInputFocused()
    {
        auto& surface = runtime().surface();
        const auto* node = surface.find(surface.focused());
        return node != nullptr && node->type() == ui::NodeType::Input;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::editor
