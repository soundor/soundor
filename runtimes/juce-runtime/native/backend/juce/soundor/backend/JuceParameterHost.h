#pragma once

// JUCE backend: compiled into the plugin (it needs JUCE), not into the
// backend-independent soundor_runtime library.

#include <soundor/backend/JuceParameter.h>
#include <soundor/parameters/Parameters.h>

#include <juce_audio_processors/juce_audio_processors.h>

#include <span>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // `soundor:parameters` over a JUCE AudioProcessorValueTreeState of
    // JuceParameters. Reads and writes go through the parameters themselves —
    // there is no second parameter store — as do their mapping, step and text;
    // JUCE's listener callbacks, which may arrive on the audio thread, only set
    // a lock-free flag.
    //
    // Create one per plugin view on the message thread; the APVTS must outlive
    // it.
    class JuceParameterHost final : public parameters::Host, private juce::AudioProcessorParameter::Listener
    {
    public:
        JuceParameterHost(juce::AudioProcessorValueTreeState& state, std::span<const parameters::Info> infos);
        ~JuceParameterHost() override;

        JuceParameterHost(const JuceParameterHost&) = delete;
        JuceParameterHost& operator=(const JuceParameterHost&) = delete;

        [[nodiscard]] std::span<const parameters::Info> infos() const override { return declared; }
        [[nodiscard]] double value(std::size_t index) const override;
        void setValue(std::size_t index, double value) override;
        void beginGesture(std::size_t index) override;
        void endGesture(std::size_t index) override;
        [[nodiscard]] parameters::ChangeFlags& changes() override { return flags; }
        [[nodiscard]] double constrain(std::size_t index, double value) const override;
        [[nodiscard]] double toNormalized(std::size_t index, double value) const override;
        [[nodiscard]] double fromNormalized(std::size_t index, double normalized) const override;
        [[nodiscard]] std::string format(std::size_t index, double value) const override;
        [[nodiscard]] std::optional<double> parse(std::size_t index, std::string_view text) const override;

    private:
        // Realtime-safe: may run on the audio thread.
        void parameterValueChanged(int parameterIndex, float newValue) override;
        void parameterGestureChanged(int, bool) override {}

        std::span<const parameters::Info> declared;
        std::vector<JuceParameter*> bound;
        // JUCE parameter index → declared index, built once so the listener
        // never searches or allocates.
        std::vector<std::size_t> declaredIndexOf;
        parameters::ChangeFlags flags;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
