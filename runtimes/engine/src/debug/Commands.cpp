#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS

    #include <charconv>
    #include <cstdint>
    #include <locale>
    #include <sstream>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    namespace
    {
        constexpr int maxDepth = 64;

        // A recursive-descent reader of RFC 8259 JSON. Anything else, or
        // anything nested deeper than maxDepth, fails the whole document.
        class Reader
        {
        public:
            explicit Reader(std::string_view json) : text(json) {}

            std::optional<Value> document()
            {
                auto value = read(0);
                space();
                if (! value || at != text.size())
                    return {};
                return value;
            }

        private:
            std::string_view text;
            std::size_t at = 0;

            void space()
            {
                while (at < text.size()
                       && (text[at] == ' ' || text[at] == '\t' || text[at] == '\n' || text[at] == '\r'))
                    ++at;
            }
            bool literal(std::string_view word)
            {
                if (text.substr(at, word.size()) != word)
                    return false;
                at += word.size();
                return true;
            }
            std::optional<Value> read(int depth)
            {
                if (depth >= maxDepth)
                    return {};
                space();
                if (at >= text.size())
                    return {};
                switch (text[at])
                {
                    case '{':
                        return object(depth);
                    case '[':
                        return array(depth);
                    case '"':
                    {
                        auto value = string();
                        if (! value)
                            return {};
                        return Value(std::move(*value));
                    }
                    case 't':
                        return literal("true") ? std::optional<Value>(Value(true)) : std::nullopt;
                    case 'f':
                        return literal("false") ? std::optional<Value>(Value(false)) : std::nullopt;
                    case 'n':
                        return literal("null") ? std::optional<Value>(Value()) : std::nullopt;
                    default:
                        return number();
                }
            }
            std::optional<Value> object(int depth)
            {
                ++at;
                Value::Object out;
                space();
                if (at < text.size() && text[at] == '}')
                {
                    ++at;
                    return Value(std::move(out));
                }
                for (;;)
                {
                    space();
                    if (at >= text.size() || text[at] != '"')
                        return {};
                    auto key = string();
                    space();
                    if (! key || at >= text.size() || text[at] != ':')
                        return {};
                    ++at;
                    auto value = read(depth + 1);
                    if (! value)
                        return {};
                    out.insert_or_assign(std::move(*key), std::move(*value));
                    space();
                    if (at < text.size() && text[at] == ',')
                    {
                        ++at;
                        continue;
                    }
                    if (at < text.size() && text[at] == '}')
                    {
                        ++at;
                        return Value(std::move(out));
                    }
                    return {};
                }
            }
            std::optional<Value> array(int depth)
            {
                ++at;
                Value::Array out;
                space();
                if (at < text.size() && text[at] == ']')
                {
                    ++at;
                    return Value(std::move(out));
                }
                for (;;)
                {
                    auto value = read(depth + 1);
                    if (! value)
                        return {};
                    out.push_back(std::move(*value));
                    space();
                    if (at < text.size() && text[at] == ',')
                    {
                        ++at;
                        continue;
                    }
                    if (at < text.size() && text[at] == ']')
                    {
                        ++at;
                        return Value(std::move(out));
                    }
                    return {};
                }
            }
            std::optional<unsigned> hex4()
            {
                if (at + 4 > text.size())
                    return {};
                unsigned out = 0;
                const auto result = std::from_chars(text.data() + at, text.data() + at + 4, out, 16);
                if (result.ec != std::errc() || result.ptr != text.data() + at + 4)
                    return {};
                at += 4;
                return out;
            }
            static void utf8(std::string& out, std::uint32_t code)
            {
                if (code < 0x80)
                    out += static_cast<char>(code);
                else if (code < 0x800)
                {
                    out += static_cast<char>(0xc0 | (code >> 6));
                    out += static_cast<char>(0x80 | (code & 0x3f));
                }
                else if (code < 0x10000)
                {
                    out += static_cast<char>(0xe0 | (code >> 12));
                    out += static_cast<char>(0x80 | ((code >> 6) & 0x3f));
                    out += static_cast<char>(0x80 | (code & 0x3f));
                }
                else
                {
                    out += static_cast<char>(0xf0 | (code >> 18));
                    out += static_cast<char>(0x80 | ((code >> 12) & 0x3f));
                    out += static_cast<char>(0x80 | ((code >> 6) & 0x3f));
                    out += static_cast<char>(0x80 | (code & 0x3f));
                }
            }
            std::optional<std::string> string()
            {
                ++at;
                std::string out;
                while (at < text.size())
                {
                    const char character = text[at++];
                    if (character == '"')
                        return out;
                    if (static_cast<unsigned char>(character) < 0x20)
                        return {};
                    if (character != '\\')
                    {
                        out += character;
                        continue;
                    }
                    if (at >= text.size())
                        return {};
                    switch (text[at++])
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
                            auto code = hex4();
                            if (! code)
                                return {};
                            std::uint32_t point = *code;
                            if (point >= 0xd800 && point < 0xdc00)
                            {
                                // A high surrogate needs its low one.
                                if (! literal("\\u"))
                                    return {};
                                auto low = hex4();
                                if (! low || *low < 0xdc00 || *low >= 0xe000)
                                    return {};
                                point = 0x10000 + ((point - 0xd800) << 10) + (*low - 0xdc00);
                            }
                            else if (point >= 0xdc00 && point < 0xe000)
                                return {};
                            utf8(out, point);
                            break;
                        }
                        default:
                            return {};
                    }
                }
                return {};
            }
            std::optional<Value> number()
            {
                const std::size_t start = at;
                const auto digits = [&]
                {
                    const std::size_t from = at;
                    while (at < text.size() && text[at] >= '0' && text[at] <= '9')
                        ++at;
                    return at > from;
                };
                if (at < text.size() && text[at] == '-')
                    ++at;
                if (at < text.size() && text[at] == '0')
                    ++at;
                else if (! digits())
                    return {};
                if (at < text.size() && text[at] == '.')
                {
                    ++at;
                    if (! digits())
                        return {};
                }
                if (at < text.size() && (text[at] == 'e' || text[at] == 'E'))
                {
                    ++at;
                    if (at < text.size() && (text[at] == '+' || text[at] == '-'))
                        ++at;
                    if (! digits())
                        return {};
                }
                // In the classic locale whatever the host set; not
                // std::from_chars, which the macOS 12 library lacks for doubles.
                std::istringstream in(std::string(text.substr(start, at - start)));
                in.imbue(std::locale::classic());
                double value = 0;
                in >> value;
                if (in.fail())
                    return {};
                return Value(value);
            }
        };

        const std::string* stringField(const Value::Object& object, const char* name)
        {
            const auto found = object.find(name);
            return found == object.end() ? nullptr : std::get_if<std::string>(&found->second.data);
        }
        std::optional<double> numberField(const Value::Object& object, const char* name)
        {
            const auto found = object.find(name);
            if (found == object.end())
                return {};
            if (const auto* number = std::get_if<double>(&found->second.data))
                return *number;
            return {};
        }
        unsigned positive(std::optional<double> value)
        {
            return value && *value >= 1 && *value <= 4294967295.0
                           && *value == static_cast<double>(static_cast<unsigned>(*value))
                       ? static_cast<unsigned>(*value)
                       : 0;
        }
    } // namespace

    std::optional<Value> Value::parse(std::string_view json)
    {
        return Reader(json).document();
    }

    std::optional<Command> Command::parse(const Value& value)
    {
        const auto* object = std::get_if<Value::Object>(&value.data);
        if (! object)
            return {};
        const auto* type = stringField(*object, "type");
        if (! type)
            return {};
        Command command;
        if (*type == "subscribe")
        {
            command.method = *type;
            const auto found = object->find("events");
            const auto* events = found == object->end() ? nullptr : std::get_if<Value::Array>(&found->second.data);
            if (! events)
                return {};
            for (const auto& event : *events)
                if (const auto* name = std::get_if<std::string>(&event.data))
                    command.events.insert(*name);
            return command;
        }
        if (*type == "clientGone")
        {
            const auto* client = stringField(*object, "client");
            if (! client || client->empty())
                return {};
            command.method = *type;
            command.client = *client;
            return command;
        }
        const auto* id = stringField(*object, "id");
        if (! id || id->empty())
            return {};
        command.id = *id;
        if (*type == "cancel")
        {
            command.method = *type;
            return command;
        }
        const auto* method = stringField(*object, "method");
        if (*type != "request" || ! method)
            return {};
        command.method = *method;
        if (const auto* client = stringField(*object, "client"))
            command.client = *client;
        command.targetGeneration = positive(numberField(*object, "generation"));
        if (command.targetGeneration == 0)
            return {};
        const auto params = object->find("params");
        if (params != object->end())
        {
            const auto* fields = std::get_if<Value::Object>(&params->second.data);
            if (! fields)
                return {};
            command.params = *fields;
        }
        if (const auto enabled = command.params.find("enabled"); enabled != command.params.end())
            if (const auto* flag = std::get_if<bool>(&enabled->second.data))
                command.enabled = *flag;
        if (const auto node = command.params.find("node"); node != command.params.end())
        {
            command.nodeRequested = true;
            if (const auto* ref = std::get_if<Value::Object>(&node->second.data))
            {
                command.generation = positive(numberField(*ref, "generation"));
                if (const auto* text = stringField(*ref, "id"))
                {
                    ui::NodeId parsed = ui::noNode;
                    const auto result = std::from_chars(text->data(), text->data() + text->size(), parsed);
                    if (result.ec == std::errc() && result.ptr == text->data() + text->size())
                        command.node = parsed;
                }
            }
        }
        return command;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
