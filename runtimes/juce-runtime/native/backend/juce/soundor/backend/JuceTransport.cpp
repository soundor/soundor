#include "JuceTransport.h"

#include <cmath>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    void TransportCapture::capture(juce::AudioPlayHead* playHead) noexcept
    {
        loopStart.store(unavailable, std::memory_order_relaxed);
        loopEnd.store(unavailable, std::memory_order_relaxed);
        frameRate.store(unavailable, std::memory_order_relaxed);
        originSeconds.store(unavailable, std::memory_order_relaxed);
        if (playHead == nullptr)
            return;
        const auto position = playHead->getPosition();
        if (! position.hasValue())
            return;
        playing.store(position->getIsPlaying(), std::memory_order_relaxed);
        recording.store(position->getIsRecording(), std::memory_order_relaxed);
        looping.store(position->getIsLooping(), std::memory_order_relaxed);
        if (const auto value = position->getBpm())
            bpm.store(*value, std::memory_order_relaxed);
        if (const auto signature = position->getTimeSignature())
        {
            numerator.store(signature->numerator, std::memory_order_relaxed);
            denominator.store(signature->denominator, std::memory_order_relaxed);
        }
        if (const auto value = position->getPpqPosition())
            ppqPosition.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getPpqPositionOfLastBarStart())
            barStartPpq.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getTimeInSeconds())
            timeInSeconds.store(*value, std::memory_order_relaxed);
        if (const auto value = position->getTimeInSamples())
            timeInSamples.store(*value, std::memory_order_relaxed);
        if (const auto loop = position->getLoopPoints())
        {
            loopStart.store(loop->ppqStart, std::memory_order_relaxed);
            loopEnd.store(loop->ppqEnd, std::memory_order_relaxed);
        }
        if (const auto rate = position->getFrameRate(); rate && rate->getEffectiveRate() > 0)
        {
            frameRate.store(rate->getEffectiveRate(), std::memory_order_relaxed);
            dropFrame.store(rate->isDrop(), std::memory_order_relaxed);
        }
        if (const auto origin = position->getEditOriginTime())
            originSeconds.store(*origin, std::memory_order_relaxed);
        valid.store(true, std::memory_order_release);
    }

    std::optional<platform::Transport> TransportCapture::latest() const noexcept
    {
        if (! valid.load(std::memory_order_acquire))
            return std::nullopt;
        platform::Transport transport;
        transport.playing = playing.load(std::memory_order_relaxed);
        transport.recording = recording.load(std::memory_order_relaxed);
        transport.looping = looping.load(std::memory_order_relaxed);
        transport.bpm = bpm.load(std::memory_order_relaxed);
        transport.timeSignatureNumerator = numerator.load(std::memory_order_relaxed);
        transport.timeSignatureDenominator = denominator.load(std::memory_order_relaxed);
        transport.ppqPosition = ppqPosition.load(std::memory_order_relaxed);
        transport.barStartPpq = barStartPpq.load(std::memory_order_relaxed);
        transport.timeInSeconds = timeInSeconds.load(std::memory_order_relaxed);
        transport.timeInSamples = timeInSamples.load(std::memory_order_relaxed);
        const double start = loopStart.load(std::memory_order_relaxed);
        const double end = loopEnd.load(std::memory_order_relaxed);
        if (std::isfinite(start))
            transport.loopStartPpq = start;
        if (std::isfinite(end))
            transport.loopEndPpq = end;
        const double fps = frameRate.load(std::memory_order_relaxed);
        if (std::isfinite(fps))
        {
            platform::Timecode timecode;
            timecode.framesPerSecond = fps;
            timecode.dropFrame = dropFrame.load(std::memory_order_relaxed);
            const double origin = originSeconds.load(std::memory_order_relaxed);
            if (std::isfinite(origin))
                timecode.smpteOffsetSubframes = origin * fps * 80;
            transport.timecode = timecode;
        }
        return transport;
    }

    namespace
    {
        template <typename Properties>
        platform::TrackInfo readTrackProperties(const Properties& properties)
        {
            platform::TrackInfo info;
            std::optional<juce::Colour> color;
            // JUCE versions differ in how they represent unavailable metadata.
            if constexpr (requires { properties.colourARGB; })
            {
                if (properties.name)
                    info.name = properties.name->toStdString();
                if (properties.colourARGB)
                    color = juce::Colour(*properties.colourARGB);
            }
            else
            {
                if (properties.name.isNotEmpty())
                    info.name = properties.name.toStdString();
                if (! properties.colour.isTransparent())
                    color = properties.colour;
            }
            if (color)
            {
                const auto rgba = (color->getARGB() << 8) | color->getAlpha();
                info.color = "#" + juce::String::toHexString(static_cast<int>(rgba)).paddedLeft('0', 8).toStdString();
            }
            return info;
        }
    } // namespace

    void TransportCapture::updateTrackProperties(const juce::AudioProcessor::TrackProperties& properties)
    {
        track = readTrackProperties(properties);
    }

    platform::HostEnvironment hostEnvironment(const juce::AudioProcessor& processor, std::string version)
    {
        platform::HostEnvironment result;
        result.runtime = "juce";
        result.runtimeVersion = std::move(version);
#if JUCE_IOS
        result.platform = "ios";
#elif JUCE_MAC
        result.platform = "macos";
#elif JUCE_WINDOWS
        result.platform = "windows";
#elif JUCE_ANDROID
        result.platform = "android";
#elif JUCE_LINUX
        result.platform = "linux";
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
        result.arch = "arm64";
#elif defined(__x86_64__) || defined(_M_X64)
        result.arch = "x64";
#endif
        switch (processor.wrapperType)
        {
            case juce::AudioProcessor::wrapperType_VST3:
                result.format = "vst3";
                break;
            case juce::AudioProcessor::wrapperType_AudioUnit:
                result.format = "au";
                break;
            case juce::AudioProcessor::wrapperType_Standalone:
                result.format = "standalone";
                break;
            default:
                break;
        }
        return result;
    }

    JuceHostInfo::JuceHostInfo(const juce::AudioProcessor& owner, const TransportCapture& capture)
        : processor(owner), transport(capture), hostName(juce::PluginHostType().getHostDescription())
    {
    }

    platform::HostSnapshot JuceHostInfo::snapshot() const
    {
        platform::HostSnapshot snapshot;
        snapshot.sampleRate = processor.getSampleRate();
        snapshot.blockSize = processor.getBlockSize();
        snapshot.hostName = hostName;
        snapshot.samplePrecision = processor.isUsingDoublePrecision() ? "float64" : "float32";
        snapshot.processingMode = processor.isNonRealtime() ? "offline" : "realtime";
        snapshot.track = transport.trackInfo();
        snapshot.transport = transport.latest();
        return snapshot;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
