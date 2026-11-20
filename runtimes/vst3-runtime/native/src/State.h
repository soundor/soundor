#pragma once

// Persistent state (`soundor:state`), driven by the plugin's descriptor rather
// than by generated code:
//
// - StateSchema checks a value against its field's type and writes it as
//   canonical state JSON (64-bit integers as decimal strings, struct fields in declared
//   order), and lays out the audio fields' snapshot (describeAudioState()).
// - StateStore holds the committed values, with History, gestures and
//   notifications.

#include "Descriptor.h"

#include <soundor/history/StateHistory.h>
#include <soundor/json/Json.h>

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::vst3
{
    namespace history = soundor::history;

    inline constexpr std::size_t maxSnapshotBytes = std::size_t { 8 } * 1024 * 1024;

    class StateSchema
    {
    public:
        explicit StateSchema(const Plugin& plugin);

        [[nodiscard]] std::size_t size() const noexcept { return fields.size(); }
        [[nodiscard]] const StateField& field(std::size_t index) const { return fields.at(index); }
        [[nodiscard]] std::optional<std::size_t> indexOf(std::string_view name) const noexcept;
        [[nodiscard]] const json::Value& types() const noexcept { return declared; }

        // `value` as field `index`'s canonical JSON; throws std::invalid_argument
        // saying what is wrong (a type mismatch, a range, a maxLength).
        [[nodiscard]] std::string canonical(std::size_t index, const json::Value& value) const;
        [[nodiscard]] std::string canonical(std::size_t index, std::string_view text) const;
        // A value of `type` (a descriptor type node), canonical; throws.
        [[nodiscard]] json::Value canonicalValue(const json::Value& type, const json::Value& value,
                                                 std::string_view path) const;
        // A declared type (struct or enum) by name, or null.
        [[nodiscard]] const json::Value* declaredType(std::string_view name) const noexcept;

        // The default values, canonical, by field name.
        [[nodiscard]] std::map<std::string, std::string> defaults() const;

        // The audio snapshot of `values` (canonical JSON by field name):
        // audioSize() bytes laid out as the processor's StateSnapshot.
        [[nodiscard]] std::size_t audioSize() const noexcept { return snapshotSize; }
        void writeAudio(const std::map<std::string, std::string>& values, std::span<std::byte> out) const;

        // The state document's "state" member as canonical values by field,
        // the defaults for absent fields: throws std::invalid_argument.
        [[nodiscard]] std::map<std::string, std::string> read(const json::Value* state) const;
        // Canonical values as the document's "state" object.
        [[nodiscard]] json::Value write(const std::map<std::string, std::string>& values) const;

    private:
        // The module's plugin, which outlives every context: the property
        // names bindings make from these strings are cached by address.
        const std::vector<StateField>& fields;
        const json::Value& declared;
        const std::vector<AudioField>& audio;
        std::size_t snapshotSize = 0;
    };

    class StateStore
    {
    public:
        using Values = std::map<std::string, std::string>;
        using Session = std::uint64_t;
        using Validator = std::function<void(const std::string&)>;
        using Callback = std::function<void(const std::string&)>;

        explicit StateStore(history::StateHistory& shared);
        ~StateStore();
        StateStore(const StateStore&) = delete;
        StateStore& operator=(const StateStore&) = delete;
        StateStore(StateStore&&) = delete;
        StateStore& operator=(StateStore&&) = delete;

        [[nodiscard]] history::StateHistory& historyManager() { return history; }
        void initialize(const std::string& name, std::string value, Validator validate);

        // Owner zero is native code (the Rust controller); others are UI
        // contexts. Cleanup removes only an owner's own contribution.
        void beginGesture(const std::string& field, Session owner = 0, const history::Options& options = {});
        void endGesture(const std::string& field, Session owner = 0);
        void resetGestures();

        std::function<void()> subscribe(const std::string& field, Callback callback);
        [[nodiscard]] std::recursive_mutex& mutex() const { return lock; }
        // A field's value as History sees it (staged inside a transaction).
        [[nodiscard]] std::string get(const std::string& field) const;
        void set(const std::string& field, std::string value, const history::Options& options = {});
        // Installs every value of `next` (a restore, a preset), then notifies.
        void replace(const Values& next);
        // A field's committed value.
        [[nodiscard]] std::string committed(const std::string& field) const;
        [[nodiscard]] Values snapshot() const;
        void restored();

        struct Event
        {
            std::string field;
            std::string value;
            bool restored = false;
        };
        Session connect();
        void disconnect(Session owner);
        std::vector<Event> drain();

    private:
        struct Notification
        {
            std::string value;
            std::vector<Callback> callbacks;
        };
        struct HistoryField;
        void deliverPrepared() noexcept;

        history::StateHistory& history;
        std::map<std::string, std::unique_ptr<HistoryField>> historyFields;
        mutable std::recursive_mutex lock;
        Values values;
        Session session = 0;
        std::map<std::string, std::map<Session, std::size_t>> gestures;
        std::size_t nextListener = 0;
        std::map<std::string, std::map<std::size_t, Callback>> listeners;
        bool notifyingNative = false;
        std::deque<Event> nativeEvents;
        bool connected = false;
        std::list<Event> events;
        std::list<Notification> preparedNotifications;
        bool deliveringPrepared = false;
    };
} // namespace soundor::vst3
