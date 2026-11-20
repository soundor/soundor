#include "State.h"

#include "Log.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>

namespace soundor::vst3
{
    namespace
    {
        [[noreturn]] void invalid(std::string_view path, const std::string& what)
        {
            throw std::invalid_argument(std::string(path) + ": " + what);
        }

        struct IntegerRange
        {
            std::string_view name;
            double min;
            double max;
        };

        constexpr IntegerRange integerRanges[] = {
            { "int8", -128.0, 127.0 },
            { "uint8", 0.0, 255.0 },
            { "int16", -32768.0, 32767.0 },
            { "uint16", 0.0, 65535.0 },
            { "int32", -2147483648.0, 2147483647.0 },
            { "uint32", 0.0, 4294967295.0 },
        };

        float toFloat32(double value)
        {
            constexpr double overflow = 3.4028235677973366e38;
            if (value >= overflow || value <= -overflow)
                throw std::invalid_argument("float32 out of range");
            return static_cast<float>(value);
        }

        // RAII for a flag that is set for a scope.
        class Raised
        {
        public:
            explicit Raised(bool& target) : flag(target) { flag = true; }
            ~Raised() { flag = false; }
            Raised(const Raised&) = delete;
            Raised& operator=(const Raised&) = delete;
            Raised(Raised&&) = delete;
            Raised& operator=(Raised&&) = delete;

        private:
            bool& flag;
        };
    } // namespace

    // ── StateSchema ──────────────────────────────────────────────────────────

    StateSchema::StateSchema(const Plugin& plugin)
        : fields(plugin.state),
          declared(plugin.stateTypes),
          audio(plugin.audioState),
          snapshotSize(plugin.audioStateSize)
    {
    }

    std::optional<std::size_t> StateSchema::indexOf(std::string_view name) const noexcept
    {
        for (std::size_t i = 0; i < fields.size(); ++i)
            if (fields[i].name == name)
                return i;
        return std::nullopt;
    }

    const json::Value* StateSchema::declaredType(std::string_view name) const noexcept
    {
        if (! declared.isArray())
            return nullptr;
        for (const auto& type : declared.asArray())
            if (type.stringOr("name") == name)
                return &type;
        return nullptr;
    }

    json::Value StateSchema::canonicalValue(const json::Value& type, const json::Value& value,
                                            std::string_view path) const
    {
        const auto kind = type.stringOr("kind");
        if (kind == "nullable")
            return value.isNull() ? json::Value::null() : canonicalValue(type.at("inner"), value, path);
        if (kind == "array")
        {
            if (! value.isArray())
                invalid(path, "expected an array");
            const auto& items = value.asArray();
            if (items.size() > 100000)
                invalid(path, "array exceeds 100000 elements");
            std::vector<json::Value> out;
            out.reserve(items.size());
            for (std::size_t i = 0; i < items.size(); ++i)
                out.push_back(
                    canonicalValue(type.at("element"), items[i], std::string(path) + "[" + std::to_string(i) + "]"));
            return json::Value::array(std::move(out));
        }
        if (kind == "declared")
        {
            const auto& name = type.at("name").asString();
            const auto* declaration = declaredType(name);
            if (declaration == nullptr)
                invalid(path, "unknown type " + name);
            if (declaration->stringOr("kind") == "enum")
            {
                if (! value.isString())
                    invalid(path, "expected one of " + name + "'s values");
                for (const auto& option : declaration->at("values").asArray())
                    if (option.asString() == value.asString())
                        return value;
                invalid(path, "\"" + value.asString() + "\" is not a value of " + name);
            }
            if (! value.isObject())
                invalid(path, "expected a " + name);
            const auto& declaredFields = declaration->at("fields").asArray();
            if (value.asObject().size() != declaredFields.size())
                invalid(path, "unexpected struct fields");
            std::vector<json::Value::Member> out;
            for (const auto& field : declaredFields)
            {
                const auto& fieldName = field.at("name").asString();
                const auto* member = value.find(fieldName);
                if (member == nullptr)
                    invalid(path, "missing state field: " + fieldName);
                out.emplace_back(fieldName,
                                 canonicalValue(field.at("type"), *member, std::string(path) + "." + fieldName));
            }
            return json::Value::object(std::move(out));
        }
        if (kind != "primitive")
            invalid(path, "unsupported state type " + kind);
        const auto& name = type.at("name").asString();
        if (name == "boolean")
        {
            if (! value.isBoolean())
                invalid(path, "expected a boolean");
            return value;
        }
        if (name == "string")
        {
            if (! value.isString())
                invalid(path, "expected a string");
            if (value.asString().find('\0') != std::string::npos || ! json::validUtf8(value.asString()))
                invalid(path, "state strings must be valid Unicode without NUL");
            return value;
        }
        if (name == "int64" || name == "uint64")
        {
            if (! value.isString())
                invalid(path, "expected a decimal integer string");
            const auto& text = value.asString();
            if (name == "int64")
            {
                std::int64_t parsed = 0;
                const auto result = std::from_chars(text.data(), text.data() + text.size(), parsed);
                if (result.ec != std::errc {} || result.ptr != text.data() + text.size()
                    || std::to_string(parsed) != text)
                    invalid(path, "invalid int64");
            }
            else
            {
                std::uint64_t parsed = 0;
                const auto result = std::from_chars(text.data(), text.data() + text.size(), parsed);
                if (result.ec != std::errc {} || result.ptr != text.data() + text.size()
                    || std::to_string(parsed) != text)
                    invalid(path, "invalid uint64");
            }
            return value;
        }
        if (! value.isNumber())
            invalid(path, "expected a number");
        const double number = value.asNumber();
        if (! std::isfinite(number))
            invalid(path, "numbers must be finite");
        if (name == "float64")
            return json::Value::number(number == 0 ? 0 : number);
        if (name == "float32")
        {
            const float narrowed = toFloat32(number);
            return json::Value::number(narrowed == 0 ? 0.0 : static_cast<double>(narrowed));
        }
        for (const auto& range : integerRanges)
            if (range.name == name)
            {
                if (std::trunc(number) != number || number < range.min || number > range.max)
                    invalid(path, "expected an " + name);
                return json::Value::integer(static_cast<std::int64_t>(number));
            }
        invalid(path, "unknown primitive " + name);
    }

