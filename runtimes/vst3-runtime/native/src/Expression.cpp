// The interpreter: one node class per expression kind, evaluating as the
// C++ compiler's output does (packages/expression/src/compiler/cpp.ts),
// operation for operation, through the same helpers.
#include "Expression.h"

#include "generated/ExpressionRuntime.h"

#include <array>
#include <cmath>
#include <ranges>
#include <utility>

namespace soundor::vst3::expression
{
    namespace rt = soundor_expression;

    Type parseType(std::string_view name)
    {
        Type out;
        if (! name.empty() && name.back() == '?')
        {
            out.nullable = true;
            name.remove_suffix(1);
        }
        static constexpr std::pair<std::string_view, Base> names[] = {
            { "boolean", Base::Boolean }, { "string", Base::String },   { "int8", Base::Int8 },
            { "uint8", Base::Uint8 },     { "int16", Base::Int16 },     { "uint16", Base::Uint16 },
            { "int32", Base::Int32 },     { "uint32", Base::Uint32 },   { "int64", Base::Int64 },
            { "uint64", Base::Uint64 },   { "float32", Base::Float32 }, { "float64", Base::Float64 },
        };
        for (const auto& [text, base] : names)
            if (text == name)
            {
                out.base = base;
                return out;
            }
        throw json::Error("unknown expression type \"" + std::string(name) + "\"");
    }

    bool isInteger(Base base) noexcept
    {
        return base >= Base::Int8 && base <= Base::Uint64;
    }
    bool isFloat(Base base) noexcept
    {
        return base == Base::Float32 || base == Base::Float64;
    }
    bool isSigned(Base base) noexcept
    {
        return base == Base::Int8 || base == Base::Int16 || base == Base::Int32 || base == Base::Int64;
    }

    namespace
    {
        // Calls `f` with a value of the C++ type of an integer base (its tag).
        template <class F>
        decltype(auto) withInteger(Base base, F&& f)
        {
            switch (base)
            {
                case Base::Int8:
                    return f(std::int8_t {});
                case Base::Uint8:
                    return f(std::uint8_t {});
                case Base::Int16:
                    return f(std::int16_t {});
                case Base::Uint16:
                    return f(std::uint16_t {});
                case Base::Int32:
                    return f(std::int32_t {});
                case Base::Uint32:
                    return f(std::uint32_t {});
                case Base::Int64:
                    return f(std::int64_t {});
                default:
                    return f(std::uint64_t {});
            }
        }

        template <class T>
        T getInt(const Value& value)
        {
            if constexpr (std::is_signed_v<T>)
                return static_cast<T>(value.i);
            else
                return static_cast<T>(value.u);
        }

        template <class T>
        void putInt(Value& value, T x)
        {
            if constexpr (std::is_signed_v<T>)
                value.i = std::int64_t { x };
            else
                value.u = static_cast<std::uint64_t>(x);
        }

        template <class T>
        Value makeInt(T x)
        {
            Value out;
            putInt(out, x);
            return out;
        }

        Value makeFloat(Base base, double x)
        {
            Value out;
            if (base == Base::Float32)
                out.f = static_cast<float>(x);
            else
                out.d = x;
            return out;
        }

        Value makeBool(bool x)
        {
            Value out;
            out.b = x;
            return out;
        }

        Value makeString(std::string x)
        {
            Value out;
            out.s = std::move(x);
            return out;
        }

        Value nullValue()
        {
            Value out;
            out.null = true;
            return out;
        }
    } // namespace

    Value Value::fromDouble(Base base, double plain)
    {
        Value out;
        switch (base)
        {
            case Base::Boolean:
                out.b = static_cast<bool>(plain);
                break;
            case Base::Float32:
                out.f = static_cast<float>(plain);
                break;
            case Base::Float64:
                out.d = plain;
                break;
            case Base::String:
                break;
            default:
                withInteger(base, [&](auto tag) { putInt(out, static_cast<decltype(tag)>(plain)); });
        }
        return out;
    }

    double Value::toDouble(Base base) const
    {
        switch (base)
        {
            case Base::Boolean:
                return b ? 1.0 : 0.0;
            case Base::Float32:
                return static_cast<double>(f);
            case Base::Float64:
                return d;
            case Base::String:
                return 0;
            default:
                return withInteger(base, [&](auto tag) { return static_cast<double>(getInt<decltype(tag)>(*this)); });
        }
    }

