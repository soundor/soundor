#pragma once

#include <soundor/Config.h>
#include <soundor/js/Context.h>

#include <atomic>
#include <cstddef>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
{
    enum class Kind
    {
        Float,
        Int,
        Bool,
        Choice,
    };

    // A parameter as declared in soundor.config (generated per plugin).
    struct Info
    {
        std::string id;
        std::string label;
        Kind kind = Kind::Float;
        // Plain-unit range and default. Bool: 0..1. Choice: 0..choices.size()-1.
        double min = 0;
        double max = 1;
        double defaultValue = 0;
        std::string unit;
        std::vector<std::string> choices;
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
    class Host
    {
    public:
        virtual ~Host() = default;

        [[nodiscard]] virtual std::span<const Info> infos() const = 0;
        [[nodiscard]] virtual double value(std::size_t index) const = 0;
        // `value` is already clamped (and rounded where discrete).
        virtual void setValue(std::size_t index, double value) = 0;
        virtual void beginGesture(std::size_t index) = 0;
        virtual void endGesture(std::size_t index) = 0;
        // Marked by the backend whenever a value changes, from any source.
        [[nodiscard]] virtual ChangeFlags& changes() = 0;
    };

    // Makes `soundor:parameters` importable in `context`, backed by `host`.
    void install(js::Context& context, std::shared_ptr<Host> host);

    // On the UI thread: delivers the changes marked since the last call to the
    // context's JavaScript subscribers. Returns how many parameters changed.
    std::size_t dispatchChanges(js::Context& context);

    // Clamps (and rounds, for discrete kinds) a plain value into range.
    [[nodiscard]] double constrain(const Info& info, double value) noexcept;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::parameters
