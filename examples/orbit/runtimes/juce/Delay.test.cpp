#include "Delay.h"

#include <cassert>
#include <iostream>

int main()
{
    constexpr int rate = 8000;
    orbit::Delay delay;
    delay.prepare(rate);
    orbit::Settings state;
    state.times = { 0.1f, 0.2f, 0.3f };
    state.levels = { 1, 0, 0 };
    state.feedback = 0;
    state.motion = 0;
    state.mix = 1;
    state.spread = 1;
    state.tone = 1;
    delay.configure(state);
    for (int i = 0; i < rate; ++i)
        delay.tick(0, 0, state);
    int first = -1;
    double energy = 0;
    for (int i = 0; i < 2000; ++i)
    {
        const auto output = delay.tick(i == 0 ? 1.0f : 0.0f, i == 0 ? 1.0f : 0.0f, state);
        if (std::abs(output[0]) > 0.001f && first < 0)
            first = i;
        energy += output[0] * output[0];
        assert(std::abs(output[1]) < 0.000001f);
    }
    assert(first >= 799 && first <= 802 && energy > 0.05);
    for (int i = 0; i < rate; ++i)
        delay.tick(static_cast<float>(std::sin(i * 0.07) * 0.3), 0, state);
    state.hold = true;
    energy = 0;
    for (int i = 0; i < rate * 2; ++i)
    {
        const auto output = delay.tick(0, 0, state);
        energy += output[0] * output[0];
        assert(std::isfinite(output[0]));
    }
    assert(energy > 1);
    state.bypass = true;
    for (int i = 0; i < rate; ++i)
        delay.tick(0.25f, -0.125f, state);
    const auto output = delay.tick(0.25f, -0.125f, state);
    assert(std::abs(output[0] - 0.25f) < 0.000001f);
    assert(std::abs(output[1] + 0.125f) < 0.000001f);
    std::cout << "Orbit delay: impulse timing, stereo, Hold, bypass passed\n";
}
