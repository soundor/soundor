// The engine's Rust processor bridge (processor::RustProcessor) through the
// JUCE adapter (JuceRustProcessor.h), linked to a real processor (tests/rust,
// built with Cargo against the SDK's fixture contract): juce::AudioBuffers
// through the C ABI, as processBlock passes them.

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN

#include <soundor/backend/JuceMidiOutput.h>
#include <soundor/backend/JuceRustProcessor.h>
#include <soundor/processor/AudioState.h>

#include <doctest/doctest.h>

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <span>
#include <vector>

namespace backend = soundor::backend;
namespace processor = soundor::processor;

namespace
{
    // The engine's bridge on the linked Rust library, processing JUCE buffers
    // as the generated processBlock does.
    struct RustProcessor : processor::RustProcessor
    {
        explicit RustProcessor(processor::RustContract expected)
            : processor::RustProcessor(expected, processor::linkedRustProcessor())
        {
        }

        std::int32_t process(juce::AudioBuffer<float>& buffer, std::span<const double> parameters,
                             std::span<double> published, const SoundorTransport& transport,
                             const SoundorStreamSink* sink, const void* state = nullptr) noexcept
        {
            return backend::processRust(*this, buffer, parameters, published, transport, sink, state);
        }
    };
} // namespace

// Allocations on this thread, counted by AllocationCounter.cpp's operator new
// (0 under AddressSanitizer, which owns it). The Rust side's allocations are
// counted by the SDK's own tests (CountingAllocator).
bool soundorCountsAllocations();
std::uint64_t soundorAllocationsOf(void (*run)(void*), void* context);

namespace
{
    template <typename Run>
    std::uint64_t allocationsOf(Run&& run)
    {
        return soundorAllocationsOf([](void* context) { (*static_cast<Run*>(context))(); }, &run);
    }
} // namespace

namespace
{
    // The fixture config's: gain, bypass, mode, steps, peak (read-only); the
    // streams `history` (a buffer) and `level` (a number), in name order;
    // its state, 80 bytes (processingMode an int32 at 48, pattern's length a
    // uint32 at 12).
    constexpr processor::RustContract contract { 5, 1, 2, 80 };

    std::array<double, 5> parameters(double gain)
    {
        return { gain, 0.0, 1.0, 0.0, -96.0 };
    }

    const SoundorTransport noTransport = backend::rustTransport(nullptr);

    processor::RustBusLayout stereo()
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

    struct RecordedStreams
    {
        double level = std::numeric_limits<double>::quiet_NaN();
        std::array<float, 8> history {};
        std::uint32_t committed = 0;

        SoundorStreamSink sink()
        {
            return {
                this,
                [](void* user, std::uint32_t index, double value)
                {
                    if (index == 1)
                        static_cast<RecordedStreams*>(user)->level = value;
                },
                [](void* user, std::uint32_t index, std::uint32_t* capacity) -> void*
                {
                    *capacity = index == 0 ? 8 : 0;
                    return index == 0 ? static_cast<RecordedStreams*>(user)->history.data() : nullptr;
                },
                [](void* user, std::uint32_t index, std::uint32_t length)
                {
                    if (index == 0)
                        static_cast<RecordedStreams*>(user)->committed = length;
                },
            };
        }
    };
} // namespace

TEST_CASE("the Rust processor is created when it was built from the same contract")
{
    const RustProcessor processor(contract);
    CHECK(processor.valid());
    CHECK(processor.error().empty());

    const RustProcessor stale({ 4, 1, 2 });
    CHECK_FALSE(stale.valid());
    CHECK(stale.error().find("another soundor.config") != std::string::npos);
}

TEST_CASE("a stale Rust build stays silent")
{
    RustProcessor processor({ 1, 0, 0 });
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
    RustProcessor processor(contract);
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
    RustProcessor processor(contract);
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
    RustProcessor processor(contract);
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
    RustProcessor processor(contract);
    const auto values = parameters(1.0);
    const processor::RustBusLayout layout { { { 0 }, { 1 } }, { { 0 }, { 1 } } };
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
    RustProcessor processor(contract);
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
    RustProcessor processor(contract);
    juce::AudioBuffer<float> buffer(2, 16);
    fill(buffer, 0, 1.0f);
    const auto values = parameters(1.0);
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, nullptr) == SOUNDOR_STATUS_NOT_PREPARED);
    CHECK(all(buffer, 0, 0.0f));
    CHECK(processor.reset() == SOUNDOR_STATUS_NOT_PREPARED);
}

