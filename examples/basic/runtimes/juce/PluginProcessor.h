#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <soundor/soundor.h>

#include <atomic>

// Your plugin's processor. Inherits soundor::AudioProcessor, which owns the
// parameter tree generated from soundor.config. Add your DSP here.
class SoundorBasicProcessor final : public soundor::AudioProcessor
{
public:
    SoundorBasicProcessor();
    ~SoundorBasicProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

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

    // App-specific UI telemetry (not part of the generated framework): the
    // latest output RMS level, pushed to the UI by the editor's onFrame().
    float getCurrentLevel() const { return currentLevel.load(); }

private:
    std::atomic<float> currentLevel { 0.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorBasicProcessor)
};
