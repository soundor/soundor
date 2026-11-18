#include "Json.h"

#include <charconv>
#include <cmath>
#include <limits>
#include <system_error>

namespace soundor::vst3::json
{
    Value Value::boolean(bool value)
    {
        Value out;
        out.type = Kind::Boolean;
        out.flag = value;
        return out;
    }

    Value Value::numberText(std::string text)
    {
        Value out;
        out.type = Kind::Number;
        out.text = std::move(text);
        return out;
    }

    Value Value::number(double value)
    {
        if (! std::isfinite(value))
            throw Error("JSON numbers are finite");
        return numberText(formatNumber(value));
    }

    Value Value::integer(std::int64_t value) { return numberText(std::to_string(value)); }
    Value Value::unsignedInteger(std::uint64_t value) { return numberText(std::to_string(value)); }

    Value Value::string(std::string value)
    {
        Value out;
        out.type = Kind::String;
        out.text = std::move(value);
        return out;
    }

    Value Value::array(std::vector<Value> values)
    {
        Value out;
        out.type = Kind::Array;
        out.items = std::move(values);
        return out;
    }

    Value Value::object(std::vector<Member> values)
    {
        Value out;
        out.type = Kind::Object;
        out.members = std::move(values);
        return out;
    }

    namespace
    {
        const char* kindName(Value::Kind kind)
        {
            switch (kind)
            {
            case Value::Kind::Null:
                return "null";
            case Value::Kind::Boolean:
                return "a boolean";
            case Value::Kind::Number:
                return "a number";
            case Value::Kind::String:
                return "a string";
            case Value::Kind::Array:
                return "an array";
            case Value::Kind::Object:
                return "an object";
            }
            return "a value";
        }

        [[noreturn]] void wrongKind(Value::Kind expected, Value::Kind actual)
        {
            throw Error(std::string("expected ") + kindName(expected) + ", not " + kindName(actual));
        }
    } // namespace

    bool Value::asBoolean() const
    {
        if (type != Kind::Boolean)
            wrongKind(Kind::Boolean, type);
        return flag;
    }

    double Value::asNumber() const
    {
        if (type != Kind::Number)
            wrongKind(Kind::Number, type);
        double out = 0;
        const auto* end = text.data() + text.size();
        const auto result = std::from_chars(text.data(), end, out);
        if (result.ec == std::errc::result_out_of_range)
        {
            // A subnormal reads as itself; only overflow is an error.
            if (std::isinf(out) || out == 0)
            {
                const bool tiny = text.find_first_of("eE") != std::string::npos
                                  && text.find("e-") != std::string::npos;
                if (! tiny)
                    throw Error("number out of range: " + text);
            }
        }
        else if (result.ec != std::errc {} || result.ptr != end)
            throw Error("invalid number: " + text);
        return out;
    }

    const std::string& Value::numberText() const
    {
        if (type != Kind::Number)
            wrongKind(Kind::Number, type);
        return text;
    }

    std::optional<std::int64_t> Value::asInt64() const
    {
        if (type != Kind::Number)
            return std::nullopt;
        std::int64_t out = 0;
        const auto* end = text.data() + text.size();
        const auto result = std::from_chars(text.data(), end, out);
        if (result.ec == std::errc {} && result.ptr == end)
            return out;
        // An integral double ("2.0", "1e3") within range is an integer too.
        const double number = asNumber();
        if (std::trunc(number) == number && number >= -9007199254740992.0 && number <= 9007199254740992.0)
            return static_cast<std::int64_t>(number);
        return std::nullopt;
    }

    std::optional<std::uint64_t> Value::asUint64() const
    {
        if (type != Kind::Number)
            return std::nullopt;
        std::uint64_t out = 0;
        const auto* end = text.data() + text.size();
        const auto result = std::from_chars(text.data(), end, out);
        if (result.ec == std::errc {} && result.ptr == end)
            return out;
        const double number = asNumber();
        if (std::trunc(number) == number && number >= 0 && number <= 9007199254740992.0)
            return static_cast<std::uint64_t>(number);
        return std::nullopt;
    }

    const std::string& Value::asString() const
    {
        if (type != Kind::String)
            wrongKind(Kind::String, type);
        return text;
    }

    const std::vector<Value>& Value::asArray() const
    {
        if (type != Kind::Array)
            wrongKind(Kind::Array, type);
        return items;
    }

    std::vector<Value>& Value::asArray()
    {
        if (type != Kind::Array)
            wrongKind(Kind::Array, type);
        return items;
    }

