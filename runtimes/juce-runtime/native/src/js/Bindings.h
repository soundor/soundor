#pragma once

// Private to Soundor: the conversion and call helpers generated native-module
// bindings are written against. Generated code stays short and declarative;
// every engine detail (validation, error messages, ownership) lives here.
//
// Conventions:
// - read(ctx, value, path, out) converts a JavaScript value into `out`. On a
//   mismatch it throws a TypeError naming `path` and returns false; the caller
//   returns JS_EXCEPTION.
// - write(ctx, value) converts a C++ value into a new JSValue, or returns
//   JS_EXCEPTION after throwing.

#include "Internal.h"

#include <soundor/js/Promise.h>

#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <new>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
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

    // Throws a TypeError: "<path>: expected <expected>, got <actual type>".
    void throwTypeMismatch(JSContext* ctx, const Path& path, std::string_view expected, JSValueConst actual);

    // ── Reading arguments ────────────────────────────────────────────────────

    bool read(JSContext* ctx, JSValueConst value, const Path& path, bool& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, double& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::string& out);

    // Binary views borrow the JavaScript buffer for the duration of the call:
    // zero-copy, read-only, and invalid once the native method returns.
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::byte>& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::uint8_t>& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::int32_t>& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const float>& out);
    bool read(JSContext* ctx, JSValueConst value, const Path& path, std::span<const double>& out);

    // The bytes of an ArrayBuffer or any typed array, borrowed and writable
    // (for natives that fill a buffer); invalid once the native method returns.
    bool readBytes(JSContext* ctx, JSValueConst value, const Path& path, std::span<std::byte>& out);

    // Reads one of `values`, reporting its position.
    bool readEnum(JSContext* ctx, JSValueConst value, const Path& path, std::span<const std::string_view> values,
                  std::size_t& index);

    bool expectObject(JSContext* ctx, JSValueConst value, const Path& path);
    bool expectArray(JSContext* ctx, JSValueConst value, const Path& path, std::size_t& length);

    // Reads a JavaScript array element by element with `readElement`, which is
    // called as readElement(ctx, element, elementPath, out).
    template <typename T, typename ReadElement>
    bool readArray(JSContext* ctx, JSValueConst value, const Path& path, std::vector<T>& out, ReadElement readElement)
    {
        std::size_t length = 0;
        if (! expectArray(ctx, value, path, length))
            return false;
        out.clear();
        out.reserve(length);
        for (std::size_t i = 0; i < length; ++i)
        {
            JSValue element = JS_GetPropertyUint32(ctx, value, static_cast<std::uint32_t>(i));
            if (JS_IsException(element))
                return false;
            T item {};
            const bool ok = readElement(ctx, element, path.element(i), item);
            JS_FreeValue(ctx, element);
            if (! ok)
                return false;
            out.push_back(std::move(item));
        }
        return true;
    }

    // A property of an object being read as a struct.
    class Field
    {
    public:
        Field(JSContext* context, JSValueConst object, const char* name, const Path& parent);
        ~Field();

        Field(const Field&) = delete;
        Field& operator=(const Field&) = delete;
        Field(Field&&) = delete;
        Field& operator=(Field&&) = delete;

        // False when reading the property threw.
        explicit operator bool() const noexcept { return ! JS_IsException(property); }
        [[nodiscard]] JSValueConst value() const noexcept { return property; }
        [[nodiscard]] const Path& path() const noexcept { return fieldPath; }

    private:
        JSContext* ctx;
        JSValue property;
        Path fieldPath;
    };

    // ── Writing results ──────────────────────────────────────────────────────

    JSValue write(JSContext* ctx, bool value);
    JSValue write(JSContext* ctx, double value);
    JSValue write(JSContext* ctx, const std::string& value);

    // Binary results move their storage into a JavaScript-owned ArrayBuffer:
    // zero-copy, and freed by the garbage collector.
    JSValue write(JSContext* ctx, std::vector<std::byte>&& value);
    JSValue write(JSContext* ctx, std::vector<std::uint8_t>&& value);
    JSValue write(JSContext* ctx, std::vector<std::int32_t>&& value);
    JSValue write(JSContext* ctx, std::vector<float>&& value);
    JSValue write(JSContext* ctx, std::vector<double>&& value);

    JSValue writeEnum(JSContext* ctx, std::string_view value);

    // Writes a JavaScript array; writeElement(ctx, element) yields each value.
    template <typename T, typename WriteElement>
    JSValue writeArray(JSContext* ctx, std::vector<T>&& values, WriteElement writeElement)
    {
        JSValue array = JS_NewArray(ctx);
        if (JS_IsException(array))
            return array;
        for (std::size_t i = 0; i < values.size(); ++i)
        {
            JSValue element = writeElement(ctx, std::move(values[i]));
            if (JS_IsException(element) || JS_SetPropertyUint32(ctx, array, static_cast<std::uint32_t>(i), element) < 0)
            {
                JS_FreeValue(ctx, array);
                return JS_EXCEPTION;
            }
        }
        return array;
    }

    // Builds a plain object field by field; any failure turns the result into
    // JS_EXCEPTION.
    class ObjectBuilder
    {
    public:
        explicit ObjectBuilder(JSContext* context);
        ~ObjectBuilder();

        ObjectBuilder(const ObjectBuilder&) = delete;
        ObjectBuilder& operator=(const ObjectBuilder&) = delete;
        ObjectBuilder(ObjectBuilder&&) = delete;
        ObjectBuilder& operator=(ObjectBuilder&&) = delete;

        // Takes ownership of `value`.
        void set(const char* name, JSValue value);
        [[nodiscard]] JSValue release();

    private:
        JSContext* ctx;
        JSValue object;
    };

    // ── Opaque native handles ────────────────────────────────────────────────

    // Identifies one handle type; generated code defines one per declared
    // handle, and compares them by address.
    struct HandleType
    {
        const char* name;
    };

    bool readHandle(JSContext* ctx, JSValueConst value, const Path& path, const HandleType& type,
                    std::shared_ptr<void>& out);
    JSValue writeHandle(JSContext* ctx, const HandleType& type, std::shared_ptr<void> object);

    template <typename T>
    bool read(JSContext* ctx, JSValueConst value, const Path& path, const HandleType& type, std::shared_ptr<T>& out)
    {
        std::shared_ptr<void> object;
        if (! readHandle(ctx, value, path, type, object))
            return false;
        out = std::static_pointer_cast<T>(std::move(object));
        return true;
    }

    // ── Calls ────────────────────────────────────────────────────────────────

    // Requires at least `expected` arguments; extras are ignored.
    bool expectArgumentCount(JSContext* ctx, const char* method, int argc, int expected);

    JSValue throwNativeException(JSContext* ctx, const char* method, const std::exception& error);

    // Runs a binding body, turning any C++ exception into a JavaScript error so
    // none crosses into the engine.
    template <typename Body>
    JSValue invoke(JSContext* ctx, const char* method, Body&& body) noexcept
    {
        try
        {
            return body();
        }
        catch (const std::bad_alloc&)
        {
            return JS_ThrowOutOfMemory(ctx);
        }
        catch (const std::exception& error)
        {
            return throwNativeException(ctx, method, error);
        }
        catch (...)
        {
            return JS_ThrowInternalError(ctx, "%s(): unknown native exception", method);
        }
    }

    // Per-context data owned by a native module (e.g. its API object), keyed by
    // the address of a static in the generated code. Released with the context.
    void setContextData(Context& context, const void* key, std::shared_ptr<void> data);
    [[nodiscard]] void* contextData(JSContext* ctx, const void* key);

    template <typename T>
    [[nodiscard]] T* contextData(JSContext* ctx, const void* key)
    {
        return static_cast<T*>(contextData(ctx, key));
    }

    // Keeps a JavaScript value alive for the context's lifetime under `key`,
    // replacing (and freeing) any previous one. Takes ownership of `value`.
    void retainValue(JSContext* ctx, const void* key, JSValue value);
    // The value retained under `key`, or undefined. Not a new reference.
    [[nodiscard]] JSValueConst retainedValue(JSContext* ctx, const void* key);

    // ── Promises ─────────────────────────────────────────────────────────────

    // Creates a promise for an async method. Returns it (or JS_EXCEPTION) and
    // its settle-later state in `pending`.
    JSValue newPromise(JSContext* ctx, const char* method, std::shared_ptr<detail::PendingPromise>& pending);

    // Settles with makeValue(ctx), called only while the promise is still
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
        PendingPromise(ContextState& context, std::string methodName, JSValue resolve, JSValue reject);
        ~PendingPromise();

        PendingPromise(const PendingPromise&) = delete;
        PendingPromise& operator=(const PendingPromise&) = delete;

        // The context to settle in, or nullptr once settled or orphaned.
        [[nodiscard]] JSContext* activeContext() const noexcept { return owner != nullptr ? owner->ctx : nullptr; }

        // Calls resolve or reject with `value` (taking ownership) and retires.
        void settle(bool fulfilled, JSValue value);

        // Releases the resolving functions without settling; the context is
        // going away.
        void orphan() noexcept;

        ContextState* owner;
        std::string method;
        JSValue resolveFunction;
        JSValue rejectFunction;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
{
    template <typename MakeValue>
    void resolvePromise(detail::PendingPromise& pending, MakeValue&& makeValue)
    {
        JSContext* ctx = pending.activeContext();
        if (ctx == nullptr)
            return;
        pending.owner->runtime->enter();
        JSValue value = JS_UNDEFINED;
        try
        {
            value = makeValue(ctx);
        }
        catch (const std::exception& error)
        {
            detail::rejectPromise(pending, error.what());
            return;
        }
        if (JS_IsException(value))
        {
            pending.settle(false, JS_GetException(ctx));
            return;
        }
        pending.settle(true, value);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::bind
