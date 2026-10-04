#include "web/Web.h"

#include <soundor/runtime/RuntimeHost.h>

#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    namespace
    {
        std::shared_ptr<js::ModuleLoader> loaderFor(RuntimeHost::Options& options)
        {
            if (options.moduleLoader != nullptr)
                return std::move(options.moduleLoader);
            if (options.resources != nullptr)
                return std::make_shared<platform::ResourceModuleLoader>(options.resources);
            return nullptr;
        }
    } // namespace

    RuntimeHost::RuntimeHost(Options options)
        : jsRuntime(std::make_unique<js::Runtime>(options.runtime)),
          jsContext(std::make_unique<js::Context>(*jsRuntime, js::ContextOptions { loaderFor(options) })),
          resources(options.resources),
          hasParameters(options.parameters != nullptr)
    {
        web::install(*jsContext, web::Services {
                                     std::move(options.http),
                                     std::move(options.dataDirectory),
                                     std::move(options.hostInfo),
                                     std::move(options.pluginId),
                                     std::move(options.pluginName),
                                 });
        if (options.parameters != nullptr)
            parameters::install(*jsContext, std::move(options.parameters));
        if (options.installModules)
            options.installModules(*jsContext);
        if (! options.entry.empty())
        {
            entryOutcome = jsContext->importModule(options.entry);
            if (! entryOutcome)
            {
                const auto& error = entryOutcome.error();
                std::string message = "The plugin UI failed to start: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                if (options.runtime.log)
                    options.runtime.log(js::LogLevel::Error, message);
            }
        }
    }

    // The context goes first, then the runtime frees every remaining object.
    RuntimeHost::~RuntimeHost()
    {
        jsContext.reset();
        jsRuntime.reset();
    }

    void RuntimeHost::tick()
    {
        web::tick(*jsContext);
        if (hasParameters)
            parameters::dispatchChanges(*jsContext);
        jsRuntime->runPendingJobs();
    }

    std::optional<std::span<const std::uint8_t>> RuntimeHost::asset(std::string_view id) const
    {
        if (resources == nullptr || id.empty() || id.find('/') != std::string_view::npos)
            return std::nullopt;
        return resources->find("assets/" + std::string(id));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
