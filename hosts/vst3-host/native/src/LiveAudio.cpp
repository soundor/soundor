#include "LiveAudio.h"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>

namespace soundor::vst3host
{
    namespace
    {
        constexpr double oscillatorFrequency = 220;
        constexpr float oscillatorLevel = 0.3F;
        // How far the volume moves per sample: a 10 ms ramp from 0 to 1.
        constexpr float gainStep = 1.0F / 480.0F;

        SDL_AudioSpec specAt(double rate)
        {
            SDL_AudioSpec spec {};
            spec.format = SDL_AUDIO_F32;
            spec.channels = 2;
            spec.freq = static_cast<int>(std::lround(rate));
            return spec;
        }
    } // namespace

    const char* inputName(AudioInput input)
    {
        switch (input)
        {
            case AudioInput::oscillator:
                return "oscillator";
            case AudioInput::file:
                return "file";
            case AudioInput::microphone:
                return "microphone";
            case AudioInput::none:
                return "none";
        }
        return "none";
    }

    std::optional<AudioInput> parseInput(const std::string& name)
    {
        for (const auto input : { AudioInput::oscillator, AudioInput::file, AudioInput::microphone, AudioInput::none })
            if (name == inputName(input))
                return input;
        return std::nullopt;
    }

    LiveAudio::LiveAudio(EventLoop& loop, Plugin& plugin) : loop_(loop), plugin_(plugin) {}

    LiveAudio::~LiveAudio()
    {
        stop();
    }

