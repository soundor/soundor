#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/js/Error.h>
#include <soundor/js/ModuleLoader.h>
#include <soundor/js/Runtime.h>
#include <soundor/js/Value.h>

#include <memory>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        struct ContextState;
    }

    struct ContextOptions
    {
        // Supplies every non-`soundor:` module. Optional.
        std::shared_ptr<ModuleLoader> moduleLoader;
    };

    // A JavaScript realm: one global object and module map, in an engine
    // instance (a Hermes runtime) of its own.
    //
    // A new context contains the ECMAScript language and nothing else — no
    // console, timers, `window`, `process` or global `require` (modules get
    // theirs), and none of Hermes's own host functions such as `print`. The
    // few standard built-ins Hermes lacks (FinalizationRegistry among them)
    // are provided. Soundor installs the platform it means to expose
    // explicitly.
    class Context
    {
    public:
        explicit Context(Runtime& runtime, ContextOptions options = {});
        ~Context();

        Context(const Context&) = delete;
        Context& operator=(const Context&) = delete;
        Context(Context&&) = delete;
        Context& operator=(Context&&) = delete;

        // Compiles and evaluates classic (non-module) script code and returns
        // its completion value. Promise jobs it queues are not run; see
        // Runtime::runPendingJobs. Needs the engine's compiler (a build that
        // evaluates source, SOUNDOR_JS_SOURCE): a bytecode-only build fails.
        Result<Value> evaluateScript(std::string_view source, std::string_view filename = "<script>");

        // Evaluates `source` as the module `name`, in the runtime's module form:
        // a script whose value is the module function, `(function (exports,
        // require, module) { ... })` or an async one (see
        // @soundor/core's toNativeModule()). Its `require` resolves through
        // Soundor's module resolution. Runs promise jobs until an async module
        // has settled; one still waiting on top-level await after the job
        // queue drains counts as success, and finishes as later jobs run.
        Result<void> evaluateModule(std::string_view source, std::string_view name);

        // Loads the module `name` through the module loader (its bytecode when
        // the loader has some) and evaluates it, as evaluateModule(). A
        // `soundor:` name loads that runtime-provided module (internal ones
        // included: this is the runtime's own entry point), once.
        Result<void> importModule(std::string_view name);

    private:
        friend detail::ContextState& stateOf(Context&);

        std::unique_ptr<detail::ContextState> state;
    };

    // One time limit (RuntimeOptions::timeLimit) over everything a context's
    // JavaScript does while the scope lives. A context starts the clock on
    // each call into JavaScript that is not already inside one (a script, a
    // job drain, an event listener, a callback); a host groups the calls of
    // one step with a scope (RuntimeHost::tick: timers, parameter changes,
    // jobs, animation frames), so that they share one deadline, armed once.
    // Scopes nest; only the outermost arms the deadline.
    class [[nodiscard]] TimeLimitScope
    {
    public:
        explicit TimeLimitScope(Context& context);
        ~TimeLimitScope();

        TimeLimitScope(const TimeLimitScope&) = delete;
        TimeLimitScope& operator=(const TimeLimitScope&) = delete;
        TimeLimitScope(TimeLimitScope&&) = delete;
        TimeLimitScope& operator=(TimeLimitScope&&) = delete;

    private:
        detail::ContextState& state;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
