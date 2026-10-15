#pragma once

#include <soundor/Abi.h>

// Private to Soundor: the conversion and call helpers native modules and
// generated bindings are written against. Generated code stays short and
// declarative; every engine detail (validation, error messages, ownership)
// lives here.
//
// Conventions:
// - A native function is a NativeFunction: it gets its context, `this` and
//   the arguments, and returns a jsi::Value.
// - read(context, value, path, out) converts a JavaScript value into `out`.
//   On a mismatch it throws a TypeError naming `path` (a jsi::JSError).
// - write(context, value) converts a C++ value into a new jsi::Value.
// - JavaScript errors are jsi::JSError, JSI's way of throwing into
//   JavaScript. Any other C++ exception stops at invoke(), which turns it into
//   one; nothing else reaches the engine.

#include "Internal.h"

#include <soundor/js/Promise.h>

#include <hermes/Public/JSOutOfMemoryError.h>

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <new>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    using detail::ContextState;

    // Where a value sits in a native call, for error messages:
    // "analyze(): points[2].x". Built on the stack; formatted only on failure.
    struct Path
    {
        const char* name = nullptr; // nullptr for an array element
        std::size_t index = 0;
        const Path* parent = nullptr;

        [[nodiscard]] Path field(const char* fieldName) const { return Path { fieldName, 0, this }; }
        [[nodiscard]] Path element(std::size_t elementIndex) const { return Path { nullptr, elementIndex, this }; }
        [[nodiscard]] std::string toString() const;
    };

    // ── Errors ───────────────────────────────────────────────────────────────

    // A new error object of the context's own constructors (not whatever the
    // globals are now).
    [[nodiscard]] jsi::Value makeError(ContextState& context, std::string_view message);
    [[nodiscard]] jsi::Value makeTypeError(ContextState& context, std::string_view message);
    [[nodiscard]] jsi::Value makeRangeError(ContextState& context, std::string_view message);

    [[noreturn]] void throwError(ContextState& context, std::string_view message);
    [[noreturn]] void throwTypeError(ContextState& context, std::string_view message);
    [[noreturn]] void throwRangeError(ContextState& context, std::string_view message);
    // An Error named "InternalError": the runtime itself failed.
    [[noreturn]] void throwInternalError(ContextState& context, std::string_view message);
    // "<path>: expected <expected>, got <actual type>".
    [[noreturn]] void throwTypeMismatch(ContextState& context, const Path& path, std::string_view expected,
                                        const jsi::Value& actual);

    // A short description of a value's type for error messages.
    [[nodiscard]] std::string describeType(ContextState& context, const jsi::Value& value);

    // ── Converting as JavaScript does ────────────────────────────────────────

    // ToNumber(value), ToInt32, ToUint32, ToBoolean and ToString: what a
    // JavaScript operator would make of the value (calling valueOf/toString
    // where it would, so they may throw).
    [[nodiscard]] double toNumber(ContextState& context, const jsi::Value& value);
    [[nodiscard]] std::int32_t toInt32(ContextState& context, const jsi::Value& value);
    [[nodiscard]] std::uint32_t toUint32(ContextState& context, const jsi::Value& value);
    [[nodiscard]] bool toBoolean(ContextState& context, const jsi::Value& value);
    [[nodiscard]] std::string toString(ContextState& context, const jsi::Value& value);

    // The argument at `index`, or undefined past the end.
    [[nodiscard]] inline const jsi::Value& argument(const jsi::Value* args, std::size_t count, std::size_t index)
    {
        static const jsi::Value undefined;
        return index < count ? args[index] : undefined;
    }

    [[nodiscard]] inline bool isFunction(ContextState& context, const jsi::Value& value)
    {
        return value.isObject() && value.getObject(context.rt).isFunction(context.rt);
    }

    // ── Reading arguments ────────────────────────────────────────────────────

    void read(ContextState& context, const jsi::Value& value, const Path& path, bool& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, double& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::string& out);

    // Binary views borrow the JavaScript buffer for the duration of the call:
    // zero-copy, read-only, and invalid once the native method returns (or
    // calls back into JavaScript). Typed arrays must be exactly the type
    // (by their internal class, not their prototype); a detached buffer
    // reads as empty.
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::byte>& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::uint8_t>& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const std::int32_t>& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const float>& out);
    void read(ContextState& context, const jsi::Value& value, const Path& path, std::span<const double>& out);

    // The bytes of an ArrayBuffer or any typed array (its view), borrowed and
    // writable (for natives that fill a buffer); invalid once the native
    // method returns.
    void readBytes(ContextState& context, const jsi::Value& value, const Path& path, std::span<std::byte>& out);

    // The view of an ArrayBuffer or typed array, or false for anything else.
    [[nodiscard]] bool bufferView(ContextState& context, const jsi::Value& value,
                                  facebook::hermes::soundor::BufferView& out) noexcept;

    // Reads one of `values`, reporting its position.
    void readEnum(ContextState& context, const jsi::Value& value, const Path& path,
                  std::span<const std::string_view> values, std::size_t& index);

    // A plain object (not an array or function).
    [[nodiscard]] jsi::Object expectObject(ContextState& context, const jsi::Value& value, const Path& path);
    [[nodiscard]] jsi::Array expectArray(ContextState& context, const jsi::Value& value, const Path& path);

    // Reads a JavaScript array element by element with `readElement`, which
    // is called as readElement(context, element, elementPath, out).
    template <typename T, typename ReadElement>
    void readArray(ContextState& context, const jsi::Value& value, const Path& path, std::vector<T>& out,
                   ReadElement readElement)
    {
        const jsi::Array array = expectArray(context, value, path);
        const std::size_t length = array.size(context.rt);
        out.clear();
        out.reserve(length);
        for (std::size_t i = 0; i < length; ++i)
        {
            const jsi::Value element = array.getValueAtIndex(context.rt, i);
            T item {};
            readElement(context, element, path.element(i), item);
            out.push_back(std::move(item));
        }
    }

    // `object[name]`, with `name` a literal (or a string that outlives the
    // context): its PropNameID is made once.
    [[nodiscard]] inline jsi::Value property(ContextState& context, const jsi::Object& object, const char* name)
    {
        return object.getProperty(context.rt, context.name(name));
    }

    template <typename T>
    void setProperty(ContextState& context, const jsi::Object& object, const char* name, T&& value)
    {
        object.setProperty(context.rt, context.name(name), std::forward<T>(value));
    }

    // ── Writing results ──────────────────────────────────────────────────────

    [[nodiscard]] inline jsi::Value write(ContextState&, bool value)
    {
        return { value };
    }
    [[nodiscard]] inline jsi::Value write(ContextState&, double value)
    {
        return { value };
    }
    [[nodiscard]] jsi::Value write(ContextState& context, std::string_view value);
    [[nodiscard]] inline jsi::Value write(ContextState& context, const std::string& value)
    {
        return write(context, std::string_view(value));
    }
    // Without it, a string literal would convert to bool.
    [[nodiscard]] inline jsi::Value write(ContextState& context, const char* value)
    {
        return write(context, std::string_view(value));
    }

    // Binary results move their storage into a JavaScript-owned ArrayBuffer:
    // zero-copy, and freed by the garbage collector.
    [[nodiscard]] jsi::Value write(ContextState& context, std::vector<std::byte>&& value);
    [[nodiscard]] jsi::Value write(ContextState& context, std::vector<std::uint8_t>&& value);
    [[nodiscard]] jsi::Value write(ContextState& context, std::vector<std::int32_t>&& value);
    [[nodiscard]] jsi::Value write(ContextState& context, std::vector<float>&& value);
    [[nodiscard]] jsi::Value write(ContextState& context, std::vector<double>&& value);

    [[nodiscard]] jsi::Value writeEnum(ContextState& context, std::string_view value);

    // Writes a JavaScript array; writeElement(context, element) yields each
    // value.
    template <typename T, typename WriteElement>
    [[nodiscard]] jsi::Value writeArray(ContextState& context, std::vector<T>&& values, WriteElement writeElement)
    {
        jsi::Array array(context.rt, values.size());
        for (std::size_t i = 0; i < values.size(); ++i)
            array.setValueAtIndex(context.rt, i, writeElement(context, std::move(values[i])));
        return array;
    }

    // Builds a plain object field by field.
    class ObjectBuilder
    {
    public:
        explicit ObjectBuilder(ContextState& owner) : context(owner), object(owner.rt) {}

        template <typename T>
        void set(const char* name, T&& value)
        {
            setProperty(context, object, name, std::forward<T>(value));
        }
        [[nodiscard]] jsi::Value release() { return std::move(object); }

    private:
        ContextState& context;
        jsi::Object object;
    };

    // ── Opaque native handles ────────────────────────────────────────────────

    // Identifies one handle type; generated code defines one per declared
    // handle, and compares them by address.
    struct HandleType
    {
        const char* name;
    };

    void readHandle(ContextState& context, const jsi::Value& value, const Path& path, const HandleType& type,
                    std::shared_ptr<void>& out);
    [[nodiscard]] jsi::Value writeHandle(ContextState& context, const HandleType& type, std::shared_ptr<void> object);

    template <typename T>
    void read(ContextState& context, const jsi::Value& value, const Path& path, const HandleType& type,
              std::shared_ptr<T>& out)
    {
        std::shared_ptr<void> object;
        readHandle(context, value, path, type, object);
        out = std::static_pointer_cast<T>(std::move(object));
    }

    // ── Native functions ─────────────────────────────────────────────────────

    using NativeFunction = jsi::Value (*)(ContextState& context, const jsi::Value& thisValue, const jsi::Value* args,
                                          std::size_t count);

    // A JavaScript function calling `function` in `context`.
    [[nodiscard]] jsi::Function function(ContextState& context, const char* name, unsigned length,
                                         NativeFunction function);

    // A JavaScript function calling `body(context, this, args, count)`; for
    // natives that carry state.
    template <typename Body>
    [[nodiscard]] jsi::Function closure(ContextState& context, const char* name, unsigned length, Body body)
    {
        return jsi::Function::createFromHostFunction(
            context.rt, context.name(name), length,
            [&context, body = std::move(body)](jsi::Runtime&, const jsi::Value& thisValue, const jsi::Value* args,
                                               std::size_t count) mutable
            { return body(context, thisValue, args, count); });
    }

    // Which of Soundor's native APIs a call goes to (RuntimeStatistics).
    enum class NativeApi
    {
        Ui,
        Canvas,
        WebGL,
    };

    // Counts one call into `api`, and times it when the runtime times native
    // calls; declared first in a binding entry point, so it covers the
    // argument checks too. Only the outermost of nested calls is timed.
    class NativeCall
    {
    public:
        NativeCall(ContextState& context, NativeApi api) noexcept : state(context.runtime.get())
        {
            RuntimeStatistics& statistics = state->statistics;
            counter = api == NativeApi::Ui       ? &statistics.ui
                      : api == NativeApi::Canvas ? &statistics.canvas
                                                 : &statistics.webgl;
            ++counter->calls;
            if (state->nativeCallDepth++ == 0 && state->timeNativeCalls)
            {
                timed = true;
                started = std::chrono::steady_clock::now();
            }
        }

        ~NativeCall()
        {
            --state->nativeCallDepth;
            if (timed)
                counter->nanoseconds += static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - started)
                        .count());
        }

        NativeCall(const NativeCall&) = delete;
        NativeCall& operator=(const NativeCall&) = delete;
        NativeCall(NativeCall&&) = delete;
        NativeCall& operator=(NativeCall&&) = delete;

    private:
        detail::RuntimeState* state;
        NativeCallStatistics* counter = nullptr;
        bool timed = false;
        std::chrono::steady_clock::time_point started;
    };

    // Requires at least `expected` arguments; extras are ignored.
    void expectArgumentCount(ContextState& context, const char* method, std::size_t count, std::size_t expected);

    [[noreturn]] void throwNativeException(ContextState& context, const char* method, const std::exception& error);

    // Runs a binding body, turning any C++ exception other than a jsi::JSError
    // into a JavaScript error, so no other one reaches the engine.
    template <typename Body>
    jsi::Value invoke(ContextState& context, const char* method, Body&& body)
    {
        try
        {
            return body();
        }
        catch (const jsi::JSError&)
        {
            throw;
        }
        catch (const ::hermes::vm::JSOutOfMemoryError&)
        {
            // The engine's own: it unwinds to whoever called into it.
            throw;
        }
        catch (const std::bad_alloc&)
        {
            throwInternalError(context, std::string(method) + "(): out of memory");
        }
        catch (const std::exception& error)
        {
            throwNativeException(context, method, error);
        }
        catch (...)
        {
            throwInternalError(context, std::string(method) + "(): unknown native exception");
        }
    }

    // Calls a JavaScript function from native code that has nobody to throw
    // to (a dispatcher, a callback): a failure is logged with `what` and
    // reported as false.
    bool call(ContextState& context, const jsi::Function& function, const jsi::Value& thisValue,
              std::span<const jsi::Value> args, std::string_view what);

    // ── Context data ─────────────────────────────────────────────────────────

    // Per-context data owned by a native module (e.g. its API object), keyed by
    // the address of a static in the generated code. Released with the context.
    void setContextData(Context& context, const void* key, std::shared_ptr<void> data);
    [[nodiscard]] void* contextData(ContextState& context, const void* key);

    template <typename T>
    [[nodiscard]] T* contextData(ContextState& context, const void* key)
    {
        return static_cast<T*>(contextData(context, key));
    }

    // Keeps a JavaScript value alive for the context's lifetime under `key`,
    // replacing any previous one.
    void retainValue(ContextState& context, const void* key, jsi::Value value);
    // The value retained under `key`, or nullptr.
    [[nodiscard]] const jsi::Value* retainedValue(ContextState& context, const void* key);

    // ── Promises ─────────────────────────────────────────────────────────────

    // Creates a promise for an async method. Returns it, and its settle-later
    // state in `pending`.
    [[nodiscard]] jsi::Value newPromise(ContextState& context, const char* method,
                                        std::shared_ptr<detail::PendingPromise>& pending);

    // Settles with makeValue(context), called only while the promise is still
    // pending and its context alive.
    template <typename MakeValue>
    void resolvePromise(detail::PendingPromise& pending, MakeValue&& makeValue);

    void resolvePromiseWithUndefined(detail::PendingPromise& pending);

    // Starts an async method's implementation; a synchronous C++ exception
    // rejects the promise instead of throwing.
    template <typename Start>
    void startAsync(detail::PendingPromise& pending, Start&& start) noexcept
    {
        try
        {
            start();
        }
        catch (const std::exception& error)
        {
            detail::rejectPromise(pending, error.what());
        }
        catch (...)
        {
            detail::rejectPromise(pending, "unknown native exception");
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    // The engine side of a js::Promise.
    struct PendingPromise
    {
        PendingPromise(ContextState& context, std::string methodName, jsi::Function resolve, jsi::Function reject);
        ~PendingPromise();

        PendingPromise(const PendingPromise&) = delete;
        PendingPromise& operator=(const PendingPromise&) = delete;

        // The context to settle in, or nullptr once settled or orphaned.
        [[nodiscard]] ContextState* activeContext() const noexcept { return owner; }

        // Calls resolve or reject with `value` and retires.
        void settle(bool fulfilled, const jsi::Value& value);

        // Releases the resolving functions without settling; the context is
        // going away.
        void orphan() noexcept;

        ContextState* owner;
        std::string method;
        std::optional<jsi::Function> resolveFunction;
        std::optional<jsi::Function> rejectFunction;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    template <typename MakeValue>
    void resolvePromise(detail::PendingPromise& pending, MakeValue&& makeValue)
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
            const jsi::Value value = makeValue(*context);
            pending.settle(true, value);
        }
        catch (const jsi::JSError& error)
        {
            pending.settle(false, error.value());
        }
        catch (const std::exception& error)
        {
            detail::rejectPromise(pending, error.what());
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
