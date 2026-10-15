#include "web/Web.h"

#include "modules/Embedded.h"
#include "web/Functions.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        const char stateKey = 0;
        const char timerDispatcherKey = 0;

        // The JavaScript modules embedded into the runtime, by module name.
        struct EmbeddedModule
        {
            const char* name;
            const embedded::ModuleCode* code;
        };

        const EmbeddedModule embeddedModules[] = {
            { "soundor:internal/web", &embedded::webModule },
            { "soundor:internal/web/abort", &embedded::abortModule },
            { "soundor:internal/web/base64", &embedded::base64Module },
            { "soundor:internal/web/blob", &embedded::blobModule },
            { "soundor:internal/web/clone", &embedded::cloneModule },
            { "soundor:internal/web/console", &embedded::consoleModule },
            { "soundor:internal/web/crypto", &embedded::cryptoModule },
            { "soundor:internal/web/dom-exception", &embedded::domExceptionModule },
            { "soundor:internal/web/encoding", &embedded::encodingModule },
            { "soundor:internal/web/events", &embedded::eventsModule },
            { "soundor:internal/web/fetch", &embedded::fetchModule },
            { "soundor:internal/web/form-data", &embedded::formDataModule },
            { "soundor:internal/web/inspect", &embedded::inspectModule },
            { "soundor:internal/web/timers", &embedded::timersModule },
            { "soundor:internal/web/url", &embedded::urlModule },
        };

        // ── soundor:internal/platform: console, clock, timers ────────────────

        namespace bind = js::bind;
        using bind::ContextState;

        jsi::Value write(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 2)
                bind::throwTypeError(context, "write() expects 2 arguments");
            const int level = bind::toInt32(context, args[0]);
            context.runtime->log(static_cast<js::LogLevel>(std::clamp(level, 0, 3)),
                                 js::detail::toStdString(context.rt, args[1]));
            return jsi::Value::undefined();
        }

        jsi::Value now(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t)
        {
            const auto* state = stateOf(context);
            return { state != nullptr ? state->now() : 0.0 };
        }

        jsi::Value setWake(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            auto* state = stateOf(context);
            const double at = count > 0 ? bind::toNumber(context, args[0]) : std::numeric_limits<double>::infinity();
            if (state != nullptr)
                state->nextTimerWake = std::isnan(at) ? std::numeric_limits<double>::infinity() : at;
            return jsi::Value::undefined();
        }

        jsi::Value setTimerDispatcher(ContextState& context, const jsi::Value&, const jsi::Value* args,
                                      std::size_t count)
        {
            if (count < 1 || ! bind::isFunction(context, args[0]))
                bind::throwTypeError(context, "setTimerDispatcher() expects a function");
            bind::retainValue(context, &timerDispatcherKey, jsi::Value(context.rt, args[0]));
            return jsi::Value::undefined();
        }

        void runTimers(ContextState& context, State& state)
        {
            const double time = state.now();
            if (time < state.nextTimerWake)
                return;
            state.nextTimerWake = std::numeric_limits<double>::infinity();
            const jsi::Value* retained = bind::retainedValue(context, &timerDispatcherKey);
            if (retained == nullptr || ! bind::isFunction(context, *retained))
                return;
            // Held for the call: a timer callback may replace the dispatcher.
            const jsi::Function dispatcher = retained->getObject(context.rt).getFunction(context.rt);
            const jsi::Value argument(time);
            bind::call(context, dispatcher, jsi::Value::undefined(), std::span(&argument, 1), "timer dispatch failed");
        }

        void initializePlatform(ContextState& context, jsi::Object& exports)
        {
            State& state = requireState(context);
            for (const auto& function : nativeFunctions())
                bind::setProperty(context, exports, function.name,
                                  bind::function(context, function.name, function.length, function.call));
            bind::setProperty(context, exports, "timeOrigin", jsi::Value(state.timeOrigin));
            bind::setProperty(context, exports, "pluginId", bind::write(context, state.services.pluginId));
            bind::setProperty(context, exports, "pluginName", bind::write(context, state.services.pluginName));
        }
    } // namespace

    const std::vector<NativeFunction>& nativeFunctions()
    {
        static const std::vector<NativeFunction> functions = []
        {
            std::vector<NativeFunction> all {
                { "write", write, 2 },
                { "now", now, 0 },
                { "setWake", setWake, 1 },
                { "setTimerDispatcher", setTimerDispatcher, 1 },
            };
            for (const auto& group : { encodingFunctions(), randomFunctions(), urlFunctions(), httpFunctions(),
                                       fileFunctions(), hostFunctions() })
                all.insert(all.end(), group.begin(), group.end());
            return all;
        }();
        return functions;
    }

    // ── State ────────────────────────────────────────────────────────────────

    State::State(Services provided)
        : services(std::move(provided)),
          origin(std::chrono::steady_clock::now()),
          timeOrigin(double(std::chrono::duration_cast<std::chrono::microseconds>(
                                std::chrono::system_clock::now().time_since_epoch())
                                .count())
                     / 1000.0)
    {
    }

    // In-flight requests are of no use to anyone once the context is gone.
    State::~State()
    {
        for (auto& [id, token] : cancellations)
            token->cancel();
    }

    double State::now() const
    {
        return double(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - origin)
                          .count())
               / 1000.0;
    }

    jsi::Value State::beginOperation(js::bind::ContextState& context, const char* name, std::uint64_t& id)
    {
        std::shared_ptr<js::detail::PendingPromise> pending;
        jsi::Value promise = js::bind::newPromise(context, name, pending);
        id = nextOperationId++;
        operations.emplace(id, std::move(pending));
        return promise;
    }

    std::shared_ptr<js::detail::PendingPromise> State::takeOperation(std::uint64_t id)
    {
        const auto it = operations.find(id);
        if (it == operations.end())
            return nullptr;
        auto pending = std::move(it->second);
        operations.erase(it);
        cancellations.erase(id);
        return pending;
    }

    void State::reject(std::uint64_t id, std::string_view kind, std::string_view message)
    {
        auto pending = takeOperation(id);
        if (pending == nullptr)
            return;
        js::bind::ContextState* context = pending->activeContext();
        if (context == nullptr || context->halted())
            return;
        try
        {
            const jsi::Value error = makeError(*context, kind, message);
            pending->settle(false, error);
        }
        catch (const jsi::JSError& error)
        {
            pending->settle(false, error.value());
        }
    }

    platform::WorkerThread& State::worker()
    {
        if (fileWorker == nullptr)
            fileWorker = std::make_unique<platform::WorkerThread>();
        return *fileWorker;
    }

    State* stateOf(js::bind::ContextState& context)
    {
        return js::bind::contextData<State>(context, &stateKey);
    }

    State& requireState(js::bind::ContextState& context)
    {
        State* state = stateOf(context);
        if (state == nullptr)
            js::bind::throwInternalError(context, "the Soundor platform layer is not installed");
        return *state;
    }

    jsi::Value makeError(js::bind::ContextState& context, std::string_view kind, std::string_view message)
    {
        constexpr std::string_view domPrefix = "DOMException:";
        const bool isDom = kind.starts_with(domPrefix);
        const std::string constructorName(isDom ? std::string_view("DOMException") : kind);

        jsi::Runtime& rt = context.rt;
        const jsi::Value found = rt.global().getProperty(rt, constructorName.c_str());
        const jsi::Function constructor = found.isObject() && found.getObject(rt).isFunction(rt)
                                              ? found.getObject(rt).getFunction(rt)
                                              : rt.global().getPropertyAsFunction(rt, "Error");
        if (isDom)
            return constructor.callAsConstructor(rt, js::bind::write(context, message),
                                                 js::bind::write(context, kind.substr(domPrefix.size())));
        return constructor.callAsConstructor(rt, js::bind::write(context, message));
    }

    // ── install / tick ───────────────────────────────────────────────────────

    void install(js::Context& context, Services services)
    {
        js::bind::setContextData(context, &stateKey, std::make_shared<State>(std::move(services)));
        js::registerNativeModule(context, "soundor:internal/platform", { initializePlatform, {}, {} });
        for (const auto& module : embeddedModules)
            js::registerNativeModule(context, module.name, { {}, module.code->text(), module.code->bytecode });
        for (const auto& module : publicModules())
            js::registerNativeModule(context, module.name, { {}, module.code->text(), module.code->bytecode });

        auto bootstrap = context.importModule("soundor:internal/web");
        if (! bootstrap)
            throw std::runtime_error("the Soundor platform layer failed to start: " + bootstrap.error().toString());
    }

    void tick(js::Context& context)
    {
        auto& state = js::stateOf(context);
        auto* platform = stateOf(state);
        if (platform == nullptr || state.halted())
            return;
        for (auto& completion : platform->completions->take())
        {
            try
            {
                completion(*platform, state);
            }
            catch (...)
            {
                state.runtime->log(js::LogLevel::Error,
                                   "a platform completion failed: " + js::detail::caughtError(state).toString());
            }
        }
        runTimers(state, *platform);
        dispatchHostChanges(state, *platform);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
