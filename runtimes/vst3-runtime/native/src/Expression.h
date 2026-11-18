#pragma once

// Soundor's expression language (@soundor/expression), interpreted: the
// parameters' behaviour (mapping, snapping, text) arrives in the plugin's
// descriptor as expression trees, which this evaluates with exactly the
// semantics of the expression compilers: every operation calls the same
// helpers the C++ compiler's output calls (ExpressionRuntime.h, generated
// from @soundor/expression's cppRuntime()), so the adapter computes the bits
// the JUCE runtime's generated C++ and the web runtime's JavaScript compute.
//
// A tree is checked and compiled once (Expression::compile); evaluating it
// takes no lock, and allocates only for strings: a numeric expression (a
// mapping, a constraint) is realtime-safe.

#include "Json.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::vst3::expression
{
    enum class Base : std::uint8_t
    {
        Boolean,
        String,
        Int8,
        Uint8,
        Int16,
        Uint16,
        Int32,
        Uint32,
        Int64,
        Uint64,
        Float32,
        Float64,
    };

    struct Type
    {
        Base base = Base::Float64;
        bool nullable = false;

        friend bool operator==(const Type&, const Type&) = default;
    };

    // "float32", "int64?", ...; throws json::Error for another name.
    [[nodiscard]] Type parseType(std::string_view name);
    [[nodiscard]] bool isInteger(Base base) noexcept;
    [[nodiscard]] bool isFloat(Base base) noexcept;
    [[nodiscard]] bool isSigned(Base base) noexcept;

    // A value of some Type: `null` for a nullable's absence; otherwise the
    // member of its base type (signed integers in `i`, unsigned in `u`).
    struct Value
    {
        bool null = false;
        bool b = false;
        std::int64_t i = 0;
        std::uint64_t u = 0;
        float f = 0;
        double d = 0;
        std::string s;

        static Value fromDouble(Base base, double plain);
        // The value as a double (a static_cast of its base type's member).
        [[nodiscard]] double toDouble(Base base) const;
    };

    struct Node;

    // One expression, compiled from its tree, with named inputs.
    class Expression
    {
    public:
        struct Input
        {
            std::string name;
            Type type;
        };

        // Throws json::Error when the tree is malformed or its types do not
        // check (an input it does not declare, an operand of another type).
        static Expression compile(const json::Value& tree, std::vector<Input> inputs);

        Expression();
        ~Expression();
        Expression(Expression&&) noexcept;
        Expression& operator=(Expression&&) noexcept;
        Expression(const Expression&) = delete;
        Expression& operator=(const Expression&) = delete;

        [[nodiscard]] Type type() const noexcept;
        // Evaluates with `inputs` in the order compile() was given them.
        [[nodiscard]] Value evaluate(const Value* inputs, std::size_t count) const;

    private:
        std::unique_ptr<Node> root;
        std::size_t inputCount = 0;
        std::size_t variableCount = 0;
    };
} // namespace soundor::vst3::expression
