#pragma once

#include <soundor/Abi.h>

// Private to soundor_runtime: the only header where Hermes's types (JSI) meet
// Soundor's. Never include it from a public header.

#include "NativeModule.h"

#include <soundor/js/Context.h>
#include <soundor/js/Runtime.h>

#include <hermes/SoundorHermes.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <cassert>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    struct ContextState;
    struct PendingPromise;

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

        void log(LogLevel level, std::string_view message) const;

        // Brings the engine counters in `statistics` up to date: they are the
        // collectors' own, read on demand.
        void refreshStatistics();

        RuntimeOptions options;
        RuntimeStatistics statistics;
        bool timeNativeCalls = false;
        // Native calls in progress (one calling back into JavaScript that
        // calls another): only the outermost is timed.
        int nativeCallDepth = 0;
        // Every live context; each is a Hermes runtime of its own.
        std::vector<ContextState*> contexts;
        // The engine counters of contexts already destroyed, so that totals
        // never go backwards.
        std::uint64_t retiredCollections = 0;
        std::uint64_t retiredAllocatedBytes = 0;
        std::thread::id owner;
    };

    // What Soundor attaches to a JavaScript object: the FinalizationRegistry
    // cells watching it.
    struct ObjectState final : jsi::NativeState
    {
        // What the collector hands back to the context. Hades finalizes on a
        // thread of its own as well as on the context's, so a collected
        // object only leaves its cells here, under the mutex; the context
        // reports them on its own thread (ContextState::runFinalizers).
        struct Queue
        {
            std::mutex mutex;
            std::vector<std::uint32_t> tokens;
        };

        ObjectState() = default;
        ObjectState(const ObjectState&) = delete;
        ObjectState& operator=(const ObjectState&) = delete;
        ~ObjectState() override;

        std::shared_ptr<Queue> finalization;
        std::vector<std::uint32_t> tokens;
    };

    // Engine values a context takes before any other code runs, so bindings
    // never see a replaced global.
    struct Intrinsics
    {
        jsi::Function error;
        jsi::Function typeError;
        jsi::Function rangeError;
        jsi::Function promise;
        // The typed array constructors, for buffer results.
        jsi::Function int8Array;
        jsi::Function uint8Array;
        jsi::Function int16Array;
        jsi::Function uint16Array;
        jsi::Function int32Array;
        jsi::Function uint32Array;
        jsi::Function bigInt64Array;
        jsi::Function bigUint64Array;
        jsi::Function float32Array;
        jsi::Function float64Array;
        jsi::Function number;
        // What the engine throws when a call runs past its time limit; taken
        // before the global goes, so JavaScript never sees it.
        jsi::Function timeoutError;
    };

    // Why a context stopped for good: Hermes cannot go on in a heap that ran
    // out, and a script stopped at its time limit may have left anything
    // half done.
    enum class Halt
    {
        None,
        OutOfMemory,
        TimedOut,
    };

    struct ContextState
    {
        ContextState(std::shared_ptr<RuntimeState> owner, ContextOptions options);
        ~ContextState();

        ContextState(const ContextState&) = delete;
        ContextState& operator=(const ContextState&) = delete;
        ContextState(ContextState&&) = delete;
        ContextState& operator=(ContextState&&) = delete;

        std::shared_ptr<RuntimeState> runtime;
        std::shared_ptr<ModuleLoader> moduleLoader;
        NativeModuleRegistry nativeModules;
        // Data native modules keep per context (e.g. the API object behind
        // `soundor:native`), keyed by the address of a static. Released after
        // the engine, whose finalizers may still use it.
        std::vector<std::pair<const void*, std::shared_ptr<void>>> moduleData;

        // The realm: a Hermes runtime per context. Every JSI value below goes
        // before it does.
        std::unique_ptr<facebook::hermes::HermesRuntime> hermes;
        jsi::Runtime& rt;

        std::optional<Intrinsics> intrinsics;
        // From soundor:internal/language: hand over the rejections nobody
        // handled, and run the FinalizationRegistry callbacks of collected
        // objects.
        std::optional<jsi::Function> takeRejections;
        std::optional<jsi::Function> cleanupFinalized;
        // Async native calls not yet settled; orphaned when the context dies.
        std::vector<PendingPromise*> pendingPromises;
        // JavaScript values native modules hold on to (e.g. a dispatcher
        // function), keyed like moduleData.
        std::vector<std::pair<const void*, jsi::Value>> retainedValues;
        // Every module loaded so far, by canonical name: its `module` object
        // ({ exports, meta }).
        std::map<std::string, jsi::Object, std::less<>> modules;
        // The property names bindings use, made once each (keyed by the
        // address of a string that outlives the context).
        std::unordered_map<const char*, jsi::PropNameID> names;
        std::shared_ptr<ObjectState::Queue> finalization = std::make_shared<ObjectState::Queue>();
        // Set once the engine ran out of memory or a call ran past its time
        // limit: every later call fails (haltedError()).
        Halt halt = Halt::None;
        // Calls into JavaScript in progress, nested ones included (JavaScript
        // calling native code calling JavaScript); the outermost holds the
        // time limit (enterJavaScript()).
        int javaScriptDepth = 0;

        [[nodiscard]] bool halted() const noexcept { return halt != Halt::None; }
        // The error every call fails with once the context halted.
        [[nodiscard]] Error haltedError() const;

        // Around every call into JavaScript (JavaScriptCall): the outermost
        // arms the engine's deadline, RuntimeOptions::timeLimit from now, and
        // disarms it when it returns.
        void enterJavaScript();
        void leaveJavaScript() noexcept;

        [[nodiscard]] const Intrinsics& builtins() const
        {
            assert(intrinsics.has_value());
            return *intrinsics; // NOLINT(bugprone-unchecked-optional-access): asserted
        }

        // The PropNameID of `literal`, made on first use.
        const jsi::PropNameID& name(const char* literal);

        // Runs queued jobs until none remain, logging failures; returns how
        // many ran. Then reports the rejections nobody handled and runs the
        // FinalizationRegistry callbacks of objects collected since.
        std::size_t drainJobs();
        void reportUnhandledRejections();
        void runFinalizers();

        // Loads (once) the module with canonical `name` and returns its
        // `module.exports`. Throws jsi::JSError.
        jsi::Value require(const std::string& name);
        // Resolves `specifier` as written in `referrer` to a canonical module
        // name. Throws jsi::JSError.
        std::string resolve(std::string_view specifier, std::string_view referrer);
        // Evaluates a module file (a script whose value is its module
        // function) and calls that function for `module`, returning what it
        // returns: a promise for an async (top-level await) module. Throws
        // jsi::JSError.
        jsi::Value runModule(const std::shared_ptr<const jsi::Buffer>& code, const std::string& name,
                             jsi::Object& module);
    };

    // A call into JavaScript, for the time limit: see
    // ContextState::enterJavaScript().
    class [[nodiscard]] JavaScriptCall
    {
    public:
        explicit JavaScriptCall(ContextState& context) : state(context) { state.enterJavaScript(); }
        ~JavaScriptCall() { state.leaveJavaScript(); }

        JavaScriptCall(const JavaScriptCall&) = delete;
        JavaScriptCall& operator=(const JavaScriptCall&) = delete;
        JavaScriptCall(JavaScriptCall&&) = delete;
        JavaScriptCall& operator=(JavaScriptCall&&) = delete;

    private:
        ContextState& state;
    };

    // Bytecode compiled ahead of time by hermesc for this build (Bytecode.h)
    // as a buffer the engine reads in place. Throws jsi::JSError when it is
    // not bytecode for this Hermes.
    std::shared_ptr<const jsi::Buffer> bytecodeBuffer(jsi::Runtime& rt, std::span<const std::uint8_t> compiled,
                                                      std::string_view name);

    // ── Value conversion (ValueConversion.cpp) ──────────────────────────────

    // Snapshot of `value`; never throws.
    Value toValue(jsi::Runtime& rt, const jsi::Value& value);
    // String(value), with conversion failures swallowed.
    std::string toStdString(jsi::Runtime& rt, const jsi::Value& value);
    // Converts a thrown value into an Error; never throws.
    Error toError(ContextState& context, const jsi::Value& thrown);
    // Converts the exception being handled (call only inside a catch block)
    // into an Error, halting the context when the engine ran out of memory
    // or stopped the call at its time limit.
    Error caughtError(ContextState& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    detail::RuntimeState& stateOf(Runtime& runtime);
    detail::ContextState& stateOf(Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
