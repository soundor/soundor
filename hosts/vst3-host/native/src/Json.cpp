#include "Json.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <locale>
#include <sstream>

namespace soundor::vst3host
{
    const Json* Json::find(std::string_view key) const
    {
        if (type_ != Type::Object)
            return nullptr;
        for (const auto& [name, value] : object_)
            if (name == key)
                return &value;
        return nullptr;
    }

    Json& Json::set(std::string key, Json value)
    {
        for (auto& [name, existing] : object_)
            if (name == key)
                return existing = std::move(value);
        object_.emplace_back(std::move(key), std::move(value));
        return object_.back().second;
    }

    std::string Json::dump() const
    {
        std::string out;
        dumpTo(out);
        return out;
    }

    namespace
    {
        void dumpString(std::string& out, const std::string& value)
        {
            out += '"';
            for (const char c : value)
            {
                const auto byte = static_cast<unsigned char>(c);
                switch (c)
                {
                    case '"':
                        out += "\\\"";
                        break;
                    case '\\':
                        out += "\\\\";
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
                        if (byte < 0x20)
                        {
                            std::array<char, 8> escaped {};
                            std::snprintf(escaped.data(), escaped.size(), "\\u%04x", byte);
                            out += escaped.data();
                        }
                        else
                            out += c;
                }
            }
            out += '"';
        }
    } // namespace

    void Json::dumpTo(std::string& out) const
    {
        switch (type_)
        {
            case Type::Null:
                out += "null";
                break;
            case Type::Bool:
                out += bool_ ? "true" : "false";
                break;
            case Type::Number:
            {
                if (! std::isfinite(number_))
                {
                    out += "null";
                    break;
                }
                if (number_ == std::floor(number_) && std::fabs(number_) < 9007199254740992.0)
                {
                    out += std::to_string(static_cast<long long>(number_));
                    break;
                }
                std::ostringstream stream;
                stream.imbue(std::locale::classic());
                stream.precision(17);
                stream << number_;
                out += stream.str();
                break;
            }
            case Type::String:
                dumpString(out, string_);
                break;
            case Type::Array:
            {
                out += '[';
                bool first = true;
                for (const auto& item : array_)
                {
                    if (! first)
                        out += ',';
                    first = false;
                    item.dumpTo(out);
                }
                out += ']';
                break;
            }
            case Type::Object:
            {
                out += '{';
                bool first = true;
                for (const auto& [name, value] : object_)
                {
                    if (! first)
                        out += ',';
                    first = false;
                    dumpString(out, name);
                    out += ':';
                    value.dumpTo(out);
                }
                out += '}';
                break;
            }
        }
    }

    namespace
    {
        class Parser
        {
        public:
            explicit Parser(std::string_view text) : text_(text) {}

            Json document()
            {
                Json value = parseValue(0);
                skipSpace();
                if (pos_ != text_.size())
                    fail("unexpected data after the value");
                return value;
            }

        private:
            static constexpr int maxDepth = 64;

            [[noreturn]] void fail(const std::string& what) const
            {
                throw JsonError("invalid JSON at offset " + std::to_string(pos_) + ": " + what);
            }

            void skipSpace()
            {
                while (pos_ < text_.size()
                       && (text_[pos_] == ' ' || text_[pos_] == '\n' || text_[pos_] == '\r' || text_[pos_] == '\t'))
                    ++pos_;
            }

            bool consume(std::string_view literal)
            {
                if (text_.substr(pos_, literal.size()) != literal)
                    return false;
                pos_ += literal.size();
                return true;
            }

            Json parseValue(int depth)
            {
                if (depth > maxDepth)
                    fail("nested too deeply");
                skipSpace();
                if (pos_ >= text_.size())
                    fail("unexpected end");
                const char c = text_[pos_];
                if (c == '{')
                    return parseObject(depth);
                if (c == '[')
                    return parseArray(depth);
                if (c == '"')
                    return { parseString() };
                if (consume("true"))
                    return { true };
                if (consume("false"))
                    return { false };
                if (consume("null"))
                    return { nullptr };
                if (c == '-' || (c >= '0' && c <= '9'))
                    return { parseNumber() };
                fail(std::string("unexpected character '") + c + "'");
            }

            Json parseObject(int depth)
            {
                ++pos_;
                Json result = Json::object();
                skipSpace();
                if (pos_ < text_.size() && text_[pos_] == '}')
                {
                    ++pos_;
                    return result;
                }
                while (true)
                {
                    skipSpace();
                    if (pos_ >= text_.size() || text_[pos_] != '"')
                        fail("expected a member name");
                    std::string key = parseString();
                    skipSpace();
                    if (pos_ >= text_.size() || text_[pos_] != ':')
                        fail("expected ':'");
                    ++pos_;
                    result.set(std::move(key), parseValue(depth + 1));
                    skipSpace();
                    if (pos_ < text_.size() && text_[pos_] == ',')
                    {
                        ++pos_;
                        continue;
                    }
                    if (pos_ < text_.size() && text_[pos_] == '}')
                    {
                        ++pos_;
                        return result;
                    }
                    fail("expected ',' or '}'");
                }
            }

