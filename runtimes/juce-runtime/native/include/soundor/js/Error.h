#pragma once

#include <soundor/Config.h>

#include <cassert>
#include <optional>
#include <string>
#include <utility>
#include <variant>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    // A JavaScript exception (or a Soundor-side failure) converted into plain
    // C++ data. Nothing in it refers back into the engine, so it may outlive the
    // context that produced it.
    struct Error
    {
        // The error's `name` ("TypeError", "SyntaxError", ...). Empty when
        // JavaScript threw something that is not an Error object.
        std::string name;
        std::string message;
        // The engine's stack trace, when one was captured.
        std::string stack;

        // "Name: message", or just the message when there is no name.
        [[nodiscard]] std::string toString() const;
    };

    // The outcome of an operation that can fail with a JavaScript error.
    // Soundor never lets a C++ exception cross the engine boundary; failures are
    // values instead.
    template <typename T>
    class [[nodiscard]] Result
    {
    public:
        Result(T value) : storage(std::in_place_index<0>, std::move(value)) {}
        Result(Error error) : storage(std::in_place_index<1>, std::move(error)) {}

        [[nodiscard]] bool ok() const noexcept { return storage.index() == 0; }
        explicit operator bool() const noexcept { return ok(); }

        [[nodiscard]] T& value() &
        {
            assert(ok());
            return std::get<0>(storage);
        }
        [[nodiscard]] const T& value() const&
        {
            assert(ok());
            return std::get<0>(storage);
        }
        [[nodiscard]] T&& value() &&
        {
            assert(ok());
            return std::get<0>(std::move(storage));
        }

        [[nodiscard]] const Error& error() const
        {
            assert(! ok());
            return std::get<1>(storage);
        }

    private:
        std::variant<T, Error> storage;
    };

    template <>
    class [[nodiscard]] Result<void>
    {
    public:
        Result() = default;
        Result(Error error) : failure(std::move(error)) {}

        [[nodiscard]] bool ok() const noexcept { return ! failure.has_value(); }
        explicit operator bool() const noexcept { return ok(); }

        [[nodiscard]] const Error& error() const
        {
            assert(! ok());
            return *failure; // NOLINT(bugprone-unchecked-optional-access): asserted above
        }

    private:
        std::optional<Error> failure;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