    // ── Nodes ────────────────────────────────────────────────────────────────

    struct Environment
    {
        const Value* inputs;
        Value* variables;
    };

    struct Node
    {
        explicit Node(Type nodeType) : type(nodeType) {}
        virtual ~Node() = default;
        Node(const Node&) = delete;
        Node& operator=(const Node&) = delete;
        Node(Node&&) = delete;
        Node& operator=(Node&&) = delete;

        [[nodiscard]] virtual Value eval(Environment& env) const = 0;
        Type type;
    };

    namespace
    {
        using NodePtr = std::unique_ptr<Node>;

        struct Literal final : Node
        {
            Literal(Type t, Value v) : Node(t), value(std::move(v)) {}
            [[nodiscard]] Value eval(Environment&) const override { return value; }
            Value value;
        };

        struct InputNode final : Node
        {
            InputNode(Type t, std::size_t i) : Node(t), index(i) {}
            [[nodiscard]] Value eval(Environment& env) const override { return env.inputs[index]; }
            std::size_t index;
        };

        struct VariableNode final : Node
        {
            VariableNode(Type t, std::size_t s) : Node(t), slot(s) {}
            [[nodiscard]] Value eval(Environment& env) const override { return env.variables[slot]; }
            std::size_t slot;
        };

        enum class Unary : std::uint8_t
        {
            Neg,
            Abs,
            Sqrt,
            Exp,
            Log,
            Floor,
            Ceil,
            Round,
            Not,
            Trim,
            Lower,
        };

        template <class F>
        F roundLike(Unary op, F x)
        {
            switch (op)
            {
                case Unary::Floor:
                    return static_cast<F>(std::floor(x));
                case Unary::Ceil:
                    return static_cast<F>(std::ceil(x));
                default:
                    return static_cast<F>(std::round(x));
            }
        }

        template <class F>
        F floatUnary(Unary op, F x)
        {
            switch (op)
            {
                case Unary::Neg:
                    return -x;
                case Unary::Abs:
                    return std::fabs(x);
                case Unary::Sqrt:
                    return rt::fsqrt<F>(x);
                case Unary::Exp:
                    return rt::fexp<F>(x);
                case Unary::Log:
                    return rt::flog<F>(x);
                default:
                    return roundLike(op, x);
            }
        }

        struct UnaryNode final : Node
        {
            UnaryNode(Type t, Unary o, NodePtr a) : Node(t), op(o), operand(std::move(a)) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                Value a = operand->eval(env);
                const Base base = operand->type.base;
                switch (op)
                {
                    case Unary::Not:
                        return makeBool(! a.b);
                    case Unary::Trim:
                        return makeString(rt::trim(a.s));
                    case Unary::Lower:
                        return makeString(rt::lower(std::move(a.s)));
                    default:
                        break;
                }
                if (base == Base::Float32)
                {
                    Value out;
                    out.f = floatUnary<float>(op, a.f);
                    return out;
                }
                if (base == Base::Float64)
                {
                    Value out;
                    out.d = floatUnary<double>(op, a.d);
                    return out;
                }
                return withInteger(base,
                                   [&](auto tag) -> Value
                                   {
                                       using T = decltype(tag);
                                       const T x = getInt<T>(a);
                                       switch (op)
                                       {
                                           case Unary::Neg:
                                               return makeInt<T>(rt::ineg<T>(x));
                                           case Unary::Abs:
                                               return makeInt<T>(rt::iabs<T>(x));
                                           case Unary::Floor:
                                           case Unary::Ceil:
                                           case Unary::Round:
                                               return makeInt<T>(static_cast<T>(roundLike(op, static_cast<double>(x))));
                                           default:
                                               throw json::Error("invalid operator for an integer");
                                       }
                                   });
            }
            Unary op;
            NodePtr operand;
        };

        enum class Binary : std::uint8_t
        {
            Add,
            Sub,
            Mul,
            Div,
            Min,
            Max,
            Pow,
            Eq,
            Ne,
            Lt,
            Lte,
            Gt,
            Gte,
            And,
            Or,
            EndsWith,
            RemoveSuffix,
        };

