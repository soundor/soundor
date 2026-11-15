#pragma once

#include <soundor/soundor.h>

#include <juce_audio_processors/juce_audio_processors.h>

// Your plugin's processor. Inherits soundor::AudioProcessor, which owns the
// parameters generated from soundor.config and runs the audio processing:
// the Rust crate in native/. What is here is the rest of the plugin: its
// editor, its buses and, when the config declares one, its native API
// (createNativeApi()).
class SoundorPrimitivesProcessor final : public soundor::AudioProcessor
{
public:
    SoundorPrimitivesProcessor();
    ~SoundorPrimitivesProcessor() override = default;

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Soundor Primitives"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorPrimitivesProcessor)
};
