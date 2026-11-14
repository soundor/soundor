#pragma once

#include "Delay.h"

#include <soundor/soundor.h>

#include <limits>

class OrbitProcessor final : public soundor::AudioProcessor
{
public:
    OrbitProcessor();
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void process(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
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
    orbit::Delay delay;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrbitProcessor)
};