    const std::vector<Value::Member>& Value::asObject() const
    {
        if (type != Kind::Object)
            wrongKind(Kind::Object, type);
        return members;
    }

    std::vector<Value::Member>& Value::asObject()
    {
        if (type != Kind::Object)
            wrongKind(Kind::Object, type);
        return members;
    }

    const Value* Value::find(std::string_view name) const noexcept
    {
        if (type != Kind::Object)
            return nullptr;
        for (const auto& [key, value] : members)
            if (key == name)
                return &value;
        return nullptr;
    }

    const Value& Value::at(std::string_view name) const
    {
        if (const auto* value = find(name))
            return *value;
        throw Error("missing member \"" + std::string(name) + "\"");
    }

    std::string Value::stringOr(std::string_view name, std::string fallback) const
    {
        const auto* value = find(name);
        return value != nullptr && value->isString() ? value->asString() : std::move(fallback);
    }

    double Value::numberOr(std::string_view name, double fallback) const
    {
        const auto* value = find(name);
        return value != nullptr && value->isNumber() ? value->asNumber() : fallback;
    }

    bool Value::booleanOr(std::string_view name, bool fallback) const
    {
        const auto* value = find(name);
        return value != nullptr && value->isBoolean() ? value->asBoolean() : fallback;
    }

    void Value::set(std::string name, Value value)
    {
        if (type != Kind::Object)
            wrongKind(Kind::Object, type);
        for (auto& [key, member] : members)
            if (key == name)
            {
                member = std::move(value);
                return;
            }
        members.emplace_back(std::move(name), std::move(value));
    }

    bool operator==(const Value& a, const Value& b)
    {
        if (a.type != b.type)
            return false;
        switch (a.type)
        {
        case Value::Kind::Null:
            return true;
        case Value::Kind::Boolean:
            return a.flag == b.flag;
        case Value::Kind::Number:
            return a.text == b.text || a.asNumber() == b.asNumber();
        case Value::Kind::String:
            return a.text == b.text;
        case Value::Kind::Array:
            return a.items == b.items;
        case Value::Kind::Object:
            return a.members == b.members;
        }
        return false;
    }

