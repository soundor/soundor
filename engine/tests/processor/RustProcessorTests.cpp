// processor::RustProcessor, the engine's bridge to a plugin's Rust processor,
// on a C++ processor that keeps the ABI's rules (RustProcessorAbi.h) behind
// the function table: the bridge's own work (contract checks, block
// splitting, in-place channels, published values, silence on failure,
// lifecycle) without a Rust library. The VST3 runtime's plugin
// tests run the same bridge on a real Rust processor.

#include <soundor/processor/AudioState.h>
#include <soundor/processor/RustProcessor.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <optional>
#include <span>
#include <string>
#include <vector>

// AllocationCounter.cpp's (0 counted under AddressSanitizer, which owns
// operator new).
bool soundorCountsAllocations();
std::uint64_t soundorAllocationsOf(void (*run)(void*), void* context);

namespace processor = soundor::processor;

namespace
{
    template <typename Run>
    std::uint64_t allocationsOf(Run&& run)
    {
        return soundorAllocationsOf([](void* context) { (*static_cast<Run*>(context))(); }, &run);
    }

    // Parameters: gain (a negative one fails the block). Published: the
    // block's first output sample. One stream, unused here. A state of 16
    // bytes: a float64 gain multiplier and an int32 the block adds.
    constexpr processor::RustContract contract { 1, 1, 1, 16 };
    struct State
    {
        double multiplier = 1;
        std::int32_t offset = 0;
    };
    static_assert(sizeof(State) == 16);

    struct Fake
    {
        double sampleRate = 0;
        std::uint32_t maxFrames = 0;
        std::uint32_t inputs = 0, outputs = 0;
        double gain = 1;
        int blocks = 0;
        std::uint32_t longest = 0;
        int resets = 0;
    };

    std::atomic<int> live { 0 };
    std::atomic<int> destroyed { 0 };
    // What the last block was given.
    const SoundorTransport* lastTransport = nullptr;
    const SoundorStreamSink* lastSink = nullptr;
    // What the last prepare and block read of the state (none: null).
    std::optional<State> preparedState, processedState;

    // How each processor processes: a gain in place, or (sidechain) the aux
    // output written before the sidechain is read.
    enum class Mode : std::uint8_t
    {
        Gain,
        Sidechain,
    };
    Mode mode = Mode::Gain;

    std::int32_t info(SoundorProcessorInfo* info)
    {
        *info = { sizeof(SoundorProcessorInfo),
                  SOUNDOR_PROCESSOR_ABI_VERSION,
                  contract.parameters,
                  contract.published,
                  contract.streams,
                  contract.stateSize };
        return SOUNDOR_STATUS_OK;
    }

    void* create()
    {
        ++live;
        return new Fake;
    }

    std::int32_t prepare(void* handle, const SoundorPrepare* config)
    {
        auto& fake = *static_cast<Fake*>(handle);
        if (config->abiVersion != SOUNDOR_PROCESSOR_ABI_VERSION || config->maxFrames == 0)
            return SOUNDOR_STATUS_INVALID_ARGUMENT;
        fake.sampleRate = config->sampleRate;
        fake.maxFrames = config->maxFrames;
        fake.inputs = 0;
        fake.outputs = 0;
        for (std::uint32_t bus = 0; bus < config->inputBusCount; ++bus)
            fake.inputs += config->inputChannels[bus];
        for (std::uint32_t bus = 0; bus < config->outputBusCount; ++bus)
            fake.outputs += config->outputChannels[bus];
        if (config->parameters != nullptr && config->parameterCount > 0)
            fake.gain = config->parameters[0];
        if (config->state != nullptr && config->stateSize != sizeof(State))
            return SOUNDOR_STATUS_INVALID_ARGUMENT;
        preparedState.reset();
        if (config->state != nullptr)
            preparedState = *static_cast<const State*>(config->state);
        return SOUNDOR_STATUS_OK;
    }

