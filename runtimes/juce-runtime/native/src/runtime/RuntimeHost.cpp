#include "modules/ui/UiModule.h"
#include "render/ViewRenderer.h"
#include "web/Web.h"

#include <soundor/runtime/RuntimeHost.h>

#include <string>
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
        : resources(options.resources),
          renderer(std::make_unique<ui::Renderer>(
              [assets = options.resources](std::string_view id) -> std::optional<std::span<const std::uint8_t>>
              {
                  if (assets == nullptr || id.empty() || id.find('/') != std::string_view::npos)
                      return std::nullopt;
                  return assets->find("assets/" + std::string(id));
              })),
          uiSurface(std::make_shared<ui::Surface>(ui::Surface::Options {
              options.textEngine != nullptr ? std::move(options.textEngine) : renderer->textEngine(),
              renderer->images(),
              std::move(options.clipboard),
          })),
          view(std::make_unique<render::ViewRenderer>(*renderer)),
          semantics(std::make_unique<a11y::SurfaceSemantics>(*uiSurface)),
          jsRuntime(std::make_unique<js::Runtime>(options.runtime)),
          jsContext(std::make_unique<js::Context>(*jsRuntime, js::ContextOptions { loaderFor(options) })),
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
        ui::install(*jsContext, uiSurface);
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
        ui::frame(*jsContext);
        jsRuntime->runPendingJobs();
    }

    bool RuntimeHost::performAccessibilityAction(const a11y::ActionRequest& request)
    {
        const bool handled = semantics->perform(request);
        jsRuntime->runPendingJobs();
        return handled;
    }

    double RuntimeHost::seconds() const
    {
        return std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    }

    bool RuntimeHost::blink()
    {
        // A blinking caret changes the picture twice a second.
        const long long phase = uiSurface->animating() ? static_cast<long long>(seconds() / 0.53) : -1;
        if (phase == blinkPhase)
            return false;
        blinkPhase = phase;
        uiSurface->invalidate(uiSurface->focused());
        return true;
    }

    bool RuntimeHost::needsRender()
    {
        const bool blinked = blink();
        return uiSurface->takeChanges() || blinked;
    }

    const render::Frame& RuntimeHost::frame()
    {
        blink();
        return view->update(*uiSurface, seconds());
    }

    void RuntimeHost::render(const render::Bitmap& target)
    {
        renderer->render(*uiSurface, target, seconds());
    }

    std::optional<std::span<const std::uint8_t>> RuntimeHost::asset(std::string_view id) const
    {
        if (resources == nullptr || id.empty() || id.find('/') != std::string_view::npos)
            return std::nullopt;
        return resources->find("assets/" + std::string(id));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
