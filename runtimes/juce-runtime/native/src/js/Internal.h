#pragma once

// Private to soundor_runtime: the only header where QuickJS types meet Soundor
// types. Never include it from a public header.

#include "NativeModule.h"

#include <soundor/js/Context.h>
#include <soundor/js/Runtime.h>

#include <quickjs.h>

#include <cassert>
#include <memory>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    struct PendingPromise;

    // What a SoundorHandle object owns: a native object and the identity of
    // its declared handle type (a bind::HandleType, compared by address).
    struct HandleBox
    {
        const void* type;
        std::shared_ptr<void> object;
    };

    struct RuntimeState
    {
        explicit RuntimeState(const RuntimeOptions& options);
        ~RuntimeState();

        RuntimeState(const RuntimeState&) = delete;
        RuntimeState& operator=(const RuntimeState&) = delete;

        void assertOwnerThread() const noexcept
        {
            assert(std::this_thread::get_id() == owner && "Soundor JS runtime used off its owning thread");
        }

        // Re-anchors the engine's stack-overflow check at the current depth.
        // Called at every entry point, since UI callbacks arrive from different
        // stack depths than the one the runtime was created at.
        void enter() noexcept;

        // Runs queued jobs until none remain; returns how many ran.
        std::size_t drainJobs();
        // Logs and forgets rejections that are still unhandled.
        void reportUnhandledRejections();
        // Forgets the tracked rejection of `promise` without reporting it.
        void forgetRejection(JSValueConst promise);
        // Forgets every tracked rejection that belongs to `ctx`.
        void forgetRejections(JSContext* ctx);

        void log(LogLevel level, std::string_view message) const;

        struct Rejection
        {
            JSContext* ctx;
            JSValue promise;
            JSValue reason;
        };

        JSRuntime* rt = nullptr;
        // Module data of destroyed contexts. Handle finalizers may still need it
        // (a native object can refer to the API that created it), so it is only
        // released once JS_FreeRuntime has finalized every object.
        std::vector<std::shared_ptr<void>> retiredModuleData;
        // Class of opaque native handles (see Bindings.h).
        JSClassID handleClassId = 0;
        LogSink logSink;
        std::thread::id owner;
        std::vector<Rejection> rejections;
    };

    struct ContextState
    {
        std::shared_ptr<RuntimeState> runtime;
        JSContext* ctx = nullptr;
        std::shared_ptr<ModuleLoader> moduleLoader;
        NativeModuleRegistry nativeModules;
        // Data native modules keep per context (e.g. the API object behind
        // `soundor:native`), keyed by the address of a static.
        std::vector<std::pair<const void*, std::shared_ptr<void>>> moduleData;
        // Async native calls not yet settled; orphaned when the context dies.
        std::vector<PendingPromise*> pendingPromises;
    };

    // The state of the live context `ctx` belongs to, or nullptr after the
    // Soundor Context was destroyed (jobs can outlive it).
    inline ContextState* contextStateOf(JSContext* ctx)
    {
        return static_cast<ContextState*>(JS_GetContextOpaque(ctx));
    }

    // ── Value conversion (ValueConversion.cpp) ──────────────────────────────

    // Snapshot of `value`; never throws into JavaScript.
    Value toValue(JSContext* ctx, JSValueConst value);
    // String(value), with conversion failures swallowed.
    std::string toStdString(JSContext* ctx, JSValueConst value);
    // Converts a thrown value into an Error.
    Error toError(JSContext* ctx, JSValueConst thrown);
    // Takes and converts the context's pending exception.
    Error takeException(JSContext* ctx);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    detail::RuntimeState& stateOf(Runtime& runtime);
    detail::ContextState& stateOf(Context& context);

    // The raw engine context, for Soundor-internal bindings.
    inline JSContext* rawContext(Context& context)
    {
        return stateOf(context).ctx;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