    std::int32_t process(void* handle, const SoundorBlock* block)
    {
        auto& fake = *static_cast<Fake*>(handle);
        if (block->frames > fake.maxFrames || block->inputCount != fake.inputs || block->outputCount != fake.outputs)
            return SOUNDOR_STATUS_INVALID_ARGUMENT;
        ++fake.blocks;
        fake.longest = std::max(fake.longest, block->frames);
        lastTransport = block->transport;
        lastSink = block->streams;
        if (block->parameters != nullptr)
            fake.gain = block->parameters[0];
        if (block->state != nullptr && block->stateSize != sizeof(State))
            return SOUNDOR_STATUS_INVALID_ARGUMENT;
        processedState.reset();
        if (block->state != nullptr)
            processedState = *static_cast<const State*>(block->state);
        if (fake.gain < 0)
            return SOUNDOR_STATUS_FAILED;
        if (mode == Mode::Sidechain)
        {
            // Aux first: an input sharing its channel must have been copied.
            for (std::uint32_t frame = 0; frame < block->frames; ++frame)
                block->outputs[1][frame] = 100.0F;
            for (std::uint32_t frame = 0; frame < block->frames; ++frame)
                block->outputs[0][frame] = block->inputs[0][frame] + block->inputs[1][frame];
        }
        else
            for (std::uint32_t channel = 0; channel < block->outputCount; ++channel)
                for (std::uint32_t frame = 0; frame < block->frames; ++frame)
                    block->outputs[channel][frame] = static_cast<float>(block->inputs[channel][frame] * fake.gain);
        // Every slot, every block, as the SDK writes them: NaN for none.
        if (block->publishedCount > 0)
            block->published[0] = block->frames > 0 ? block->outputs[0][0] : std::nan("");
        return SOUNDOR_STATUS_OK;
    }

    std::int32_t reset(void* handle)
    {
        ++static_cast<Fake*>(handle)->resets;
        return SOUNDOR_STATUS_OK;
    }

    void destroy(void* handle)
    {
        --live;
        ++destroyed;
        delete static_cast<Fake*>(handle);
    }

    constexpr processor::RustProcessorFunctions functions { &info, &create, &prepare, &process, &reset, &destroy };

    // A block's channels, as a runtime's callback holds them.
    struct Channels
    {
        std::vector<std::vector<float>> data;
        std::vector<float*> pointers;

        Channels(int count, int frames, float value = 0.0F)
            : data(static_cast<std::size_t>(count), std::vector<float>(static_cast<std::size_t>(frames), value))
        {
            for (auto& channel : data)
                pointers.push_back(channel.data());
        }

        [[nodiscard]] std::span<float* const> span() const { return { pointers.data(), pointers.size() }; }

        [[nodiscard]] bool all(std::size_t channel, float value) const
        {
            return std::ranges::all_of(data[channel], [value](float sample) { return sample == value; });
        }
    };

    processor::RustBusLayout stereo()
    {
        return { { { 0, 1 } }, { { 0, 1 } } };
    }
    const SoundorTransport noTransport = processor::unknownTransport();
} // namespace

