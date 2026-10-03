#include "Bindings.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstring>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    namespace
    {
        // A short description of a value's type for error messages.
        std::string describeType(JSContext* ctx, JSValueConst value)
        {
            if (JS_IsUndefined(value))
                return "undefined";
            if (JS_IsNull(value))
                return "null";
            if (JS_IsBool(value))
                return "boolean";
            if (JS_IsNumber(value))
                return "number";
            if (JS_IsString(value))
                return "string";
            if (JS_IsBigInt(value))
                return "bigint";
            if (JS_IsSymbol(value))
                return "symbol";
            if (JS_IsFunction(ctx, value))
                return "function";
            if (JS_IsArray(value))
                return "array";
            if (JS_IsArrayBuffer(value))
                return "ArrayBuffer";
            if (JS_GetTypedArrayType(value) >= 0)
                return "typed array";
            return "object";
        }

        // Borrows the bytes of a typed array of exactly `type`.
        bool readTypedArray(JSContext* ctx, JSValueConst value, const Path& path, JSTypedArrayEnum type,
                            std::string_view typeName, const std::uint8_t*& data, std::size_t& byteLength)
        {
            if (JS_GetTypedArrayType(value) != static_cast<int>(type))
            {
                throwTypeMismatch(ctx, path, typeName, value);
                return false;
            }
            std::size_t offset = 0;
            std::size_t length = 0;
            JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &length, nullptr);
            if (JS_IsException(buffer))
                return false;
            std::size_t bufferSize = 0;
            const std::uint8_t* bytes = JS_GetArrayBuffer(ctx, &bufferSize, buffer);
            JS_FreeValue(ctx, buffer);
            // Null with an exception means detached; null without one is an
            // empty buffer.
            if (bytes == nullptr && JS_HasException(ctx))
                return false;
            data = bytes != nullptr ? bytes + offset : nullptr;
            byteLength = length;
            return true;
        }

        template <typename T>
        bool readTypedSpan(JSContext* ctx, JSValueConst value, const Path& path, JSTypedArrayEnum type,
                           std::string_view typeName, std::span<const T>& out)
        {
            const std::uint8_t* data = nullptr;
            std::size_t byteLength = 0;
            if (! readTypedArray(ctx, value, path, type, typeName, data, byteLength))
                return false;
            // Typed-array element views are always aligned to the element size.
            out = std::span<const T>(reinterpret_cast<const T*>(data), byteLength / sizeof(T));
            return true;
        }

        // Frees a std::vector that backs an ArrayBuffer once JavaScript drops it.
        template <typename T>
        void* releaseVector(JSRuntime*, void* opaque, void*, std::size_t size)
        {
            if (size == 0)
                delete static_cast<std::vector<T>*>(opaque);
            // Fixed-length buffers are never resized; refusing is reported as
            // out of memory by the engine.
            return nullptr;
        }

        template <typename T>
        JSValue writeBuffer(JSContext* ctx, std::vector<T>&& values, bool typed, JSTypedArrayEnum type)
        {
            JSValue buffer = JS_UNDEFINED;
            if (values.empty())
            {
                buffer = JS_NewArrayBufferCopy(ctx, nullptr, 0);
            }
            else
            {
                auto* owned = new std::vector<T>(std::move(values));
                buffer = JS_NewArrayBuffer(ctx, reinterpret_cast<std::uint8_t*>(owned->data()),
                                           owned->size() * sizeof(T), 0, releaseVector<T>, owned, false);
                if (JS_IsException(buffer))
                {
                    delete owned;
                    return buffer;
                }
            }
            if (! typed || JS_IsException(buffer))
                return buffer;
            JSValue array = JS_NewTypedArray(ctx, 1, &buffer, type);
            JS_FreeValue(ctx, buffer);
            return array;
        }
    } // namespace

    std::string Path::toString() const
    {
        std::vector<const Path*> chain;
        for (const Path* node = this; node != nullptr; node = node->parent)
            chain.push_back(node);
        std::reverse(chain.begin(), chain.end());

        std::string text = std::string(chain.front()->name != nullptr ? chain.front()->name : "?") + "()";
        for (std::size_t i = 1; i < chain.size(); ++i)
        {
            const Path& node = *chain[i];
            if (node.name == nullptr)
                text += "[" + std::to_string(node.index) + "]";
            else
                text += (i == 1 ? ": " : ".") + std::string(node.name);
        }
        return text;
    }

    void throwTypeMismatch(JSContext* ctx, const Path& path, std::string_view expected, JSValueConst actual)
    {
        const std::string message =
            path.toString() + ": expected " + std::string(expected) + ", got " + describeType(ctx, actual);
        JS_ThrowTypeError(ctx, "%s", message.c_str());
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, bool& out)
    {
        if (! JS_IsBool(value))
        {
            throwTypeMismatch(ctx, path, "boolean", value);
            return false;
        }
        out = JS_ToBool(ctx, value) != 0;
        return true;
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, double& out)
    {
        if (! JS_IsNumber(value))
        {
            throwTypeMismatch(ctx, path, "number", value);
            return false;
        }
        return JS_ToFloat64(ctx, &out, value) == 0;
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::string& out)
    {
        if (! JS_IsString(value))
        {
            throwTypeMismatch(ctx, path, "string", value);
            return false;
        }
        std::size_t length = 0;
        const char* chars = JS_ToCStringLen(ctx, &length, value);
        if (chars == nullptr)
            return false;
        out.assign(chars, length);
        JS_FreeCString(ctx, chars);
        return true;
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::byte>& out)
    {
        if (! JS_IsArrayBuffer(value))
        {
            throwTypeMismatch(ctx, path, "ArrayBuffer", value);
            return false;
        }
        std::size_t size = 0;
        const std::uint8_t* bytes = JS_GetArrayBuffer(ctx, &size, value);
        if (bytes == nullptr && JS_HasException(ctx)) // detached
            return false;
        out = std::span<const std::byte>(reinterpret_cast<const std::byte*>(bytes), size);
        return true;
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::uint8_t>& out)
    {
        return readTypedSpan(ctx, value, path, JS_TYPED_ARRAY_UINT8, "Uint8Array", out);
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::int32_t>& out)
    {
        return readTypedSpan(ctx, value, path, JS_TYPED_ARRAY_INT32, "Int32Array", out);
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const float>& out)
    {
        return readTypedSpan(ctx, value, path, JS_TYPED_ARRAY_FLOAT32, "Float32Array", out);
    }

    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const double>& out)
    {
        return readTypedSpan(ctx, value, path, JS_TYPED_ARRAY_FLOAT64, "Float64Array", out);
    }

    bool readEnum(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::string_view> values,
                  std::size_t& index)
    {
        std::string text;
        const bool isString = JS_IsString(value);
        if (isString && ! read(ctx, value, path, text))
            return false;
        const auto it = std::find(values.begin(), values.end(), text);
        if (isString && it != values.end())
        {
            index = static_cast<std::size_t>(it - values.begin());
            return true;
        }
        std::string expected = "one of ";
        for (std::size_t i = 0; i < values.size(); ++i)
            expected += (i > 0 ? ", '" : "'") + std::string(values[i]) + "'";
        if (isString)
        {
            const std::string message = path.toString() + ": expected " + expected + ", got '" + text + "'";
            JS_ThrowTypeError(ctx, "%s", message.c_str());
        }
        else
        {
            throwTypeMismatch(ctx, path, expected, value);
        }
        return false;
    }

    bool expectObject(JSContext* ctx, JSValueConst value, const Path& path)
    {
        if (JS_IsObject(value) && ! JS_IsArray(value) && ! JS_IsFunction(ctx, value))
            return true;
        throwTypeMismatch(ctx, path, "object", value);
        return false;
    }

    bool expectArray(JSContext* ctx, JSValueConst value, const Path& path, std::size_t& length)
    {
        if (! JS_IsArray(value))
        {
            throwTypeMismatch(ctx, path, "array", value);
            return false;
        }
        std::int64_t size = 0;
        if (JS_GetLength(ctx, value, &size) < 0)
            return false;
        length = static_cast<std::size_t>(size);
        return true;
    }

    Field::Field(JSContext* context, JSValueConst object, const char* name, const Path& parent)
        : ctx(context), property(JS_GetPropertyStr(context, object, name)), fieldPath(parent.field(name))
    {
    }

    Field::~Field()
    {
        JS_FreeValue(ctx, property);
    }

    JSValue write(JSContext* ctx, bool value)
    {
        return JS_NewBool(ctx, value);
    }

    JSValue write(JSContext* ctx, double value)
    {
        return JS_NewFloat64(ctx, value);
    }

    JSValue write(JSContext* ctx, const std::string& value)
    {
        return JS_NewStringLen(ctx, value.data(), value.size());
    }

    JSValue write(JSContext* ctx, std::vector<std::byte>&& value)
    {
        return writeBuffer(ctx, std::move(value), false, JS_TYPED_ARRAY_UINT8);
    }

    JSValue write(JSContext* ctx, std::vector<std::uint8_t>&& value)
    {
        return writeBuffer(ctx, std::move(value), true, JS_TYPED_ARRAY_UINT8);
    }

    JSValue write(JSContext* ctx, std::vector<std::int32_t>&& value)
    {
        return writeBuffer(ctx, std::move(value), true, JS_TYPED_ARRAY_INT32);
    }

    JSValue write(JSContext* ctx, std::vector<float>&& value)
    {
        return writeBuffer(ctx, std::move(value), true, JS_TYPED_ARRAY_FLOAT32);
    }

    JSValue write(JSContext* ctx, std::vector<double>&& value)
    {
        return writeBuffer(ctx, std::move(value), true, JS_TYPED_ARRAY_FLOAT64);
    }

    JSValue writeEnum(JSContext* ctx, std::string_view value)
    {
        return JS_NewStringLen(ctx, value.data(), value.size());
    }

    ObjectBuilder::ObjectBuilder(JSContext* context) : ctx(context), object(JS_NewObject(context)) {}

    ObjectBuilder::~ObjectBuilder()
    {
        JS_FreeValue(ctx, object);
    }

    void ObjectBuilder::set(const char* name, JSValue value)
    {
        if (JS_IsException(object))
        {
            JS_FreeValue(ctx, value);
            return;
        }
        if (JS_IsException(value) || JS_SetPropertyStr(ctx, object, name, value) < 0)
        {
            JS_FreeValue(ctx, object);
            object = JS_EXCEPTION;
        }
    }

    JSValue ObjectBuilder::release()
    {
        return std::exchange(object, JS_UNDEFINED);
    }

    bool readHandle(JSContext* ctx, JSValueConst value, const Path& path, const HandleType& type,
                    std::shared_ptr<void>& out)
    {
        const auto* state = detail::contextStateOf(ctx);
        auto* box = state != nullptr
                        ? static_cast<detail::HandleBox*>(JS_GetOpaque(value, state->runtime->handleClassId))
                        : nullptr;
        if (box == nullptr || box->type != &type)
        {
            throwTypeMismatch(ctx, path, type.name, value);
            return false;
        }
        out = box->object;
        return true;
    }

    JSValue writeHandle(JSContext* ctx, const HandleType& type, std::shared_ptr<void> object)
    {
        if (object == nullptr)
            return JS_ThrowTypeError(ctx, "native code returned an empty %s handle", type.name);
        const auto* state = detail::contextStateOf(ctx);
        if (state == nullptr)
            return JS_ThrowInternalError(ctx, "Soundor context destroyed");
        JSValue handle = JS_NewObjectClass(ctx, state->runtime->handleClassId);
        if (JS_IsException(handle))
            return handle;
        JS_SetOpaque(handle, new detail::HandleBox { &type, std::move(object) });
        return handle;
    }

    bool expectArgumentCount(JSContext* ctx, const char* method, int argc, int expected)
    {
        // Extra arguments are ignored, as for any JavaScript function, so idioms
        // like `items.map(native.method)` work.
        if (argc >= expected)
            return true;
        JS_ThrowTypeError(ctx, "%s() expects %d argument%s, got %d", method, expected, expected == 1 ? "" : "s", argc);
        return false;
    }

    JSValue throwNativeException(JSContext* ctx, const char* method, const std::exception& error)
    {
        JSValue exception = JS_NewError(ctx);
        if (JS_IsException(exception))
            return exception;
        const std::string message = std::string(method) + "(): " + error.what();
        JS_SetPropertyStr(ctx, exception, "message", JS_NewStringLen(ctx, message.data(), message.size()));
        return JS_Throw(ctx, exception);
    }

    void setContextData(Context& context, const void* key, std::shared_ptr<void> data)
    {
        auto& entries = stateOf(context).moduleData;
        const auto it =
            std::find_if(entries.begin(), entries.end(), [key](const auto& entry) { return entry.first == key; });
        if (it != entries.end())
            it->second = std::move(data);
        else
            entries.emplace_back(key, std::move(data));
    }

    void* contextData(JSContext* ctx, const void* key)
    {
        auto* state = detail::contextStateOf(ctx);
        if (state == nullptr)
            return nullptr;
        for (const auto& [entryKey, data] : state->moduleData)
            if (entryKey == key)
                return data.get();
        return nullptr;
    }

    void retainValue(JSContext* ctx, const void* key, JSValue value)
    {
        auto* state = detail::contextStateOf(ctx);
        if (state == nullptr)
        {
            JS_FreeValue(ctx, value);
            return;
        }
        for (auto& [entryKey, entryValue] : state->retainedValues)
        {
            if (entryKey == key)
            {
                JS_FreeValue(ctx, std::exchange(entryValue, value));
                return;
            }
        }
        state->retainedValues.emplace_back(key, value);
    }

    JSValueConst retainedValue(JSContext* ctx, const void* key)
    {
        if (const auto* state = detail::contextStateOf(ctx))
            for (const auto& [entryKey, value] : state->retainedValues)
                if (entryKey == key)
                    return value;
        return JS_UNDEFINED;
    }

    JSValue newPromise(JSContext* ctx, const char* method, std::shared_ptr<detail::PendingPromise>& pending)
    {
        auto* state = detail::contextStateOf(ctx);
        if (state == nullptr)
            return JS_ThrowInternalError(ctx, "Soundor context destroyed");
        JSValue functions[2];
        JSValue promise = JS_NewPromiseCapability(ctx, functions);
        if (JS_IsException(promise))
            return promise;
        pending = std::make_shared<detail::PendingPromise>(*state, method, functions[0], functions[1]);
        return promise;
    }

    void resolvePromiseWithUndefined(detail::PendingPromise& pending)
    {
        resolvePromise(pending, [](JSContext*) { return JS_UNDEFINED; });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    PendingPromise::PendingPromise(ContextState& context, std::string methodName, JSValue resolve, JSValue reject)
        : owner(&context), method(std::move(methodName)), resolveFunction(resolve), rejectFunction(reject)
    {
        owner->pendingPromises.push_back(this);
    }

    PendingPromise::~PendingPromise()
    {
        // Every js::Promise copy is gone and nobody settled it: reject rather
        // than leave JavaScript waiting forever.
        if (owner != nullptr)
            rejectPromise(*this, "the native implementation finished without settling its promise");
    }

    void PendingPromise::settle(bool fulfilled, JSValue value)
    {
        // Callers check activeContext() before creating `value`.
        JSContext* ctx = activeContext();
        assert(ctx != nullptr);
        owner->runtime->assertOwnerThread();
        JSValue result = JS_Call(ctx, fulfilled ? resolveFunction : rejectFunction, JS_UNDEFINED, 1, &value);
        JS_FreeValue(ctx, value);
        JS_FreeValue(ctx, result);
        orphan();
    }

    void PendingPromise::orphan() noexcept
    {
        if (owner == nullptr)
            return;
        JSRuntime* rt = owner->runtime->rt;
        JS_FreeValueRT(rt, resolveFunction);
        JS_FreeValueRT(rt, rejectFunction);
        std::erase(owner->pendingPromises, this);
        owner = nullptr;
    }

    void rejectPromise(PendingPromise& pending, const std::string& message)
    {
        JSContext* ctx = pending.activeContext();
        if (ctx == nullptr)
            return;
        pending.owner->runtime->enter();
        JSValue error = JS_NewError(ctx);
        if (! JS_IsException(error))
        {
            const std::string text = pending.method + "(): " + message;
            JS_SetPropertyStr(ctx, error, "message", JS_NewStringLen(ctx, text.data(), text.size()));
        }
        else
        {
            error = JS_GetException(ctx);
        }
        pending.settle(false, error);
    }

    bool isPromisePending(const PendingPromise& pending) noexcept
    {
        return pending.owner != nullptr;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
