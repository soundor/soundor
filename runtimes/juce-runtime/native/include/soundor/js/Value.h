#pragma once

#include <soundor/Config.h>

#include <cstddef>
#include <string>
#include <utility>
#include <variant>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    // A C++ snapshot of a JavaScript value, detached from the engine.
    //
    // Primitives are copied exactly. Anything else (objects, functions, symbols,
    // bigints) is reported as `Type::Other` with its string form as a
    // description — enough to inspect evaluation results without handing out a
    // reference into the JavaScript heap.
    class Value
    {
    public:
        enum class Type
        {
            Undefined,
            Null,
            Boolean,
            Number,
            String,
            Other,
        };

        Value() = default;

        [[nodiscard]] static Value undefined() { return {}; }
        [[nodiscard]] static Value null() { return Value { Storage { std::in_place_index<1> } }; }
        [[nodiscard]] static Value boolean(bool value) { return Value { Storage { std::in_place_index<2>, value } }; }
        [[nodiscard]] static Value number(double value) { return Value { Storage { std::in_place_index<3>, value } }; }
        [[nodiscard]] static Value string(std::string value)
        {
            return Value { Storage { std::in_place_index<4>, std::move(value) } };
        }
        [[nodiscard]] static Value other(std::string description)
        {
            return Value { Storage { std::in_place_index<5>, Description { std::move(description) } } };
        }

        [[nodiscard]] Type type() const noexcept { return static_cast<Type>(storage.index()); }

        [[nodiscard]] bool isUndefined() const noexcept { return type() == Type::Undefined; }
        [[nodiscard]] bool isNull() const noexcept { return type() == Type::Null; }
        [[nodiscard]] bool isBoolean() const noexcept { return type() == Type::Boolean; }
        [[nodiscard]] bool isNumber() const noexcept { return type() == Type::Number; }
        [[nodiscard]] bool isString() const noexcept { return type() == Type::String; }
        [[nodiscard]] bool isOther() const noexcept { return type() == Type::Other; }

        // Typed accessors; each falls back to a neutral value for other types.
        [[nodiscard]] bool asBoolean() const noexcept;
        [[nodiscard]] double asNumber() const noexcept;
        [[nodiscard]] const std::string& asString() const noexcept;

        // A human-readable rendering, like JavaScript's String(value).
        [[nodiscard]] std::string toString() const;

        friend bool operator==(const Value&, const Value&) = default;

    private:
        struct Description
        {
            std::string text;
            friend bool operator==(const Description&, const Description&) = default;
        };

        using Storage = std::variant<std::monostate, std::nullptr_t, bool, double, std::string, Description>;

        explicit Value(Storage value) : storage(std::move(value)) {}

        Storage storage;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