    std::string StateSchema::canonical(std::size_t index, const json::Value& value) const
    {
        const auto& field = fields.at(index);
        const auto out = canonicalValue(field.type, value, "state." + field.name);
        if (field.maxLength && out.isArray() && out.asArray().size() > *field.maxLength)
            throw std::invalid_argument("state." + field.name + ": state array exceeds its maxLength");
        auto text = json::write(out);
        if (text.size() > maxSnapshotBytes)
            throw std::length_error("state exceeds 8 MiB");
        return text;
    }

    std::string StateSchema::canonical(std::size_t index, std::string_view text) const
    {
        json::Value parsed;
        try
        {
            parsed = json::parse(text);
        }
        catch (const json::Error& error)
        {
            throw std::invalid_argument("state." + fields.at(index).name + ": " + error.what());
        }
        return canonical(index, parsed);
    }

    std::map<std::string, std::string> StateSchema::defaults() const
    {
        std::map<std::string, std::string> out;
        for (const auto& field : fields)
            out.emplace(field.name, field.defaultJson);
        return out;
    }

    std::map<std::string, std::string> StateSchema::read(const json::Value* state) const
    {
        if (state != nullptr && ! state->isObject())
            throw std::invalid_argument("expected state object");
        std::map<std::string, std::string> out;
        for (std::size_t i = 0; i < fields.size(); ++i)
        {
            const auto* value = state == nullptr ? nullptr : state->find(fields[i].name);
            out.emplace(fields[i].name, value == nullptr ? fields[i].defaultJson : canonical(i, *value));
        }
        return out;
    }

    json::Value StateSchema::write(const std::map<std::string, std::string>& values) const
    {
        auto out = json::Value::object();
        for (const auto& field : fields)
        {
            const auto found = values.find(field.name);
            out.set(field.name, json::parse(found == values.end() ? field.defaultJson : found->second));
        }
        return out;
    }

