#pragma once

// JSON for the adapter: the plugin's descriptor, state documents (the VST3
// component's and controller's state) and persistent-state values.
//
// Strict (RFC 8259): no comments, no trailing commas, UTF-8 checked, at most
// 64 levels deep and 100000 values. Numbers keep their text, so a 64-bit
// integer or a float survives a parse and a write unchanged. Objects keep
// their members' order.

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace soundor::vst3::json
{
    class Error : public std::runtime_error
    {
    public:
        using std::runtime_error::runtime_error;
    };

    class Value
    {
    public:
        enum class Kind : std::uint8_t
        {
            Null,
            Boolean,
            Number,
            String,
            Array,
            Object,
        };
        using Member = std::pair<std::string, Value>;

        Value() = default;
        static Value null() { return {}; }
        static Value boolean(bool value);
        // A number from its JSON text (checked by the parser, or written by number()).
        static Value numberText(std::string text);
        static Value number(double value);
        static Value integer(std::int64_t value);
        static Value unsignedInteger(std::uint64_t value);
        static Value string(std::string value);
        static Value array(std::vector<Value> values = {});
        static Value object(std::vector<Member> values = {});

        [[nodiscard]] Kind kind() const noexcept { return type; }
        [[nodiscard]] bool isNull() const noexcept { return type == Kind::Null; }
        [[nodiscard]] bool isBoolean() const noexcept { return type == Kind::Boolean; }
        [[nodiscard]] bool isNumber() const noexcept { return type == Kind::Number; }
        [[nodiscard]] bool isString() const noexcept { return type == Kind::String; }
        [[nodiscard]] bool isArray() const noexcept { return type == Kind::Array; }
        [[nodiscard]] bool isObject() const noexcept { return type == Kind::Object; }

        // Each throws Error when the value is of another kind.
        [[nodiscard]] bool asBoolean() const;
        [[nodiscard]] double asNumber() const;
        // The number's JSON text.
        [[nodiscard]] const std::string& numberText() const;
        // The number as an exact integer: nothing when it has a fraction,
        // an exponent or is out of range.
        [[nodiscard]] std::optional<std::int64_t> asInt64() const;
        [[nodiscard]] std::optional<std::uint64_t> asUint64() const;
        [[nodiscard]] const std::string& asString() const;
        [[nodiscard]] const std::vector<Value>& asArray() const;
        [[nodiscard]] std::vector<Value>& asArray();
        [[nodiscard]] const std::vector<Member>& asObject() const;
        [[nodiscard]] std::vector<Member>& asObject();

        // An object's member, or null when absent (or not an object).
        [[nodiscard]] const Value* find(std::string_view name) const noexcept;
        // An object's member; throws Error naming it when absent.
        [[nodiscard]] const Value& at(std::string_view name) const;
        // Convenience readers of an object's members, with defaults.
        [[nodiscard]] std::string stringOr(std::string_view name, const std::string& fallback = {}) const;
        [[nodiscard]] double numberOr(std::string_view name, double fallback = 0) const;
        [[nodiscard]] bool booleanOr(std::string_view name, bool fallback = false) const;
        // Appends or replaces an object's member.
        void set(std::string name, Value value);

        friend bool operator==(const Value& a, const Value& b);

    private:
        Kind type = Kind::Null;
        bool flag = false;
        std::string text; // a string's value, or a number's JSON text
        std::vector<Value> items;
        std::vector<Member> members;
    };

    struct Limits
    {
        std::size_t depth = 64;
        std::size_t values = 100000;
        std::size_t bytes = std::size_t { 8 } * 1024 * 1024;
    };

    // Throws Error saying where the text is not JSON.
    [[nodiscard]] Value parse(std::string_view text, const Limits& limits = {});
    // Compact JSON. Strings are written with only the escapes JSON requires
    // (and control characters as \u00XX), as JavaScript's JSON.stringify.
    [[nodiscard]] std::string write(const Value& value);
    // `text` as a JSON string literal.
    [[nodiscard]] std::string quote(std::string_view text);
    // Whether `text` is valid UTF-8 (no surrogates, no overlong forms).
    [[nodiscard]] bool validUtf8(std::string_view text) noexcept;
    // The shortest decimal text that reads back as `value` (finite), as
    // JavaScript's Number.prototype.toString writes it.
    [[nodiscard]] std::string formatNumber(double value);
} // namespace soundor::vst3::json
