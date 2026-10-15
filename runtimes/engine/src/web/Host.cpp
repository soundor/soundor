// soundor:host: host and transport snapshots from the backend's HostInfo,
// re-read every tick and delivered to subscribers when they change.

#include "modules/Embedded.h"
#include "web/Functions.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        const char hostListenerKey = 0;

        namespace bind = js::bind;
        using bind::ContextState;

        jsi::Value makeSnapshot(ContextState& context, const platform::HostSnapshot& snapshot)
        {
            bind::ObjectBuilder object(context);
            object.set("sampleRate", jsi::Value(snapshot.sampleRate));
            object.set("blockSize", jsi::Value(snapshot.blockSize));
            object.set("hostName", bind::write(context, snapshot.hostName));
            if (snapshot.transport.has_value())
            {
                const auto& t = *snapshot.transport;
                bind::ObjectBuilder transport(context);
                transport.set("playing", jsi::Value(t.playing));
                transport.set("recording", jsi::Value(t.recording));
                transport.set("looping", jsi::Value(t.looping));
                transport.set("bpm", jsi::Value(t.bpm));
                bind::ObjectBuilder signature(context);
                signature.set("numerator", jsi::Value(t.timeSignatureNumerator));
                signature.set("denominator", jsi::Value(t.timeSignatureDenominator));
                transport.set("timeSignature", signature.release());
                transport.set("ppqPosition", jsi::Value(t.ppqPosition));
                transport.set("barStartPpq", jsi::Value(t.barStartPpq));
                transport.set("timeInSeconds", jsi::Value(t.timeInSeconds));
                transport.set("timeInSamples", jsi::Value(double(t.timeInSamples)));
                object.set("transport", transport.release());
            }
            else
            {
                object.set("transport", jsi::Value::null());
            }
            return object.release();
        }

        // hostSnapshot() → the current snapshot (defaults without a HostInfo).
        jsi::Value hostSnapshot(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t)
        {
            auto* state = stateOf(context);
            if (state == nullptr)
                return jsi::Value::null();
            const auto snapshot =
                state->services.hostInfo != nullptr ? state->services.hostInfo->snapshot() : platform::HostSnapshot {};
            return makeSnapshot(context, snapshot);
        }

        jsi::Value setHostListener(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 1 || ! bind::isFunction(context, args[0]))
                bind::throwTypeError(context, "setHostListener() expects a function");
            bind::retainValue(context, &hostListenerKey, jsi::Value(context.rt, args[0]));
            return jsi::Value::undefined();
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

    std::span<const PublicModule> publicModules()
    {
        return modules;
    }

    void dispatchHostChanges(js::bind::ContextState& context, State& state)
    {
        if (state.services.hostInfo == nullptr)
            return;
        const jsi::Value* retained = js::bind::retainedValue(context, &hostListenerKey);
        if (retained == nullptr || ! js::bind::isFunction(context, *retained))
            return; // nobody imported soundor:host
        auto snapshot = state.services.hostInfo->snapshot();
        if (state.lastHostSnapshot == snapshot)
            return;
        state.lastHostSnapshot = snapshot;
        // Held for the call: a subscriber may replace the listener.
        const jsi::Function listener = retained->getObject(context.rt).getFunction(context.rt);
        const jsi::Value argument = makeSnapshot(context, snapshot);
        js::bind::call(context, listener, jsi::Value::undefined(), std::span(&argument, 1),
                       "soundor:host dispatch failed");
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
