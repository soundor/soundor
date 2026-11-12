#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/history/StateHistory.h>
#include <soundor/js/Context.h>

#include <atomic>
#include <cstddef>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
{
    // A parameter's declared type (soundor.config `type`). The order is the
    // JavaScript module's: keep them in step.
    enum class Type
    {
        Int8,
        Uint8,
        Int16,
        Uint16,
        Int32,
        Uint32,
        Float32,
        Boolean,
        Choice,
    };

    // Who may change it (soundor.config `access`).
    enum class Access
    {
        Automatable,
        Manual,
        ReadOnly,
    };

    struct Choice
    {
        std::string value;
        std::string label;
    };

    // A parameter as declared in soundor.config (generated per plugin).
    struct Info
    {
        std::string id;
        std::string label;
        Type type = Type::Float32;
        Access access = Access::Automatable;
        // Plain-unit range and default. Boolean: 0..1. Choice: the option index.
        double min = 0;
        double max = 1;
        double defaultValue = 0;
        // 0 when the parameter has no step.
        double step = 0;
        std::string unit;
        std::vector<Choice> choices;
    };

    // Which parameters changed since the UI last looked.
    //
    // markChanged() is realtime-safe — lock-free, allocation-free, callable
    // from any thread including the audio thread — so backends can call it
    // straight from their parameter listeners. drain() runs on the UI thread.
    class ChangeFlags
    {
    public:
        explicit ChangeFlags(std::size_t count) : flags(count) {}

        void markChanged(std::size_t index) noexcept
        {
            if (index >= flags.size())
                return;
            flags[index].store(true, std::memory_order_relaxed);
            pending.store(true, std::memory_order_release);
        }

        // Calls visit(index) once for every parameter marked since the last
        // drain. A change marked concurrently is seen now or by the next drain.
        template <typename Visit>
        void drain(Visit&& visit)
        {
            if (! pending.exchange(false, std::memory_order_acquire))
                return;
            for (std::size_t i = 0; i < flags.size(); ++i)
                if (flags[i].exchange(false, std::memory_order_acq_rel))
                    visit(i);
        }

        [[nodiscard]] std::size_t size() const noexcept { return flags.size(); }

    private:
        std::vector<std::atomic<bool>> flags;
        std::atomic<bool> pending { false };
    };

    // A backend's parameter system (JUCE: the AudioProcessorValueTreeState),
    // seen from the UI thread. Indices follow infos(). Values are plain units:
    // the declared range, 0/1 for booleans, the index for choices.
    //
    // The parameter's behavior (its mapping, step and text) is the backend's,
    // generated from soundor.config: the engine never computes it, so it is
    // the same whether or not a UI runs.
    class Host
    {
    public:
        virtual ~Host() = default;

        [[nodiscard]] virtual std::span<const Info> infos() const = 0;
        [[nodiscard]] virtual double value(std::size_t index) const = 0;
        // `value` is a legal value (constrain() gave it).
        virtual void setValue(std::size_t index, double value) = 0;
        virtual void beginGesture(std::size_t index) = 0;
        virtual void endGesture(std::size_t index) = 0;
        // Marked by the backend whenever a value changes, from any source.
        [[nodiscard]] virtual ChangeFlags& changes() = 0;
        // Optional processor-owned editing pathway. Backends without History use the ordinary methods above.
        virtual history::StateHistory* historyManager() { return nullptr; }
        virtual void edit(std::size_t index, double value, const history::Options&) { setValue(index, value); }
        virtual void beginEdit(std::size_t index, const history::Options&) { beginGesture(index); }
        virtual void endEdit(std::size_t index) { endGesture(index); }
        virtual void disconnectEdits() noexcept {}

        // Any finite value → the nearest legal one (range, step, integer).
        [[nodiscard]] virtual double constrain(std::size_t index, double value) const = 0;
        // A legal value → its normalized position in [0, 1].
        [[nodiscard]] virtual double toNormalized(std::size_t index, double value) const = 0;
        // A normalized position (clamped to [0, 1]) → a legal value.
        [[nodiscard]] virtual double fromNormalized(std::size_t index, double normalized) const = 0;
        // A legal value as display text.
        [[nodiscard]] virtual std::string format(std::size_t index, double value) const = 0;
        // Text as a legal value, or nothing.
        [[nodiscard]] virtual std::optional<double> parse(std::size_t index, std::string_view text) const = 0;
    };

    // Makes `soundor:parameters` importable in `context`, backed by `host`.
    void install(js::Context& context, std::shared_ptr<Host> host);

    // On the UI thread: delivers the changes marked since the last call to the
    // context's JavaScript subscribers. Returns how many parameters changed.
    std::size_t dispatchChanges(js::Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