        // Compares two values of one type, as C++ compares them (std::optional's
        // rules for nullables: an absent value equals another, below any value).
        template <class Compare>
        bool compareValues(const Type& type, const Value& a, const Value& b, Compare compare)
        {
            if (type.nullable && (a.null || b.null))
            {
                const int left = a.null ? 0 : 1;
                const int right = b.null ? 0 : 1;
                return compare(left, right);
            }
            switch (type.base)
            {
                case Base::Boolean:
                    return compare(a.b, b.b);
                case Base::String:
                    return compare(a.s, b.s);
                case Base::Float32:
                    return compare(a.f, b.f);
                case Base::Float64:
                    return compare(a.d, b.d);
                default:
                    return withInteger(type.base,
                                       [&](auto tag)
                                       {
                                           using T = decltype(tag);
                                           return compare(getInt<T>(a), getInt<T>(b));
                                       });
            }
        }

        struct BinaryNode final : Node
        {
            BinaryNode(Type t, Binary o, NodePtr l, NodePtr r) : Node(t), op(o), left(std::move(l)), right(std::move(r))
            {
            }

            [[nodiscard]] Value eval(Environment& env) const override
            {
                if (op == Binary::And)
                    return makeBool(left->eval(env).b && right->eval(env).b);
                if (op == Binary::Or)
                    return makeBool(left->eval(env).b || right->eval(env).b);
                const Value a = left->eval(env);
                const Value b = right->eval(env);
                const Type& operandType = left->type;
                switch (op)
                {
                    case Binary::EndsWith:
                        return makeBool(rt::endsWith(a.s, b.s));
                    case Binary::RemoveSuffix:
                        return makeString(rt::removeSuffix(a.s, b.s));
                    case Binary::Eq:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x == y; }));
                    case Binary::Ne:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x != y; }));
                    case Binary::Lt:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x < y; }));
                    case Binary::Lte:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x <= y; }));
                    case Binary::Gt:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x > y; }));
                    case Binary::Gte:
                        return makeBool(
                            compareValues(operandType, a, b, [](const auto& x, const auto& y) { return x >= y; }));
                    default:
                        break;
                }
                const Base base = operandType.base;
                if (base == Base::Float32)
                {
                    Value out;
                    out.f = floatBinary<float>(a.f, b.f);
                    return out;
                }
                if (base == Base::Float64)
                {
                    Value out;
                    out.d = floatBinary<double>(a.d, b.d);
                    return out;
                }
                return withInteger(base,
                                   [&](auto tag) -> Value
                                   {
                                       using T = decltype(tag);
                                       const T x = getInt<T>(a);
                                       const T y = getInt<T>(b);
                                       switch (op)
                                       {
                                           case Binary::Add:
                                               return makeInt<T>(rt::iadd<T>(x, y));
                                           case Binary::Sub:
                                               return makeInt<T>(rt::isub<T>(x, y));
                                           case Binary::Mul:
                                               return makeInt<T>(rt::imul<T>(x, y));
                                           case Binary::Div:
                                               return makeInt<T>(rt::idiv<T>(x, y));
                                           case Binary::Min:
                                               return makeInt<T>(rt::imin<T>(x, y));
                                           case Binary::Max:
                                               return makeInt<T>(rt::imax<T>(x, y));
                                           default:
                                               throw json::Error("invalid operator for an integer");
                                       }
                                   });
            }

            template <class F>
            [[nodiscard]] F floatBinary(F x, F y) const
            {
                switch (op)
                {
                    case Binary::Add:
                        return static_cast<F>(x + y);
                    case Binary::Sub:
                        return static_cast<F>(x - y);
                    case Binary::Mul:
                        return static_cast<F>(x * y);
                    case Binary::Div:
                        return static_cast<F>(x / y);
                    case Binary::Min:
                        return rt::fmin<F>(x, y);
                    case Binary::Max:
                        return rt::fmax<F>(x, y);
                    case Binary::Pow:
                        return rt::fpow<F>(x, y);
                    default:
                        throw json::Error("invalid operator for a float");
                }
            }

            Binary op;
            NodePtr left, right;
        };

        struct IfNode final : Node
        {
            IfNode(Type t, NodePtr c, NodePtr a, NodePtr b)
                : Node(t), condition(std::move(c)), then(std::move(a)), otherwise(std::move(b))
            {
            }
            [[nodiscard]] Value eval(Environment& env) const override
            {
                // A value and its nullable share a representation.
                return condition->eval(env).b ? then->eval(env) : otherwise->eval(env);
            }
            NodePtr condition, then, otherwise;
        };

        struct ConvertNode final : Node
        {
            ConvertNode(Type t, NodePtr a) : Node(t), operand(std::move(a)) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                Value a = operand->eval(env);
                const Base from = operand->type.base;
                const Base to = type.base;
                if (from == to)
                    return a;
                if (to == Base::Float32)
                {
                    Value out;
                    out.f = rt::f32(a.toDouble(from));
                    return out;
                }
                if (to == Base::Float64)
                {
                    Value out;
                    out.d = a.toDouble(from);
                    return out;
                }
                return withInteger(to,
                                   [&](auto tag) -> Value
                                   {
                                       using T = decltype(tag);
                                       if (from == Base::Float32)
                                           return makeInt<T>(rt::toInt<T>(a.f));
                                       if (from == Base::Float64)
                                           return makeInt<T>(rt::toInt<T>(a.d));
                                       return withInteger(from,
                                                          [&](auto source)
                                                          {
                                                              using S = decltype(source);
                                                              return makeInt<T>(static_cast<T>(getInt<S>(a)));
                                                          });
                                   });
            }
            NodePtr operand;
        };

        struct FixedNode final : Node
        {
            FixedNode(Type t, NodePtr a, int d) : Node(t), operand(std::move(a)), digits(d) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                const Value a = operand->eval(env);
                const Base base = operand->type.base;
                if (isFloat(base))
                    return makeString(rt::fixedFloat(a.toDouble(base), digits));
                return withInteger(base,
                                   [&](auto tag)
                                   {
                                       using T = decltype(tag);
                                       return makeString(rt::fixedInt(getInt<T>(a), digits));
                                   });
            }
            NodePtr operand;
            int digits;
        };

        struct ConcatNode final : Node
        {
            ConcatNode(Type t, std::vector<NodePtr> parts) : Node(t), operands(std::move(parts)) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                std::string out;
                for (const auto& operand : operands)
                    out += operand->eval(env).s;
                return makeString(std::move(out));
            }
            std::vector<NodePtr> operands;
        };

        struct ParseNode final : Node
        {
            ParseNode(Type t, NodePtr a) : Node(t), operand(std::move(a)) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                const Value a = operand->eval(env);
                const Base base = type.base;
                if (base == Base::Float32)
                {
                    const auto parsed = rt::parseFloat<float>(a.s);
                    if (! parsed)
                        return nullValue();
                    Value out;
                    out.f = *parsed;
                    return out;
                }
                if (base == Base::Float64)
                {
                    const auto parsed = rt::parseFloat<double>(a.s);
                    if (! parsed)
                        return nullValue();
                    Value out;
                    out.d = *parsed;
                    return out;
                }
                return withInteger(base,
                                   [&](auto tag) -> Value
                                   {
                                       using T = decltype(tag);
                                       const auto parsed = rt::parseInt<T>(a.s);
                                       return parsed ? makeInt<T>(*parsed) : nullValue();
                                   });
            }
            NodePtr operand;
        };

        struct CoalesceNode final : Node
        {
            CoalesceNode(Type t, NodePtr a, NodePtr b) : Node(t), operand(std::move(a)), fallback(std::move(b)) {}
            [[nodiscard]] Value eval(Environment& env) const override
            {
                Value a = operand->eval(env);
                return a.null ? fallback->eval(env) : a;
            }
            NodePtr operand, fallback;
        };

        struct IsNullNode final : Node
        {
            IsNullNode(Type t, NodePtr a) : Node(t), operand(std::move(a)) {}
            [[nodiscard]] Value eval(Environment& env) const override { return makeBool(operand->eval(env).null); }
            NodePtr operand;
        };

        struct LetNode final : Node
        {
            LetNode(Type t, NodePtr v, std::size_t s, NodePtr b)
                : Node(t), value(std::move(v)), slot(s), body(std::move(b))
            {
            }
            [[nodiscard]] Value eval(Environment& env) const override
            {
                env.variables[slot] = value->eval(env);
                return body->eval(env);
            }
            NodePtr value;
            std::size_t slot;
            NodePtr body;
        };

        struct MapNode final : Node
        {
            MapNode(Type t, NodePtr a, std::size_t s, NodePtr b)
                : Node(t), operand(std::move(a)), slot(s), body(std::move(b))
            {
            }
            [[nodiscard]] Value eval(Environment& env) const override
            {
                Value a = operand->eval(env);
                if (a.null)
                    return nullValue();
                env.variables[slot] = std::move(a);
                return body->eval(env);
            }
            NodePtr operand;
            std::size_t slot;
            NodePtr body;
        };

        // ── Compiling a tree ─────────────────────────────────────────────────

        class Compiler
        {
        public:
            explicit Compiler(const std::vector<Expression::Input>& declared) : inputs(declared) {}

            NodePtr compile(const json::Value& node, std::size_t depth = 0)
            {
                if (depth > 256)
                    throw json::Error("expression nested too deeply");
                if (! node.isObject())
                    throw json::Error("an expression node is an object");
                const auto kind = node.at("kind").asString();
                const Type type = parseType(node.at("type").asString());
                const auto child = [&](const char* name) { return compile(node.at(name), depth + 1); };
                if (kind == "literal")
                    return std::make_unique<Literal>(type, literal(type, node.at("value")));
                if (kind == "input")
                {
                    const auto& name = node.at("name").asString();
                    for (std::size_t i = 0; i < inputs.size(); ++i)
                        if (inputs[i].name == name)
                        {
                            if (! (inputs[i].type == type))
                                throw json::Error("input \"" + name + "\" has another type");
                            return std::make_unique<InputNode>(type, i);
                        }
                    throw json::Error("unknown input \"" + name + "\"");
                }
                if (kind == "variable")
                {
                    const auto& name = node.at("name").asString();
                    // The innermost binding of the name.
                    for (const auto& [bound, slot] : std::ranges::reverse_view(scopes))
                        if (bound == name)
                            return std::make_unique<VariableNode>(type, slot);
                    throw json::Error("unknown variable \"" + name + "\"");
                }
                if (kind == "unary")
                    return std::make_unique<UnaryNode>(type, unary(node.at("operator").asString()), child("operand"));
                if (kind == "binary")
                {
                    auto left = child("left");
                    auto right = child("right");
                    return std::make_unique<BinaryNode>(type, binary(node.at("operator").asString()), std::move(left),
                                                        std::move(right));
                }
                if (kind == "if")
                {
                    auto condition = child("condition");
                    auto then = child("then");
                    auto otherwise = child("else");
                    return std::make_unique<IfNode>(type, std::move(condition), std::move(then), std::move(otherwise));
                }
                if (kind == "convert")
                    return std::make_unique<ConvertNode>(type, child("operand"));
                if (kind == "fixed")
                {
                    const auto digits = node.at("digits").asInt64();
                    if (! digits || *digits < 0 || *digits > 20)
                        throw json::Error("fixed digits are 0 to 20");
                    return std::make_unique<FixedNode>(type, child("operand"), static_cast<int>(*digits));
                }
                if (kind == "concat")
                {
                    std::vector<NodePtr> parts;
                    for (const auto& operand : node.at("operands").asArray())
                        parts.push_back(compile(operand, depth + 1));
                    return std::make_unique<ConcatNode>(type, std::move(parts));
                }
                if (kind == "parse")
                    return std::make_unique<ParseNode>(type, child("operand"));
                if (kind == "coalesce")
                {
                    auto operand = child("operand");
                    auto fallback = child("fallback");
                    return std::make_unique<CoalesceNode>(type, std::move(operand), std::move(fallback));
                }
                if (kind == "isNull")
                    return std::make_unique<IsNullNode>(type, child("operand"));
                if (kind == "let" || kind == "map")
                {
                    auto value = child(kind == "let" ? "value" : "operand");
                    const auto slot = slots++;
                    scopes.emplace_back(node.at("variable").asString(), slot);
                    auto body = child("body");
                    scopes.pop_back();
                    if (kind == "let")
                        return std::make_unique<LetNode>(type, std::move(value), slot, std::move(body));
                    return std::make_unique<MapNode>(type, std::move(value), slot, std::move(body));
                }
                throw json::Error("unknown expression kind \"" + kind + "\"");
            }

            std::size_t slots = 0;

        private:
            static Value literal(const Type& type, const json::Value& value)
            {
                if (value.isNull())
                {
                    if (! type.nullable)
                        throw json::Error("null literal of a type that is not nullable");
                    return nullValue();
                }
                switch (type.base)
                {
                    case Base::Boolean:
                        return makeBool(value.asBoolean());
                    case Base::String:
                        return makeString(value.asString());
                    case Base::Float32:
                    {
                        Value out;
                        out.f = rt::f32(value.asNumber());
                        return out;
                    }
                    case Base::Float64:
                        return makeFloat(Base::Float64, value.asNumber());
                    default:
                        break;
                }
                // Integers: a number, or a decimal string (64-bit values).
                const json::Value number = value.isString() ? json::Value::numberText(value.asString()) : value;
                if (isSigned(type.base))
                {
                    const auto parsed = number.asInt64();
                    if (! parsed)
                        throw json::Error("invalid integer literal");
                    return withInteger(type.base, [&](auto tag)
                                       { return makeInt<decltype(tag)>(static_cast<decltype(tag)>(*parsed)); });
                }
                const auto parsed = number.asUint64();
                if (! parsed)
                    throw json::Error("invalid integer literal");
                return withInteger(type.base, [&](auto tag)
                                   { return makeInt<decltype(tag)>(static_cast<decltype(tag)>(*parsed)); });
            }

            static Unary unary(const std::string& name)
            {
                static constexpr std::pair<std::string_view, Unary> names[] = {
                    { "neg", Unary::Neg },   { "abs", Unary::Abs },     { "sqrt", Unary::Sqrt },
                    { "exp", Unary::Exp },   { "log", Unary::Log },     { "floor", Unary::Floor },
                    { "ceil", Unary::Ceil }, { "round", Unary::Round }, { "not", Unary::Not },
                    { "trim", Unary::Trim }, { "lower", Unary::Lower },
                };
                for (const auto& [text, op] : names)
                    if (text == name)
                        return op;
                throw json::Error("unknown unary operator \"" + name + "\"");
            }

            static Binary binary(const std::string& name)
            {
                static constexpr std::pair<std::string_view, Binary> names[] = {
                    { "add", Binary::Add },
                    { "sub", Binary::Sub },
                    { "mul", Binary::Mul },
                    { "div", Binary::Div },
                    { "min", Binary::Min },
                    { "max", Binary::Max },
                    { "pow", Binary::Pow },
                    { "eq", Binary::Eq },
                    { "ne", Binary::Ne },
                    { "lt", Binary::Lt },
                    { "lte", Binary::Lte },
                    { "gt", Binary::Gt },
                    { "gte", Binary::Gte },
                    { "and", Binary::And },
                    { "or", Binary::Or },
                    { "endsWith", Binary::EndsWith },
                    { "removeSuffix", Binary::RemoveSuffix },
                };
                for (const auto& [text, op] : names)
                    if (text == name)
                        return op;
                throw json::Error("unknown binary operator \"" + name + "\"");
            }

            const std::vector<Expression::Input>& inputs;
            std::vector<std::pair<std::string, std::size_t>> scopes;
        };
    } // namespace

    Expression::Expression() = default;
    Expression::~Expression() = default;
    Expression::Expression(Expression&&) noexcept = default;
    Expression& Expression::operator=(Expression&&) noexcept = default;

    Expression Expression::compile(const json::Value& tree, const std::vector<Input>& inputs)
    {
        Compiler compiler(inputs);
        Expression out;
        out.root = compiler.compile(tree);
        out.inputCount = inputs.size();
        out.variableCount = compiler.slots;
        return out;
    }

    Type Expression::type() const noexcept
    {
        return root ? root->type : Type {};
    }

    Value Expression::evaluate(const Value* inputs, std::size_t count) const
    {
        if (! root || count != inputCount)
            throw json::Error("an expression evaluated with the wrong inputs");
        // Variables on the stack for ordinary trees: no allocation.
        constexpr std::size_t inlineVariables = 8;
        if (variableCount <= inlineVariables)
        {
            std::array<Value, inlineVariables> variables {};
            Environment env { inputs, variables.data() };
            return root->eval(env);
        }
        std::vector<Value> variables(variableCount);
        Environment env { inputs, variables.data() };
        return root->eval(env);
    }
} // namespace soundor::vst3::expression
