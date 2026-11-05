// Live audio: the plugin plays through the default output device, in real
// time, with an input of the host's choosing (SDL3's audio).
//
// The plugin processes on SDL's audio thread, which only tries the plugin's
// processing lock: while a request changes the plugin (or an offline process
// call runs), live audio plays silence instead of waiting. The input plays
// while the transport does, as in the web runtime; the plugin's main output
// bus goes to the device in stereo (mono to both sides, the first two
// channels of anything wider).
#pragma once

#include "EventLoop.h"
#include "Json.h"
#include "Plugin.h"

#include <atomic>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

struct SDL_AudioStream;

namespace soundor::vst3host
{
    enum class AudioInput
    {
        oscillator,
        file,
        microphone,
        none,
    };

    const char* inputName(AudioInput input);
    std::optional<AudioInput> parseInput(const std::string& name);

    class LiveAudio
    {
    public:
        LiveAudio(EventLoop& loop, Plugin& plugin);
        ~LiveAudio();
        LiveAudio(const LiveAudio&) = delete;
        LiveAudio& operator=(const LiveAudio&) = delete;

        /** Opens the default output device; `audio-unavailable` without one. */
        void start();
        void stop();
        [[nodiscard]] bool running() const { return output_ != nullptr; }

        void setMuted(bool muted) { muted_ = muted; }
        [[nodiscard]] bool muted() const { return muted_; }
        void setVolume(double volume);
        [[nodiscard]] double volume() const { return volume_; }

        /** Selects the input; a file is a WAV file's path, decoded now. */
        void setInput(AudioInput input, const std::string& file = {});
        [[nodiscard]] AudioInput input() const { return input_; }
        /** The file's name, without its directory; empty without one. */
        [[nodiscard]] std::string fileName() const;
        [[nodiscard]] std::string device() const;
        /** What failed last: the device or processing, and the input. */
        [[nodiscard]] std::string error() const;
        [[nodiscard]] std::string inputError() const { return inputError_; }

        /** The plugin's sample rate or buses changed. */
        void formatChanged();
        /** The loudest sample per side since the last call, after the volume. */
        float takePeak(int side) { return peaks_[side].exchange(0); }

        Json status() const;

    private:
        static void feed(void* self, SDL_AudioStream* stream, int additional, int total);
        void render(int frames);
        void readInput(int frames, bool playing);
        void openMicrophone();
        void closeMicrophone();
        void convertFile();
        void drainOutputChanges();

        EventLoop& loop_;
        Plugin& plugin_;
        SDL_AudioStream* output_ = nullptr;
        SDL_AudioStream* microphone_ = nullptr;
        double sampleRate_ = 48000;

        std::atomic<bool> muted_ = false;
        std::atomic<double> volume_ = 0.8;
        AudioInput input_ = AudioInput::oscillator;
        std::string inputError_;
        std::string filePath_;
        // The file as decoded, and as stereo float at the plugin's rate.
        // Changed only with the output stream locked.
        std::vector<unsigned char> fileBytes_;
        int fileFormat_ = 0;
        int fileChannels_ = 0;
        int fileRate_ = 0;
        std::vector<float> file_;
        AudioInput playingInput_ = AudioInput::oscillator;

        // The audio thread's own.
        ProcessJob job_;
        std::vector<std::vector<float>> inputChannels_;
        std::vector<float> stereoInput_;
        std::vector<float> mix_;
        double phase_ = 0;
        size_t filePosition_ = 0;
        uint32_t noise_ = 1;
        float gain_ = 0;
        std::atomic<float> peaks_[2] = { 0.0F, 0.0F };

        mutable std::mutex errorMutex_;
        std::string error_;

        // Output parameter values (meters) on their way to the controller.
        std::mutex changesMutex_;
        std::vector<ParameterChange> changes_;
        std::atomic<bool> drainPosted_ = false;
    };
} // namespace soundor::vst3host
