// SoundorHostFixtures.vst3: small, deterministic plugins built with the VST3
// SDK alone, for the host's tests (tests/native). One bundle, three classes:
//
//   Fixture Gain    effect; processor and controller are separate classes.
//                   Stereo (or mono) in and out, a mono sidechain (inactive by
//                   default) added to every output channel. Gain is applied
//                   sample-accurately: out = in * 2 * gain. Latency is a real
//                   delay of 64 * step frames. An editor whose content counts
//                   timer ticks, follows its size parameter and reports its
//                   content scale. Hidden parameters crash or hang the process
//                   call, for the host's failure tests.
//   Fixture Synth   instrument; a single component. Channel 0: the sum of the
//                   held notes' velocities times volume (CC 7). Channel 1: the
//                   transport's musical position at each frame, or -1 when
//                   stopped. Every note is echoed an octave up on its event output.
//   Fixture Broken  writes to stdout, then fails IComponent::initialize.
#include "FixtureNative.h"
#include "FixtureSynth.h"
#include "base/source/fstreamer.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vsttypes.h"
#include "public.sdk/source/common/pluginview.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <map>
#include <string_view>
#include <thread>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace soundor::fixtures
{
    // ── Fixture Gain ─────────────────────────────────────────────────────

    static const FUID gainProcessorId(0x5D3A1C01, 0x6B2E4F10, 0x9A7C3E21, 0x0F1A2B3C);  // NOLINT(cert-err58-cpp)
    static const FUID gainControllerId(0x5D3A1C02, 0x6B2E4F10, 0x9A7C3E21, 0x0F1A2B3C); // NOLINT(cert-err58-cpp)
    static const FUID brokenId(0x5D3A1C04, 0x6B2E4F10, 0x9A7C3E21, 0x0F1A2B3C);         // NOLINT(cert-err58-cpp)

    enum GainParameter : ParamID
    {
        kGain = 1,
        kBypass = 2,
        kLatency = 3,
        kCrash = 4,
        kHang = 5,
        kEditorTicks = 6,
        kEditorSize = 7,
        kPeak = 8,
        kEditorScale = 9,
    };

    constexpr int32 latencyStep = 64;
    constexpr int32 latencySteps = 4;

    class GainProcessor final : public AudioEffect
    {
    public:
        GainProcessor() { setControllerClass(gainControllerId); }
        static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new GainProcessor); }

        tresult PLUGIN_API initialize(FUnknown* context) override
        {
            const tresult result = AudioEffect::initialize(context);
            if (result != kResultOk)
                return result;
            addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
            addAudioInput(STR16("Sidechain"), SpeakerArr::kMono, kAux, 0);
            addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
            return kResultOk;
        }

        tresult PLUGIN_API setBusArrangements(SpeakerArrangement* inputs, int32 numIns, SpeakerArrangement* outputs,
                                              int32 numOuts) override
        {
            // Mono or stereo, the same in and out; the sidechain stays mono.
            if (numIns != 2 || numOuts != 1 || inputs[0] != outputs[0]
                || (inputs[0] != SpeakerArr::kMono && inputs[0] != SpeakerArr::kStereo)
                || inputs[1] != SpeakerArr::kMono)
                return kResultFalse;
            getAudioInput(0)->setArrangement(inputs[0]);
            getAudioOutput(0)->setArrangement(outputs[0]);
            return kResultTrue;
        }

        tresult PLUGIN_API canProcessSampleSize(int32 size) override
        {
            return size == kSample32 ? kResultTrue : kResultFalse;
        }

        uint32 PLUGIN_API getLatencySamples() override { return static_cast<uint32>(latency_); }
        uint32 PLUGIN_API getTailSamples() override { return kNoTail; }

        tresult PLUGIN_API setupProcessing(ProcessSetup& setup) override
        {
            maxBlock_ = setup.maxSamplesPerBlock;
            return AudioEffect::setupProcessing(setup);
        }

        tresult PLUGIN_API setActive(TBool state) override
        {
            // A real plugin clears its delay lines on activation.
            delay_.assign(static_cast<size_t>(latencyStep * latencySteps + 1) * 2, 0.0F);
            written_ = 0;
            return AudioEffect::setActive(state);
        }

        tresult PLUGIN_API process(ProcessData& data) override
        {
            Automation gain(data.inputParameterChanges, kGain, gain_);
            Automation bypass(data.inputParameterChanges, kBypass, bypass_);
            Automation latency(data.inputParameterChanges, kLatency, latencyNormalized_);
            Automation crash(data.inputParameterChanges, kCrash, 0);
            Automation hang(data.inputParameterChanges, kHang, 0);
            if (crash.at(data.numSamples) > 0.5)
                std::abort();
            if (hang.at(data.numSamples) > 0.5)
                while (true)
                    std::this_thread::sleep_for(std::chrono::seconds(1));

            latencyNormalized_ = latency.at(0);
            latency_ = static_cast<int32>(std::lround(latencyNormalized_ * latencySteps)) * latencyStep;
            if (data.numSamples == 0 || data.numOutputs == 0)
            {
                gain_ = gain.at(0);
                bypass_ = bypass.at(0);
                return kResultOk;
            }

            const AudioBusBuffers& in = data.inputs[0];
            const AudioBusBuffers& out = data.outputs[0];
            const bool sidechain = data.numInputs > 1 && getAudioInput(1)->isActive();
            const auto channels = static_cast<size_t>(out.numChannels);
            const size_t ring = delay_.size() / 2;
            float peak = 0;
            for (int32 frame = 0; frame < data.numSamples; ++frame)
            {
                const double g = gain.at(frame) * 2.0;
                const bool bypassed = bypass.at(frame) > 0.5;
                for (size_t channel = 0; channel < channels; ++channel)
                {
                    float sample = in.channelBuffers32[channel][frame];
                    if (sidechain)
                        sample += data.inputs[1].channelBuffers32[0][frame];
                    if (! bypassed)
                        sample = static_cast<float>(sample * g);
                    // A delay line of `latency_` frames.
                    const size_t slot = channel * ring;
                    delay_[slot + (written_ % ring)] = sample;
                    const float delayed = delay_[slot + ((written_ + ring - static_cast<size_t>(latency_)) % ring)];
                    out.channelBuffers32[channel][frame] = delayed;
                    peak = std::max(peak, std::fabs(delayed));
                }
                ++written_;
            }
            gain_ = gain.at(data.numSamples);
            bypass_ = bypass.at(data.numSamples);

            if (data.outputParameterChanges != nullptr)
            {
                int32 index = 0;
                if (IParamValueQueue* queue = data.outputParameterChanges->addParameterData(kPeak, index))
                    queue->addPoint(data.numSamples - 1, std::min(1.0F, peak), index);
            }
            return kResultOk;
        }

        tresult PLUGIN_API setState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            double gain = 0;
            double bypass = 0;
            double latency = 0;
            if (! stream.readDouble(gain) || ! stream.readDouble(bypass) || ! stream.readDouble(latency))
                return kResultFalse;
            gain_ = gain;
            bypass_ = bypass;
            latencyNormalized_ = latency;
            latency_ = static_cast<int32>(std::lround(latency * latencySteps)) * latencyStep;
            return kResultOk;
        }

        tresult PLUGIN_API getState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            stream.writeDouble(gain_);
            stream.writeDouble(bypass_);
            stream.writeDouble(latencyNormalized_);
            return kResultOk;
        }

    private:
        double gain_ = 0.5;
        double bypass_ = 0;
        double latencyNormalized_ = 0;
        int32 latency_ = 0;
        int32 maxBlock_ = 0;
        std::vector<float> delay_;
        size_t written_ = 0;
    };

    class FixtureView final : public CPluginView, public IPlugViewContentScaleSupport
    {
    public:
        FixtureView(EditController& controller, int width, int height) : CPluginView(nullptr), controller_(controller)
        {
            ViewRect size(0, 0, width, height);
            setRect(size);
        }

        ~FixtureView() override
        {
            if (gone)
                gone();
        }

        /** Tells the controller the host released the view. */
        std::function<void()> gone;

        tresult PLUGIN_API isPlatformTypeSupported(FIDString type) override
        {
            return std::string_view(type) == platformType() ? kResultTrue : kResultFalse;
        }

        tresult PLUGIN_API attached(void* parent, FIDString type) override
        {
            if (isPlatformTypeSupported(type) != kResultTrue)
                return kResultFalse;
            child_ = createChild(parent, rect.getWidth(), rect.getHeight(), plugFrame,
                                 [this]
                                 {
                                     ++ticks_;
                                     controller_.setParamNormalized(kEditorTicks, std::min(1.0, ticks_ / 1000.0));
                                 });
            if (child_ == nullptr)
                return kResultFalse;
            return CPluginView::attached(parent, type);
        }

        tresult PLUGIN_API removed() override
        {
            if (child_ != nullptr)
                destroyChild(child_);
            child_ = nullptr;
            return CPluginView::removed();
        }

        tresult PLUGIN_API onSize(ViewRect* size) override
        {
            if (child_ != nullptr)
                resizeChild(child_, size->getWidth(), size->getHeight());
            return CPluginView::onSize(size);
        }

        tresult PLUGIN_API canResize() override
        {
            // NOLINTNEXTLINE(concurrency-mt-unsafe): nothing in a test sets the environment.
            return std::getenv("SOUNDOR_FIXTURE_EDITOR_FIXED") != nullptr ? kResultFalse : kResultTrue;
        }

        tresult PLUGIN_API checkSizeConstraint(ViewRect* size) override
        {
            // As JUCE keeps a fixed aspect ratio: too wide takes its width from
            // the height, and too tall its height from the width.
            // NOLINTNEXTLINE(concurrency-mt-unsafe): nothing in a test sets the environment.
            if (std::getenv("SOUNDOR_FIXTURE_EDITOR_KEEPS_SHAPE") != nullptr)
            {
                int width = std::clamp(size->getWidth(), 200, 1000);
                int height = std::clamp(size->getHeight(), 150, 750);
                if (width * 3 > height * 4)
                    width = height * 4 / 3;
                else
                    height = width * 3 / 4;
                size->right = size->left + width;
                size->bottom = size->top + height;
                return kResultTrue;
            }
            size->right = size->left + std::clamp(size->getWidth(), 200, 1000);
            size->bottom = size->top + std::clamp(size->getHeight(), 150, 750);
            return kResultTrue;
        }

        tresult PLUGIN_API setContentScaleFactor(ScaleFactor factor) override
        {
            controller_.setParamNormalized(kEditorScale, std::min(1.0, factor / 4.0));
            return kResultTrue;
        }

        /** The plugin resizes itself, through the host's frame. */
        void requestSize(int width, int height)
        {
            ViewRect size(0, 0, width, height);
            if (plugFrame != nullptr)
                plugFrame->resizeView(this, &size);
        }

        OBJ_METHODS(FixtureView, CPluginView)
        DEFINE_INTERFACES
        DEF_INTERFACE(IPlugViewContentScaleSupport)
        END_DEFINE_INTERFACES(CPluginView)
        REFCOUNT_METHODS(CPluginView)

    private:
        EditController& controller_;
        NativeChild* child_ = nullptr;
        int ticks_ = 0;
    };

    class GainController final : public EditController
    {
    public:
        static FUnknown* create(void*) { return static_cast<IEditController*>(new GainController); }

        tresult PLUGIN_API initialize(FUnknown* context) override
        {
            const tresult result = EditController::initialize(context);
            if (result != kResultOk)
                return result;
            parameters.addParameter(STR16("Gain"), STR16("x"), 0, 0.5, ParameterInfo::kCanAutomate, kGain);
            parameters.addParameter(STR16("Bypass"), nullptr, 1, 0,
                                    ParameterInfo::kCanAutomate | ParameterInfo::kIsBypass, kBypass);
            // Plain values are steps of 64 frames: 0 to 4.
            parameters.addParameter(
                new RangeParameter(STR16("Latency"), kLatency, STR16("steps"), 0, latencySteps, 0, latencySteps, 0));
            parameters.addParameter(STR16("Crash"), nullptr, 1, 0, ParameterInfo::kIsHidden, kCrash);
            parameters.addParameter(STR16("Hang"), nullptr, 1, 0, ParameterInfo::kIsHidden, kHang);
            parameters.addParameter(STR16("Editor Ticks"), nullptr, 0, 0, ParameterInfo::kIsReadOnly, kEditorTicks);
            parameters.addParameter(STR16("Editor Size"), nullptr, 1, 0, ParameterInfo::kIsList, kEditorSize);
            parameters.addParameter(STR16("Peak"), nullptr, 0, 0, ParameterInfo::kIsReadOnly, kPeak);
            parameters.addParameter(STR16("Editor Scale"), nullptr, 0, 0, ParameterInfo::kIsReadOnly, kEditorScale);
            return kResultOk;
        }

        tresult PLUGIN_API setComponentState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            double gain = 0;
            double bypass = 0;
            double latency = 0;
            if (! stream.readDouble(gain) || ! stream.readDouble(bypass) || ! stream.readDouble(latency))
                return kResultFalse;
            EditController::setParamNormalized(kGain, gain);
            EditController::setParamNormalized(kBypass, bypass);
            EditController::setParamNormalized(kLatency, latency);
            return kResultOk;
        }

        // The controller's own state: the editor size.
        tresult PLUGIN_API setState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            double size = 0;
            if (! stream.readDouble(size))
                return kResultFalse;
            return setParamNormalized(kEditorSize, size);
        }

        tresult PLUGIN_API getState(IBStream* state) override
        {
            IBStreamer stream(state, kLittleEndian);
            stream.writeDouble(getParamNormalized(kEditorSize));
            return kResultOk;
        }

        tresult PLUGIN_API setParamNormalized(ParamID id, ParamValue value) override
        {
            const ParamValue previous = getParamNormalized(id);
            const tresult result = EditController::setParamNormalized(id, value);
            if (id == kEditorSize && view_ != nullptr)
                view_->requestSize(value > 0.5 ? 600 : 400, value > 0.5 ? 450 : 300);
            if (id == kLatency && previous != value && componentHandler != nullptr)
                componentHandler->restartComponent(kLatencyChanged);
            return result;
        }

        IPlugView* PLUGIN_API createView(FIDString name) override
        {
            if (std::string_view(name) != ViewType::kEditor)
                return nullptr;
            const bool large = getParamNormalized(kEditorSize) > 0.5;
            view_ = new FixtureView(*this, large ? 600 : 400, large ? 450 : 300);
            view_->gone = [this] { view_ = nullptr; };
            return view_;
        }

    private:
        FixtureView* view_ = nullptr;
    };

    // ── Fixture Broken ───────────────────────────────────────────────────

    class Broken final : public AudioEffect
    {
    public:
        static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new Broken); }
        tresult PLUGIN_API initialize(FUnknown* /*context*/) override
        {
            // Plugins write to stdout; the protocol must not notice.
            std::printf("Fixture Broken writes to stdout\n");
            std::fflush(stdout);
            return kResultFalse;
        }
    };
} // namespace soundor::fixtures

bool InitModule()
{
    return true;
}

bool DeinitModule()
{
    return true;
}

using namespace soundor::fixtures;

BEGIN_FACTORY("Soundor", "https://soundor.dev", "", PFactoryInfo::kUnicode)

DEF_CLASS2(INLINE_UID_FROM_FUID(gainProcessorId), PClassInfo::kManyInstances, kVstAudioEffectClass, "Fixture Gain",
           Vst::kDistributable, Vst::PlugType::kFx, "1.0.0", kVstVersionString, GainProcessor::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(gainControllerId), PClassInfo::kManyInstances, kVstComponentControllerClass,
           "Fixture Gain Controller", 0, "", "1.0.0", kVstVersionString, GainController::create)
DEF_CLASS2(INLINE_UID_FROM_FUID(synthId), PClassInfo::kManyInstances, kVstAudioEffectClass, "Fixture Synth", 0,
           Vst::PlugType::kInstrumentSynth, "1.0.0", kVstVersionString, createSynth)
DEF_CLASS2(INLINE_UID_FROM_FUID(brokenId), PClassInfo::kManyInstances, kVstAudioEffectClass, "Fixture Broken", 0,
           Vst::PlugType::kFx, "1.0.0", kVstVersionString, Broken::create)

END_FACTORY