    bool validUtf8(std::string_view text) noexcept
    {
        std::size_t i = 0;
        while (i < text.size())
        {
            const auto c = static_cast<unsigned char>(text[i]);
            if (c < 0x80)
            {
                ++i;
                continue;
            }
            std::size_t length = 0;
            std::uint32_t code = 0;
            if ((c & 0xE0) == 0xC0)
            {
                length = 2;
                code = c & 0x1F;
            }
            else if ((c & 0xF0) == 0xE0)
            {
                length = 3;
                code = c & 0x0F;
            }
            else if ((c & 0xF8) == 0xF0)
            {
                length = 4;
                code = c & 0x07;
            }
            else
                return false;
            if (i + length > text.size())
                return false;
            for (std::size_t k = 1; k < length; ++k)
            {
                const auto next = static_cast<unsigned char>(text[i + k]);
                if ((next & 0xC0) != 0x80)
                    return false;
                code = (code << 6) | (next & 0x3F);
            }
            constexpr std::uint32_t minimum[] = { 0, 0, 0x80, 0x800, 0x10000 };
            if (code < minimum[length] || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF))
                return false;
            i += length;
        }
        return true;
    }

    namespace
    {
        void appendUtf8(std::string& out, std::uint32_t code)
        {
            if (code < 0x80)
                out += static_cast<char>(code);
            else if (code < 0x800)
            {
                out += static_cast<char>(0xC0 | (code >> 6));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
            else if (code < 0x10000)
            {
                out += static_cast<char>(0xE0 | (code >> 12));
                out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
            else
            {
                out += static_cast<char>(0xF0 | (code >> 18));
                out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
                out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (code & 0x3F));
            }
        }

        class Parser
        {
        public:
            Parser(std::string_view input, const Limits& limits) : text(input), limit(limits), budget(limits.values) {}

            Value document()
            {
                if (text.size() > limit.bytes)
                    throw Error("JSON text exceeds " + std::to_string(limit.bytes) + " bytes");
                if (! validUtf8(text))
                    throw Error("JSON text is not valid UTF-8");
                auto out = value(0);
                whitespace();
                if (position != text.size())
                    fail("unexpected text after the value");
                return out;
            }

        private:
            [[noreturn]] void fail(const std::string& what) const
            {
                throw Error("invalid JSON at offset " + std::to_string(position) + ": " + what);
            }

            void whitespace()
            {
                while (position < text.size()
                       && (text[position] == ' ' || text[position] == '\t' || text[position] == '\r'
                           || text[position] == '\n'))
                    ++position;
            }

            bool take(char c)
            {
                whitespace();
                if (position < text.size() && text[position] == c)
                {
                    ++position;
                    return true;
                }
                return false;
            }

            unsigned hex4()
            {
                if (position + 4 > text.size())
                    fail("truncated \\u escape");
                unsigned out = 0;
                for (int k = 0; k < 4; ++k)
                {
                    const char c = text[position++];
                    unsigned digit = 0;
                    if (c >= '0' && c <= '9')
                        digit = static_cast<unsigned>(c - '0');
                    else if (c >= 'a' && c <= 'f')
                        digit = static_cast<unsigned>(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F')
                        digit = static_cast<unsigned>(c - 'A' + 10);
                    else
                        fail("invalid \\u escape");
                    out = out * 16 + digit;
                }
                return out;
            }

            std::string string()
            {
                whitespace();
                if (position >= text.size() || text[position] != '"')
                    fail("expected a string");
                ++position;
                std::string out;
                while (true)
                {
                    if (position >= text.size())
                        fail("unterminated string");
                    const char c = text[position++];
                    if (c == '"')
                        return out;
                    if (static_cast<unsigned char>(c) < 0x20)
                        fail("control character in a string");
                    if (c != '\\')
                    {
                        out += c;
                        continue;
                    }
                    if (position >= text.size())
                        fail("truncated escape");
                    switch (text[position++])
                    {
                    case '"':
                        out += '"';
                        break;
                    case '\\':
                        out += '\\';
                        break;
                    case '/':
                        out += '/';
                        break;
                    case 'b':
                        out += '\b';
                        break;
                    case 'f':
                        out += '\f';
                        break;
                    case 'n':
                        out += '\n';
                        break;
                    case 'r':
                        out += '\r';
                        break;
                    case 't':
                        out += '\t';
                        break;
                    case 'u':
                    {
                        std::uint32_t code = hex4();
                        if (code >= 0xDC00 && code <= 0xDFFF)
                            fail("unpaired surrogate");
                        if (code >= 0xD800 && code <= 0xDBFF)
                        {
                            if (position + 2 > text.size() || text[position] != '\\' || text[position + 1] != 'u')
                                fail("unpaired surrogate");
                            position += 2;
                            const auto low = hex4();
                            if (low < 0xDC00 || low > 0xDFFF)
                                fail("unpaired surrogate");
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                        }
                        appendUtf8(out, code);
                        break;
                    }
                    default:
                        fail("invalid escape");
                    }
                }
            }

            Value number()
            {
                const auto start = position;
                const auto digit = [&] { return position < text.size() && text[position] >= '0' && text[position] <= '9'; };
                if (position < text.size() && text[position] == '-')
                    ++position;
                if (! digit())
                    fail("expected a value");
                if (text[position] == '0')
                    ++position;
                else
                    while (digit())
                        ++position;
                if (position < text.size() && text[position] == '.')
                {
                    ++position;
                    if (! digit())
                        fail("expected a digit after '.'");
                    while (digit())
                        ++position;
                }
                if (position < text.size() && (text[position] == 'e' || text[position] == 'E'))
                {
                    ++position;
                    if (position < text.size() && (text[position] == '+' || text[position] == '-'))
                        ++position;
                    if (! digit())
                        fail("expected an exponent");
                    while (digit())
                        ++position;
                }
                auto out = Value::numberText(std::string(text.substr(start, position - start)));
                static_cast<void>(out.asNumber()); // rejects overflow
                return out;
            }

            Value value(std::size_t depth)
            {
                whitespace();
                if (depth > limit.depth)
                    fail("nested too deeply");
                if (budget == 0)
                    fail("too many values");
                --budget;
                if (position >= text.size())
                    fail("expected a value");
                const char c = text[position];
                if (c == '"')
                    return Value::string(string());
                if (c == '{')
                {
                    ++position;
                    std::vector<Value::Member> members;
                    if (take('}'))
                        return Value::object(std::move(members));
                    do
                    {
                        auto name = string();
                        if (! take(':'))
                            fail("expected ':'");
                        for (const auto& [key, member] : members)
                            if (key == name)
                                fail("duplicate member \"" + name + "\"");
                        auto member = value(depth + 1);
                        members.emplace_back(std::move(name), std::move(member));
                    } while (take(','));
                    if (! take('}'))
                        fail("expected ',' or '}'");
                    return Value::object(std::move(members));
                }
                if (c == '[')
                {
                    ++position;
                    std::vector<Value> items;
                    if (take(']'))
                        return Value::array(std::move(items));
                    do
                        items.push_back(value(depth + 1));
                    while (take(','));
                    if (! take(']'))
                        fail("expected ',' or ']'");
                    return Value::array(std::move(items));
                }
                for (const auto literal : { std::string_view("true"), std::string_view("false"), std::string_view("null") })
                    if (text.substr(position, literal.size()) == literal)
                    {
                        position += literal.size();
                        return literal == "null" ? Value::null() : Value::boolean(literal == "true");
                    }
                return number();
            }

            std::string_view text;
            Limits limit;
            std::size_t position = 0;
            std::size_t budget;
        };

        void writeTo(std::string& out, const Value& value)
        {
            switch (value.kind())
            {
            case Value::Kind::Null:
                out += "null";
                return;
            case Value::Kind::Boolean:
                out += value.asBoolean() ? "true" : "false";
                return;
            case Value::Kind::Number:
                out += value.numberText();
                return;
            case Value::Kind::String:
                out += quote(value.asString());
                return;
            case Value::Kind::Array:
            {
                out += '[';
                bool first = true;
                for (const auto& item : value.asArray())
                {
                    if (! first)
                        out += ',';
                    first = false;
                    writeTo(out, item);
                }
                out += ']';
                return;
            }
            case Value::Kind::Object:
            {
                out += '{';
                bool first = true;
                for (const auto& [key, member] : value.asObject())
                {
                    if (! first)
                        out += ',';
                    first = false;
                    out += quote(key);
                    out += ':';
                    writeTo(out, member);
                }
                out += '}';
                return;
            }
            }
        }
    } // namespace

    Value parse(std::string_view text, const Limits& limits) { return Parser(text, limits).document(); }

    std::string write(const Value& value)
    {
        std::string out;
        writeTo(out, value);
        return out;
    }

    std::string quote(std::string_view text)
    {
        std::string out;
        out.reserve(text.size() + 2);
        out += '"';
        for (const char c : text)
        {
            switch (c)
            {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\b':
                out += "\\b";
                break;
            case '\f':
                out += "\\f";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (static_cast<unsigned char>(c) < 0x20)
                {
                    constexpr char digits[] = "0123456789abcdef";
                    out += "\\u00";
                    out += digits[(c >> 4) & 0xF];
                    out += digits[c & 0xF];
                }
                else
                    out += c;
            }
        }
        out += '"';
        return out;
    }

    std::string formatNumber(double value)
    {
        if (! std::isfinite(value))
            throw Error("JSON numbers are finite");
        if (value == 0)
            return "0";
        // The shortest digits that read back as `value`, and their exponent.
        char buffer[64];
        const auto result = std::to_chars(buffer, buffer + sizeof buffer, value, std::chars_format::scientific);
        std::string_view scientific(buffer, static_cast<std::size_t>(result.ptr - buffer));
        const bool negative = scientific.front() == '-';
        if (negative)
            scientific.remove_prefix(1);
        const auto e = scientific.find('e');
        std::string digits;
        for (const char c : scientific.substr(0, e))
            if (c != '.')
                digits += c;
        int exponent = 0;
        std::from_chars(scientific.data() + e + 1, scientific.data() + scientific.size(), exponent);
        // ECMAScript Number::toString: k digits, n the decimal point's position.
        const int k = static_cast<int>(digits.size());
        const int n = exponent + 1;
        std::string out = negative ? "-" : "";
        if (k <= n && n <= 21)
        {
            out += digits;
            out.append(static_cast<std::size_t>(n - k), '0');
        }
        else if (0 < n && n <= 21)
        {
            out += digits.substr(0, static_cast<std::size_t>(n));
            out += '.';
            out += digits.substr(static_cast<std::size_t>(n));
        }
        else if (-6 < n && n <= 0)
        {
            out += "0.";
            out.append(static_cast<std::size_t>(-n), '0');
            out += digits;
        }
        else
        {
            out += digits.substr(0, 1);
            if (k > 1)
            {
                out += '.';
                out += digits.substr(1);
            }
            out += 'e';
            out += n - 1 >= 0 ? '+' : '-';
            out += std::to_string(std::abs(n - 1));
        }
        return out;
    }
} // namespace soundor::vst3::json
