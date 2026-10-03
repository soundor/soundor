#include "web/Web.h"

#include "modules/Embedded.h"
#include "web/Functions.h"

#include <cmath>
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
            const std::string_view* source;
        };

        const EmbeddedModule embeddedModules[] = {
            { "soundor:internal/web", &embedded::webModule },
            { "soundor:internal/web/abort", &embedded::abortModule },
            { "soundor:internal/web/clone", &embedded::cloneModule },
            { "soundor:internal/web/console", &embedded::consoleModule },
            { "soundor:internal/web/crypto", &embedded::cryptoModule },
            { "soundor:internal/web/encoding", &embedded::encodingModule },
            { "soundor:internal/web/events", &embedded::eventsModule },
            { "soundor:internal/web/inspect", &embedded::inspectModule },
            { "soundor:internal/web/timers", &embedded::timersModule },
            { "soundor:internal/web/url", &embedded::urlModule },
        };

        // ── soundor:internal/platform: console, clock, timers ────────────────

        JSValue write(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            int level = 1;
            if (argc < 2 || JS_ToInt32(ctx, &level, argv[0]) < 0)
                return JS_EXCEPTION;
            auto* state = js::detail::contextStateOf(ctx);
            if (state != nullptr)
                state->runtime->log(static_cast<js::LogLevel>(std::clamp(level, 0, 3)),
                                    js::detail::toStdString(ctx, argv[1]));
            return JS_UNDEFINED;
        }

        JSValue now(JSContext* ctx, JSValueConst, int, JSValueConst*)
        {
            const auto* state = stateOf(ctx);
            return JS_NewFloat64(ctx, state != nullptr ? state->now() : 0.0);
        }

        JSValue setWake(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            auto* state = stateOf(ctx);
            double at = std::numeric_limits<double>::infinity();
            if (argc > 0 && JS_ToFloat64(ctx, &at, argv[0]) < 0)
                return JS_EXCEPTION;
            if (state != nullptr)
                state->nextTimerWake = std::isnan(at) ? std::numeric_limits<double>::infinity() : at;
            return JS_UNDEFINED;
        }

        JSValue setTimerDispatcher(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1 || ! JS_IsFunction(ctx, argv[0]))
                return JS_ThrowTypeError(ctx, "setTimerDispatcher() expects a function");
            js::bind::retainValue(ctx, &timerDispatcherKey, JS_DupValue(ctx, argv[0]));
            return JS_UNDEFINED;
        }

        void runTimers(JSContext* ctx, State& state)
        {
            const double time = state.now();
            if (time < state.nextTimerWake)
                return;
            state.nextTimerWake = std::numeric_limits<double>::infinity();
            JSValue dispatcher = JS_DupValue(ctx, js::bind::retainedValue(ctx, &timerDispatcherKey));
            if (JS_IsFunction(ctx, dispatcher))
            {
                JSValue arg = JS_NewFloat64(ctx, time);
                JSValue result = JS_Call(ctx, dispatcher, JS_UNDEFINED, 1, &arg);
                if (JS_IsException(result))
                    js::detail::contextStateOf(ctx)->runtime->log(
                        js::LogLevel::Error, "timer dispatch failed: " + js::detail::takeException(ctx).toString());
                JS_FreeValue(ctx, result);
            }
            JS_FreeValue(ctx, dispatcher);
        }

        bool exportPlatform(JSContext* ctx, JSModuleDef* module)
        {
            auto* state = stateOf(ctx);
            if (state == nullptr)
            {
                JS_ThrowInternalError(ctx, "the Soundor platform layer is not installed");
                return false;
            }
            for (const auto& function : nativeFunctions())
                if (JS_SetModuleExport(ctx, module, function.name,
                                       JS_NewCFunction(ctx, function.call, function.name, function.length))
                    < 0)
                    return false;
            return JS_SetModuleExport(ctx, module, "timeOrigin", JS_NewFloat64(ctx, state->timeOrigin)) == 0;
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
        : services(std::move(provided)), origin(std::chrono::steady_clock::now()),
          timeOrigin(double(std::chrono::duration_cast<std::chrono::microseconds>(
                                std::chrono::system_clock::now().time_since_epoch())
                                .count())
                     / 1000.0)
    {
    }

    State::~State() = default;

    double State::now() const
    {
        return double(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - origin)
                          .count())
               / 1000.0;
    }

    JSValue State::beginOperation(JSContext* ctx, const char* name, std::uint64_t& id)
    {
        std::shared_ptr<js::detail::PendingPromise> pending;
        JSValue promise = js::bind::newPromise(ctx, name, pending);
        if (JS_IsException(promise))
            return promise;
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
        JSContext* ctx = pending->activeContext();
        if (ctx == nullptr)
            return;
        JSValue error = makeError(ctx, kind, message);
        if (JS_IsException(error))
            error = JS_GetException(ctx);
        pending->settle(false, error);
    }

    platform::WorkerThread& State::worker()
    {
        if (fileWorker == nullptr)
            fileWorker = std::make_unique<platform::WorkerThread>();
        return *fileWorker;
    }

    State* stateOf(JSContext* ctx) { return js::bind::contextData<State>(ctx, &stateKey); }

    JSValue makeError(JSContext* ctx, std::string_view kind, std::string_view message)
    {
        constexpr std::string_view domPrefix = "DOMException:";
        const bool isDom = kind.starts_with(domPrefix);
        const std::string constructorName(isDom ? std::string_view("DOMException") : kind);

        JSValue global = JS_GetGlobalObject(ctx);
        JSValue constructor = JS_GetPropertyStr(ctx, global, constructorName.c_str());
        if (! JS_IsFunction(ctx, constructor))
        {
            JS_FreeValue(ctx, constructor);
            constructor = JS_GetPropertyStr(ctx, global, "Error");
        }
        JS_FreeValue(ctx, global);
        JSValue args[] = { JS_NewStringLen(ctx, message.data(), message.size()), JS_UNDEFINED };
        int argc = 1;
        if (isDom)
        {
            const auto name = kind.substr(domPrefix.size());
            args[1] = JS_NewStringLen(ctx, name.data(), name.size());
            argc = 2;
        }
        JSValue error = JS_CallConstructor(ctx, constructor, argc, args);
        JS_FreeValue(ctx, args[0]);
        JS_FreeValue(ctx, args[1]);
        JS_FreeValue(ctx, constructor);
        return error;
    }

    // ── install / tick ───────────────────────────────────────────────────────

    void install(js::Context& context, Services services)
    {
        JSContext* ctx = js::rawContext(context);
        js::stateOf(context).runtime->enter();
        if (JS_AddIntrinsicDOMException(ctx) < 0 || JS_AddIntrinsicAToB(ctx) < 0)
            throw std::bad_alloc();

        js::bind::setContextData(context, &stateKey, std::make_shared<State>(std::move(services)));
        js::registerNativeModule(context, "soundor:internal/platform", { platformExports(), exportPlatform, {} });
        for (const auto& module : embeddedModules)
            js::registerNativeModule(context, module.name, { {}, {}, *module.source });
        for (const auto& module : publicModules())
            js::registerNativeModule(context, module.name, { {}, {}, *module.source });

        auto bootstrap = context.evaluateModule("import 'soundor:internal/web';", "soundor:bootstrap");
        if (! bootstrap)
            throw std::runtime_error("the Soundor platform layer failed to start: " + bootstrap.error().toString());
    }

    void tick(js::Context& context)
    {
        JSContext* ctx = js::rawContext(context);
        auto* state = stateOf(ctx);
        if (state == nullptr)
            return;
        js::stateOf(context).runtime->enter();
        for (auto& completion : state->completions->take())
            completion(*state, ctx);
        runTimers(ctx, *state);
        dispatchHostChanges(ctx, *state);
    }

    std::vector<std::string> platformExports()
    {
        std::vector<std::string> names;
        for (const auto& function : nativeFunctions())
            names.emplace_back(function.name);
        names.emplace_back("timeOrigin");
        return names;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
