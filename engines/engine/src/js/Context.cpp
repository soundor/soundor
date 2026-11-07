#include "Bindings.h"
#include "Bytecode.h"
#include "Internal.h"
#include "modules/Embedded.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        namespace
        {
            // Bytes the engine reads in place; whoever handed them out keeps
            // them alive (the build's embedded data, or the module loader,
            // which outlives the engine).
            class BorrowedBuffer final : public jsi::Buffer
            {
            public:
                explicit BorrowedBuffer(std::span<const std::uint8_t> borrowed) : bytes(borrowed) {}

                [[nodiscard]] std::size_t size() const override { return bytes.size(); }
                [[nodiscard]] const std::uint8_t* data() const override { return bytes.data(); }

            private:
                std::span<const std::uint8_t> bytes;
            };

            std::shared_ptr<const jsi::Buffer> sourceBuffer(std::string source)
            {
                return std::make_shared<jsi::StringBuffer>(std::move(source));
            }

            ::hermes::vm::RuntimeConfig configFor(const RuntimeOptions& options)
            {
                auto gc = ::hermes::vm::GCConfig::Builder().withName("soundor");
                if (options.memoryLimit > 0)
                {
                    const auto limit = static_cast<::hermes::vm::gcheapsize_t>(options.memoryLimit);
                    gc.withMaxHeapSize(limit).withInitHeapSize(
                        std::min(limit, ::hermes::vm::GCConfig::getDefaultInitHeapSize()));
                }
                // Registers are the interpreter's stack: one HermesValue each.
                const auto registers =
                    static_cast<unsigned>(std::max<std::size_t>(options.maxStackSize / sizeof(std::uint64_t), 1024));
                return ::hermes::vm::RuntimeConfig::Builder()
                    .withGCConfig(gc.build())
                    .withMaxNumRegisters(registers)
                    // Promise jobs wait in the engine's queue until the host
                    // drains it (Runtime::runPendingJobs), as in any host's
                    // event loop.
                    .withMicrotaskQueue(true)
                    // Source compiled at run time (evaluateScript, with the
                    // compiler linked) is what Hermes compiles itself, with
                    // block scoping: no classes (its experimental ones lose
                    // `super(message)` in Error subclasses) and no async
                    // functions. Modules come lowered for it instead
                    // (@soundor/core's toNativeModule()), in development too.
                    .withEnableBlockScoping(true)
                    // What compiles source here checks for the time limit
                    // (RuntimeOptions::timeLimit) as hermesc does for
                    // bytecode (-emit-async-break-check, SoundorCompileJs.cmake).
                    .withAsyncBreakCheckInEval(true)
                    // eval() and the Function constructors throw, with the
                    // compiler or without: a production plugin links none
                    // (soundor_hermes_lean), so development fails the same way
                    // instead of working until the plugin is built.
                    .withEnableEval(false)
                    .withIntl(false)
                    // The engine's Promise implementation needs it.
                    .withEnableHermesInternal(true)
                    .build();
            }

            // Hermes's host additions to the global object, which a Soundor
            // context does not have (the Web layer brings its own TextEncoder,
            // atob and btoa). HermesInternal stays: the engine's Promise
            // implementation uses it.
            constexpr std::array hostGlobals {
                "print", "gc", "QuitError", "TimeoutError", "TextEncoder", "atob", "btoa"
            };

            Intrinsics captureIntrinsics(jsi::Runtime& rt)
            {
                const jsi::Object global = rt.global();
                const auto constructor = [&](const char* name) { return global.getPropertyAsFunction(rt, name); };
                return Intrinsics {
                    constructor("Error"),        constructor("TypeError"),    constructor("RangeError"),
                    constructor("Promise"),      constructor("Float32Array"), constructor("Float64Array"),
                    constructor("Int32Array"),   constructor("Uint8Array"),   constructor("Number"),
                    constructor("TimeoutError"),
                };
            }

            // soundor:internal/language-native, FinalizationRegistry's engine
            // side: watch(target, token) reports `token` once `target` is
            // collected (ContextState::runFinalizers).
            jsi::Value watch(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
            {
                if (count < 2 || ! args[0].isObject() || ! args[1].isNumber())
                    bind::throwTypeError(context, "watch(): expected an object and a token");
                const jsi::Object target = args[0].getObject(context.rt);
                std::shared_ptr<ObjectState> state;
                if (target.hasNativeState(context.rt))
                    state = std::dynamic_pointer_cast<ObjectState>(target.getNativeState(context.rt));
                if (state == nullptr)
                {
                    state = std::make_shared<ObjectState>();
                    target.setNativeState(context.rt, state);
                }
                state->finalization = context.finalization;
                state->tokens.push_back(static_cast<std::uint32_t>(args[1].getNumber()));
                return jsi::Value::undefined();
            }

            // detach(buffer): ArrayBuffer.prototype.transfer()'s last step.
            jsi::Value detach(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
            {
                if (count < 1 || ! facebook::hermes::soundor::detachArrayBuffer(context.rt, args[0]))
                    bind::throwTypeError(context, "detach(): expected an ArrayBuffer");
                return jsi::Value::undefined();
            }

            // isDetached(buffer)
            jsi::Value isDetached(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
            {
                facebook::hermes::soundor::BufferView view;
                if (count < 1 || ! bind::bufferView(context, args[0], view)
                    || view.kind != facebook::hermes::soundor::TypedArrayKind::None)
                    bind::throwTypeError(context, "ArrayBuffer.prototype.detached called on an incompatible receiver");
                return { view.detached };
            }

            void initializeLanguageNative(ContextState& context, jsi::Object& exports)
            {
                bind::setProperty(context, exports, "watch", bind::function(context, "watch", 2, watch));
                bind::setProperty(context, exports, "detach", bind::function(context, "detach", 1, detach));
                bind::setProperty(context, exports, "isDetached", bind::function(context, "isDetached", 1, isDetached));
            }

            jsi::Object moduleRecord(ContextState& context, const std::string& name)
            {
                jsi::Object module(context.rt);
                bind::setProperty(context, module, "exports", jsi::Object(context.rt));
                bind::setProperty(context, module, "id", bind::write(context, name));
                jsi::Object meta(context.rt);
                bind::setProperty(context, meta, "url", bind::write(context, name));
                bind::setProperty(context, module, "meta", meta);
                return module;
            }

            // Settles what an entry module returned: an async module's promise
            // is followed while the job queue drains.
            Result<void> settleEntry(ContextState& context, const jsi::Value& result)
            {
                if (result.isObject())
                {
                    const jsi::Object object = result.getObject(context.rt);
                    const jsi::Value then = bind::property(context, object, "then");
                    if (then.isObject() && then.getObject(context.rt).isFunction(context.rt))
                    {
                        auto outcome = std::make_shared<std::optional<Error>>();
                        const jsi::Function onFulfilled =
                            bind::closure(context, "onFulfilled", 1,
                                          [](ContextState&, const jsi::Value&, const jsi::Value*, std::size_t)
                                          { return jsi::Value::undefined(); });
                        const jsi::Function onRejected = bind::closure(
                            context, "onRejected", 1,
                            [outcome](ContextState& owner, const jsi::Value&, const jsi::Value* args, std::size_t count)
                            {
                                *outcome =
                                    count > 0 ? toError(owner, args[0]) : toError(owner, jsi::Value::undefined());
                                return jsi::Value::undefined();
                            });
                        // The handler makes the rejection handled: it is the
                        // result here, not an unhandled rejection too.
                        then.getObject(context.rt)
                            .getFunction(context.rt)
                            .callWithThis(context.rt, object, onFulfilled, onRejected);
                        context.drainJobs();
                        if (outcome->has_value())
                            return **outcome; // NOLINT(bugprone-unchecked-optional-access): checked
                        return {};
                    }
                }
                context.drainJobs();
                return {};
            }

            // Evaluates an entry module, recorded under `name` like any other.
            Result<void> evaluateEntry(ContextState& state, const std::shared_ptr<const jsi::Buffer>& code,
                                       const std::string& name)
            {
                if (state.halted())
                    return state.haltedError();
                const JavaScriptCall call(state);
                state.modules.erase(name);
                try
                {
                    auto& record = state.modules.emplace(name, moduleRecord(state, name)).first->second;
                    const jsi::Value result = state.runModule(code, name, record);
                    return settleEntry(state, result);
                }
                catch (...)
                {
                    state.modules.erase(name);
                    return caughtError(state);
                }
            }
        } // namespace

        ContextState::ContextState(std::shared_ptr<RuntimeState> owner, ContextOptions options)
            : runtime(std::move(owner)),
              moduleLoader(std::move(options.moduleLoader)),
              hermes(facebook::hermes::makeHermesRuntime(configFor(runtime->options))),
              rt(*hermes)
        {
            try
            {
                const jsi::Object global = rt.global();
                intrinsics.emplace(captureIntrinsics(rt));
                for (const char* name : hostGlobals)
                    global.deleteProperty(rt, name);

                nativeModules.add("soundor:internal/language-native", { initializeLanguageNative, {}, {} });
                nativeModules.add("soundor:internal/language",
                                  { {}, embedded::languageModule.text(), embedded::languageModule.bytecode });
                const jsi::Object language = require("soundor:internal/language").getObject(rt);
                takeRejections = bind::property(*this, language, "takeRejections").getObject(rt).getFunction(rt);
                cleanupFinalized = bind::property(*this, language, "cleanupFinalized").getObject(rt).getFunction(rt);
                runtime->contexts.push_back(this);
            }
            catch (const jsi::JSIException& error)
            {
                // JSError owns a JSI value. Detach it while this engine is
                // alive: translating outside the constructor lets unwinding
                // destroy Hermes before the exception's value is released.
                throw std::runtime_error(std::string("Soundor could not create a JavaScript context: ") + error.what());
            }
        }

        ContextState::~ContextState()
        {
            runtime->assertOwnerThread();
            std::erase(runtime->contexts, this);
            const auto heap = facebook::hermes::soundor::heapStatistics(rt);
            runtime->retiredCollections += heap.collections;
            runtime->retiredAllocatedBytes += heap.totalAllocatedBytes;

            // Async calls still in flight can no longer settle anything.
            for (auto* pending : std::exchange(pendingPromises, {}))
                pending->orphan();
            retainedValues.clear();
            modules.clear();
            names.clear();
            takeRejections.reset();
            cleanupFinalized.reset();
            intrinsics.reset();
            // What QuickJS's debug build checked when its runtime was freed:
            // nothing in C++ may hold a value of this engine any more.
            assert(facebook::hermes::soundor::liveValues(rt) == 0 && "JSI values outlive their Soundor context");
            // Finalizes every object, handles queueing their native objects,
            // which are released next; moduleData, which they may use, goes
            // after.
            hermes.reset();
            releaseHandles();
        }

        const jsi::PropNameID& ContextState::name(const char* literal)
        {
            const auto it = names.find(literal);
            if (it != names.end())
                return it->second;
            return names.emplace(literal, jsi::PropNameID::forUtf8(rt, literal)).first->second;
        }

        std::size_t ContextState::drainJobs()
        {
            runtime->assertOwnerThread();
            // Even in a context that ran out of memory: it takes no JavaScript.
            releaseHandles();
            if (halted())
                return 0;
            const JavaScriptCall call(*this);
            const std::uint64_t before = facebook::hermes::soundor::jobsRun(rt);
            // Finalization callbacks may queue jobs, and jobs may leave garbage
            // whose callbacks are due: run both until neither has work.
            for (int round = 0; round < 64 && ! halted(); ++round)
            {
                while (! halted())
                {
                    try
                    {
                        rt.drainMicrotasks();
                        break;
                    }
                    catch (...)
                    {
                        // A job threw (queueMicrotask's callbacks may): it is
                        // reported, and the queue goes on.
                        runtime->log(LogLevel::Error, "Job failed: " + caughtError(*this).toString());
                    }
                }
                reportUnhandledRejections();
                runFinalizers();
                releaseHandles();
                if (halted() || ! facebook::hermes::soundor::hasPendingJobs(rt))
                    break;
            }
            return static_cast<std::size_t>(facebook::hermes::soundor::jobsRun(rt) - before);
        }

        void ContextState::reportUnhandledRejections()
        {
            if (halted() || ! takeRejections.has_value())
                return;
            try
            {
                const jsi::Value reasons = takeRejections->call(rt);
                if (! reasons.isObject())
                    return;
                const jsi::Array list = reasons.getObject(rt).getArray(rt);
                const std::size_t length = list.size(rt);
                for (std::size_t i = 0; i < length; ++i)
                {
                    const Error error = toError(*this, list.getValueAtIndex(rt, i));
                    std::string message = "Unhandled promise rejection: " + error.toString();
                    if (! error.stack.empty())
                        message += "\n" + error.stack;
                    runtime->log(LogLevel::Error, message);
                }
            }
            catch (...)
            {
                runtime->log(LogLevel::Error, "Reporting rejections failed: " + caughtError(*this).toString());
            }
        }

        void ContextState::runFinalizers()
        {
            std::vector<std::uint32_t> tokens;
            {
                const std::scoped_lock lock(finalization->mutex);
                tokens.swap(finalization->tokens);
            }
            if (tokens.empty() || halted() || ! cleanupFinalized.has_value())
                return;
            try
            {
                const jsi::Array list(rt, tokens.size());
                for (std::size_t i = 0; i < tokens.size(); ++i)
                    list.setValueAtIndex(rt, i, jsi::Value(static_cast<double>(tokens[i])));
                cleanupFinalized->call(rt, list);
            }
            catch (...)
            {
                runtime->log(LogLevel::Error, "FinalizationRegistry cleanup failed: " + caughtError(*this).toString());
            }
        }

        Error ContextState::haltedError() const
        {
            if (halt == Halt::TimedOut)
                return Error { "TimeoutError",
                               "JavaScript ran longer than its time limit ("
                                   + std::to_string(runtime->options.timeLimit.count())
                                   + " ms) and was stopped: the JavaScript context cannot continue",
                               {} };
            return Error { "InternalError", "out of memory: the JavaScript context cannot continue", {} };
        }

        void ContextState::enterJavaScript()
        {
            const auto limit = runtime->options.timeLimit.count();
            if (javaScriptDepth++ == 0 && limit > 0 && ! halted())
                hermes->watchTimeLimit(
                    static_cast<std::uint32_t>(std::min<long long>(limit, std::numeric_limits<std::uint32_t>::max())));
        }

        void ContextState::leaveJavaScript() noexcept
        {
            if (--javaScriptDepth == 0 && runtime->options.timeLimit.count() > 0)
                hermes->unwatchTimeLimit();
        }

        void ContextState::releaseHandles()
        {
            std::unique_ptr<ObjectState::Handle> list;
            {
                const std::scoped_lock lock(finalization->mutex);
                list = std::move(finalization->released);
            }
            // Outside the lock: a native destructor may take its time.
            releaseHandleList(std::move(list));
        }

        std::string ContextState::resolve(std::string_view specifier, std::string_view referrer)
        {
            if (isInternalModuleSpecifier(specifier) && ! isNativeModuleSpecifier(referrer))
                bind::throwTypeError(*this, "Cannot import '" + std::string(specifier)
                                                + "': it is internal to the Soundor runtime");
            if (isNativeModuleSpecifier(specifier))
                return std::string(specifier);
            if (! moduleLoader)
                bind::throwTypeError(*this, "Cannot resolve module '" + std::string(specifier)
                                                + "': no module loader is installed");
            std::optional<Result<std::string>> resolved;
            try
            {
                resolved.emplace(moduleLoader->resolve(specifier, referrer));
            }
            catch (...)
            {
                bind::throwInternalError(*this, "module resolution failed with a native exception");
            }
            if (! resolved->ok())
                bind::throwTypeError(*this, resolved->error().message);
            return std::move(*resolved).value();
        }

        jsi::Value ContextState::require(const std::string& name)
        {
            if (const auto found = modules.find(name); found != modules.end())
                return bind::property(*this, found->second, "exports");
            // Recorded before it runs: a cycle sees the exports made so far,
            // as CommonJS does.
            auto& record = modules.emplace(name, moduleRecord(*this, name)).first->second;
            try
            {
                std::shared_ptr<const jsi::Buffer> code;
                if (isNativeModuleSpecifier(name))
                {
                    const NativeModule* definition = nativeModules.find(name);
                    if (definition == nullptr)
                        bind::throwTypeError(*this, "Unknown Soundor module '" + name + "'");
                    if (definition->initialize)
                    {
                        jsi::Object exports = bind::property(*this, record, "exports").getObject(rt);
                        definition->initialize(*this, exports);
                        return exports;
                    }
                    code = ! definition->bytecode.empty() ? bytecodeBuffer(rt, definition->bytecode, name)
                                                          : sourceBuffer(std::string(definition->source));
                }
                else
                {
                    if (! moduleLoader)
                        bind::throwTypeError(*this, "Cannot load module '" + name + "': no module loader is installed");
                    std::optional<std::span<const std::uint8_t>> bytecode;
                    std::optional<Result<std::string>> source;
                    try
                    {
                        bytecode = moduleLoader->loadBytecode(name);
                        if (! bytecode)
                            source.emplace(moduleLoader->load(name));
                    }
                    catch (...)
                    {
                        bind::throwInternalError(*this, "module loading failed with a native exception");
                    }
                    if (bytecode)
                        code = bytecodeBuffer(rt, *bytecode, name);
                    else if (! source->ok())
                        bind::throwTypeError(*this, source->error().message);
                    else
                        code = sourceBuffer(std::move(*source).value());
                }
                // require() is synchronous: a module awaiting at top level
                // (only an entry should) finishes as jobs run.
                runModule(code, name, record);
                return bind::property(*this, record, "exports");
            }
            catch (...)
            {
                modules.erase(name);
                throw;
            }
        }

        jsi::Value ContextState::runModule(const std::shared_ptr<const jsi::Buffer>& code, const std::string& name,
                                           jsi::Object& module)
        {
            const jsi::Value function = rt.evaluateJavaScript(code, name);
            if (! function.isObject() || ! function.getObject(rt).isFunction(rt))
                bind::throwTypeError(*this,
                                     "'" + name + "' is not a module: its file must evaluate to its module function");
            const jsi::Value exports = bind::property(*this, module, "exports");
            const jsi::Function require = bind::closure(
                *this, "require", 1,
                [referrer = name](ContextState& context, const jsi::Value&, const jsi::Value* args,
                                  std::size_t count) -> jsi::Value
                {
                    if (count < 1 || ! args[0].isString())
                        bind::throwTypeError(context, "require() expects a module specifier");
                    return context.require(context.resolve(args[0].getString(context.rt).utf8(context.rt), referrer));
                });
            return function.getObject(rt).getFunction(rt).callWithThis(rt, exports.getObject(rt), exports, require,
                                                                       module);
        }

        std::shared_ptr<const jsi::Buffer> bytecodeBuffer(jsi::Runtime& rt, std::span<const std::uint8_t> compiled,
                                                          std::string_view name)
        {
            if (! isBytecodeForThisBuild(compiled))
                throw jsi::JSError(rt, "module '" + std::string(name)
                                           + "' was compiled for another Hermes: rebuild the plugin");
            return std::make_shared<BorrowedBuffer>(compiled);
        }
    } // namespace detail

    detail::ContextState& stateOf(Context& context)
    {
        return *context.state;
    }

    Context::Context(Runtime& runtime, ContextOptions options)
    {
        runtime.state->assertOwnerThread();
        try
        {
            state = std::make_unique<detail::ContextState>(runtime.state, std::move(options));
        }
        catch (const jsi::JSIException& error)
        {
            // Only the runtime's own modules run here: a failure is a bug, or
            // memory running out.
            throw std::runtime_error(std::string("Soundor could not create a JavaScript context: ") + error.what());
        }
    }

    Context::~Context() = default;

    TimeLimitScope::TimeLimitScope(Context& context) : state(stateOf(context))
    {
        state.runtime->assertOwnerThread();
        state.enterJavaScript();
    }

    TimeLimitScope::~TimeLimitScope()
    {
        state.leaveJavaScript();
    }

    Result<Value> Context::evaluateScript(std::string_view source, std::string_view filename)
    {
        state->runtime->assertOwnerThread();
        if (state->halted())
            return state->haltedError();
        const detail::JavaScriptCall call(*state);
        try
        {
            const jsi::Value result =
                state->rt.evaluateJavaScript(detail::sourceBuffer(std::string(source)), std::string(filename));
            return detail::toValue(state->rt, result);
        }
        catch (...)
        {
            return detail::caughtError(*state);
        }
    }

    Result<void> Context::evaluateModule(std::string_view source, std::string_view name)
    {
        state->runtime->assertOwnerThread();
        return detail::evaluateEntry(*state, detail::sourceBuffer(std::string(source)), std::string(name));
    }

    Result<void> Context::importModule(std::string_view name)
    {
        state->runtime->assertOwnerThread();
        if (detail::isNativeModuleSpecifier(name))
        {
            // A runtime-provided module: registered, never from the loader.
            if (state->halted())
                return state->haltedError();
            const detail::JavaScriptCall call(*state);
            try
            {
                state->require(std::string(name));
                state->drainJobs();
                return {};
            }
            catch (...)
            {
                return detail::caughtError(*state);
            }
        }
        if (! state->moduleLoader)
            return Error { "TypeError",
                           "Cannot import '" + std::string(name) + "': no module loader is installed",
                           {} };
        const std::string moduleName(name);
        std::shared_ptr<const jsi::Buffer> code;
        try
        {
            // Bytecode the plugin's build compiled, when there is some.
            if (const auto bytecode = state->moduleLoader->loadBytecode(name))
            {
                code = detail::bytecodeBuffer(state->rt, *bytecode, name);
            }
            else
            {
                auto source = state->moduleLoader->load(name);
                if (! source)
                    return source.error();
                code = detail::sourceBuffer(std::move(source).value());
            }
        }
        catch (...)
        {
            return detail::caughtError(*state);
        }
        return detail::evaluateEntry(*state, code, moduleName);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