            Json parseArray(int depth)
            {
                ++pos_;
                Json result = Json::array();
                skipSpace();
                if (pos_ < text_.size() && text_[pos_] == ']')
                {
                    ++pos_;
                    return result;
                }
                while (true)
                {
                    result.push(parseValue(depth + 1));
                    skipSpace();
                    if (pos_ < text_.size() && text_[pos_] == ',')
                    {
                        ++pos_;
                        continue;
                    }
                    if (pos_ < text_.size() && text_[pos_] == ']')
                    {
                        ++pos_;
                        return result;
                    }
                    fail("expected ',' or ']'");
                }
            }

            unsigned hex4()
            {
                if (pos_ + 4 > text_.size())
                    fail("truncated \\u escape");
                unsigned value = 0;
                for (int i = 0; i < 4; ++i)
                {
                    const char c = text_[pos_++];
                    value <<= 4U;
                    if (c >= '0' && c <= '9')
                        value |= static_cast<unsigned>(c - '0');
                    else if (c >= 'a' && c <= 'f')
                        value |= static_cast<unsigned>(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F')
                        value |= static_cast<unsigned>(c - 'A' + 10);
                    else
                        fail("invalid \\u escape");
                }
                return value;
            }

            static void appendUtf8(std::string& out, unsigned code)
            {
                if (code < 0x80)
                    out += static_cast<char>(code);
                else if (code < 0x800)
                {
                    out += static_cast<char>(0xC0U | (code >> 6U));
                    out += static_cast<char>(0x80U | (code & 0x3FU));
                }
                else if (code < 0x10000)
                {
                    out += static_cast<char>(0xE0U | (code >> 12U));
                    out += static_cast<char>(0x80U | ((code >> 6U) & 0x3FU));
                    out += static_cast<char>(0x80U | (code & 0x3FU));
                }
                else
                {
                    out += static_cast<char>(0xF0U | (code >> 18U));
                    out += static_cast<char>(0x80U | ((code >> 12U) & 0x3FU));
                    out += static_cast<char>(0x80U | ((code >> 6U) & 0x3FU));
                    out += static_cast<char>(0x80U | (code & 0x3FU));
                }
            }

            std::string parseString()
            {
                ++pos_;
                std::string out;
                while (true)
                {
                    if (pos_ >= text_.size())
                        fail("unterminated string");
                    const char c = text_[pos_++];
                    if (c == '"')
                        return out;
                    if (static_cast<unsigned char>(c) < 0x20)
                        fail("control character in string");
                    if (c != '\\')
                    {
                        out += c;
                        continue;
                    }
                    if (pos_ >= text_.size())
                        fail("unterminated escape");
                    const char escape = text_[pos_++];
                    switch (escape)
                    {
                        case '"':
                        case '\\':
                        case '/':
                            out += escape;
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
                            unsigned code = hex4();
                            if (code >= 0xD800 && code < 0xDC00)
                            {
                                if (! consume("\\u"))
                                    fail("unpaired surrogate");
                                const unsigned low = hex4();
                                if (low < 0xDC00 || low >= 0xE000)
                                    fail("unpaired surrogate");
                                code = 0x10000 + ((code - 0xD800) << 10U) + (low - 0xDC00);
                            }
                            else if (code >= 0xDC00 && code < 0xE000)
                                fail("unpaired surrogate");
                            appendUtf8(out, code);
                            break;
                        }
                        default:
                            fail("invalid escape");
                    }
                }
            }

            double parseNumber()
            {
                const size_t start = pos_;
                if (text_[pos_] == '-')
                    ++pos_;
                auto digits = [this]
                {
                    const size_t from = pos_;
                    while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9')
                        ++pos_;
                    return pos_ - from;
                };
                if (digits() == 0)
                    fail("invalid number");
                if (pos_ < text_.size() && text_[pos_] == '.')
                {
                    ++pos_;
                    if (digits() == 0)
                        fail("invalid number");
                }
                if (pos_ < text_.size() && (text_[pos_] == 'e' || text_[pos_] == 'E'))
                {
                    ++pos_;
                    if (pos_ < text_.size() && (text_[pos_] == '+' || text_[pos_] == '-'))
                        ++pos_;
                    if (digits() == 0)
                        fail("invalid number");
                }
                // The classic locale: a plugin may change the process's C locale.
                std::istringstream stream { std::string(text_.substr(start, pos_ - start)) };
                stream.imbue(std::locale::classic());
                double value = 0;
                stream >> value;
                return value;
            }

            std::string_view text_;
            size_t pos_ = 0;
        };
    } // namespace

    Json Json::parse(std::string_view text)
    {
        return Parser(text).document();
    }
} // namespace soundor::vst3host