    void StateSchema::writeAudio(const std::map<std::string, std::string>& values, std::span<std::byte> out) const
    {
        if (out.size() < snapshotSize)
            throw std::invalid_argument("audio state snapshot too small");
        std::fill(out.begin(), out.end(), std::byte {});
        const auto element = [&](const std::string& type, const json::Value& value, std::byte* at)
        {
            const auto put = [&](auto number) { std::memcpy(at, &number, sizeof number); };
            if (type == "boolean")
                put(static_cast<std::uint8_t>(value.asBoolean() ? 1 : 0));
            else if (type == "int8")
                put(static_cast<std::int8_t>(*value.asInt64()));
            else if (type == "uint8")
                put(static_cast<std::uint8_t>(*value.asUint64()));
            else if (type == "int16")
                put(static_cast<std::int16_t>(*value.asInt64()));
            else if (type == "uint16")
                put(static_cast<std::uint16_t>(*value.asUint64()));
            else if (type == "int32")
                put(static_cast<std::int32_t>(*value.asInt64()));
            else if (type == "uint32")
                put(static_cast<std::uint32_t>(*value.asUint64()));
            else if (type == "int64")
                put(*json::Value::numberText(value.asString()).asInt64());
            else if (type == "uint64")
                put(*json::Value::numberText(value.asString()).asUint64());
            else if (type == "float32")
                put(static_cast<float>(value.asNumber()));
            else
                put(value.asNumber());
        };
        constexpr auto size = [](const std::string& type) -> std::size_t
        {
            if (type == "boolean" || type == "int8" || type == "uint8")
                return 1;
            if (type == "int16" || type == "uint16")
                return 2;
            if (type == "int32" || type == "uint32" || type == "float32")
                return 4;
            return 8;
        };
        for (const auto& field : audio)
        {
            const auto found = values.find(field.name);
            if (found == values.end())
                continue;
            const auto value = json::parse(found->second);
            if (! field.array)
            {
                element(field.element, value, out.data() + field.offset);
                continue;
            }
            const auto& items = value.asArray();
            const auto length = static_cast<std::uint32_t>(std::min(items.size(), field.maxLength));
            std::memcpy(out.data() + field.offset, &length, sizeof length);
            const auto step = size(field.element);
            for (std::uint32_t i = 0; i < length; ++i)
                element(field.element, items[i], out.data() + field.dataOffset + i * step);
        }
    }

    // ── StateStore ───────────────────────────────────────────────────────────

    struct StateStore::HistoryField final : history::Field
    {
        StateStore& store;
        std::string name;
        Validator validate;

        HistoryField(StateStore& owner, std::string field, Validator validator)
            : store(owner), name(std::move(field)), validate(std::move(validator))
        {
            id = "state:" + name;
            label = name;
        }

        [[nodiscard]] history::Value read() const override
        {
            const std::lock_guard guard(store.lock);
            return store.values.at(name);
        }

        std::unique_ptr<history::Prepared> prepare(const history::Value& raw) override
        {
            const std::lock_guard guard(store.lock);
            const auto& json = std::get<std::string>(raw);
            validate(json);
            if (json.size() > maxSnapshotBytes)
                throw std::length_error("state exceeds 8 MiB");
            struct Write final : history::Prepared
            {
                StateStore& store;
                std::string& current;
                std::string next;
                std::list<Event> ui;
                std::list<Notification> native;

                Write(HistoryField& field, const std::string& value)
                    : store(field.store), current(store.values.at(field.name)), next(value)
                {
                    if (store.connected)
                        ui.push_back({ field.name, value, false });
                    Notification event { value, {} };
                    for (const auto& [listener, callback] : store.listeners[field.name])
                    {
                        static_cast<void>(listener);
                        event.callbacks.push_back(callback);
                    }
                    native.push_back(std::move(event));
                }

                void install() noexcept override
                {
                    const std::lock_guard guard(store.lock);
                    current.swap(next);
                    store.events.splice(store.events.end(), ui);
                    store.preparedNotifications.splice(store.preparedNotifications.end(), native);
                }

                void notify() noexcept override { store.deliverPrepared(); }
            };
            return std::make_unique<Write>(*this, json);
        }
    };

    StateStore::StateStore(history::StateHistory& shared) : history(shared) {}
    StateStore::~StateStore() = default;

    void StateStore::initialize(const std::string& name, std::string value, Validator validate)
    {
        values.emplace(name, std::move(value));
        auto entry = std::make_unique<HistoryField>(*this, name, std::move(validate));
        history.registerField(*entry);
        historyFields.emplace(name, std::move(entry));
    }