TEST_CASE("streams and the transport reach the processing")
{
    RustProcessor processor(contract);
    const auto values = parameters(0.75);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 8);
    fill(buffer, 0, 1.0f);
    fill(buffer, 1, 1.0f);
    RecordedStreams streams;
    const auto sink = streams.sink();
    auto transport = noTransport;
    transport.tempo = 96.0;
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, transport, &sink) == SOUNDOR_STATUS_OK);
    CHECK(streams.level == doctest::Approx(0.75));
    CHECK(streams.committed == 5);
    CHECK(streams.history[0] == doctest::Approx(0.75f));
    CHECK(streams.history[1] == doctest::Approx(96.0f));
    // Without a state, the config's defaults: processingMode 1, pattern [60, 64, 67].
    CHECK(streams.history[2] == 1.0f);
    CHECK(streams.history[3] == 3.0f);
    // The wavetable prepare published, one element a frame.
    CHECK(streams.history[4] == 64.0f);
}

TEST_CASE("a resource prepare publishes reaches the next block, and preparing again replaces it")
{
    RustProcessor processor(contract);
    const auto values = parameters(0.5);
    juce::AudioBuffer<float> buffer(2, 8);
    RecordedStreams streams;
    const auto sink = streams.sink();
    std::array<double, 1> published {};
    for (const int frames : { 64, 16, 512 })
    {
        REQUIRE(processor.prepare(48000, frames, stereo(), values) == SOUNDOR_STATUS_OK);
        CHECK(processor.process(buffer, values, published, noTransport, &sink) == SOUNDOR_STATUS_OK);
        CHECK(streams.history[4] == static_cast<float>(frames));
    }
    // Instances are independent.
    RustProcessor other(contract);
    REQUIRE(other.prepare(48000, 32, stereo(), values) == SOUNDOR_STATUS_OK);
    CHECK(processor.process(buffer, values, published, noTransport, &sink) == SOUNDOR_STATUS_OK);
    CHECK(streams.history[4] == 512.0f);
}

TEST_CASE("the state reaches the Rust processing as AudioState hands it over")
{
    RustProcessor processor(contract);
    processor::AudioState state(contract.stateSize);
    // The config's layout: processingMode 9, a pattern of 5 elements.
    state.publishWith(
        [](std::span<std::byte> out)
        {
            const std::int32_t mode = 9;
            const std::uint32_t length = 5;
            std::memcpy(out.data() + 48, &mode, sizeof mode);
            std::memcpy(out.data() + 12, &length, sizeof length);
        });
    const auto values = parameters(0.5);
    REQUIRE(processor.prepare(48000, 64, stereo(), values, state.acquire()) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 8);
    RecordedStreams streams;
    const auto sink = streams.sink();
    std::array<double, 1> published {};
    CHECK(processor.process(buffer, values, published, noTransport, &sink, state.acquire()) == SOUNDOR_STATUS_OK);
    CHECK(streams.history[2] == 9.0f);
    CHECK(streams.history[3] == 5.0f);
    // A state of another size is another config: refused.
    RustProcessor other({ 5, 1, 2, 72 });
    CHECK_FALSE(other.valid());
}

