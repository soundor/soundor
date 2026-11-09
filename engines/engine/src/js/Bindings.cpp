#include "Bindings.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstring>
#include <limits>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    namespace
    {
        using facebook::hermes::soundor::BufferView;
        using facebook::hermes::soundor::TypedArrayKind;

        // An Error object made with one of the context's constructors.
        jsi::Value construct(ContextState& context, const jsi::Function& constructor, std::string_view message)
        {
            return constructor.callAsConstructor(
                context.rt, jsi::String::createFromUtf8(
                                context.rt, reinterpret_cast<const std::uint8_t*>(message.data()), message.size()));
        }

        // Borrows the bytes of a typed array of exactly `kind`.
        BufferView readTypedArray(ContextState& context, const jsi::Value& value, const Path& path, TypedArrayKind kind,
                                  std::string_view typeName)
        {
            BufferView view;
            if (! bufferView(context, value, view) || view.kind != kind)
                throwTypeMismatch(context, path, typeName, value);
            if (view.detached)
                throwTypeError(context, "ArrayBuffer is detached");
            return view;
        }

        template <typename T>
        void readTypedSpan(ContextState& context, const jsi::Value& value, const Path& path, TypedArrayKind kind,
                           std::string_view typeName, std::span<const T>& out)
        {
            const BufferView view = readTypedArray(context, value, path, kind, typeName);
            // Typed-array element views are always aligned to the element size.
            out = std::span<const T>(reinterpret_cast<const T*>(view.data), view.byteLength / sizeof(T));
        }

        // A std::vector that backs an ArrayBuffer, freed when JavaScript drops
        // the buffer.
        template <typename T>
        struct VectorBuffer final : jsi::MutableBuffer
        {
            explicit VectorBuffer(std::vector<T>&& owned) : values(std::move(owned)) {}

            [[nodiscard]] std::size_t size() const override { return values.size() * sizeof(T); }
            std::uint8_t* data() override { return reinterpret_cast<std::uint8_t*>(values.data()); }

            std::vector<T> values;
        };

        template <typename T>
        jsi::ArrayBuffer ownedArrayBuffer(ContextState& context, std::vector<T>&& values)
        {
            return jsi::ArrayBuffer(context.rt, std::make_shared<VectorBuffer<T>>(std::move(values)));
        }

        template <typename T>
        jsi::Value writeTypedArray(ContextState& context, std::vector<T>&& values, const jsi::Function& constructor)
        {
            const jsi::ArrayBuffer buffer = ownedArrayBuffer(context, std::move(values));
            return constructor.callAsConstructor(context.rt, buffer);
        }

        // "<path>: <value> is out of range for <type> (<min> to <max>)".
        [[noreturn]] void throwOutOfRange(ContextState& context, const Path& path, const jsi::Value& value,
                                          std::string_view typeName, std::string_view range)
        {
            std::string message =
                path.toString() + ": " + toString(context, value) + " is out of range for " + std::string(typeName);
            if (! range.empty())
                message += " (" + std::string(range) + ")";
            throwRangeError(context, message);
        }

        // An integer of up to 32 bits, from a number that is one, in range.
        template <typename T>
        void readSmallInteger(ContextState& context, const jsi::Value& value, const Path& path,
                              std::string_view typeName, T& out)
        {
            static_assert(sizeof(T) <= 4, "exactly representable as a double");
            if (! value.isNumber())
                throwTypeMismatch(context, path, typeName, value);
            const double number = value.getNumber();
            if (! std::isfinite(number) || std::trunc(number) != number)
                throwTypeError(context, path.toString() + ": expected an integer (" + std::string(typeName) + "), got "
                                            + toString(context, value));
            constexpr auto min = std::numeric_limits<T>::min();
            constexpr auto max = std::numeric_limits<T>::max();
            if (number < static_cast<double>(min) || number > static_cast<double>(max))
                throwOutOfRange(context, path, value, typeName,
                                std::to_string(static_cast<long long>(min)) + " to "
                                    + std::to_string(static_cast<long long>(max)));
            out = static_cast<T>(number);
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

    jsi::Value makeError(ContextState& context, std::string_view message)
    {
        return construct(context, context.builtins().error, message);
    }

    jsi::Value makeTypeError(ContextState& context, std::string_view message)
    {
        return construct(context, context.builtins().typeError, message);
    }

    jsi::Value makeRangeError(ContextState& context, std::string_view message)
    {
        return construct(context, context.builtins().rangeError, message);
    }

    void throwError(ContextState& context, std::string_view message)
    {
        throw jsi::JSError(context.rt, makeError(context, message));
    }

    void throwTypeError(ContextState& context, std::string_view message)
    {
        throw jsi::JSError(context.rt, makeTypeError(context, message));
    }

    void throwRangeError(ContextState& context, std::string_view message)
    {
        throw jsi::JSError(context.rt, makeRangeError(context, message));
    }

    void throwInternalError(ContextState& context, std::string_view message)
    {
        jsi::Value error = makeError(context, message);
        setProperty(context, error.getObject(context.rt), "name",
                    jsi::String::createFromAscii(context.rt, "InternalError"));
        throw jsi::JSError(context.rt, std::move(error));
    }

    double toNumber(ContextState& context, const jsi::Value& value)
    {
        if (value.isNumber())
            return value.getNumber();
        if (value.isBool())
            return value.getBool() ? 1.0 : 0.0;
        if (value.isUndefined())
            return std::numeric_limits<double>::quiet_NaN();
        if (value.isNull())
            return 0.0;
        return context.builtins().number.call(context.rt, value).getNumber();
    }

    std::int32_t toInt32(ContextState& context, const jsi::Value& value)
    {
        return static_cast<std::int32_t>(toUint32(context, value));
    }

    std::uint32_t toUint32(ContextState& context, const jsi::Value& value)
    {
        const double number = toNumber(context, value);
        if (! std::isfinite(number))
            return 0;
        const double wrapped = std::fmod(std::trunc(number), 4294967296.0);
        return static_cast<std::uint32_t>(static_cast<std::int64_t>(wrapped < 0 ? wrapped + 4294967296.0 : wrapped));
    }

    bool toBoolean(ContextState& context, const jsi::Value& value)
    {
        if (value.isBool())
            return value.getBool();
        if (value.isNumber())
        {
            const double number = value.getNumber();
            return number != 0 && ! std::isnan(number);
        }
        if (value.isUndefined() || value.isNull())
            return false;
        if (value.isString())
            return value.getString(context.rt).length(context.rt) > 0;
        if (value.isBigInt())
        {
            const jsi::BigInt big = value.getBigInt(context.rt);
            return ! big.isInt64(context.rt) || big.asInt64(context.rt) != 0;
        }
        return true;
    }

    std::string toString(ContextState& context, const jsi::Value& value)
    {
        if (value.isString())
            return value.getString(context.rt).utf8(context.rt);
        return value.toString(context.rt).utf8(context.rt);
    }

    std::string describeType(ContextState& context, const jsi::Value& value)
    {
        if (value.isUndefined())
            return "undefined";
        if (value.isNull())
            return "null";
        if (value.isBool())
            return "boolean";
        if (value.isNumber())
            return "number";
        if (value.isString())
            return "string";
        if (value.isBigInt())
            return "bigint";
        if (value.isSymbol())
            return "symbol";
        const jsi::Object object = value.getObject(context.rt);
        if (object.isFunction(context.rt))
            return "function";
        if (object.isArray(context.rt))
            return "array";
        BufferView view;
        if (bufferView(context, value, view))
            return view.kind == TypedArrayKind::None ? "ArrayBuffer" : "typed array";
        return "object";
    }

    void throwTypeMismatch(ContextState& context, const Path& path, std::string_view expected, const jsi::Value& actual)
    {
        throwTypeError(context, path.toString() + ": expected " + std::string(expected) + ", got "
                                    + describeType(context, actual));
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, bool& out)
    {
        if (! value.isBool())
            throwTypeMismatch(context, path, "boolean", value);
        out = value.getBool();
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, double& out)
    {
        if (! value.isNumber())
            throwTypeMismatch(context, path, "number", value);
        out = value.getNumber();
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::int8_t& out)
    {
        readSmallInteger(context, value, path, "int8", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::uint8_t& out)
    {
        readSmallInteger(context, value, path, "uint8", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::int16_t& out)
    {
        readSmallInteger(context, value, path, "int16", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::uint16_t& out)
    {
        readSmallInteger(context, value, path, "uint16", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::int32_t& out)
    {
        readSmallInteger(context, value, path, "int32", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::uint32_t& out)
    {
        readSmallInteger(context, value, path, "uint32", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::int64_t& out)
    {
        if (! value.isBigInt())
            throwTypeMismatch(context, path, "int64", value);
        const jsi::BigInt big = value.getBigInt(context.rt);
        if (! big.isInt64(context.rt))
            throwOutOfRange(context, path, value, "int64", "-9223372036854775808 to 9223372036854775807");
        out = big.getInt64(context.rt);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::uint64_t& out)
    {
        if (! value.isBigInt())
            throwTypeMismatch(context, path, "uint64", value);
        const jsi::BigInt big = value.getBigInt(context.rt);
        if (! big.isUint64(context.rt))
            throwOutOfRange(context, path, value, "uint64", "0 to 18446744073709551615");
        out = big.getUint64(context.rt);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, float& out)
    {
        if (! value.isNumber())
            throwTypeMismatch(context, path, "float32", value);
        const double number = value.getNumber();
        // NaN and the infinities are floats too; a finite number from halfway
        // between the largest float and 2^128 on would round to infinity.
        constexpr double overflow = 0x1.ffffffp127;
        constexpr float largest = std::numeric_limits<float>::max();
        const bool finite = std::isfinite(number);
        if (finite && std::abs(number) >= overflow)
            throwOutOfRange(context, path, value, "float32", "");
        // Below that but beyond the largest float, a number rounds to it (a
        // cast would be undefined there).
        if (finite && std::abs(number) > static_cast<double>(largest))
            out = number > 0 ? largest : -largest;
        else
            out = static_cast<float>(number);
    }

    void readFloat64(ContextState& context, const jsi::Value& value, const Path& path, double& out)
    {
        if (! value.isNumber())
            throwTypeMismatch(context, path, "float64", value);
        out = value.getNumber();
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::string& out)
    {
        if (! value.isString())
            throwTypeMismatch(context, path, "string", value);
        out = value.getString(context.rt).utf8(context.rt);
    }

    bool bufferView(ContextState& context, const jsi::Value& value, BufferView& out) noexcept
    {
        return facebook::hermes::soundor::bufferView(context.rt, value, out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::byte>& out)
    {
        BufferView view;
        if (! bufferView(context, value, view) || view.kind != TypedArrayKind::None)
            throwTypeMismatch(context, path, "ArrayBuffer", value);
        if (view.detached)
            throwTypeError(context, "ArrayBuffer is detached");
        out = std::span<const std::byte>(reinterpret_cast<const std::byte*>(view.data), view.byteLength);
    }

    void readBytes(ContextState& context, const jsi::Value& value, const Path& path, std::span<std::byte>& out)
    {
        BufferView view;
        if (! bufferView(context, value, view))
            throwTypeMismatch(context, path, "ArrayBuffer or typed array", value);
        if (view.detached)
            throwTypeError(context, "ArrayBuffer is detached");
        out = std::span<std::byte>(reinterpret_cast<std::byte*>(view.data), view.byteLength);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::int8_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Int8, "Int8Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::uint8_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Uint8, "Uint8Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::int16_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Int16, "Int16Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::uint16_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Uint16, "Uint16Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::int32_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Int32, "Int32Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::uint32_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Uint32, "Uint32Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::int64_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::BigInt64, "BigInt64Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::uint64_t>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::BigUint64, "BigUint64Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const float>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Float32, "Float32Array", out);
    }

    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const double>& out)
    {
        readTypedSpan(context, value, path, TypedArrayKind::Float64, "Float64Array", out);
    }

    void readEnum(ContextState& context, const jsi::Value& value, const Path& path,
                  std::span<const std::string_view> values, std::size_t& index)
    {
        std::string text;
        const bool isString = value.isString();
        if (isString)
            read(context, value, path, text);
        const auto it = std::find(values.begin(), values.end(), text);
        if (isString && it != values.end())
        {
            index = static_cast<std::size_t>(it - values.begin());
            return;
        }
        std::string expected = "one of ";
        for (std::size_t i = 0; i < values.size(); ++i)
            expected += (i > 0 ? ", '" : "'") + std::string(values[i]) + "'";
        if (isString)
            throwTypeError(context, path.toString() + ": expected " + expected + ", got '" + text + "'");
        throwTypeMismatch(context, path, expected, value);
    }

    jsi::Object expectObject(ContextState& context, const jsi::Value& value, const Path& path)
    {
        if (value.isObject())
        {
            jsi::Object object = value.getObject(context.rt);
            if (! object.isArray(context.rt) && ! object.isFunction(context.rt))
                return object;
        }
        throwTypeMismatch(context, path, "object", value);
    }

    jsi::Array expectArray(ContextState& context, const jsi::Value& value, const Path& path)
    {
        if (value.isObject())
        {
            jsi::Object object = value.getObject(context.rt);
            if (object.isArray(context.rt))
                return std::move(object).getArray(context.rt);
        }
        throwTypeMismatch(context, path, "array", value);
    }

    jsi::Value write(ContextState& context, std::string_view value)
    {
        return jsi::String::createFromUtf8(context.rt, reinterpret_cast<const std::uint8_t*>(value.data()),
                                           value.size());
    }

    jsi::Value write(ContextState& context, std::vector<std::byte>&& value)
    {
        return ownedArrayBuffer(context, std::move(value));
    }

    jsi::Value write(ContextState& context, std::int64_t value)
    {
        return { context.rt, jsi::BigInt::fromInt64(context.rt, value) };
    }

    jsi::Value write(ContextState& context, std::uint64_t value)
    {
        return { context.rt, jsi::BigInt::fromUint64(context.rt, value) };
    }

    jsi::Value write(ContextState& context, std::vector<std::int8_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().int8Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::uint8_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().uint8Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::int16_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().int16Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::uint16_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().uint16Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::int32_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().int32Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::uint32_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().uint32Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::int64_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().bigInt64Array);
    }

    jsi::Value write(ContextState& context, std::vector<std::uint64_t>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().bigUint64Array);
    }

    jsi::Value write(ContextState& context, std::vector<float>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().float32Array);
    }

    jsi::Value write(ContextState& context, std::vector<double>&& value)
    {
        return writeTypedArray(context, std::move(value), context.builtins().float64Array);
    }

    jsi::Value writeEnum(ContextState& context, std::string_view value)
    {
        return write(context, value);
    }

    jsi::Function function(ContextState& context, const char* name, unsigned length, NativeFunction function)
    {
        return jsi::Function::createFromHostFunction(
            context.rt, context.name(name), length,
            [&context, function](jsi::Runtime&, const jsi::Value& thisValue, const jsi::Value* args, std::size_t count)
            { return function(context, thisValue, args, count); });
    }

    void expectArgumentCount(ContextState& context, const char* method, std::size_t count, std::size_t expected)
    {
        // Extra arguments are ignored, as for any JavaScript function, so idioms
        // like `items.map(native.method)` work.
        if (count >= expected)
            return;
        throwTypeError(context, std::string(method) + "() expects " + std::to_string(expected) + " argument"
                                    + (expected == 1 ? "" : "s") + ", got " + std::to_string(count));
    }

    void throwNativeException(ContextState& context, const char* method, const std::exception& error)
    {
        throwError(context, std::string(method) + "(): " + error.what());
    }

    bool call(ContextState& context, const jsi::Function& function, const jsi::Value& thisValue,
              std::span<const jsi::Value> args, std::string_view what)
    {
        if (context.halted())
            return false;
        const detail::JavaScriptCall entry(context);
        try
        {
            if (thisValue.isObject())
                function.callWithThis(context.rt, thisValue.getObject(context.rt), args.data(), args.size());
            else
                function.call(context.rt, args.data(), args.size());
            return true;
        }
        catch (...)
        {
            const Error error = detail::caughtError(context);
            std::string message = std::string(what) + ": " + error.toString();
            if (! error.stack.empty())
                message += "\n" + error.stack;
            context.runtime->log(LogLevel::Error, message);
            return false;
        }
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

    void* contextData(ContextState& context, const void* key)
    {
        for (const auto& [entryKey, data] : context.moduleData)
            if (entryKey == key)
                return data.get();
        return nullptr;
    }

    void retainValue(ContextState& context, const void* key, jsi::Value value)
    {
        for (auto& [entryKey, entryValue] : context.retainedValues)
        {
            if (entryKey == key)
            {
                entryValue = std::move(value);
                return;
            }
        }
        context.retainedValues.emplace_back(key, std::move(value));
    }

    const jsi::Value* retainedValue(ContextState& context, const void* key)
    {
        for (const auto& [entryKey, value] : context.retainedValues)
            if (entryKey == key)
                return &value;
        return nullptr;
    }

    jsi::Value newPromise(ContextState& context, const char* method, std::shared_ptr<detail::PendingPromise>& pending)
    {
        std::optional<jsi::Function> resolve;
        std::optional<jsi::Function> reject;
        // The executor runs synchronously, inside the constructor.
        const jsi::Function executor =
            closure(context, "executor", 2,
                    [&](ContextState& owner, const jsi::Value&, const jsi::Value* args, std::size_t count)
                    {
                        assert(count >= 2);
                        (void)count;
                        resolve = args[0].getObject(owner.rt).getFunction(owner.rt);
                        reject = args[1].getObject(owner.rt).getFunction(owner.rt);
                        return jsi::Value::undefined();
                    });
        jsi::Value promise = context.builtins().promise.callAsConstructor(context.rt, executor);
        assert(resolve.has_value() && reject.has_value());
        pending = std::make_shared<detail::PendingPromise>(
            context, method,
            std::move(*resolve), // NOLINT(bugprone-unchecked-optional-access): set by the executor
            std::move(*reject)); // NOLINT(bugprone-unchecked-optional-access)
        return promise;
    }

    void resolvePromiseWithUndefined(detail::PendingPromise& pending)
    {
        resolvePromise(pending, [](ContextState&) { return jsi::Value::undefined(); });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    PendingPromise::PendingPromise(ContextState& context, std::string methodName, jsi::Function resolve,
                                   jsi::Function reject)
        : owner(&context),
          method(std::move(methodName)),
          resolveFunction(std::move(resolve)),
          rejectFunction(std::move(reject))
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

    void PendingPromise::settle(bool fulfilled, const jsi::Value& value)
    {
        // Callers check activeContext() before creating `value`.
        assert(owner != nullptr);
        owner->runtime->assertOwnerThread();
        const auto& settler = fulfilled ? resolveFunction : rejectFunction;
        // A resolving function does not throw; a failure inside it (out of
        // memory) is the engine's, reported by whoever next runs it.
        if (settler.has_value())
            bind::call(*owner, *settler, jsi::Value::undefined(), std::span(&value, 1), "settling a promise");
        orphan();
    }

    void PendingPromise::orphan() noexcept
    {
        if (owner == nullptr)
            return;
        resolveFunction.reset();
        rejectFunction.reset();
        std::erase(owner->pendingPromises, this);
        owner = nullptr;
    }

    void rejectPromise(PendingPromise& pending, const std::string& message)
    {
        ContextState* context = pending.activeContext();
        if (context == nullptr)
            return;
        if (context->halted())
        {
            pending.orphan();
            return;
        }
        try
        {
            const jsi::Value error = bind::makeError(*context, pending.method + "(): " + message);
            pending.settle(false, error);
        }
        catch (...)
        {
            pending.orphan();
        }
    }

    bool isPromisePending(const PendingPromise& pending) noexcept
    {
        return pending.owner != nullptr;
    }

    ObjectState::~ObjectState()
    {
        if (finalization == nullptr || tokens.empty())
            return;
        try
        {
            const std::scoped_lock lock(finalization->mutex);
            finalization->tokens.insert(finalization->tokens.end(), tokens.begin(), tokens.end());
        }
        catch (...) // NOLINT(bugprone-empty-catch): nothing to unwind into
        {
            // Out of memory while the collector finalizes: the callbacks of
            // these cells are lost rather than unwinding through the engine.
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
