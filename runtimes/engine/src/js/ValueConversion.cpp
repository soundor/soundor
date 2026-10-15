#include "Internal.h"

#include <hermes/Public/JSOutOfMemoryError.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    namespace
    {
        // Reads `object[name]` as a string, or "" when absent or unconvertible.
        std::string stringProperty(ContextState& context, const jsi::Object& object, const char* name)
        {
            try
            {
                const jsi::Value property = object.getProperty(context.rt, context.name(name));
                if (property.isUndefined() || property.isNull())
                    return {};
                return toStdString(context.rt, property);
            }
            catch (const ::hermes::vm::JSOutOfMemoryError&)
            {
                throw;
            }
            catch (...)
            {
                return {};
            }
        }

        // Hermes's stacks start with the error's "Name: message" line; Soundor's
        // Error::stack is the frames alone, as Error::toString() says the rest.
        std::string framesOf(const std::string& stack)
        {
            const std::size_t frames = stack.find("\n    at ");
            if (frames == std::string::npos)
                return stack.starts_with("    at ") ? stack : std::string();
            return stack.substr(frames + 1);
        }
    } // namespace

    std::string toStdString(jsi::Runtime& rt, const jsi::Value& value)
    {
        try
        {
            if (value.isString())
                return value.getString(rt).utf8(rt);
            return value.toString(rt).utf8(rt);
        }
        catch (const ::hermes::vm::JSOutOfMemoryError&)
        {
            throw;
        }
        catch (...)
        {
            // e.g. an object whose toString() throws.
            return "[unconvertible value]";
        }
    }

    Value toValue(jsi::Runtime& rt, const jsi::Value& value)
    {
        if (value.isUndefined())
            return Value::undefined();
        if (value.isNull())
            return Value::null();
        if (value.isBool())
            return Value::boolean(value.getBool());
        if (value.isNumber())
            return Value::number(value.getNumber());
        if (value.isString())
            return Value::string(toStdString(rt, value));
        return Value::other(toStdString(rt, value));
    }

    Error toError(ContextState& context, const jsi::Value& thrown)
    {
        jsi::Runtime& rt = context.rt;
        try
        {
            if (thrown.isObject() && context.intrinsics.has_value())
            {
                const jsi::Object object = thrown.getObject(rt);
                if (object.instanceOf(rt, context.builtins().error))
                {
                    return Error {
                        stringProperty(context, object, "name"),
                        stringProperty(context, object, "message"),
                        framesOf(stringProperty(context, object, "stack")),
                    };
                }
            }
        }
        catch (const ::hermes::vm::JSOutOfMemoryError&)
        {
            throw;
        }
        catch (...) // NOLINT(bugprone-empty-catch): reported below as a value
        {
            // A hostile prototype chain (a Proxy that throws): not an Error.
        }
        // `throw 42`, `throw "text"`, `throw { ... }`: no name, no stack.
        return Error { {}, toStdString(rt, thrown), {} };
    }

    namespace
    {
        // The engine's TimeoutError: thrown only by the time limit, since
        // JavaScript cannot reach its constructor (Context.cpp).
        bool isTimeout(ContextState& context, const jsi::Value& thrown)
        {
            return context.intrinsics.has_value() && thrown.isObject()
                   && thrown.getObject(context.rt).instanceOf(context.rt, context.builtins().timeoutError);
        }
    } // namespace

    Error caughtError(ContextState& context)
    {
        try
        {
            throw;
        }
        catch (const jsi::JSError& error)
        {
            try
            {
                if (isTimeout(context, error.value()))
                {
                    // Stopped at the time limit. Anything still on the stack
                    // (JavaScript that called the native code that caught
                    // this) is stopped too, at its next check: the engine
                    // breaks again.
                    context.halt = Halt::TimedOut;
                    context.hermes->asyncTriggerTimeout();
                    Error stopped = context.haltedError();
                    stopped.stack = toError(context, error.value()).stack;
                    return stopped;
                }
                return toError(context, error.value());
            }
            catch (const ::hermes::vm::JSOutOfMemoryError&)
            {
                context.halt = Halt::OutOfMemory;
                return Error { "InternalError", "out of memory", {} };
            }
        }
        catch (const ::hermes::vm::JSOutOfMemoryError&)
        {
            // Hermes cannot run anything in this runtime any more.
            context.halt = Halt::OutOfMemory;
            return context.haltedError();
        }
        catch (const jsi::JSINativeException& error)
        {
            // Hermes reports source it cannot compile this way.
            const std::string_view message = error.what();
            if (message.starts_with("Compiling JS failed"))
                return Error { "SyntaxError", std::string(message), {} };
            return Error { "InternalError", std::string(message), {} };
        }
        catch (const std::bad_alloc&)
        {
            return Error { "InternalError", "out of memory", {} };
        }
        catch (const std::exception& error)
        {
            return Error { "InternalError", error.what(), {} };
        }
        catch (...)
        {
            return Error { "InternalError", "unknown native exception", {} };
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