TEST_CASE("the bridge checks the processor's ABI and contract before creating it")
{
    mode = Mode::Gain;
    const int before = live;
    {
        const processor::RustProcessor matching(contract, functions);
        CHECK(matching.valid());
        CHECK(matching.error().empty());
        CHECK(live == before + 1);

        const processor::RustProcessor stale({ 2, 1, 1, 16 }, functions);
        CHECK_FALSE(stale.valid());
        CHECK(stale.error().find("another soundor.config") != std::string::npos);
        // Another state layout's size is another config too.
        const processor::RustProcessor otherState({ 1, 1, 1, 24 }, functions);
        CHECK_FALSE(otherState.valid());

        auto older = functions;
        older.info = [](SoundorProcessorInfo* info)
        {
            *info = { sizeof(SoundorProcessorInfo), SOUNDOR_PROCESSOR_ABI_VERSION + 1, 1, 1, 1, 16 };
            return std::int32_t { SOUNDOR_STATUS_OK };
        };
        const processor::RustProcessor other(contract, older);
        CHECK_FALSE(other.valid());
        CHECK(other.error().find("another Soundor ABI") != std::string::npos);

        auto incomplete = functions;
        incomplete.reset = nullptr;
        const processor::RustProcessor missing(contract, incomplete);
        CHECK_FALSE(missing.valid());

        auto panicking = functions;
        panicking.create = []() -> void* { return nullptr; };
        const processor::RustProcessor panicked(contract, panicking);
        CHECK_FALSE(panicked.valid());
        CHECK(panicked.error().find("panicked") != std::string::npos);
        // Neither a refused build nor a failed construction made a processor.
        CHECK(live == before + 1);
    }
    CHECK(live == before);
}

