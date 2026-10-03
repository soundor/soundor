#pragma once

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

    // A JavaScript realm: one global object and module map.
    //
    // A new context contains the ECMAScript language and nothing else — no
    // console, timers, `window`, `process` or `require`, and none of QuickJS's
    // own `std`/`os` modules. Soundor installs the platform it means to expose
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

        // Evaluates classic (non-module) script code and returns its completion
        // value. Promise jobs it queues are not run; see Runtime::runPendingJobs.
        Result<Value> evaluateScript(std::string_view source, std::string_view filename = "<script>");

        // Evaluates `source` as the ES module `name`, linking its imports
        // through Soundor's module resolution, and runs promise jobs until the
        // module has settled. A module still waiting on top-level await after
        // the job queue drains counts as success; it finishes as later jobs run.
        Result<void> evaluateModule(std::string_view source, std::string_view name);

        // Loads the module `name` through the module loader and evaluates it.
        Result<void> importModule(std::string_view name);

    private:
        friend detail::ContextState& stateOf(Context&);

        std::unique_ptr<detail::ContextState> state;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
