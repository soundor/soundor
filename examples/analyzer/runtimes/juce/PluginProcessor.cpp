#include "PluginProcessor.h"

#include "PluginEditor.h"

#include <algorithm>
#include <cmath>
#include <span>

namespace
{
    float decibels(float gain)
    {
        return juce::Decibels::gainToDecibels(gain, -96.0f);
    }
} // namespace

SoundorAnalyzerProcessor::SoundorAnalyzerProcessor()
    : soundor::AudioProcessor(BusesProperties()
                                  .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SoundorAnalyzerProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    juce::ignoreUnused(samplesPerBlock);
    history.fill(0.0f);
    written = 0;
    sinceLast = 0;

    // Bands spaced evenly in pitch from 20 Hz to 20 kHz (or Nyquist), each at
    // least one bin wide. Done here, never on the audio thread.
    const double nyquist = sampleRate / 2.0;
    const double low = 20.0;
    const double high = std::min(20000.0, nyquist);
    const int bins = fftSize / 2;
    for (int band = 0; band <= bands; ++band)
    {
        const double frequency = low * std::pow(high / low, static_cast<double>(band) / bands);
        const int bin = std::clamp(static_cast<int>(std::round(frequency / nyquist * bins)), 1, bins);
        const auto index = static_cast<size_t>(band);
        bandStart[index] = band == 0 ? bin : std::max(bin, bandStart[index - 1]);
    }
}

bool SoundorAnalyzerProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& mainOutput = layouts.getMainOutputChannelSet();
    if (mainOutput != juce::AudioChannelSet::mono() && mainOutput != juce::AudioChannelSet::stereo())
        return false;
    return layouts.getMainInputChannelSet() == mainOutput;
}

void SoundorAnalyzerProcessor::process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const int channels = buffer.getNumChannels();
    const int samples = buffer.getNumSamples();
    if (channels == 0)
        return;

    float peak = 0.0f;
    for (int sample = 0; sample < samples; ++sample)
    {
        float mono = 0.0f;
        for (int channel = 0; channel < channels; ++channel)
            mono += buffer.getSample(channel, sample);
        mono /= static_cast<float>(channels);
        peak = std::max(peak, std::abs(mono));
        history[static_cast<size_t>(written)] = mono;
        written = (written + 1) % fftSize;
        if (++sinceLast == hop)
        {
            sinceLast = 0;
            analyze();
        }
    }
    // Realtime-safe: one atomic exchange, no lock, no allocation.
    nativeChannels.peak.publish(decibels(peak));
}

void SoundorAnalyzerProcessor::analyze()
{
    // The window, oldest sample first.
    for (int index = 0; index < fftSize; ++index)
        transform[static_cast<size_t>(index)] = history[static_cast<size_t>((written + index) % fftSize)];
    std::fill(transform.begin() + fftSize, transform.end(), 0.0f);
    window.multiplyWithWindowingTable(transform.data(), static_cast<size_t>(fftSize));
    fft.performFrequencyOnlyForwardTransform(transform.data());

    // Written straight into the channel's own storage, then published whole:
    // the UI never sees a partly written spectrum, and nothing is copied.
    const std::span<float> spectrum = nativeChannels.spectrum.buffer();
    const float scale = 4.0f / static_cast<float>(fftSize); // Hann's gain, both halves
    for (int band = 0; band < bands; ++band)
    {
        const int first = bandStart[static_cast<size_t>(band)];
        const int last = std::max(first + 1, bandStart[static_cast<size_t>(band + 1)]);
        float magnitude = 0.0f;
        for (int bin = first; bin < last && bin <= fftSize / 2; ++bin)
            magnitude = std::max(magnitude, transform[static_cast<size_t>(bin)]);
        spectrum[static_cast<size_t>(band)] = decibels(magnitude * scale);
    }
    nativeChannels.spectrum.commit(bands);
}

juce::AudioProcessorEditor* SoundorAnalyzerProcessor::createEditor()
{
    return new SoundorAnalyzerEditor(*this);
}

// Plugin entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SoundorAnalyzerProcessor();
}
