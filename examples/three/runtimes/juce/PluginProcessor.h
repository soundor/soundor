#pragma once

#include <soundor/soundor.h>

#include <juce_audio_processors/juce_audio_processors.h>

// Your plugin's processor. Inherits soundor::AudioProcessor, which owns the
// parameter tree generated from soundor.config. Add your DSP here.
class SoundorThreeProcessor final : public soundor::AudioProcessor
{
public:
    SoundorThreeProcessor();
    ~SoundorThreeProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void process(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Soundor Basic"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

private:
    // Last block's applied gain, so process() can ramp to the new target
    // value instead of stepping (which would click on fast automation).
    float previousGain { 0.5f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorThreeProcessor)
};
