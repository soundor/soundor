#pragma once

#include <soundor/Config.h>
#include <soundor/a11y/SurfaceSemantics.h>
#include <soundor/js/Context.h>
#include <soundor/parameters/Parameters.h>
#include <soundor/platform/Platform.h>
#include <soundor/platform/Resources.h>
#include <soundor/render/Frame.h>
#include <soundor/ui/Renderer.h>
#include <soundor/ui/Surface.h>

#include <chrono>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    namespace render
    {
        class ViewRenderer;
    } // namespace render

    namespace gpu
    {
        class Device;
    } // namespace gpu

    // One plugin UI's JavaScript runtime, wired to the plugin: a js::Runtime
    // and js::Context with Soundor's Web-compatible globals and the
    // `soundor:*` modules installed.
    //
    // A backend creates one per plugin view on its UI/message thread and calls
    // tick() regularly (e.g. every frame) from that thread. Destroying the host
    // tears the JavaScript world down completely; reloading is creating a new
    // one.
    class RuntimeHost
    {
    public:
        struct Options
        {
            js::RuntimeOptions runtime;
            std::shared_ptr<js::ModuleLoader> moduleLoader;
            // The plugin's identity (`plugin.id`, `plugin.name`).
            std::string pluginId;
            std::string pluginName;
            // Backs `soundor:parameters`. Optional.
            std::shared_ptr<parameters::Host> parameters;
            // Backs fetch(). Without it, fetch() rejects.
            std::shared_ptr<platform::HttpClient> http;
            // Backs `soundor:host`. Optional.
            std::shared_ptr<platform::HostInfo> hostInfo;
            // The plugin's private data directory, for `soundor:storage` and
            // `soundor:fs`. Empty: both reject every operation.
            std::filesystem::path dataDirectory;
            // Installs further modules (e.g. the generated `soundor:native`).
            std::function<void(js::Context&)> installModules;
            // The plugin's UI files (its JavaScript bundle and assets). With
            // them, the context loads modules from these resources.
            std::shared_ptr<const platform::Resources> resources;
            // The module to evaluate once everything is installed, e.g.
            // "/bundle.js". Empty: nothing runs until the backend says so.
            std::string entry;
            // Lays out text; default: the renderer's (the platform's fonts).
            std::shared_ptr<ui::TextEngine> textEngine;
            // For text inputs' copy and paste; default: private to the process.
            std::shared_ptr<ui::Clipboard> clipboard;
            // The GPU device canvases' WebGL contexts render on: the GPU
            // compositor's, so that they share it. Default: a device of their
            // own, made when the first context is.
            std::shared_ptr<gpu::Device> gpuDevice;
            // Whether WebGL may use a software renderer when there is no GPU
            // device (tests, debugging). Default: getContext('webgl2') is null.
            bool allowSoftwareGpu = false;
        };

        explicit RuntimeHost(Options options);
        ~RuntimeHost();

        RuntimeHost(const RuntimeHost&) = delete;
        RuntimeHost& operator=(const RuntimeHost&) = delete;
        RuntimeHost(RuntimeHost&&) = delete;
        RuntimeHost& operator=(RuntimeHost&&) = delete;

        // Settles finished asynchronous work (fetch, files), runs due timers,
        // delivers parameter and host changes, runs animation frame callbacks
        // (requestAnimationFrame), then runs pending jobs.
        void tick();

        // Whether the view looks different from when it was last rendered.
        [[nodiscard]] bool needsRender();
        // The view as layers for a compositor (render::Compositor), with what
        // changed since the previous frame; only that is rasterized again.
        // The frame and its pixels stay valid until the next call.
        [[nodiscard]] const render::Frame& frame();
        // Draws the whole view into `target` (sized to the surface at its
        // scale), apart from frame().
        void render(const render::Bitmap& target);

        [[nodiscard]] js::Runtime& runtime() noexcept { return *jsRuntime; }
        [[nodiscard]] js::Context& context() noexcept { return *jsContext; }
        // The view's node tree (`soundor:ui`): the backend sizes it and feeds
        // it input, the renderer draws it. Run pending jobs after input.
        [[nodiscard]] ui::Surface& surface() noexcept { return *uiSurface; }

        // The view's semantic tree, for a platform's accessibility: a backend
        // that has assistive technology to serve calls update() after tick().
        [[nodiscard]] a11y::SurfaceSemantics& accessibility() noexcept { return *semantics; }
        // Delivers an action assistive technology asks for, then runs pending
        // jobs; false when the element is gone or does not offer it.
        bool performAccessibilityAction(const a11y::ActionRequest& request);

        // How evaluating the entry module went (success when there was none).
        // A failed entry is also reported to the log; the host stays usable.
        [[nodiscard]] const js::Result<void>& entryResult() const noexcept { return entryOutcome; }

        // The bytes of a bundled asset ("9f86d081884c7d65.png"), if any.
        [[nodiscard]] std::optional<std::span<const std::uint8_t>> asset(std::string_view id) const;

    private:
        [[nodiscard]] double seconds() const;
        // Whether the caret's blink phase changed (and so its look).
        bool blink();

        std::shared_ptr<const platform::Resources> resources;
        std::unique_ptr<ui::Renderer> renderer;
        std::shared_ptr<ui::Surface> uiSurface;
        std::unique_ptr<render::ViewRenderer> view;
        std::unique_ptr<a11y::SurfaceSemantics> semantics;
        std::unique_ptr<js::Runtime> jsRuntime;
        std::unique_ptr<js::Context> jsContext;
        js::Result<void> entryOutcome;
        bool hasParameters;
        std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
        long long blinkPhase = -1;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
