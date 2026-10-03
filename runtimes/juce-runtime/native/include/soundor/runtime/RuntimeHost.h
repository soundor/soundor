#pragma once

#include <soundor/Config.h>
#include <soundor/js/Context.h>
#include <soundor/parameters/Parameters.h>

#include <functional>
#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    // One plugin UI's JavaScript runtime, wired to the plugin: a js::Runtime
    // and js::Context with the `soundor:*` modules installed.
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
            // Backs `soundor:parameters`. Optional.
            std::shared_ptr<parameters::Host> parameters;
            // Installs further modules (e.g. the generated `soundor:native`).
            std::function<void(js::Context&)> installModules;
        };

        explicit RuntimeHost(Options options);
        ~RuntimeHost();

        RuntimeHost(const RuntimeHost&) = delete;
        RuntimeHost& operator=(const RuntimeHost&) = delete;
        RuntimeHost(RuntimeHost&&) = delete;
        RuntimeHost& operator=(RuntimeHost&&) = delete;

        // Delivers parameter changes to JavaScript, then runs pending jobs.
        void tick();

        [[nodiscard]] js::Runtime& runtime() noexcept { return *jsRuntime; }
        [[nodiscard]] js::Context& context() noexcept { return *jsContext; }

    private:
        std::unique_ptr<js::Runtime> jsRuntime;
        std::unique_ptr<js::Context> jsContext;
        bool hasParameters;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
