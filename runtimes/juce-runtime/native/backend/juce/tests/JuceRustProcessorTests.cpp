// The JUCE adapter of a plugin's Rust processor (RustProcessor), linked to a
// real one (tests/rust, built with Cargo against the SDK's fixture contract):
// juce::AudioBuffers through the C ABI, as processBlock passes them.

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN

#include <soundor/backend/RustProcessor.h>

#include <doctest/doctest.h>

#include <array>
#include <cmath>
#include <limits>
#include <vector>

namespace backend = soundor::backend;

namespace
{
    // The fixture config's: gain, bypass, mode, steps, peak (read-only); the
    // channels `history` (a buffer) and `level` (a number), in name order.
    constexpr backend::RustContract contract { 5, 1, 2 };

    std::array<double, 5> parameters(double gain)
    {
        return { gain, 0.0, 1.0, 0.0, -96.0 };
    }

    const SoundorTransport noTransport = backend::RustProcessor::transportOf(nullptr);

    backend::RustBusLayout stereo()
    {
        return { { { 0, 1 } }, { { 0, 1 } } };
    }

    void fill(juce::AudioBuffer<float>& buffer, int channel, float value)
    {
        for (int frame = 0; frame < buffer.getNumSamples(); ++frame)
            buffer.setSample(channel, frame, value);
    }

    bool all(const juce::AudioBuffer<float>& buffer, int channel, float value)
    {
        for (int frame = 0; frame < buffer.getNumSamples(); ++frame)
            if (buffer.getSample(channel, frame) != value)
                return false;
        return true;
    }

    struct RecordedChannels
    {
        double level = std::numeric_limits<double>::quiet_NaN();
        std::array<float, 8> history {};
        std::uint32_t committed = 0;

        SoundorChannelSink sink()
        {
            return {
                this,
                [](void* user, std::uint32_t index, double value)
                {
                    if (index == 1)
                        static_cast<RecordedChannels*>(user)->level = value;
                },
                [](void* user, std::uint32_t index, std::uint32_t* capacity) -> void*
                {
                    *capacity = index == 0 ? 8 : 0;
                    return index == 0 ? static_cast<RecordedChannels*>(user)->history.data() : nullptr;
                },
                [](void* user, std::uint32_t index, std::uint32_t length)
                {
                    if (index == 0)
                        static_cast<RecordedChannels*>(user)->committed = length;
                },
            };
        }
    };
} // namespace

TEST_CASE("the Rust processor is created when it was built from the same contract")
{
    const backend::RustProcessor processor(contract);
    CHECK(processor.valid());
    CHECK(processor.error().empty());

    const backend::RustProcessor stale({ 4, 1, 2 });
    CHECK_FALSE(stale.valid());
    CHECK(stale.error().find("another soundor.config") != std::string::npos);
}

TEST_CASE("a stale Rust build stays silent")
{
    backend::RustProcessor processor({ 1, 0, 0 });
    const auto values = parameters(1.0);
    CHECK(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_INVALID_ARGUMENT);
    juce::AudioBuffer<float> buffer(2, 16);
    fill(buffer, 0, 1.0f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_FAILED);
    CHECK(all(buffer, 0, 0.0f));
}

