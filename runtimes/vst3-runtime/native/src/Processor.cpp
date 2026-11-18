#include "Processor.h"

#include "Log.h"
#include "StateDocument.h"
#include "Strings.h"

#include <soundor/midi/Midi.h>

#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstevents.h>
#include <pluginterfaces/vst/ivstmessage.h>
#include <pluginterfaces/vst/ivstmidicontrollers.h>
#include <pluginterfaces/vst/ivstparameterchanges.h>
#include <pluginterfaces/vst/ivstprocesscontext.h>
#include <pluginterfaces/vst/vstspeaker.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace soundor::vst3
{
    using namespace Steinberg;
    namespace midi = soundor::midi;

    Vst::ParamID midiParameterId(int channel, int controller) noexcept
    {
        return midiParameterBase + static_cast<Vst::ParamID>(channel * midiControllersPerChannel + controller);
    }

    namespace
    {
        Vst::SpeakerArrangement arrangementFor(int channels)
        {
            switch (channels)
            {
            case 0:
                return Vst::SpeakerArr::kEmpty;
            case 1:
                return Vst::SpeakerArr::kMono;
            case 2:
                return Vst::SpeakerArr::kStereo;
            case 6:
                return Vst::SpeakerArr::k51;
            case 8:
                return Vst::SpeakerArr::k71Cine;
            default:
            {
                // Some arrangement with that many channels.
                Vst::SpeakerArrangement out = 0;
                for (int i = 0; i < channels && i < 64; ++i)
                    out |= Vst::SpeakerArrangement { 1 } << i;
                return out;
            }
            }
        }

        std::uint8_t sevenBits(float value) noexcept
        {
            return static_cast<std::uint8_t>(std::clamp(std::lround(value * 127.0f), 0L, 127L));
        }

        // Reads a whole IBStream; empty on failure.
        std::string readAll(IBStream* stream)
        {
            std::string out;
            if (stream == nullptr)
                return out;
            char buffer[65536];
            while (true)
            {
                int32 read = 0;
                if (stream->read(buffer, sizeof buffer, &read) != kResultOk || read <= 0)
                    break;
                out.append(buffer, static_cast<std::size_t>(read));
                if (out.size() > maxSnapshotBytes)
                    return {};
            }
            return out;
        }
    } // namespace

    Processor::Processor(const Plugin& plugin)
        : definition(plugin), schema(plugin), values(new std::atomic<double>[plugin.parameters.size()]),
          audioState(std::max<std::size_t>(plugin.audioStateSize, 1))
    {
        setControllerClass(FUID::fromTUID(reinterpret_cast<const char*>(plugin.controllerCid.data())));
        blockValues.resize(plugin.parameters.size());
        for (std::size_t i = 0; i < plugin.parameters.size(); ++i)
        {
            values[i].store(plugin.parameters[i].info.defaultValue);
            blockValues[i] = plugin.parameters[i].info.defaultValue;
        }
        published.assign(plugin.contract.published, std::numeric_limits<double>::quiet_NaN());
        lastPublished.assign(plugin.contract.published, std::numeric_limits<double>::quiet_NaN());
        stateValues = schema.defaults();
        applyState(stateValues);
    }

    Processor::~Processor()
    {
        if (linkToken != 0)
            withdrawLink(linkToken);
    }

    FUnknown* Processor::create(void*)
    {
        const auto* described = soundor::vst3::plugin();
        if (described == nullptr)
            return nullptr;
        return static_cast<Vst::IAudioProcessor*>(new Processor(*described));
    }

    tresult PLUGIN_API Processor::initialize(FUnknown* context)
    {
        const auto result = AudioEffect::initialize(context);
        if (result != kResultOk)
            return result;
        for (std::size_t i = 0; i < definition.inputs.size(); ++i)
        {
            const auto& bus = definition.inputs[i];
            addAudioInput(reinterpret_cast<const Vst::TChar*>(utf16(bus.name).c_str()),
                          arrangementFor(bus.enabledChannels), i == 0 ? Vst::kMain : Vst::kAux,
                          bus.initialChannels > 0 ? Vst::BusInfo::kDefaultActive : 0);
        }
        for (std::size_t i = 0; i < definition.outputs.size(); ++i)
        {
            const auto& bus = definition.outputs[i];
            addAudioOutput(reinterpret_cast<const Vst::TChar*>(utf16(bus.name).c_str()),
                           arrangementFor(bus.enabledChannels), i == 0 ? Vst::kMain : Vst::kAux,
                           bus.initialChannels > 0 ? Vst::BusInfo::kDefaultActive : 0);
        }
        if (definition.midiInput)
            addEventInput(u"MIDI In", 16);
        if (definition.midiOutput)
            addEventOutput(u"MIDI Out", 16);
        inputActive.clear();
        outputActive.clear();
        for (const auto& bus : definition.inputs)
            inputActive.push_back(bus.initialChannels > 0);
        for (const auto& bus : definition.outputs)
            outputActive.push_back(bus.initialChannels > 0);

        rust = std::make_shared<processor::RustProcessor>(definition.contract, processor::linkedRustProcessor(),
                                                          midi::linkedMidi());
        if (! rust->valid())
            log("Soundor: " + rust->error());
        streams = std::make_shared<Streams>(definition);
        auto link = std::make_shared<Link>();
        link->rust = rust;
        link->streams = streams;
        link->host = hostState;
        linkToken = publishLink(link);
        return kResultOk;
    }

    tresult PLUGIN_API Processor::terminate()
    {
        if (linkToken != 0)
            withdrawLink(linkToken);
        linkToken = 0;
        prepared = false;
        return AudioEffect::terminate();
    }

    tresult PLUGIN_API Processor::connect(Vst::IConnectionPoint* other)
    {
        const auto result = AudioEffect::connect(other);
        if (result != kResultOk || linkToken == 0)
            return result;
        // Tells the controller how to reach this processor, should it run in
        // this process: only this module resolves the token.
        if (auto* message = allocateMessage())
        {
            message->setMessageID("soundor.link");
            message->getAttributes()->setInt("module", moduleIdentity());
            message->getAttributes()->setInt("token", static_cast<int64>(linkToken));
            sendMessage(message);
            message->release();
        }
        return result;
    }

    tresult PLUGIN_API Processor::disconnect(Vst::IConnectionPoint* other) { return AudioEffect::disconnect(other); }

    tresult PLUGIN_API Processor::notify(Vst::IMessage* message)
    {
        if (message == nullptr)
            return kInvalidArgument;
        if (std::strcmp(message->getMessageID(), "soundor.state") != 0)
            return AudioEffect::notify(message);
        // The controller's persistent state changed (the UI, the Rust
        // controller, a preset, History): its values, whole.
        const void* data = nullptr;
        uint32 size = 0;
        if (message->getAttributes()->getBinary("values", data, size) != kResultOk || data == nullptr)
            return kInvalidArgument;
        try
        {
            const auto received = json::parse(std::string_view(static_cast<const char*>(data), size));
            applyState(schema.read(&received));
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the controller sent invalid state: ") + error.what());
            return kInvalidArgument;
        }
        return kResultOk;
    }

    bool Processor::supported(const std::vector<int>& inputs, const std::vector<int>& outputs) const
    {
        if (inputs.size() != definition.inputs.size() || outputs.size() != definition.outputs.size())
            return false;
        const auto matches = [](const std::vector<std::vector<int>>& offered, const std::vector<int>& counts)
        {
            for (std::size_t bus = 0; bus < counts.size(); ++bus)
                if (std::find(offered[bus].begin(), offered[bus].end(), counts[bus]) == offered[bus].end())
                    return false;
            return true;
        };
        return std::any_of(definition.layouts.begin(), definition.layouts.end(), [&](const Layout& layout)
                           { return matches(layout.inputs, inputs) && matches(layout.outputs, outputs); });
    }

    tresult PLUGIN_API Processor::setBusArrangements(Vst::SpeakerArrangement* inputs, int32 numIns,
                                                     Vst::SpeakerArrangement* outputs, int32 numOuts)
    {
        if (numIns != static_cast<int32>(definition.inputs.size())
            || numOuts != static_cast<int32>(definition.outputs.size()) || (numIns > 0 && inputs == nullptr)
            || (numOuts > 0 && outputs == nullptr))
            return kResultFalse;
        std::vector<int> in, out;
        for (int32 i = 0; i < numIns; ++i)
            in.push_back(Vst::SpeakerArr::getChannelCount(inputs[i]));
        for (int32 i = 0; i < numOuts; ++i)
            out.push_back(Vst::SpeakerArr::getChannelCount(outputs[i]));
        // A bus a layout may disable (0 channels) takes any arrangement; it
        // is processed only when the host activates it.
        auto checkedIn = in;
        auto checkedOut = out;
        for (const auto& layout : definition.layouts)
        {
            for (std::size_t bus = 0; bus < checkedIn.size(); ++bus)
                if (std::find(layout.inputs[bus].begin(), layout.inputs[bus].end(), checkedIn[bus])
                        == layout.inputs[bus].end()
                    && std::find(layout.inputs[bus].begin(), layout.inputs[bus].end(), 0) != layout.inputs[bus].end())
                    checkedIn[bus] = 0;
            for (std::size_t bus = 0; bus < checkedOut.size(); ++bus)
                if (std::find(layout.outputs[bus].begin(), layout.outputs[bus].end(), checkedOut[bus])
                        == layout.outputs[bus].end()
                    && std::find(layout.outputs[bus].begin(), layout.outputs[bus].end(), 0)
                           != layout.outputs[bus].end())
                    checkedOut[bus] = 0;
        }
        if (! supported(in, out) && ! supported(checkedIn, checkedOut))
            return kResultFalse;
        for (int32 i = 0; i < numIns; ++i)
            if (auto* bus = FCast<Vst::AudioBus>(audioInputs.at(static_cast<std::size_t>(i))))
                bus->setArrangement(inputs[i]);
        for (int32 i = 0; i < numOuts; ++i)
            if (auto* bus = FCast<Vst::AudioBus>(audioOutputs.at(static_cast<std::size_t>(i))))
                bus->setArrangement(outputs[i]);
        return kResultTrue;
    }

    tresult PLUGIN_API Processor::activateBus(Vst::MediaType type, Vst::BusDirection dir, int32 index, TBool state)
    {
        const auto result = AudioEffect::activateBus(type, dir, index, state);
        if (result == kResultTrue && type == Vst::kAudio && index >= 0)
        {
            auto& active = dir == Vst::kInput ? inputActive : outputActive;
            if (static_cast<std::size_t>(index) < active.size())
                active[static_cast<std::size_t>(index)] = state != 0;
        }
        return result;
    }

    tresult PLUGIN_API Processor::canProcessSampleSize(int32 symbolicSampleSize)
    {
        return symbolicSampleSize == Vst::kSample32 ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API Processor::setupProcessing(Vst::ProcessSetup& setup)
    {
        if (setup.symbolicSampleSize != Vst::kSample32 || setup.sampleRate <= 0 || setup.maxSamplesPerBlock <= 0)
            return kResultFalse;
        sampleRate = setup.sampleRate;
        maxFrames = setup.maxSamplesPerBlock;
        hostState->sampleRate.store(sampleRate);
        hostState->blockSize.store(maxFrames);
        return AudioEffect::setupProcessing(setup);
    }

    void Processor::prepare()
    {
        inputChannels.assign(definition.inputs.size(), 0);
        outputChannels.assign(definition.outputs.size(), 0);
        processor::RustBusLayout layout;
        int next = 0;
        for (std::size_t i = 0; i < definition.inputs.size(); ++i)
        {
            auto* bus = FCast<Vst::AudioBus>(audioInputs.at(i));
            const int count = bus != nullptr && inputActive[i] ? Vst::SpeakerArr::getChannelCount(bus->getArrangement()) : 0;
            inputChannels[i] = count;
            layout.inputs.emplace_back();
            for (int c = 0; c < count; ++c)
                layout.inputs.back().push_back(next++);
        }
        const int totalIn = next;
        next = 0;
        for (std::size_t i = 0; i < definition.outputs.size(); ++i)
        {
            auto* bus = FCast<Vst::AudioBus>(audioOutputs.at(i));
            const int count = bus != nullptr && outputActive[i] ? Vst::SpeakerArr::getChannelCount(bus->getArrangement()) : 0;
            outputChannels[i] = count;
            layout.outputs.emplace_back();
            for (int c = 0; c < count; ++c)
                layout.outputs.back().push_back(next++);
        }
        const int totalOut = next;
        const int total = std::max(totalIn, totalOut);
        const auto frames = static_cast<std::size_t>(std::max(1, maxFrames));
        spareChannels.assign(static_cast<std::size_t>(std::max(0, total - totalOut)), std::vector<float>(frames));
        staged.assign(static_cast<std::size_t>(totalIn), std::vector<float>(frames));
        channels.assign(static_cast<std::size_t>(total), nullptr);
        for (std::size_t i = 0; i < blockValues.size(); ++i)
            blockValues[i] = values[i].load(std::memory_order_relaxed);
        if (rust == nullptr || ! rust->valid())
        {
            prepared = false;
            return;
        }
        const auto status = rust->prepare(sampleRate, maxFrames, layout, blockValues, audioState.acquire());
        prepared = status == SOUNDOR_STATUS_OK;
        if (! prepared)
            log("Soundor: the plugin's Rust processor could not be prepared (status " + std::to_string(status)
                + "); it is silent");
    }

    tresult PLUGIN_API Processor::setActive(TBool state)
    {
        if (state != 0)
            prepare();
        else
            prepared = false;
        return AudioEffect::setActive(state);
    }

    tresult PLUGIN_API Processor::setProcessing(TBool state)
    {
        if (state == 0 && rust != nullptr && prepared)
            rust->reset();
        return kResultOk;
    }

    uint32 PLUGIN_API Processor::getLatencySamples() { return definition.latency; }

    uint32 PLUGIN_API Processor::getTailSamples()
    {
        if (definition.tailSeconds <= 0)
            return Vst::kNoTail;
        return static_cast<uint32>(std::min(definition.tailSeconds * sampleRate, 4294967295.0));
    }

    void Processor::readParameterChanges(Vst::IParameterChanges* changes, int frames)
    {
        if (changes == nullptr)
            return;
        const int32 count = changes->getParameterCount();
        for (int32 i = 0; i < count; ++i)
        {
            auto* queue = changes->getParameterData(i);
            if (queue == nullptr)
                continue;
            const auto id = queue->getParameterId();
            const int32 points = queue->getPointCount();
            if (points <= 0)
                continue;
            if (id >= midiParameterBase && id < midiParameterBase + 16 * midiControllersPerChannel)
            {
                if (! definition.midiInput)
                    continue;
                const int channel = static_cast<int>((id - midiParameterBase) / midiControllersPerChannel);
                const int controller = static_cast<int>((id - midiParameterBase) % midiControllersPerChannel);
                for (int32 p = 0; p < points && midiInCount < midiIn.size(); ++p)
                {
                    int32 offset = 0;
                    Vst::ParamValue value = 0;
                    if (queue->getPoint(p, offset, value) != kResultOk)
                        continue;
                    SoundorMidiEvent event {};
                    event.sampleOffset = static_cast<std::uint32_t>(std::clamp(offset, 0, std::max(0, frames - 1)));
                    event.source = 1;
                    const auto status = static_cast<std::uint8_t>(channel);
                    if (controller < 128)
                    {
                        event.bytes[0] = static_cast<std::uint8_t>(0xB0 | status);
                        event.bytes[1] = static_cast<std::uint8_t>(controller);
                        event.bytes[2] = sevenBits(static_cast<float>(value));
                    }
                    else if (controller == Vst::kAfterTouch)
                    {
                        event.bytes[0] = static_cast<std::uint8_t>(0xD0 | status);
                        event.bytes[1] = sevenBits(static_cast<float>(value));
                    }
                    else if (controller == Vst::kPitchBend)
                    {
                        const auto bend = static_cast<int>(std::clamp(std::lround(value * 16383.0), 0L, 16383L));
                        event.bytes[0] = static_cast<std::uint8_t>(0xE0 | status);
                        event.bytes[1] = static_cast<std::uint8_t>(bend & 0x7F);
                        event.bytes[2] = static_cast<std::uint8_t>((bend >> 7) & 0x7F);
                    }
                    else if (controller == Vst::kCtrlProgramChange)
                    {
                        event.bytes[0] = static_cast<std::uint8_t>(0xC0 | status);
                        event.bytes[1] = sevenBits(static_cast<float>(value));
                    }
                    else
                        continue;
                    midiIn[midiInCount++] = event;
                }
                continue;
            }
            const auto index = definition.indexOf(id);
            if (! index || definition.parameters[*index].info.access == parameters::Access::ReadOnly)
                continue;
            int32 offset = 0;
            Vst::ParamValue normalized = 0;
            // The block's last value, as JUCE's VST3 wrapper takes it.
            if (queue->getPoint(points - 1, offset, normalized) != kResultOk)
                continue;
            const double plain = definition.toValue(*index, std::clamp(normalized, 0.0, 1.0));
            values[*index].store(plain, std::memory_order_relaxed);
        }
    }

    void Processor::readEvents(Vst::IEventList* events, int frames)
    {
        if (events == nullptr || ! definition.midiInput)
            return;
        const int32 count = events->getEventCount();
        for (int32 i = 0; i < count && midiInCount < midiIn.size(); ++i)
        {
            Vst::Event event {};
            if (events->getEvent(i, event) != kResultOk)
                continue;
            SoundorMidiEvent out {};
            out.sampleOffset = static_cast<std::uint32_t>(std::clamp(event.sampleOffset, 0, std::max(0, frames - 1)));
            out.source = 1;
            switch (event.type)
            {
            case Vst::Event::kNoteOnEvent:
                out.bytes[0] = static_cast<std::uint8_t>(0x90 | (event.noteOn.channel & 0x0F));
                out.bytes[1] = static_cast<std::uint8_t>(event.noteOn.pitch & 0x7F);
                out.bytes[2] = sevenBits(event.noteOn.velocity);
                break;
            case Vst::Event::kNoteOffEvent:
                out.bytes[0] = static_cast<std::uint8_t>(0x80 | (event.noteOff.channel & 0x0F));
                out.bytes[1] = static_cast<std::uint8_t>(event.noteOff.pitch & 0x7F);
                out.bytes[2] = sevenBits(event.noteOff.velocity);
                break;
            case Vst::Event::kPolyPressureEvent:
                out.bytes[0] = static_cast<std::uint8_t>(0xA0 | (event.polyPressure.channel & 0x0F));
                out.bytes[1] = static_cast<std::uint8_t>(event.polyPressure.pitch & 0x7F);
                out.bytes[2] = sevenBits(event.polyPressure.pressure);
                break;
            case Vst::Event::kLegacyMIDICCOutEvent:
            {
                const auto& cc = event.midiCCOut;
                const auto channel = static_cast<std::uint8_t>(cc.channel & 0x0F);
                if (cc.controlNumber < 128)
                {
                    out.bytes[0] = static_cast<std::uint8_t>(0xB0 | channel);
                    out.bytes[1] = cc.controlNumber;
                    out.bytes[2] = static_cast<std::uint8_t>(cc.value & 0x7F);
                }
                else if (cc.controlNumber == Vst::kAfterTouch)
                {
                    out.bytes[0] = static_cast<std::uint8_t>(0xD0 | channel);
                    out.bytes[1] = static_cast<std::uint8_t>(cc.value & 0x7F);
                }
                else if (cc.controlNumber == Vst::kPitchBend)
                {
                    out.bytes[0] = static_cast<std::uint8_t>(0xE0 | channel);
                    out.bytes[1] = static_cast<std::uint8_t>(cc.value & 0x7F);
                    out.bytes[2] = static_cast<std::uint8_t>(cc.value2 & 0x7F);
                }
                else if (cc.controlNumber == Vst::kCtrlProgramChange)
                {
                    out.bytes[0] = static_cast<std::uint8_t>(0xC0 | channel);
                    out.bytes[1] = static_cast<std::uint8_t>(cc.value & 0x7F);
                }
                else
                    continue;
                break;
            }
            default:
                continue;
            }
            midiIn[midiInCount++] = out;
        }
    }

    void Processor::writeEvents(Vst::IEventList* events)
    {
        // Count from process(); the generation tells of a reset since.
        if (events == nullptr || ! definition.midiOutput || rust == nullptr || ! rust->valid())
            return;
        const auto generation = soundor_midi_generation(rust->nativeHandle());
        if (generation != midiGeneration)
        {
            midiGeneration = generation;
            // Releases what the previous generation left sounding downstream.
            for (int channel = 0; channel < 16; ++channel)
                for (const std::uint8_t controller : { std::uint8_t { 64 }, std::uint8_t { 120 } })
                {
                    Vst::Event event {};
                    event.type = Vst::Event::kLegacyMIDICCOutEvent;
                    event.midiCCOut.channel = static_cast<int8>(channel);
                    event.midiCCOut.controlNumber = controller;
                    event.midiCCOut.value = 0;
                    events->addEvent(event);
                }
        }
    }

    void Processor::writePublished(Vst::IParameterChanges* changes)
    {
        std::size_t slot = 0;
        for (std::size_t i = 0; i < definition.parameters.size(); ++i)
        {
            const auto& parameter = definition.parameters[i];
            if (parameter.info.access != parameters::Access::ReadOnly)
                continue;
            const auto at = slot++;
            if (at >= published.size() || std::isnan(published[at]) || published[at] == lastPublished[at])
                continue;
            lastPublished[at] = published[at];
            values[i].store(published[at], std::memory_order_relaxed);
            if (changes == nullptr)
                continue;
            int32 queueIndex = 0;
            if (auto* queue = changes->addParameterData(parameter.vstId, queueIndex))
            {
                int32 pointIndex = 0;
                queue->addPoint(0, definition.toNormalized(i, published[at]), pointIndex);
            }
        }
    }

    SoundorTransport Processor::transport(const Vst::ProcessContext* context) noexcept
    {
        auto out = processor::unknownTransport();
        if (context == nullptr)
            return out;
        const auto state = context->state;
        auto& host = *hostState;
        host.known.store(true, std::memory_order_relaxed);
        const bool playing = (state & Vst::ProcessContext::kPlaying) != 0;
        host.playing.store(playing, std::memory_order_relaxed);
        host.recording.store((state & Vst::ProcessContext::kRecording) != 0, std::memory_order_relaxed);
        host.looping.store((state & Vst::ProcessContext::kCycleActive) != 0, std::memory_order_relaxed);
        out.flags = playing ? 1u : 0u;
        if ((state & Vst::ProcessContext::kTempoValid) != 0)
        {
            out.tempo = context->tempo;
            host.bpm.store(context->tempo, std::memory_order_relaxed);
        }
        if ((state & Vst::ProcessContext::kTimeSigValid) != 0 && context->timeSigNumerator > 0
            && context->timeSigDenominator > 0)
        {
            out.timeSignatureNumerator = static_cast<std::uint32_t>(context->timeSigNumerator);
            out.timeSignatureDenominator = static_cast<std::uint32_t>(context->timeSigDenominator);
            host.numerator.store(context->timeSigNumerator, std::memory_order_relaxed);
            host.denominator.store(context->timeSigDenominator, std::memory_order_relaxed);
        }
        if ((state & Vst::ProcessContext::kProjectTimeMusicValid) != 0)
        {
            out.positionBeats = context->projectTimeMusic;
            host.ppq.store(context->projectTimeMusic, std::memory_order_relaxed);
        }
        if ((state & Vst::ProcessContext::kBarPositionValid) != 0)
            host.barStart.store(context->barPositionMusic, std::memory_order_relaxed);
        const double rate = context->sampleRate > 0 ? context->sampleRate : sampleRate;
        if (rate > 0)
        {
            out.timeSeconds = static_cast<double>(context->projectTimeSamples) / rate;
            host.seconds.store(out.timeSeconds, std::memory_order_relaxed);
        }
        host.samples.store(context->projectTimeSamples, std::memory_order_relaxed);
        return out;
    }

    tresult PLUGIN_API Processor::process(Vst::ProcessData& data)
    {
        const int frames = std::max(0, data.numSamples);
        midiInCount = 0;
        readParameterChanges(data.inputParameterChanges, frames);
        readEvents(data.inputEvents, frames);
        for (std::size_t i = 0; i < blockValues.size(); ++i)
            blockValues[i] = values[i].load(std::memory_order_relaxed);
        const auto silence = [&]
        {
            for (int32 b = 0; b < data.numOutputs; ++b)
            {
                auto& bus = data.outputs[b];
                for (int32 c = 0; c < bus.numChannels && bus.channelBuffers32 != nullptr; ++c)
                    if (bus.channelBuffers32[c] != nullptr && frames > 0)
                        std::memset(bus.channelBuffers32[c], 0, sizeof(float) * static_cast<std::size_t>(frames));
                bus.silenceFlags = bus.numChannels >= 64 ? ~uint64 { 0 } : ((uint64 { 1 } << bus.numChannels) - 1);
            }
        };
        if (data.numSamples > 0 && data.symbolicSampleSize != Vst::kSample32)
        {
            silence();
            return kResultFalse;
        }
        const auto transportNow = transport(data.processContext);
        if (! prepared || rust == nullptr || frames > maxFrames * 64)
        {
            silence();
            return kResultOk;
        }
        // The block's channels: inputs and outputs share indices, as the Rust
        // processor's layout has them (prepare()): outputs in their own
        // buffers, input-only channels in spare storage.
        std::size_t out = 0;
        bool shapeMatches = data.numOutputs == static_cast<int32>(outputChannels.size())
                            && (data.numInputs == static_cast<int32>(inputChannels.size()) || inputChannels.empty());
        for (int32 b = 0; shapeMatches && b < data.numOutputs; ++b)
        {
            const auto& bus = data.outputs[b];
            const int count = outputChannels[static_cast<std::size_t>(b)];
            if (count > 0 && (bus.numChannels < count || bus.channelBuffers32 == nullptr))
            {
                shapeMatches = false;
                break;
            }
            for (int c = 0; c < count; ++c)
                channels[out++] = bus.channelBuffers32[c];
        }
        if (! shapeMatches)
        {
            silence();
            return kResultOk;
        }
        for (std::size_t spare = 0; out < channels.size(); ++spare)
            channels[out++] = spareChannels[spare].data();
        // Spare and staging storage holds maxFrames: a longer block than
        // prepared is processed only when every channel lives in the host's
        // buffers.
        const bool needsStorage = ! spareChannels.empty();
        if (frames > maxFrames && needsStorage)
        {
            silence();
            return kResultOk;
        }
        // The inputs, into their channels: staged first when the host shares
        // a buffer between channels of different indices.
        const auto inputSource = [&](int32 b, int c) -> const float*
        {
            const auto& bus = data.inputs[b];
            return bus.channelBuffers32 != nullptr && c < bus.numChannels ? bus.channelBuffers32[c] : nullptr;
        };
        const int32 inputBuses = std::min(data.numInputs, static_cast<int32>(inputChannels.size()));
        bool aliased = false;
        std::size_t in = 0;
        for (int32 b = 0; b < inputBuses; ++b)
            for (int c = 0; c < inputChannels[static_cast<std::size_t>(b)]; ++c, ++in)
                for (std::size_t other = 0; other < channels.size(); ++other)
                    if (other != in && inputSource(b, c) != nullptr && channels[other] == inputSource(b, c))
                        aliased = true;
        if (aliased && frames > maxFrames)
        {
            silence();
            return kResultOk;
        }
        const auto bytes = sizeof(float) * static_cast<std::size_t>(frames);
        in = 0;
        if (aliased)
            for (int32 b = 0; b < inputBuses; ++b)
                for (int c = 0; c < inputChannels[static_cast<std::size_t>(b)]; ++c, ++in)
                    if (const float* source = inputSource(b, c); source != nullptr && bytes > 0)
                        std::memcpy(staged[in].data(), source, bytes);
        in = 0;
        for (int32 b = 0; b < inputBuses; ++b)
            for (int c = 0; c < inputChannels[static_cast<std::size_t>(b)]; ++c, ++in)
            {
                const float* source = aliased ? staged[in].data() : inputSource(b, c);
                if (inputSource(b, c) == nullptr)
                    source = nullptr;
                float* target = channels[in];
                if (bytes == 0 || target == source)
                    continue;
                if (source == nullptr)
                    std::memset(target, 0, bytes);
                else
                    std::memcpy(target, source, bytes);
            }
        std::sort(midiIn.begin(), midiIn.begin() + midiInCount,
                  [](const SoundorMidiEvent& a, const SoundorMidiEvent& b) { return a.sampleOffset < b.sampleOffset; });
        std::uint32_t midiOutCount = 0;
        rust->process(channels, frames, blockValues, published, transportNow, streams->sink(), audioState.acquire(),
                      { midiIn.data(), midiInCount }, midiOut, &midiOutCount);
        for (int32 b = 0; b < data.numOutputs; ++b)
            data.outputs[b].silenceFlags = 0;
        writePublished(data.outputParameterChanges);
        writeEvents(data.outputEvents);
        if (data.outputEvents != nullptr && definition.midiOutput)
            for (std::uint32_t i = 0; i < midiOutCount; ++i)
            {
                const auto& midiEvent = midiOut[i];
                Vst::Event event {};
                event.sampleOffset = static_cast<int32>(midiEvent.sampleOffset);
                event.busIndex = 0;
                const auto kind = midiEvent.bytes[0] >> 4;
                const auto channel = static_cast<int16>(midiEvent.bytes[0] & 0x0F);
                switch (kind)
                {
                case 0x9:
                    event.type = Vst::Event::kNoteOnEvent;
                    event.noteOn = { channel, static_cast<int16>(midiEvent.bytes[1]), 0.0f,
                                     static_cast<float>(midiEvent.bytes[2]) / 127.0f, 0, -1 };
                    break;
                case 0x8:
                    event.type = Vst::Event::kNoteOffEvent;
                    event.noteOff = { channel, static_cast<int16>(midiEvent.bytes[1]),
                                      static_cast<float>(midiEvent.bytes[2]) / 127.0f, -1, 0.0f };
                    break;
                case 0xA:
                    event.type = Vst::Event::kPolyPressureEvent;
                    event.polyPressure = { channel, static_cast<int16>(midiEvent.bytes[1]),
                                           static_cast<float>(midiEvent.bytes[2]) / 127.0f, -1 };
                    break;
                default:
                    event.type = Vst::Event::kLegacyMIDICCOutEvent;
                    event.midiCCOut.channel = static_cast<int8>(channel);
                    if (kind == 0xB)
                    {
                        event.midiCCOut.controlNumber = midiEvent.bytes[1];
                        event.midiCCOut.value = static_cast<int8>(midiEvent.bytes[2]);
                    }
                    else if (kind == 0xD)
                    {
                        event.midiCCOut.controlNumber = Vst::kAfterTouch;
                        event.midiCCOut.value = static_cast<int8>(midiEvent.bytes[1]);
                    }
                    else if (kind == 0xE)
                    {
                        event.midiCCOut.controlNumber = Vst::kPitchBend;
                        event.midiCCOut.value = static_cast<int8>(midiEvent.bytes[1]);
                        event.midiCCOut.value2 = static_cast<int8>(midiEvent.bytes[2]);
                    }
                    else if (kind == 0xC)
                    {
                        event.midiCCOut.controlNumber = Vst::kCtrlProgramChange;
                        event.midiCCOut.value = static_cast<int8>(midiEvent.bytes[1]);
                    }
                    else
                        continue;
                }
                data.outputEvents->addEvent(event);
            }
        midiInCount = 0;
        return kResultOk;
    }

    void Processor::applyState(const std::map<std::string, std::string>& state)
    {
        const std::lock_guard guard(stateLock);
        stateValues = state;
        if (definition.audioStateSize > 0)
            audioState.publishWith([&](std::span<std::byte> out) { schema.writeAudio(stateValues, out); });
    }

    tresult PLUGIN_API Processor::setState(IBStream* state)
    {
        const auto text = readAll(state);
        try
        {
            const auto document = readStateDocument(definition, schema, text);
            for (std::size_t i = 0; i < document.parameters.size(); ++i)
                values[i].store(definition.constrain(i, document.parameters[i]), std::memory_order_relaxed);
            applyState(document.state);
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the saved state could not be restored: ") + error.what());
            return kResultFalse;
        }
        return kResultOk;
    }

    tresult PLUGIN_API Processor::getState(IBStream* state)
    {
        if (state == nullptr)
            return kInvalidArgument;
        std::vector<double> plain(definition.parameters.size());
        for (std::size_t i = 0; i < plain.size(); ++i)
            plain[i] = values[i].load(std::memory_order_relaxed);
        std::string text;
        try
        {
            const std::lock_guard guard(stateLock);
            text = writeStateDocument(definition, schema, plain, stateValues);
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the state could not be saved: ") + error.what());
            return kResultFalse;
        }
        int32 written = 0;
        return state->write(text.data(), static_cast<int32>(text.size()), &written) == kResultOk
                       && written == static_cast<int32>(text.size())
                   ? kResultOk
                   : kResultFalse;
    }
} // namespace soundor::vst3
