#include "Internal.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    namespace
    {
        // Reads `object[name]` as a string, or "" when absent or unconvertible.
        std::string stringProperty(JSContext* ctx, JSValueConst object, const char* name)
        {
            JSValue property = JS_GetPropertyStr(ctx, object, name);
            std::string result;
            if (JS_IsException(property))
                JS_FreeValue(ctx, JS_GetException(ctx));
            else if (! JS_IsUndefined(property) && ! JS_IsNull(property))
                result = toStdString(ctx, property);
            JS_FreeValue(ctx, property);
            return result;
        }
    } // namespace

    std::string toStdString(JSContext* ctx, JSValueConst value)
    {
        std::size_t length = 0;
        const char* chars = JS_ToCStringLen(ctx, &length, value);
        if (chars == nullptr)
        {
            // e.g. a Symbol, or an object whose toString() throws.
            JS_FreeValue(ctx, JS_GetException(ctx));
            return JS_IsSymbol(value) ? "Symbol()" : "[unconvertible value]";
        }
        std::string result(chars, length);
        JS_FreeCString(ctx, chars);
        return result;
    }

    Value toValue(JSContext* ctx, JSValueConst value)
    {
        if (JS_IsUndefined(value) || JS_IsUninitialized(value))
            return Value::undefined();
        if (JS_IsNull(value))
            return Value::null();
        if (JS_IsBool(value))
            return Value::boolean(JS_ToBool(ctx, value) != 0);
        if (JS_IsNumber(value))
        {
            double number = 0.0;
            JS_ToFloat64(ctx, &number, value);
            return Value::number(number);
        }
        if (JS_IsString(value))
            return Value::string(toStdString(ctx, value));
        return Value::other(toStdString(ctx, value));
    }

    Error toError(JSContext* ctx, JSValueConst thrown)
    {
        if (JS_IsError(thrown))
        {
            return Error {
                stringProperty(ctx, thrown, "name"),
                stringProperty(ctx, thrown, "message"),
                stringProperty(ctx, thrown, "stack"),
            };
        }
        // `throw 42`, `throw "text"`, `throw { ... }`: no name, no stack.
        return Error { {}, toStdString(ctx, thrown), {} };
    }

    Error takeException(JSContext* ctx)
    {
        JSValue exception = JS_GetException(ctx);
        Error error = toError(ctx, exception);
        JS_FreeValue(ctx, exception);
        return error;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
