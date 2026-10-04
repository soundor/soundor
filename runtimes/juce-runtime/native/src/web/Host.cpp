// soundor:host: host and transport snapshots from the backend's HostInfo,
// re-read every tick and delivered to subscribers when they change.

#include "modules/Embedded.h"
#include "web/Functions.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        const char hostListenerKey = 0;

        JSValue makeSnapshot(JSContext* ctx, const platform::HostSnapshot& snapshot)
        {
            js::bind::ObjectBuilder object(ctx);
            object.set("sampleRate", JS_NewFloat64(ctx, snapshot.sampleRate));
            object.set("blockSize", JS_NewInt32(ctx, snapshot.blockSize));
            object.set("hostName", js::bind::write(ctx, snapshot.hostName));
            if (snapshot.transport.has_value())
            {
                const auto& t = *snapshot.transport;
                js::bind::ObjectBuilder transport(ctx);
                transport.set("playing", JS_NewBool(ctx, t.playing));
                transport.set("recording", JS_NewBool(ctx, t.recording));
                transport.set("looping", JS_NewBool(ctx, t.looping));
                transport.set("bpm", JS_NewFloat64(ctx, t.bpm));
                transport.set("timeSignature",
                              [&]
                              {
                                  js::bind::ObjectBuilder signature(ctx);
                                  signature.set("numerator", JS_NewInt32(ctx, t.timeSignatureNumerator));
                                  signature.set("denominator", JS_NewInt32(ctx, t.timeSignatureDenominator));
                                  return signature.release();
                              }());
                transport.set("ppqPosition", JS_NewFloat64(ctx, t.ppqPosition));
                transport.set("barStartPpq", JS_NewFloat64(ctx, t.barStartPpq));
                transport.set("timeInSeconds", JS_NewFloat64(ctx, t.timeInSeconds));
                transport.set("timeInSamples", JS_NewFloat64(ctx, double(t.timeInSamples)));
                object.set("transport", transport.release());
            }
            else
            {
                object.set("transport", JS_NULL);
            }
            return object.release();
        }

        // hostSnapshot() → the current snapshot (defaults without a HostInfo).
        JSValue hostSnapshot(JSContext* ctx, JSValueConst, int, JSValueConst*)
        {
            auto* state = stateOf(ctx);
            if (state == nullptr)
                return JS_NULL;
            const auto snapshot =
                state->services.hostInfo != nullptr ? state->services.hostInfo->snapshot() : platform::HostSnapshot {};
            return makeSnapshot(ctx, snapshot);
        }

        JSValue setHostListener(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1 || ! JS_IsFunction(ctx, argv[0]))
                return JS_ThrowTypeError(ctx, "setHostListener() expects a function");
            js::bind::retainValue(ctx, &hostListenerKey, JS_DupValue(ctx, argv[0]));
            return JS_UNDEFINED;
        }

        const PublicModule modules[] = {
            { "soundor:fs", &embedded::fsModule },
            { "soundor:host", &embedded::hostModule },
            { "soundor:storage", &embedded::storageModule },
        };
    } // namespace

    std::vector<NativeFunction> hostFunctions()
    {
        return {
            { "hostSnapshot", hostSnapshot, 0 },
            { "setHostListener", setHostListener, 1 },
        };
    }

    std::span<const PublicModule> publicModules() { return modules; }

    void dispatchHostChanges(JSContext* ctx, State& state)
    {
        if (state.services.hostInfo == nullptr)
            return;
        JSValue listener = JS_DupValue(ctx, js::bind::retainedValue(ctx, &hostListenerKey));
        if (! JS_IsFunction(ctx, listener))
        {
            JS_FreeValue(ctx, listener);
            return; // nobody imported soundor:host
        }
        auto snapshot = state.services.hostInfo->snapshot();
        if (state.lastHostSnapshot != snapshot)
        {
            state.lastHostSnapshot = snapshot;
            JSValue arg = makeSnapshot(ctx, snapshot);
            JSValue result = JS_Call(ctx, listener, JS_UNDEFINED, 1, &arg);
            if (JS_IsException(result))
                js::detail::contextStateOf(ctx)->runtime->log(
                    js::LogLevel::Error, "soundor:host dispatch failed: " + js::detail::takeException(ctx).toString());
            JS_FreeValue(ctx, arg);
            JS_FreeValue(ctx, result);
        }
        JS_FreeValue(ctx, listener);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
