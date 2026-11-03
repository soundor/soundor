// Fixture Synth (see Fixtures.cpp). In a file of its own: the SDK's
// single-component header has to come before vsteditcontroller.h.
#include "FixtureSynth.h"

#include "base/source/fstreamer.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "public.sdk/source/vst/vstsinglecomponenteffect.h"

#include <map>

namespace soundor::fixtures
{
    const FUID synthId(0x5D3A1C03, 0x6B2E4F10, 0x9A7C3E21, 0x0F1A2B3C); // NOLINT(cert-err58-cpp)

    // ── Fixture Synth ────────────────────────────────────────────────────

    enum SynthParameter : ParamID
    {
        kVolume = 10,
        kBend = 11,
    };

    class Synth final : public SingleComponentEffect, public IMidiMapping
    {
    public:
        tresult PLUGIN_API initialize(FUnknown* context) override
        {
            const tresult result = SingleComponentEffect::initialize(context);
            if (result != kResultOk)
                return result;
            addAudioOutput(STR16("Out"), SpeakerArr::kStereo);
            addEventInput(STR16("MIDI In"), 16);
            addEventOutput(STR16("MIDI Out"), 16);
            parameters.addParameter(STR16("Volume"), nullptr, 0, 1, ParameterInfo::kCanAutomate, kVolume);
            parameters.addParameter(STR16("Bend"), nullptr, 0, 0.5, ParameterInfo::kCanAutomate, kBend);
            return kResultOk;
        }

        tresult PLUGIN_API setBusArrangements(SpeakerArrangement* inputs, int32 numIns, SpeakerArrangement* outputs,
                                              int32 numOuts) override
        {
            if (numIns == 0 && numOuts == 1 && outputs[0] == SpeakerArr::kStereo)
                return kResultTrue;
            return SingleComponentEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
        }

        uint32 PLUGIN_API getTailSamples() override { return 4800; }

        tresult PLUGIN_API setupProcessing(ProcessSetup& setup) override
        {
            sampleRate_ = setup.sampleRate;
            return SingleComponentEffect::setupProcessing(setup);
        }

        tresult PLUGIN_API setActive(TBool state) override
        {
            notes_.clear();
            return SingleComponentEffect::setActive(state);
        }

        tresult PLUGIN_API process(ProcessData& data) override
        {
            Automation volume(data.inputParameterChanges, kVolume, volume_);
            const int32 events = data.inputEvents != nullptr ? data.inputEvents->getEventCount() : 0;
            int32 nextEvent = 0;
            const ProcessContext* context = data.processContext;
            const bool playing = context != nullptr && (context->state & ProcessContext::kPlaying) != 0;
            const double quartersPerFrame = context != nullptr ? context->tempo / 60.0 / sampleRate_ : 0;

            for (int32 frame = 0; frame < data.numSamples; ++frame)
            {
                while (nextEvent < events)
                {
                    Event event {};
                    data.inputEvents->getEvent(nextEvent, event);
                    if (event.sampleOffset > frame)
                        break;
                    ++nextEvent;
                    if (event.type == Event::kNoteOnEvent && event.noteOn.velocity > 0)
                        notes_[event.noteOn.pitch] = event.noteOn.velocity;
                    else if (event.type == Event::kNoteOffEvent
                             || (event.type == Event::kNoteOnEvent && event.noteOn.velocity == 0))
                        notes_.erase(event.type == Event::kNoteOffEvent ? event.noteOff.pitch : event.noteOn.pitch);
                    // Echoed an octave up.
                    if (data.outputEvents != nullptr
                        && (event.type == Event::kNoteOnEvent || event.type == Event::kNoteOffEvent))
                    {
                        Event echo = event;
                        if (echo.type == Event::kNoteOnEvent)
                            echo.noteOn.pitch = static_cast<int16>(echo.noteOn.pitch + 12);
                        else
                            echo.noteOff.pitch = static_cast<int16>(echo.noteOff.pitch + 12);
                        data.outputEvents->addEvent(echo);
                    }
                }
                float sum = 0;
                for (const auto& [pitch, velocity] : notes_)
                    sum += velocity;
                if (data.numOutputs > 0 && data.outputs[0].numChannels >= 2)
                {
                    data.outputs[0].channelBuffers32[0][frame] = static_cast<float>(sum * volume.at(frame));
                    data.outputs[0].channelBuffers32[1][frame] =
                        playing ? static_cast<float>(context->projectTimeMusic + frame * quartersPerFrame) : -1.0F;
                }
            }
            volume_ = volume.at(data.numSamples);
            return kResultOk;
        }

        tresult PLUGIN_API getMidiControllerAssignment(int32 busIndex, int16 /*channel*/, CtrlNumber number,
                                                       ParamID& id) override
        {
            if (busIndex != 0)
                return kResultFalse;
            if (number == kCtrlVolume)
                id = kVolume;
            else if (number == kPitchBend)
                id = kBend;
            else
                return kResultFalse;
            return kResultTrue;
        }

        tresult PLUGIN_API setState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            double volume = 0;
            if (! stream.readDouble(volume))
                return kResultFalse;
            volume_ = volume;
            setParamNormalized(kVolume, volume);
            return kResultOk;
        }

        tresult PLUGIN_API getState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            stream.writeDouble(volume_);
            return kResultOk;
        }

        OBJ_METHODS(Synth, SingleComponentEffect)
        DEFINE_INTERFACES
        DEF_INTERFACE(IMidiMapping)
        END_DEFINE_INTERFACES(SingleComponentEffect)
        REFCOUNT_METHODS(SingleComponentEffect)

    private:
        std::map<int16, float> notes_;
        double volume_ = 1;
        double sampleRate_ = 48000;
    };

    FUnknown* createSynth(void*)
    {
        return static_cast<IAudioProcessor*>(new Synth);
    }
} // namespace soundor::fixtures
