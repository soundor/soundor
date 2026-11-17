#pragma once
#include "EventLoop.h"
#include "Json.h"

#include <memory>
#include <optional>
#include <string>
namespace soundor::vst3host
{
    class Plugin;
    // Physical input is a host routing choice, independent of plugin capabilities.
    // Linux uses the system ALSA sequencer; other platforms report unsupported.
    class MidiInput
    {
    public:
        MidiInput(EventLoop&, Plugin&);
        ~MidiInput();
        Json devices();
        Json select(std::optional<std::string>);

    private:
        struct State;
        std::unique_ptr<State> state_;
    };
} // namespace soundor::vst3host
