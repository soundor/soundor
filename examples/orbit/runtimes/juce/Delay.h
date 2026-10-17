#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace orbit
{

    struct Settings
    {
        std::array<float, 3> times { 0.375f, 0.75f, 1.125f };
        std::array<float, 3> levels { 0.8f, 0.55f, 0.35f };
        float feedback = 0.48f, tone = 0.55f, motion = 0.18f, spread = 0.75f, mix = 0.35f;
        bool hold = false, bypass = false;
    };

    // Same three independent feedback lines as the browser AudioWorklet. Allocate
    // only in prepare(); process and entering Hold do not allocate or take locks.
    class Delay
    {
    public:
        void prepare(double sampleRate)
        {
            rate = sampleRate;
            capacity = static_cast<int>(std::ceil(rate * 10)) + 2;
            for (auto& buffer : buffers)
                buffer.assign(static_cast<size_t>(capacity), 0.0f);
            delays = { rate * 0.375, rate * 0.75, rate * 1.125 };
            filtered = {};
            levels = { .8, .55, .35 };
            feedback = .48;
            motion = .18;
            spread = .75;
            phases = {};
            write = 0;
            clock = 0;
            held = false;
            wet = blend = 0;
            smooth = 1 - std::exp(-1 / (0.02 * rate));
        }

        void configure(const Settings& settings)
        {
            cutoff =
                1
                - std::exp(-2 * 3.141592653589793 * std::min(rate * 0.45, 400 * std::pow(30.0, settings.tone)) / rate);
        }

        std::array<float, 2> tick(float left, float right, const Settings& settings)
        {
            if (settings.hold && ! held)
                for (size_t i = 0; i < 3; ++i)
                {
                    lengths[i] = std::max(128.0, std::round(delays[i]));
                    starts[i] = write - lengths[i];
                    phases[i] = 0;
                }
            held = settings.hold;
            feedback += (settings.feedback - feedback) * smooth;
            motion += (settings.motion - motion) * smooth;
            spread += (settings.spread - spread) * smooth;
            double wetLeft = 0, wetRight = 0;
            for (size_t i = 0; i < 3; ++i)
            {
                const auto target = std::clamp(settings.times[i] * rate, 128.0, capacity - 2.0);
                delays[i] += (target - delays[i]) * smooth;
                const auto voiceIndex = static_cast<double>(i);
                const auto drift =
                    std::sin(clock * (0.7 + voiceIndex * 0.13) + voiceIndex * 2.1) * motion * rate * 0.003;
                double echo;
                if (held)
                {
                    const auto phase = phases[i], length = lengths[i];
                    echo = read(i, starts[i] + phase);
                    if (phase > length - 64)
                    {
                        const auto fade = (phase - length + 64) / 64;
                        echo = echo * (1 - fade) + read(i, starts[i] + phase - length + 64) * fade;
                    }
                    phases[i] = phase + lengths[i] / delays[i] * (1 + drift / rate * 5);
                    if (phases[i] >= length)
                        phases[i] = 64 + std::fmod(phases[i] - length, length - 64);
                }
                else
                {
                    echo = read(i, write - delays[i] + drift);
                }
                filtered[i] += (echo - filtered[i]) * cutoff;
                if (! held)
                    buffers[i][static_cast<size_t>(write)] =
                        static_cast<float>(std::tanh((left + right) * 0.5 + filtered[i] * feedback));
                levels[i] += (settings.levels[i] - levels[i]) * smooth;
                const auto pan = (voiceIndex - 1) * spread;
                const auto voice = filtered[i] * levels[i] * 0.6;
                wetLeft += voice * std::sqrt((1 - pan) * 0.5);
                wetRight += voice * std::sqrt((1 + pan) * 0.5);
            }
            if (! held)
                write = (write + 1) % capacity;
            clock += 1 / rate;
            wet += (settings.mix - wet) * smooth;
            blend += ((settings.bypass ? 0 : 1) - blend) * smooth;
            const auto mix = wet * blend;
            return { static_cast<float>(left * (1 - mix) + wetLeft * mix),
                     static_cast<float>(right * (1 - mix) + wetRight * mix) };
        }

    private:
        double read(size_t voice, double position) const
        {
            auto wrapped = std::fmod(position, capacity);
            if (wrapped < 0)
                wrapped += capacity;
            const auto index = static_cast<size_t>(wrapped);
            const auto fraction = wrapped - static_cast<double>(index);
            return buffers[voice][index] * (1 - fraction)
                   + buffers[voice][(index + 1) % static_cast<size_t>(capacity)] * fraction;
        }

        std::array<std::vector<float>, 3> buffers;
        std::array<double, 3> delays {}, filtered {}, starts {}, lengths {}, phases {}, levels {};
        double rate = 48000, clock = 0, smooth = 0, wet = 0, blend = 0, cutoff = 0.1;
        double feedback = .48, motion = .18, spread = .75;
        int capacity = 0, write = 0;
        bool held = false;
    };

} // namespace orbit
