#include "js/Bindings.h"
#include "modules/Embedded.h"

#include <soundor/parameters/Parameters.h>

#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
{
    namespace
    {
        namespace bind = js::bind;

        const char bindingKey = 0;
        const char listenerKey = 0;

        // One context's view of a parameter host.
        struct Binding
        {
            explicit Binding(std::shared_ptr<Host> parameters)
                : host(std::move(parameters)), gestures(host->infos().size(), 0)
            {
            }

            // A gesture still open when the context goes away (e.g. a reload in
            // the middle of a drag) is ended, so the host never stays stuck in
            // one.
            ~Binding()
            {
                for (std::size_t index = 0; index < gestures.size(); ++index)
                    if (gestures[index] > 0)
                        host->endGesture(index);
            }

            Binding(const Binding&) = delete;
            Binding& operator=(const Binding&) = delete;

            std::shared_ptr<Host> host;
            // Open beginGesture() calls per parameter: the host sees one
            // gesture however often JavaScript nests them.
            std::vector<int> gestures;
        };

        using bind::ContextState;

        Binding& bindingOf(ContextState& context)
        {
            auto* binding = bind::contextData<Binding>(context, &bindingKey);
            if (binding == nullptr)
                bind::throwInternalError(context, "soundor:parameters is not installed in this context");
            return *binding;
        }

        // Reads the parameter index argument, validating it against the host.
        // The JavaScript layer guarantees argument shapes; these validations
        // only protect the native side.
        std::size_t readIndex(ContextState& context, const Binding& binding, const jsi::Value* args, std::size_t count)
        {
            const double number = count > 0 && args[0].isNumber() ? args[0].getNumber() : -1.0;
            if (number < 0 || number >= double(binding.gestures.size()) || std::floor(number) != number)
                bind::throwRangeError(context, "invalid parameter index");
            return static_cast<std::size_t>(number);
        }

        jsi::Value getValue(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            Binding& binding = bindingOf(context);
            return { binding.host->value(readIndex(context, binding, args, count)) };
        }

        jsi::Value setValue(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            Binding& binding = bindingOf(context);
            const std::size_t index = readIndex(context, binding, args, count);
            const double value = count >= 2 ? bind::toNumber(context, args[1]) : std::nan("");
            if (std::isnan(value))
                bind::throwTypeError(context, "invalid parameter value");
            binding.host->setValue(index, constrain(binding.host->infos()[index], value));
            return jsi::Value::undefined();
        }

        jsi::Value beginGesture(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            Binding& binding = bindingOf(context);
            const std::size_t index = readIndex(context, binding, args, count);
            int& depth = binding.gestures[index];
            if (depth == 0)
                binding.host->beginGesture(index);
            ++depth;
            return jsi::Value::undefined();
        }

        jsi::Value endGesture(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            Binding& binding = bindingOf(context);
            const std::size_t index = readIndex(context, binding, args, count);
            // An unmatched endGesture() is ignored rather than unbalancing the
            // host.
            int& depth = binding.gestures[index];
            if (depth == 0)
                return jsi::Value::undefined();
            --depth;
            if (depth == 0)
                binding.host->endGesture(index);
            return jsi::Value::undefined();
        }

        jsi::Value setListener(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 1 || ! bind::isFunction(context, args[0]))
                bind::throwTypeError(context, "setListener() expects a function");
            bind::retainValue(context, &listenerKey, jsi::Value(context.rt, args[0]));
            return jsi::Value::undefined();
        }

        jsi::Value reportError(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count > 0)
            {
                const js::Error error = js::detail::toError(context, args[0]);
                std::string message = "soundor:parameters subscriber threw: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                context.runtime->log(js::LogLevel::Error, message);
            }
            return jsi::Value::undefined();
        }

        jsi::Value makeInfos(ContextState& context, std::span<const Info> infos)
        {
            jsi::Array array(context.rt, infos.size());
            for (std::size_t index = 0; index < infos.size(); ++index)
            {
                const Info& info = infos[index];
                bind::ObjectBuilder object(context);
                object.set("id", bind::write(context, info.id));
                object.set("label", bind::write(context, info.label));
                object.set("kind", jsi::Value(static_cast<int>(info.kind)));
                object.set("min", jsi::Value(info.min));
                object.set("max", jsi::Value(info.max));
                object.set("default", jsi::Value(info.defaultValue));
                object.set("unit", bind::write(context, info.unit));
                object.set("choices", bind::writeArray(context, std::vector<std::string>(info.choices),
                                                       [](ContextState& c, std::string&& choice)
                                                       { return bind::write(c, choice); }));
                array.setValueAtIndex(context.rt, index, object.release());
            }
            return array;
        }

        void initializeInternalModule(ContextState& context, jsi::Object& exports)
        {
            Binding& binding = bindingOf(context);
            const auto exportFunction = [&](const char* name, bind::NativeFunction function, unsigned length)
            { bind::setProperty(context, exports, name, bind::function(context, name, length, function)); };
            bind::setProperty(context, exports, "infos", makeInfos(context, binding.host->infos()));
            exportFunction("get", getValue, 1);
            exportFunction("set", setValue, 2);
            exportFunction("beginGesture", beginGesture, 1);
            exportFunction("endGesture", endGesture, 1);
            exportFunction("setListener", setListener, 1);
            exportFunction("reportError", reportError, 1);
        }
    } // namespace

    double constrain(const Info& info, double value) noexcept
    {
        switch (info.kind)
        {
            case Kind::Float:
                return std::clamp(value, info.min, info.max);
            case Kind::Int:
                return std::clamp(std::round(value), info.min, info.max);
            case Kind::Bool:
                return value >= 0.5 ? 1.0 : 0.0;
            case Kind::Choice:
                return std::clamp(std::round(value), 0.0, info.choices.empty() ? 0.0 : double(info.choices.size() - 1));
        }
        return value;
    }

    void install(js::Context& context, std::shared_ptr<Host> host)
    {
        if (host == nullptr)
            throw std::invalid_argument("soundor:parameters needs a parameter host");
        bind::setContextData(context, &bindingKey, std::make_shared<Binding>(std::move(host)));
        js::registerNativeModule(context, "soundor:internal/parameters", { initializeInternalModule, {}, {} });
        js::registerNativeModule(context, "soundor:parameters",
                                 { {}, embedded::parametersModule.text(), embedded::parametersModule.bytecode });
    }

    std::size_t dispatchChanges(js::Context& context)
    {
        auto& state = js::stateOf(context);
        auto* binding = bind::contextData<Binding>(state, &bindingKey);
        if (binding == nullptr)
            return 0;

        std::size_t changed = 0;
        const jsi::Value* retained = bind::retainedValue(state, &listenerKey);
        // Held for the whole dispatch: a subscriber may replace the listener.
        std::optional<jsi::Function> listener;
        if (retained != nullptr && bind::isFunction(state, *retained) && ! state.halted())
            listener = retained->getObject(state.rt).getFunction(state.rt);
        binding->host->changes().drain(
            [&](std::size_t index)
            {
                ++changed;
                // Nobody imported soundor:parameters yet: nothing to notify.
                if (! listener)
                    return;
                const jsi::Value args[] = { jsi::Value(double(index)), jsi::Value(binding->host->value(index)) };
                bind::call(state, *listener, jsi::Value::undefined(), args, "soundor:parameters dispatch failed");
            });
        return changed;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
