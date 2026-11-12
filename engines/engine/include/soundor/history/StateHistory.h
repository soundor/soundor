#pragma once

#include <soundor/Abi.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
{
    // Control-thread options. Parameter atomics and host automation never enter History.
    struct Options
    {
        bool enabled = false;
        std::string label;
        Options() = default;
        explicit Options(bool record) : enabled(record) {}
        explicit Options(std::string name) : enabled(true), label(std::move(name)) {}
    };

    // Parameter plain units or canonical persistent-state JSON. The field registry
    // supplies the schema; entries contain no JavaScript values or replay closures.
    using Value = std::variant<double, std::string>;
    struct Prepared
    {
        virtual ~Prepared() = default;
        virtual void install() noexcept = 0;
        virtual void notify() noexcept = 0;
    };
    struct Field
    {
        virtual ~Field() = default;
        std::string id;
        std::string label;
        [[nodiscard]] virtual Value read() const = 0;
        virtual std::unique_ptr<Prepared> prepare(const Value&) = 0;
    };
    class TransactionAbortedError : public std::runtime_error
    {
    public:
        explicit TransactionAbortedError(std::exception_ptr reason)
            : std::runtime_error("StateHistory transaction aborted after a failed Soundor operation"),
              cause(std::move(reason))
        {
        }
        std::exception_ptr cause;
    };
    struct Status
    {
        bool canUndo = false;
        bool canRedo = false;
        std::optional<std::string> undoLabel;
        std::optional<std::string> redoLabel;
        bool operator==(const Status&) const = default;
    };

    // Owned by a processor, independent of the editor. All methods are control-
    // thread only. Field storage and realtime reads remain owned by their stores.
    class StateHistory
    {
        struct Change
        {
            std::string id;
            Value before;
            Value after;
        };
        struct Entry
        {
            std::string label;
            std::vector<Change> changes;
            std::size_t bytes = 0;
        };
        struct Gesture
        {
            std::size_t depth = 1;
            std::optional<std::string> label;
            Value before;
            bool edited = false;
            std::uint64_t owner = 0;
        };
        struct Transaction
        {
            std::string label;
            std::map<std::string, Value> values;
            std::exception_ptr failure;
        };

    public:
        explicit StateHistory(std::size_t entries = 100, std::size_t bytes = std::size_t { 16 } * 1024 * 1024)
            : maxEntries(entries), maxBytes(bytes)
        {
            if (entries == 0 || bytes == 0)
                throw std::invalid_argument("History limits must be positive");
        }
        StateHistory(const StateHistory&) = delete;
        StateHistory& operator=(const StateHistory&) = delete;
        std::recursive_mutex& mutex() const { return controlMutex; }
        void registerField(Field& field)
        {
            const std::lock_guard lock(controlMutex);
            if (! fields.emplace(field.id, &field).second)
                throw std::logic_error("duplicate History field");
        }
        [[nodiscard]] Value read(const std::string& id) const
        {
            const std::lock_guard lock(controlMutex);
            if (active)
                if (const auto it = active->values.find(id); it != active->values.end())
                    return it->second;
            return field(id).read();
        }
        template <class Callback>
        decltype(auto) guard(Callback&& callback)
        {
            const std::lock_guard lock(controlMutex);
            try
            {
                return std::forward<Callback>(callback)();
            }
            catch (...)
            {
                poison(std::current_exception());
                throw;
            }
        }
        void poison(std::exception_ptr error) noexcept
        {
            const std::lock_guard lock(controlMutex);
            if (active && ! active->failure)
                active->failure = std::move(error);
        }
        template <class Compute>
        void edit(const std::string& id, Compute&& compute, const Options& options = {})
        {
            guard(
                [&]
                {
                    auto& target = field(id);
                    const auto gesture = gestures.find(id);
                    if (active && gesture != gestures.end() && gesture->second.label)
                        throw std::logic_error("field belongs to an active History gesture");
                    auto next = std::forward<Compute>(compute)();
                    auto before = read(id);
                    if (next == before)
                        return;
                    if (active)
                    {
                        active->values.insert_or_assign(id, std::move(next));
                        return;
                    }
                    const auto name =
                        gesture != gestures.end() && gesture->second.label ? std::nullopt : recording(options, target);
                    const bool wasEdited = gesture != gestures.end() && gesture->second.edited;
                    const bool grouped = gesture != gestures.end() && gesture->second.label.has_value();
                    if (grouped)
                        gesture->second.edited = true;
                    try
                    {
                        commit({ { id, std::move(before), std::move(next) } }, name, nullptr, nullptr, grouped);
                    }
                    catch (...)
                    {
                        if (auto current = gestures.find(id); current != gestures.end())
                            current->second.edited = wasEdited;
                        throw;
                    }
                });
        }
        void beginGesture(const std::string& id, const Options& options = {}, std::uint64_t owner = 0)
        {
            guard(
                [&]
                {
                    if (active)
                        throw std::logic_error("cannot begin a gesture inside a transaction");
                    auto& target = field(id);
                    const auto current = gestures.find(id);
                    if (current != gestures.end())
                    {
                        if (options.enabled && current->second.label && current->second.owner != owner)
                            throw std::logic_error("field already belongs to another History gesture owner");
                        ++current->second.depth;
                        return;
                    }
                    gestures.emplace(id, Gesture { 1, recording(options, target), target.read(), false, owner });
                });
        }
        void endGesture(const std::string& id)
        {
            guard(
                [&]
                {
                    if (active)
                        throw std::logic_error("cannot end a gesture inside a transaction");
                    const auto it = gestures.find(id);
                    if (it == gestures.end())
                        return;
                    auto& gesture = it->second;
                    if (gesture.depth > 1)
                    {
                        --gesture.depth;
                        return;
                    }
                    const auto after = field(id).read();
                    std::optional<std::vector<Entry>> next;
                    if (gesture.label && gesture.edited && after != gesture.before)
                        next = appended(makeEntry(*gesture.label, { { id, gesture.before, after } }));
                    gestures.erase(it);
                    if (next)
                    {
                        undoStack.swap(*next);
                        redoStack.clear();
                        changed(true);
                    }
                });
        }
        [[nodiscard]] bool ownsGesture(const std::string& id) const
        {
            const std::lock_guard lock(controlMutex);
            const auto it = gestures.find(id);
            return it != gestures.end() && it->second.label.has_value();
        }
        void cancelGesture(const std::string& id, std::size_t depth = static_cast<std::size_t>(-1),
                           std::uint64_t owner = UINT64_MAX) noexcept
        {
            const std::lock_guard lock(controlMutex);
            const auto it = gestures.find(id);
            if (it == gestures.end())
                return;
            if (it->second.depth <= depth)
                gestures.erase(it);
            else
            {
                it->second.depth -= depth;
                if (owner == UINT64_MAX || owner == it->second.owner)
                {
                    it->second.label.reset();
                    it->second.edited = false;
                }
            }
        }
        void clear()
        {
            guard(
                [&]
                {
                    if (active)
                        throw std::logic_error("cannot clear History inside a transaction");
                    for (auto& [id, gesture] : gestures)
                    {
                        static_cast<void>(id);
                        gesture.label.reset();
                        gesture.edited = false;
                    }
                    const bool changedStacks = ! undoStack.empty() || ! redoStack.empty();
                    undoStack.clear();
                    redoStack.clear();
                    changed(changedStacks);
                });
        }
        template <class Callback>
        void transaction(std::string name, Callback&& callback)
        {
            const std::lock_guard lock(controlMutex);
            static_assert(std::is_void_v<std::invoke_result_t<Callback>>,
                          "History transactions require a synchronous void callback");
            if (active)
            {
                guard([&] { std::forward<Callback>(callback)(); });
                if (active->failure)
                    throw TransactionAbortedError(active->failure);
                return;
            }
            Transaction transaction { std::move(name), {}, {} };
            if (transaction.label.empty())
                throw std::invalid_argument("transaction label must not be empty");
            active = &transaction;
            try
            {
                std::forward<Callback>(callback)();
                if (transaction.failure)
                    throw TransactionAbortedError(transaction.failure);
                std::vector<Change> changes;
                changes.reserve(transaction.values.size());
                for (const auto& [id, after] : transaction.values)
                {
                    auto before = field(id).read();
                    if (before != after)
                        changes.push_back({ id, std::move(before), after });
                }
                active = nullptr;
                commit(changes, transaction.label);
            }
            catch (...)
            {
                active = nullptr;
                throw;
            }
        }
        [[nodiscard]] bool inTransaction() const noexcept
        {
            const std::lock_guard lock(controlMutex);
            return active != nullptr;
        }
        [[nodiscard]] bool canUndo() const noexcept
        {
            const std::lock_guard lock(controlMutex);
            return ! undoStack.empty();
        }
        [[nodiscard]] bool canRedo() const noexcept
        {
            const std::lock_guard lock(controlMutex);
            return ! redoStack.empty();
        }
        [[nodiscard]] Status status() const
        {
            const std::lock_guard lock(controlMutex);
            return { canUndo(), canRedo(), canUndo() ? std::optional(undoStack.back().label) : std::nullopt,
                     canRedo() ? std::optional(redoStack.back().label) : std::nullopt };
        }
        [[nodiscard]] std::size_t revision() const noexcept
        {
            const std::lock_guard lock(controlMutex);
            return version;
        }
        void undo() { replay(false); }
        void redo() { replay(true); }
        using Listener = std::function<void(const Status&)>;
        std::function<void()> subscribe(Listener callback)
        {
            const std::lock_guard lock(controlMutex);
            const auto id = ++nextListener;
            listeners.emplace(id, std::move(callback));
            return [this, id]
            {
                const std::lock_guard removeLock(controlMutex);
                listeners.erase(id);
            };
        }

    private:
        [[nodiscard]] Field& field(const std::string& id) const
        {
            const auto it = fields.find(id);
            if (it == fields.end())
                throw std::logic_error("unknown History field: " + id);
            return *it->second;
        }
        static std::optional<std::string> recording(const Options& options, const Field& field)
        {
            if (! options.enabled)
                return std::nullopt;
            return options.label.empty() ? "Change " + field.label : options.label;
        }
        static Entry makeEntry(std::string label, std::vector<Change> changes)
        {
            Entry entry { std::move(label), std::move(changes), 0 };
            entry.bytes = entry.label.size();
            for (const auto& c : entry.changes)
            {
                const auto size = [](const Value& v)
                { return std::holds_alternative<double>(v) ? sizeof(double) : std::get<std::string>(v).size(); };
                entry.bytes += c.id.size() + size(c.before) + size(c.after) + sizeof(Change);
            }
            return entry;
        }
        [[nodiscard]] std::vector<Entry> appended(Entry entry) const
        {
            auto next = undoStack;
            next.push_back(std::move(entry));
            std::size_t bytes = 0;
            for (const auto& e : next)
                bytes += e.bytes;
            while (next.size() > maxEntries || bytes > maxBytes)
            {
                bytes -= next.front().bytes;
                next.erase(next.begin());
            }
            return next;
        }
        void commit(const std::vector<Change>& changes, const std::optional<std::string>& label,
                    std::vector<Entry>* replayUndo = nullptr, std::vector<Entry>* replayRedo = nullptr,
                    bool preserveRedo = false)
        {
            std::vector<std::unique_ptr<Prepared>> prepared;
            prepared.reserve(changes.size());
            for (const auto& c : changes)
                prepared.push_back(field(c.id).prepare(c.after));
            std::optional<std::vector<Entry>> next;
            if (label && ! changes.empty())
                next = appended(makeEntry(*label, changes));
            const bool clearRedo = ! changes.empty() && ! preserveRedo && replayUndo == nullptr && ! redoStack.empty();
            // All validation and Soundor-owned allocation finishes before installation.
            for (const auto& p : prepared)
                p->install();
            if (next)
            {
                undoStack.swap(*next);
                redoStack.clear();
            }
            if (clearRedo)
                redoStack.clear();
            if (replayUndo)
                undoStack.swap(*replayUndo);
            if (replayRedo)
                redoStack.swap(*replayRedo);
            for (const auto& p : prepared)
                p->notify();
            changed(next.has_value() || clearRedo || replayUndo != nullptr);
        }
        void replay(bool redo)
        {
            guard(
                [&]
                {
                    if (active)
                        throw std::logic_error("cannot replay History inside a transaction");
                    const auto& source = redo ? redoStack : undoStack;
                    if (source.empty())
                        return;
                    const auto entry = source.back();
                    std::vector<Change> changes;
                    changes.reserve(entry.changes.size());
                    for (const auto& c : entry.changes)
                    {
                        const auto gesture = gestures.find(c.id);
                        if (gesture != gestures.end() && gesture->second.label)
                            throw std::logic_error("field belongs to an active History gesture");
                        const auto after = redo ? c.after : c.before;
                        auto before = field(c.id).read();
                        // Validate even a no-op replay, while avoiding redundant notifications.
                        if (before != after)
                            changes.push_back({ c.id, std::move(before), after });
                    }
                    auto nextUndo = undoStack;
                    auto nextRedo = redoStack;
                    if (redo)
                    {
                        nextRedo.pop_back();
                        nextUndo.push_back(entry);
                    }
                    else
                    {
                        nextUndo.pop_back();
                        nextRedo.push_back(entry);
                    }
                    commit(changes, std::nullopt, &nextUndo, &nextRedo);
                });
        }
        void changed(bool force = false) noexcept
        {
            try
            {
                const auto next = status();
                if (! force && next == lastStatus)
                    return;
                lastStatus = next;
                ++version;
                const auto callbacks = listeners;
                for (const auto& [id, callback] : callbacks)
                {
                    static_cast<void>(id);
                    try
                    {
                        callback(next);
                    }
                    catch (...)
                    {
                        // A subscriber cannot prevent delivery to the remaining subscribers.
                        continue;
                    }
                }
            }
            catch (...)
            {
                ++version;
            }
        }
        mutable std::recursive_mutex controlMutex;
        const std::size_t maxEntries;
        const std::size_t maxBytes;
        std::map<std::string, Field*> fields;
        std::map<std::string, Gesture> gestures;
        std::vector<Entry> undoStack;
        std::vector<Entry> redoStack;
        Transaction* active = nullptr;
        Status lastStatus;
        std::size_t version = 0;
        std::size_t nextListener = 0;
        std::map<std::size_t, Listener> listeners;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
