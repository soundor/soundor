#pragma once

#include <soundor/soundor.h>

#include <juce_audio_processors/juce_audio_processors.h>

// The analyzer's processor: its buses and its editor. The analysis is the
// Rust crate in native/, which soundor::AudioProcessor runs, and which
// publishes the spectrum and peak to the UI through the config's native
// channels.
class SoundorAnalyzerProcessor final : public soundor::AudioProcessor
{
public:
    SoundorAnalyzerProcessor();
    ~SoundorAnalyzerProcessor() override = default;

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Soundor Analyzer"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorAnalyzerProcessor)
};
