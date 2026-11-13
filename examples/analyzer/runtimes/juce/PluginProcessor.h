#pragma once

#include <soundor/soundor.h>

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>

#include <array>

// A spectrum analyzer: passes its audio through and publishes, from the audio
// thread, the spectrum and peak of what it hears to the UI, through the
// config's native channels (nativeChannels, generated from soundor.config).
class SoundorAnalyzerProcessor final : public soundor::AudioProcessor
{
public:
    SoundorAnalyzerProcessor();
    ~SoundorAnalyzerProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void process(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

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
    static constexpr int fftOrder = 11;
    static constexpr int fftSize = 1 << fftOrder;
    // A spectrum every half window (1024 samples): about 47 a second at
    // 48 kHz, 94 at 96 kHz. The UI draws the newest at its frame rate.
    static constexpr int hop = fftSize / 2;
    // As soundor.config declares `spectrum` (maxLength: 128).
    static constexpr int bands = 128;

    void analyze();

    juce::dsp::FFT fft { fftOrder };
    juce::dsp::WindowingFunction<float> window { static_cast<size_t>(fftSize),
                                                 juce::dsp::WindowingFunction<float>::hann };
    // The last fftSize samples (mono), written circularly.
    std::array<float, fftSize> history {};
    int written = 0;
    int sinceLast = 0;
    std::array<float, 2 * fftSize> transform {};
    // The FFT bins each band sums, from bandStart[band] to bandStart[band + 1].
    std::array<int, bands + 1> bandStart {};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SoundorAnalyzerProcessor)
};