TEST_CASE("blocks are processed in place, with the parameters' values")
{
    backend::RustProcessor processor(contract);
    const auto values = parameters(0.5);
    REQUIRE(processor.prepare(48000, 512, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 256);
    fill(buffer, 0, 1.0f);
    fill(buffer, 1, -0.5f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(all(buffer, 0, 0.5f));
    CHECK(all(buffer, 1, -0.25f));
    // The read-only `peak`, published in decibels.
    CHECK(published[0] == doctest::Approx(20.0 * std::log10(0.5)).epsilon(1e-6));
    CHECK(processor.lastStatus() == SOUNDOR_STATUS_OK);
}

TEST_CASE("mono, and blocks longer than the host prepared for")
{
    backend::RustProcessor processor(contract);
    const auto values = parameters(0.25);
    REQUIRE(processor.prepare(44100, 64, { { { 0 } }, { { 0 } } }, values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(1, 1000);
    fill(buffer, 0, 1.0f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(all(buffer, 0, 0.25f));
}

TEST_CASE("an empty block is processed")
{
    backend::RustProcessor processor(contract);
    const auto values = parameters(1.0);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 0);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
}

TEST_CASE("an input sharing its buffer channel with another output is read before outputs are written")
{
    // As JUCE arranges mono in plus a mono sidechain, and mono out plus a mono
    // aux out: the sidechain and the aux output are buffer channel 1.
    backend::RustProcessor processor(contract);
    const auto values = parameters(1.0);
    const backend::RustBusLayout layout { { { 0 }, { 1 } }, { { 0 }, { 1 } } };
    REQUIRE(processor.prepare(48000, 32, layout, values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 100);
    fill(buffer, 0, 0.5f);
    fill(buffer, 1, 0.25f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(all(buffer, 0, 0.5f));
    // The sidechain, doubled: had it not been copied out, the aux output
    // would have started silent and the processor read silence.
    CHECK(all(buffer, 1, 0.5f));
}

TEST_CASE("a buffer with fewer channels than the layout is silenced")
{
    backend::RustProcessor processor(contract);
    const auto values = parameters(1.0);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(1, 16);
    fill(buffer, 0, 1.0f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_INVALID_ARGUMENT);
    CHECK(all(buffer, 0, 0.0f));
}

TEST_CASE("processing before prepare is silent")
{
    backend::RustProcessor processor(contract);
    juce::AudioBuffer<float> buffer(2, 16);
    fill(buffer, 0, 1.0f);
    const auto values = parameters(1.0);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_NOT_PREPARED);
    CHECK(all(buffer, 0, 0.0f));
    CHECK(processor.reset() == SOUNDOR_STATUS_NOT_PREPARED);
}

TEST_CASE("channels and the transport reach the processing")
{
    backend::RustProcessor processor(contract);
    const auto values = parameters(0.75);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 8);
    fill(buffer, 0, 1.0f);
    fill(buffer, 1, 1.0f);
    RecordedChannels channels;
    const auto sink = channels.sink();
    auto transport = noTransport;
    transport.tempo = 96.0;
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, transport, &sink) == SOUNDOR_STATUS_OK);
    CHECK(channels.level == doctest::Approx(0.75));
    CHECK(channels.committed == 2);
    CHECK(channels.history[0] == doctest::Approx(0.75f));
    CHECK(channels.history[1] == doctest::Approx(96.0f));
}

TEST_CASE("a panic silences the processor until it is prepared again")
{
    backend::RustProcessor processor(contract);
    auto values = parameters(2.0);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 16);
    fill(buffer, 0, 1.0f);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_PANICKED);
    CHECK(all(buffer, 0, 0.0f));
    CHECK(std::isnan(published[0]));
    values = parameters(1.0);
    fill(buffer, 0, 1.0f);
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_FAILED);
    CHECK(all(buffer, 0, 0.0f));
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    fill(buffer, 0, 1.0f);
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(all(buffer, 0, 1.0f));
}

TEST_CASE("instances are independent")
{
    backend::RustProcessor half(contract);
    backend::RustProcessor silent(contract);
    const auto halfValues = parameters(0.5);
    const auto silentValues = parameters(0.0);
    REQUIRE(half.prepare(48000, 64, stereo(), halfValues) == SOUNDOR_STATUS_OK);
    REQUIRE(silent.prepare(48000, 64, stereo(), silentValues) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> a(2, 8);
    juce::AudioBuffer<float> b(2, 8);
    fill(a, 0, 1.0f);
    fill(b, 0, 1.0f);
    std::array<double, 1> published {};
    CHECK(half.process(a, halfValues, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(silent.process(b, silentValues, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(all(a, 0, 0.5f));
    CHECK(all(b, 0, 0.0f));
}

TEST_CASE("the bus layout is read from a JUCE processor")
{
    struct Buses final : juce::AudioProcessor
    {
        Buses()
            : juce::AudioProcessor(BusesProperties()
                                       .withInput("In", juce::AudioChannelSet::stereo(), true)
                                       .withInput("Side", juce::AudioChannelSet::mono(), true)
                                       .withOutput("Out", juce::AudioChannelSet::stereo(), true))
        {
        }
        const juce::String getName() const override { return "Buses"; }
        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
        double getTailLengthSeconds() const override { return 0; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        juce::AudioProcessorEditor* createEditor() override { return nullptr; }
        bool hasEditor() const override { return false; }
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram(int) override {}
        const juce::String getProgramName(int) override { return {}; }
        void changeProgramName(int, const juce::String&) override {}
        void getStateInformation(juce::MemoryBlock&) override {}
        void setStateInformation(const void*, int) override {}
    } processor;
    const auto layout = backend::RustBusLayout::of(processor);
    CHECK(layout.inputs == std::vector<std::vector<int>> { { 0, 1 }, { 2 } });
    CHECK(layout.outputs == std::vector<std::vector<int>> { { 0, 1 } });
}