    void LiveAudio::start()
    {
        if (output_ != nullptr)
            return;
        if (! plugin_.loaded())
            throw Failure("invalid-state", "no plugin is loaded");
        if (! SDL_WasInit(SDL_INIT_AUDIO) && ! SDL_InitSubSystem(SDL_INIT_AUDIO))
            throw Failure("audio-unavailable", std::string("audio could not start: ") + SDL_GetError());
        sampleRate_ = plugin_.setup().sampleRate;
        const SDL_AudioSpec spec = specAt(sampleRate_);
        output_ = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, &LiveAudio::feed, this);
        if (output_ == nullptr)
            throw Failure("audio-unavailable",
                          std::string("no audio output device could be opened: ") + SDL_GetError());
        {
            const std::scoped_lock lock(errorMutex_);
            error_.clear();
        }
        gain_ = 0;
        convertFile();
        if (input_ == AudioInput::microphone)
            openMicrophone();
        playingInput_ = input_;
        SDL_ResumeAudioStreamDevice(output_);
    }

    void LiveAudio::stop()
    {
        if (output_ == nullptr)
            return;
        // Waits for a callback in progress.
        SDL_DestroyAudioStream(output_);
        output_ = nullptr;
        closeMicrophone();
        peaks_[0] = 0;
        peaks_[1] = 0;
        drainOutputChanges();
    }

    void LiveAudio::setVolume(double volume)
    {
        volume_ = std::isfinite(volume) ? std::clamp(volume, 0.0, 1.0) : 0.0;
    }

    void LiveAudio::setInput(AudioInput input, const std::string& file)
    {
        if (input == AudioInput::file)
        {
            if (file.empty() && filePath_.empty())
                throw Failure("invalid-request", "the file input needs a WAV file");
            if (! file.empty())
            {
                SDL_AudioSpec spec {};
                Uint8* bytes = nullptr;
                Uint32 length = 0;
                if (! SDL_LoadWAV(file.c_str(), &spec, &bytes, &length))
                    throw Failure("invalid-request",
                                  "\"" + file + "\" could not be read as a WAV file: " + SDL_GetError());
                std::vector<unsigned char> decoded(bytes, bytes + length);
                SDL_free(bytes);
                if (output_ != nullptr)
                    SDL_LockAudioStream(output_);
                fileBytes_ = std::move(decoded);
                fileFormat_ = static_cast<int>(spec.format);
                fileChannels_ = spec.channels;
                fileRate_ = spec.freq;
                filePath_ = file;
                if (output_ != nullptr)
                    SDL_UnlockAudioStream(output_);
                convertFile();
            }
        }
        inputError_.clear();
        if (output_ != nullptr)
            SDL_LockAudioStream(output_);
        input_ = input;
        playingInput_ = input;
        filePosition_ = 0;
        if (output_ != nullptr)
            SDL_UnlockAudioStream(output_);
        if (output_ != nullptr && input == AudioInput::microphone)
            openMicrophone();
        else
            closeMicrophone();
    }

    std::string LiveAudio::fileName() const
    {
        return filePath_.empty() ? std::string() : std::filesystem::path(filePath_).filename().string();
    }

    std::string LiveAudio::device() const
    {
        if (output_ == nullptr)
            return {};
        const char* name = SDL_GetAudioDeviceName(SDL_GetAudioStreamDevice(output_));
        return name != nullptr ? name : "";
    }

    std::string LiveAudio::error() const
    {
        const std::scoped_lock lock(errorMutex_);
        return error_;
    }

    void LiveAudio::formatChanged()
    {
        if (output_ == nullptr)
            return;
        sampleRate_ = plugin_.setup().sampleRate;
        const SDL_AudioSpec spec = specAt(sampleRate_);
        SDL_SetAudioStreamFormat(output_, &spec, nullptr);
        if (microphone_ != nullptr)
            SDL_SetAudioStreamFormat(microphone_, nullptr, &spec);
        convertFile();
    }

    Json LiveAudio::status() const
    {
        Json result = Json::object();
        result.set("running", running());
        result.set("muted", muted());
        result.set("volume", volume());
        result.set("input", inputName(input_));
        result.set("file", filePath_.empty() ? Json() : Json(filePath_));
        result.set("device", running() ? Json(device()) : Json());
        const std::string failure = error();
        result.set("error", failure.empty() ? Json() : Json(failure));
        result.set("inputError", inputError_.empty() ? Json() : Json(inputError_));
        return result;
    }

    void LiveAudio::openMicrophone()
    {
        if (microphone_ != nullptr)
            return;
        const SDL_AudioSpec spec = specAt(sampleRate_);
        SDL_AudioStream* stream =
            SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_RECORDING, &spec, nullptr, nullptr);
        if (stream == nullptr)
        {
            inputError_ = std::string("the microphone could not be opened: ") + SDL_GetError();
            return;
        }
        SDL_ResumeAudioStreamDevice(stream);
        SDL_LockAudioStream(output_);
        microphone_ = stream;
        SDL_UnlockAudioStream(output_);
    }

    void LiveAudio::closeMicrophone()
    {
        if (microphone_ == nullptr)
            return;
        SDL_AudioStream* stream = microphone_;
        if (output_ != nullptr)
            SDL_LockAudioStream(output_);
        microphone_ = nullptr;
        if (output_ != nullptr)
            SDL_UnlockAudioStream(output_);
        SDL_DestroyAudioStream(stream);
    }

    void LiveAudio::convertFile()
    {
        if (fileBytes_.empty())
            return;
        SDL_AudioSpec source {};
        source.format = static_cast<SDL_AudioFormat>(fileFormat_);
        source.channels = fileChannels_;
        source.freq = fileRate_;
        const SDL_AudioSpec target = specAt(plugin_.setup().sampleRate);
        Uint8* converted = nullptr;
        int length = 0;
        if (! SDL_ConvertAudioSamples(&source, fileBytes_.data(), static_cast<int>(fileBytes_.size()), &target,
                                      &converted, &length))
        {
            inputError_ = std::string("the file could not be converted: ") + SDL_GetError();
            return;
        }
        std::vector<float> samples(static_cast<size_t>(length) / sizeof(float));
        std::memcpy(samples.data(), converted, samples.size() * sizeof(float));
        SDL_free(converted);
        if (output_ != nullptr)
            SDL_LockAudioStream(output_);
        file_ = std::move(samples);
        filePosition_ = 0;
        if (output_ != nullptr)
            SDL_UnlockAudioStream(output_);
    }

    // ── The audio thread ─────────────────────────────────────────────────

    void LiveAudio::feed(void* self, SDL_AudioStream* stream, int additional, int /*total*/)
    {
        auto& audio = *static_cast<LiveAudio*>(self);
        const int block = std::max(1, static_cast<int>(audio.plugin_.setup().blockSize));
        int frames = additional / static_cast<int>(2 * sizeof(float));
        while (frames > 0)
        {
            const int chunk = std::min(frames, block);
            audio.render(chunk);
            SDL_PutAudioStreamData(stream, audio.mix_.data(), static_cast<int>(audio.mix_.size() * sizeof(float)));
            frames -= chunk;
        }
    }

    void LiveAudio::readInput(int frames, bool playing)
    {
        stereoInput_.assign(static_cast<size_t>(frames) * 2, 0.0F);
        if (! playing)
            return;
        switch (playingInput_)
        {
            case AudioInput::oscillator:
                for (int frame = 0; frame < frames; ++frame)
                {
                    // A triangle wave, as the web runtime's.
                    const double value = 4.0 * std::abs(phase_ - std::floor(phase_ + 0.5)) - 1.0;
                    const auto sample = static_cast<float>(value) * oscillatorLevel;
                    stereoInput_[static_cast<size_t>(frame) * 2] = sample;
                    stereoInput_[static_cast<size_t>(frame) * 2 + 1] = sample;
                    phase_ += oscillatorFrequency / sampleRate_;
                    phase_ -= std::floor(phase_);
                }
                break;
            case AudioInput::file:
                if (file_.size() >= 2)
                    for (float& sample : stereoInput_)
                    {
                        sample = file_[filePosition_];
                        filePosition_ = (filePosition_ + 1) % file_.size();
                    }
                break;
            case AudioInput::microphone:
                if (microphone_ != nullptr)
                {
                    const int wanted = static_cast<int>(stereoInput_.size() * sizeof(float));
                    // Never fall behind the device by more than a few blocks.
                    const int available = SDL_GetAudioStreamAvailable(microphone_);
                    if (available > wanted * 4)
                    {
                        std::vector<float> discard(static_cast<size_t>(available - wanted) / sizeof(float));
                        SDL_GetAudioStreamData(microphone_, discard.data(),
                                               static_cast<int>(discard.size() * sizeof(float)));
                    }
                    SDL_GetAudioStreamData(microphone_, stereoInput_.data(), wanted);
                }
                break;
            case AudioInput::none:
                break;
        }
    }

    void LiveAudio::render(int frames)
    {
        mix_.assign(static_cast<size_t>(frames) * 2, 0.0F);
        const std::unique_lock processing(plugin_.processing(), std::try_to_lock);
        if (processing.owns_lock() && plugin_.loaded() && plugin_.active())
        {
            const bool playing = plugin_.transport().playing;
            readInput(frames, playing);

            const auto inputs = plugin_.inputBusChannels();
            const auto outputs = plugin_.outputBusChannels();
            const int32 inChannels = plugin_.mainInputChannels();
            const int32 outChannels = plugin_.mainOutputChannels();
            inputChannels_.resize(static_cast<size_t>(std::max(inChannels, 0)));
            job_.inputs.assign(inputs.size(), {});
            for (size_t bus = 0; bus < inputs.size(); ++bus)
                job_.inputs[bus].assign(static_cast<size_t>(inputs[bus]), nullptr);
            for (int32 channel = 0; channel < inChannels && ! inputs.empty(); ++channel)
            {
                auto& samples = inputChannels_[static_cast<size_t>(channel)];
                samples.assign(static_cast<size_t>(frames), 0.0F);
                for (int frame = 0; frame < frames; ++frame)
                {
                    const float left = stereoInput_[static_cast<size_t>(frame) * 2];
                    const float right = stereoInput_[static_cast<size_t>(frame) * 2 + 1];
                    samples[static_cast<size_t>(frame)] = inChannels == 1 ? (left + right) * 0.5F
                                                          : channel == 0  ? left
                                                          : channel == 1  ? right
                                                                          : 0.0F;
                }
                job_.inputs[0][static_cast<size_t>(channel)] = samples.data();
            }
            job_.frames = frames;
            job_.outputChannels.assign(outputs.size(), 0);
            if (! outputs.empty())
                job_.outputChannels[0] = outChannels;
            job_.output.resize(static_cast<size_t>(std::max(outChannels, 0)) * static_cast<size_t>(frames)
                               * sizeof(float));
            job_.outputChanges.clear();
            job_.outputEvents.clear();
            job_.error.clear();
            plugin_.runProcess(job_);

            if (! job_.error.empty())
            {
                const std::scoped_lock lock(errorMutex_);
                error_ = job_.error;
            }
            else if (outChannels > 0)
            {
                const auto* output = reinterpret_cast<const float*>(job_.output.data());
                const float* left = output;
                const float* right = outChannels > 1 ? output + frames : output;
                for (int frame = 0; frame < frames; ++frame)
                {
                    mix_[static_cast<size_t>(frame) * 2] = left[frame];
                    mix_[static_cast<size_t>(frame) * 2 + 1] = right[frame];
                }
            }
            if (! job_.outputChanges.empty())
            {
                {
                    const std::unique_lock lock(changesMutex_, std::try_to_lock);
                    if (lock.owns_lock())
                        changes_.insert(changes_.end(), job_.outputChanges.begin(), job_.outputChanges.end());
                }
                if (! drainPosted_.exchange(true))
                    loop_.post([this] { drainOutputChanges(); });
            }
        }

        const float target = muted_ ? 0.0F : static_cast<float>(volume_.load());
        float peaks[2] = { 0, 0 };
        for (int frame = 0; frame < frames; ++frame)
        {
            gain_ += std::clamp(target - gain_, -gainStep, gainStep);
            for (int side = 0; side < 2; ++side)
            {
                float& sample = mix_[static_cast<size_t>(frame) * 2 + static_cast<size_t>(side)];
                sample = std::isfinite(sample) ? std::clamp(sample * gain_, -1.0F, 1.0F) : 0.0F;
                peaks[side] = std::max(peaks[side], std::abs(sample));
            }
        }
        for (int side = 0; side < 2; ++side)
        {
            float previous = peaks_[side].load();
            while (peaks[side] > previous && ! peaks_[side].compare_exchange_weak(previous, peaks[side]))
            {
            }
        }
    }

    void LiveAudio::drainOutputChanges()
    {
        drainPosted_ = false;
        std::vector<ParameterChange> changes;
        {
            const std::scoped_lock lock(changesMutex_);
            changes.swap(changes_);
        }
        plugin_.applyOutputChanges(changes);
    }
} // namespace soundor::vst3host
