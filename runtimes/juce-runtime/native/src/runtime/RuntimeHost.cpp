#include <soundor/runtime/RuntimeHost.h>

#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    RuntimeHost::RuntimeHost(Options options)
        : jsRuntime(std::make_unique<js::Runtime>(options.runtime)),
          jsContext(std::make_unique<js::Context>(*jsRuntime, js::ContextOptions { std::move(options.moduleLoader) })),
          hasParameters(options.parameters != nullptr)
    {
        if (options.parameters != nullptr)
            parameters::install(*jsContext, std::move(options.parameters));
        if (options.installModules)
            options.installModules(*jsContext);
    }

    // The context goes first, then the runtime frees every remaining object.
    RuntimeHost::~RuntimeHost()
    {
        jsContext.reset();
        jsRuntime.reset();
    }

    void RuntimeHost::tick()
    {
        if (hasParameters)
            parameters::dispatchChanges(*jsContext);
        jsRuntime->runPendingJobs();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