TEST_CASE("processing allocates nothing")
{
    if (! soundorCountsAllocations())
        return; // Under AddressSanitizer, which owns operator new.

    // That counting works, first.
    CHECK(allocationsOf([] { delete new int(1); }) == 1);

    // In place, blocks longer than prepared, streams and the transport.
    RustProcessor processor(contract);
    const auto values = parameters(0.5);
    REQUIRE(processor.prepare(48000, 64, stereo(), values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> buffer(2, 1000);
    RecordedStreams streams;
    const auto sink = streams.sink();
    auto transport = noTransport;
    transport.tempo = 120.0;
    std::array<double, 1> published {};
    const auto inPlace = allocationsOf(
        [&]
        {
            for (int block = 0; block < 20; ++block)
            {
                fill(buffer, 0, 0.5f);
                fill(buffer, 1, -0.5f);
                processor.process(buffer, values, published, transport, &sink);
            }
        });
    CHECK(inPlace == 0);
    CHECK(processor.lastStatus() == SOUNDOR_STATUS_OK);
    CHECK(streams.committed == 5);

    // An input copied out because it shares a channel with another output.
    RustProcessor aliased(contract);
    const processor::RustBusLayout layout { { { 0 }, { 1 } }, { { 0 }, { 1 } } };
    REQUIRE(aliased.prepare(48000, 32, layout, values) == SOUNDOR_STATUS_OK);
    juce::AudioBuffer<float> sidechain(2, 100);
    const auto copied = allocationsOf(
        [&]
        {
            for (int block = 0; block < 20; ++block)
                aliased.process(sidechain, values, published, noTransport, nullptr);
        });
    CHECK(copied == 0);
    CHECK(aliased.lastStatus() == SOUNDOR_STATUS_OK);
}

TEST_CASE("a panic silences the processor until it is prepared again")
{
    RustProcessor processor(contract);
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
    RustProcessor half(contract);
    RustProcessor silent(contract);
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
    const auto layout = backend::rustBusLayout(processor);
    CHECK(layout.inputs == std::vector<std::vector<int>> { { 0, 1 }, { 2 } });
    CHECK(layout.outputs == std::vector<std::vector<int>> { { 0, 1 } });
}

TEST_CASE("MIDI is timed across native processing chunks without audio-thread allocation")
{
    processor::RustProcessor midiProcessor(contract, processor::linkedRustProcessor(), soundor::midi::linkedMidi());
    const auto values = parameters(0.5);
    REQUIRE(midiProcessor.prepare(48000, 32, stereo(), values) == SOUNDOR_STATUS_OK);
    auto observer = std::make_shared<soundor::midi::Host>(midiProcessor.nativeHandle(), soundor::midi::linkedMidi());
    observer->observe(true);
    const std::array<SoundorMidiEvent, 3> events {
        { { 65, { 0x90, 60, 0 }, 1 }, { 0, { 0x90, 64, 100 }, 1 }, { 0, { 0xe0, 127, 127 }, 1 } }
    };
    std::array<SoundorMidiEvent, soundor::midi::capacity> output {};
    std::uint32_t count = 0;
    juce::AudioBuffer<float> buffer(2, 96);
    buffer.clear();
    std::array<double, 1> published {};
    const auto allocations = allocationsOf(
        [&]
        {
            CHECK(backend::processRust(midiProcessor, buffer, values, published, noTransport, nullptr, nullptr, events,
                                       output, &count)
                  == SOUNDOR_STATUS_OK);
        });
    REQUIRE(count == 3);
    CHECK(output[0].sampleOffset == 0);
    CHECK(output[0].bytes[1] == 64);
    CHECK(output[2].sampleOffset == 65);
    CHECK(output[2].bytes[0] == 0x90);
    CHECK(output[2].bytes[2] == 0);
    if (soundorCountsAllocations())
        CHECK(allocations == 0);
    observer->pump(); // The only allocations/delivery happen on the control thread.
}

TEST_CASE("MIDI output reclaims full capacity across repeated wrapper callbacks")
{
    soundor::backend::MidiOutputBuffer output;
    output.prepare();
    juce::MidiBuffer host;
    host.ensureSize(2048); // The format wrapper's initial allocation.
    const void* owned = nullptr;
    for (int block = 0; block < 8; ++block)
    {
        host.clear();
        REQUIRE(output.acquire(host));
        if (owned == nullptr)
            owned = output.events().data.begin();
        CHECK(output.events().data.begin() == owned);
        const auto allocations = allocationsOf(
            [&]
            {
                for (int event = 0; event < 1024; ++event)
                {
                    const std::uint8_t message[] { 0x90, 60, 100 };
                    output.events().addEvent(message, 3, event);
                }
                output.publish(host);
            });
        CHECK(host.data.begin() == owned); // No malloc/realloc moved storage.
        CHECK(host.getNumEvents() == 1024);
        if (soundorCountsAllocations())
            CHECK(allocations == 0);
    }
    // An unexpected wrapper owner cannot silently cause audio-thread growth.
    juce::MidiBuffer replaced;
    CHECK_FALSE(output.acquire(replaced));
    output.prepare(); // Reinitialization establishes fresh storage off the audio thread.
    CHECK(output.acquire(replaced));
    output.publish(replaced);
    CHECK(output.acquire(replaced));
}
