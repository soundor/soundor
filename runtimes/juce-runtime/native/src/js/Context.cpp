#include "Bindings.h"
#include "Internal.h"

#include <algorithm>
#include <array>
#include <new>
#include <string>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace
    {
        // The ECMAScript language and nothing else. QuickJS's JS_NewContext()
        // would also install `performance`, `atob`/`btoa` and DOMException;
        // Soundor's Web platform layer decides separately what to expose.
        bool addLanguageIntrinsics(JSContext* ctx)
        {
            using AddIntrinsic = int (*)(JSContext*);
            constexpr std::array<AddIntrinsic, 10> intrinsics {
                JS_AddIntrinsicBaseObjects, JS_AddIntrinsicDate,    JS_AddIntrinsicEval,   JS_AddIntrinsicRegExp,
                JS_AddIntrinsicJSON,        JS_AddIntrinsicProxy,   JS_AddIntrinsicMapSet, JS_AddIntrinsicTypedArrays,
                JS_AddIntrinsicPromise,     JS_AddIntrinsicWeakRef,
            };
            return std::ranges::all_of(intrinsics, [ctx](AddIntrinsic add) { return add(ctx) == 0; });
        }

        // Exposes the module's canonical name as `import.meta.url`.
        bool setImportMeta(JSContext* ctx, JSValueConst compiledModule, const std::string& name)
        {
            auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiledModule));
            JSValue meta = JS_GetImportMeta(ctx, module);
            if (JS_IsException(meta))
                return false;
            const bool ok = JS_SetPropertyStr(ctx, meta, "url", JS_NewStringLen(ctx, name.data(), name.size())) >= 0;
            JS_FreeValue(ctx, meta);
            return ok;
        }
    } // namespace

    detail::ContextState& stateOf(Context& context)
    {
        return *context.state;
    }

    Context::Context(Runtime& runtime, ContextOptions options) : state(std::make_unique<detail::ContextState>())
    {
        state->runtime = runtime.state;
        state->moduleLoader = std::move(options.moduleLoader);
        state->runtime->enter();

        JSContext* ctx = JS_NewContextRaw(state->runtime->rt);
        if (ctx == nullptr)
            throw std::bad_alloc();
        if (! addLanguageIntrinsics(ctx))
        {
            JS_FreeContext(ctx);
            throw std::bad_alloc();
        }
        JS_SetContextOpaque(ctx, state.get());
        state->ctx = ctx;
    }

    Context::~Context()
    {
        auto& runtime = *state->runtime;
        runtime.assertOwnerThread();
        runtime.forgetRejections(state->ctx);
        // Async calls still in flight can no longer settle anything.
        for (auto* pending : std::exchange(state->pendingPromises, {}))
            pending->orphan();
        for (auto& [key, value] : std::exchange(state->retainedValues, {}))
            JS_FreeValue(state->ctx, value);
        // Jobs still queued for this context keep the engine context alive until
        // they run or the runtime is freed. Detaching the opaque pointer makes
        // any module hook they reach fail cleanly instead of touching freed state.
        JS_SetContextOpaque(state->ctx, nullptr);
        JS_FreeContext(state->ctx);
        // Objects of this context (e.g. native handles) are finalized by later
        // garbage collection, possibly after this point; keep what they may
        // refer to alive until the runtime is gone.
        for (auto& [key, data] : state->moduleData)
            runtime.retiredModuleData.push_back(std::move(data));
    }

    Result<Value> Context::evaluateScript(std::string_view source, std::string_view filename)
    {
        state->runtime->enter();
        JSContext* ctx = state->ctx;
        // JS_Eval requires a NUL-terminated buffer.
        const std::string code(source);
        const std::string name(filename);
        JSValue result = JS_Eval(ctx, code.c_str(), code.size(), name.c_str(), JS_EVAL_TYPE_GLOBAL);
        if (JS_IsException(result))
            return detail::takeException(ctx);
        Value value = detail::toValue(ctx, result);
        JS_FreeValue(ctx, result);
        return value;
    }

    Result<void> Context::evaluateModule(std::string_view source, std::string_view name)
    {
        auto& runtime = *state->runtime;
        runtime.enter();
        JSContext* ctx = state->ctx;
        const std::string code(source);
        const std::string moduleName(name);

        JSValue compiled = JS_Eval(ctx, code.c_str(), code.size(), moduleName.c_str(),
                                   JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
        if (JS_IsException(compiled))
            return detail::takeException(ctx);
        if (! setImportMeta(ctx, compiled, moduleName))
        {
            JS_FreeValue(ctx, compiled);
            return detail::takeException(ctx);
        }

        // Links and evaluates; consumes `compiled`. Yields the module's
        // evaluation promise (modules may use top-level await).
        JSValue promise = JS_EvalFunction(ctx, compiled);
        if (JS_IsException(promise))
            return detail::takeException(ctx);

        runtime.drainJobs();

        Result<void> outcome;
        if (JS_IsPromise(promise) && JS_PromiseState(ctx, promise) == JS_PROMISE_REJECTED)
        {
            // Reported here as the result, so not again as an unhandled rejection.
            runtime.forgetRejection(promise);
            JSValue reason = JS_PromiseResult(ctx, promise);
            outcome = detail::toError(ctx, reason);
            JS_FreeValue(ctx, reason);
        }
        JS_FreeValue(ctx, promise);
        runtime.reportUnhandledRejections();
        return outcome;
    }

    Result<void> Context::importModule(std::string_view name)
    {
        state->runtime->assertOwnerThread();
        if (! state->moduleLoader)
            return Error { "TypeError",
                           "Cannot import '" + std::string(name) + "': no module loader is installed",
                           {} };
        auto source = state->moduleLoader->load(name);
        if (! source)
            return source.error();
        return evaluateModule(source.value(), name);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
