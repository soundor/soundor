#pragma once

#include <soundor/soundor.h>

#include <limits>

// Orbit's processor: its buses, its tail and its editor. The audio processing
// is the Rust crate in native/, which soundor::AudioProcessor runs.
class OrbitProcessor final : public soundor::AudioProcessor
{
public:
    OrbitProcessor();
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Orbit"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override
    {
        // A captured loop sustains indefinitely. Allow the slowest 9-second
        // taps at maximum feedback to decay below -70 dB when not held.
        return holdParameter.load() ? std::numeric_limits<double>::infinity() : 900.0;
    }

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrbitProcessor)
};