    void StateStore::beginGesture(const std::string& field, Session owner, const history::Options& options)
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        history.guard(
            [&]
            {
                auto& owners = gestures[field];
                if (options.enabled && history.ownsGesture("state:" + field) && ! owners.contains(owner))
                    throw std::logic_error("field already belongs to another History gesture owner");
                auto [entry, inserted] = owners.try_emplace(owner, 0);
                try
                {
                    history.beginGesture("state:" + field, options, owner);
                    ++entry->second;
                }
                catch (...)
                {
                    if (inserted)
                        owners.erase(entry);
                    if (owners.empty())
                        gestures.erase(field);
                    throw;
                }
            });
    }

    void StateStore::endGesture(const std::string& field, Session owner)
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        history.guard(
            [&]
            {
                if (history.inTransaction())
                    throw std::logic_error("cannot end a gesture inside a transaction");
            });
        const auto found = gestures.find(field);
        if (found == gestures.end())
            return;
        auto& owners = found->second;
        const auto entry = owners.find(owner);
        if (entry == owners.end())
            return;
        history.endGesture("state:" + field);
        if (--entry->second == 0)
            owners.erase(entry);
        if (owners.empty())
            gestures.erase(found);
    }

    void StateStore::resetGestures()
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        for (const auto& [name, owners] : gestures)
        {
            static_cast<void>(owners);
            history.cancelGesture("state:" + name);
        }
        gestures.clear();
    }

    std::function<void()> StateStore::subscribe(const std::string& field, Callback callback)
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        const auto id = ++nextListener;
        listeners[field].emplace(id, std::move(callback));
        return [this, field, id]
        {
            const std::lock_guard removeHistoryGuard(history.mutex());
            const std::lock_guard removeGuard(lock);
            listeners[field].erase(id);
        };
    }

    std::string StateStore::get(const std::string& field) const
    {
        return std::get<std::string>(history.read("state:" + field));
    }

    void StateStore::set(const std::string& field, std::string value, const history::Options& options)
    {
        history.edit(
            "state:" + field,
            [&]() -> history::Value
            {
                historyFields.at(field)->validate(value);
                return std::move(value);
            },
            options);
    }

    void StateStore::replace(const Values& next)
    {
        const std::lock_guard historyGuard(history.mutex());
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
        // Every restored field is installed before any observer is told.
        for (const auto& event : changed)
            values[event.field] = event.value;
        if (connected)
            events.insert(events.end(), changed.begin(), changed.end());
        nativeEvents.insert(nativeEvents.end(), changed.begin(), changed.end());
        if (notifyingNative)
            return;
        const Raised notifying(notifyingNative);
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
                    log(std::string("Soundor: a state listener failed: ") + error.what());
                }
            }
        }
    }

    std::string StateStore::committed(const std::string& field) const
    {
        const std::lock_guard guard(lock);
        return values.at(field);
    }

    StateStore::Values StateStore::snapshot() const
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        return values;
    }

    void StateStore::restored()
    {
        const std::lock_guard guard(lock);
        if (connected)
            events.push_back({ {}, {}, true });
    }

    StateStore::Session StateStore::connect()
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        connected = true;
        events.clear();
        return ++session;
    }

    void StateStore::disconnect(Session owner)
    {
        const std::lock_guard historyGuard(history.mutex());
        const std::lock_guard guard(lock);
        for (auto field = gestures.begin(); field != gestures.end();)
        {
            if (field->second.contains(owner))
                history.cancelGesture("state:" + field->first, field->second.at(owner), owner);
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

    std::vector<StateStore::Event> StateStore::drain()
    {
        const std::lock_guard guard(lock);
        std::vector<Event> out;
        out.reserve(events.size());
        for (auto& event : events)
            out.push_back(std::move(event));
        events.clear();
        return out;
    }

    void StateStore::deliverPrepared() noexcept
    {
        if (deliveringPrepared)
            return;
        const Raised delivering(deliveringPrepared);
        while (! preparedNotifications.empty())
        {
            auto event = std::move(preparedNotifications.front());
            preparedNotifications.pop_front();
            for (const auto& callback : event.callbacks)
            {
                try
                {
                    callback(event.value);
                }
                catch (...) // NOLINT(bugprone-empty-catch): a listener's failure must not stop the others.
                {
                }
            }
        }
    }
} // namespace soundor::vst3
