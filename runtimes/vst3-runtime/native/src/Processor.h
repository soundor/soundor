#pragma once

// The VST3 component: the plugin's audio processing, with the plugin's Rust
// processor (processor::RustProcessor, through `soundor::export!`'s ABI).
//
// Threads, as VST3 has them: initialize, terminate, the bus and processing
// setup, setActive and state on the host's control (UI) thread; process()
// on the audio thread, which takes no lock and allocates nothing: parameter
// values are atomics, the state snapshot a triple buffer
// (processor::AudioState), MIDI goes through preallocated arrays.

#include "Descriptor.h"
#include "Link.h"
#include "State.h"

#include <soundor/processor/AudioState.h>
#include <soundor/processor/RustProcessor.h>

#include <public.sdk/source/vst/vstaudioeffect.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace soundor::vst3
{
    namespace Vst = Steinberg::Vst;
    using Steinberg::tresult;

    // MIDI controllers the host sends as parameters (IMidiMapping): for each
    // channel, 0–127 control changes, then channel pressure, pitch bend and
    // program change, as VST3's ControllerNumbers number them.
    inline constexpr Vst::ParamID midiParameterBase = 0x7F000000;
    inline constexpr int midiControllersPerChannel = 131;
    // The factory presets' program change (a host's program selector).
    inline constexpr Vst::ParamID programParameterId = 0x7EFFFFFF;

    [[nodiscard]] Vst::ParamID midiParameterId(int channel, int controller) noexcept;

    class Processor final : public Vst::AudioEffect
    {
    public:
        explicit Processor(const Plugin& plugin);
        ~Processor() override;

        static Steinberg::FUnknown* create(void* context);

        tresult PLUGIN_API initialize(Steinberg::FUnknown* context) override;
        tresult PLUGIN_API terminate() override;
        tresult PLUGIN_API connect(Vst::IConnectionPoint* other) override;
        tresult PLUGIN_API disconnect(Vst::IConnectionPoint* other) override;
        tresult PLUGIN_API notify(Vst::IMessage* message) override;

        tresult PLUGIN_API setBusArrangements(Vst::SpeakerArrangement* inputs, Steinberg::int32 numIns,
                                              Vst::SpeakerArrangement* outputs, Steinberg::int32 numOuts) override;
        tresult PLUGIN_API activateBus(Vst::MediaType type, Vst::BusDirection dir, Steinberg::int32 index,
                                       Steinberg::TBool state) override;
        tresult PLUGIN_API canProcessSampleSize(Steinberg::int32 symbolicSampleSize) override;
        tresult PLUGIN_API setupProcessing(Vst::ProcessSetup& setup) override;
        tresult PLUGIN_API setActive(Steinberg::TBool state) override;
        tresult PLUGIN_API setProcessing(Steinberg::TBool state) override;
        tresult PLUGIN_API process(Vst::ProcessData& data) override;
        Steinberg::uint32 PLUGIN_API getLatencySamples() override;
        Steinberg::uint32 PLUGIN_API getTailSamples() override;

        tresult PLUGIN_API setState(Steinberg::IBStream* state) override;
        tresult PLUGIN_API getState(Steinberg::IBStream* state) override;

        // For tests: the plain value of parameter `index` the processing uses.
        [[nodiscard]] double plainValue(std::size_t index) const noexcept { return values[index].load(); }
        [[nodiscard]] const std::shared_ptr<HostState>& host() const noexcept { return hostState; }

    private:
        // Which supported layout the buses' channel counts are, if any.
        [[nodiscard]] bool supported(const std::vector<int>& inputs, const std::vector<int>& outputs) const;
        void prepare();
        void readParameterChanges(Vst::IParameterChanges* changes, int frames);
        void readEvents(Vst::IEventList* events, int frames);
        void writeEvents(Vst::IEventList* events);
        void writePublished(Vst::IParameterChanges* changes);
        [[nodiscard]] SoundorTransport transport(const Vst::ProcessContext* context) noexcept;
        void applyState(const std::map<std::string, std::string>& state);

        const Plugin& definition;
        StateSchema schema;
        std::shared_ptr<processor::RustProcessor> rust;
        std::shared_ptr<Streams> streams;
        std::shared_ptr<HostState> hostState = std::make_shared<HostState>();
        std::uint64_t linkToken = 0;

        // Each parameter's plain value: written by process() (host changes)
        // and setState(), read by process() and getState().
        std::unique_ptr<std::atomic<double>[]> values;
        std::vector<double> blockValues;
        std::vector<double> published;
        std::vector<double> lastPublished;

        std::vector<int> inputChannels, outputChannels; // per bus, 0 when inactive
        std::vector<bool> inputActive, outputActive;
        double sampleRate = 44100;
        int maxFrames = 1024;
        bool prepared = false;

        // Channel storage for inputs no output shares, and a staging copy of
        // the inputs when the host aliases buffers across channels.
        std::vector<std::vector<float>> spareChannels;
        std::vector<std::vector<float>> staged;
        std::vector<float*> channels;

        std::array<SoundorMidiEvent, midi::capacity> midiIn {};
        std::array<SoundorMidiEvent, midi::capacity> midiOut {};
        std::uint32_t midiInCount = 0;
        std::uint64_t midiGeneration = 0;

        processor::AudioState audioState;
        std::mutex stateLock; // the state's committed values (control threads)
        std::map<std::string, std::string> stateValues;
    };
} // namespace soundor::vst3