TEST_CASE("a processor that is not valid, or not prepared, is silent")
{
    mode = Mode::Gain;
    const std::array<double, 1> gain { 0.5 };
    std::array<double, 1> published { 1.0 };

    processor::RustProcessor stale({ 2, 1, 1, 16 }, functions);
    CHECK(stale.prepare(48000, 64, stereo(), gain) == SOUNDOR_STATUS_INVALID_ARGUMENT);
    Channels a(2, 16, 1.0F);
    CHECK(stale.process(a.span(), 16, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_FAILED);
    CHECK((a.all(0, 0.0F) && a.all(1, 0.0F)));
    CHECK(std::isnan(published[0]));
    CHECK(stale.reset() == SOUNDOR_STATUS_FAILED);

    processor::RustProcessor unprepared(contract, functions);
    Channels b(3, 16, 1.0F);
    CHECK(unprepared.process(b.span(), 16, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_NOT_PREPARED);
    // It knows no outputs yet: every channel is silenced.
    CHECK((b.all(0, 0.0F) && b.all(1, 0.0F) && b.all(2, 0.0F)));
    CHECK(unprepared.lastStatus() == SOUNDOR_STATUS_NOT_PREPARED);
    CHECK(unprepared.prepare(48000, 0, stereo(), gain) == SOUNDOR_STATUS_INVALID_ARGUMENT);
}

TEST_CASE("blocks are processed in place, with each block's parameters and the host's transport")
{
    mode = Mode::Gain;
    processor::RustProcessor rust(contract, functions);
    std::array<double, 1> gain { 0.5 };
    REQUIRE(rust.prepare(44100, 64, stereo(), gain) == SOUNDOR_STATUS_OK);
    Channels block(2, 48, 1.0F);
    std::array<double, 1> published {};
    SoundorTransport transport = noTransport;
    transport.tempo = 120;
    std::array<float, 4> history {};
    SoundorStreamSink sink { history.data(), nullptr, nullptr, nullptr };
    CHECK(rust.process(block.span(), 48, gain, published, transport, &sink) == SOUNDOR_STATUS_OK);
    CHECK((block.all(0, 0.5F) && block.all(1, 0.5F)));
    CHECK(published[0] == 0.5);
    CHECK(rust.lastStatus() == SOUNDOR_STATUS_OK);
    CHECK(lastTransport == &transport);
    CHECK(lastTransport->tempo == 120);
    CHECK(lastSink == &sink);

    gain[0] = 2.0;
    CHECK(rust.process(block.span(), 48, gain, published, transport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(block.all(0, 1.0F));
}

TEST_CASE("blocks longer than prepared are split; the published value is the last chunk's")
{
    mode = Mode::Gain;
    processor::RustProcessor rust(contract, functions);
    const std::array<double, 1> gain { 0.25 };
    REQUIRE(rust.prepare(48000, 32, stereo(), gain) == SOUNDOR_STATUS_OK);
    Channels block(2, 100);
    for (std::size_t frame = 0; frame < 100; ++frame)
        block.data[0][frame] = static_cast<float>(frame);
    std::array<double, 1> published {};
    CHECK(rust.process(block.span(), 100, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    for (std::size_t frame = 0; frame < 100; ++frame)
        CHECK(block.data[0][frame] == static_cast<float>(frame) * 0.25F);
    // Chunks start at 0, 32, 64 and 96: the last published its first sample.
    CHECK(published[0] == 96 * 0.25);

    // An empty block is one call, of no frames, which publishes nothing.
    CHECK(rust.process(block.span(), 0, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK(std::isnan(published[0]));
}

TEST_CASE("an input sharing its channel with another output is copied out first")
{
    mode = Mode::Sidechain;
    processor::RustProcessor rust(contract, functions);
    const std::array<double, 1> gain { 1.0 };
    // Main in 0, sidechain in 1; main out 0, aux out 1: a sidechain's channel
    // is the aux output's, as JUCE arranges them.
    const processor::RustBusLayout layout { { { 0 }, { 1 } }, { { 0 }, { 1 } } };
    REQUIRE(rust.prepare(48000, 16, layout, gain) == SOUNDOR_STATUS_OK);
    Channels block(2, 40);
    for (std::size_t frame = 0; frame < 40; ++frame)
    {
        block.data[0][frame] = 1.0F;
        block.data[1][frame] = static_cast<float>(frame);
    }
    std::array<double, 1> published {};
    CHECK(rust.process(block.span(), 40, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    for (std::size_t frame = 0; frame < 40; ++frame)
        CHECK(block.data[0][frame] == 1.0F + static_cast<float>(frame));
    CHECK(block.all(1, 100.0F));
    mode = Mode::Gain;
}

TEST_CASE("a failed block silences the outputs from where it failed, and too few channels are refused")
{
    mode = Mode::Gain;
    processor::RustProcessor rust(contract, functions);
    const std::array<double, 1> failing { -1.0 };
    REQUIRE(rust.prepare(48000, 64, stereo(), std::array<double, 1> { 1.0 }) == SOUNDOR_STATUS_OK);
    Channels block(3, 32, 1.0F);
    std::array<double, 1> published { 0.0 };
    CHECK(rust.process(block.span(), 32, failing, published, noTransport, nullptr) == SOUNDOR_STATUS_FAILED);
    CHECK((block.all(0, 0.0F) && block.all(1, 0.0F)));
    // Not an output: left as it was.
    CHECK(block.all(2, 1.0F));
    CHECK(std::isnan(published[0]));
    CHECK(rust.lastStatus() == SOUNDOR_STATUS_FAILED);

    Channels mono(1, 32, 1.0F);
    const std::array<double, 1> gain { 1.0 };
    CHECK(rust.process(mono.span(), 32, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_INVALID_ARGUMENT);
    CHECK(mono.all(0, 0.0F));
}

TEST_CASE("instances are independent, prepare again for a new rate or block size, and are destroyed once")
{
    mode = Mode::Gain;
    const int destroyedBefore = destroyed;
    {
        processor::RustProcessor half(contract, functions);
        processor::RustProcessor doubled(contract, functions);
        const std::array<double, 1> halfGain { 0.5 };
        const std::array<double, 1> doubleGain { 2.0 };
        REQUIRE(half.prepare(48000, 64, stereo(), halfGain) == SOUNDOR_STATUS_OK);
        REQUIRE(doubled.prepare(96000, 128, stereo(), doubleGain) == SOUNDOR_STATUS_OK);
        Channels a(2, 64, 1.0F);
        Channels b(2, 64, 1.0F);
        std::array<double, 1> published {};
        CHECK(half.process(a.span(), 64, halfGain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
        CHECK(doubled.process(b.span(), 64, doubleGain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
        CHECK(a.all(0, 0.5F));
        CHECK(b.all(0, 2.0F));

        // A smaller block size: longer blocks are split to it from then on.
        REQUIRE(half.prepare(44100, 16, stereo(), halfGain) == SOUNDOR_STATUS_OK);
        Channels c(2, 64, 1.0F);
        CHECK(half.process(c.span(), 64, halfGain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
        CHECK(c.all(1, 0.5F));
        CHECK(half.reset() == SOUNDOR_STATUS_OK);
    }
    CHECK(destroyed == destroyedBefore + 2);
}

TEST_CASE("the state reaches prepare and each block, as AudioState hands it over")
{
    mode = Mode::Gain;
    processor::RustProcessor rust(contract, functions);
    processor::AudioState state(sizeof(State));
    const std::array<double, 1> gain { 1.0 };
    std::array<double, 1> published {};
    Channels block(2, 32, 1.0F);

    // Nothing published yet: the processor's defaults (null).
    REQUIRE(rust.prepare(48000, 64, stereo(), gain, state.acquire()) == SOUNDOR_STATUS_OK);
    CHECK_FALSE(preparedState.has_value());

    const auto write = [&](double multiplier, std::int32_t offset)
    {
        const State value { multiplier, offset };
        state.publish(std::as_bytes(std::span(&value, 1)));
    };
    write(2.0, 3);
    REQUIRE(rust.prepare(48000, 64, stereo(), gain, state.acquire()) == SOUNDOR_STATUS_OK);
    REQUIRE(preparedState.has_value());
    CHECK(preparedState.value_or(State {}).multiplier == 2.0);
    CHECK(preparedState.value_or(State {}).offset == 3);

    // Each block sees the newest snapshot; those in between are coalesced.
    write(4.0, 5);
    write(8.0, 9);
    CHECK(rust.process(block.span(), 32, gain, published, noTransport, nullptr, state.acquire()) == SOUNDOR_STATUS_OK);
    REQUIRE(processedState.has_value());
    CHECK(processedState.value_or(State {}).multiplier == 8.0);
    CHECK(processedState.value_or(State {}).offset == 9);
    // No change: the same snapshot, and no copy.
    const void* held = state.acquire();
    CHECK(state.acquire() == held);
    CHECK(state.statistics().published == 3);
    CHECK(state.statistics().taken == 2);
    // A block longer than prepared is processed in parts, all with the same state.
    Channels longer(2, 200, 1.0F);
    write(16.0, 17);
    CHECK(rust.process(longer.span(), 200, gain, published, noTransport, nullptr, state.acquire())
          == SOUNDOR_STATUS_OK);
    CHECK(processedState.value_or(State {}).multiplier == 16.0);
    // Without one, the processor's defaults.
    CHECK(rust.process(block.span(), 32, gain, published, noTransport, nullptr) == SOUNDOR_STATUS_OK);
    CHECK_FALSE(processedState.has_value());
}

TEST_CASE("process and reset do not allocate, after preparing or preparing again")
{
    mode = Mode::Gain;
    if (! soundorCountsAllocations())
        return;
    processor::RustProcessor rust(contract, functions);
    const std::array<double, 1> gain { 0.5 };
    const processor::RustBusLayout layout { { { 0 }, { 1 } }, { { 0 }, { 1 } } };
    Channels block(2, 300, 1.0F);
    std::array<double, 1> published {};
    processor::AudioState state(sizeof(State));
    const State value { 0.5, 1 };
    state.publish(std::as_bytes(std::span(&value, 1)));
    for (const int frames : { 512, 64, 7 })
    {
        REQUIRE(rust.prepare(48000, frames, layout, gain) == SOUNDOR_STATUS_OK);
        CHECK(allocationsOf(
                  [&]
                  {
                      (void)rust.process(block.span(), 300, gain, published, noTransport, nullptr);
                      (void)rust.process(block.span(), 0, gain, published, noTransport, nullptr);
                      (void)rust.reset();
                      (void)rust.process(block.span(), 300, gain, published, noTransport, nullptr, state.acquire());
                  })
              == 0);
    }
}
