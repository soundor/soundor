#include "js/Bindings.h"
#include "modules/Embedded.h"

#include <soundor/parameters/Parameters.h>

#include <algorithm>
#include <cmath>
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

        Binding* bindingOf(JSContext* ctx)
        {
            return bind::contextData<Binding>(ctx, &bindingKey);
        }

        // Reads the parameter index argument, validating it against the host.
        bool readIndex(JSContext* ctx, const Binding& binding, JSValueConst value, std::size_t& index)
        {
            double number = 0;
            if (! JS_IsNumber(value) || JS_ToFloat64(ctx, &number, value) < 0 || number < 0
                || number >= double(binding.gestures.size()) || std::floor(number) != number)
            {
                JS_ThrowRangeError(ctx, "invalid parameter index");
                return false;
            }
            index = static_cast<std::size_t>(number);
            return true;
        }

        // The JavaScript layer guarantees argument shapes; these validations
        // only protect the native side.
        template <typename Body>
        JSValue withIndex(JSContext* ctx, int argc, JSValueConst* argv, Body&& body)
        {
            auto* binding = bindingOf(ctx);
            if (binding == nullptr)
                return JS_ThrowInternalError(ctx, "soundor:parameters is not installed in this context");
            std::size_t index = 0;
            if (argc < 1 || ! readIndex(ctx, *binding, argv[0], index))
                return JS_EXCEPTION;
            return body(*binding, index);
        }

        JSValue getValue(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return withIndex(ctx, argc, argv, [&](Binding& binding, std::size_t index)
                             { return JS_NewFloat64(ctx, binding.host->value(index)); });
        }

        JSValue setValue(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return withIndex(ctx, argc, argv,
                             [&](Binding& binding, std::size_t index) -> JSValue
                             {
                                 double value = 0;
                                 if (argc < 2 || JS_ToFloat64(ctx, &value, argv[1]) < 0 || std::isnan(value))
                                     return JS_ThrowTypeError(ctx, "invalid parameter value");
                                 binding.host->setValue(index, constrain(binding.host->infos()[index], value));
                                 return JS_UNDEFINED;
                             });
        }

        JSValue beginGesture(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return withIndex(ctx, argc, argv,
                             [&](Binding& binding, std::size_t index)
                             {
                                 int& depth = binding.gestures[index];
                                 if (depth == 0)
                                     binding.host->beginGesture(index);
                                 ++depth;
                                 return JS_UNDEFINED;
                             });
        }

        JSValue endGesture(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return withIndex(ctx, argc, argv,
                             [&](Binding& binding, std::size_t index)
                             {
                                 // An unmatched endGesture() is ignored rather than
                                 // unbalancing the host.
                                 int& depth = binding.gestures[index];
                                 if (depth == 0)
                                     return JS_UNDEFINED;
                                 --depth;
                                 if (depth == 0)
                                     binding.host->endGesture(index);
                                 return JS_UNDEFINED;
                             });
        }

        JSValue setListener(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1 || ! JS_IsFunction(ctx, argv[0]))
                return JS_ThrowTypeError(ctx, "setListener() expects a function");
            bind::retainValue(ctx, &listenerKey, JS_DupValue(ctx, argv[0]));
            return JS_UNDEFINED;
        }

        JSValue reportError(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (auto* state = js::detail::contextStateOf(ctx); state != nullptr && argc > 0)
            {
                const js::Error error = js::detail::toError(ctx, argv[0]);
                std::string message = "soundor:parameters subscriber threw: " + error.toString();
                if (! error.stack.empty())
                    message += "\n" + error.stack;
                state->runtime->log(js::LogLevel::Error, message);
            }
            return JS_UNDEFINED;
        }

        JSValue makeInfos(JSContext* ctx, std::span<const Info> infos)
        {
            JSValue array = JS_NewArray(ctx);
            if (JS_IsException(array))
                return array;
            for (std::size_t index = 0; index < infos.size(); ++index)
            {
                const Info& info = infos[index];
                bind::ObjectBuilder object(ctx);
                object.set("id", bind::write(ctx, info.id));
                object.set("label", bind::write(ctx, info.label));
                object.set("kind", JS_NewInt32(ctx, static_cast<int>(info.kind)));
                object.set("min", bind::write(ctx, info.min));
                object.set("max", bind::write(ctx, info.max));
                object.set("default", bind::write(ctx, info.defaultValue));
                object.set("unit", bind::write(ctx, info.unit));
                object.set("choices",
                           bind::writeArray(ctx, std::vector<std::string>(info.choices),
                                            [](JSContext* c, std::string&& choice) { return bind::write(c, choice); }));
                JSValue entry = object.release();
                if (JS_IsException(entry)
                    || JS_SetPropertyUint32(ctx, array, static_cast<std::uint32_t>(index), entry) < 0)
                {
                    JS_FreeValue(ctx, array);
                    return JS_EXCEPTION;
                }
            }
            return array;
        }

        bool initializeInternalModule(JSContext* ctx, JSModuleDef* module)
        {
            auto* binding = bindingOf(ctx);
            if (binding == nullptr)
            {
                JS_ThrowInternalError(ctx, "soundor:parameters is not installed in this context");
                return false;
            }
            const auto exportFunction = [&](const char* name, JSCFunction* function, int length)
            { return JS_SetModuleExport(ctx, module, name, JS_NewCFunction(ctx, function, name, length)) == 0; };
            return JS_SetModuleExport(ctx, module, "infos", makeInfos(ctx, binding->host->infos())) == 0
                   && exportFunction("get", getValue, 1) && exportFunction("set", setValue, 2)
                   && exportFunction("beginGesture", beginGesture, 1) && exportFunction("endGesture", endGesture, 1)
                   && exportFunction("setListener", setListener, 1) && exportFunction("reportError", reportError, 1);
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
        js::registerNativeModule(
            context, "soundor:internal/parameters",
            { { "infos", "get", "set", "beginGesture", "endGesture", "setListener", "reportError" },
              initializeInternalModule,
              {} });
        js::registerNativeModule(context, "soundor:parameters", { {}, {}, embedded::parametersModule });
    }

    std::size_t dispatchChanges(js::Context& context)
    {
        JSContext* ctx = js::rawContext(context);
        auto& state = js::stateOf(context);
        auto* binding = bindingOf(ctx);
        if (binding == nullptr)
            return 0;
        state.runtime->enter();

        std::size_t changed = 0;
        // Held for the whole dispatch: a subscriber may replace the listener.
        JSValue listener = JS_DupValue(ctx, bind::retainedValue(ctx, &listenerKey));
        binding->host->changes().drain(
            [&](std::size_t index)
            {
                ++changed;
                // Nobody imported soundor:parameters yet: nothing to notify.
                if (! JS_IsFunction(ctx, listener))
                    return;
                JSValue args[] = { JS_NewFloat64(ctx, double(index)), JS_NewFloat64(ctx, binding->host->value(index)) };
                JSValue result = JS_Call(ctx, listener, JS_UNDEFINED, 2, args);
                if (JS_IsException(result))
                    state.runtime->log(js::LogLevel::Error, "soundor:parameters dispatch failed: "
                                                                + js::detail::takeException(ctx).toString());
                JS_FreeValue(ctx, result);
            });
        JS_FreeValue(ctx, listener);
        return changed;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
