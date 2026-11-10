#pragma once

// JUCE backend: compiled into the plugin (it needs JUCE), not into the
// backend-independent soundor_runtime library.

#include <soundor/parameters/Parameters.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // A parameter's behavior: plain functions generated from soundor.config
    // (its mapping, step and text, compiled from the same expressions as the
    // Web runtime's). Values are plain units carried as doubles: the
    // parameter's number, 0/1 for a boolean, the option index for a choice.
    // The numeric functions allocate nothing and never throw.
    struct ParameterBehavior
    {
        // Normalized position (clamped to [0, 1]) → a legal value.
        double (*toValue)(double normalized) noexcept;
        // A legal value → its normalized position.
        double (*toNormalized)(double value) noexcept;
        // Any finite value → the nearest legal value.
        double (*constrain)(double value) noexcept;
        // A legal value → display text.
        std::string (*format)(double value);
        // Text → a legal value, or nothing.
        std::optional<double> (*parse)(std::string_view text);
    };

    // A Soundor parameter as a JUCE parameter: soundor.config's semantics
    // throughout (not NormalisableRange's skew), for the host, the APVTS, the
    // UI and the processing alike. Hosts read its text from the generated
    // functions, so they work with the editor closed.
    //
    // It holds the plain value: host automation sets it from its normalized
    // position (32-bit, as hosts carry it), the UI sets it exactly.
    class JuceParameter final : public juce::RangedAudioParameter
    {
    public:
        JuceParameter(const parameters::Info& info, const ParameterBehavior& behavior);

        [[nodiscard]] const parameters::Info& info() const noexcept { return declared; }
        [[nodiscard]] const ParameterBehavior& behavior() const noexcept { return functions; }

        // The current value. Realtime-safe.
        [[nodiscard]] float plain() const noexcept { return current.load(std::memory_order_relaxed); }

        // From the UI, on the message thread: the value, constrained, and the
        // host and listeners told.
        void setPlain(double value);

        // From the processing, on any thread including the audio thread: a
        // read-only parameter's new value. Realtime-safe: it only stores it;
        // flushPublished() tells the host and listeners on the message thread.
        void publish(double value) noexcept;

        // On the message thread: notifies of what publish() stored since the
        // last call.
        void flushPublished();

        // juce::AudioProcessorParameter
        float getValue() const override;
        void setValue(float normalized) override;
        float getDefaultValue() const override;
        juce::String getText(float normalized, int maximumLength) const override;
        // Text that is no value leaves the parameter where it is, rather than
        // turning into 0: JUCE has no way to refuse it.
        float getValueForText(const juce::String& text) const override;
        int getNumSteps() const override;
        bool isDiscrete() const override;
        bool isBoolean() const override;
        juce::StringArray getAllValueStrings() const override;

        // juce::RangedAudioParameter: the same functions, for the APVTS.
        const juce::NormalisableRange<float>& getNormalisableRange() const override { return range; }

    private:
        parameters::Info declared;
        ParameterBehavior functions;
        juce::NormalisableRange<float> range;
        std::atomic<float> current;
        std::atomic<bool> published { false };
    };

    // Tells the host and listeners, ~30 times a second on the message thread,
    // of the values read-only parameters published from the processing.
    class PublishedParameters final : private juce::Timer
    {
    public:
        explicit PublishedParameters(std::vector<JuceParameter*> readOnly);
        ~PublishedParameters() override;

        PublishedParameters(const PublishedParameters&) = delete;
        PublishedParameters& operator=(const PublishedParameters&) = delete;

        // What the timer does; for tests.
        void flush();

    private:
        void timerCallback() override { flush(); }

        std::vector<JuceParameter*> parameters;
    };

    namespace detail
    {
        template <class T> [[nodiscard]] T fromPlain(float value) noexcept
        {
            if constexpr (std::is_same_v<T, float>)
                return value;
            else if constexpr (std::is_same_v<T, bool>)
                return value >= 0.5f;
            else if constexpr (std::is_enum_v<T>)
                return static_cast<T>(static_cast<std::underlying_type_t<T>>(std::lround(value)));
            else
                return static_cast<T>(std::lround(value));
        }

        template <class T> [[nodiscard]] double toPlain(T value) noexcept
        {
            if constexpr (std::is_same_v<T, bool>)
                return value ? 1.0 : 0.0;
            else if constexpr (std::is_enum_v<T>)
                return static_cast<double>(static_cast<std::underlying_type_t<T>>(value));
            else
                return static_cast<double>(value);
        }
    } // namespace detail

    // A parameter's value in its declared C++ type (float, a sized integer,
    // bool, or the choice's enum), for the processing. Realtime-safe.
    template <class T> class ParameterValue
    {
    public:
        ParameterValue() = default;
        explicit ParameterValue(JuceParameter& bound) : parameter(&bound) {}

        [[nodiscard]] T load() const noexcept { return detail::fromPlain<T>(parameter->plain()); }
        [[nodiscard]] JuceParameter& juceParameter() const noexcept { return *parameter; }

    protected:
        JuceParameter* parameter = nullptr;
    };

    // A read-only parameter: the processing publishes it (a meter); the UI and
    // the host read it.
    template <class T> class ParameterOutput final : public ParameterValue<T>
    {
    public:
        using ParameterValue<T>::ParameterValue;

        // Realtime-safe; the host and the UI hear of it on the message thread.
        void publish(T value) noexcept { this->parameter->publish(detail::toPlain(value)); }
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
