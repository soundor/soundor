#pragma once

#include <soundor/Config.h>
#include <soundor/js/Context.h>
#include <soundor/parameters/Parameters.h>
#include <soundor/platform/Platform.h>

#include <filesystem>
#include <functional>
#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
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
        };

        explicit RuntimeHost(Options options);
        ~RuntimeHost();

        RuntimeHost(const RuntimeHost&) = delete;
        RuntimeHost& operator=(const RuntimeHost&) = delete;
        RuntimeHost(RuntimeHost&&) = delete;
        RuntimeHost& operator=(RuntimeHost&&) = delete;

        // Settles finished asynchronous work (fetch, files), runs due timers,
        // delivers parameter and host changes, then runs pending jobs.
        void tick();

        [[nodiscard]] js::Runtime& runtime() noexcept { return *jsRuntime; }
        [[nodiscard]] js::Context& context() noexcept { return *jsContext; }

    private:
        std::unique_ptr<js::Runtime> jsRuntime;
        std::unique_ptr<js::Context> jsContext;
        bool hasParameters;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
