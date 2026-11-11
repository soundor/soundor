#pragma once

#include <soundor/Abi.h>

#include <juce_core/juce_core.h>

#include <charconv>
#include <cmath>
#include <cstdint>
#include <deque>
#include <functional>
#include <iomanip>
#include <limits>
#include <locale>
#include <map>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Persistent control-thread data. These operations allocate and lock;
    // unlike parameter handles, they MUST NOT be used in process().
    inline constexpr std::size_t maxSnapshotBytes = 8 * 1024 * 1024;

    inline void checkSnapshotText(const std::string& text)
    {
        if (text.size() > maxSnapshotBytes || text.find('\0') != std::string::npos
            || ! juce::CharPointer_UTF8::isValidString(text.data(), static_cast<int>(text.size())))
            throw std::invalid_argument("invalid snapshot UTF-8 or size");
        std::size_t depth = 0, nodes = 0;
        bool quoted = false;
        const auto hex = [&](std::size_t at)
        {
            if (at + 4 > text.size())
                throw std::invalid_argument("invalid Unicode escape");
            unsigned out = 0;
            for (std::size_t n = at; n < at + 4; ++n)
            {
                const auto c = text[n];
                const int digit = c >= '0' && c <= '9'   ? c - '0'
                                  : c >= 'a' && c <= 'f' ? c - 'a' + 10
                                  : c >= 'A' && c <= 'F' ? c - 'A' + 10
                                                         : -1;
                if (digit < 0)
                    throw std::invalid_argument("invalid Unicode escape");
                out = out * 16 + static_cast<unsigned>(digit);
            }
            return out;
        };
        for (std::size_t i = 0; i < text.size(); ++i)
        {
            const auto c = text[i];
            if (quoted)
            {
                if (c == '\\')
                {
                    if (++i >= text.size())
                        throw std::invalid_argument("invalid JSON escape");
                    if (std::string_view("\"\\/bfnrtu").find(text[i]) == std::string_view::npos)
                        throw std::invalid_argument("invalid JSON escape");
                    if (text[i] == 'u')
                    {
                        const auto code = hex(i + 1);
                        i += 4;
                        if (code == 0 || (code >= 0xdc00 && code <= 0xdfff))
                            throw std::invalid_argument("invalid Unicode state string");
                        if (code >= 0xd800 && code <= 0xdbff)
                        {
                            if (i + 6 >= text.size() || text[i + 1] != '\\' || text[i + 2] != 'u')
                                throw std::invalid_argument("invalid Unicode state string");
                            const auto low = hex(i + 3);
                            if (low < 0xdc00 || low > 0xdfff)
                                throw std::invalid_argument("invalid Unicode state string");
                            i += 6;
                        }
                    }
                }
                else if (c == '"')
                    quoted = false;
                continue;
            }
            if (c == '"')
                quoted = true;
            else if (c == '{' || c == '[')
            {
                if (++depth > 64)
                    throw std::invalid_argument("snapshot nesting limit");
            }
            else if (c == '}' || c == ']')
            {
                if (depth == 0)
                    throw std::invalid_argument("invalid snapshot nesting");
                --depth;
            }
            else if (c == ',' && ++nodes > 100000)
                throw std::invalid_argument("snapshot element limit");
        }
        if (quoted || depth != 0)
            throw std::invalid_argument("invalid snapshot text");
    }

    // Preflight the legacy binary XML before handing it to a recursive parser.
    inline void checkLegacyXml(const void* data, int size)
    {
        if (size <= 8 || juce::ByteOrder::littleEndianInt(data) != 0x21324356)
            return;
        const auto length = juce::ByteOrder::littleEndianInt(static_cast<const char*>(data) + 4);
        if (length == 0 || length > static_cast<unsigned>(size - 8))
            throw std::invalid_argument("invalid legacy XML length");
        const std::string text(static_cast<const char*>(data) + 8, length);
        if (text.find('\0') != std::string::npos
            || ! juce::CharPointer_UTF8::isValidString(text.data(), static_cast<int>(text.size())))
            throw std::invalid_argument("invalid legacy XML text");
        std::size_t depth = 0, nodes = 0;
        for (std::size_t i = 0; i < text.size(); ++i)
        {
            if (text[i] != '<')
                continue;
            if (++nodes > 100000 || i + 1 >= text.size() || text[i + 1] == '!')
                throw std::invalid_argument("invalid legacy XML content");
            const bool closing = text[i + 1] == '/';
            const bool declaration = text[i + 1] == '?';
            char quote = 0;
            auto end = i + 1;
            for (; end < text.size(); ++end)
            {
                const auto c = text[end];
                if (quote != 0)
                {
                    if (c == quote)
                        quote = 0;
                }
                else if (c == '\'' || c == '"')
                    quote = c;
                else if (c == '>')
                    break;
            }
            if (end == text.size())
                throw std::invalid_argument("invalid legacy XML tag");
            if (closing)
            {
                if (depth == 0)
                    throw std::invalid_argument("invalid legacy XML nesting");
                --depth;
            }
            else if (! declaration && text[end - 1] != '/' && ++depth > 64)
                throw std::invalid_argument("legacy XML nesting limit");
            i = end;
        }
        if (depth != 0)
            throw std::invalid_argument("invalid legacy XML nesting");
    }

    // Match the engine's classic-locale conversions: supported Apple C++
    // libraries have no floating-point from_chars/to_chars overloads.
    inline double parseStateNumber(std::string_view text)
    {
        std::istringstream input { std::string(text) };
        input.imbue(std::locale::classic());
        double out = 0;
        input >> std::noskipws >> out;
        // Some libraries flag representable subnormals as underflow. Their
        // nonzero result is still valid; overflow and rounded-to-zero are not.
        const bool subnormal = out != 0 && std::abs(out) < std::numeric_limits<double>::min();
        if ((input.fail() && ! subnormal) || input.rdbuf()->in_avail() != 0 || ! std::isfinite(out))
            throw std::invalid_argument("invalid snapshot number");
        return out;
    }

    // Keep JSON strings interoperable with JUCE, but parse numbers with
    // classic-locale conversions: JUCE underflows representable subnormals.
    class StateJsonReader
    {
    public:
        explicit StateJsonReader(std::string_view input) : text(input) {}
        juce::var parse()
        {
            auto out = value(0);
            whitespace();
            if (position != text.size())
                fail();
            return out;
        }

    private:
        [[noreturn]] static void fail() { throw std::invalid_argument("invalid Soundor JSON"); }
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
            if (position == text.size() || text[position] != c)
                return false;
            ++position;
            return true;
        }
        juce::String string()
        {
            whitespace();
            const auto start = position;
            if (position == text.size() || text[position++] != '"')
                fail();
            bool closed = false;
            while (position < text.size())
            {
                const auto c = text[position++];
                if (c == '\\')
                {
                    if (position == text.size())
                        fail();
                    ++position;
                }
                else if (c == '"')
                {
                    closed = true;
                    break;
                }
                else if (static_cast<unsigned char>(c) < 0x20)
                    fail();
            }
            if (! closed)
                fail();
            const auto decoded =
                juce::JSON::fromString(juce::String::fromUTF8(text.data() + start, static_cast<int>(position - start)));
            if (! decoded.isString())
                fail();
            return decoded.toString();
        }
        juce::var number()
        {
            whitespace();
            const auto start = position;
            if (position < text.size() && text[position] == '-')
                ++position;
            const auto digit = [&] { return position < text.size() && text[position] >= '0' && text[position] <= '9'; };
            if (! digit())
                fail();
            if (text[position] == '0')
                ++position;
            else
                while (digit())
                    ++position;
            bool fractional = false;
            if (position < text.size() && text[position] == '.')
            {
                fractional = true;
                ++position;
                if (! digit())
                    fail();
                while (digit())
                    ++position;
            }
            if (position < text.size() && (text[position] == 'e' || text[position] == 'E'))
            {
                fractional = true;
                ++position;
                if (position < text.size() && (text[position] == '+' || text[position] == '-'))
                    ++position;
                if (! digit())
                    fail();
                while (digit())
                    ++position;
            }
            const auto token = text.substr(start, position - start);
            if (! fractional)
            {
                std::int64_t integer = 0;
                const auto result = std::from_chars(token.data(), token.data() + token.size(), integer);
                if (result.ec == std::errc {} && result.ptr == token.data() + token.size())
                {
                    if (integer >= INT32_MIN && integer <= INT32_MAX)
                        return static_cast<int>(integer);
                    return static_cast<juce::int64>(integer);
                }
            }
            return parseStateNumber(token);
        }
        juce::var value(std::size_t depth)
        {
            whitespace();
            if (depth > 64 || budget-- == 0 || position == text.size())
                fail();
            if (text[position] == '"')
                return string();
            if (take('{'))
            {
                juce::var out(new juce::DynamicObject());
                if (take('}'))
                    return out;
                do
                {
                    const auto name = string();
                    if (! take(':'))
                        fail();
                    out.getDynamicObject()->setProperty(juce::Identifier(name), value(depth + 1));
                    if (take('}'))
                        return out;
                } while (take(','));
                fail();
            }
            if (take('['))
            {
                juce::Array<juce::var> out;
                if (take(']'))
                    return out;
                do
                {
                    out.add(value(depth + 1));
                    if (take(']'))
                        return out;
                } while (take(','));
                fail();
            }
            for (const auto literal : { std::string_view("true"), std::string_view("false"), std::string_view("null") })
            {
                if (text.substr(position, literal.size()) == literal)
                {
                    position += literal.size();
                    return literal == "null" ? juce::var {} : juce::var(literal == "true");
                }
            }
            return number();
        }
        std::string_view text;
        std::size_t position = 0;
        std::size_t budget = 100000;
    };

    inline juce::var parseStateJson(const std::string& text)
    {
        checkSnapshotText(text);
        return StateJsonReader(text).parse();
    }

    // JUCE's display-oriented JSON formatter limits decimal places. Persistent
    // doubles instead need enough significant digits to recover the exact value.
    inline std::string stateJson(const juce::var& value)
    {
        if (value.isDouble())
        {
            const auto number = static_cast<double>(value);
            if (! std::isfinite(number))
                throw std::invalid_argument("non-finite snapshot number");
            std::ostringstream output;
            output.imbue(std::locale::classic());
            output << std::setprecision(std::numeric_limits<double>::max_digits10) << (number == 0 ? 0 : number);
            std::string out = output.str();
            // Preserve the double type when a large integral double would
            // overflow JUCE's integer JSON parser.
            if (out.find_first_of(".eE") == std::string::npos)
                out += ".0";
            return out;
        }
        if (const auto* array = value.getArray())
        {
            std::string out = "[";
            for (const auto& item : *array)
            {
                if (out.size() > 1)
                    out += ',';
                out += stateJson(item);
            }
            return out + ']';
        }
        if (const auto* object = value.getDynamicObject())
        {
            std::string out = "{";
            const auto& properties = object->getProperties();
            for (int i = 0; i < properties.size(); ++i)
            {
                if (i > 0)
                    out += ',';
                out += juce::JSON::toString(juce::var(properties.getName(i).toString()), true).toStdString();
                out += ':';
                out += stateJson(properties.getValueAt(i));
            }
            return out + '}';
        }
        return juce::JSON::toString(value, true).toStdString();
    }

    template <typename T>
    struct StateCodec
    {
        static juce::var encode(const T& value)
        {
            if constexpr (std::is_same_v<T, bool>)
                return value;
            else if constexpr (std::is_floating_point_v<T>)
            {
                if (! std::isfinite(value))
                    throw std::invalid_argument("non-finite state value");
                return static_cast<double>(value == 0 ? 0 : value);
            }
            else if constexpr (sizeof(T) == 8)
                return juce::String(std::to_string(value));
            else
                return static_cast<juce::int64>(value);
        }
        static T decode(const juce::var& value)
        {
            if constexpr (std::is_same_v<T, bool>)
            {
                if (! value.isBool())
                    throw std::invalid_argument("expected boolean state");
                return static_cast<bool>(value);
            }
            else if constexpr (std::is_integral_v<T> && sizeof(T) == 8)
            {
                if (! value.isString())
                    throw std::invalid_argument("expected decimal integer state");
                const auto text = value.toString().toStdString();
                T out {};
                const auto parsed = std::from_chars(text.data(), text.data() + text.size(), out);
                if (parsed.ec != std::errc {} || parsed.ptr != text.data() + text.size() || std::to_string(out) != text)
                    throw std::invalid_argument("invalid integer state");
                return out;
            }
            else
            {
                if (! value.isInt() && ! value.isInt64() && ! value.isDouble())
                    throw std::invalid_argument("expected numeric state");
                const double number = static_cast<double>(value);
                if (! std::isfinite(number) || number < static_cast<double>(std::numeric_limits<T>::lowest())
                    || number > static_cast<double>(std::numeric_limits<T>::max()))
                    throw std::invalid_argument("state number out of range");
                if constexpr (std::is_integral_v<T>)
                    if (std::trunc(number) != number)
                        throw std::invalid_argument("expected integer state");
                return static_cast<T>(number);
            }
        }
    };
    template <>
    struct StateCodec<std::string>
    {
        static juce::var encode(const std::string& value)
        {
            if (value.find('\0') != std::string::npos
                || ! juce::CharPointer_UTF8::isValidString(value.data(), static_cast<int>(value.size())))
                throw std::invalid_argument("state strings must be valid UTF-8 without NUL");
            return juce::String::fromUTF8(value.data(), static_cast<int>(value.size()));
        }
        static std::string decode(const juce::var& value)
        {
            if (! value.isString())
                throw std::invalid_argument("expected string state");
            return value.toString().toStdString();
        }
    };
    template <typename T>
    struct StateCodec<std::optional<T>>
    {
        static juce::var encode(const std::optional<T>& value)
        {
            return value ? StateCodec<T>::encode(*value) : juce::var {};
        }
        static std::optional<T> decode(const juce::var& value)
        {
            return value.isVoid() ? std::nullopt : std::optional<T>(StateCodec<T>::decode(value));
        }
    };
    template <typename T>
    struct StateCodec<std::vector<T>>
    {
        static juce::var encode(const std::vector<T>& value)
        {
            juce::Array<juce::var> out;
            for (const auto& item : value)
                out.add(StateCodec<T>::encode(item));
            return out;
        }
        static std::vector<T> decode(const juce::var& value)
        {
            const auto* array = value.getArray();
            if (array == nullptr || array->size() > 100000)
                throw std::invalid_argument("invalid state array");
            std::vector<T> out;
            out.reserve(static_cast<std::size_t>(array->size()));
            for (const auto& item : *array)
                out.push_back(StateCodec<T>::decode(item));
            return out;
        }
    };

    class StateStore
    {
    public:
        using Values = std::map<std::string, std::string>;
        using Session = std::uint64_t;
        // Owner zero is native processor code. Other owners are UI contexts.
        // All owners contribute to the same field lifecycle, but cleanup removes
        // only its own contribution, including after restoration/recreation.
        void beginGesture(const std::string& field, Session owner = 0)
        {
            const std::lock_guard guard(lock);
            ++gestures[field][owner];
        }
        void endGesture(const std::string& field, Session owner = 0)
        {
            const std::lock_guard guard(lock);
            const auto found = gestures.find(field);
            if (found == gestures.end())
                return;
            auto& owners = found->second;
            const auto entry = owners.find(owner);
            if (entry != owners.end() && --entry->second == 0)
                owners.erase(entry);
            if (owners.empty())
                gestures.erase(found);
        }
        std::size_t gestureDepth(const std::string& field) const
        {
            const std::lock_guard guard(lock);
            const auto found = gestures.find(field);
            std::size_t depth = 0;
            if (found != gestures.end())
                for (const auto& [owner, count] : found->second)
                {
                    static_cast<void>(owner);
                    depth += count;
                }
            return depth;
        }
        void resetGestures()
        {
            const std::lock_guard guard(lock);
            gestures.clear();
        }
        struct Event
        {
            std::string field;
            std::string value;
            bool restored = false;
        };
        using Callback = std::function<void(const std::string&)>;
        std::function<void()> subscribe(const std::string& field, Callback callback)
        {
            const std::lock_guard guard(lock);
            const auto id = ++nextListener;
            listeners[field].emplace(id, std::move(callback));
            return [this, field, id]
            {
                const std::lock_guard removeGuard(lock);
                listeners[field].erase(id);
            };
        }
        std::recursive_mutex& mutex() const { return lock; }
        std::string get(const std::string& field) const
        {
            const std::lock_guard guard(lock);
            return values.at(field);
        }
        void set(const std::string& field, std::string value) { replace({ { field, std::move(value) } }); }
        void replace(const Values& next)
        {
            const std::lock_guard guard(lock);
            std::vector<Event> changed;
            for (const auto& [field, value] : next)
            {
                if (value.size() > maxSnapshotBytes)
                    throw std::length_error("state exceeds 8 MiB");
                const auto current = values.find(field);
                if (current == values.end() || current->second != value)
                    changed.push_back({ field, value, false });
            }
            // Every restored field is installed before notifying any observer.
            for (const auto& event : changed)
                values[event.field] = event.value;
            if (connected)
                events.insert(events.end(), changed.begin(), changed.end());
            nativeEvents.insert(nativeEvents.end(), changed.begin(), changed.end());
            if (notifyingNative)
                return;
            const juce::ScopedValueSetter<bool> notificationGuard(notifyingNative, true);
            while (! nativeEvents.empty())
            {
                const auto event = std::move(nativeEvents.front());
                nativeEvents.pop_front();
                const auto callbacks = listeners[event.field];
                for (const auto& [id, callback] : callbacks)
                {
                    static_cast<void>(id);
                    try
                    {
                        callback(event.value);
                    }
                    catch (const std::exception& error)
                    {
                        juce::Logger::writeToLog(error.what());
                    }
                }
            }
        }
        Values snapshot() const
        {
            const std::lock_guard guard(lock);
            return values;
        }
        void restored()
        {
            const std::lock_guard guard(lock);
            if (connected)
                events.push_back({ {}, {}, true });
        }
        Session connect()
        {
            const std::lock_guard guard(lock);
            connected = true;
            events.clear();
            return ++session;
        }
        void disconnect(Session owner)
        {
            const std::lock_guard guard(lock);
            for (auto field = gestures.begin(); field != gestures.end();)
            {
                field->second.erase(owner);
                if (field->second.empty())
                    field = gestures.erase(field);
                else
                    ++field;
            }
            if (owner == session)
            {
                connected = false;
                events.clear();
            }
        }
        std::vector<Event> drain()
        {
            const std::lock_guard guard(lock);
            std::vector<Event> out;
            out.swap(events);
            return out;
        }

    private:
        mutable std::recursive_mutex lock;
        Values values;
        Session session = 0;
        std::map<std::string, std::map<Session, std::size_t>> gestures;
        std::size_t nextListener = 0;
        std::map<std::string, std::map<std::size_t, Callback>> listeners;
        bool notifyingNative = false;
        std::deque<Event> nativeEvents;
        bool connected = false;
        std::vector<Event> events;
    };

    template <typename T>
    class StateField
    {
    public:
        StateField(StateStore& owner, std::string name, T initial) : store(owner), field(std::move(name))
        {
            set(std::move(initial));
        }
        // Control-thread only, like get/set. No JUCE automation is involved.
        void beginGesture() { store.beginGesture(field); }
        void endGesture() { store.endGesture(field); }
        T get() const { return StateCodec<T>::decode(parseStateJson(store.get(field))); }
        // The unsubscribe closure must be destroyed/called before the processor.
        std::function<void()> subscribe(std::function<void(T)> callback)
        {
            return store.subscribe(field, [callback = std::move(callback)](const std::string& json)
                                   { callback(StateCodec<T>::decode(parseStateJson(json))); });
        }
        void set(T value)
        {
            // Round-trip validates native struct values (including finite floats).
            auto encoded = StateCodec<T>::encode(value);
            static_cast<void>(StateCodec<T>::decode(encoded));
            const auto json = stateJson(encoded);
            checkSnapshotText(json);
            store.set(field, json);
        }

    private:
        StateStore& store;
        const std::string field;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
