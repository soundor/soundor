#include "Internal.h"

#include <algorithm>
#include <cstring>
#include <new>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        namespace
        {
            // Copies `text` into engine-owned memory, as the module hooks require.
            char* engineString(JSContext* ctx, const std::string& text)
            {
                return js_strdup(ctx, text.c_str());
            }

            void throwError(JSContext* ctx, const Error& error)
            {
                // Message passed as an argument, never as a format string.
                JS_ThrowTypeError(ctx, "%s", error.message.c_str());
            }

            // QuickJS hook: maps an import specifier to a canonical module name.
            char* normaliseModuleName(JSContext* ctx, const char* referrer, const char* specifier, void*)
            {
                try
                {
                    auto* state = contextStateOf(ctx);
                    if (state == nullptr)
                    {
                        JS_ThrowInternalError(ctx, "module import after the Soundor context was destroyed");
                        return nullptr;
                    }
                    if (isInternalModuleSpecifier(specifier) && ! isNativeModuleSpecifier(referrer))
                    {
                        JS_ThrowTypeError(ctx, "Cannot import '%s': it is internal to the Soundor runtime", specifier);
                        return nullptr;
                    }
                    if (isNativeModuleSpecifier(specifier))
                        return engineString(ctx, specifier);
                    if (! state->moduleLoader)
                    {
                        JS_ThrowTypeError(ctx, "Cannot resolve module '%s': no module loader is installed", specifier);
                        return nullptr;
                    }
                    auto resolved = state->moduleLoader->resolve(specifier, referrer);
                    if (! resolved)
                    {
                        throwError(ctx, resolved.error());
                        return nullptr;
                    }
                    return engineString(ctx, resolved.value());
                }
                catch (const std::bad_alloc&)
                {
                    JS_ThrowOutOfMemory(ctx);
                }
                catch (...)
                {
                    JS_ThrowInternalError(ctx, "module resolution failed with a native exception");
                }
                return nullptr;
            }

            int initialiseNativeModule(JSContext* ctx, JSModuleDef* module)
            {
                auto* state = contextStateOf(ctx);
                if (state == nullptr)
                {
                    JS_ThrowInternalError(ctx, "native module initialised after the Soundor context was destroyed");
                    return -1;
                }
                const JSAtom nameAtom = JS_GetModuleName(ctx, module);
                const char* name = JS_AtomToCString(ctx, nameAtom);
                JS_FreeAtom(ctx, nameAtom);
                if (name == nullptr)
                    return -1;
                const NativeModule* definition = state->nativeModules.find(name);
                JS_FreeCString(ctx, name);
                if (definition == nullptr)
                {
                    JS_ThrowInternalError(ctx, "native module disappeared before initialisation");
                    return -1;
                }
                try
                {
                    return definition->initialize(ctx, module) ? 0 : -1;
                }
                catch (...)
                {
                    JS_ThrowInternalError(ctx, "native module initialisation failed with a native exception");
                    return -1;
                }
            }

            JSModuleDef* loadNativeModule(JSContext* ctx, ContextState& state, const char* name)
            {
                const NativeModule* definition = state.nativeModules.find(name);
                if (definition == nullptr)
                {
                    JS_ThrowTypeError(ctx, "Unknown Soundor module '%s'", name);
                    return nullptr;
                }
                if (! definition->source.empty())
                {
                    JSValue compiled = JS_Eval(ctx, definition->source.data(), definition->source.size(), name,
                                               JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
                    if (JS_IsException(compiled))
                        return nullptr;
                    auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled));
                    JS_FreeValue(ctx, compiled);
                    return module;
                }
                JSModuleDef* module = JS_NewCModule(ctx, name, initialiseNativeModule);
                if (module == nullptr)
                    return nullptr;
                for (const auto& exportName : definition->exports)
                    if (JS_AddModuleExport(ctx, module, exportName.c_str()) < 0)
                        return nullptr;
                return module;
            }

            // QuickJS hook: produces the module record for a canonical name.
            JSModuleDef* loadModule(JSContext* ctx, const char* name, void*)
            {
                try
                {
                    auto* state = contextStateOf(ctx);
                    if (state == nullptr)
                    {
                        JS_ThrowInternalError(ctx, "module import after the Soundor context was destroyed");
                        return nullptr;
                    }
                    if (isNativeModuleSpecifier(name))
                        return loadNativeModule(ctx, *state, name);
                    if (! state->moduleLoader)
                    {
                        JS_ThrowTypeError(ctx, "Cannot load module '%s': no module loader is installed", name);
                        return nullptr;
                    }
                    auto source = state->moduleLoader->load(name);
                    if (! source)
                    {
                        throwError(ctx, source.error());
                        return nullptr;
                    }
                    const std::string& code = source.value();
                    JSValue compiled =
                        JS_Eval(ctx, code.c_str(), code.size(), name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
                    if (JS_IsException(compiled))
                        return nullptr;
                    auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled));
                    JS_FreeValue(ctx, compiled);
                    return module;
                }
                catch (const std::bad_alloc&)
                {
                    JS_ThrowOutOfMemory(ctx);
                }
                catch (...)
                {
                    JS_ThrowInternalError(ctx, "module loading failed with a native exception");
                }
                return nullptr;
            }

            void trackRejection(JSContext* ctx, JSValueConst promise, JSValueConst reason, bool isHandled, void* opaque)
            {
                auto& state = *static_cast<RuntimeState*>(opaque);
                if (isHandled)
                {
                    state.forgetRejection(promise);
                    return;
                }
                try
                {
                    auto& list = state.rejections;
                    if (list.size() == list.capacity())
                        list.reserve(std::max<std::size_t>(8, list.capacity() * 2));
                }
                catch (...)
                {
                    // Out of memory while tracking: the rejection goes unreported
                    // rather than unwinding through the engine.
                    return;
                }
                state.rejections.push_back({ ctx, JS_DupValue(ctx, promise), JS_DupValue(ctx, reason) });
            }
            // Releases the native object behind a handle when JavaScript drops it
            // (garbage collection, or the context/runtime being freed).
            void finalizeHandle(JSRuntime*, JSValueConst value)
            {
                JSClassID classId = 0;
                delete static_cast<HandleBox*>(JS_GetAnyOpaque(value, &classId));
            }

            void registerHandleClass(JSRuntime* rt, JSClassID& classId)
            {
                JS_NewClassID(rt, &classId);
                JSClassDef definition {};
                definition.class_name = "SoundorHandle";
                definition.finalizer = finalizeHandle;
                if (JS_NewClass(rt, classId, &definition) < 0)
                    throw std::bad_alloc();
            }
        } // namespace

        RuntimeState::RuntimeState(const RuntimeOptions& options)
            : rt(JS_NewRuntime()), logSink(options.log), owner(std::this_thread::get_id())
        {
            if (rt == nullptr)
                throw std::bad_alloc();
            if (options.memoryLimit > 0)
                JS_SetMemoryLimit(rt, options.memoryLimit);
            JS_SetMaxStackSize(rt, options.maxStackSize);
            JS_SetModuleLoaderFunc(rt, normaliseModuleName, loadModule, nullptr);
            registerHandleClass(rt, handleClassId);
            JS_SetHostPromiseRejectionTracker(rt, trackRejection, this);
        }

        RuntimeState::~RuntimeState()
        {
            assertOwnerThread();
            for (auto& rejection : rejections)
            {
                JS_FreeValueRT(rt, rejection.promise);
                JS_FreeValueRT(rt, rejection.reason);
            }
            rejections.clear();
            JS_FreeRuntime(rt);
            // Only now can no finalizer reach module data any more.
            retiredModuleData.clear();
        }

        // Not const: it moves the engine's stack anchor.
        void RuntimeState::enter() noexcept // NOLINT(readability-make-member-function-const)
        {
            assertOwnerThread();
            JS_UpdateStackTop(rt);
        }

        std::size_t RuntimeState::drainJobs()
        {
            enter();
            std::size_t count = 0;
            JSContext* jobContext = nullptr;
            while (JS_IsJobPending(rt))
            {
                const int status = JS_ExecutePendingJob(rt, &jobContext);
                if (status == 0)
                    break;
                ++count;
                // Promise jobs catch their own exceptions; a failure here is the
                // engine itself giving up (e.g. out of memory).
                if (status < 0 && jobContext != nullptr)
                    log(LogLevel::Error, "Job failed: " + takeException(jobContext).toString());
            }
            return count;
        }

        void RuntimeState::reportUnhandledRejections()
        {
            auto pending = std::move(rejections);
            rejections.clear();
            for (auto& rejection : pending)
            {
                const Error error = toError(rejection.ctx, rejection.reason);
                std::string message = "Unhandled promise rejection: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                log(LogLevel::Error, message);
                JS_FreeValueRT(rt, rejection.promise);
                JS_FreeValueRT(rt, rejection.reason);
            }
        }

        void RuntimeState::forgetRejection(JSValueConst promise)
        {
            const auto it = std::find_if(rejections.begin(), rejections.end(), [&](const Rejection& rejection)
                                         { return JS_VALUE_GET_PTR(rejection.promise) == JS_VALUE_GET_PTR(promise); });
            if (it == rejections.end())
                return;
            JS_FreeValueRT(rt, it->promise);
            JS_FreeValueRT(rt, it->reason);
            rejections.erase(it);
        }

        void RuntimeState::forgetRejections(JSContext* ctx)
        {
            std::erase_if(rejections,
                          [&](const Rejection& rejection)
                          {
                              if (rejection.ctx != ctx)
                                  return false;
                              JS_FreeValueRT(rt, rejection.promise);
                              JS_FreeValueRT(rt, rejection.reason);
                              return true;
                          });
        }

        void RuntimeState::log(LogLevel level, std::string_view message) const
        {
            if (logSink)
                logSink(level, message);
        }
    } // namespace detail

    detail::RuntimeState& stateOf(Runtime& runtime)
    {
        return *runtime.state;
    }

    Runtime::Runtime(const RuntimeOptions& options) : state(std::make_shared<detail::RuntimeState>(options)) {}

    Runtime::~Runtime()
    {
        state->assertOwnerThread();
    }

    std::size_t Runtime::runPendingJobs()
    {
        const std::size_t count = state->drainJobs();
        state->reportUnhandledRejections();
        return count;
    }

    bool Runtime::hasPendingJobs() const
    {
        state->assertOwnerThread();
        return JS_IsJobPending(state->rt);
    }

    void Runtime::collectGarbage()
    {
        state->enter();
        JS_RunGC(state->rt);
    }

    MemoryUsage Runtime::memoryUsage() const
    {
        state->assertOwnerThread();
        JSMemoryUsage usage {};
        JS_ComputeMemoryUsage(state->rt, &usage);
        return MemoryUsage {
            static_cast<std::size_t>(usage.malloc_size),
            static_cast<std::size_t>(usage.obj_count),
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
